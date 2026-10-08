import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import likedMixHandler from '../../server/api/music/playlists/liked-mix.get';
import genresHandler from '../../server/api/music/genres/index.get';
import genreTracksHandler from '../../server/api/music/genres/[name]/tracks.get';
import recentAlbumsHandler from '../../server/api/music/albums/recent.get';
import exploreHandler from '../../server/api/music/artists/explore.get';
import { LIKED_MIX_SIZE, LIKED_MIX_MAX_LIKED, GENRE_TILE_LIMIT } from '../../server/utils/musicDiscover';
import {
  createTestDb, insertUser, insertSession, insertMusicArtist, insertMusicAlbum, insertMusicTrack,
  insertMusicPlay, mockEvent, sessionCookie,
} from '../helpers/testDb';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
  insertMusicArtist(db, { id: 'pub', name: 'Public', visibility: 'public' });
  insertMusicArtist(db, { id: 'priv', name: 'Private', visibility: 'private' });
  insertMusicArtist(db, { id: 'ultra', name: 'Ultra', visibility: 'ultra_private' });
});

function login(userId: string, role: 'admin' | 'user' = 'user') {
  insertUser(db, { id: userId, role });
  insertSession(db, { id: `sess-${userId}`, userId });
  return sessionCookie(`sess-${userId}`);
}
const ev = (path: string, cookie?: string, params?: Record<string, string>) => mockEvent(cookie, { path, params });
const like = (userId: string, trackId: string) =>
  db.prepare('INSERT INTO music_favorites (user_id, track_id, created_at) VALUES (?, ?, ?)').run(userId, trackId, Date.now());
const ids = (list: any[]) => list.map((t) => t.id);

describe('GET /api/music/playlists/liked-mix', () => {
  const mix = async (cookie?: string, seed = 's1') =>
    ((await likedMixHandler(ev(`/api/music/playlists/liked-mix?seed=${seed}`, cookie))) as any).tracks as any[];

  it('is empty for guests and for users without liked songs', async () => {
    insertMusicTrack(db, { id: 't1', artistId: 'pub', genre: 'Rock' });
    expect(await mix()).toEqual([]);
    expect(await mix(login('u1'))).toEqual([]);
  });

  it('mixes the liked tracks with unliked tracks of the same artists or genres, without duplicates', async () => {
    const c = login('u1');
    insertMusicArtist(db, { id: 'other', visibility: 'public' });
    insertMusicArtist(db, { id: 'far', visibility: 'public' });
    insertMusicTrack(db, { id: 'liked1', artistId: 'pub', genre: 'Rock' });
    insertMusicTrack(db, { id: 'liked2', artistId: 'pub', genre: 'Rock' });
    insertMusicTrack(db, { id: 'sameArtist', artistId: 'pub', genre: 'Jazz' });
    insertMusicTrack(db, { id: 'sameGenre', artistId: 'other', genre: ' rOCK ' });
    insertMusicTrack(db, { id: 'unrelated', artistId: 'far', genre: 'Pop' });
    insertMusicTrack(db, { id: 'pendingRelated', artistId: 'pub', genre: 'Rock', downloadStatus: 'pending' });
    insertMusicTrack(db, { id: 'hiddenRelated', artistId: 'ultra', genre: 'Rock' });
    like('u1', 'liked1');
    like('u1', 'liked2');
    // Another user's like has no effect.
    insertUser(db, { id: 'u2', role: 'user' });
    like('u2', 'unrelated');
    const tracks = await mix(c);
    expect(ids(tracks).sort()).toEqual(['liked1', 'liked2', 'sameArtist', 'sameGenre']);
    expect(tracks[0]).toHaveProperty('artist_name');
    expect(tracks[0]).toHaveProperty('local_file_path');
  });

  it('ignores liked tracks the user can no longer see', async () => {
    const c = login('u1');
    insertMusicTrack(db, { id: 'hidden', artistId: 'ultra', genre: 'Rock' });
    insertMusicTrack(db, { id: 'pubRock', artistId: 'pub', genre: 'Rock' });
    like('u1', 'hidden');
    expect(await mix(c)).toEqual([]);
  });

  it('keeps at most the liked share when related tracks exist, caps the size and is repeatable per seed', async () => {
    const c = login('u1');
    for (let i = 0; i < 40; i++) {
      insertMusicTrack(db, { id: `l${String(i).padStart(2, '0')}`, artistId: 'pub', genre: 'Rock' });
      like('u1', `l${String(i).padStart(2, '0')}`);
      insertMusicTrack(db, { id: `r${String(i).padStart(2, '0')}`, artistId: 'priv', genre: 'rock' });
    }
    const first = await mix(c, 'abc');
    expect(first).toHaveLength(LIKED_MIX_SIZE);
    expect(new Set(ids(first)).size).toBe(LIKED_MIX_SIZE);
    expect(first.filter((t) => t.id.startsWith('l'))).toHaveLength(LIKED_MIX_MAX_LIKED);
    expect(ids(await mix(c, 'abc'))).toEqual(ids(first));
    expect(ids(await mix(c, 'other-seed'))).not.toEqual(ids(first));
  });

  it('fills up with more liked tracks when there are not enough related ones', async () => {
    const c = login('u1');
    for (let i = 0; i < 35; i++) {
      insertMusicTrack(db, { id: `l${i}`, artistId: 'pub' });
      like('u1', `l${i}`);
    }
    const tracks = await mix(c);
    expect(tracks).toHaveLength(LIKED_MIX_SIZE);
    expect(new Set(ids(tracks)).size).toBe(LIKED_MIX_SIZE);
  });
});

