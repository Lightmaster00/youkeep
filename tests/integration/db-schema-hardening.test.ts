import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { performance } from 'perf_hooks';
import type Database from 'better-sqlite3';
import { assertInTmp } from '../helpers/testDb';
import { seedBigLibrary, REGRESSION_SIZES } from '../helpers/bigLibrary';

// The server test setup mocks server/utils/db; these tests need the real init path.
const { openDatabase, getDb, reopenDb } = await vi.importActual<typeof import('../../server/utils/db')>('../../server/utils/db');

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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yk-schema-'));
  assertInTmp(dir);
  dbFile = path.join(dir, 'youkeep.db');
});
afterEach(() => {
  for (const db of open.splice(0)) { try { db.close(); } catch {} }
  fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/** True when some full (non-partial) index of `table` starts with exactly these columns. */
function hasIndexOn(db: Database.Database, table: string, columns: string[]): boolean {
  const indexes = db.prepare(`PRAGMA index_list(${table})`).all() as { name: string; partial: number }[];
  return indexes.filter((i) => !i.partial).some(({ name }) => {
    const cols = (db.prepare(`PRAGMA index_info(${name})`).all() as { name: string }[]).map((c) => c.name);
    return columns.every((c, i) => cols[i] === c);
  });
}

describe('foreign-key and lookup indexes', () => {
  const expected: Array<[string, string[]]> = [
    ['music_play_history', ['track_id']],
    ['music_favorites', ['track_id']],
    ['music_track_artists', ['artist_id']],
    ['music_albums', ['artist_id']],
    ['podcast_episode_progress', ['episode_id']],
    ['podcast_show_follows', ['show_id']],
    ['personal_playlist_videos', ['video_id']],
    ['playlist_videos', ['video_id']],
    ['user_hidden_videos', ['video_id']],
    ['reports', ['video_id']],
    ['user_channel_access', ['channel_id']],
    ['user_subscriptions', ['channel_id']],
    ['api_tokens', ['user_id']],
    ['sessions', ['user_id']],
    ['sessions', ['expires_at']],
    ['music_tracks', ['artist_id', 'download_status']],
    ['podcast_episodes', ['show_id', 'download_status']],
  ];
  it.each(expected)('%s(%s) is indexed', (table, columns) => {
    const db = openDb();
    expect(hasIndexOn(db, table, columns)).toBe(true);
  });

  it('deleting an artist with 300 tracks and a show with 300 episodes takes under 100 ms each', () => {
    const db = openDb();
    seedBigLibrary(db, REGRESSION_SIZES);
    const now = Date.now();
    db.transaction(() => {
      db.prepare("INSERT INTO music_artists (id, name, created_at) VALUES ('big', 'Big', ?)").run(now);
      db.prepare("INSERT INTO podcast_shows (id, feed_url, title, created_at) VALUES ('bigshow', 'https://example.invalid/big', 'Big', ?)").run(now);
      for (let i = 0; i < 300; i++) {
        db.prepare("INSERT INTO music_tracks (id, artist_id, title, download_status, created_at) VALUES (?, 'big', ?, 'completed', ?)").run(`bt${i}`, `T${i}`, now);
        db.prepare("INSERT INTO music_track_artists (track_id, artist_id, role) VALUES (?, 'big', 'primary')").run(`bt${i}`);
        db.prepare("INSERT INTO music_play_history (id, track_id, user_id, played_at) VALUES (?, ?, 'heavy', ?)").run(`bp${i}`, `bt${i}`, now);
        db.prepare("INSERT INTO podcast_episodes (id, show_id, title, audio_url, download_status, created_at) VALUES (?, 'bigshow', ?, 'https://example.invalid/x.mp3', 'completed', ?)").run(`be${i}`, `E${i}`, now);
      }
    })();

    let start = performance.now();
    db.prepare("DELETE FROM music_artists WHERE id = 'big'").run();
    const artistMs = performance.now() - start;
    start = performance.now();
    db.prepare("DELETE FROM podcast_shows WHERE id = 'bigshow'").run();
    const showMs = performance.now() - start;

    expect((db.prepare("SELECT COUNT(*) as n FROM music_tracks WHERE artist_id = 'big'").get() as any).n).toBe(0);
    expect((db.prepare("SELECT COUNT(*) as n FROM podcast_episodes WHERE show_id = 'bigshow'").get() as any).n).toBe(0);
    expect(artistMs).toBeLessThan(100);
    expect(showMs).toBeLessThan(100);
  }, 60_000);
});

describe('row id guards', () => {
  const inserts: Record<string, (db: Database.Database, id: string | null) => void> = {
    videos: (db, id) => db.prepare("INSERT INTO videos (id, title, channel_id, download_status, created_at) VALUES (?, 't', 'c1', 'pending', 0)").run(id),
    music_tracks: (db, id) => db.prepare("INSERT INTO music_tracks (id, artist_id, title, created_at) VALUES (?, 'a1', 't', 0)").run(id),
    podcast_episodes: (db, id) => db.prepare("INSERT INTO podcast_episodes (id, show_id, title, audio_url, created_at) VALUES (?, 's1', 't', 'https://example.invalid/a.mp3', 0)").run(id),
  };
  it.each(Object.keys(inserts))('%s refuses a NULL or empty id and accepts a real one', (table) => {
    const db = openDb();
    db.prepare("INSERT INTO channels (id, title, created_at) VALUES ('c1', 'C', 0)").run();
    db.prepare("INSERT INTO music_artists (id, name, created_at) VALUES ('a1', 'A', 0)").run();
    db.prepare("INSERT INTO podcast_shows (id, feed_url, title, created_at) VALUES ('s1', 'https://example.invalid/f', 'S', 0)").run();
    expect(() => inserts[table]!(db, null)).toThrow(/id/i);
    expect(() => inserts[table]!(db, '')).toThrow(/id/i);
    inserts[table]!(db, 'ok1');
    expect((db.prepare(`SELECT COUNT(*) as n FROM ${table}`).get() as any).n).toBe(1);
  });
});

describe('usernames', () => {
  it('two usernames differing only by case cannot coexist', () => {
    const db = openDb();
    db.prepare("INSERT INTO users (id, username, password_hash, role, created_at) VALUES ('u1', 'Bob', 'x', 'user', 0)").run();
    expect(() => db.prepare("INSERT INTO users (id, username, password_hash, role, created_at) VALUES ('u2', 'bob', 'x', 'user', 0)").run()).toThrow(/UNIQUE/);
  });

  it('an older database that already holds such duplicates still opens, with a warning', () => {
    const first = openDb();
    first.prepare("INSERT INTO users (id, username, password_hash, role, created_at) VALUES ('u1', 'Bob', 'x', 'user', 0)").run();
    first.exec('DROP INDEX IF EXISTS idx_users_username_nocase');
    first.prepare("INSERT INTO users (id, username, password_hash, role, created_at) VALUES ('u2', 'bob', 'x', 'user', 0)").run();
    first.close();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const db = openDb();
    expect((db.prepare('SELECT COUNT(*) as n FROM users').get() as any).n).toBe(2);
    expect(warn.mock.calls.some((c) => String(c[0]).includes('case'))).toBe(true);
  });
});

describe('startup', () => {
  it('no longer runs the obsolete size_bytes backfill', () => {
    const first = openDb();
    first.prepare("INSERT INTO channels (id, title, created_at) VALUES ('c1', 'C', 0)").run();
    first.prepare("INSERT INTO videos (id, title, channel_id, download_status, created_at) VALUES ('v1', 't', 'c1', 'completed', 0)").run();
    first.close();
    const log = vi.mocked(console.log);
    log.mockClear();
    openDb();
    expect(log.mock.calls.some((c) => String(c[0]).includes('size_bytes'))).toBe(false);
  });

  it('getDb() refuses to reopen silently once the connection was closed (shutdown); reopenDb() is explicit', () => {
    const a = getDb();
    open.push(a);
    expect(getDb()).toBe(a);
    a.close();
    expect(() => getDb()).toThrow(/closed/);
    const b = reopenDb();
    open.push(b);
    expect(b).not.toBe(a);
    expect(b.open).toBe(true);
    expect(getDb()).toBe(b);
  });
});
