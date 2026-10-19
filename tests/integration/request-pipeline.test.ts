import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import Database from 'better-sqlite3';
import { createApp, createRouter, toNodeListener } from 'h3';
import requestGuards from '../../server/middleware/requestGuards';
import csrf from '../../server/middleware/csrf';
import forcePasswordChange from '../../server/middleware/forcePasswordChange';
import * as auth from '../../server/utils/auth';
import { resetAllRateLimits } from '../../server/utils/rateLimit';
import loginHandler from '../../server/api/auth/login.post';
import setupHandler from '../../server/api/auth/setup.post';
import logoutHandler from '../../server/api/auth/logout.post';
import trackHandler from '../../server/api/videos/track.post';
import profileHandler from '../../server/api/account/profile.get';
import videosHandler from '../../server/api/videos/index.get';
import { createTestDb, insertChannel, insertVideo } from '../helpers/testDb';

// The middleware chain in front of the routes, over real HTTP: Nitro runs
// server/middleware/* in file order (apiNoStore, csrf, forcePasswordChange, moduleGate,
// requestGuards, securityHeaders) before the matched route; the security
// ones are mounted here the same way, in front of real route handlers.
// Every other route test calls handlers directly and skips this chain.

let db: Database.Database;
let server: http.Server;
let base: string;

