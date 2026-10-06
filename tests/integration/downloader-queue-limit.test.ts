import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import handler from '../../server/api/admin/downloader/queue.get';
import { requireAdmin } from '../../server/utils/auth';
import {
  createTestDb, insertUser, insertSession, mockEvent, sessionCookie, insertChannel, insertVideo,
} from '../helpers/testDb';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
  (globalThis as any).requireAdmin = requireAdmin;
  insertUser(db, { id: 'admin', role: 'admin' });
  insertSession(db, { id: 'sess-admin', userId: 'admin' });
  insertChannel(db, { id: 'c1' });
});

const call = () => handler(mockEvent(sessionCookie('sess-admin'), { path: '/api/admin/downloader/queue' }));

describe('GET /api/admin/downloader/queue limit', () => {
  it('caps at 100 items, keeps downloading first, reports the full total', async () => {
    for (let i = 0; i < 150; i++) {
      insertVideo(db, { id: `p${i}`, channelId: 'c1', downloadStatus: 'pending', createdAt: 1000 + i });
    }
    // Created last, so only the ORDER BY (not insertion order) keeps them first.
    insertVideo(db, { id: 'd1', channelId: 'c1', downloadStatus: 'downloading', createdAt: 999999 });
    insertVideo(db, { id: 'd2', channelId: 'c1', downloadStatus: 'downloading', createdAt: 999999 });

    const res: any = await call();
    expect(res.queue).toHaveLength(100);
    expect(res.queue.slice(0, 2).map((v: any) => v.id).sort()).toEqual(['d1', 'd2']);
    expect(res.queue.slice(0, 2).every((v: any) => v.download_status === 'downloading')).toBe(true);
    expect(res.queueTotal).toBe(152);
  });

  it('reports queueTotal equal to the item count when under the cap', async () => {
    insertVideo(db, { id: 'a', channelId: 'c1', downloadStatus: 'pending' });
    insertVideo(db, { id: 'b', channelId: 'c1', downloadStatus: 'downloading' });
    insertVideo(db, { id: 'c', channelId: 'c1', downloadStatus: 'pending' });
    insertVideo(db, { id: 'done', channelId: 'c1', downloadStatus: 'completed' });
    const res: any = await call();
    expect(res.queue).toHaveLength(3);
    expect(res.queueTotal).toBe(3);
  });

  it('counts failed items in queueTotal and keeps the other fields', async () => {
    insertVideo(db, { id: 'f1', channelId: 'c1', downloadStatus: 'failed' });
    insertVideo(db, { id: 'p1', channelId: 'c1', downloadStatus: 'pending' });
    const res: any = await call();
    expect(res.queueTotal).toBe(2);
    expect(res.failedCount).toBe(1);
    expect(res.isPaused).toBe(false);
    expect(Array.isArray(res.history)).toBe(true);
  });
});
