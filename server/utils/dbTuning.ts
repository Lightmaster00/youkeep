import type Database from 'better-sqlite3';

/**
 * Connection pragmas for the shared database. WAL is kept; `synchronous =
 * NORMAL` is safe in WAL mode (no corruption, at worst the last transactions
 * are lost after a power cut) and removes an fsync wait from every commit,
 * which otherwise blocks the whole event loop on a slow disk.
 */
export const PERFORMANCE_PRAGMAS = [
  'synchronous = NORMAL',
  'temp_store = MEMORY',
  'cache_size = -20000',
  'mmap_size = 134217728',
  'wal_autocheckpoint = 1000',
] as const;

export function applyPerformancePragmas(db: Database.Database): void {
  for (const pragma of PERFORMANCE_PRAGMAS) db.pragma(pragma);
}

/** How often PRAGMA optimize runs while the server is up. */
export const PLANNER_MAINTENANCE_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * Keeps the query planner's statistics usable: a full ANALYZE once when the
 * database has none (a fresh install or an older database; without them
 * SQLite picked the visibility index for the channel list and scanned every
 * public video once per channel), then PRAGMA optimize, which only re-analyzes
 * what changed enough. Never throws.
 */
export function runPlannerMaintenance(db: Database.Database): { analyzed: boolean } {
  let analyzed = false;
  try {
    let hasStats = false;
    try {
      hasStats = ((db.prepare('SELECT COUNT(*) AS n FROM sqlite_stat1').get() as { n: number }).n) > 0;
    } catch {
      hasStats = false; // no sqlite_stat1 table yet
    }
    if (!hasStats) {
      db.exec('ANALYZE');
      analyzed = true;
    }
    db.pragma('optimize');
  } catch (err) {
    console.warn('[Database] Planner statistics maintenance failed:', (err as Error)?.message ?? err);
  }
  return { analyzed };
}

