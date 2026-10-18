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
