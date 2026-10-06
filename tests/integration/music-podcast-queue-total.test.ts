import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import musicQueue from '../../server/api/admin/music/queue.get';
import podcastQueue from '../../server/api/admin/podcasts/queue.get';
import { requireAdmin } from '../../server/utils/auth';
import {
  createTestDb, insertUser, insertSession, mockEvent, sessionCookie,
  insertMusicArtist, insertMusicTrack, insertPodcastShow, insertPodcastEpisode,
} from '../helpers/testDb';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
  (globalThis as any).requireAdmin = requireAdmin;
  insertUser(db, { id: 'admin', role: 'admin' });
  insertSession(db, { id: 'sess-admin', userId: 'admin' });
  insertMusicArtist(db, { id: 'a1' });
  insertPodcastShow(db, { id: 's1' });
});

const cookie = () => sessionCookie('sess-admin');

describe('GET /api/admin/music/queue queueTotal', () => {
  it('is 0 on an empty queue, then counts downloading, pending and failed tracks and keeps the list capped at 100', async () => {
    expect(((await musicQueue(mockEvent(cookie(), { path: '/api/admin/music/queue' }))) as any).queueTotal).toBe(0);
    for (let i = 0; i < 120; i++) insertMusicTrack(db, { id: `p${i}`, artistId: 'a1', downloadStatus: 'pending', createdAt: 1000 + i });
    insertMusicTrack(db, { id: 'd1', artistId: 'a1', downloadStatus: 'downloading', createdAt: 999999 });
    insertMusicTrack(db, { id: 'f1', artistId: 'a1', downloadStatus: 'failed' });
    insertMusicTrack(db, { id: 'done', artistId: 'a1', downloadStatus: 'completed' });

    const res: any = await musicQueue(mockEvent(cookie(), { path: '/api/admin/music/queue' }));
    expect(res.queue).toHaveLength(100);
    expect(res.queue[0].id).toBe('d1');
    expect(res.queueTotal).toBe(122);
    expect(res.failedCount).toBe(1);
    expect(Array.isArray(res.artists)).toBe(true);
    expect(Array.isArray(res.history)).toBe(true);
    expect(res.isPaused).toBe(false);
  });
});

describe('GET /api/admin/podcasts/queue queueTotal', () => {
  it('is 0 on an empty queue, then counts downloading, pending and failed episodes and keeps the list capped at 100', async () => {
    expect(((await podcastQueue(mockEvent(cookie(), { path: '/api/admin/podcasts/queue' }))) as any).queueTotal).toBe(0);
    for (let i = 0; i < 110; i++) insertPodcastEpisode(db, { id: `p${i}`, showId: 's1', downloadStatus: 'pending', createdAt: 1000 + i });
    insertPodcastEpisode(db, { id: 'd1', showId: 's1', downloadStatus: 'downloading', createdAt: 999999 });
    insertPodcastEpisode(db, { id: 'f1', showId: 's1', downloadStatus: 'failed' });
    insertPodcastEpisode(db, { id: 'f2', showId: 's1', downloadStatus: 'failed' });
    insertPodcastEpisode(db, { id: 'done', showId: 's1', downloadStatus: 'completed' });

    const res: any = await podcastQueue(mockEvent(cookie(), { path: '/api/admin/podcasts/queue' }));
    expect(res.queue).toHaveLength(100);
    expect(res.queue[0].id).toBe('d1');
    expect(res.queueTotal).toBe(113);
    expect(res.failedCount).toBe(2);
    expect(Array.isArray(res.shows)).toBe(true);
  });
});
