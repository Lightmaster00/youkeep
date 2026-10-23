import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import {
  cancelMetadataBackfill,
  getMetadataBackfillCounts,
  getMetadataBackfillStatus,
  isMetadataBackfillRunning,
  metadataBackfillDeps,
  METADATA_BACKFILL_INTERVAL_MS,
  METADATA_BACKFILL_TIMEOUT_MS,
  scheduleStartupMetadataBackfill,
  setMetadataBackfillEnabled,
  startMetadataBackfill,
} from '../../server/utils/metadataBackfill';
import { createTestDb, insertChannel, insertVideo } from '../helpers/testDb';

let db: Database.Database;
const realDeps = { ...metadataBackfillDeps };
let calls: Array<{ args: string[]; timeoutMs: number }>;
let sleeps: number[];
let answer: (videoId: string) => Promise<{ stdout: string; stderr: string; status: number | null }>;

const ok = (info: object) => Promise.resolve({ stdout: JSON.stringify(info), stderr: '', status: 0 });
const video = (id: string) => db.prepare('SELECT categories, tags, metadata_enriched_at FROM videos WHERE id = ?').get(id) as any;
const requestedIds = () => calls.map((c) => c.args[c.args.length - 1]!.split('v=')[1]);

async function waitIdle() {
  for (let i = 0; i < 1000; i++) {
    if (!isMetadataBackfillRunning()) return getMetadataBackfillStatus();
    await new Promise((r) => setTimeout(r, 1));
  }
  throw new Error('the backfill did not finish');
}

beforeEach(async () => {
  await waitIdle();
  db = createTestDb();
  (globalThis as any).getDb = () => db;
  insertChannel(db, { id: 'c1' });
  calls = [];
  sleeps = [];
  answer = () => ok({ categories: ['Gaming'], tags: ['Minecraft'] });
  metadataBackfillDeps.runYtdl = async (args, timeoutMs) => {
    calls.push({ args, timeoutMs });
    return answer(args[args.length - 1]!.split('v=')[1]!);
  };
  metadataBackfillDeps.sleep = async (ms) => { sleeps.push(ms); };
  metadataBackfillDeps.isShuttingDown = () => false;
  metadataBackfillDeps.blockedReason = () => null;
});

afterEach(async () => {
  cancelMetadataBackfill();
  await waitIdle();
  Object.assign(metadataBackfillDeps, realDeps);
  vi.useRealTimers();
});

