import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type Database from 'better-sqlite3';
import trackHandler from '../../server/api/videos/track.post';
import continueHandler from '../../server/api/videos/continue.get';
import videoGet from '../../server/api/videos/[id].get';
import * as auth from '../../server/utils/auth';
import { assertInTmp, insertChannel, insertHiddenVideo, insertSession, insertUser, insertUserHistory, insertVideo, mockEvent, sessionCookie } from '../helpers/testDb';

// Server-side resume position: posted with the watch-time ticks, read back by
// the watch page and the "Continue watching" list (real schema).
const { openDatabase } = await vi.importActual<typeof import('../../server/utils/db')>('../../server/utils/db');

let dir: string;
let db: Database.Database;

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yk-resume-'));
  assertInTmp(dir);
  db = openDatabase(path.join(dir, 'youkeep.db'));
  (globalThis as any).getDb = () => db;
  Object.assign(globalThis as any, auth);
  for (const id of ['u1', 'u2']) {
    insertUser(db, { id, role: 'user' });
    insertSession(db, { id: `s-${id}`, userId: id });
  }
  insertChannel(db, { id: 'pub' });
  insertChannel(db, { id: 'ultra', visibility: 'ultra_private' });
  insertVideo(db, { id: 'v1', channelId: 'pub', duration: 1000 });
  insertVideo(db, { id: 'v2', channelId: 'pub', duration: 600 });
  insertVideo(db, { id: 'hidden', channelId: 'ultra', duration: 600 });
});
afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const track = (body: unknown, user = 'u1') => trackHandler(mockEvent(sessionCookie(`s-${user}`), { method: 'POST', body }));
const history = (videoId: string, user = 'u1') =>
  db.prepare('SELECT watch_time_seconds, position_seconds, duration_seconds, position_updated_at FROM user_history WHERE user_id = ? AND video_id = ?').get(user, videoId) as any;
const cont = (cookie?: string, query = '') => continueHandler(mockEvent(cookie, { path: `/api/videos/continue${query}` })) as Promise<any>;

describe('POST /api/videos/track with a position', () => {
  it('stores the position and duration with the watch time', async () => {
    const before = Date.now();
    await track({ videoId: 'v1', watchTimeSeconds: 15, positionSeconds: 312.7, durationSeconds: 1000.4 });
    const h = history('v1');
    expect(h).toMatchObject({ watch_time_seconds: 15, position_seconds: 312, duration_seconds: 1000 });
    expect(h.position_updated_at).toBeGreaterThanOrEqual(before);
    await track({ videoId: 'v1', watchTimeSeconds: 15, positionSeconds: 400 });
    expect(history('v1')).toMatchObject({ watch_time_seconds: 30, position_seconds: 400, duration_seconds: 1000 });
  });

  it('clamps the position to 0..86400 and ignores a duration that is not a positive number', async () => {
    await track({ videoId: 'v1', watchTimeSeconds: 5, positionSeconds: 1e9, durationSeconds: -3 });
    expect(history('v1')).toMatchObject({ position_seconds: 86400, duration_seconds: null });
    await track({ videoId: 'v1', watchTimeSeconds: 5, positionSeconds: -20 });
    expect(history('v1').position_seconds).toBe(0);
  });

  it('a position-only update (no new watch time) moves an existing row but never creates one', async () => {
    await track({ videoId: 'v2', watchTimeSeconds: 0, positionSeconds: 100 });
    expect(history('v2')).toBeUndefined();
    insertUserHistory(db, { userId: 'u1', videoId: 'v2', watchTimeSeconds: 50 });
    await track({ videoId: 'v2', watchTimeSeconds: 0, positionSeconds: 120, durationSeconds: 600 });
    expect(history('v2')).toMatchObject({ watch_time_seconds: 50, position_seconds: 120, duration_seconds: 600 });
  });

  it('rejects a position or duration that is not a finite number', async () => {
    for (const body of [
      { videoId: 'v1', watchTimeSeconds: 5, positionSeconds: '10' },
      { videoId: 'v1', watchTimeSeconds: 5, positionSeconds: Number.NaN },
      { videoId: 'v1', watchTimeSeconds: 5, positionSeconds: 10, durationSeconds: 'x' },
    ]) {
      await expect(track(body)).rejects.toMatchObject({ statusCode: 400 });
    }
  });

  it('still works without a position (older clients)', async () => {
    await track({ videoId: 'v1', watchTimeSeconds: 12 });
    expect(history('v1')).toMatchObject({ watch_time_seconds: 12, position_seconds: 0, position_updated_at: null });
  });
});

