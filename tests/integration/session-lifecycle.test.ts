import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { createSession, destroySession, getUserFromSession } from '../../server/utils/auth';
import logoutHandler from '../../server/api/auth/logout.post';
import meHandler from '../../server/api/auth/me.get';
import profileHandler from '../../server/api/account/profile.get';
import { createTestDb, insertUser, mockEvent, sessionCookie } from '../helpers/testDb';

let db: Database.Database;
const savedSecure = process.env.COOKIE_SECURE;
const savedTrust = process.env.TRUST_PROXY;

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
  (globalThis as any).getUserFromSession = getUserFromSession;
  (globalThis as any).destroySession = destroySession;
  delete process.env.COOKIE_SECURE;
  delete process.env.TRUST_PROXY;
  insertUser(db, { id: 'u1', role: 'user' });
});

afterEach(() => {
  if (savedSecure === undefined) delete process.env.COOKIE_SECURE; else process.env.COOKIE_SECURE = savedSecure;
  if (savedTrust === undefined) delete process.env.TRUST_PROXY; else process.env.TRUST_PROXY = savedTrust;
});

/** The Set-Cookie lines a mock event collected, keyed by cookie name. */
function setCookies(event: any): Record<string, string> {
  const raw = event.node.res.headers['set-cookie'];
  const lines: string[] = raw === undefined ? [] : Array.isArray(raw) ? raw.flat() : [raw];
  return Object.fromEntries(lines.map((l) => [l.split('=')[0], l]));
}
const attrs = (line: string) => line.split(';').slice(1).map((a) => a.trim().toLowerCase());
const sessionRows = () => (db.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }).n;

describe('createSession cookie flags', () => {
  it('the session cookie is HttpOnly and SameSite=Lax; the CSRF cookie is SameSite=Lax but readable by JS', async () => {
    const event = mockEvent();
    await createSession('u1', event);
    const c = setCookies(event);
    const session = attrs(c.youkeep_session);
    expect(session).toContain('httponly');
    expect(session).toContain('samesite=lax');
    expect(session).toContain('path=/');
    expect(session).not.toContain('secure');
    const csrf = attrs(c.csrf_token);
    expect(csrf).not.toContain('httponly');
    expect(csrf).toContain('samesite=lax');
  });

  it('both cookies are Secure behind a trusted HTTPS proxy', async () => {
    process.env.TRUST_PROXY = 'true';
    const event = mockEvent(undefined, { headers: { 'x-forwarded-proto': 'https' } });
    await createSession('u1', event);
    const c = setCookies(event);
    expect(attrs(c.youkeep_session)).toContain('secure');
    expect(attrs(c.csrf_token)).toContain('secure');
  });

  it('an untrusted X-Forwarded-Proto does not make the cookie Secure', async () => {
    const event = mockEvent(undefined, { headers: { 'x-forwarded-proto': 'https' } });
    await createSession('u1', event);
    expect(attrs(setCookies(event).youkeep_session)).not.toContain('secure');
  });

  it('COOKIE_SECURE=true forces Secure on plain HTTP', async () => {
    process.env.COOKIE_SECURE = 'true';
    const event = mockEvent();
    await createSession('u1', event);
    expect(attrs(setCookies(event).youkeep_session)).toContain('secure');
  });
});

describe('logout', () => {
  async function login(): Promise<string> {
    const event = mockEvent();
    return createSession('u1', event);
  }

  it('destroySession deletes the session row and clears both cookies', async () => {
    const sid = await login();
    const other = await login();
    expect(sessionRows()).toBe(2);
    const event = mockEvent(sessionCookie(sid));
    await destroySession(event);
    expect(db.prepare('SELECT id FROM sessions').all()).toEqual([{ id: other }]);
    const c = setCookies(event);
    expect(c.youkeep_session).toMatch(/max-age=0|expires=thu, 01 jan 1970/i);
    expect(c.csrf_token).toMatch(/max-age=0|expires=thu, 01 jan 1970/i);
  });

  it('POST /api/auth/logout removes the session; a replayed cookie is a guest and gets 401', async () => {
    const sid = await login();
    expect(await getUserFromSession(mockEvent(sessionCookie(sid)))).toMatchObject({ id: 'u1' });

    expect(await logoutHandler(mockEvent(sessionCookie(sid), { method: 'POST' }))).toEqual({ success: true });
    expect(sessionRows()).toBe(0);

    expect(await getUserFromSession(mockEvent(sessionCookie(sid)))).toBeNull();
    expect(await meHandler(mockEvent(sessionCookie(sid)))).toEqual({ user: null });
    await expect(profileHandler(mockEvent(sessionCookie(sid)))).rejects.toMatchObject({ statusCode: 401 });
  });

  it('logout without a cookie is harmless', async () => {
    await login();
    expect(await logoutHandler(mockEvent(undefined, { method: 'POST' }))).toEqual({ success: true });
    expect(sessionRows()).toBe(1);
  });
});
