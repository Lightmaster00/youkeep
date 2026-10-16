import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import crypto from 'crypto';
import {
  getUserFromSession, destroySession, computeCsrfToken, purgeExpiredSessions, startSessionCleanup,
  safeEqual, canAccessVideo, resetCsrfSecretCacheForTests
} from '../../server/utils/auth';
import csrfMiddleware from '../../server/middleware/csrf';
import personalPlaylistGet from '../../server/api/playlists/personal/[id].get';
import { createTestDb, insertUser, insertSession, insertChannel, insertVideo, mockEvent, sessionCookie } from '../helpers/testDb';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
  (globalThis as any).getUserFromSession = getUserFromSession;
  (globalThis as any).canAccessVideo = canAccessVideo;
  insertUser(db, { id: 'u1', role: 'user' });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function setCookieHeader(event: any): string {
  const raw = event.node.res.getHeader('set-cookie');
  return Array.isArray(raw) ? raw.join('\n') : String(raw ?? '');
}

describe('expired session purge', () => {
  it('purgeExpiredSessions deletes only expired rows', () => {
    insertSession(db, { id: 'old', userId: 'u1', expiresAt: Date.now() - 1 });
    insertSession(db, { id: 'live', userId: 'u1', expiresAt: Date.now() + 60_000 });
    expect(purgeExpiredSessions()).toBe(1);
    expect((db.prepare('SELECT id FROM sessions').all() as any[]).map((r) => r.id)).toEqual(['live']);
  });

  it('startSessionCleanup purges at once and then every hour', () => {
    vi.useFakeTimers();
    insertSession(db, { id: 'old', userId: 'u1', expiresAt: Date.now() - 1 });
    const stop = startSessionCleanup();
    expect(db.prepare("SELECT 1 FROM sessions WHERE id = 'old'").get()).toBeUndefined();
    insertSession(db, { id: 'later', userId: 'u1', expiresAt: Date.now() + 1000 });
    vi.advanceTimersByTime(60 * 60 * 1000 + 10);
    expect(db.prepare("SELECT 1 FROM sessions WHERE id = 'later'").get()).toBeUndefined();
    stop();
  });

  it('a purge failure does not throw', () => {
    (globalThis as any).getDb = () => { throw new Error('db closed'); };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => purgeExpiredSessions()).not.toThrow();
  });
});

describe('the CSRF cookie is cleared with the session cookie', () => {
  it('on logout', async () => {
    insertSession(db, { id: 's1', userId: 'u1' });
    const event = mockEvent(sessionCookie('s1'), { method: 'POST' });
    await destroySession(event);
    expect(setCookieHeader(event)).toMatch(/youkeep_session=;/);
    expect(setCookieHeader(event)).toMatch(/csrf_token=;/);
  });

  it('for an unknown session cookie', async () => {
    const event = mockEvent(sessionCookie('ghost'));
    expect(await getUserFromSession(event)).toBeNull();
    expect(setCookieHeader(event)).toMatch(/csrf_token=;/);
  });

  it('for an expired session cookie', async () => {
    insertSession(db, { id: 'old', userId: 'u1', expiresAt: Date.now() - 1 });
    const event = mockEvent(sessionCookie('old'));
    expect(await getUserFromSession(event)).toBeNull();
    expect(setCookieHeader(event)).toMatch(/csrf_token=;/);
  });
});

describe('persistent CSRF secret', () => {
  it('is stored in settings and survives a restart (module cache reset)', () => {
    resetCsrfSecretCacheForTests();
    const before = computeCsrfToken('sid');
    const stored = (db.prepare("SELECT value FROM settings WHERE key = 'csrf_secret'").get() as any)?.value;
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
    resetCsrfSecretCacheForTests();
    expect(computeCsrfToken('sid')).toBe(before);
  });

  it('falls back to an in-memory secret without a settings table', () => {
    resetCsrfSecretCacheForTests();
    const bare = new Database(':memory:');
    (globalThis as any).getDb = () => bare;
    expect(computeCsrfToken('sid')).toMatch(/^[0-9a-f]{64}$/);
    resetCsrfSecretCacheForTests();
  });
});

describe('timing-safe token comparisons', () => {
  it('safeEqual', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual(['abc'], 'abc')).toBe(false);
    expect(safeEqual(undefined, undefined)).toBe(false);
  });

  it('the CSRF header check uses crypto.timingSafeEqual', () => {
    const spy = vi.spyOn(crypto, 'timingSafeEqual');
    const token = computeCsrfToken('s9');
    expect(() => csrfMiddleware(mockEvent(`youkeep_session=s9; csrf_token=${token}`, { method: 'POST', headers: { 'x-csrf-token': token } }))).not.toThrow();
    expect(spy).toHaveBeenCalled();
  });

  it('video share tokens use crypto.timingSafeEqual', async () => {
    insertChannel(db, { id: 'c' });
    insertVideo(db, { id: 'v', channelId: 'c', visibility: 'ultra_private', shareToken: 'tok-123' });
    const spy = vi.spyOn(crypto, 'timingSafeEqual');
    expect(await canAccessVideo('v', mockEvent(), 'tok-123')).toBe(true);
    expect(await canAccessVideo('v', mockEvent(), 'tok-124')).toBe(false);
    expect(spy).toHaveBeenCalled();
  });

  it('personal playlist share tokens use crypto.timingSafeEqual and refuse array tokens', async () => {
    db.exec(`CREATE TABLE personal_playlists (id TEXT PRIMARY KEY, title TEXT, description TEXT, user_id TEXT, visibility TEXT, share_token TEXT, created_at INTEGER);
      CREATE TABLE personal_playlist_videos (playlist_id TEXT, video_id TEXT, position INTEGER, added_at INTEGER);`);
    db.prepare("INSERT INTO personal_playlists VALUES ('p1', 'T', NULL, 'u1', 'unlisted', 'pp-secret', 0)").run();
    const spy = vi.spyOn(crypto, 'timingSafeEqual');
    await expect(personalPlaylistGet(mockEvent(undefined, { path: '/api/playlists/personal/p1?token=pp-secret', params: { id: 'p1' } }))).resolves.toMatchObject({ playlist: { id: 'p1' } });
    expect(spy).toHaveBeenCalled();
    await expect(personalPlaylistGet(mockEvent(undefined, { path: '/api/playlists/personal/p1?token=pp-secreX', params: { id: 'p1' } }))).rejects.toMatchObject({ statusCode: 403 });
    await expect(personalPlaylistGet(mockEvent(undefined, { path: '/api/playlists/personal/p1?token=pp-secret&token=x', params: { id: 'p1' } }))).rejects.toMatchObject({ statusCode: 403 });
  });
});