describe('metadata backfill', () => {
  it('fills categories/tags of completed, not yet enriched videos, newest first', async () => {
    insertVideo(db, { id: 'oldVideo01', channelId: 'c1', createdAt: 1 });
    insertVideo(db, { id: 'newVideo01', channelId: 'c1', createdAt: 3 });
    insertVideo(db, { id: 'doneVideo1', channelId: 'c1', createdAt: 2, metadataEnrichedAt: 5, categories: ['Music'] });
    insertVideo(db, { id: 'pendingVid', channelId: 'c1', createdAt: 4, downloadStatus: 'pending' });
    expect(startMetadataBackfill(db)).toEqual({ started: true, alreadyRunning: false, pending: 2 });
    // Nothing runs inside the request that started it.
    expect(calls).toEqual([]);
    const s = await waitIdle();
    expect(s).toMatchObject({ state: 'done', processed: 2, enriched: 2, failed: 0 });
    expect(requestedIds()).toEqual(['newVideo01', 'oldVideo01']);
    expect(video('oldVideo01')).toMatchObject({ categories: '["Gaming"]', tags: '["minecraft"]' });
    expect(video('oldVideo01').metadata_enriched_at).toBeGreaterThan(0);
    expect(video('doneVideo1').categories).toBe('["Music"]');
    expect(getMetadataBackfillCounts(db)).toEqual({ total: 3, enriched: 3, pending: 0, enabled: true });
  });

  it('runs yt-dlp without downloading, for one video, with a 60 s limit', async () => {
    insertVideo(db, { id: 'abcdefghijk', channelId: 'c1' });
    startMetadataBackfill(db);
    await waitIdle();
    expect(calls).toEqual([{
      args: ['--skip-download', '--dump-json', '--no-playlist', '--', 'https://www.youtube.com/watch?v=abcdefghijk'],
      timeoutMs: 60_000,
    }]);
    expect(METADATA_BACKFILL_TIMEOUT_MS).toBe(60_000);
  });

  it('never passes an id that is not a YouTube id to yt-dlp, and marks it done', async () => {
    insertVideo(db, { id: '--exec=rm', channelId: 'c1' });
    startMetadataBackfill(db);
    await waitIdle();
    expect(calls).toEqual([]);
    expect(video('--exec=rm')).toMatchObject({ categories: '[]', tags: '[]' });
  });

  it('sends at most one request every 4 seconds', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    metadataBackfillDeps.sleep = realDeps.sleep;
    metadataBackfillDeps.now = () => Date.now();
    const at: number[] = [];
    metadataBackfillDeps.runYtdl = async (args) => {
      at.push(Date.now());
      calls.push({ args, timeoutMs: 0 });
      return ok({});
    };
    for (let i = 0; i < 3; i++) insertVideo(db, { id: `video00000${i}`, channelId: 'c1', createdAt: i });
    startMetadataBackfill(db);
    for (let i = 0; i < 20 && calls.length < 3; i++) await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toHaveLength(3);
    expect(at[1]! - at[0]!).toBeGreaterThanOrEqual(METADATA_BACKFILL_INTERVAL_MS);
    expect(at[2]! - at[1]!).toBeGreaterThanOrEqual(METADATA_BACKFILL_INTERVAL_MS);
    vi.useRealTimers();
    await waitIdle();
  });

  it('retries a failing video with a backoff, then marks it enriched with empty lists after 3 failures', async () => {
    insertVideo(db, { id: 'brokenVid1', channelId: 'c1', createdAt: 2 });
    insertVideo(db, { id: 'goodVideo1', channelId: 'c1', createdAt: 1 });
    answer = (id) => (id === 'brokenVid1' ? Promise.resolve({ stdout: '', stderr: 'ERROR: Video unavailable', status: 1 }) : ok({ categories: ['Music'] }));
    startMetadataBackfill(db);
    const s = await waitIdle();
    expect(requestedIds()).toEqual(['brokenVid1', 'brokenVid1', 'brokenVid1', 'goodVideo1']);
    expect(video('brokenVid1')).toMatchObject({ categories: '[]', tags: '[]' });
    expect(video('brokenVid1').metadata_enriched_at).not.toBeNull();
    expect(video('goodVideo1').categories).toBe('["Music"]');
    expect(s).toMatchObject({ state: 'done', processed: 2, enriched: 1, failed: 1, lastError: 'ERROR: Video unavailable' });
    // Growing waits after consecutive failures.
    const backoffs = sleeps.filter((ms) => ms > METADATA_BACKFILL_INTERVAL_MS);
    expect(backoffs.length).toBeGreaterThanOrEqual(2);
    expect(backoffs[1]!).toBeGreaterThan(backoffs[0]!);
  });

  it('a timeout or invalid JSON counts as a failure, not a crash', async () => {
    insertVideo(db, { id: 'timeoutVid', channelId: 'c1' });
    let n = 0;
    answer = () => (++n === 1 ? Promise.reject(new Error('Timed out after 60 s')) : Promise.resolve({ stdout: 'not json', stderr: '', status: 0 }));
    startMetadataBackfill(db);
    const s = await waitIdle();
    expect(s).toMatchObject({ state: 'done', failed: 1 });
    expect(calls).toHaveLength(3);
  });

  it('never sends a request while the server is shutting down', async () => {
    insertVideo(db, { id: 'someVideo1', channelId: 'c1' });
    metadataBackfillDeps.isShuttingDown = () => true;
    startMetadataBackfill(db);
    const s = await waitIdle();
    expect(calls).toEqual([]);
    expect(s.state).toBe('cancelled');
    expect(video('someVideo1').metadata_enriched_at).toBeNull();
  });

  it('waits while the downloader is blocked and resumes once it is not', async () => {
    insertVideo(db, { id: 'someVideo1', channelId: 'c1' });
    let blocked = true;
    metadataBackfillDeps.blockedReason = () => (blocked ? 'The downloader is paused.' : null);
    let waits = 0;
    metadataBackfillDeps.sleep = async () => {
      waits++;
      expect(getMetadataBackfillStatus().waitingReason).toBe(blocked ? 'The downloader is paused.' : null);
      if (waits === 3) blocked = false;
    };
    startMetadataBackfill(db);
    await waitIdle();
    expect(waits).toBeGreaterThanOrEqual(3);
    expect(requestedIds()).toEqual(['someVideo1']);
  });

  it('does not start when turned off, and turning it off stops a run', async () => {
    for (let i = 0; i < 5; i++) insertVideo(db, { id: `video00000${i}`, channelId: 'c1', createdAt: i });
    setMetadataBackfillEnabled(db, false);
    expect(startMetadataBackfill(db)).toEqual({ started: false, error: 'Video category lookup is turned off.' });
    setMetadataBackfillEnabled(db, true);
    answer = async () => {
      if (calls.length === 2) setMetadataBackfillEnabled(db, false);
      return ok({});
    };
    startMetadataBackfill(db);
    const s = await waitIdle();
    expect(s.state).toBe('cancelled');
    expect(calls.length).toBeLessThan(5);
    expect(getMetadataBackfillCounts(db).pending).toBeGreaterThan(0);
  });

  it('resumes where it stopped: a new run only does what is left', async () => {
    for (let i = 0; i < 3; i++) insertVideo(db, { id: `video00000${i}`, channelId: 'c1', createdAt: i });
    answer = async () => {
      if (calls.length === 1) cancelMetadataBackfill();
      return ok({});
    };
    startMetadataBackfill(db);
    await waitIdle();
    const first = requestedIds();
    calls = [];
    answer = () => ok({});
    startMetadataBackfill(db);
    await waitIdle();
    expect([...first, ...requestedIds()].sort()).toEqual(['video000000', 'video000001', 'video000002']);
  });

  it('schedules a startup run only when it is on and there is work', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    scheduleStartupMetadataBackfill(120_000);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(getMetadataBackfillStatus().state).not.toBe('running');
    insertVideo(db, { id: 'someVideo1', channelId: 'c1' });
    setMetadataBackfillEnabled(db, false);
    scheduleStartupMetadataBackfill(120_000);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(isMetadataBackfillRunning()).toBe(false);
    setMetadataBackfillEnabled(db, true);
    scheduleStartupMetadataBackfill(120_000);
    await vi.advanceTimersByTimeAsync(119_000);
    expect(isMetadataBackfillRunning()).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    vi.useRealTimers();
    await waitIdle();
    expect(requestedIds()).toEqual(['someVideo1']);
  });
});
