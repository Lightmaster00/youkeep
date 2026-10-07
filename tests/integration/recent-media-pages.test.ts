import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import recentlyAddedHandler from '../../server/api/music/playlists/recently-added.get';
import recentEpisodesHandler from '../../server/api/podcasts/episodes/recent.get';
import {
  createTestDb, insertUser, insertSession, insertMusicArtist, insertMusicTrack,
  insertPodcastShow, insertPodcastEpisode, mockEvent, sessionCookie,
} from '../helpers/testDb';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
});

function cookieFor(userId: string, role: 'admin' | 'user' = 'user') {
  insertUser(db, { id: userId, role });
  insertSession(db, { id: `sess-${userId}`, userId });
  return sessionCookie(`sess-${userId}`);
}
const ev = (path: string, cookie?: string) => mockEvent(cookie, { path });

describe('GET /api/music/playlists/recently-added (Recent page)', () => {
  beforeEach(() => {
    insertMusicArtist(db, { id: 'a1', visibility: 'public' });
    insertMusicArtist(db, { id: 'a2', visibility: 'private' });
    for (let i = 0; i < 5; i++) {
      insertMusicTrack(db, { id: `p${i}`, artistId: 'a1', localFilePath: `/m/p${i}`, createdAt: 1000 + i * 10 });
      insertMusicTrack(db, { id: `x${i}`, artistId: 'a2', localFilePath: `/m/x${i}`, createdAt: 1005 + i * 10 });
    }
    insertMusicTrack(db, { id: 'pending', artistId: 'a1', downloadStatus: 'pending', createdAt: 9999 });
  });

  it('keeps its historical 30-track default when called without paging', async () => {
    for (let i = 0; i < 40; i++) insertMusicTrack(db, { id: `bulk${i}`, artistId: 'a1', createdAt: 100 + i });
    const r: any = await recentlyAddedHandler(ev('/api/music/playlists/recently-added'));
    expect(r.tracks).toHaveLength(30);
  });

  it('pages newest first across artists with a total, filtered by visibility', async () => {
    const cookie = cookieFor('u1');
    const page1: any = await recentlyAddedHandler(ev('/api/music/playlists/recently-added?limit=4&offset=0', cookie));
    expect(page1.tracks.map((t: any) => t.id)).toEqual(['x4', 'p4', 'x3', 'p3']);
    expect(page1.total).toBe(10);
    const page3: any = await recentlyAddedHandler(ev('/api/music/playlists/recently-added?limit=4&offset=8', cookie));
    expect(page3.tracks.map((t: any) => t.id)).toEqual(['x0', 'p0']);

    const guest: any = await recentlyAddedHandler(ev('/api/music/playlists/recently-added?limit=50'));
    expect(guest.tracks.map((t: any) => t.id)).toEqual(['p4', 'p3', 'p2', 'p1', 'p0']);
    expect(guest.total).toBe(5);
  });

  it('clamps bad paging values', async () => {
    const r: any = await recentlyAddedHandler(ev('/api/music/playlists/recently-added?limit=abc&offset=-3'));
    expect(r.tracks).toHaveLength(5);
    for (let i = 0; i < 120; i++) insertMusicTrack(db, { id: `bulk${i}`, artistId: 'a1', createdAt: 100 + i });
    const big: any = await recentlyAddedHandler(ev('/api/music/playlists/recently-added?limit=100000'));
    expect(big.tracks).toHaveLength(100);
    expect(big.total).toBe(125);
  });
});

describe('GET /api/podcasts/episodes/recent', () => {
  beforeEach(() => {
    insertPodcastShow(db, { id: 's1', title: 'Public show', visibility: 'public' });
    insertPodcastShow(db, { id: 's2', title: 'Private show', visibility: 'private' });
    insertPodcastShow(db, { id: 's3', title: 'Hidden show', visibility: 'hidden' });
    for (let i = 0; i < 3; i++) {
      insertPodcastEpisode(db, { id: `a${i}`, showId: 's1', localFilePath: `/p/a${i}`, createdAt: 1000 + i * 10 });
      insertPodcastEpisode(db, { id: `b${i}`, showId: 's2', localFilePath: `/p/b${i}`, createdAt: 1005 + i * 10 });
    }
    insertPodcastEpisode(db, { id: 'h0', showId: 's3', localFilePath: '/p/h0', createdAt: 5000 });
    insertPodcastEpisode(db, { id: 'pending', showId: 's1', downloadStatus: 'pending', createdAt: 9999 });
  });

  it('pages newest first across shows with show info and a total', async () => {
    const cookie = cookieFor('u1');
    const page1: any = await recentEpisodesHandler(ev('/api/podcasts/episodes/recent?limit=4&offset=0', cookie));
    expect(page1.episodes.map((e: any) => e.id)).toEqual(['b2', 'a2', 'b1', 'a1']);
    expect(page1.total).toBe(6);
    expect(page1.episodes[0]).toMatchObject({ show_id: 's2', show_title: 'Private show', local_file_path: '/p/b2' });
    const page2: any = await recentEpisodesHandler(ev('/api/podcasts/episodes/recent?limit=4&offset=4', cookie));
    expect(page2.episodes.map((e: any) => e.id)).toEqual(['b0', 'a0']);
  });

  it('follows the podcast visibility rules', async () => {
    const guest: any = await recentEpisodesHandler(ev('/api/podcasts/episodes/recent'));
    expect(guest.episodes.map((e: any) => e.id)).toEqual(['a2', 'a1', 'a0']);
    expect(guest.total).toBe(3);
    const admin: any = await recentEpisodesHandler(ev('/api/podcasts/episodes/recent', cookieFor('boss', 'admin')));
    expect(admin.episodes[0].id).toBe('h0');
    expect(admin.total).toBe(7);
  });

  it('clamps bad paging values', async () => {
    const r: any = await recentEpisodesHandler(ev('/api/podcasts/episodes/recent?limit=0&offset=nope'));
    expect(r.episodes).toHaveLength(3);
  });
});