describe('GET /api/videos/continue', () => {
  const now = Date.now();
  function seed() {
    insertVideo(db, { id: 'short1', channelId: 'pub', duration: 50, isShort: true });
    insertVideo(db, { id: 'done', channelId: 'pub', duration: 1000 });
    insertVideo(db, { id: 'early', channelId: 'pub', duration: 1000 });
    insertVideo(db, { id: 'hid', channelId: 'pub', duration: 1000 });
    insertVideo(db, { id: 'nodur', channelId: 'pub', duration: null });
    insertUserHistory(db, { userId: 'u1', videoId: 'v1', watchTimeSeconds: 300, positionSeconds: 250, durationSeconds: 1000, positionUpdatedAt: now - 2000 });
    insertUserHistory(db, { userId: 'u1', videoId: 'v2', watchTimeSeconds: 300, positionSeconds: 300, durationSeconds: 600, positionUpdatedAt: now - 1000 });
    insertUserHistory(db, { userId: 'u1', videoId: 'short1', watchTimeSeconds: 20, positionSeconds: 20, durationSeconds: 50, positionUpdatedAt: now });
    insertUserHistory(db, { userId: 'u1', videoId: 'done', watchTimeSeconds: 990, positionSeconds: 960, durationSeconds: 1000, positionUpdatedAt: now });
    insertUserHistory(db, { userId: 'u1', videoId: 'early', watchTimeSeconds: 9, positionSeconds: 9, durationSeconds: 1000, positionUpdatedAt: now });
    insertUserHistory(db, { userId: 'u1', videoId: 'hid', watchTimeSeconds: 100, positionSeconds: 100, durationSeconds: 1000, positionUpdatedAt: now });
    insertUserHistory(db, { userId: 'u1', videoId: 'hidden', watchTimeSeconds: 100, positionSeconds: 100, durationSeconds: 600, positionUpdatedAt: now });
    insertUserHistory(db, { userId: 'u1', videoId: 'nodur', watchTimeSeconds: 100, positionSeconds: 100, durationSeconds: null, positionUpdatedAt: now - 5000 });
    insertUserHistory(db, { userId: 'u2', videoId: 'early', watchTimeSeconds: 100, positionSeconds: 500, durationSeconds: 1000, positionUpdatedAt: now });
    insertHiddenVideo(db, { userId: 'u1', videoId: 'hid' });
  }

  it('needs a signed-in user', async () => {
    await expect(cont()).rejects.toMatchObject({ statusCode: 401 });
  });

  it('lists the started long videos, newest position first, with progress', async () => {
    seed();
    const r = await cont(sessionCookie('s-u1'));
    expect(r.videos.map((v: any) => v.id)).toEqual(['v2', 'v1', 'nodur']);
    expect(r.videos[0]).toMatchObject({ positionSeconds: 300, durationSeconds: 600, progress: 0.5, title: 'Video v2', channel_title: 'Channel pub' });
    expect(r.videos[1].progress).toBeCloseTo(0.25);
    // Unknown duration: the stored video duration is unknown too, progress 0.
    expect(r.videos[2]).toMatchObject({ positionSeconds: 100, durationSeconds: null, progress: 0 });
  });

  it('honours the limit (1..50)', async () => {
    seed();
    expect((await cont(sessionCookie('s-u1'), '?limit=1')).videos.map((v: any) => v.id)).toEqual(['v2']);
    expect((await cont(sessionCookie('s-u1'), '?limit=abc')).videos).toHaveLength(3);
  });

  it('uses the video duration when the client sent none', async () => {
    insertUserHistory(db, { userId: 'u1', videoId: 'v1', watchTimeSeconds: 30, positionSeconds: 980, durationSeconds: null, positionUpdatedAt: now });
    insertUserHistory(db, { userId: 'u1', videoId: 'v2', watchTimeSeconds: 30, positionSeconds: 150, durationSeconds: null, positionUpdatedAt: now });
    const r = await cont(sessionCookie('s-u1'));
    // v1 is past 95 % of its 1000 s.
    expect(r.videos.map((v: any) => v.id)).toEqual(['v2']);
    expect(r.videos[0]).toMatchObject({ durationSeconds: 600, progress: 0.25 });
  });
});

describe('GET /api/videos/:id gives the signed-in viewer their resume position', () => {
  it('returns the stored position, and none for a guest', async () => {
    insertUserHistory(db, { userId: 'u1', videoId: 'v1', watchTimeSeconds: 30, positionSeconds: 250, durationSeconds: 1000, positionUpdatedAt: Date.now() });
    const ev = (cookie?: string) => mockEvent(cookie, { path: '/api/videos/v1', params: { id: 'v1' } });
    expect(((await videoGet(ev(sessionCookie('s-u1')))) as any).resume).toEqual({ positionSeconds: 250 });
    expect(((await videoGet(ev(sessionCookie('s-u2')))) as any).resume).toEqual({ positionSeconds: null });
    expect(((await videoGet(ev())) as any).resume).toEqual({ positionSeconds: null });
  });
});
