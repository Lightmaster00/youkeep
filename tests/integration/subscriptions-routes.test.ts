import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import feedHandler from '../../server/api/subscriptions/feed.get';
import channelsHandler from '../../server/api/subscriptions/channels.get';
import seenHandler from '../../server/api/subscriptions/seen.post';
import markAllHandler from '../../server/api/subscriptions/mark-all-seen.post';
import {
  createTestDb, grantChannelAccess, insertChannel, insertHiddenVideo, insertSeenVideo, insertSession, insertSubscription,
  insertUser, insertUserHistory, insertVideo, mockEvent, sessionCookie,
} from '../helpers/testDb';

let db: Database.Database;
const DAY = 86_400_000;
const now = Date.now();

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
  for (const id of ['u1', 'u2']) {
    insertUser(db, { id, role: 'user' });
    insertSession(db, { id: `s-${id}`, userId: id });
  }
  insertChannel(db, { id: 'a', title: 'Alpha' });
  insertChannel(db, { id: 'b', title: 'Beta' });
  insertChannel(db, { id: 'notFollowed' });
  insertChannel(db, { id: 'ultra', title: 'Ultra', visibility: 'ultra_private' });
  insertVideo(db, { id: 'a1', channelId: 'a', uploadDate: '20261020', viewCount: 10, duration: 100, categories: ['Gaming'], createdAt: now - DAY });
  insertVideo(db, { id: 'a2', channelId: 'a', uploadDate: '20261010', viewCount: 500, duration: 100, categories: ['Gaming'], createdAt: now - 20 * DAY });
  insertVideo(db, { id: 'a3', channelId: 'a', uploadDate: '20261021', duration: 30, isShort: true, createdAt: now - DAY });
  insertVideo(db, { id: 'b1', channelId: 'b', uploadDate: '20261015', viewCount: 50, duration: 200, categories: ['Music'], createdAt: now - 2 * DAY });
  insertVideo(db, { id: 'b2', channelId: 'b', uploadDate: '20261001', viewCount: 5, duration: 200, categories: ['Music'], createdAt: now - 3 * DAY });
  insertVideo(db, { id: 'bPending', channelId: 'b', downloadStatus: 'pending', createdAt: now });
  insertVideo(db, { id: 'n1', channelId: 'notFollowed', uploadDate: '20261022', createdAt: now });
  insertVideo(db, { id: 'u1v', channelId: 'ultra', uploadDate: '20261022', createdAt: now });
  for (const c of ['a', 'b', 'ultra']) insertSubscription(db, { userId: 'u1', channelId: c });
});

const get = (handler: any, query = '', user = 'u1') => handler(mockEvent(sessionCookie(`s-${user}`), { path: `/api/subscriptions/x${query}` }));
const post = (handler: any, body: any = {}, user = 'u1') => handler(mockEvent(sessionCookie(`s-${user}`), { method: 'POST', body }));
const ids = (r: any) => r.videos.map((v: any) => v.id);
const seenRows = (user = 'u1') => (db.prepare('SELECT video_id FROM user_seen_videos WHERE user_id = ? ORDER BY video_id').all(user) as any[]).map((r) => r.video_id);

describe('subscriptions routes need a signed-in user', () => {
  it('answers 401 to guests', async () => {
    for (const h of [feedHandler, channelsHandler]) await expect(h(mockEvent(undefined, { path: '/api/subscriptions/x' }))).rejects.toMatchObject({ statusCode: 401 });
    for (const h of [seenHandler, markAllHandler]) await expect(h(mockEvent(undefined, { method: 'POST', body: { videoId: 'a1' } }))).rejects.toMatchObject({ statusCode: 401 });
  });
});

