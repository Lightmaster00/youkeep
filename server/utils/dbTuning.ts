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
