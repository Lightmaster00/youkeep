import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { performance } from 'perf_hooks';
import type Database from 'better-sqlite3';
import { assertInTmp, mockEvent, sessionCookie } from '../helpers/testDb';
import { seedBigLibrary, REGRESSION_SIZES } from '../helpers/bigLibrary';
import { getUserFromSession } from '../../server/utils/auth';
import channelsIndex from '../../server/api/channels/index.get';
import { runPlannerMaintenance, startPlannerMaintenance, PLANNER_MAINTENANCE_INTERVAL_MS } from '../../server/utils/dbTuning';

// GET /api/channels joined every channel to every visible video; with no
// planner statistics SQLite picked the visibility index and scanned all
// public videos once per channel (0.45 s per guest call on 200 channels x
// 10k videos, 8.9 s for 20 parallel calls; 3.6 s here before the fix).
const { openDatabase } = await vi.importActual<typeof import('../../server/utils/db')>('../../server/utils/db');

let dir: string;
let db: Database.Database;

beforeAll(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yk-channels-perf-'));
  assertInTmp(dir);
  db = openDatabase(path.join(dir, 'youkeep.db'));
  seedBigLibrary(db, { ...REGRESSION_SIZES, channels: 200, videos: 10_000, tracks: 0, artists: 0, episodes: 0, shows: 0, plays: 0, favorites: 0, progress: 0, videoHistory: 0 });
  // Real descriptions are a few KB: scanning rows is what costs.
  db.exec("UPDATE videos SET description = substr(replace(hex(zeroblob(1600)), '00', 'lorem ipsum '), 1, 3000)");
  // Planner statistics as a fresh install has them: none.
  try { db.exec('DELETE FROM sqlite_stat1'); } catch {}
  (globalThis as any).getDb = () => db;
  (globalThis as any).getUserFromSession = getUserFromSession;
});
afterAll(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('GET /api/channels on 200 channels x 10k videos (H2)', () => {
  it('20 parallel guest calls take under 2 s in total, without planner statistics', async () => {
    const t0 = performance.now();
    await Promise.all(Array.from({ length: 20 }, () => channelsIndex(mockEvent(undefined, { path: '/api/channels' }))));
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(2000);
  });

  it('counts only what each viewer may see', async () => {
    const guest: any = await channelsIndex(mockEvent(undefined, { path: '/api/channels' }));
    const admin: any = await channelsIndex(mockEvent(sessionCookie('sess-admin'), { path: '/api/channels' }));
    const c0g = guest.channels.find((c: any) => c.id === 'c0');
    const c0a = admin.channels.find((c: any) => c.id === 'c0');
    const expectedAll = db.prepare("SELECT COUNT(*) AS n, SUM(download_status = 'completed') AS done FROM videos WHERE channel_id = 'c0'").get() as any;
    const expectedPublic = db.prepare("SELECT COUNT(*) AS n, SUM(download_status = 'completed') AS done FROM videos WHERE channel_id = 'c0' AND visibility = 'public'").get() as any;
    expect([c0a.total_count, c0a.completed_count]).toEqual([expectedAll.n, expectedAll.done]);
    expect([c0g.total_count, c0g.completed_count]).toEqual([expectedPublic.n, expectedPublic.done]);
    // A channel without any visible video still lists, with zero counts.
    db.prepare("INSERT INTO channels (id, title, visibility, created_at) VALUES ('cEmpty', 'Empty', 'public', 0)").run();
    const again: any = await channelsIndex(mockEvent(undefined, { path: '/api/channels' }));
    expect(again.channels.find((c: any) => c.id === 'cEmpty')).toMatchObject({ total_count: 0, completed_count: 0 });
  });

  it('the composite index exists', () => {
    const idx = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_videos_channel_visibility_status'").get() as any;
    expect(idx?.sql).toMatch(/videos\s*\(\s*channel_id\s*,\s*visibility\s*,\s*download_status\s*\)/);
  });
});

describe('planner maintenance', () => {
  it('runs ANALYZE once when there are no statistics, then only PRAGMA optimize', () => {
    try { db.exec('DELETE FROM sqlite_stat1'); } catch {}
    expect(runPlannerMaintenance(db)).toEqual({ analyzed: true });
    expect((db.prepare('SELECT COUNT(*) AS n FROM sqlite_stat1').get() as any).n).toBeGreaterThan(0);
    expect(runPlannerMaintenance(db)).toEqual({ analyzed: false });
  });

  it('openDatabase gathers statistics on a database that has none', () => {
    const file = path.join(dir, 'second.db');
    const first = openDatabase(file);
    first.prepare("INSERT INTO channels (id, title, created_at) VALUES ('c', 'C', 0)").run();
    try { first.exec('DELETE FROM sqlite_stat1'); } catch {}
    first.close();
    const second = openDatabase(file);
    expect((second.prepare('SELECT COUNT(*) AS n FROM sqlite_stat1').get() as any).n).toBeGreaterThan(0);
    second.close();
  });

  it('repeats PRAGMA optimize every 6 hours until stopped', () => {
    vi.useFakeTimers();
    try {
      const fake = { pragma: vi.fn(), prepare: () => ({ get: () => ({ n: 1 }) }), exec: vi.fn(), open: true } as any;
      expect(PLANNER_MAINTENANCE_INTERVAL_MS).toBe(6 * 3600 * 1000);
      const stop = startPlannerMaintenance(() => fake);
      vi.advanceTimersByTime(PLANNER_MAINTENANCE_INTERVAL_MS * 2);
      expect(fake.pragma).toHaveBeenCalledTimes(2);
      expect(fake.pragma).toHaveBeenCalledWith('optimize');
      stop();
      vi.advanceTimersByTime(PLANNER_MAINTENANCE_INTERVAL_MS * 2);
      expect(fake.pragma).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
