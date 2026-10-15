import { describe, it, expect, afterEach } from 'vitest';
import { PassThrough } from 'node:stream';
import { readBody } from 'h3';
import guards, { MAX_API_BODY_BYTES } from '../../server/middleware/requestGuards';
import { mockEvent } from '../helpers/testDb';

const originalTrust = process.env.TRUST_PROXY;
afterEach(() => {
  if (originalTrust === undefined) delete process.env.TRUST_PROXY; else process.env.TRUST_PROXY = originalTrust;
});

function ev(path: string, method: string, headers: Record<string, string>) {
  return mockEvent(undefined, { path, method, headers });
}

// An event whose request is a real stream, for chunked bodies.
function streamEvent(path: string, chunks: Buffer[], headers: Record<string, string>) {
  const req: any = new PassThrough();
  req.method = 'POST';
  req.headers = { 'transfer-encoding': 'chunked', 'content-type': 'application/json', ...headers };
  const resHeaders: Record<string, any> = {};
  const event: any = {
    method: 'POST',
    path,
    context: {},
    node: { req, res: { headers: resHeaders, getHeader: (n: string) => resHeaders[n.toLowerCase()], setHeader: (n: string, v: any) => { resHeaders[n.toLowerCase()] = v; } } }
  };
  setImmediate(() => {
    for (const c of chunks) req.write(c);
    req.end();
  });
  return event;
}

describe('body size limit', () => {
  it('refuses a declared body over 1 MiB with 413', async () => {
    await expect(guards(ev('/api/videos/track', 'POST', { 'content-type': 'application/json', 'content-length': String(MAX_API_BODY_BYTES + 1) })))
      .rejects.toMatchObject({ statusCode: 413 });
  });

  it('allows a declared body up to 1 MiB', async () => {
    await expect(guards(ev('/api/videos/track', 'POST', { 'content-type': 'application/json', 'content-length': String(MAX_API_BODY_BYTES) })))
      .resolves.toBeUndefined();
  });

  it('refuses a chunked body once it exceeds 1 MiB', async () => {
    const chunk = Buffer.alloc(256 * 1024, 0x20);
    const event = streamEvent('/api/videos/track', [chunk, chunk, chunk, chunk, chunk], {});
    await expect(guards(event)).rejects.toMatchObject({ statusCode: 413 });
  });

  it('passes a small chunked body through to readBody', async () => {
    const event = streamEvent('/api/videos/track', [Buffer.from('{"a":'), Buffer.from('1}')], {});
    await guards(event);
    await expect(readBody(event)).resolves.toEqual({ a: 1 });
  });

  it('does not apply outside /api', async () => {
    await expect(guards(ev('/downloads/x', 'POST', { 'content-length': String(MAX_API_BODY_BYTES * 5) }))).resolves.toBeUndefined();
  });
});

describe('JSON content type for mutating API calls', () => {
  it.each(['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', ''])('refuses %j with a body (415)', async (ct) => {
    const headers: Record<string, string> = { 'content-length': '10' };
    if (ct) headers['content-type'] = ct;
    await expect(guards(ev('/api/auth/login', 'POST', headers))).rejects.toMatchObject({ statusCode: 415 });
  });

  it('accepts application/json with parameters', async () => {
    await expect(guards(ev('/api/videos/track', 'PUT', { 'content-type': 'Application/JSON; charset=utf-8', 'content-length': '10' }))).resolves.toBeUndefined();
  });

  it('accepts a bodiless mutating request (Content-Length 0 or none)', async () => {
    await expect(guards(ev('/api/admin/users/u1/reset-password', 'POST', { 'content-length': '0' }))).resolves.toBeUndefined();
    await expect(guards(ev('/api/admin/users/u1', 'DELETE', {}))).resolves.toBeUndefined();
  });

  it('does not apply to GET', async () => {
    await expect(guards(ev('/api/videos', 'GET', { 'content-type': 'text/plain', 'content-length': '3' }))).resolves.toBeUndefined();
  });
});

describe('cross-site login and setup', () => {
  const json = { 'content-type': 'application/json', 'content-length': '20', host: 'media.example.com' };

  it.each(['cross-site', 'same-site'])('refuses Sec-Fetch-Site: %s', async (site) => {
    for (const path of ['/api/auth/login', '/api/auth/setup']) {
      await expect(guards(ev(path, 'POST', { ...json, 'sec-fetch-site': site }))).rejects.toMatchObject({ statusCode: 403 });
    }
  });

  it.each(['same-origin', 'none'])('accepts Sec-Fetch-Site: %s', async (site) => {
    await expect(guards(ev('/api/auth/login', 'POST', { ...json, 'sec-fetch-site': site, origin: 'https://media.example.com' }))).resolves.toBeUndefined();
  });

  it('refuses a foreign Origin when Sec-Fetch-Site is absent', async () => {
    await expect(guards(ev('/api/auth/login', 'POST', { ...json, origin: 'https://evil.example' }))).rejects.toMatchObject({ statusCode: 403 });
    await expect(guards(ev('/api/auth/setup', 'POST', { ...json, origin: 'null' }))).rejects.toMatchObject({ statusCode: 403 });
  });

  it('accepts a matching Origin, and no Origin at all (non-browser clients)', async () => {
    await expect(guards(ev('/api/auth/login', 'POST', { ...json, origin: 'https://media.example.com' }))).resolves.toBeUndefined();
    await expect(guards(ev('/api/auth/login', 'POST', json))).resolves.toBeUndefined();
  });

  it('uses X-Forwarded-Host only when TRUST_PROXY is set', async () => {
    const headers = { ...json, host: 'youkeep:3000', 'x-forwarded-host': 'media.example.com', origin: 'https://media.example.com' };
    delete process.env.TRUST_PROXY;
    await expect(guards(ev('/api/auth/login', 'POST', headers))).rejects.toMatchObject({ statusCode: 403 });
    process.env.TRUST_PROXY = '1';
    await expect(guards(ev('/api/auth/login', 'POST', headers))).resolves.toBeUndefined();
  });

  it('does not apply the cross-site rule to other routes (they have CSRF tokens)', async () => {
    await expect(guards(ev('/api/videos/track', 'POST', { ...json, 'sec-fetch-site': 'cross-site' }))).resolves.toBeUndefined();
  });
});
