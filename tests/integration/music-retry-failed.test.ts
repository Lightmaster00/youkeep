import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import retryFailedHandler from '../../server/api/admin/music/retry-failed.post';
import * as musicDownloader from '../../server/utils/musicDownloader';
import { requireAdmin } from '../../server/utils/auth';
import {
  createTestDb,
  insertUser,
  insertSession,
  insertMusicArtist,
  insertMusicTrack,
  mockEvent,
  sessionCookie
} from '../helpers/testDb';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
  (globalThis as any).requireAdmin = requireAdmin;
  (globalThis as any).startMusicQueueWorker = musicDownloader.startMusicQueueWorker;
  vi.restoreAllMocks();
});

function loginAs(userId: string, role: 'admin' | 'user' = 'user') {
  insertUser(db, { id: userId, role });
  const sessionId = `sess-${userId}`;
  insertSession(db, { id: sessionId, userId });
  return sessionCookie(sessionId);
}

describe('POST /api/admin/music/retry-failed', () => {
  it('returns 401 for a guest and 403 for a non-admin', async () => {
    await expect(retryFailedHandler(mockEvent(undefined, { path: '/api/admin/music/retry-failed', body: {} }))).rejects.toMatchObject({ statusCode: 401 });
    const cookie = loginAs('u1', 'user');
    await expect(retryFailedHandler(mockEvent(cookie, { path: '/api/admin/music/retry-failed', body: {} }))).rejects.toMatchObject({ statusCode: 403 });
  });

  it('resets a single failed track to pending with retry_count/last_error cleared, and leaves a non-failed track alone', async () => {
    vi.spyOn(musicDownloader, 'startMusicQueueWorker').mockImplementation(async () => {});
    insertMusicArtist(db, { id: 'a1' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', downloadStatus: 'failed' });
    insertMusicTrack(db, { id: 't2', artistId: 'a1', downloadStatus: 'completed' });
    db.prepare('UPDATE music_tracks SET retry_count = 3, last_error = ? WHERE id = ?').run('some error', 't1');

    const cookie = loginAs('admin1', 'admin');
    await retryFailedHandler(mockEvent(cookie, { path: '/api/admin/music/retry-failed', body: { trackId: 't1' } }));
    await retryFailedHandler(mockEvent(cookie, { path: '/api/admin/music/retry-failed', body: { trackId: 't2' } }));

    const row = db.prepare('SELECT download_status, retry_count, last_error FROM music_tracks WHERE id = ?').get('t1') as any;
    expect(row).toEqual({ download_status: 'pending', retry_count: 0, last_error: null });
    expect((db.prepare('SELECT download_status FROM music_tracks WHERE id = ?').get('t2') as any).download_status).toBe('completed');
  });

  it('resets all failed tracks to pending with retry_count reset to 0 when no trackId is given', async () => {
    vi.spyOn(musicDownloader, 'startMusicQueueWorker').mockImplementation(async () => {});
    insertMusicArtist(db, { id: 'a1' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', downloadStatus: 'failed' });
    insertMusicTrack(db, { id: 't2', artistId: 'a1', downloadStatus: 'failed' });
    insertMusicTrack(db, { id: 't3', artistId: 'a1', downloadStatus: 'completed' });
    db.prepare('UPDATE music_tracks SET retry_count = 3 WHERE id IN (?, ?)').run('t1', 't2');

    const cookie = loginAs('admin1', 'admin');
    await retryFailedHandler(mockEvent(cookie, { path: '/api/admin/music/retry-failed', body: {} }));

    const t1 = db.prepare('SELECT download_status, retry_count FROM music_tracks WHERE id = ?').get('t1') as any;
    const t2 = db.prepare('SELECT download_status, retry_count FROM music_tracks WHERE id = ?').get('t2') as any;
    const t3 = db.prepare('SELECT download_status FROM music_tracks WHERE id = ?').get('t3') as any;
    expect(t1.download_status).toBe('pending');
    expect(t1.retry_count).toBe(0);
    expect(t2.download_status).toBe('pending');
    expect(t2.retry_count).toBe(0);
    expect(t3.download_status).toBe('completed');
  });
});
