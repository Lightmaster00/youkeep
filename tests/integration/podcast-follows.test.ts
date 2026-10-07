import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import followHandler from '../../server/api/podcasts/shows/[id]/follow.put';
import unfollowHandler from '../../server/api/podcasts/shows/[id]/follow.delete';
import listHandler from '../../server/api/podcasts/follows/index.get';
import statusHandler from '../../server/api/podcasts/follows/status.post';
import {
  createTestDb, insertUser, insertSession, insertPodcastShow, insertPodcastEpisode,
  mockEvent, sessionCookie,
} from '../helpers/testDb';
import { MAX_FOLLOWED_SHOWS } from '../../shared/podcastProgress';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
  insertPodcastShow(db, { id: 'pub', visibility: 'public' });
  insertPodcastShow(db, { id: 'priv', visibility: 'private' });
  insertPodcastShow(db, { id: 'ultra', visibility: 'ultra_private' });
});

function login(userId: string, role: 'admin' | 'user' = 'user') {
  insertUser(db, { id: userId, role });
  insertSession(db, { id: `sess-${userId}`, userId });
  return sessionCookie(`sess-${userId}`);
}
const follow = (id: string, cookie?: string) =>
  followHandler(mockEvent(cookie, { method: 'PUT', params: { id } })) as Promise<any>;
const unfollow = (id: string, cookie?: string) =>
  unfollowHandler(mockEvent(cookie, { method: 'DELETE', params: { id } })) as Promise<any>;
const list = (cookie?: string) => listHandler(mockEvent(cookie)) as Promise<any[]>;
const status = (ids: unknown, cookie?: string) =>
  statusHandler(mockEvent(cookie, { method: 'POST', body: { ids } })) as Promise<any>;
const rows = () => db.prepare('SELECT user_id, show_id FROM podcast_show_follows ORDER BY user_id, show_id').all();
const setFollowDate = (userId: string, showId: string, ts: number) =>
  db.prepare('UPDATE podcast_show_follows SET created_at = ? WHERE user_id = ? AND show_id = ?').run(ts, userId, showId);

