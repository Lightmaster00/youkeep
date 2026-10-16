import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type Database from 'better-sqlite3';
import * as auth from '../../server/utils/auth';
import { assertInTmp, mockEvent, sessionCookie } from '../helpers/testDb';
import optionsHandler from '../../server/api/admin/channels/[id]/options.put';
import videoIngest from '../../server/api/admin/downloader/ingest.post';
import musicIngest from '../../server/api/admin/music/ingest.post';
import podcastIngest from '../../server/api/admin/podcasts/ingest.post';
import videoSchedule from '../../server/api/admin/downloader/schedule.post';
import musicSchedule from '../../server/api/admin/music/schedule.post';
import podcastSchedule from '../../server/api/admin/podcasts/schedule.post';
import retryFailed from '../../server/api/admin/downloader/retry-failed.post';
import * as downloader from '../../server/utils/downloader';
import * as podcastDownloader from '../../server/utils/podcastDownloader';

const { openDatabase } = await vi.importActual<typeof import('../../server/utils/db')>('../../server/utils/db');

let dir: string;
let db: Database.Database;
const ADMIN = sessionCookie('sess-admin');

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yk-sweep-'));
  assertInTmp(dir);
  db = openDatabase(path.join(dir, 'youkeep.db'));
  (globalThis as any).getDb = () => db;
  Object.assign(globalThis as any, auth);
  (globalThis as any).initScheduler = () => {};
  (globalThis as any).startQueueWorker = () => {};
  db.prepare("INSERT INTO users (id, username, password_hash, role, created_at) VALUES ('admin', 'admin', 'x', 'admin', 0)").run();
  db.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES ('sess-admin', 'admin', ?)").run(Date.now() + 3_600_000);
  db.prepare(`INSERT INTO channels (id, title, download_videos, download_shorts, download_lives, date_after, custom_save_path, created_at)
    VALUES ('c1', 'C', 1, 1, 1, '20200101', '/srv/media', 0)`).run();
});
afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const put = (body: unknown) => optionsHandler(mockEvent(ADMIN, { method: 'PUT', params: { id: 'c1' }, body }));
const post = (handler: any, body: unknown) => handler(mockEvent(ADMIN, { method: 'POST', body }));
const status = async (p: Promise<any>) => { try { await p; return 200; } catch (e: any) { return e?.statusCode ?? 500; } };
const channel = () => db.prepare('SELECT download_videos, download_shorts, download_lives, date_after, custom_save_path FROM channels WHERE id = ?').get('c1');

describe('channel options PUT is a partial update', () => {
  it('fields that are not sent keep their value', async () => {
    await put({ downloadShorts: false });
    expect(channel()).toEqual({ download_videos: 1, download_shorts: 0, download_lives: 1, date_after: '20200101', custom_save_path: '/srv/media' });
  });

  it('an invalid date is a 400 and changes nothing; null clears it', async () => {
    expect(await status(put({ dateAfter: '31/12/2020' }))).toBe(400);
    expect(await status(put({ downloadVideos: 'yes' }))).toBe(400);
    expect(channel()).toMatchObject({ date_after: '20200101', download_videos: 1 });
    await put({ dateAfter: '2021-02-03' });
    expect(channel()).toMatchObject({ date_after: '20210203' });
    await put({ dateAfter: null });
    expect(channel()).toMatchObject({ date_after: null });
  });
});

describe('ingest routes validate sync_status and visibility', () => {
  it.each([
    ['video', videoIngest, 'url'],
    ['music', musicIngest, 'url'],
    ['podcast', podcastIngest, 'feedUrl'],
  ])('%s', async (_name, handler, urlKey) => {
    expect(await status(post(handler, { [urlKey]: 'https://example.invalid/x', sync_status: 'ok' }))).toBe(400);
    expect(await status(post(handler, { [urlKey]: 'https://example.invalid/x', visibility: 'everyone' }))).toBe(400);
    expect(await status(post(handler, { [urlKey]: ['https://example.invalid/x'] }))).toBe(400);
    expect(await status(post(handler, null))).toBe(400);
  });

  it('an upstream failure is a 502 with a generic message', async () => {
    const ingest = vi.spyOn(downloader, 'ingestUrl').mockResolvedValue({ success: false, message: 'yt-dlp metadata fetch failed: ERROR /srv/secret', count: 0 } as any);
    await expect(post(videoIngest, { url: 'https://www.youtube.com/@x' })).rejects.toMatchObject({
      statusCode: 502, statusMessage: expect.not.stringContaining('/srv'),
    });
    expect(ingest).toHaveBeenCalledTimes(1);
    const feed = vi.spyOn(podcastDownloader, 'ingestPodcastFeed').mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));
    await expect(post(podcastIngest, { feedUrl: 'https://example.invalid/feed' })).rejects.toMatchObject({ statusCode: 502 });
    expect(feed).toHaveBeenCalledTimes(1);
  });
});

describe('schedule routes', () => {
  it.each([['video', videoSchedule], ['music', musicSchedule], ['podcast', podcastSchedule]])('%s: an invalid cron is a 400 without parser internals', async (_name, handler) => {
    const err: any = await post(handler, { enabled: true, schedule: 'not a cron' }).catch((e: any) => e);
    expect(err.statusCode).toBe(400);
    expect(err.statusMessage).toBe('Invalid cron expression.');
    expect(await status(post(handler, { enabled: 'yes', schedule: '0 3 * * *' }))).toBe(400);
    expect(await status(post(handler, { enabled: true, schedule: 42 }))).toBe(400);
  });
});

describe('retry-failed', () => {
  it('accepts no body, refuses an id that is not a string', async () => {
    expect(await status(post(retryFailed, undefined))).toBe(200);
    expect(await status(post(retryFailed, { videoId: ['a', 'b'] }))).toBe(400);
    expect(await status(post(retryFailed, [1]))).toBe(400);
  });
});
