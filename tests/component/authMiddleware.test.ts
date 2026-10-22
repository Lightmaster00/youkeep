import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import authMiddleware from '../../app/middleware/auth.global';
import LoginPage from '../../app/pages/login.vue';

// `matched` comes from the app's real router, so an unknown path has none.
const route = (fullPath: string) => {
  const url = new URL(fullPath, 'http://app.local');
  return { path: url.pathname, fullPath, query: Object.fromEntries(url.searchParams), matched: useRouter().resolve(fullPath).matched } as any;
};

// Called as the router would: navigateTo then returns the target instead of navigating.
const runMiddleware = async (fullPath: string) => {
  const nuxtApp = useNuxtApp() as any;
  nuxtApp._processingMiddleware = true;
  try {
    return await (authMiddleware as any)(route(fullPath), route('/'));
  } finally {
    nuxtApp._processingMiddleware = false;
  }
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  useState('auth_loading').value = false;
  useState('auth_user').value = null;
  useState('modules').value = { video: true, music: true, podcasts: true };
  useState('modules_loaded').value = true;
  fetchMock = vi.fn(async (url: string) => {
    if (url === '/api/modules') return { modules: { video: true, music: true, podcasts: true } };
    if (url === '/api/auth/login') return { success: true, user: { id: 'u1', username: 'bob', role: 'user' } };
    if (url === '/api/auth/setup-status') return { setupRequired: false };
    return {};
  });
  vi.stubGlobal('$fetch', fetchMock);
  window.sessionStorage.setItem('landing_applied', 'u1');
});
afterEach(() => vi.unstubAllGlobals());

describe('auth middleware', () => {
  it('lets a guest open a shared personal playlist only with a token', async () => {
    expect(await runMiddleware('/playlists/p1?token=secret')).toBeUndefined();
    expect(await runMiddleware('/playlists/p1')).toEqual({ path: '/login', query: { redirect: '/playlists/p1' } });
    expect(await runMiddleware('/playlists/p1?token=')).toEqual({ path: '/login', query: { redirect: '/playlists/p1?token=' } });
  });

  it('sends a guest to /login with the page to come back to', async () => {
    const r: any = await runMiddleware('/music/history?x=1');
    expect(r).toEqual({ path: '/login', query: { redirect: '/music/history?x=1' } });
  });

  it('sends a signed-in user on /login to the redirect target, but never off-site', async () => {
    useState('auth_user').value = { id: 'u1', username: 'bob', role: 'user' };
    expect(await runMiddleware('/login?redirect=%2Fhistory')).toBe('/history');
    for (const bad of ['//evil.com', '/\\evil', 'https://x']) {
      expect(await runMiddleware(`/login?redirect=${encodeURIComponent(bad)}`)).toBe('/');
    }
  });
});

describe('auth middleware: public pages, admin pages and disabled modules', () => {
  const asUser = (role: 'admin' | 'user') => { useState('auth_user').value = { id: 'u1', username: 'bob', role }; };

  it.each(['/', '/channels', '/shorts', '/watch/abc123', '/watch/abc123?t=10', '/login'])('a guest may open %s', async (p) => {
    expect(await runMiddleware(p)).toBeUndefined();
  });

  it.each(['/subscriptions', '/account', '/settings', '/search', '/admin/downloader', '/music', '/music/history', '/podcasts', '/playlists/p1'])('a guest is sent to /login from %s', async (p) => {
    const r: any = await runMiddleware(p);
    expect(r === '/login' || r?.path === '/login').toBe(true);
  });

  it.each(['/admin/downloader', '/admin/downloader?tab=x'])('a member is sent home from %s', async (p) => {
    asUser('user');
    expect(await runMiddleware(p)).toBe('/');
  });

  it('an admin may open /admin pages', async () => {
    asUser('admin');
    expect(await runMiddleware('/admin/downloader')).toBeUndefined();
  });

  it("a member is sent to the first enabled module's home from a disabled module's page", async () => {
    useState('modules').value = { video: false, music: true, podcasts: true };
    asUser('user');
    expect(await runMiddleware('/channels')).toBe('/music');
    expect(await runMiddleware('/watch/abc')).toBe('/music');
    expect(await runMiddleware('/music/history')).toBeUndefined();
    // Cross-module pages belong to no module.
    expect(await runMiddleware('/account')).toBeUndefined();
  });

  it('an admin still reaches a disabled module', async () => {
    useState('modules').value = { video: false, music: true, podcasts: true };
    asUser('admin');
    expect(await runMiddleware('/channels')).toBeUndefined();
  });

  it('a guest on a disabled module page is redirected too', async () => {
    useState('modules').value = { video: true, music: false, podcasts: true };
    expect(await runMiddleware('/shorts')).toBeUndefined();
    useState('modules').value = { video: false, music: true, podcasts: true };
    expect(await runMiddleware('/shorts')).toBe('/music');
  });
});