describe('GET /api/subscriptions/feed', () => {
  it('lists completed long videos of followed, visible channels, newest first, with isNew and watchedPercent', async () => {
    insertUserHistory(db, { userId: 'u1', videoId: 'b1', watchTimeSeconds: 50, positionSeconds: 100, durationSeconds: 200 });
    insertSeenVideo(db, { userId: 'u1', videoId: 'a2' });
    const r = await get(feedHandler);
    expect(ids(r)).toEqual(['a1', 'b1', 'a2', 'b2']);
    expect(r.total).toBe(4);
    const byId = Object.fromEntries(r.videos.map((v: any) => [v.id, v]));
    expect(byId.a1).toMatchObject({ isNew: true, watchedPercent: 0, channel_title: 'Alpha' });
    expect(byId.b1).toMatchObject({ isNew: false, watchedPercent: 50 });
    expect(byId.a2).toMatchObject({ isNew: false, watchedPercent: 0 });
  });

  it('a granted ultra-private channel shows up; hidden videos never do', async () => {
    grantChannelAccess(db, 'u1', 'ultra');
    insertHiddenVideo(db, { userId: 'u1', videoId: 'a1' });
    expect(ids(await get(feedHandler))).toEqual(['u1v', 'b1', 'a2', 'b2']);
  });

  it('filters by channel, category and type, and sorts', async () => {
    expect(ids(await get(feedHandler, '?channelId=b'))).toEqual(['b1', 'b2']);
    expect(ids(await get(feedHandler, '?channelId=notFollowed'))).toEqual([]);
    expect(ids(await get(feedHandler, '?category=Gaming'))).toEqual(['a1', 'a2']);
    expect(ids(await get(feedHandler, '?type=short'))).toEqual(['a3']);
    expect(ids(await get(feedHandler, '?sort=popular'))).toEqual(['a2', 'b1', 'a1', 'b2']);
    expect(ids(await get(feedHandler, '?sort=oldest'))).toEqual(['b2', 'a2', 'b1', 'a1']);
  });

  it('pages, and rejects invalid parameters', async () => {
    const p2 = await get(feedHandler, '?limit=3&page=2');
    expect(ids(p2)).toEqual(['b2']);
    expect(p2.total).toBe(4);
    await expect(get(feedHandler, '?sort=random')).rejects.toMatchObject({ statusCode: 400 });
    await expect(get(feedHandler, '?type=music')).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('GET /api/subscriptions/channels', () => {
  it('lists the followed channels the viewer may see with counts, last upload and categories', async () => {
    insertUserHistory(db, { userId: 'u1', videoId: 'b1', watchTimeSeconds: 10 });
    const r = await get(channelsHandler);
    expect(r.channels.map((c: any) => c.id)).toEqual(['a', 'b']);
    const a = r.channels[0];
    // a1 and a3 were added in the last 14 days and are unseen; a2 is older.
    expect(a).toMatchObject({ title: 'Alpha', videoCount: 3, newCount: 2, lastUploadDate: '20261021', categories: ['Gaming'] });
    expect(a.lastUploadAt).toBe(Date.UTC(2026, 9, 21));
    expect(r.channels[1]).toMatchObject({ videoCount: 2, newCount: 1, categories: ['Music'] });
  });

  it('includes a granted ultra-private channel', async () => {
    grantChannelAccess(db, 'u1', 'ultra');
    expect((await get(channelsHandler)).channels.map((c: any) => c.id)).toEqual(['ultra', 'a', 'b']);
  });
});

describe('POST /api/subscriptions/seen and mark-all-seen', () => {
  it('marks one or several videos seen, idempotently, without a history row', async () => {
    expect(await post(seenHandler, { videoId: 'a1' })).toEqual({ marked: 1 });
    expect(await post(seenHandler, { videoId: 'a1' })).toEqual({ marked: 0 });
    expect(await post(seenHandler, { videoIds: ['a2', 'b1', 'nope', 'u1v'] })).toEqual({ marked: 2 });
    expect(seenRows()).toEqual(['a1', 'a2', 'b1']);
    expect(db.prepare('SELECT COUNT(*) AS n FROM user_history').get()).toEqual({ n: 0 });
    expect((await get(feedHandler)).videos.find((v: any) => v.id === 'a1').isNew).toBe(false);
  });

  it('rejects a bad body', async () => {
    for (const body of [{}, { videoId: 5 }, { videoIds: 'a1' }, { videoIds: Array.from({ length: 201 }, (_, i) => `v${i}`) }]) {
      await expect(post(seenHandler, body)).rejects.toMatchObject({ statusCode: 400 });
    }
  });

  it('marks every unseen video of the followed channels', async () => {
    insertSeenVideo(db, { userId: 'u1', videoId: 'a1' });
    insertUserHistory(db, { userId: 'u1', videoId: 'b2', watchTimeSeconds: 5 });
    expect(await post(markAllHandler)).toEqual({ marked: 3 });
    expect(seenRows()).toEqual(['a1', 'a2', 'a3', 'b1']);
    expect(seenRows('u2')).toEqual([]);
    expect((await get(channelsHandler)).channels.every((c: any) => c.newCount === 0)).toBe(true);
  });
});
