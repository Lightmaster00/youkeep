import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { performance } from 'perf_hooks';
import type Database from 'better-sqlite3';
import { assertInTmp, mockEvent } from '../helpers/testDb';
import { seedBigLibrary, REGRESSION_SIZES } from '../helpers/bigLibrary';
import { getUserFromSession } from '../../server/utils/auth';
import videosHandler from '../../server/api/videos/index.get';
import tracksSearch from '../../server/api/music/tracks/search.get';
import episodesSearch from '../../server/api/podcasts/episodes/search.get';

// A guest search with a huge number of short words used to run one prefix
// query per word on a synchronous database: 1000 words froze the server for
// 20 s. Queries are now capped (200 characters, 8 words, no 1-letter prefix).
const { openDatabase } = await vi.importActual<typeof import('../../server/utils/db')>('../../server/utils/db');

let dir: string;
let db: Database.Database;

beforeAll(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yk-fts-abuse-'));
  assertInTmp(dir);
  db = openDatabase(path.join(dir, 'youkeep.db'));
  seedBigLibrary(db, { ...REGRESSION_SIZES, videos: 20_000, tracks: 20_000, episodes: 20_000, plays: 0, videoHistory: 0, favorites: 0, progress: 0 });
  // Real-looking text: ~80 words per row from a 5000-word vocabulary, so
  // every 1-letter prefix expands to hundreds of terms (as in a real library).
  const word = (n: number) => { let w = ''; let x = n * 2654435761 % 4294967296; for (let k = 0; k < 3 + (n % 6); k++) { w += 'abcdefghijklmnopqrstuvwxyz'[x % 26]; x = Math.floor(x / 26) + n * 7 + k; } return w; };
  const text = (i: number) => Array.from({ length: 80 }, (_, k) => word((i * 131 + k * 17) % 5000)).join(' ');
  db.transaction(() => {
    const v = db.prepare('UPDATE videos SET description = ? WHERE id = ?');
    for (let i = 0; i < 20_000; i++) v.run(text(i), `v${i}`);
    const e = db.prepare('UPDATE podcast_episodes SET description = ? WHERE id = ?');
    for (let i = 0; i < 20_000; i++) e.run(text(i + 7), `e${i}`);
    const t = db.prepare('UPDATE music_tracks SET title = ? WHERE id = ?');
    for (let i = 0; i < 20_000; i++) t.run(`Track ${i} ${text(i).slice(0, 60)}`, `t${i}`);
  })();
  (globalThis as any).getDb = () => db;
  (globalThis as any).getUserFromSession = getUserFromSession;
});
afterAll(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const hostile = Array.from({ length: 1000 }, (_, i) => 'abcdefghijklmnopqrstuvwxyz'[i % 26]).join(' ');

describe('full-text search abuse (H1)', () => {
  it.each([
    ['videos', videosHandler, '/api/videos'],
    ['music tracks', tracksSearch, '/api/music/tracks/search'],
    ['podcast episodes', episodesSearch, '/api/podcasts/episodes/search'],
  ])('%s: a 1000-word guest query answers in under 100 ms', async (_name, handler: any, url) => {
    const p = `${url}?q=${encodeURIComponent(hostile)}`;
    await handler(mockEvent(undefined, { path: p })); // warm-up (statement cache)
    const t0 = performance.now();
    await handler(mockEvent(undefined, { path: p }));
    expect(performance.now() - t0).toBeLessThan(100);
  });

  it('a normal search still finds its rows', async () => {
    const r: any = await videosHandler(mockEvent(undefined, { path: '/api/videos?q=Video%2042' }));
    expect(r.videos.some((v: any) => v.id === 'v42')).toBe(true);
    const t: any = await tracksSearch(mockEvent(undefined, { path: '/api/music/tracks/search?q=Track%2012' }));
    expect(t.tracks.length).toBeGreaterThan(0);
  });
});
