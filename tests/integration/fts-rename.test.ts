import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type Database from 'better-sqlite3';
import { FTS_RENAME_FLAG, migrateFtsRenameTriggers } from '../../server/utils/dbTuning';
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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yk-fts-rename-'));
  assertInTmp(dir);
  dbFile = path.join(dir, 'youkeep.db');
});
afterEach(() => {
  for (const db of open.splice(0)) { try { db.close(); } catch {} }
  fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function seed(db: Database.Database) {
  db.prepare("INSERT INTO channels (id, title, created_at) VALUES ('c1', 'Oldchannel', 0)").run();
  db.prepare("INSERT INTO videos (id, title, channel_id, download_status, created_at) VALUES ('v1', 'Clip', 'c1', 'completed', 0)").run();
  db.prepare("INSERT INTO music_artists (id, name, created_at) VALUES ('a1', 'Oldartist', 0)").run();
  db.prepare("INSERT INTO music_albums (id, artist_id, title, source, created_at) VALUES ('al1', 'a1', 'Oldalbum', 'manual', 0)").run();
  db.prepare("INSERT INTO music_tracks (id, artist_id, album_id, title, created_at) VALUES ('t1', 'a1', 'al1', 'Song', 0)").run();
  db.prepare("INSERT INTO podcast_shows (id, feed_url, title, created_at) VALUES ('s1', 'https://example.invalid/f', 'Oldshow', 0)").run();
  db.prepare("INSERT INTO podcast_episodes (id, show_id, title, audio_url, created_at) VALUES ('e1', 's1', 'Ep', 'https://example.invalid/a.mp3', 0)").run();
}

const match = (db: Database.Database, fts: string, q: string) =>
  (db.prepare(`SELECT id FROM ${fts} WHERE ${fts} MATCH ?`).all(q) as { id: string }[]).map((r) => r.id);

function renameAll(db: Database.Database) {
  db.prepare("UPDATE channels SET title = 'Newchannel' WHERE id = 'c1'").run();
  db.prepare("UPDATE music_artists SET name = 'Newartist' WHERE id = 'a1'").run();
  db.prepare("UPDATE music_albums SET title = 'Newalbum' WHERE id = 'al1'").run();
  db.prepare("UPDATE podcast_shows SET title = 'Newshow' WHERE id = 's1'").run();
}

function expectRenamed(db: Database.Database) {
  expect(match(db, 'videos_fts', 'newchannel')).toEqual(['v1']);
  expect(match(db, 'videos_fts', 'oldchannel')).toEqual([]);
  expect(match(db, 'music_tracks_fts', 'newartist')).toEqual(['t1']);
  expect(match(db, 'music_tracks_fts', 'oldartist')).toEqual([]);
  expect(match(db, 'music_tracks_fts', 'newalbum')).toEqual(['t1']);
  expect(match(db, 'music_tracks_fts', 'oldalbum')).toEqual([]);
  expect(match(db, 'podcast_episodes_fts', 'newshow')).toEqual(['e1']);
  expect(match(db, 'podcast_episodes_fts', 'oldshow')).toEqual([]);
}

describe('full-text index after a parent rename', () => {
  it('renaming a channel, an artist, an album or a show re-indexes their children', () => {
    const db = openDb();
    seed(db);
    expect(match(db, 'videos_fts', 'oldchannel')).toEqual(['v1']);
    renameAll(db);
    expectRenamed(db);
  });

  it('a sync that rewrites the same title leaves the index rows alone', () => {
    const db = openDb();
    seed(db);
    const rowid = (db.prepare("SELECT rowid FROM videos WHERE id = 'v1'").get() as { rowid: number }).rowid;
    db.prepare('UPDATE videos_fts SET title = ? WHERE rowid = ?').run('sentinel', rowid);
    db.prepare("UPDATE channels SET title = 'Oldchannel' WHERE id = 'c1'").run();
    expect(match(db, 'videos_fts', 'sentinel')).toEqual(['v1']);
  });

  it('an existing database with stale rows is repaired once on open, guarded by its flag', () => {
    const first = openDb();
    seed(first);
    for (const t of ['channels_fts_rename', 'music_artists_fts_rename', 'music_albums_fts_rename', 'podcast_shows_fts_rename']) {
      first.exec(`DROP TRIGGER ${t};`);
    }
    first.prepare('DELETE FROM settings WHERE key = ?').run(FTS_RENAME_FLAG);
    renameAll(first); // no trigger: the index is now stale
    expect(match(first, 'videos_fts', 'oldchannel')).toEqual(['v1']);
    first.close();

    const db = openDb();
    expectRenamed(db);
    expect((db.prepare('SELECT value FROM settings WHERE key = ?').get(FTS_RENAME_FLAG) as { value: string }).value).toBe('1');
    expect(migrateFtsRenameTriggers(db)).toBe(false);
  });
});
