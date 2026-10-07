import { describe, it, expect } from 'vitest';
import { readCsrfToken, withCsrfHeader } from '../../app/utils/csrfFetch';

const ORIGIN = 'http://unraid:3000';

describe('csrf fetch header', () => {
  it('reads the token from the cookie string', () => {
    expect(readCsrfToken('a=1; csrf_token=abc%20d; b=2')).toBe('abc d');
    expect(readCsrfToken('a=1')).toBeNull();
  });

  it('adds the header to same-origin mutating requests and keeps the other init fields', () => {
    const init = withCsrfHeader('/api/admin/music/ingest', { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } }, 'tok', ORIGIN)!;
    const headers = new Headers(init.headers);
    expect(headers.get('x-csrf-token')).toBe('tok');
    expect(headers.get('content-type')).toBe('application/json');
    expect(init.body).toBe('{}');
  });

  it('works for a Request object and an absolute same-origin URL', () => {
    const req = new Request(`${ORIGIN}/api/x`, { method: 'DELETE', headers: { 'X-A': '1' } });
    const init = withCsrfHeader(req, undefined, 'tok', ORIGIN)!;
    expect(new Headers(init.headers).get('x-csrf-token')).toBe('tok');
    expect(new Headers(init.headers).get('x-a')).toBe('1');
  });

  it('leaves safe methods, cross-origin calls, missing tokens and already-signed requests alone', () => {
    expect(withCsrfHeader('/api/x', undefined, 'tok', ORIGIN)).toBeNull();
    expect(withCsrfHeader('/api/x', { method: 'GET' }, 'tok', ORIGIN)).toBeNull();
    expect(withCsrfHeader('https://other.example/api', { method: 'POST' }, 'tok', ORIGIN)).toBeNull();
    expect(withCsrfHeader('/api/x', { method: 'POST' }, null, ORIGIN)).toBeNull();
    expect(withCsrfHeader('/api/x', { method: 'POST', headers: { 'x-csrf-token': 'mine' } }, 'tok', ORIGIN)).toBeNull();
  });
});
