import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import listHandler from '../../server/api/music/history/index.get';
import clearHandler from '../../server/api/music/history/index.delete';
import removeHandler from '../../server/api/music/history/[trackId].delete';
import {
  createTestDb, insertUser, insertSession, insertMusicArtist, insertMusicAlbum, insertMusicTrack,
  insertMusicPlay, mockEvent, sessionCookie,
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
let playSeq = 0;
const play = (userId: string, trackId: string, playedAt: number) =>
  insertMusicPlay(db, { id: `play-${++playSeq}`, trackId, userId, playedAt });
const list = (cookie?: string, qs = '') =>
  listHandler(mockEvent(cookie, { path: `/api/music/history${qs}` })) as Promise<any>;
const remove = (trackId: string, cookie?: string) =>
  removeHandler(mockEvent(cookie, { method: 'DELETE', params: { trackId } })) as Promise<any>;
const clear = (cookie?: string) => clearHandler(mockEvent(cookie, { method: 'DELETE' })) as Promise<any>;
const rows = () =>
  db.prepare('SELECT user_id, track_id FROM music_play_history ORDER BY user_id, track_id, played_at').all();

describe('music history API', () => {
  it('rejects guests on every endpoint with 401', async () => {
    await expect(list()).rejects.toMatchObject({ statusCode: 401 });
    await expect(remove('t1')).rejects.toMatchObject({ statusCode: 401 });
    await expect(clear()).rejects.toMatchObject({ statusCode: 401 });
  });

  it('lists one entry per track with its latest play and play count, newest first, in the track shape', async () => {
    const c = login('u1');
    play('u1', 't1', 100);
    play('u1', 't2', 200);
    play('u1', 't1', 300);
    play('u1', 't1', 150);
    const r = await list(c);
    expect(r.total).toBe(2);
    expect(r.items.map((t: any) => [t.id, t.playedAt, t.playCount])).toEqual([['t1', 300, 3], ['t2', 200, 1]]);
    expect(r.items[0]).toMatchObject({
      id: 't1', title: 'Track t1', artist_id: 'pub', artist_name: 'Artist pub', local_file_path: '/m/t1',
      album_id: 'al1', album_title: 'First album', has_clip: 0,
    });
    expect(Object.keys(r.items[0])).toEqual(expect.arrayContaining(['track_number', 'genre', 'language', 'duration', 'local_thumbnail_path', 'album_cover_url']));
  });

  it('breaks ties on the same latest play time by track id, descending', async () => {
    const c = login('u1');
    play('u1', 't1', 500);
    play('u1', 't2', 500);
    expect((await list(c)).items.map((t: any) => t.id)).toEqual(['t2', 't1']);
  });

  it('pages with limit/offset (total = distinct tracks) and clamps bad values', async () => {
    const c = login('u1');
    for (let i = 0; i < 5; i++) {
      insertMusicTrack(db, { id: `p${i}`, artistId: 'pub', localFilePath: `/m/p${i}` });
      play('u1', `p${i}`, 1000 + i);
      play('u1', `p${i}`, 900 + i);
    }
    const page = await list(c, '?limit=2&offset=2');
    expect(page.items.map((t: any) => t.id)).toEqual(['p2', 'p1']);
    expect(page.total).toBe(5);
    const bad = await list(c, '?limit=abc&offset=-4');
    expect(bad.items).toHaveLength(5);
    expect((await list(c, '?limit=1')).items).toHaveLength(1);
  });

  it('caps the page size at 100 and defaults to 30', async () => {
    const c = login('u1');
    for (let i = 0; i < 105; i++) {
      insertMusicTrack(db, { id: `x${i}`, artistId: 'pub', localFilePath: `/m/x${i}` });
      play('u1', `x${i}`, i + 1);
    }
    expect((await list(c)).items).toHaveLength(30);
    expect((await list(c, '?limit=500')).items).toHaveLength(100);
    expect((await list(c, '?limit=500')).total).toBe(105);
  });

  it('only returns tracks the caller can see, keeping the hidden rows', async () => {
    const c = login('u1');
    play('u1', 't1', 1);
    play('u1', 't3', 2);
    play('u1', 'hidden', 3);
    play('u1', 'pending', 4);
    const r = await list(c);
    expect(r.items.map((t: any) => t.id)).toEqual(['t3', 't1']);
    expect(r.total).toBe(2);
    expect(rows()).toHaveLength(4);

    db.prepare("UPDATE music_artists SET visibility = 'ultra_private' WHERE id = 'priv'").run();
    expect((await list(c)).items.map((t: any) => t.id)).toEqual(['t1']);

    const admin = login('boss', 'admin');
    play('boss', 'hidden', 9);
    expect((await list(admin)).items.map((t: any) => t.id)).toEqual(['hidden']);
  });

  it('keeps each user\'s history private', async () => {
    const a = login('u1');
    const b = login('u2');
    play('u1', 't1', 1);
    play('u2', 't2', 2);
    play('u2', 't1', 3);
    expect((await list(a)).items.map((t: any) => [t.id, t.playCount])).toEqual([['t1', 1]]);
    expect((await list(b)).items.map((t: any) => t.id)).toEqual(['t1', 't2']);
  });

  it('removes every play of one track, only for the caller, idempotently', async () => {
    const a = login('u1');
    login('u2');
    play('u1', 't1', 1);
    play('u1', 't1', 2);
    play('u1', 't2', 3);
    play('u2', 't1', 4);
    expect(await remove('t1', a)).toEqual({ removed: 2 });
    expect(await remove('t1', a)).toEqual({ removed: 0 });
    expect(rows()).toEqual([{ user_id: 'u1', track_id: 't2' }, { user_id: 'u2', track_id: 't1' }]);
  });

  it('can remove a track that has since become hidden, and validates the id', async () => {
    const c = login('u1');
    play('u1', 'hidden', 1);
    expect(await remove('hidden', c)).toEqual({ removed: 1 });
    await expect(remove('bad/id', c)).rejects.toMatchObject({ statusCode: 400 });
    expect(await remove('nope', c)).toEqual({ removed: 0 });
  });

  it('clears only the caller\'s whole history, idempotently', async () => {
    const a = login('u1');
    login('u2');
    play('u1', 't1', 1);
    play('u1', 'hidden', 2);
    play('u2', 't2', 3);
    expect(await clear(a)).toEqual({ removed: 2 });
    expect(await clear(a)).toEqual({ removed: 0 });
    expect(rows()).toEqual([{ user_id: 'u2', track_id: 't2' }]);
    expect((await list(a)).total).toBe(0);
  });
});
