import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import handler from '../../server/api/music/artists/index.get';
import {
  createTestDb,
  insertUser,
  insertSession,
  insertMusicArtist,
  insertMusicAlbum,
  insertMusicTrack,
  mockEvent,
  sessionCookie
} from '../helpers/testDb';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
});

function loginAs(userId: string, role: 'admin' | 'user' = 'user') {
  insertUser(db, { id: userId, role });
  const sessionId = `sess-${userId}`;
  insertSession(db, { id: sessionId, userId });
  return mockEvent(sessionCookie(sessionId), { path: '/api/music/artists' });
}

const guestEvent = (path = '/api/music/artists') => mockEvent(undefined, { path });

describe('GET /api/music/artists', () => {
  it('only includes public artists for a guest', async () => {
    insertMusicArtist(db, { id: 'pub', name: 'Public Artist', visibility: 'public' });
    insertMusicTrack(db, { id: 't1', artistId: 'pub' });
    insertMusicArtist(db, { id: 'priv', name: 'Private Artist', visibility: 'private' });
    insertMusicTrack(db, { id: 't2', artistId: 'priv' });

    const result: any = await handler(guestEvent());
    const ids = result.artists.map((a: any) => a.id);
    expect(ids).toContain('pub');
    expect(ids).not.toContain('priv');
  });

  it('includes private artists for a logged-in user but not ultra_private', async () => {
    insertMusicArtist(db, { id: 'priv', visibility: 'private' });
    insertMusicTrack(db, { id: 't1', artistId: 'priv' });
    insertMusicArtist(db, { id: 'ultra', visibility: 'ultra_private' });
    insertMusicTrack(db, { id: 't2', artistId: 'ultra' });

    const result: any = await handler(loginAs('u1'));
    const ids = result.artists.map((a: any) => a.id);
    expect(ids).toContain('priv');
    expect(ids).not.toContain('ultra');
  });

  it('includes ultra_private artists for an admin', async () => {
    insertMusicArtist(db, { id: 'ultra', visibility: 'ultra_private' });
    insertMusicTrack(db, { id: 't1', artistId: 'ultra' });

    const result: any = await handler(loginAs('admin1', 'admin'));
    expect(result.artists.map((a: any) => a.id)).toContain('ultra');
  });

  it('excludes an artist with zero completed tracks', async () => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', downloadStatus: 'downloading' });

    const result: any = await handler(guestEvent());
    expect(result.artists.map((a: any) => a.id)).not.toContain('a1');
  });

  it('counts only completed tracks in track_count', async () => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', downloadStatus: 'completed' });
    insertMusicTrack(db, { id: 't2', artistId: 'a1', downloadStatus: 'completed' });
    insertMusicTrack(db, { id: 't3', artistId: 'a1', downloadStatus: 'pending' });

    const result: any = await handler(guestEvent());
    const artist = result.artists.find((a: any) => a.id === 'a1');
    expect(artist.track_count).toBe(2);
  });

  it('filters by search (case-insensitive substring of name)', async () => {
    insertMusicArtist(db, { id: 'a1', name: 'Daft Punk' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });
    insertMusicArtist(db, { id: 'a2', name: 'Justice' });
    insertMusicTrack(db, { id: 't2', artistId: 'a2' });

    const result: any = await handler(guestEvent('/api/music/artists?search=daft'));
    expect(result.artists.map((a: any) => a.id)).toEqual(['a1']);
  });

  it('filters by genre and language', async () => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', genre: 'Electro', language: 'fr' });
    insertMusicArtist(db, { id: 'a2' });
    insertMusicTrack(db, { id: 't2', artistId: 'a2', genre: 'Rock', language: 'en' });

    const byGenre: any = await handler(guestEvent('/api/music/artists?genre=Electro'));
    expect(byGenre.artists.map((a: any) => a.id)).toEqual(['a1']);

    const byLanguage: any = await handler(guestEvent('/api/music/artists?language=en'));
    expect(byLanguage.artists.map((a: any) => a.id)).toEqual(['a2']);
  });

  it('filters by release year via the album join', async () => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicAlbum(db, { id: 'al1', artistId: 'a1', releaseYear: 2020 });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', albumId: 'al1' });
    insertMusicArtist(db, { id: 'a2' });
    insertMusicAlbum(db, { id: 'al2', artistId: 'a2', releaseYear: 1999 });
    insertMusicTrack(db, { id: 't2', artistId: 'a2', albumId: 'al2' });

    const result: any = await handler(guestEvent('/api/music/artists?year=2020'));
    expect(result.artists.map((a: any) => a.id)).toEqual(['a1']);
  });

  it('returns facets unaffected by the currently applied filters', async () => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', genre: 'Electro', language: 'fr' });
    insertMusicArtist(db, { id: 'a2' });
    insertMusicTrack(db, { id: 't2', artistId: 'a2', genre: 'Rock', language: 'en' });

    // Filtering to genre=Electro should still report Rock as an available facet value.
    const result: any = await handler(guestEvent('/api/music/artists?genre=Electro'));
    expect(result.facets.genres.sort()).toEqual(['Electro', 'Rock']);
    expect(result.facets.languages.sort()).toEqual(['en', 'fr']);
  });

  it('excludes facet values that only exist behind visibility the requester cannot see', async () => {
    insertMusicArtist(db, { id: 'pub', visibility: 'public' });
    insertMusicTrack(db, { id: 't1', artistId: 'pub', genre: 'Electro' });
    insertMusicArtist(db, { id: 'ultra', visibility: 'ultra_private' });
    insertMusicTrack(db, { id: 't2', artistId: 'ultra', genre: 'SecretGenre' });

    const result: any = await handler(guestEvent());
    expect(result.facets.genres).not.toContain('SecretGenre');
  });
});