describe('GET /api/music/genres', () => {
  const genres = async (cookie?: string) => ((await genresHandler(ev('/api/music/genres', cookie))) as any).genres;

  it('groups genres without regard to case, labels them with the most common spelling and counts visible completed tracks', async () => {
    insertMusicTrack(db, { id: 'a', artistId: 'pub', genre: 'Hip Hop' });
    insertMusicTrack(db, { id: 'b', artistId: 'pub', genre: 'hip hop' });
    insertMusicTrack(db, { id: 'c', artistId: 'pub', genre: 'hip hop ' });
    insertMusicTrack(db, { id: 'd', artistId: 'pub', genre: 'Jazz' });
    insertMusicTrack(db, { id: 'e', artistId: 'pub', genre: '' });
    insertMusicTrack(db, { id: 'f', artistId: 'pub', genre: null });
    insertMusicTrack(db, { id: 'g', artistId: 'pub', genre: 'Jazz', downloadStatus: 'pending' });
    insertMusicTrack(db, { id: 'h', artistId: 'priv', genre: 'Jazz' });
    insertMusicTrack(db, { id: 'i', artistId: 'ultra', genre: 'Metal' });
    expect(await genres()).toEqual([
      { genre: 'hip hop', trackCount: 3 },
      { genre: 'Jazz', trackCount: 1 },
    ]);
    expect(await genres(login('u1'))).toEqual([
      { genre: 'hip hop', trackCount: 3 },
      { genre: 'Jazz', trackCount: 2 },
    ]);
    expect((await genres(login('boss', 'admin'))).map((g: any) => g.genre)).toEqual(['hip hop', 'Jazz', 'Metal']);
  });

  it('returns the biggest genres first, at most the tile limit', async () => {
    for (let i = 0; i < GENRE_TILE_LIMIT + 5; i++) {
      for (let j = 0; j <= i; j++) insertMusicTrack(db, { id: `t${i}-${j}`, artistId: 'pub', genre: `G${i}` });
    }
    const list = await genres();
    expect(list).toHaveLength(GENRE_TILE_LIMIT);
    expect(list[0]).toEqual({ genre: `G${GENRE_TILE_LIMIT + 4}`, trackCount: GENRE_TILE_LIMIT + 5 });
  });
});

describe('GET /api/music/genres/:name/tracks', () => {
  const tracks = async (name: string, query = '', cookie?: string) =>
    (await genreTracksHandler(ev(`/api/music/genres/x/tracks${query}`, cookie, { name }))) as any;

  beforeEach(() => {
    for (let i = 0; i < 5; i++) insertMusicTrack(db, { id: `r${i}`, artistId: 'pub', genre: i % 2 ? 'ROCK' : 'Rock', createdAt: 1000 + i });
    insertMusicTrack(db, { id: 'privRock', artistId: 'priv', genre: 'rock', createdAt: 2000 });
    insertMusicTrack(db, { id: 'pendingRock', artistId: 'pub', genre: 'rock', downloadStatus: 'pending', createdAt: 3000 });
    insertMusicTrack(db, { id: 'jazz', artistId: 'pub', genre: 'Jazz', createdAt: 4000 });
  });

  it('matches the genre without regard to case, newest first, with the total', async () => {
    const r = await tracks('rock');
    expect(ids(r.tracks)).toEqual(['r4', 'r3', 'r2', 'r1', 'r0']);
    expect(r.total).toBe(5);
    expect((await tracks('rock', '', login('u1'))).total).toBe(6);
    expect(ids((await tracks('Rock%20')).tracks)).toEqual(['r4', 'r3', 'r2', 'r1', 'r0']);
  });

  it('pages with limit and offset', async () => {
    const r = await tracks('Rock', '?limit=2&offset=2');
    expect(ids(r.tracks)).toEqual(['r2', 'r1']);
    expect(r.total).toBe(5);
  });

  it('answers an empty list for an unknown genre', async () => {
    expect(await tracks('Polka')).toEqual({ tracks: [], total: 0 });
  });

  it('decodes an encoded name', async () => {
    insertMusicTrack(db, { id: 'rnb', artistId: 'pub', genre: 'R&B / Soul' });
    expect(ids((await tracks(encodeURIComponent('r&b / soul'))).tracks)).toEqual(['rnb']);
  });
});

