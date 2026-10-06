import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import mostPlayedHandler from '../../server/api/music/playlists/most-played.get';
import recentlyAddedHandler from '../../server/api/music/playlists/recently-added.get';
import rediscoverHandler from '../../server/api/music/playlists/rediscover.get';
import genreMixHandler from '../../server/api/music/playlists/genre-mix.get';
import artistMixHandler from '../../server/api/music/playlists/artist-mix.get';
import radioHandler from '../../server/api/music/playlists/radio.get';
import {
  createTestDb,
  insertUser,
  insertSession,
  insertMusicArtist,
  insertMusicTrack,
  insertMusicPlay,
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
  return sessionCookie(sessionId);
}

function eventFor(path: string, cookieHeader?: string) {
  return mockEvent(cookieHeader, { path });
}

const ids = (r: any) => r.tracks.map((t: any) => t.id);
const FORTY_DAYS_AGO = Date.now() - 1000 * 60 * 60 * 24 * 40;

describe('every playlist route', () => {
  it('includes has_clip on its tracks', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'public' });
    insertMusicTrack(db, { id: 'seed', artistId: 'a1', genre: 'Rock' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', genre: 'Rock', hasClip: true });
    const cookie = loginAs('u1');
    insertMusicPlay(db, { id: 'p1', trackId: 't1', userId: 'u1', playedAt: FORTY_DAYS_AGO });
    const results: any[] = [
      await mostPlayedHandler(eventFor('/api/music/playlists/most-played', cookie)),
      await recentlyAddedHandler(eventFor('/api/music/playlists/recently-added')),
      await rediscoverHandler(eventFor('/api/music/playlists/rediscover', cookie)),
      await genreMixHandler(eventFor('/api/music/playlists/genre-mix?genre=Rock')),
      await artistMixHandler(eventFor('/api/music/playlists/artist-mix?artistId=a1')),
      await radioHandler(eventFor('/api/music/playlists/radio?trackId=seed')),
    ];
    for (const r of results) expect(r.tracks.find((t: any) => t.id === 't1').has_clip).toBe(1);
  });
});

describe('GET /api/music/playlists/most-played', () => {
  it('returns an empty list for a guest', async () => {
    const result: any = await mostPlayedHandler(eventFor('/api/music/playlists/most-played'));
    expect(result.tracks).toEqual([]);
  });

  it('orders by play count for the current user, ignoring other users\' plays', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'public' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });
    insertMusicTrack(db, { id: 't2', artistId: 'a1' });
    const cookie = loginAs('u1');
    insertUser(db, { id: 'u2', role: 'user' });

    insertMusicPlay(db, { id: 'p1', trackId: 't1', userId: 'u1' });
    insertMusicPlay(db, { id: 'p2', trackId: 't2', userId: 'u1' });
    insertMusicPlay(db, { id: 'p3', trackId: 't2', userId: 'u1' });
    insertMusicPlay(db, { id: 'p4', trackId: 't1', userId: 'u2' });
    insertMusicPlay(db, { id: 'p5', trackId: 't1', userId: 'u2' });
    insertMusicPlay(db, { id: 'p6', trackId: 't1', userId: 'u2' });

    const result: any = await mostPlayedHandler(eventFor('/api/music/playlists/most-played', cookie));
    expect(ids(result)).toEqual(['t2', 't1']);
  });

  it('excludes an ultra_private artist for a user, includes it for an admin', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'ultra_private' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });
    const cookie = loginAs('u1');
    const adminCookie = loginAs('admin1', 'admin');
    insertMusicPlay(db, { id: 'p1', trackId: 't1', userId: 'u1' });
    insertMusicPlay(db, { id: 'p2', trackId: 't1', userId: 'admin1' });

    expect(ids(await mostPlayedHandler(eventFor('/api/music/playlists/most-played', cookie)))).toEqual([]);
    expect(ids(await mostPlayedHandler(eventFor('/api/music/playlists/most-played', adminCookie)))).toEqual(['t1']);
  });
});

describe('GET /api/music/playlists/recently-added', () => {
  it('works for a guest, orders by created_at descending and excludes tracks that are not completed', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'public' });
    insertMusicTrack(db, { id: 'old', artistId: 'a1', createdAt: 1000 });
    insertMusicTrack(db, { id: 'new', artistId: 'a1', createdAt: 2000 });
    insertMusicTrack(db, { id: 'pending', artistId: 'a1', createdAt: 3000, downloadStatus: 'pending' });

    const result: any = await recentlyAddedHandler(eventFor('/api/music/playlists/recently-added'));
    expect(ids(result)).toEqual(['new', 'old']);
  });

  it('excludes a private artist for a guest, includes it for a logged-in non-admin user', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'private' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });
    expect(ids(await recentlyAddedHandler(eventFor('/api/music/playlists/recently-added')))).toEqual([]);
    const cookie = loginAs('u1');
    expect(ids(await recentlyAddedHandler(eventFor('/api/music/playlists/recently-added', cookie)))).toEqual(['t1']);
  });
});

describe('GET /api/music/playlists/rediscover', () => {
  it('returns an empty list for a guest', async () => {
    const result: any = await rediscoverHandler(eventFor('/api/music/playlists/rediscover'));
    expect(result.tracks).toEqual([]);
  });

  it('excludes a track played by the current user within the last 30 days, keeps one played earlier', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'public' });
    insertMusicTrack(db, { id: 'recent', artistId: 'a1' });
    insertMusicTrack(db, { id: 'old', artistId: 'a1' });
    const cookie = loginAs('u1');
    insertMusicPlay(db, { id: 'p1', trackId: 'recent', userId: 'u1', playedAt: Date.now() });
    insertMusicPlay(db, { id: 'p2', trackId: 'old', userId: 'u1', playedAt: FORTY_DAYS_AGO });

    const result: any = await rediscoverHandler(eventFor('/api/music/playlists/rediscover', cookie));
    expect(ids(result)).toEqual(['old']);
  });
});

