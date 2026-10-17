import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import handler from '../../server/api/admin/downloader/active-counts.get';
import { requireAdmin } from '../../server/utils/auth';
import {
  createTestDb, insertUser, insertSession, mockEvent, sessionCookie,
  insertChannel, insertVideo, insertMusicArtist, insertMusicTrack, insertPodcastShow, insertPodcastEpisode,
} from '../helpers/testDb';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
  (globalThis as any).requireAdmin = requireAdmin;
});

function loginAs(userId: string, role: 'admin' | 'user') {
  insertUser(db, { id: userId, role });
  insertSession(db, { id: `sess-${userId}`, userId });
  return sessionCookie(`sess-${userId}`);
}

const call = (cookie?: string) => handler(mockEvent(cookie, { path: '/api/admin/downloader/active-counts' }));

// Sources that are being downloaded (their pending items are picked up).
function seed() {
  insertChannel(db, { id: 'c1' });
  insertMusicArtist(db, { id: 'a1' });
  insertPodcastShow(db, { id: 's1', syncStatus: 'downloading' });
  db.prepare("UPDATE channels SET sync_status = 'downloading'").run();
  db.prepare("UPDATE music_artists SET sync_status = 'downloading'").run();
}

describe('GET /api/admin/downloader/active-counts', () => {
  it('returns 401 for a guest and 403 for a non-admin', async () => {
    await expect(call()).rejects.toMatchObject({ statusCode: 401 });
    await expect(call(loginAs('u1', 'user'))).rejects.toMatchObject({ statusCode: 403 });
  });

  it('returns zeros and nulls on an empty database', async () => {
    const res: any = await call(loginAs('admin', 'admin'));
    expect(res).toEqual({
      video: { downloading: 0, pending: 0, pausedPending: 0 },
      music: { downloading: 0, pending: 0, pausedPending: 0 },
      podcasts: { downloading: 0, pending: 0, pausedPending: 0 },
      total: 0,
      current: { kind: null, progress: null, speed: null },
      blockedReason: null,
    });
  });

  it('counts downloading and pending per table and sums them into total', async () => {
    const cookie = loginAs('admin', 'admin');
    seed();
    insertVideo(db, { id: 'v1', channelId: 'c1', downloadStatus: 'downloading' });
    insertVideo(db, { id: 'v2', channelId: 'c1', downloadStatus: 'pending' });
    insertVideo(db, { id: 'v3', channelId: 'c1', downloadStatus: 'pending' });
    insertVideo(db, { id: 'v4', channelId: 'c1', downloadStatus: 'completed' });
    insertVideo(db, { id: 'v5', channelId: 'c1', downloadStatus: 'failed' });
    insertMusicTrack(db, { id: 'm1', artistId: 'a1', downloadStatus: 'pending' });
    insertMusicTrack(db, { id: 'm2', artistId: 'a1', downloadStatus: 'downloading' });
    insertMusicTrack(db, { id: 'm3', artistId: 'a1', downloadStatus: 'completed' });
    insertPodcastEpisode(db, { id: 'e1', showId: 's1', downloadStatus: 'pending' });
    insertPodcastEpisode(db, { id: 'e2', showId: 's1', downloadStatus: 'pending' });
    insertPodcastEpisode(db, { id: 'e3', showId: 's1', downloadStatus: 'failed' });
    const res: any = await call(cookie);
    expect(res.video).toEqual({ downloading: 1, pending: 2, pausedPending: 0 });
    expect(res.music).toEqual({ downloading: 1, pending: 1, pausedPending: 0 });
    expect(res.podcasts).toEqual({ downloading: 0, pending: 2, pausedPending: 0 });
    expect(res.total).toBe(7);
  });

  it('current prefers a downloading video, then music, then podcasts', async () => {
    const cookie = loginAs('admin', 'admin');
    seed();
    insertVideo(db, { id: 'v1', channelId: 'c1', downloadStatus: 'downloading' });
    insertMusicTrack(db, { id: 'm1', artistId: 'a1', downloadStatus: 'downloading' });
    insertPodcastEpisode(db, { id: 'e1', showId: 's1', downloadStatus: 'downloading' });
    db.prepare("UPDATE videos SET download_progress = 10, download_speed = '1MB/s' WHERE id = 'v1'").run();
    db.prepare("UPDATE music_tracks SET download_progress = 20, download_speed = '2MB/s' WHERE id = 'm1'").run();
    db.prepare("UPDATE podcast_episodes SET download_progress = 30, download_speed = '3MB/s' WHERE id = 'e1'").run();

    expect(((await call(cookie)) as any).current).toEqual({ kind: 'video', progress: 10, speed: '1MB/s' });
    db.prepare("UPDATE videos SET download_status = 'completed' WHERE id = 'v1'").run();
    expect(((await call(cookie)) as any).current).toEqual({ kind: 'music', progress: 20, speed: '2MB/s' });
    db.prepare("UPDATE music_tracks SET download_status = 'completed' WHERE id = 'm1'").run();
    expect(((await call(cookie)) as any).current).toEqual({ kind: 'podcasts', progress: 30, speed: '3MB/s' });
  });

  it('a failing table yields zeros for it without a 500', async () => {
    const cookie = loginAs('admin', 'admin');
    seed();
    insertVideo(db, { id: 'v1', channelId: 'c1', downloadStatus: 'pending' });
    insertPodcastEpisode(db, { id: 'e1', showId: 's1', downloadStatus: 'pending' });
    db.exec('DROP TABLE music_tracks');
    const res: any = await call(cookie);
    expect(res.music).toEqual({ downloading: 0, pending: 0, pausedPending: 0 });
    expect(res.total).toBe(2);
  });

  it('pending items of paused channels, artists and shows are not queued work (UI #13)', async () => {
    const cookie = loginAs('admin', 'admin');
    seed();
    insertChannel(db, { id: 'cP' });
    insertMusicArtist(db, { id: 'aP' });
    insertPodcastShow(db, { id: 'sP', syncStatus: 'paused' });
    for (let i = 0; i < 3; i++) insertVideo(db, { id: `vp${i}`, channelId: 'cP', downloadStatus: 'pending' });
    // A manually queued video of a paused channel is picked up.
    insertVideo(db, { id: 'vq', channelId: 'cP', downloadStatus: 'pending' });
    db.prepare("UPDATE videos SET is_manually_queued = 1 WHERE id = 'vq'").run();
    insertVideo(db, { id: 'va', channelId: 'c1', downloadStatus: 'pending' });
    insertMusicTrack(db, { id: 'mp', artistId: 'aP', downloadStatus: 'pending' });
    insertPodcastEpisode(db, { id: 'ep1', showId: 'sP', downloadStatus: 'pending' });
    insertPodcastEpisode(db, { id: 'ep2', showId: 'sP', downloadStatus: 'pending' });
    const res: any = await call(cookie);
    expect(res.video).toEqual({ downloading: 0, pending: 2, pausedPending: 3 });
    expect(res.music).toEqual({ downloading: 0, pending: 0, pausedPending: 1 });
    expect(res.podcasts).toEqual({ downloading: 0, pending: 0, pausedPending: 2 });
    expect(res.total).toBe(2);
  });
});
