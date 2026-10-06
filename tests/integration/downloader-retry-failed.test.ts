import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import retryFailedHandler from '../../server/api/admin/downloader/retry-failed.post';
import * as downloader from '../../server/utils/downloader';
import { requireAdmin } from '../../server/utils/auth';
import {
  createTestDb,
  insertUser,
  insertSession,
  insertChannel,
  insertVideo,
  mockEvent,
  sessionCookie
} from '../helpers/testDb';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
  (globalThis as any).requireAdmin = requireAdmin;
  (globalThis as any).startQueueWorker = downloader.startQueueWorker;
  vi.restoreAllMocks();
});

function loginAs(userId: string, role: 'admin' | 'user' = 'user') {
  insertUser(db, { id: userId, role });
  const sessionId = `sess-${userId}`;
  insertSession(db, { id: sessionId, userId });
  return sessionCookie(sessionId);
}

describe('POST /api/admin/downloader/retry-failed', () => {
  it('returns 401 for a guest and 403 for a non-admin', async () => {
    await expect(retryFailedHandler(mockEvent(undefined, { path: '/api/admin/downloader/retry-failed', body: {} }))).rejects.toMatchObject({ statusCode: 401 });
    const cookie = loginAs('u1', 'user');
    await expect(retryFailedHandler(mockEvent(cookie, { path: '/api/admin/downloader/retry-failed', body: {} }))).rejects.toMatchObject({ statusCode: 403 });
  });

  it('resets a single failed video to pending with retry_count/last_error cleared, and leaves a non-failed video alone', async () => {
    vi.spyOn(downloader, 'startQueueWorker').mockImplementation(async () => {});
    insertChannel(db, { id: 'c1' });
    insertVideo(db, { id: 'v1', channelId: 'c1', downloadStatus: 'failed' });
    insertVideo(db, { id: 'v2', channelId: 'c1', downloadStatus: 'completed' });
    db.prepare('UPDATE videos SET retry_count = 3, last_error = ? WHERE id = ?').run('some error', 'v1');

    const cookie = loginAs('admin1', 'admin');
    await retryFailedHandler(mockEvent(cookie, { path: '/api/admin/downloader/retry-failed', body: { videoId: 'v1' } }));
    await retryFailedHandler(mockEvent(cookie, { path: '/api/admin/downloader/retry-failed', body: { videoId: 'v2' } }));

    const row = db.prepare('SELECT download_status, retry_count, last_error FROM videos WHERE id = ?').get('v1') as any;
    expect(row).toEqual({ download_status: 'pending', retry_count: 0, last_error: null });
    expect((db.prepare('SELECT download_status FROM videos WHERE id = ?').get('v2') as any).download_status).toBe('completed');
  });

  it('resets all failed videos to pending with retry_count reset to 0 when no videoId is given', async () => {
    vi.spyOn(downloader, 'startQueueWorker').mockImplementation(async () => {});
    insertChannel(db, { id: 'c1' });
    insertVideo(db, { id: 'v1', channelId: 'c1', downloadStatus: 'failed' });
    insertVideo(db, { id: 'v2', channelId: 'c1', downloadStatus: 'failed' });
    insertVideo(db, { id: 'v3', channelId: 'c1', downloadStatus: 'completed' });
    db.prepare('UPDATE videos SET retry_count = 3 WHERE id IN (?, ?)').run('v1', 'v2');

    const cookie = loginAs('admin1', 'admin');
    await retryFailedHandler(mockEvent(cookie, { path: '/api/admin/downloader/retry-failed', body: {} }));

    const v1 = db.prepare('SELECT download_status, retry_count FROM videos WHERE id = ?').get('v1') as any;
    const v2 = db.prepare('SELECT download_status, retry_count FROM videos WHERE id = ?').get('v2') as any;
    const v3 = db.prepare('SELECT download_status FROM videos WHERE id = ?').get('v3') as any;
    expect(v1.download_status).toBe('pending');
    expect(v1.retry_count).toBe(0);
    expect(v2.download_status).toBe('pending');
    expect(v2.retry_count).toBe(0);
    expect(v3.download_status).toBe('completed');
  });
});