beforeAll(async () => {
  const app = createApp();
  app.use(csrf);
  app.use(forcePasswordChange);
  app.use(requestGuards);
  const router = createRouter()
    .post('/api/auth/login', loginHandler)
    .post('/api/auth/setup', setupHandler)
    .post('/api/auth/logout', logoutHandler)
    .post('/api/videos/track', trackHandler)
    .get('/api/account/profile', profileHandler)
    .get('/api/videos', videosHandler);
  app.use(router);
  server = http.createServer(toNodeListener(app));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(async () => {
  db = createTestDb();
  for (const col of ['first_name TEXT', 'last_name TEXT', 'email TEXT', 'phone TEXT', 'dob TEXT']) db.exec(`ALTER TABLE users ADD COLUMN ${col}`);
  for (const col of ['like_count INTEGER', 'size_bytes INTEGER']) db.exec(`ALTER TABLE videos ADD COLUMN ${col}`);
  for (const col of ['description TEXT', 'banner_url TEXT']) db.exec(`ALTER TABLE channels ADD COLUMN ${col}`);
  Object.assign(globalThis as any, auth, { getDb: () => db });
  resetAllRateLimits();
  delete process.env.TRUST_PROXY;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const hash = await auth.hashPassword('correct-horse-1');
  db.prepare("INSERT INTO users (id, username, password_hash, role, must_change_password, created_at) VALUES ('u1', 'bob', ?, 'user', 0, 0), ('u2', 'temp', ?, 'user', 1, 0)").run(hash, hash);
  insertChannel(db, { id: 'c1' });
  insertVideo(db, { id: 'vid1', channelId: 'c1' });
}, 30_000);

type Reply = { status: number; cookies: Record<string, string>; json: any };

async function send(path: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<Reply> {
  const res = await fetch(base + path, { method: init.method ?? 'GET', headers: init.headers, body: init.body, redirect: 'manual' });
  const cookies: Record<string, string> = {};
  for (const line of res.headers.getSetCookie()) {
    const [pair] = line.split(';');
    const i = pair!.indexOf('=');
    cookies[pair!.slice(0, i)] = pair!.slice(i + 1);
  }
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, cookies, json };
}

const JSON_HEADERS = { 'content-type': 'application/json' };

async function login(username = 'bob'): Promise<{ cookie: string; csrf: string }> {
  const r = await send('/api/auth/login', { method: 'POST', headers: { ...JSON_HEADERS, 'sec-fetch-site': 'same-origin' }, body: JSON.stringify({ username, password: 'correct-horse-1' }) });
  expect(r.status).toBe(200);
  return { cookie: `youkeep_session=${r.cookies.youkeep_session}; csrf_token=${r.cookies.csrf_token}`, csrf: decodeURIComponent(r.cookies.csrf_token!) };
}

describe('login and setup refuse cross-site requests on every path spelling', () => {
  const body = JSON.stringify({ username: 'bob', password: 'correct-horse-1' });
  it.each(['/api/auth/login', '/api/auth/login?x=1', '/api/auth/login/', '/API/auth/login', '//api//auth//login', '/api/auth/setup', '/api/auth/setup/?a=b'])(
    '%s (Sec-Fetch-Site: cross-site) -> 403, no session', async (p) => {
      const r = await send(p, { method: 'POST', headers: { ...JSON_HEADERS, 'sec-fetch-site': 'cross-site' }, body });
      expect(r.status).toBe(403);
      expect(r.cookies.youkeep_session).toBeUndefined();
      expect(db.prepare('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({ n: 0 });
    }, 30_000);

  it('a foreign Origin without Sec-Fetch-Site is refused too', async () => {
    const r = await send('/api/auth/login?next=1', { method: 'POST', headers: { ...JSON_HEADERS, origin: 'https://evil.example' }, body });
    expect(r.status).toBe(403);
  });

  it('a same-origin login works and sets both cookies', async () => {
    const { cookie, csrf: token } = await login();
    expect(cookie).toContain('youkeep_session=');
    expect(token.length).toBeGreaterThan(10);
  }, 30_000);
});

describe('CSRF on mutating requests with a session', () => {
  it('no header -> 403, wrong header -> 403, cookie value as header -> 200', async () => {
    const { cookie, csrf: token } = await login();
    const track = (headers: Record<string, string>) =>
      send('/api/videos/track', { method: 'POST', headers: { ...JSON_HEADERS, cookie, ...headers }, body: JSON.stringify({ videoId: 'vid1', watchTimeSeconds: 5 }) });
    expect((await track({})).status).toBe(403);
    expect((await track({ 'x-csrf-token': 'forged' })).status).toBe(403);
    expect((await track({ 'x-csrf-token': token })).status).toBe(200);
    expect(db.prepare('SELECT watch_time_seconds FROM user_history WHERE user_id = ?').get('u1')).toEqual({ watch_time_seconds: 5 });
  }, 30_000);

  it('logout without the CSRF header is refused and leaves the session valid', async () => {
    const { cookie, csrf: token } = await login();
    expect((await send('/api/auth/logout', { method: 'POST', headers: { cookie } })).status).toBe(403);
    expect((await send('/api/account/profile', { headers: { cookie } })).status).toBe(200);
    expect((await send('/api/auth/logout', { method: 'POST', headers: { cookie, 'x-csrf-token': token } })).status).toBe(200);
    expect((await send('/api/account/profile', { headers: { cookie } })).status).toBe(401);
  }, 30_000);
});

describe('body rules', () => {
  it('a text/plain body is a 415 and an oversized declared body a 413, before the route runs', async () => {
    const { cookie, csrf: token } = await login();
    const headers = { cookie, 'x-csrf-token': token };
    expect((await send('/api/videos/track', { method: 'POST', headers: { ...headers, 'content-type': 'text/plain' }, body: '{"videoId":"vid1","watchTimeSeconds":5}' })).status).toBe(415);
    expect((await send('/api/videos/track', { method: 'POST', headers: { ...headers, ...JSON_HEADERS }, body: JSON.stringify({ pad: 'x'.repeat(1024 * 1024 + 10) }) })).status).toBe(413);
    expect(db.prepare('SELECT COUNT(*) AS n FROM user_history').get()).toEqual({ n: 0 });
  }, 30_000);
});

describe('forced password change', () => {
  it('a user with a temporary password reaches only the password screen\'s routes', async () => {
    const { cookie } = await login('temp');
    expect((await send('/api/videos', { headers: { cookie } })).status).toBe(403);
    expect((await send('/API/videos/', { headers: { cookie } })).status).toBe(403);
    expect((await send('/api/account/profile', { headers: { cookie } })).status).toBe(200);
  }, 30_000);

  it('a normal user is not affected', async () => {
    const { cookie } = await login();
    expect((await send('/api/videos', { headers: { cookie } })).status).toBe(200);
  }, 30_000);
});
