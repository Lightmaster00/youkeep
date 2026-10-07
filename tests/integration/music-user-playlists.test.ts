import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import listHandler from '../../server/api/music/user-playlists/index.get';
import createHandler from '../../server/api/music/user-playlists/index.post';
import getHandler from '../../server/api/music/user-playlists/[id].get';
import updateHandler from '../../server/api/music/user-playlists/[id].put';
import deleteHandler from '../../server/api/music/user-playlists/[id].delete';
import addTrackHandler from '../../server/api/music/user-playlists/[id]/tracks.post';
import removeTrackHandler from '../../server/api/music/user-playlists/[id]/tracks/[trackId].delete';
import orderHandler from '../../server/api/music/user-playlists/[id]/order.put';
import { renumberPlaylist } from '../../server/utils/musicUserPlaylists';
import {
  createTestDb, insertUser, insertSession, insertMusicArtist, insertMusicAlbum, insertMusicTrack,
  mockEvent, sessionCookie,
} from '../helpers/testDb';

let db: Database.Database;
let alice: string;
let bob: string;

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
  insertMusicArtist(db, { id: 'pub', visibility: 'public' });
  insertMusicArtist(db, { id: 'ultra', visibility: 'ultra_private' });
  insertMusicAlbum(db, { id: 'al1', artistId: 'pub', title: 'First album' });
  db.prepare("UPDATE music_albums SET cover_url = '/covers/al1.jpg' WHERE id = 'al1'").run();
  for (const id of ['t1', 't2', 't3', 't4', 't5']) {
    insertMusicTrack(db, { id, artistId: 'pub', albumId: id === 't1' ? 'al1' : null, localFilePath: `/m/${id}`, localThumbnailPath: id === 't1' ? null : `/thumbs/${id}.jpg` });
  }
  insertMusicTrack(db, { id: 'hidden', artistId: 'ultra', localFilePath: '/m/h' });
  alice = login('alice');
  bob = login('bob');
});

function login(userId: string, role: 'admin' | 'user' = 'user') {
  insertUser(db, { id: userId, role });
  insertSession(db, { id: `sess-${userId}`, userId });
  return sessionCookie(`sess-${userId}`);
}

const call = (handler: any, cookie: string | undefined, opts: { method?: string; params?: Record<string, string>; body?: any; path?: string } = {}) =>
  handler(mockEvent(cookie, opts)) as Promise<any>;
const list = (cookie?: string, qs = '') => call(listHandler, cookie, { path: `/api/music/user-playlists${qs}` });
const create = (body: any, cookie?: string) => call(createHandler, cookie, { method: 'POST', body });
const get = (id: string, cookie?: string) => call(getHandler, cookie, { params: { id } });
const update = (id: string, body: any, cookie?: string) => call(updateHandler, cookie, { method: 'PUT', params: { id }, body });
const remove = (id: string, cookie?: string) => call(deleteHandler, cookie, { method: 'DELETE', params: { id } });
const addTrack = (id: string, trackId: any, cookie?: string) => call(addTrackHandler, cookie, { method: 'POST', params: { id }, body: { trackId } });
const removeTrack = (id: string, trackId: string, cookie?: string) => call(removeTrackHandler, cookie, { method: 'DELETE', params: { id, trackId } });
const reorder = (id: string, trackIds: any, cookie?: string) => call(orderHandler, cookie, { method: 'PUT', params: { id }, body: { trackIds } });
const positions = (id: string) => db.prepare('SELECT track_id, position FROM music_user_playlist_tracks WHERE playlist_id = ? ORDER BY position').all(id) as Array<{ track_id: string; position: number }>;

async function playlistWith(trackIds: string[], cookie = alice, title = 'Mix') {
  const p = await create({ title }, cookie);
  for (const t of trackIds) await addTrack(p.id, t, cookie);
  return p.id as string;
}

