import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import csrfPlugin from '../../app/plugins/csrf.client';

// The client plugin wraps window.fetch: every same-origin mutating request
// carries the CSRF header read from the cookie, everything else passes as is.
let underlying: ReturnType<typeof vi.fn>;
let savedFetch: typeof window.fetch;

beforeEach(() => {
  savedFetch = window.fetch;
  underlying = vi.fn(async () => new Response('{}'));
  window.fetch = underlying as any;
  (csrfPlugin as any)(useNuxtApp());
  document.cookie = 'csrf_token=tok%2B1; path=/';
});
afterEach(() => {
  window.fetch = savedFetch;
  document.cookie = 'csrf_token=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
});

const sentHeaders = (call = 0) => new Headers((underlying.mock.calls[call]![1] as RequestInit | undefined)?.headers);

describe('csrf client plugin', () => {
  it('adds the decoded cookie token to a same-origin POST, keeping its own headers and body', async () => {
    await window.fetch('/api/videos/track', { method: 'POST', body: '{"a":1}', headers: { 'Content-Type': 'application/json' } });
    expect(underlying).toHaveBeenCalledTimes(1);
    expect(underlying.mock.calls[0]![0]).toBe('/api/videos/track');
    expect(sentHeaders().get('x-csrf-token')).toBe('tok+1');
    expect(sentHeaders().get('content-type')).toBe('application/json');
    expect((underlying.mock.calls[0]![1] as RequestInit).body).toBe('{"a":1}');
  });

  it.each(['PUT', 'PATCH', 'DELETE', 'post'])('signs %s too', async (method) => {
    await window.fetch(`${window.location.origin}/api/x`, { method });
    expect(sentHeaders().get('x-csrf-token')).toBe('tok+1');
  });

  it('passes GET, cross-origin and already-signed requests through untouched', async () => {
    const getInit = { method: 'GET' };
    await window.fetch('/api/x', getInit);
    expect(underlying.mock.calls[0]![1]).toBe(getInit);
    const crossInit = { method: 'POST' };
    await window.fetch('https://other.example/api', crossInit);
    expect(underlying.mock.calls[1]![1]).toBe(crossInit);
    await window.fetch('/api/x', { method: 'POST', headers: { 'x-csrf-token': 'mine' } });
    expect(sentHeaders(2).get('x-csrf-token')).toBe('mine');
  });

  it('sends no header when there is no token cookie', async () => {
    document.cookie = 'csrf_token=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
    const init = { method: 'POST' };
    await window.fetch('/api/x', init);
    expect(underlying.mock.calls[0]![1]).toBe(init);
  });
});

describe('session expiry (401) handling', () => {
  let fetchStub: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const { useToast } = await import('../../app/composables/useToast');
    useToast().toasts.value = [];
    fetchStub = vi.fn(async () => ({}));
    vi.stubGlobal('$fetch', fetchStub);
    useState('auth_loading').value = false;
    useState('auth_user').value = { id: 'u1', username: 'bob', role: 'user' };
    useState('modules_loaded').value = true;
    window.sessionStorage.setItem('landing_applied', 'u1');
    await useRouter().push('/playlists?sort=new');
    underlying.mockImplementation(async () => new Response('{"statusMessage":"Unauthorized. Please log in."}', { status: 401 }));
  });
  afterEach(() => vi.unstubAllGlobals());

  const toastMessages = async () => (await import('../../app/composables/useToast')).useToast().toasts.value.map((t) => t.message);

  it('a 401 from the API signs out once, shows one toast and goes to /login with the original path', async () => {
    const push = vi.spyOn(useRouter(), 'push');
    const res = await window.fetch('/api/playlists/personal');
    expect(res.status).toBe(401);
    await window.fetch('/api/playlists/personal');
    await window.fetch('/api/videos/history');
    await new Promise((r) => setTimeout(r, 0));
    expect(useState('auth_user').value).toBeNull();
    expect(await toastMessages()).toEqual(['Your session expired. Please log in again.']);
    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0]![0]).toMatchObject({ path: '/login', query: { redirect: '/playlists?sort=new' } });
    push.mockRestore();
  });

  it('ignores 401s from login, setup and me', async () => {
    const push = vi.spyOn(useRouter(), 'push');
    await window.fetch('/api/auth/login', { method: 'POST' });
    await window.fetch('/api/auth/setup', { method: 'POST' });
    await window.fetch('/api/auth/me');
    expect(useState('auth_user').value).not.toBeNull();
    expect(await toastMessages()).toEqual([]);
    expect(push).not.toHaveBeenCalled();
    push.mockRestore();
  });

  it('leaves a guest on a public page alone', async () => {
    useState('auth_user').value = null;
    await useRouter().push('/watch/abc');
    const push = vi.spyOn(useRouter(), 'push');
    await window.fetch('/api/videos/track', { method: 'POST' });
    expect(await toastMessages()).toEqual([]);
    expect(push).not.toHaveBeenCalled();
    push.mockRestore();
  });
});