/** Runs PRAGMA optimize every PLANNER_MAINTENANCE_INTERVAL_MS; returns a stop function. */
export function startPlannerMaintenance(getDatabase: () => Database.Database): () => void {
  const timer = setInterval(() => {
    try {
      const db = getDatabase();
      if (db.open) db.pragma('optimize');
    } catch (err) {
      console.warn('[Database] PRAGMA optimize failed:', (err as Error)?.message ?? err);
    }
  }, PLANNER_MAINTENANCE_INTERVAL_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}

/**
 * Full-text index update triggers, scoped to the columns that feed each index.
 * A download progress tick (download_progress/speed/eta) no longer rewrites the
 * index entry with the full description.
 */
export const FTS_UPDATE_TRIGGERS: Record<'videos_au' | 'music_tracks_au' | 'podcast_episodes_au', string> = {
  videos_au: `
    CREATE TRIGGER IF NOT EXISTS videos_au AFTER UPDATE OF title, description, channel_id ON videos BEGIN
      DELETE FROM videos_fts WHERE rowid = old.rowid;
      INSERT INTO videos_fts(rowid, id, title, description, channel_title)
      VALUES (
        new.rowid,
        new.id,
        new.title,
        new.description,
        (SELECT title FROM channels WHERE id = new.channel_id)
      );
    END;`,
  music_tracks_au: `
    CREATE TRIGGER IF NOT EXISTS music_tracks_au AFTER UPDATE OF title, artist_id, album_id, genre ON music_tracks BEGIN
      DELETE FROM music_tracks_fts WHERE rowid = old.rowid;
      INSERT INTO music_tracks_fts(rowid, id, title, artist_name, album_title, genre)
      VALUES (
        new.rowid,
        new.id,
        new.title,
        (SELECT name FROM music_artists WHERE id = new.artist_id),
        (SELECT title FROM music_albums WHERE id = new.album_id),
        new.genre
      );
    END;`,
  podcast_episodes_au: `
    CREATE TRIGGER IF NOT EXISTS podcast_episodes_au AFTER UPDATE OF title, description, show_id ON podcast_episodes BEGIN
      DELETE FROM podcast_episodes_fts WHERE rowid = old.rowid;
      INSERT INTO podcast_episodes_fts(rowid, id, title, description, show_title)
      VALUES (
        new.rowid,
        new.id,
        new.title,
        new.description,
        (SELECT title FROM podcast_shows WHERE id = new.show_id)
      );
    END;`,
};

export const FTS_TRIGGERS_FLAG = 'fts_triggers_v2';

/**
 * One-time migration: replaces the older unscoped `AFTER UPDATE` triggers of
 * existing databases with the column-scoped ones above. Idempotent (DROP IF
 * EXISTS + CREATE), and guarded by a settings flag so it runs once.
 * Returns true when it ran.
 */
export function migrateFtsTriggers(db: Database.Database): boolean {
  const flag = db.prepare('SELECT value FROM settings WHERE key = ?').get(FTS_TRIGGERS_FLAG) as { value: string } | undefined;
  if (flag?.value === '1') return false;
  db.transaction(() => {
    for (const [name, sql] of Object.entries(FTS_UPDATE_TRIGGERS)) {
      db.exec(`DROP TRIGGER IF EXISTS ${name};`);
      db.exec(sql);
    }
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(FTS_TRIGGERS_FLAG, '1');
  })();
  return true;
}

/**
 * Parent renames: each full-text row also stores its channel / artist / album
 * / show name, so renaming the parent refreshes the children's rows (only
 * when the name really changed; every sync rewrites it with the same value).
 */
export const FTS_RENAME_TRIGGERS: Record<string, string> = {
  channels_fts_rename: `
    CREATE TRIGGER IF NOT EXISTS channels_fts_rename AFTER UPDATE OF title ON channels
    WHEN old.title IS NOT new.title BEGIN
      UPDATE videos_fts SET channel_title = new.title
      WHERE rowid IN (SELECT rowid FROM videos WHERE channel_id = new.id);
    END;`,
  music_artists_fts_rename: `
    CREATE TRIGGER IF NOT EXISTS music_artists_fts_rename AFTER UPDATE OF name ON music_artists
    WHEN old.name IS NOT new.name BEGIN
      UPDATE music_tracks_fts SET artist_name = new.name
      WHERE rowid IN (SELECT rowid FROM music_tracks WHERE artist_id = new.id);
    END;`,
  music_albums_fts_rename: `
    CREATE TRIGGER IF NOT EXISTS music_albums_fts_rename AFTER UPDATE OF title ON music_albums
    WHEN old.title IS NOT new.title BEGIN
      UPDATE music_tracks_fts SET album_title = new.title
      WHERE rowid IN (SELECT rowid FROM music_tracks WHERE album_id = new.id);
    END;`,
  podcast_shows_fts_rename: `
    CREATE TRIGGER IF NOT EXISTS podcast_shows_fts_rename AFTER UPDATE OF title ON podcast_shows
    WHEN old.title IS NOT new.title BEGIN
      UPDATE podcast_episodes_fts SET show_title = new.title
      WHERE rowid IN (SELECT rowid FROM podcast_episodes WHERE show_id = new.id);
    END;`,
};

export const FTS_RENAME_FLAG = 'fts_triggers_v3';

/**
 * Creates the rename triggers (idempotent) and, once per database (settings
 * flag), refreshes the parent names already stale in the full-text rows.
 * Returns true when the one-time refresh ran.
 */
export function migrateFtsRenameTriggers(db: Database.Database): boolean {
  for (const sql of Object.values(FTS_RENAME_TRIGGERS)) db.exec(sql);
  const flag = db.prepare('SELECT value FROM settings WHERE key = ?').get(FTS_RENAME_FLAG) as { value: string } | undefined;
  if (flag?.value === '1') return false;
  db.transaction(() => {
    db.exec(`
      UPDATE videos_fts SET channel_title = (
        SELECT c.title FROM videos v JOIN channels c ON c.id = v.channel_id WHERE v.rowid = videos_fts.rowid
      )
      WHERE channel_title IS NOT (
        SELECT c.title FROM videos v JOIN channels c ON c.id = v.channel_id WHERE v.rowid = videos_fts.rowid
      );
      UPDATE music_tracks_fts SET
        artist_name = (SELECT a.name FROM music_tracks t JOIN music_artists a ON a.id = t.artist_id WHERE t.rowid = music_tracks_fts.rowid),
        album_title = (SELECT al.title FROM music_tracks t JOIN music_albums al ON al.id = t.album_id WHERE t.rowid = music_tracks_fts.rowid)
      WHERE artist_name IS NOT (SELECT a.name FROM music_tracks t JOIN music_artists a ON a.id = t.artist_id WHERE t.rowid = music_tracks_fts.rowid)
         OR album_title IS NOT (SELECT al.title FROM music_tracks t JOIN music_albums al ON al.id = t.album_id WHERE t.rowid = music_tracks_fts.rowid);
      UPDATE podcast_episodes_fts SET show_title = (
        SELECT s.title FROM podcast_episodes e JOIN podcast_shows s ON s.id = e.show_id WHERE e.rowid = podcast_episodes_fts.rowid
      )
      WHERE show_title IS NOT (
        SELECT s.title FROM podcast_episodes e JOIN podcast_shows s ON s.id = e.show_id WHERE e.rowid = podcast_episodes_fts.rowid
      );
    `);
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(FTS_RENAME_FLAG, '1');
  })();
  return true;
}