describe('GET /api/music/playlists/genre-mix', () => {
  it('returns 400 when genre is missing', async () => {
    await expect(genreMixHandler(eventFor('/api/music/playlists/genre-mix'))).rejects.toMatchObject({ statusCode: 400 });
  });

  it('returns only accessible tracks matching the requested genre, for a guest', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'public' });
    insertMusicArtist(db, { id: 'a2', visibility: 'private' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', genre: 'Rock' });
    insertMusicTrack(db, { id: 't2', artistId: 'a1', genre: 'Electro' });
    insertMusicTrack(db, { id: 't3', artistId: 'a2', genre: 'Rock' });

    const result: any = await genreMixHandler(eventFor('/api/music/playlists/genre-mix?genre=Rock'));
    expect(ids(result)).toEqual(['t1']);
  });

  it('is not vulnerable to SQL injection via the genre parameter', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'ultra_private' });
    insertMusicTrack(db, { id: 'secret', artistId: 'a1', genre: 'Rock' });

    const result: any = await genreMixHandler(eventFor(`/api/music/playlists/genre-mix?genre=${encodeURIComponent("Rock' OR '1'='1")}`));
    expect(result.tracks).toEqual([]);
  });
});

describe('GET /api/music/playlists/artist-mix', () => {
  it('returns 400 when artistId is missing', async () => {
    await expect(artistMixHandler(eventFor('/api/music/playlists/artist-mix'))).rejects.toMatchObject({ statusCode: 400 });
  });

  it('returns only completed tracks from the requested artist, for a guest', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'public' });
    insertMusicArtist(db, { id: 'a2', visibility: 'public' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });
    insertMusicTrack(db, { id: 'pending', artistId: 'a1', downloadStatus: 'pending' });
    insertMusicTrack(db, { id: 't2', artistId: 'a2' });

    const result: any = await artistMixHandler(eventFor('/api/music/playlists/artist-mix?artistId=a1'));
    expect(ids(result)).toEqual(['t1']);
  });

  it('excludes a private artist\'s tracks for a guest, includes them for a logged-in non-admin user', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'private' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });
    expect(ids(await artistMixHandler(eventFor('/api/music/playlists/artist-mix?artistId=a1')))).toEqual([]);
    const cookie = loginAs('u1');
    expect(ids(await artistMixHandler(eventFor('/api/music/playlists/artist-mix?artistId=a1', cookie)))).toEqual(['t1']);
  });
});

describe('GET /api/music/playlists/radio', () => {
  it('returns 400 when trackId is missing and 404 when it does not exist', async () => {
    await expect(radioHandler(eventFor('/api/music/playlists/radio'))).rejects.toMatchObject({ statusCode: 400 });
    await expect(radioHandler(eventFor('/api/music/playlists/radio?trackId=nope'))).rejects.toMatchObject({ statusCode: 404 });
  });

  it('caps same-artist tracks at RADIO_SAME_ARTIST_MAX (8) when the seed has a genre, filling the rest from the same genre', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'public' });
    insertMusicArtist(db, { id: 'a2', visibility: 'public' });
    insertMusicTrack(db, { id: 'seed', artistId: 'a1', genre: 'Rock' });
    for (let i = 0; i < 10; i++) {
      insertMusicTrack(db, { id: `same-artist-${i}`, artistId: 'a1', genre: 'Rock' });
    }
    for (let i = 0; i < 10; i++) {
      insertMusicTrack(db, { id: `same-genre-${i}`, artistId: 'a2', genre: 'Rock' });
    }

    const result: any = await radioHandler(eventFor('/api/music/playlists/radio?trackId=seed'));
    const sameArtistCount = result.tracks.filter((t: any) => t.artist_id === 'a1').length;
    expect(sameArtistCount).toBeLessThanOrEqual(8);
    expect(result.tracks.length).toBe(18); // 10 same-artist candidates capped at 8, plus 10 same-genre candidates (only 18 total exist)
    expect(ids(result)).not.toContain('seed');
  });

  it('excludes other genres and private artists (for a guest) when the seed has a genre', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'public' });
    insertMusicArtist(db, { id: 'a2', visibility: 'public' });
    insertMusicArtist(db, { id: 'a3', visibility: 'private' });
    insertMusicTrack(db, { id: 'seed', artistId: 'a1', genre: 'Rock' });
    insertMusicTrack(db, { id: 'rock', artistId: 'a2', genre: 'Rock' });
    insertMusicTrack(db, { id: 'other-genre', artistId: 'a2', genre: 'Electro' });
    insertMusicTrack(db, { id: 'hidden', artistId: 'a3', genre: 'Rock' });

    const result: any = await radioHandler(eventFor('/api/music/playlists/radio?trackId=seed'));
    expect(ids(result)).toEqual(['rock']);
  });

  it('falls back to same-artist-only when the seed has no genre', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'public' });
    insertMusicArtist(db, { id: 'a2', visibility: 'public' });
    insertMusicTrack(db, { id: 'seed', artistId: 'a1', genre: null });
    insertMusicTrack(db, { id: 'same-artist', artistId: 'a1', genre: null });
    insertMusicTrack(db, { id: 'other-artist', artistId: 'a2', genre: null });

    const result: any = await radioHandler(eventFor('/api/music/playlists/radio?trackId=seed'));
    expect(ids(result)).toEqual(['same-artist']);
  });
});
