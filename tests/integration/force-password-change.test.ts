import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import middleware from '../../server/middleware/forcePasswordChange';
import { createApiToken } from '../../server/utils/apiTokens';
import { createTestDb, insertUser, insertSession, mockEvent, sessionCookie } from '../helpers/testDb';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
});

function mustChange(userId: string) {
  insertUser(db, { id: userId, role: 'user' });
  db.prepare('UPDATE users SET must_change_password = 1 WHERE id = ?').run(userId);
  insertSession(db, { id: `sess-${userId}`, userId });
  return sessionCookie(`sess-${userId}`);
}

describe('forcePasswordChange middleware', () => {
  it('blocks API routes for a session that must change its password', async () => {
    const cookie = mustChange('u1');
    await expect(middleware(mockEvent(cookie, { path: '/api/videos' }))).rejects.toMatchObject({ statusCode: 403 });
  });

  it('blocks an API token belonging to a user that must change their password', async () => {
    mustChange('u1');
    const { token } = createApiToken('u1', 'phone');
    const event = mockEvent(undefined, { path: '/api/account/tokens', headers: { authorization: `Bearer ${token}` } });
    await expect(middleware(event)).rejects.toMatchObject({ statusCode: 403 });
  });

  it('still allows the change-password flow (auth, password, profile, public settings)', async () => {
    const cookie = mustChange('u1');
    for (const path of ['/api/auth/me', '/api/account/password', '/api/account/profile', '/api/settings/content-search-mode']) {
      await expect(middleware(mockEvent(cookie, { path }))).resolves.toBeUndefined();
    }
  });

  it('ignores the query string when matching the allow-list', async () => {
    const cookie = mustChange('u1');
    await expect(middleware(mockEvent(cookie, { path: '/api/account/password?x=1' }))).resolves.toBeUndefined();
  });

  it('does not affect a normal user', async () => {
    insertUser(db, { id: 'ok', role: 'user' });
    insertSession(db, { id: 'sess-ok', userId: 'ok' });
    await expect(middleware(mockEvent(sessionCookie('sess-ok'), { path: '/api/videos' }))).resolves.toBeUndefined();
  });

  it('does not affect guests or non-API paths', async () => {
    await expect(middleware(mockEvent(undefined, { path: '/api/videos' }))).resolves.toBeUndefined();
    const cookie = mustChange('u2');
    await expect(middleware(mockEvent(cookie, { path: '/account' }))).resolves.toBeUndefined();
  });

  it('also blocks the media file routes outside /api', async () => {
    const cookie = mustChange('u1');
    for (const path of ['/downloads/chan/v.mp4', '/downloads-music/a/t.opus', '/downloads-podcasts/s/e.mp3']) {
      await expect(middleware(mockEvent(cookie, { path }))).rejects.toMatchObject({ statusCode: 403 });
    }
  });

  it('lets a user with a temporary password read the display settings but not write preferences', async () => {
    const cookie = mustChange('u1');
    await expect(middleware(mockEvent(cookie, { path: '/api/settings/display' }))).resolves.toBeUndefined();
    await expect(middleware(mockEvent(cookie, { path: '/api/account/preferences', method: 'PUT' }))).rejects.toMatchObject({ statusCode: 403 });
  });
});
