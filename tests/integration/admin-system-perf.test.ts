import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import handler from '../../server/api/admin/system/perf.get';
import { requireAdmin } from '../../server/utils/auth';
import { getLoopMonitor } from '../../server/utils/loopMonitor';
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
const call = (cookie?: string) => handler(mockEvent(cookie, { path: '/api/admin/system/perf' }));

describe('GET /api/admin/system/perf', () => {
  it('is admin only', async () => {
    await expect(call()).rejects.toMatchObject({ statusCode: 401 });
    await expect(call(loginAs('u1', 'user'))).rejects.toMatchObject({ statusCode: 403 });
  });

  it('returns the monitor summary and the number of running downloads', async () => {
    insertChannel(db, { id: 'c1' });
    insertMusicArtist(db, { id: 'a1' });
    insertPodcastShow(db, { id: 's1' });
    insertVideo(db, { id: 'v1', channelId: 'c1', downloadStatus: 'downloading' });
    insertVideo(db, { id: 'v2', channelId: 'c1', downloadStatus: 'pending' });
    insertMusicTrack(db, { id: 'm1', artistId: 'a1', downloadStatus: 'downloading' });
    insertPodcastEpisode(db, { id: 'e1', showId: 's1', downloadStatus: 'downloading' });
    insertPodcastEpisode(db, { id: 'e2', showId: 's1', downloadStatus: 'completed' });

    const res: any = await call(loginAs('admin', 'admin'));
    expect(res).toEqual({ ...getLoopMonitor().summary(), activeDownloads: 3 });
    expect(Object.keys(res.current)).toEqual(['maxMs', 'p99Ms']);
    expect(Object.keys(res.last15min)).toEqual(['maxMs', 'p99Ms', 'stalls']);
  });
});
