import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import mostPlayedHandler from '../../server/api/music/playlists/most-played.get';
import recentlyAddedHandler from '../../server/api/music/playlists/recently-added.get';
import rediscoverHandler from '../../server/api/music/playlists/rediscover.get';
import genreMixHandler from '../../server/api/music/playlists/genre-mix.get';
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
    expect(result.tracks.map((t: any) => t.id)).toEqual(['t2', 't1']);
  });

  it('excludes a private artist for a user without access', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'ultra_private' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });
    const cookie = loginAs('u1');
    insertMusicPlay(db, { id: 'p1', trackId: 't1', userId: 'u1' });

    const result: any = await mostPlayedHandler(eventFor('/api/music/playlists/most-played', cookie));
    expect(result.tracks).toEqual([]);
  });

  it('includes an ultra_private artist for an admin', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'ultra_private' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });
    const cookie = loginAs('admin1', 'admin');
    insertMusicPlay(db, { id: 'p1', trackId: 't1', userId: 'admin1' });

    const result: any = await mostPlayedHandler(eventFor('/api/music/playlists/most-played', cookie));
    expect(result.tracks.map((t: any) => t.id)).toEqual(['t1']);
  });

  it('includes has_clip', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'public' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', hasClip: true });
    const cookie = loginAs('u1');
    insertMusicPlay(db, { id: 'p1', trackId: 't1', userId: 'u1' });

    const result: any = await mostPlayedHandler(eventFor('/api/music/playlists/most-played', cookie));
    expect(result.tracks[0].has_clip).toBe(1);
  });
});

describe('GET /api/music/playlists/recently-added', () => {
  it('works for a guest and orders by created_at descending', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'public' });
    insertMusicTrack(db, { id: 'old', artistId: 'a1', createdAt: 1000 });
    insertMusicTrack(db, { id: 'new', artistId: 'a1', createdAt: 2000 });

    const result: any = await recentlyAddedHandler(eventFor('/api/music/playlists/recently-added'));
    expect(result.tracks.map((t: any) => t.id)).toEqual(['new', 'old']);
  });

  it('excludes tracks that are not completed', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'public' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', downloadStatus: 'pending' });

    const result: any = await recentlyAddedHandler(eventFor('/api/music/playlists/recently-added'));
    expect(result.tracks).toEqual([]);
  });

  it('excludes a private artist for a guest', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'private' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });

    const result: any = await recentlyAddedHandler(eventFor('/api/music/playlists/recently-added'));
    expect(result.tracks).toEqual([]);
  });

  it('includes a private artist for a logged-in non-admin user', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'private' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });
    const cookie = loginAs('u1');

    const result: any = await recentlyAddedHandler(eventFor('/api/music/playlists/recently-added', cookie));
    expect(result.tracks.map((t: any) => t.id)).toEqual(['t1']);
  });

  it('includes has_clip', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'public' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', hasClip: true });

    const result: any = await recentlyAddedHandler(eventFor('/api/music/playlists/recently-added'));
    expect(result.tracks[0].has_clip).toBe(1);
  });
});

describe('GET /api/music/playlists/rediscover', () => {
  it('returns an empty list for a guest', async () => {
    const result: any = await rediscoverHandler(eventFor('/api/music/playlists/rediscover'));
    expect(result.tracks).toEqual([]);
  });

  it('excludes a track played by the current user within the last 30 days', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'public' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });
    insertMusicTrack(db, { id: 't2', artistId: 'a1' });
    const cookie = loginAs('u1');
    insertMusicPlay(db, { id: 'p1', trackId: 't1', userId: 'u1', playedAt: Date.now() });

    const result: any = await rediscoverHandler(eventFor('/api/music/playlists/rediscover', cookie));
    expect(result.tracks.map((t: any) => t.id)).toEqual(['t2']);
  });

  it('includes a track played more than 30 days ago', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'public' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });
    const cookie = loginAs('u1');
    const fortyDaysAgo = Date.now() - 1000 * 60 * 60 * 24 * 40;
    insertMusicPlay(db, { id: 'p1', trackId: 't1', userId: 'u1', playedAt: fortyDaysAgo });

    const result: any = await rediscoverHandler(eventFor('/api/music/playlists/rediscover', cookie));
    expect(result.tracks.map((t: any) => t.id)).toEqual(['t1']);
  });

  it('includes has_clip', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'public' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', hasClip: true });
    const cookie = loginAs('u1');
    const fortyDaysAgo = Date.now() - 1000 * 60 * 60 * 24 * 40;
    insertMusicPlay(db, { id: 'p1', trackId: 't1', userId: 'u1', playedAt: fortyDaysAgo });

    const result: any = await rediscoverHandler(eventFor('/api/music/playlists/rediscover', cookie));
    expect(result.tracks[0].has_clip).toBe(1);
  });
});

describe('GET /api/music/playlists/genre-mix', () => {
  it('returns 400 when genre is missing', async () => {
    await expect(genreMixHandler(eventFor('/api/music/playlists/genre-mix'))).rejects.toMatchObject({ statusCode: 400 });
  });

  it('returns only tracks matching the requested genre, for a guest', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'public' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', genre: 'Rock' });
    insertMusicTrack(db, { id: 't2', artistId: 'a1', genre: 'Electro' });

    const result: any = await genreMixHandler(eventFor('/api/music/playlists/genre-mix?genre=Rock'));
    expect(result.tracks.map((t: any) => t.id)).toEqual(['t1']);
  });

  it('excludes a private artist\'s tracks for a guest', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'private' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', genre: 'Rock' });

    const result: any = await genreMixHandler(eventFor('/api/music/playlists/genre-mix?genre=Rock'));
    expect(result.tracks).toEqual([]);
  });

  it('is not vulnerable to SQL injection via the genre parameter', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'ultra_private' });
    insertMusicTrack(db, { id: 'secret', artistId: 'a1', genre: 'Rock' });

    const result: any = await genreMixHandler(eventFor(`/api/music/playlists/genre-mix?genre=${encodeURIComponent("Rock' OR '1'='1")}`));
    expect(result.tracks).toEqual([]);
  });

  it('includes has_clip', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'public' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', genre: 'Rock', hasClip: true });

    const result: any = await genreMixHandler(eventFor('/api/music/playlists/genre-mix?genre=Rock'));
    expect(result.tracks[0].has_clip).toBe(1);
  });
});
