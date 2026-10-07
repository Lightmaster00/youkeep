import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import listHandler from '../../server/api/music/favorites/index.get';
import likeHandler from '../../server/api/music/favorites/[trackId].put';
import unlikeHandler from '../../server/api/music/favorites/[trackId].delete';
import statusHandler from '../../server/api/music/favorites/status.post';
import {
  createTestDb, insertUser, insertSession, insertMusicArtist, insertMusicAlbum, insertMusicTrack,
  mockEvent, sessionCookie,
} from '../helpers/testDb';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
  insertMusicArtist(db, { id: 'pub', visibility: 'public' });
  insertMusicArtist(db, { id: 'priv', visibility: 'private' });
  insertMusicArtist(db, { id: 'ultra', visibility: 'ultra_private' });
  insertMusicAlbum(db, { id: 'al1', artistId: 'pub', title: 'First album' });
  insertMusicTrack(db, { id: 't1', artistId: 'pub', albumId: 'al1', localFilePath: '/m/t1' });
  insertMusicTrack(db, { id: 't2', artistId: 'pub', localFilePath: '/m/t2' });
  insertMusicTrack(db, { id: 't3', artistId: 'priv', localFilePath: '/m/t3' });
  insertMusicTrack(db, { id: 'hidden', artistId: 'ultra', localFilePath: '/m/h' });
  insertMusicTrack(db, { id: 'pending', artistId: 'pub', downloadStatus: 'pending' });
});

function login(userId: string, role: 'admin' | 'user' = 'user') {
  insertUser(db, { id: userId, role });
  insertSession(db, { id: `sess-${userId}`, userId });
  return sessionCookie(`sess-${userId}`);
}
const like = (trackId: string, cookie?: string) =>
  likeHandler(mockEvent(cookie, { method: 'PUT', params: { trackId } }));
const unlike = (trackId: string, cookie?: string) =>
  unlikeHandler(mockEvent(cookie, { method: 'DELETE', params: { trackId } }));
const list = (cookie?: string, qs = '') =>
  listHandler(mockEvent(cookie, { path: `/api/music/favorites${qs}` })) as Promise<any>;
const status = (ids: unknown, cookie?: string) =>
  statusHandler(mockEvent(cookie, { method: 'POST', body: { ids } })) as Promise<any>;
const rows = () => db.prepare('SELECT user_id, track_id FROM music_favorites ORDER BY user_id, track_id').all();

