import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import reportHandler from '../../server/api/videos/[id]/report.post';
import trackHandler from '../../server/api/videos/track.post';
import { resetAllRateLimits } from '../../server/utils/rateLimit';
import { createTestDb, insertUser, insertSession, insertChannel, insertVideo, mockEvent, sessionCookie } from '../helpers/testDb';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
  resetAllRateLimits();
  db.exec(`CREATE TABLE reports (id TEXT PRIMARY KEY, video_id TEXT NOT NULL, user_id TEXT, reason TEXT NOT NULL, created_at INTEGER NOT NULL,
    FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE)`);
  insertUser(db, { id: 'u1', role: 'user' });
  insertSession(db, { id: 's-u1', userId: 'u1' });
  insertChannel(db, { id: 'pub' });
  insertChannel(db, { id: 'ultra', visibility: 'ultra_private' });
  insertVideo(db, { id: 'v1', channelId: 'pub' });
  insertVideo(db, { id: 'v2', channelId: 'pub' });
  insertVideo(db, { id: 'hidden', channelId: 'ultra' });
});

const report = (videoId: string, body: unknown, cookie: string | undefined = sessionCookie('s-u1')) =>
  reportHandler(mockEvent(cookie, { method: 'POST', params: { id: videoId }, body }));
const track = (body: unknown, cookie: string | undefined = sessionCookie('s-u1')) =>
  trackHandler(mockEvent(cookie, { method: 'POST', body }));
const reportCount = () => (db.prepare('SELECT COUNT(*) AS n FROM reports').get() as any).n;
const watchTime = (videoId: string) => (db.prepare('SELECT watch_time_seconds AS s FROM user_history WHERE user_id = ? AND video_id = ?').get('u1', videoId) as any)?.s;

describe('POST /api/videos/:id/report', () => {
  it('requires a logged-in user', async () => {
    await expect(report('v1', { reason: 'spam' }, '')).rejects.toMatchObject({ statusCode: 401 });
    expect(reportCount()).toBe(0);
  });

  it('answers the same 404 for an unknown and an inaccessible video', async () => {
    const unknown: any = await report('nope', { reason: 'spam' }).catch((e) => e);
    const hidden: any = await report('hidden', { reason: 'spam' }).catch((e) => e);
    expect(unknown.statusCode).toBe(404);
    expect(hidden.statusCode).toBe(404);
    expect(hidden.statusMessage).toBe(unknown.statusMessage);
    expect(reportCount()).toBe(0);
  });

  it('stores one report per user and video', async () => {
    await expect(report('v1', { reason: 'spam' })).resolves.toMatchObject({ success: true });
    await expect(report('v1', { reason: 'spam again' })).resolves.toMatchObject({ success: true });
    expect(reportCount()).toBe(1);
  });

  it.each([null, [], { reason: '' }, { reason: '   ' }, { reason: 5 }, { reason: ['x'] }, { reason: 'x'.repeat(501) }])('rejects %j with a 400', async (body) => {
    await expect(report('v1', body)).rejects.toMatchObject({ statusCode: 400 });
  });

  it('is rate-limited per user (20 per hour)', async () => {
    for (let i = 0; i < 20; i++) {
      insertVideo(db, { id: `r${i}`, channelId: 'pub' });
      await report(`r${i}`, { reason: 'spam' });
    }
    await expect(report('v2', { reason: 'spam' })).rejects.toMatchObject({ statusCode: 429 });
    expect(reportCount()).toBe(20);
  });
});

describe('POST /api/videos/track', () => {
  it('requires a logged-in user', async () => {
    await expect(track({ videoId: 'v1', watchTimeSeconds: 10 }, '')).rejects.toMatchObject({ statusCode: 401 });
  });

  it('answers the same 404 for an unknown and an inaccessible video', async () => {
    const unknown: any = await track({ videoId: 'nope', watchTimeSeconds: 10 }).catch((e) => e);
    const hidden: any = await track({ videoId: 'hidden', watchTimeSeconds: 10 }).catch((e) => e);
    expect(unknown.statusCode).toBe(404);
    expect(hidden.statusCode).toBe(404);
    expect(hidden.statusMessage).toBe(unknown.statusMessage);
    expect(watchTime('hidden')).toBeUndefined();
  });

  it('clamps each call to an integer between 0 and 600 seconds', async () => {
    await track({ videoId: 'v1', watchTimeSeconds: 1e300 });
    expect(watchTime('v1')).toBe(600);
    await track({ videoId: 'v1', watchTimeSeconds: 12.9 });
    expect(watchTime('v1')).toBe(612);
  });

  it('ignores zero and negative amounts', async () => {
    await expect(track({ videoId: 'v1', watchTimeSeconds: -500 })).resolves.toMatchObject({ success: true });
    await expect(track({ videoId: 'v1', watchTimeSeconds: 0 })).resolves.toMatchObject({ success: true });
    expect(watchTime('v1')).toBeUndefined();
  });

  it.each([
    null, [], 'x',
    { videoId: 5, watchTimeSeconds: 10 },
    { videoId: ['v1'], watchTimeSeconds: 10 },
    { videoId: 'v1', watchTimeSeconds: '10' },
    { videoId: 'v1', watchTimeSeconds: null },
    { videoId: '', watchTimeSeconds: 10 },
  ])('rejects %j with a 400', async (body) => {
    await expect(track(body)).rejects.toMatchObject({ statusCode: 400 });
  });
});
