import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import authMiddleware from '../../app/middleware/auth.global';
import LoginPage from '../../app/pages/login.vue';

const route = (fullPath: string) => {
  const url = new URL(fullPath, 'http://app.local');
  return { path: url.pathname, fullPath, query: Object.fromEntries(url.searchParams) } as any;
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

  it('no longer lists the dead /categories route as public', async () => {
    expect(await runMiddleware('/categories')).toEqual({ path: '/login', query: { redirect: '/categories' } });
  });

  it('sends a guest to /login with the page to come back to', async () => {
    const r: any = await runMiddleware('/history?x=1');
    expect(r).toEqual({ path: '/login', query: { redirect: '/history?x=1' } });
  });

  it('sends a signed-in user on /login to the redirect target, but never off-site', async () => {
    useState('auth_user').value = { id: 'u1', username: 'bob', role: 'user' };
    expect(await runMiddleware('/login?redirect=%2Fhistory')).toBe('/history');
    for (const bad of ['//evil.com', '/\\evil', 'https://x']) {
      expect(await runMiddleware(`/login?redirect=${encodeURIComponent(bad)}`)).toBe('/');
    }
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

  it.each(['//evil.com', '/\\evil', 'https://x'])('ignores the open redirect %j', async (bad) => {
    expect(await loginWith(bad)).toEqual(['/']);
  });
});
