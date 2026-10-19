import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import {
  getUserFromSession, purgeExpiredSessions, hashPassword, SESSION_DURATION, SESSION_IDLE_TIMEOUT, SESSION_SEEN_WRITE_INTERVAL_MS,
} from '../../server/utils/auth';
import { resetAllRateLimits } from '../../server/utils/rateLimit';
import loginPost from '../../server/api/auth/login.post';
import passwordPut from '../../server/api/account/password.put';
import { createTestDb, insertUser, mockEvent, sessionCookie } from '../helpers/testDb';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
let db: Database.Database;

beforeEach(async () => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
  resetAllRateLimits();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  insertUser(db, { id: 'u1', role: 'user' });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword('right-password-1'), 'u1');
});

const session = (id: string) => db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as any;

function addSession(id: string, opts: { remember: boolean; lastSeen: number | null; created?: number }) {
  const created = opts.created ?? Date.now() - HOUR;
  db.prepare('INSERT INTO sessions (id, user_id, expires_at, last_seen_at, remember) VALUES (?, ?, ?, ?, ?)')
    .run(id, 'u1', created + SESSION_DURATION, opts.lastSeen, opts.remember ? 1 : 0);
}

async function login(body: Record<string, unknown>): Promise<string> {
  const event = mockEvent(undefined, { method: 'POST', body: { username: 'user_u1', password: 'right-password-1', ...body } });
  await loginPost(event);
  const cookies = [event.node.res.headers['set-cookie']].flat().join(';');
  return /youkeep_session=([^;]+)/.exec(cookies)![1]!;
}

describe('remember me', () => {
  it('is off unless the login asks for it, and stored on the session with last_seen_at', async () => {
    const plain = await login({});
    const remembered = await login({ remember: true });
    expect(session(plain)).toMatchObject({ remember: 0 });
    expect(session(remembered)).toMatchObject({ remember: 1 });
    expect(session(plain).last_seen_at).toBeGreaterThan(Date.now() - MIN);
  }, 30_000);

  it('the idle limits are 24 hours, and 7 days (the lifetime) with remember me', () => {
    expect(SESSION_IDLE_TIMEOUT).toBe(24 * HOUR);
    expect(SESSION_DURATION).toBe(7 * 24 * HOUR);
  });
});

describe('idle timeout', () => {
  it('ends a session without remember me after 24 h of inactivity', async () => {
    addSession('idle', { remember: false, lastSeen: Date.now() - 24 * HOUR - MIN });
    expect(await getUserFromSession(mockEvent(sessionCookie('idle')))).toBeNull();
    expect(session('idle')).toBeUndefined();
  });

  it('keeps a session without remember me that was used within 24 h', async () => {
    addSession('active', { remember: false, lastSeen: Date.now() - 23 * HOUR });
    expect(await getUserFromSession(mockEvent(sessionCookie('active')))).toMatchObject({ id: 'u1' });
  });

  it('keeps a remembered session idle for days, until its 7-day lifetime', async () => {
    addSession('kept', { remember: true, lastSeen: Date.now() - 5 * 24 * HOUR, created: Date.now() - 5 * 24 * HOUR });
    expect(await getUserFromSession(mockEvent(sessionCookie('kept')))).toMatchObject({ id: 'u1' });
  });

  it('sessions from before the migration (no last_seen_at) count from their creation', async () => {
    addSession('old-idle', { remember: false, lastSeen: null, created: Date.now() - 2 * 24 * HOUR });
    addSession('old-fresh', { remember: false, lastSeen: null, created: Date.now() - HOUR });
    expect(await getUserFromSession(mockEvent(sessionCookie('old-idle')))).toBeNull();
    expect(await getUserFromSession(mockEvent(sessionCookie('old-fresh')))).toMatchObject({ id: 'u1' });
  });

  it('the hourly purge removes idle sessions too', () => {
    addSession('idle', { remember: false, lastSeen: Date.now() - 25 * HOUR });
    addSession('fine', { remember: false, lastSeen: Date.now() - HOUR });
    addSession('remembered', { remember: true, lastSeen: Date.now() - 25 * HOUR });
    purgeExpiredSessions();
    expect((db.prepare('SELECT id FROM sessions ORDER BY id').all() as any[]).map((r) => r.id)).toEqual(['fine', 'remembered']);
  });
});

describe('last_seen_at updates', () => {
  it(`writes at most once every ${SESSION_SEEN_WRITE_INTERVAL_MS / MIN} minutes`, async () => {
    expect(SESSION_SEEN_WRITE_INTERVAL_MS).toBe(5 * MIN);
    const recent = Date.now() - 2 * MIN;
    addSession('s', { remember: false, lastSeen: recent });
    await getUserFromSession(mockEvent(sessionCookie('s')));
    expect(session('s').last_seen_at).toBe(recent);
    const stale = Date.now() - 6 * MIN;
    db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(stale, 's');
    await getUserFromSession(mockEvent(sessionCookie('s')));
    expect(session('s').last_seen_at).toBeGreaterThan(stale);
  });
});

describe('password change keeps the remember-me choice', () => {
  it.each([true, false])('remember %s', async (remember) => {
    const sid = await login({ remember });
    const event = mockEvent(sessionCookie(sid), { method: 'PUT', body: { currentPassword: 'right-password-1', password: 'new-password-123' } });
    await passwordPut(event);
    const rows = db.prepare('SELECT remember FROM sessions').all() as any[];
    expect(rows).toEqual([{ remember: remember ? 1 : 0 }]);
  }, 30_000);
});
