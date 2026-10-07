import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import progressHandler from '../../server/api/podcasts/episodes/[id]/progress.put';
import playedHandler from '../../server/api/podcasts/episodes/[id]/played.put';
import statusHandler from '../../server/api/podcasts/episodes/progress/status.post';
import continueHandler from '../../server/api/podcasts/continue.get';
import subscribedHandler from '../../server/api/podcasts/subscribed-episodes.get';
import followHandler from '../../server/api/podcasts/shows/[id]/follow.put';
import {
  createTestDb, insertUser, insertSession, insertPodcastShow, insertPodcastEpisode,
  mockEvent, sessionCookie,
} from '../helpers/testDb';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
  insertPodcastShow(db, { id: 'pub', visibility: 'public' });
  insertPodcastShow(db, { id: 'priv', visibility: 'private' });
  insertPodcastShow(db, { id: 'ultra', visibility: 'ultra_private' });
  insertPodcastEpisode(db, { id: 'e1', showId: 'pub', localFilePath: '/p/e1' });
  insertPodcastEpisode(db, { id: 'e2', showId: 'pub', localFilePath: '/p/e2' });
  insertPodcastEpisode(db, { id: 'p1', showId: 'priv', localFilePath: '/p/p1' });
  insertPodcastEpisode(db, { id: 'h1', showId: 'ultra', localFilePath: '/p/h1' });
  db.prepare("UPDATE podcast_episodes SET duration = 1000").run();
});

function login(userId: string, role: 'admin' | 'user' = 'user') {
  insertUser(db, { id: userId, role });
  insertSession(db, { id: `sess-${userId}`, userId });
  return sessionCookie(`sess-${userId}`);
}
const put = (id: string, body: unknown, cookie?: string) =>
  progressHandler(mockEvent(cookie, { method: 'PUT', params: { id }, body })) as Promise<any>;
const played = (id: string, body: unknown, cookie?: string) =>
  playedHandler(mockEvent(cookie, { method: 'PUT', params: { id }, body })) as Promise<any>;
const status = (ids: unknown, cookie?: string) =>
  statusHandler(mockEvent(cookie, { method: 'POST', body: { ids } })) as Promise<any>;
const cont = (cookie?: string, qs = '') =>
  continueHandler(mockEvent(cookie, { path: `/api/podcasts/continue${qs}` })) as Promise<any>;
const subscribed = (cookie?: string, qs = '') =>
  subscribedHandler(mockEvent(cookie, { path: `/api/podcasts/subscribed-episodes${qs}` })) as Promise<any>;
const follow = (id: string, cookie: string) => followHandler(mockEvent(cookie, { method: 'PUT', params: { id } }));
const row = (userId: string, episodeId: string) =>
  db.prepare('SELECT position_seconds, duration_seconds, completed FROM podcast_episode_progress WHERE user_id = ? AND episode_id = ?').get(userId, episodeId);
const touch = (userId: string, episodeId: string, updatedAt: number) =>
  db.prepare('UPDATE podcast_episode_progress SET updated_at = ? WHERE user_id = ? AND episode_id = ?').run(updatedAt, userId, episodeId);