describe('podcast follows API', () => {
  it('rejects guests on every endpoint with 401', async () => {
    await expect(follow('pub')).rejects.toMatchObject({ statusCode: 401 });
    await expect(unfollow('pub')).rejects.toMatchObject({ statusCode: 401 });
    await expect(list()).rejects.toMatchObject({ statusCode: 401 });
    await expect(status(['pub'])).rejects.toMatchObject({ statusCode: 401 });
  });

  it('follows idempotently (keeping the first date) and unfollows idempotently', async () => {
    const c = login('u1');
    expect(await follow('pub', c)).toEqual({ followed: true });
    setFollowDate('u1', 'pub', 1234);
    expect(await follow('pub', c)).toEqual({ followed: true });
    expect(db.prepare('SELECT created_at FROM podcast_show_follows').get()).toEqual({ created_at: 1234 });
    expect(await unfollow('pub', c)).toEqual({ followed: false });
    expect(await unfollow('pub', c)).toEqual({ followed: false });
    expect(rows()).toEqual([]);
  });

  it('only lets a user follow shows they can see, answering 404 for hidden, missing and invalid ids', async () => {
    const c = login('u1');
    await expect(follow('ultra', c)).rejects.toMatchObject({ statusCode: 404 });
    await expect(follow('nope', c)).rejects.toMatchObject({ statusCode: 404 });
    await expect(follow('bad/id', c)).rejects.toMatchObject({ statusCode: 404 });
    await expect(unfollow('bad id', c)).rejects.toMatchObject({ statusCode: 404 });
    expect(await follow('priv', c)).toEqual({ followed: true });
    const admin = login('boss', 'admin');
    expect(await follow('ultra', admin)).toEqual({ followed: true });
  });

  it('caps the number of followed shows, without blocking a repeat follow', async () => {
    const c = login('u1');
    const insert = db.prepare('INSERT INTO podcast_show_follows (user_id, show_id, created_at) VALUES (?, ?, ?)');
    db.transaction(() => {
      for (let i = 0; i < MAX_FOLLOWED_SHOWS - 1; i++) {
        insertPodcastShow(db, { id: `bulk${i}` });
        insert.run('u1', `bulk${i}`, i);
      }
    })();
    await follow('pub', c); // the 500th
    await expect(follow('priv', c)).rejects.toMatchObject({ statusCode: 400 });
    expect(await follow('pub', c)).toEqual({ followed: true });
  });

  it('lists followed shows newest follow first with the shows-index fields, and keeps lists private', async () => {
    const a = login('u1');
    const b = login('u2');
    insertPodcastEpisode(db, { id: 'e1', showId: 'pub' });
    insertPodcastEpisode(db, { id: 'e2', showId: 'pub', downloadStatus: 'pending' });
    await follow('pub', a);
    await follow('priv', a);
    await follow('priv', b);
    setFollowDate('u1', 'pub', 100);
    setFollowDate('u1', 'priv', 200);
    const r = await list(a);
    expect(r.map((s) => s.id)).toEqual(['priv', 'pub']);
    expect(r[1]).toMatchObject({
      id: 'pub', title: 'Show pub', visibility: 'public', episode_count: 2, completed_episode_count: 1, followedAt: 100,
    });
    expect(Object.keys(r[1])).toEqual(expect.arrayContaining(['author', 'cover_url', 'newCount']));
    expect((await list(b)).map((s) => s.id)).toEqual(['priv']);
    await unfollow('pub', b); // someone else's follow is untouched
    expect(rows()).toHaveLength(3);
  });

  it('counts as new only completed episodes published after the follow date that the user has not started', async () => {
    const c = login('u1');
    await follow('pub', c);
    setFollowDate('u1', 'pub', 1000);
    insertPodcastEpisode(db, { id: 'old', showId: 'pub', pubTs: 900, createdAt: 5000 }); // published before the follow
    insertPodcastEpisode(db, { id: 'new1', showId: 'pub', pubTs: 1100 });
    insertPodcastEpisode(db, { id: 'new2', showId: 'pub', pubTs: null, createdAt: 1200 }); // no date: ingestion time
    insertPodcastEpisode(db, { id: 'pend', showId: 'pub', pubTs: 1300, downloadStatus: 'pending' });
    insertPodcastEpisode(db, { id: 'heard', showId: 'pub', pubTs: 1400 });
    insertPodcastEpisode(db, { id: 'played', showId: 'pub', pubTs: 1500 });
    insertPodcastEpisode(db, { id: 'atFollow', showId: 'pub', pubTs: 1000 }); // not strictly after
    db.prepare("INSERT INTO podcast_episode_progress (user_id, episode_id, position_seconds, completed, updated_at) VALUES ('u1', 'heard', 30, 0, 1)").run();
    db.prepare("INSERT INTO podcast_episode_progress (user_id, episode_id, position_seconds, completed, updated_at) VALUES ('u1', 'played', 0, 1, 1)").run();
    // Another user's progress does not hide the episode for u1.
    insertUser(db, { id: 'u2', role: 'user' });
    db.prepare("INSERT INTO podcast_episode_progress (user_id, episode_id, position_seconds, completed, updated_at) VALUES ('u2', 'new1', 30, 0, 1)").run();
    expect((await list(c))[0]!.newCount).toBe(2);
  });

  it('omits followed shows that became hidden, but keeps their rows', async () => {
    const c = login('u1');
    await follow('pub', c);
    await follow('priv', c);
    db.prepare("UPDATE podcast_shows SET visibility = 'ultra_private' WHERE id = 'priv'").run();
    expect((await list(c)).map((s) => s.id)).toEqual(['pub']);
    expect((await status(['pub', 'priv'], c)).followed).toEqual(['pub']);
    expect(rows()).toHaveLength(2);
  });

  it('answers the follow state of a batch, in the order asked, and validates the batch', async () => {
    const c = login('u1');
    await follow('pub', c);
    await follow('priv', c);
    expect(await status(['nope', 'priv', 'pub', 'priv'], c)).toEqual({ followed: ['priv', 'pub'] });
    expect(await status([], c)).toEqual({ followed: [] });
    await expect(status('pub', c)).rejects.toMatchObject({ statusCode: 400 });
    await expect(status(['ok', 'bad id'], c)).rejects.toMatchObject({ statusCode: 400 });
    await expect(status(Array.from({ length: 201 }, (_, i) => `s${i}`), c)).rejects.toMatchObject({ statusCode: 400 });
    expect((await status(Array.from({ length: 200 }, (_, i) => `s${i}`), c)).followed).toEqual([]);
  });

  it('drops follows when the show or the user is deleted', async () => {
    const c = login('u1');
    const d = login('u2');
    await follow('pub', c);
    await follow('priv', c);
    await follow('pub', d);
    db.prepare("DELETE FROM podcast_shows WHERE id = 'priv'").run();
    db.prepare("DELETE FROM users WHERE id = 'u2'").run();
    expect(rows()).toEqual([{ user_id: 'u1', show_id: 'pub' }]);
  });
});
