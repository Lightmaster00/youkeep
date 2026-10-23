import { describe, it, expect, vi } from 'vitest';
import { createSessionExpiryHandler, isExpiryResponse, isPublicRoute, isUnauthorizedError, loginTarget } from '../../app/utils/sessionExpiry';

const ORIGIN = 'http://unraid:3000';

function setup(opts: { loggedIn?: boolean; path?: string; fullPath?: string; query?: Record<string, unknown> } = {}) {
  const expire = vi.fn();
  const state = { loggedIn: opts.loggedIn ?? true, path: opts.path ?? '/playlists', fullPath: opts.fullPath ?? opts.path ?? '/playlists', query: opts.query ?? {} };
  const handler = createSessionExpiryHandler({
    isLoggedIn: () => state.loggedIn,
    currentRoute: () => ({ path: state.path, fullPath: state.fullPath, query: state.query }),
    expire,
  });
  return { handler, expire, state };
}

describe('isExpiryResponse', () => {
  it('matches a 401 from a same-origin /api route', () => {
    expect(isExpiryResponse('/api/playlists/personal', 401, ORIGIN)).toBe(true);
    expect(isExpiryResponse(`${ORIGIN}/api/videos?x=1`, 401, ORIGIN)).toBe(true);
    expect(isExpiryResponse(new Request(`${ORIGIN}/api/x`), 401, ORIGIN)).toBe(true);
    expect(isExpiryResponse(new URL(`${ORIGIN}/api/x`), 401, ORIGIN)).toBe(true);
  });

  it('ignores other statuses, other origins, non-api paths and the auth routes', () => {
    expect(isExpiryResponse('/api/x', 403, ORIGIN)).toBe(false);
    expect(isExpiryResponse('/api/x', 200, ORIGIN)).toBe(false);
    expect(isExpiryResponse('https://other.example/api/x', 401, ORIGIN)).toBe(false);
    expect(isExpiryResponse('/downloads/a.mp4', 401, ORIGIN)).toBe(false);
    for (const p of ['/api/auth/login', '/api/auth/setup', '/api/auth/me', '/api/auth/logout', '/api/auth/me/']) {
      expect(isExpiryResponse(p, 401, ORIGIN)).toBe(false);
    }
  });
});

describe('loginTarget', () => {
  it('keeps the current page as a safe redirect', () => {
    expect(loginTarget('/playlists?sort=new')).toEqual({ path: '/login', query: { redirect: '/playlists?sort=new' } });
    expect(loginTarget('/')).toEqual({ path: '/login' });
    expect(loginTarget('//evil.com')).toEqual({ path: '/login' });
  });
});

describe('createSessionExpiryHandler', () => {
  it('a 401 expires the session once, with the original path', () => {
    const { handler, expire } = setup({ path: '/playlists', fullPath: '/playlists?x=1' });
    expect(handler.onResponse('/api/playlists/personal', 401, ORIGIN)).toBe(true);
    expect(expire).toHaveBeenCalledTimes(1);
    expect(expire).toHaveBeenCalledWith({ path: '/login', query: { redirect: '/playlists?x=1' } });
  });

  it('the other 401s of the same expiry are ignored until reset (no repeated toasts)', () => {
    const { handler, expire } = setup();
    handler.onResponse('/api/a', 401, ORIGIN);
    handler.onResponse('/api/b', 401, ORIGIN);
    handler.onResponse('/api/c', 401, ORIGIN);
    expect(expire).toHaveBeenCalledTimes(1);
    handler.reset();
    handler.onResponse('/api/d', 401, ORIGIN);
    expect(expire).toHaveBeenCalledTimes(2);
  });

  it('does nothing for login/setup/me, nor on the login page', () => {
    const { handler, expire, state } = setup();
    handler.onResponse('/api/auth/login', 401, ORIGIN);
    handler.onResponse('/api/auth/me', 401, ORIGIN);
    handler.onResponse('/api/auth/setup', 401, ORIGIN);
    state.path = '/login';
    handler.onResponse('/api/x', 401, ORIGIN);
    expect(expire).not.toHaveBeenCalled();
  });

  it('leaves guests on public pages alone, but not a signed-in user there', () => {
    const guest = setup({ loggedIn: false, path: '/watch/abc' });
    guest.handler.onResponse('/api/videos/track', 401, ORIGIN);
    expect(guest.expire).not.toHaveBeenCalled();
    const sharedPlaylist = setup({ loggedIn: false, path: '/playlists/p1', query: { token: 't' } });
    sharedPlaylist.handler.onResponse('/api/playlists/personal/p1', 401, ORIGIN);
    expect(sharedPlaylist.expire).not.toHaveBeenCalled();

    const member = setup({ loggedIn: true, path: '/watch/abc' });
    member.handler.onResponse('/api/videos/track', 401, ORIGIN);
    expect(member.expire).toHaveBeenCalledWith({ path: '/login', query: { redirect: '/watch/abc' } });
  });
});

describe('helpers', () => {
  it('knows the public pages', () => {
    expect(isPublicRoute('/')).toBe(true);
    expect(isPublicRoute('/watch/x')).toBe(true);
    expect(isPublicRoute('/playlists')).toBe(false);
    expect(isPublicRoute('/playlists/p1', { token: 'abc' })).toBe(true);
    expect(isPublicRoute('/playlists/p1', { token: '' })).toBe(false);
  });

  it('recognises a 401 fetch error', () => {
    expect(isUnauthorizedError({ statusCode: 401 })).toBe(true);
    expect(isUnauthorizedError({ response: { status: 401 } })).toBe(true);
    expect(isUnauthorizedError({ statusCode: 500 })).toBe(false);
    expect(isUnauthorizedError(null)).toBe(false);
  });
});