describe('podcast progress API', () => {
  it('rejects guests on every endpoint with 401', async () => {
    await expect(put('e1', { positionSeconds: 5 })).rejects.toMatchObject({ statusCode: 401 });
    await expect(played('e1', { played: true })).rejects.toMatchObject({ statusCode: 401 });
    await expect(status(['e1'])).rejects.toMatchObject({ statusCode: 401 });
    await expect(cont()).rejects.toMatchObject({ statusCode: 401 });
    await expect(subscribed()).rejects.toMatchObject({ statusCode: 401 });
  });

  it('upserts a clamped, whole-second position and returns it', async () => {
    const c = login('u1');
    const first = await put('e1', { positionSeconds: 61.8, durationSeconds: 1200.4 }, c);
    expect(first).toMatchObject({ positionSeconds: 61, durationSeconds: 1200, completed: false });
    expect(typeof first.updatedAt).toBe('number');
    await put('e1', { positionSeconds: 5000, durationSeconds: 1200 }, c);
    expect(row('u1', 'e1')).toEqual({ position_seconds: 1200, duration_seconds: 1200, completed: 1 });
    await put('e1', { positionSeconds: -3 }, c);
    expect(row('u1', 'e1')).toMatchObject({ position_seconds: 0, duration_seconds: 1200 });
    expect(db.prepare('SELECT COUNT(*) as n FROM podcast_episode_progress').get()).toEqual({ n: 1 });
  });

  it('validates the body and the episode id (404 for hidden, missing and invalid ids)', async () => {
    const c = login('u1');
    await expect(put('e1', { positionSeconds: 'x' }, c)).rejects.toMatchObject({ statusCode: 400 });
    await expect(put('e1', { positionSeconds: 4, completed: 'yes' }, c)).rejects.toMatchObject({ statusCode: 400 });
    await expect(put('h1', { positionSeconds: 4 }, c)).rejects.toMatchObject({ statusCode: 404 });
    await expect(put('nope', { positionSeconds: 4 }, c)).rejects.toMatchObject({ statusCode: 404 });
    await expect(put('bad/id', { positionSeconds: 4 }, c)).rejects.toMatchObject({ statusCode: 404 });
    await expect(played('h1', { played: true }, c)).rejects.toMatchObject({ statusCode: 404 });
    await expect(played('e1', { played: 'yes' }, c)).rejects.toMatchObject({ statusCode: 400 });
    expect(await put('p1', { positionSeconds: 4 }, c)).toMatchObject({ positionSeconds: 4 });
    const admin = login('boss', 'admin');
    expect(await put('h1', { positionSeconds: 4 }, admin)).toMatchObject({ positionSeconds: 4 });
  });

  it('marks an episode completed within 10 seconds of the end, using the stored or RSS duration when none is sent', async () => {
    const c = login('u1');
    expect((await put('e1', { positionSeconds: 989 }, c)).completed).toBe(false); // RSS duration 1000
    expect((await put('e1', { positionSeconds: 990 }, c)).completed).toBe(true);
    expect(row('u1', 'e1')).toMatchObject({ duration_seconds: 1000 });
    await put('e2', { positionSeconds: 100, durationSeconds: 2000 }, c);
    expect((await put('e2', { positionSeconds: 995 }, c)).completed).toBe(false); // stored 2000 wins over RSS 1000
    expect((await put('e2', { positionSeconds: 1990 }, c)).completed).toBe(true);
  });

  it('keeps a completed episode completed on a lower position unless completed:false is sent', async () => {
    const c = login('u1');
    await put('e1', { positionSeconds: 1000, durationSeconds: 1000 }, c);
    expect((await put('e1', { positionSeconds: 20 }, c))).toMatchObject({ positionSeconds: 20, completed: true });
    expect((await put('e1', { positionSeconds: 30, completed: false }, c))).toMatchObject({ positionSeconds: 30, completed: false });
    expect((await put('e1', { positionSeconds: 40, completed: true }, c))).toMatchObject({ completed: true });
  });

  it('marks played (position at the end) and unplayed (row removed)', async () => {
    const c = login('u1');
    await put('e1', { positionSeconds: 300 }, c);
    expect(await played('e1', { played: true }, c)).toMatchObject({ played: true, progress: { positionSeconds: 1000, completed: true } });
    expect(row('u1', 'e1')).toEqual({ position_seconds: 1000, duration_seconds: 1000, completed: 1 });
    expect(await played('e1', { played: false }, c)).toEqual({ played: false, progress: null });
    expect(row('u1', 'e1')).toBeUndefined();
    expect(await played('e1', { played: false }, c)).toEqual({ played: false, progress: null });
    db.prepare("UPDATE podcast_episodes SET duration = NULL WHERE id = 'e2'").run();
    await played('e2', { played: true }, c);
    expect(row('u1', 'e2')).toEqual({ position_seconds: 0, duration_seconds: null, completed: 1 });
  });

  it('answers progress for a batch of visible episodes only, and keeps progress private', async () => {
    const a = login('u1');
    const b = login('u2');
    await put('e1', { positionSeconds: 30 }, a);
    await put('p1', { positionSeconds: 40 }, a);
    await put('e2', { positionSeconds: 50 }, b);
    const res = await status(['e1', 'e2', 'p1', 'nope'], a);
    expect(Object.keys(res.progress).sort()).toEqual(['e1', 'p1']);
    expect(res.progress.e1).toMatchObject({ positionSeconds: 30, durationSeconds: 1000, completed: false });
    db.prepare("UPDATE podcast_shows SET visibility = 'ultra_private' WHERE id = 'priv'").run();
    expect(Object.keys((await status(['e1', 'p1'], a)).progress)).toEqual(['e1']);
    await expect(status(['bad id'], a)).rejects.toMatchObject({ statusCode: 400 });
    await expect(status(Array.from({ length: 201 }, (_, i) => `x${i}`), a)).rejects.toMatchObject({ statusCode: 400 });
  });

  it('lists in-progress episodes past 5 seconds, most recently updated first, visible and downloaded only', async () => {
    const c = login('u1');
    insertPodcastEpisode(db, { id: 'pend', showId: 'pub', downloadStatus: 'pending' });
    insertPodcastEpisode(db, { id: 'short', showId: 'pub', localFilePath: '/p/s' });
    insertPodcastEpisode(db, { id: 'done', showId: 'pub', localFilePath: '/p/d' });
    await put('e1', { positionSeconds: 100 }, c);
    await put('e2', { positionSeconds: 200 }, c);
    await put('p1', { positionSeconds: 300 }, c);
    await put('pend', { positionSeconds: 300 }, c);
    await put('short', { positionSeconds: 5 }, c);
    await put('done', { positionSeconds: 1000, durationSeconds: 1000 }, c);
    touch('u1', 'e1', 3000);
    touch('u1', 'e2', 1000);
    touch('u1', 'p1', 2000);
    const other = login('u2');
    await put('e2', { positionSeconds: 400 }, other);
    const r = await cont(c);
    expect(r.items.map((e: any) => e.id)).toEqual(['e1', 'p1', 'e2']);
    expect(r.items[0]).toMatchObject({
      id: 'e1', show_id: 'pub', show_title: 'Show pub', local_file_path: '/p/e1',
      progress: { positionSeconds: 100, durationSeconds: 1000, completed: false, updatedAt: 3000 },
    });
    expect((await cont(c, '?limit=1')).items).toHaveLength(1);
    db.prepare("UPDATE podcast_shows SET visibility = 'ultra_private' WHERE id = 'priv'").run();
    expect((await cont(c)).items.map((e: any) => e.id)).toEqual(['e1', 'e2']);
  });

  it('lists the latest completed episodes of followed visible shows with progress, paged', async () => {
    const c = login('u1');
    insertPodcastShow(db, { id: 'other' });
    insertPodcastEpisode(db, { id: 'o1', showId: 'other', localFilePath: '/p/o1', pubTs: 9000 });
    insertPodcastEpisode(db, { id: 'pend', showId: 'pub', downloadStatus: 'pending', pubTs: 9000 });
    db.prepare("UPDATE podcast_episodes SET pub_ts = 100 WHERE id = 'e1'").run();
    db.prepare("UPDATE podcast_episodes SET pub_ts = NULL, created_at = 300 WHERE id = 'e2'").run();
    db.prepare("UPDATE podcast_episodes SET pub_ts = 200 WHERE id = 'p1'").run();
    await follow('pub', c);
    await follow('priv', c);
    await put('e1', { positionSeconds: 42 }, c);
    const other = login('u2');
    await put('e2', { positionSeconds: 77 }, other); // someone else's progress never shows
    const r = await subscribed(c);
    expect(r.total).toBe(3);
    expect(r.items.map((e: any) => e.id)).toEqual(['e2', 'p1', 'e1']);
    expect(r.items[2].progress).toMatchObject({ positionSeconds: 42 });
    expect(r.items[0].progress).toBeNull();
    const page = await subscribed(c, '?limit=1&offset=1');
    expect(page.items.map((e: any) => e.id)).toEqual(['p1']);
    db.prepare("UPDATE podcast_shows SET visibility = 'ultra_private' WHERE id = 'priv'").run();
    expect((await subscribed(c)).items.map((e: any) => e.id)).toEqual(['e2', 'e1']);
    expect((await subscribed(other)).total).toBe(0);
  });

  it('drops progress when the episode or the user is deleted', async () => {
    const a = login('u1');
    const b = login('u2');
    await put('e1', { positionSeconds: 10 }, a);
    await put('e2', { positionSeconds: 10 }, a);
    await put('e1', { positionSeconds: 10 }, b);
    db.prepare("DELETE FROM podcast_episodes WHERE id = 'e2'").run();
    db.prepare("DELETE FROM users WHERE id = 'u2'").run();
    expect(db.prepare('SELECT user_id, episode_id FROM podcast_episode_progress').all()).toEqual([{ user_id: 'u1', episode_id: 'e1' }]);
  });
});
