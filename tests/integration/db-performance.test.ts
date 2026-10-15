import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type Database from 'better-sqlite3';
import { FTS_TRIGGERS_FLAG, migrateFtsTriggers } from '../../server/utils/dbTuning';
import { assertInTmp } from '../helpers/testDb';

// The server test setup mocks server/utils/db; these tests need the real init path.
const { openDatabase } = await vi.importActual<typeof import('../../server/utils/db')>('../../server/utils/db');

let dir: string;
let dbFile: string;
const open: Database.Database[] = [];
const openDb = () => {
  const db = openDatabase(dbFile);
  open.push(db);
  return db;
};

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yk-dbperf-'));
  assertInTmp(dir);
  dbFile = path.join(dir, 'youkeep.db');
});
afterEach(() => {
  for (const db of open.splice(0)) { try { db.close(); } catch {} }
  fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const LEGACY_VIDEOS_AU = `
  CREATE TRIGGER videos_au AFTER UPDATE ON videos BEGIN
    DELETE FROM videos_fts WHERE rowid = old.rowid;
    INSERT INTO videos_fts(rowid, id, title, description, channel_title)
    VALUES (new.rowid, new.id, new.title, new.description, (SELECT title FROM channels WHERE id = new.channel_id));
  END;`;

function seed(db: Database.Database) {
  const now = Date.now();
  db.prepare("INSERT INTO channels (id, title, created_at) VALUES ('c1', 'Chan', ?)").run(now);
  db.prepare("INSERT INTO videos (id, title, description, channel_id, download_status, created_at) VALUES ('v1', 'Alpha video', 'about otters', 'c1', 'downloading', ?)").run(now);
  db.prepare("INSERT INTO music_artists (id, name, created_at) VALUES ('a1', 'Artist', ?)").run(now);
  db.prepare("INSERT INTO music_tracks (id, artist_id, title, genre, download_status, created_at) VALUES ('t1', 'a1', 'Alpha song', 'jazz', 'downloading', ?)").run(now);
  db.prepare("INSERT INTO podcast_shows (id, feed_url, title, created_at) VALUES ('s1', 'https://example.invalid/feed', 'Show', ?)").run(now);
  db.prepare("INSERT INTO podcast_episodes (id, show_id, title, description, audio_url, download_status, created_at) VALUES ('e1', 's1', 'Alpha episode', 'about beavers', 'https://example.invalid/a.mp3', 'downloading', ?)").run(now);
}

const ftsTables = [
  { table: 'videos', fts: 'videos_fts', id: 'v1' },
  { table: 'music_tracks', fts: 'music_tracks_fts', id: 't1' },
  { table: 'podcast_episodes', fts: 'podcast_episodes_fts', id: 'e1' },
] as const;

const match = (db: Database.Database, fts: string, q: string) =>
  (db.prepare(`SELECT id FROM ${fts} WHERE ${fts} MATCH ?`).all(q) as { id: string }[]).map((r) => r.id);

describe('database performance settings', () => {
  it('the real init path applies the connection pragmas to a database file', () => {
    const db = openDb();
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(db.pragma('synchronous', { simple: true })).toBe(1); // NORMAL
    expect(db.pragma('temp_store', { simple: true })).toBe(2); // MEMORY
    expect(db.pragma('cache_size', { simple: true })).toBe(-20000);
    expect(db.pragma('mmap_size', { simple: true })).toBe(134217728);
    expect(db.pragma('wal_autocheckpoint', { simple: true })).toBe(1000);
  });

  it('a progress update leaves the full-text rows alone; a rename still re-indexes', () => {
    const db = openDb();
    seed(db);
    for (const { table, fts, id } of ftsTables) {
      const rowid = (db.prepare(`SELECT rowid FROM ${table} WHERE id = ?`).get(id) as { rowid: number }).rowid;
      // Mark the index row: an unscoped trigger would rebuild it and lose the mark.
      db.prepare(`UPDATE ${fts} SET title = 'sentinel' WHERE rowid = ?`).run(rowid);

      db.prepare(`UPDATE ${table} SET download_progress = 42, download_speed = '1MiB/s', download_eta = '00:10' WHERE id = ?`).run(id);
      expect((db.prepare(`SELECT title FROM ${fts} WHERE rowid = ?`).get(rowid) as { title: string }).title).toBe('sentinel');

      db.prepare(`UPDATE ${table} SET title = 'Renamed zebra' WHERE id = ?`).run(id);
      expect((db.prepare(`SELECT title FROM ${fts} WHERE rowid = ?`).get(rowid) as { title: string }).title).toBe('Renamed zebra');
      expect(match(db, fts, 'zebra')).toEqual([id]);
      expect(match(db, fts, 'sentinel')).toEqual([]);
    }
  });

  it('description, genre and parent changes still re-index', () => {
    const db = openDb();
    seed(db);
    db.prepare("UPDATE videos SET description = 'about pandas' WHERE id = 'v1'").run();
    expect(match(db, 'videos_fts', 'pandas')).toEqual(['v1']);
    expect(match(db, 'videos_fts', 'otters')).toEqual([]);

    db.prepare("UPDATE music_tracks SET genre = 'techno' WHERE id = 't1'").run();
    expect(match(db, 'music_tracks_fts', 'techno')).toEqual(['t1']);
    db.prepare("INSERT INTO music_albums (id, artist_id, title, source, created_at) VALUES ('al1', 'a1', 'Blue Record', 'manual', 0)").run();
    db.prepare("UPDATE music_tracks SET album_id = 'al1' WHERE id = 't1'").run();
    expect(match(db, 'music_tracks_fts', 'blue')).toEqual(['t1']);

    db.prepare("UPDATE podcast_episodes SET description = 'about wolves' WHERE id = 'e1'").run();
    expect(match(db, 'podcast_episodes_fts', 'wolves')).toEqual(['e1']);
    db.prepare("INSERT INTO podcast_shows (id, feed_url, title, created_at) VALUES ('s2', 'https://example.invalid/f2', 'Moonshow', 0)").run();
    db.prepare("UPDATE podcast_episodes SET show_id = 's2' WHERE id = 'e1'").run();
    expect(match(db, 'podcast_episodes_fts', 'moonshow')).toEqual(['e1']);
  });

  it('an existing database with the old triggers is migrated once, on open', () => {
    const first = openDb();
    seed(first);
    first.exec('DROP TRIGGER videos_au;');
    first.exec(LEGACY_VIDEOS_AU);
    first.prepare('DELETE FROM settings WHERE key = ?').run(FTS_TRIGGERS_FLAG);
    first.close();

    const db = openDb();
    const sql = (db.prepare("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'videos_au'").get() as { sql: string }).sql;
    expect(sql).toContain('AFTER UPDATE OF title, description, channel_id ON videos');
    expect((db.prepare('SELECT value FROM settings WHERE key = ?').get(FTS_TRIGGERS_FLAG) as { value: string }).value).toBe('1');
    expect(match(db, 'videos_fts', 'otters')).toEqual(['v1']);
  });

  it('the migration is guarded by its flag and idempotent', () => {
    const db = openDb();
    expect(migrateFtsTriggers(db)).toBe(false); // already ran during open

    db.exec('DROP TRIGGER videos_au;');
    db.exec(LEGACY_VIDEOS_AU);
    expect(migrateFtsTriggers(db)).toBe(false); // flag set: left alone
    expect((db.prepare("SELECT sql FROM sqlite_master WHERE name = 'videos_au'").get() as { sql: string }).sql).not.toContain('UPDATE OF');

    db.prepare('DELETE FROM settings WHERE key = ?').run(FTS_TRIGGERS_FLAG);
    expect(migrateFtsTriggers(db)).toBe(true);
    db.prepare("UPDATE settings SET value = '0' WHERE key = ?").run(FTS_TRIGGERS_FLAG);
    expect(migrateFtsTriggers(db)).toBe(true); // a second run is harmless
    const triggers = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND name LIKE '%_au'").all() as { name: string; sql: string }[];
    expect(triggers.map((t) => t.name).sort()).toEqual(['music_tracks_au', 'podcast_episodes_au', 'videos_au']);
    for (const t of triggers) expect(t.sql).toContain('AFTER UPDATE OF');

    seed(db);
    db.prepare("UPDATE videos SET title = 'Renamed giraffe' WHERE id = 'v1'").run();
    expect(match(db, 'videos_fts', 'giraffe')).toEqual(['v1']);
  });
});
