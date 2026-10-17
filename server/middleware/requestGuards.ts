import { defineEventHandler, createError, getHeader, setHeader, type H3Event } from 'h3';
import { getForwardedHost } from '../utils/trustProxy';
import { normalizeRequestPath } from '../utils/requestPath';

// Request hardening applied to every /api call before any route runs:
// - bodies over 1 MiB are refused (413), declared or chunked;
// - a mutating request that carries a body must be JSON (415): this keeps
//   cross-site "simple" requests (text/plain, form posts) from reaching a
//   route, since a browser cannot send application/json cross-site without a
//   CORS preflight this app never answers;
// - login and first-run setup, which have no session cookie and so no CSRF
//   token, also refuse requests a browser marks as cross-site (403).

export const MAX_API_BODY_BYTES = 1024 * 1024;
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const CROSS_SITE_GUARDED = new Set(['/api/auth/login', '/api/auth/setup']);
const RAW_BODY = Symbol.for('h3RawBody');

function tooLarge(): never {
  throw createError({ statusCode: 413, statusMessage: 'Request body too large (1 MiB maximum).' });
}

function hasBody(event: H3Event): { declared: number | null; chunked: boolean } {
  const lengthHeader = getHeader(event, 'content-length');
  const chunked = /\bchunked\b/i.test(getHeader(event, 'transfer-encoding') ?? '');
  const declared = lengthHeader === undefined ? null : Number(lengthHeader);
  return { declared: Number.isFinite(declared) ? declared : null, chunked };
}

// Reads a chunked body while counting, and hands it to h3's readBody (which
// looks for an already-read raw body under this symbol before reading).
function readChunkedBody(event: H3Event): Promise<Buffer> {
  const req = event.node.req;
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const onData = (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_API_BODY_BYTES) {
        req.off('data', onData);
        req.off('end', onEnd);
        // Let the rest drain and close the connection after the 413.
        req.resume();
        setHeader(event, 'Connection', 'close');
        reject(createError({ statusCode: 413, statusMessage: 'Request body too large (1 MiB maximum).' }));
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () => resolve(Buffer.concat(chunks));
    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', reject);
  });
}

function isJsonContentType(value: string | undefined): boolean {
  const mediaType = (value ?? '').split(';')[0]!.trim().toLowerCase();
  return mediaType === 'application/json';
}

function hostOf(origin: string): string | null {
  try {
    return new URL(origin).host.toLowerCase();
  } catch {
    return null;
  }
}

function assertSameSite(event: H3Event): void {
  const fetchSite = getHeader(event, 'sec-fetch-site')?.toLowerCase();
  if (fetchSite) {
    // The browser itself says where the request comes from; it cannot be
    // forged by a page. (When it says same-origin the Origin check below is
    // skipped: a proxy rewriting the Host header must not break login.)
    if (fetchSite !== 'same-origin' && fetchSite !== 'none') {
      throw createError({ statusCode: 403, statusMessage: 'Cross-site request refused.' });
    }
    return;
  }
  const origin = getHeader(event, 'origin');
  if (origin === undefined) return; // not a browser, or a same-origin GET-like request
  const expectedHost = (getForwardedHost(event) ?? getHeader(event, 'host') ?? '').toLowerCase();
  if (!expectedHost || hostOf(origin) !== expectedHost) {
    throw createError({ statusCode: 403, statusMessage: 'Cross-site request refused.' });
  }
}

export default defineEventHandler(async (event) => {
  const path = normalizeRequestPath(event.path);
  if (!path.startsWith('/api/')) return;
  if (!MUTATING_METHODS.has(event.method)) return;

  if (CROSS_SITE_GUARDED.has(path)) assertSameSite(event);

  const { declared, chunked } = hasBody(event);
  const bodyPresent = chunked || (declared !== null && declared > 0);
  if (!bodyPresent) return;

  if (declared !== null && declared > MAX_API_BODY_BYTES) tooLarge();

  if (!isJsonContentType(getHeader(event, 'content-type'))) {
    throw createError({ statusCode: 415, statusMessage: 'Request body must be JSON (Content-Type: application/json).' });
  }

  if (chunked && declared === null) {
    const body = await readChunkedBody(event);
    (event.node.req as any)[RAW_BODY] = Promise.resolve(body);
  }
});