describe('GET /api/music/albums/recent', () => {
  const albums = async (query = '', cookie?: string) => ((await recentAlbumsHandler(ev(`/api/music/albums/recent${query}`, cookie))) as any).albums;

  it('lists the latest albums with at least one visible completed track', async () => {
    insertMusicAlbum(db, { id: 'old', artistId: 'pub', title: 'Old', releaseYear: 1999, createdAt: 100 });
    insertMusicAlbum(db, { id: 'new', artistId: 'pub', title: 'New', releaseYear: 2024, createdAt: 300 });
    insertMusicAlbum(db, { id: 'empty', artistId: 'pub', createdAt: 400 });
    insertMusicAlbum(db, { id: 'pendingOnly', artistId: 'pub', createdAt: 500 });
    insertMusicAlbum(db, { id: 'private', artistId: 'priv', createdAt: 600 });
    insertMusicTrack(db, { id: 'o1', artistId: 'pub', albumId: 'old' });
    insertMusicTrack(db, { id: 'n1', artistId: 'pub', albumId: 'new', trackNumber: 2, localThumbnailPath: '/thumbs/n1.jpg' });
    insertMusicTrack(db, { id: 'n2', artistId: 'pub', albumId: 'new', trackNumber: 1, localThumbnailPath: '/thumbs/n2.jpg' });
    insertMusicTrack(db, { id: 'n3', artistId: 'pub', albumId: 'new', downloadStatus: 'pending' });
    insertMusicTrack(db, { id: 'p1', artistId: 'pub', albumId: 'pendingOnly', downloadStatus: 'pending' });
    insertMusicTrack(db, { id: 'v1', artistId: 'priv', albumId: 'private' });

    const list = await albums();
    expect(list.map((a: any) => a.id)).toEqual(['new', 'old']);
    expect(list[0]).toEqual({
      id: 'new', title: 'New', release_year: 2024, artist_id: 'pub', artist_name: 'Public',
      cover_url: '/thumbs/n2.jpg', trackCount: 2,
    });
    expect((await albums('', login('u1'))).map((a: any) => a.id)).toEqual(['private', 'new', 'old']);
    expect((await albums('?limit=1')).map((a: any) => a.id)).toEqual(['new']);
  });
});

describe('GET /api/music/artists/explore', () => {
  const explore = async (cookie?: string, query = '') => ((await exploreHandler(ev(`/api/music/artists/explore${query}`, cookie))) as any).artists;

  beforeEach(() => {
    insertMusicArtist(db, { id: 'big', name: 'Big', visibility: 'public' });
    insertMusicArtist(db, { id: 'played', name: 'Played', visibility: 'public' });
    insertMusicArtist(db, { id: 'nothing', name: 'Nothing', visibility: 'public' });
    for (let i = 0; i < 3; i++) insertMusicTrack(db, { id: `big${i}`, artistId: 'big' });
    insertMusicTrack(db, { id: 'pl1', artistId: 'played' });
    insertMusicTrack(db, { id: 'pl2', artistId: 'played' });
    insertMusicTrack(db, { id: 'pub1', artistId: 'pub' });
    insertMusicTrack(db, { id: 'priv1', artistId: 'priv' });
    insertMusicTrack(db, { id: 'ultra1', artistId: 'ultra' });
    insertMusicTrack(db, { id: 'nothing1', artistId: 'nothing', downloadStatus: 'failed' });
  });

  it('is empty for guests', async () => {
    expect(await explore()).toEqual([]);
  });

  it('lists visible artists the user played at most twice, by track count then name', async () => {
    const c = login('u1');
    insertMusicPlay(db, { id: 'h1', trackId: 'pl1', userId: 'u1' });
    insertMusicPlay(db, { id: 'h2', trackId: 'pl2', userId: 'u1' });
    insertMusicPlay(db, { id: 'h3', trackId: 'pub1', userId: 'u1' });
    // Plays of another user do not count.
    insertUser(db, { id: 'u2', role: 'user' });
    for (let i = 0; i < 5; i++) insertMusicPlay(db, { id: `o${i}`, trackId: 'big0', userId: 'u2' });
    const list = await explore(c);
    expect(list.map((a: any) => a.id)).toEqual(['big', 'played', 'priv', 'pub']);
    expect(list[0]).toEqual({ id: 'big', name: 'Big', avatar_url: null, track_count: 3 });

    insertMusicPlay(db, { id: 'h4', trackId: 'pl1', userId: 'u1' });
    expect((await explore(c)).map((a: any) => a.id)).toEqual(['big', 'priv', 'pub']);
    expect((await explore(c, '?limit=1')).map((a: any) => a.id)).toEqual(['big']);
  });
});
