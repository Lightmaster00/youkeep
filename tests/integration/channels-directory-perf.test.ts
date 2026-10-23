import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { performance } from 'perf_hooks';
import type Database from 'better-sqlite3';
import { assertInTmp, mockEvent, sessionCookie } from '../helpers/testDb';
import { seedBigLibrary, REGRESSION_SIZES } from '../helpers/bigLibrary';
import { getUserFromSession } from '../../server/utils/auth';
import { recomputeChannelCategories } from '../../server/utils/channelCategories';
import channelsIndex from '../../server/api/channels/index.get';
import categoriesGet from '../../server/api/channels/categories.get';
import discoverGet from '../../server/api/channels/discover.get';

// Time budget of the channels directory on 500 channels x 20k videos (single
// Node process: every query must stay set-based).
const { openDatabase } = await vi.importActual<typeof import('../../server/utils/db')>('../../server/utils/db');
const CATS = ['Gaming', 'Music', 'Education', 'Comedy', 'Sports', 'Science & Technology', 'Howto & Style'];

let dir: string;
let db: Database.Database;

beforeAll(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yk-channels-dir-perf-'));
  assertInTmp(dir);
  db = openDatabase(path.join(dir, 'youkeep.db'));
  seedBigLibrary(db, { ...REGRESSION_SIZES, channels: 500, videos: 20_000, tracks: 0, artists: 0, episodes: 0, shows: 0, plays: 0, favorites: 0, progress: 0 });
  const set = db.prepare('UPDATE videos SET categories = ?, metadata_enriched_at = 1 WHERE rowid % ? = ?');
  db.transaction(() => {
    for (let i = 0; i < CATS.length; i++) set.run(JSON.stringify([CATS[i]]), CATS.length, i);
  })();
  recomputeChannelCategories(db);
  try { db.exec('DELETE FROM sqlite_stat1'); } catch {}
  (globalThis as any).getDb = () => db;
  (globalThis as any).getUserFromSession = getUserFromSession;
});
afterAll(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const timed = async (fn: () => Promise<any>) => {
  const t0 = performance.now();
  const result = await fn();
  return { result, ms: performance.now() - t0 };
};

describe('channels directory time budget (500 channels x 20k videos)', () => {
  it('a filtered, sorted page answers in under 300 ms', async () => {
    for (const [cookie, sort] of [[sessionCookie('sess-heavy'), 'watched'], [undefined, 'recent'], [sessionCookie('sess-admin'), 'videos']] as const) {
      const { result, ms } = await timed(() => channelsIndex(mockEvent(cookie, { path: `/api/channels?category=gaming&sort=${sort}&following=0&page=1&limit=48` })) as Promise<any>);
      expect(result.channels.length).toBeGreaterThan(0);
      expect(ms).toBeLessThan(300);
    }
  });

  it('the category counts answer in under 200 ms', async () => {
    const { result, ms } = await timed(() => categoriesGet(mockEvent(sessionCookie('sess-heavy'), { path: '/api/channels/categories' })) as Promise<any>);
    expect(result.categories.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(200);
  });

  it('the Discover strip answers in under 300 ms', async () => {
    const { result, ms } = await timed(() => discoverGet(mockEvent(sessionCookie('sess-heavy'), { path: '/api/channels/discover' })) as Promise<any>);
    expect(result.channels.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(300);
  });

  it('recomputing every channel stays under 500 ms', () => {
    db.exec('UPDATE channels SET categories = NULL');
    const t0 = performance.now();
    recomputeChannelCategories(db);
    expect(performance.now() - t0).toBeLessThan(500);
  });
});