describe('music user playlists API', () => {
  it('rejects guests with 401 everywhere', async () => {
    const id = await playlistWith(['t1']);
    await expect(list()).rejects.toMatchObject({ statusCode: 401 });
    await expect(create({ title: 'x' })).rejects.toMatchObject({ statusCode: 401 });
    await expect(get(id)).rejects.toMatchObject({ statusCode: 401 });
    await expect(update(id, { title: 'x' })).rejects.toMatchObject({ statusCode: 401 });
    await expect(remove(id)).rejects.toMatchObject({ statusCode: 401 });
    await expect(addTrack(id, 't2')).rejects.toMatchObject({ statusCode: 401 });
    await expect(removeTrack(id, 't1')).rejects.toMatchObject({ statusCode: 401 });
    await expect(reorder(id, ['t1'])).rejects.toMatchObject({ statusCode: 401 });
  });

  it('creates, lists, renames and deletes a playlist', async () => {
    const created = await create({ title: '  Road trip ', description: ' Summer ' }, alice);
    expect(created).toMatchObject({ title: 'Road trip', description: 'Summer', trackCount: 0, coverTrackIds: [] });
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    expect((await list(alice)).map((p: any) => p.title)).toEqual(['Road trip']);
    const updated = await update(created.id, { title: 'Night drive', description: '' }, alice);
    expect(updated).toMatchObject({ title: 'Night drive', description: null });
    expect((await update(created.id, { description: 'Late' }, alice))).toMatchObject({ title: 'Night drive', description: 'Late' });
    expect(await remove(created.id, alice)).toEqual({ success: true });
    expect(await list(alice)).toEqual([]);
  });

  it('validates titles, descriptions and the per-user playlist limit', async () => {
    await expect(create({}, alice)).rejects.toMatchObject({ statusCode: 400 });
    await expect(create({ title: '   ' }, alice)).rejects.toMatchObject({ statusCode: 400 });
    await expect(create({ title: 'x'.repeat(101) }, alice)).rejects.toMatchObject({ statusCode: 400 });
    await expect(create({ title: 'ok', description: 'x'.repeat(501) }, alice)).rejects.toMatchObject({ statusCode: 400 });
    const p = await create({ title: 'ok' }, alice);
    await expect(update(p.id, { title: '' }, alice)).rejects.toMatchObject({ statusCode: 400 });

    const stmt = db.prepare("INSERT INTO music_user_playlists (id, user_id, title, created_at, updated_at) VALUES (?, 'alice', 'x', 1, 1)");
    for (let i = 1; i < 200; i++) stmt.run(`bulk-${i}`);
    await expect(create({ title: 'one too many' }, alice)).rejects.toMatchObject({ statusCode: 400 });
    expect((await create({ title: 'bob is fine' }, bob)).title).toBe('bob is fine');
  });

  it('answers 404 for another user\'s playlist on every endpoint, admin included, and changes nothing', async () => {
    const id = await playlistWith(['t1', 't2']);
    const admin = login('root', 'admin');
    for (const c of [bob, admin]) {
      await expect(get(id, c)).rejects.toMatchObject({ statusCode: 404 });
      await expect(update(id, { title: 'pwned' }, c)).rejects.toMatchObject({ statusCode: 404 });
      await expect(remove(id, c)).rejects.toMatchObject({ statusCode: 404 });
      await expect(addTrack(id, 't3', c)).rejects.toMatchObject({ statusCode: 404 });
      await expect(removeTrack(id, 't1', c)).rejects.toMatchObject({ statusCode: 404 });
      await expect(reorder(id, ['t2', 't1'], c)).rejects.toMatchObject({ statusCode: 404 });
      expect(await list(c)).toEqual([]);
    }
    // Same answer as a playlist that does not exist: no existence oracle.
    await expect(get('does-not-exist', bob)).rejects.toMatchObject({ statusCode: 404, statusMessage: 'Playlist not found.' });
    await expect(get(id, bob)).rejects.toMatchObject({ statusCode: 404, statusMessage: 'Playlist not found.' });
    const mine = await get(id, alice);
    expect(mine.playlist.title).toBe('Mix');
    expect(mine.tracks.map((t: any) => t.id)).toEqual(['t1', 't2']);
  });

  it('appends tracks without duplicates, returns the new count and keeps positions dense', async () => {
    const id = (await create({ title: 'Mix' }, alice)).id;
    expect(await addTrack(id, 't1', alice)).toEqual({ added: true, trackCount: 1 });
    expect(await addTrack(id, 't2', alice)).toEqual({ added: true, trackCount: 2 });
    expect(await addTrack(id, 't1', alice)).toEqual({ added: false, trackCount: 2 });
    await addTrack(id, 't3', alice);
    expect(positions(id)).toEqual([{ track_id: 't1', position: 0 }, { track_id: 't2', position: 1 }, { track_id: 't3', position: 2 }]);
    expect(await removeTrack(id, 't2', alice)).toEqual({ trackCount: 2 });
    expect(positions(id)).toEqual([{ track_id: 't1', position: 0 }, { track_id: 't3', position: 1 }]);
    expect(await removeTrack(id, 't2', alice)).toEqual({ trackCount: 2 }); // idempotent
    await addTrack(id, 't2', alice);
    expect(positions(id).map((p) => p.track_id)).toEqual(['t1', 't3', 't2']);
  });

  it('only adds tracks the caller can see and validates track ids', async () => {
    const id = (await create({ title: 'Mix' }, alice)).id;
    await expect(addTrack(id, 'hidden', alice)).rejects.toMatchObject({ statusCode: 404, statusMessage: 'Track not found.' });
    await expect(addTrack(id, 'missing', alice)).rejects.toMatchObject({ statusCode: 404 });
    await expect(addTrack(id, undefined, alice)).rejects.toMatchObject({ statusCode: 400 });
    await expect(addTrack(id, '../x', alice)).rejects.toMatchObject({ statusCode: 400 });
    await expect(removeTrack(id, 'a b', alice)).rejects.toMatchObject({ statusCode: 400 });
    expect(positions(id)).toEqual([]);
  });

  it('caps a playlist at 2000 tracks', async () => {
    const id = (await create({ title: 'Big' }, alice)).id;
    const stmt = db.prepare('INSERT INTO music_user_playlist_tracks (playlist_id, track_id, position, added_at) VALUES (?, ?, ?, 1)');
    db.pragma('foreign_keys = OFF');
    for (let i = 0; i < 2000; i++) stmt.run(id, `filler-${i}`, i);
    db.pragma('foreign_keys = ON');
    await expect(addTrack(id, 't1', alice)).rejects.toMatchObject({ statusCode: 400 });
    db.prepare("DELETE FROM music_user_playlist_tracks WHERE track_id = 'filler-0'").run();
    expect((await addTrack(id, 't1', alice)).added).toBe(true);
  });

  it('reorders to any permutation and rejects anything else', async () => {
    const id = await playlistWith(['t1', 't2', 't3']);
    expect(await reorder(id, ['t3', 't1', 't2'], alice)).toEqual({ success: true });
    expect(positions(id)).toEqual([{ track_id: 't3', position: 0 }, { track_id: 't1', position: 1 }, { track_id: 't2', position: 2 }]);
    expect((await get(id, alice)).tracks.map((t: any) => t.id)).toEqual(['t3', 't1', 't2']);
    for (const bad of [['t1', 't2'], ['t1', 't2', 't3', 't4'], ['t1', 't1', 't2'], ['t1', 't2', 't5'], 't1,t2,t3', undefined]) {
      await expect(reorder(id, bad, alice)).rejects.toMatchObject({ statusCode: 400 });
    }
    expect(positions(id).map((p) => p.track_id)).toEqual(['t3', 't1', 't2']);
  });

  it('hides tracks the caller cannot see but keeps their rows and slots', async () => {
    const admin = login('root', 'admin');
    const id = await playlistWith(['t1', 'hidden', 't2'], admin);
    db.prepare("UPDATE music_user_playlists SET user_id = 'alice' WHERE id = ?").run(id);
    db.prepare("UPDATE music_tracks SET download_status = 'pending' WHERE id = 't2'").run();
    const r = await get(id, alice);
    expect(r.tracks.map((t: any) => t.id)).toEqual(['t1']);
    expect(r.playlist.trackCount).toBe(1);
    db.prepare("UPDATE music_tracks SET download_status = 'completed' WHERE id = 't2'").run();
    await reorder(id, ['t2', 't1'], alice);
    expect(positions(id).map((p) => p.track_id)).toEqual(['t2', 'hidden', 't1']);
    await expect(reorder(id, ['t2', 'hidden', 't1'], alice)).rejects.toMatchObject({ statusCode: 400 });
    expect(positions(id)).toHaveLength(3);
  });

  it('returns tracks in the recently-added shape and list entries with count and covers', async () => {
    const id = await playlistWith(['t1', 't2', 't3', 't4', 't5']);
    const r = await get(id, alice);
    expect(r.tracks[0]).toMatchObject({ id: 't1', artist_name: 'Artist pub', album_title: 'First album', album_cover_url: '/covers/al1.jpg', local_file_path: '/m/t1' });
    const [entry] = await list(alice);
    expect(entry).toMatchObject({ id, title: 'Mix', trackCount: 5, coverTrackIds: ['t1', 't2', 't3', 't4'] });
    expect(entry.coverUrls).toEqual(['/covers/al1.jpg', '/thumbs/t2.jpg', '/thumbs/t3.jpg', '/thumbs/t4.jpg']);
    expect(typeof entry.updatedAt).toBe('number');
  });

  it('flags which playlists already contain a track when asked', async () => {
    const withIt = await playlistWith(['t1'], alice, 'Has it');
    const without = await playlistWith(['t2'], alice, 'Lacks it');
    await playlistWith(['t1'], bob, 'Bob');
    const r = await list(alice, '?containsTrack=t1');
    const flags = Object.fromEntries(r.map((p: any) => [p.id, p.containsTrack]));
    expect(flags).toEqual({ [withIt]: true, [without]: false });
    expect((await list(alice))[0]).not.toHaveProperty('containsTrack');
  });

  it('lists the most recently changed playlist first', async () => {
    const a = await playlistWith([], alice, 'A');
    const b = await playlistWith([], alice, 'B');
    db.prepare('UPDATE music_user_playlists SET updated_at = 1 WHERE id = ?').run(a);
    db.prepare('UPDATE music_user_playlists SET updated_at = 2 WHERE id = ?').run(b);
    expect((await list(alice)).map((p: any) => p.title)).toEqual(['B', 'A']);
    await addTrack(a, 't1', alice);
    expect((await list(alice)).map((p: any) => p.title)).toEqual(['A', 'B']);
  });

  it('cascades on track, playlist and user delete; positions close up again on the next change', async () => {
    const id = await playlistWith(['t1', 't2', 't3']);
    db.prepare("DELETE FROM music_tracks WHERE id = 't2'").run();
    expect(positions(id).map((p) => p.track_id)).toEqual(['t1', 't3']);
    await addTrack(id, 't4', alice);
    expect(positions(id)).toEqual([{ track_id: 't1', position: 0 }, { track_id: 't3', position: 1 }, { track_id: 't4', position: 2 }]);
    await remove(id, alice);
    expect(db.prepare('SELECT COUNT(*) as c FROM music_user_playlist_tracks').get()).toEqual({ c: 0 });
    await playlistWith(['t1']);
    db.prepare("DELETE FROM users WHERE id = 'alice'").run();
    expect(db.prepare('SELECT COUNT(*) as c FROM music_user_playlists').get()).toEqual({ c: 0 });
    expect(db.prepare('SELECT COUNT(*) as c FROM music_user_playlist_tracks').get()).toEqual({ c: 0 });
  });
});

describe('renumberPlaylist', () => {
  it('rewrites gapped positions as 0..n-1 keeping the order', async () => {
    const id = await playlistWith(['t1', 't2', 't3']);
    db.prepare("UPDATE music_user_playlist_tracks SET position = position * 10 + 5 WHERE playlist_id = ?").run(id);
    renumberPlaylist(db, id);
    expect(positions(id)).toEqual([{ track_id: 't1', position: 0 }, { track_id: 't2', position: 1 }, { track_id: 't3', position: 2 }]);
  });
});
