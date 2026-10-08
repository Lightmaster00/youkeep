import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import listHandler from '../../server/api/podcasts/history/index.get';
import clearHandler from '../../server/api/podcasts/history/index.delete';
import removeHandler from '../../server/api/podcasts/history/[episodeId].delete';
import {
  createTestDb, insertUser, insertSession, insertPodcastShow, insertPodcastEpisode,
  mockEvent, sessionCookie,
} from '../helpers/testDb';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
  insertPodcastShow(db, { id: 'pub', visibility: 'public', title: 'Public show' });
  insertPodcastShow(db, { id: 'priv', visibility: 'private' });
  insertPodcastShow(db, { id: 'ultra', visibility: 'ultra_private' });
  insertPodcastEpisode(db, { id: 'e1', showId: 'pub', localFilePath: '/p/e1' });
  insertPodcastEpisode(db, { id: 'e2', showId: 'pub', localFilePath: '/p/e2' });
  insertPodcastEpisode(db, { id: 'p1', showId: 'priv', localFilePath: '/p/p1' });
  insertPodcastEpisode(db, { id: 'h1', showId: 'ultra', localFilePath: '/p/h1' });
  db.prepare('UPDATE podcast_episodes SET duration = 1000').run();
});

function login(userId: string, role: 'admin' | 'user' = 'user') {
  insertUser(db, { id: userId, role });
  insertSession(db, { id: `sess-${userId}`, userId });
  return sessionCookie(`sess-${userId}`);
}
const progress = (userId: string, episodeId: string, updatedAt: number, position = 30, completed = 0) =>
  db.prepare(`
    INSERT INTO podcast_episode_progress (user_id, episode_id, position_seconds, duration_seconds, completed, updated_at)
    VALUES (?, ?, ?, 1000, ?, ?)
  `).run(userId, episodeId, position, completed, updatedAt);
const list = (cookie?: string, qs = '') =>
  listHandler(mockEvent(cookie, { path: `/api/podcasts/history${qs}` })) as Promise<any>;
const remove = (episodeId: string, cookie?: string) =>
  removeHandler(mockEvent(cookie, { method: 'DELETE', params: { episodeId } })) as Promise<any>;
const clear = (cookie?: string) => clearHandler(mockEvent(cookie, { method: 'DELETE' })) as Promise<any>;
const rows = () =>
  db.prepare('SELECT user_id, episode_id FROM podcast_episode_progress ORDER BY user_id, episode_id').all();

describe('podcast history API', () => {
  it('rejects guests on every endpoint with 401', async () => {
    await expect(list()).rejects.toMatchObject({ statusCode: 401 });
    await expect(remove('e1')).rejects.toMatchObject({ statusCode: 401 });
    await expect(clear()).rejects.toMatchObject({ statusCode: 401 });
  });

  it('lists started and played episodes, most recently updated first, each with its progress', async () => {
    const c = login('u1');
    progress('u1', 'e1', 100, 1000, 1);
    progress('u1', 'e2', 200, 42);
    const r = await list(c);
    expect(r.total).toBe(2);
    expect(r.items.map((e: any) => e.id)).toEqual(['e2', 'e1']);
    expect(r.items[0]).toMatchObject({
      id: 'e2', title: 'Episode e2', show_id: 'pub', show_title: 'Public show', local_file_path: '/p/e2',
      download_status: 'completed', duration: 1000,
      progress: { positionSeconds: 42, durationSeconds: 1000, completed: false, updatedAt: 200 },
    });
    expect(r.items[1].progress).toMatchObject({ completed: true, positionSeconds: 1000 });
  });

  it('breaks ties on the same update time by episode id, descending', async () => {
    const c = login('u1');
    progress('u1', 'e1', 500);
    progress('u1', 'e2', 500);
    expect((await list(c)).items.map((e: any) => e.id)).toEqual(['e2', 'e1']);
  });

  it('pages with limit/offset, caps the size at 100 and clamps bad values', async () => {
    const c = login('u1');
    for (let i = 0; i < 105; i++) {
      insertPodcastEpisode(db, { id: `x${String(i).padStart(3, '0')}`, showId: 'pub', localFilePath: '/p/x' });
      progress('u1', `x${String(i).padStart(3, '0')}`, 1000 + i);
    }
    const page = await list(c, '?limit=2&offset=2');
    expect(page.items.map((e: any) => e.id)).toEqual(['x102', 'x101']);
    expect(page.total).toBe(105);
    expect((await list(c)).items).toHaveLength(30);
    expect((await list(c, '?limit=500')).items).toHaveLength(100);
    expect((await list(c, '?limit=abc&offset=-4')).items[0].id).toBe('x104');
  });

  it('only returns episodes of shows the caller can see, keeping the hidden rows', async () => {
    const c = login('u1');
    progress('u1', 'e1', 1);
    progress('u1', 'p1', 2);
    progress('u1', 'h1', 3);
    const r = await list(c);
    expect(r.items.map((e: any) => e.id)).toEqual(['p1', 'e1']);
    expect(r.total).toBe(2);
    expect(rows()).toHaveLength(3);
    db.prepare("UPDATE podcast_shows SET visibility = 'ultra_private' WHERE id = 'priv'").run();
    expect((await list(c)).items.map((e: any) => e.id)).toEqual(['e1']);

    const admin = login('boss', 'admin');
    progress('boss', 'h1', 9);
    expect((await list(admin)).items.map((e: any) => e.id)).toEqual(['h1']);
  });

  it('keeps each user\'s history private', async () => {
    const a = login('u1');
    const b = login('u2');
    progress('u1', 'e1', 1, 11);
    progress('u2', 'e1', 2, 22);
    progress('u2', 'e2', 3);
    const ra = await list(a);
    expect(ra.items.map((e: any) => [e.id, e.progress.positionSeconds])).toEqual([['e1', 11]]);
    expect(ra.total).toBe(1);
    expect((await list(b)).items.map((e: any) => e.id)).toEqual(['e2', 'e1']);
  });

  it('removes one episode (its progress row) only for the caller, idempotently', async () => {
    const a = login('u1');
    login('u2');
    progress('u1', 'e1', 1);
    progress('u1', 'e2', 2);
    progress('u2', 'e1', 3);
    expect(await remove('e1', a)).toEqual({ removed: 1 });
    expect(await remove('e1', a)).toEqual({ removed: 0 });
    expect(rows()).toEqual([{ user_id: 'u1', episode_id: 'e2' }, { user_id: 'u2', episode_id: 'e1' }]);
  });

  it('can remove an episode that has since become hidden, and validates the id', async () => {
    const c = login('u1');
    progress('u1', 'h1', 1);
    expect(await remove('h1', c)).toEqual({ removed: 1 });
    await expect(remove('bad/id', c)).rejects.toMatchObject({ statusCode: 400 });
    expect(await remove('nope', c)).toEqual({ removed: 0 });
  });

  it('clears only the caller\'s whole history, idempotently', async () => {
    const a = login('u1');
    login('u2');
    progress('u1', 'e1', 1);
    progress('u1', 'h1', 2);
    progress('u2', 'e2', 3);
    expect(await clear(a)).toEqual({ removed: 2 });
    expect(await clear(a)).toEqual({ removed: 0 });
    expect(rows()).toEqual([{ user_id: 'u2', episode_id: 'e2' }]);
  });
});