describe('auth middleware: unknown routes', () => {
  // No page matches: the request goes through so app/error.vue renders the
  // 404, instead of a guest landing on the login page.
  it.each(['/no-such-page', '/categories', '/history', '/admin/nope', '/music/nope/deeper?x=1'])('a guest gets the 404 for %s', async (p) => {
    expect(await runMiddleware(p)).toBeUndefined();
  });

  it.each(['/no-such-page', '/admin/nope'])('a signed-in member gets the 404 for %s', async (p) => {
    useState('auth_user').value = { id: 'u1', username: 'bob', role: 'user' };
    expect(await runMiddleware(p)).toBeUndefined();
  });

  it('real protected pages still send a guest to /login', async () => {
    expect(await runMiddleware('/account')).toEqual({ path: '/login', query: { redirect: '/account' } });
  });
});

describe('login page', () => {
  const loginWith = async (redirect: string) => {
    const navigate = vi.fn();
    const w = await mountSuspended(LoginPage, { route: { path: '/login', query: { redirect } } });
    await flushPromises();
    const router = useRouter();
    const push = vi.spyOn(router, 'push').mockImplementation(navigate as any);
    await w.find('input[type="text"]').setValue('bob');
    await w.find('input[type="password"]').setValue('secret-123');
    await w.find('form').trigger('submit');
    await flushPromises();
    push.mockRestore();
    return navigate.mock.calls.map((c) => (typeof c[0] === 'string' ? c[0] : c[0]?.fullPath ?? c[0]?.path ?? JSON.stringify(c[0])));
  };

  it('returns to the requested page after login', async () => {
    expect(await loginWith('/playlists/p1?token=t')).toEqual(['/playlists/p1?token=t']);
  });

  it('"Keep me signed in" is ticked by default; unticking it sends remember: false', async () => {
    const body = async (keep: boolean) => {
      fetchMock.mockClear();
      const w = await mountSuspended(LoginPage, { route: { path: '/login', query: {} } });
      await flushPromises();
      const box = w.find('input#remember_me');
      expect((box.element as HTMLInputElement).checked).toBe(true);
      expect(w.find('label[for="remember_me"]').text()).toBe('Keep me signed in');
      if (!keep) await box.setValue(false);
      await w.find('input[type="text"]').setValue('bob');
      await w.find('input[type="password"]').setValue('secret-123');
      await w.find('form').trigger('submit');
      await flushPromises();
      return fetchMock.mock.calls.find(([u]) => u === '/api/auth/login')![1].body;
    };
    expect(await body(false)).toEqual({ username: 'bob', password: 'secret-123', remember: false });
    expect(await body(true)).toEqual({ username: 'bob', password: 'secret-123', remember: true });
  });

  it.each(['//evil.com', '/\\evil', 'https://x'])('ignores the open redirect %j', async (bad) => {
    expect(await loginWith(bad)).toEqual(['/']);
  });
});