describe('music favorites API', () => {
  it('rejects guests on every endpoint with 401', async () => {
    await expect(list()).rejects.toMatchObject({ statusCode: 401 });
    await expect(like('t1')).rejects.toMatchObject({ statusCode: 401 });
    await expect(unlike('t1')).rejects.toMatchObject({ statusCode: 401 });
    await expect(status(['t1'])).rejects.toMatchObject({ statusCode: 401 });
  });

  it('likes idempotently and lists newest like first with the recently-added track shape', async () => {
    const c = login('u1');
    await like('t1', c);
    await like('t2', c);
    await like('t1', c); // again: no duplicate, keeps its original date
    db.prepare("UPDATE music_favorites SET created_at = 100 WHERE track_id = 't1'").run();
    db.prepare("UPDATE music_favorites SET created_at = 200 WHERE track_id = 't2'").run();
    const r = await list(c);
    expect(r.total).toBe(2);
    expect(r.items.map((t: any) => t.id)).toEqual(['t2', 't1']);
    expect(r.items[1]).toMatchObject({
      id: 't1', title: 'Track t1', artist_id: 'pub', artist_name: 'Artist pub', local_file_path: '/m/t1',
      album_id: 'al1', album_title: 'First album', has_clip: 0,
    });
    expect(Object.keys(r.items[1])).toEqual(expect.arrayContaining(['track_number', 'genre', 'language', 'duration', 'local_thumbnail_path', 'album_cover_url']));
  });

  it('pages with limit/offset and clamps bad values', async () => {
    const c = login('u1');
    for (let i = 0; i < 5; i++) {
      insertMusicTrack(db, { id: `p${i}`, artistId: 'pub', localFilePath: `/m/p${i}` });
      await like(`p${i}`, c);
      db.prepare('UPDATE music_favorites SET created_at = ? WHERE track_id = ?').run(1000 + i, `p${i}`);
    }
    const page = await list(c, '?limit=2&offset=2');
    expect(page.items.map((t: any) => t.id)).toEqual(['p2', 'p1']);
    expect(page.total).toBe(5);
    const bad = await list(c, '?limit=abc&offset=-4');
    expect(bad.items).toHaveLength(5);
  });

  it('unlikes idempotently', async () => {
    const c = login('u1');
    await like('t1', c);
    expect(await unlike('t1', c)).toEqual({ liked: false });
    expect(await unlike('t1', c)).toEqual({ liked: false });
    expect(rows()).toEqual([]);
  });

  it('keeps each user\'s likes private', async () => {
    const a = login('u1');
    const b = login('u2');
    await like('t1', a);
    await like('t2', b);
    expect((await list(a)).items.map((t: any) => t.id)).toEqual(['t1']);
    expect((await status(['t1', 't2'], b)).liked).toEqual(['t2']);
    await unlike('t1', b); // removing someone else's like is impossible
    expect(rows()).toEqual([{ user_id: 'u1', track_id: 't1' }, { user_id: 'u2', track_id: 't2' }]);
  });

  it('only lets a user like tracks they can see (404 without revealing hidden ones) and validates ids', async () => {
    const c = login('u1');
    await expect(like('hidden', c)).rejects.toMatchObject({ statusCode: 404 });
    await expect(like('nope', c)).rejects.toMatchObject({ statusCode: 404 });
    await expect(like('bad/id', c)).rejects.toMatchObject({ statusCode: 400 });
    await expect(unlike('bad id', c)).rejects.toMatchObject({ statusCode: 400 });
    expect(await like('t3', c)).toEqual({ liked: true }); // private: any member
    const admin = login('boss', 'admin');
    expect(await like('hidden', admin)).toEqual({ liked: true });
  });

  it('omits tracks that became hidden or are not completed, but keeps their rows', async () => {
    const c = login('u1');
    await like('t1', c);
    await like('t3', c);
    db.prepare("UPDATE music_artists SET visibility = 'ultra_private' WHERE id = 'priv'").run();
    db.prepare("INSERT INTO music_favorites (user_id, track_id, created_at) VALUES ('u1', 'pending', 1)").run();
    const r = await list(c);
    expect(r.items.map((t: any) => t.id)).toEqual(['t1']);
    expect(r.total).toBe(1);
    expect((await status(['t1', 't3'], c)).liked).toEqual(['t1']);
    expect(rows()).toHaveLength(3);
    db.prepare("UPDATE music_artists SET visibility = 'private' WHERE id = 'priv'").run();
    expect((await list(c)).items.map((t: any) => t.id).sort()).toEqual(['t1', 't3']);
  });

  it('status returns the liked subset in request order and validates the body', async () => {
    const c = login('u1');
    await like('t1', c);
    await like('t2', c);
    expect(await status(['t2', 'zzz', 't1', 't2'], c)).toEqual({ liked: ['t2', 't1'] });
    expect(await status([], c)).toEqual({ liked: [] });
    await expect(status('t1', c)).rejects.toMatchObject({ statusCode: 400 });
    await expect(status([1], c)).rejects.toMatchObject({ statusCode: 400 });
    await expect(status(Array.from({ length: 201 }, (_, i) => `x${i}`), c)).rejects.toMatchObject({ statusCode: 400 });
    expect((await status(Array.from({ length: 200 }, (_, i) => `x${i}`), c)).liked).toEqual([]);
  });

  it('cascades when the track or the user is deleted', async () => {
    const a = login('u1');
    const b = login('u2');
    await like('t1', a);
    await like('t2', a);
    await like('t2', b);
    db.prepare("DELETE FROM music_tracks WHERE id = 't2'").run();
    expect(rows()).toEqual([{ user_id: 'u1', track_id: 't1' }]);
    db.prepare("DELETE FROM users WHERE id = 'u1'").run();
    expect(rows()).toEqual([]);
  });
});
