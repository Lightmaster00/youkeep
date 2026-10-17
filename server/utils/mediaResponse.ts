import fs from 'fs';
import type { H3Event } from 'h3';

/**
 * Shared file-serving for the three media routes (/downloads,
 * /downloads-music, /downloads-podcasts): Range requests, conditional GETs,
 * cache headers and a read stream that is always released.
 */

/**
 * Cache policies.
 * - IMMUTABLE: a video file whose name carries its video id (`<Title> [<id>].<ext>`
 *   or legacy `<id>.<ext>`): the bytes behind that URL never change, so the
 *   browser may keep it for a year (private: never in a shared cache).
 * - REVALIDATE_DAILY: everything else (audio, podcast episodes, images,
 *   subtitles): those files can be replaced (a clip backfill, a re-download)
 *   or lose visibility, so a browser keeps them one day at most and must
 *   revalidate afterwards.
 */
export const CACHE_IMMUTABLE = 'private, max-age=31536000, immutable';
export const CACHE_REVALIDATE_DAILY = 'private, max-age=86400, must-revalidate';

export type ByteRange =
  | { kind: 'none' }
  | { kind: 'range'; start: number; end: number }
  | { kind: 'unsatisfiable' };

/**
 * Parses a `Range` header against a file of `size` bytes (RFC 9110):
 * - an end at or after the file size is clamped to the last byte;
 * - a start at or after the size (or an empty suffix) is unsatisfiable (416);
 * - several ranges: only the first one is served;
 * - a malformed header, or an end before the start, is ignored (the whole file is served).
 */
export function parseByteRange(header: string | undefined | null, size: number): ByteRange {
  if (!header) return { kind: 'none' };
  const match = /^\s*bytes\s*=\s*(.+)$/i.exec(header);
  if (!match) return { kind: 'none' };
  const first = match[1]!.split(',')[0]!.trim();
  const parts = /^(\d*)\s*-\s*(\d*)$/.exec(first);
  if (!parts || (parts[1] === '' && parts[2] === '')) return { kind: 'none' };
  if (parts[1] === '') {
    const suffix = Number(parts[2]);
    if (!Number.isSafeInteger(suffix) || suffix === 0 || size === 0) return { kind: 'unsatisfiable' };
    return { kind: 'range', start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(parts[1]);
  const end = parts[2] === '' ? size - 1 : Number(parts[2]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return { kind: 'none' };
  if (start >= size) return { kind: 'unsatisfiable' };
  if (end < start) return { kind: 'none' };
  return { kind: 'range', start, end: Math.min(end, size - 1) };
}

/** The file's stats when it is a regular file (never a directory, device or missing path), else null. */
export function statRegularFile(file: string): fs.Stats | null {
  try {
    const stat = fs.statSync(file);
    return stat.isFile() ? stat : null;
  } catch {
    return null;
  }
}

/**
 * A read stream destroyed as soon as the response closes: a client that
 * aborts (seeking, closing the tab) never leaves an open file descriptor.
 */
export function streamForResponse(event: H3Event, file: string, opts?: { start: number; end: number }): fs.ReadStream {
  const stream = fs.createReadStream(file, opts);
  const res: any = event.node.res;
  if (typeof res.once === 'function') {
    res.once('close', () => { if (!stream.destroyed) stream.destroy(); });
  }
  stream.on('error', () => {});
  return stream;
}

/**
 * The file's entity tag: size and modification time (ms), so a replaced file
 * (a re-download, a clip backfill) gets a new one. Used as a strong validator.
 */
export function fileEtag(stat: fs.Stats): string {
  return `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
}

/**
 * Whether a `Range` may be honoured given `If-Range` (RFC 9110 13.1.5): no
 * header, the current (strong) ETag, or exactly the current Last-Modified
 * date. Anything else (another or a weak ETag, another date, garbage) means
 * the client's partial copy is stale: the whole file is sent.
 */
function ifRangeAllows(header: string | undefined, stat: fs.Stats): boolean {
  if (header === undefined) return true;
  const value = header.trim();
  if (value.startsWith('"') || value.startsWith('W/')) return value === fileEtag(stat);
  const date = new Date(value);
  if (isNaN(date.getTime())) return false;
  return Math.floor(date.getTime() / 1000) === Math.floor(stat.mtime.getTime() / 1000);
}

/** True when `If-None-Match` lists the current ETag (or is `*`). */
function etagMatches(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  return header.split(',').some((t) => {
    const tag = t.trim();
    return tag === '*' || tag === etag || tag === `W/${etag}`;
  });
}

/** True (and a 304 set up) when `If-Modified-Since` is at or after the file's mtime. */
function notModified(event: H3Event, stat: fs.Stats): boolean {
  if (event.node.req.headers['if-none-match'] !== undefined) {
    if (!etagMatches(event.node.req.headers['if-none-match'] as string, fileEtag(stat))) return false;
    event.node.res.statusCode = 304;
    event.node.res.removeHeader?.('Content-Type');
    return true;
  }
  const header = event.node.req.headers['if-modified-since'];
  if (!header) return false;
  const since = new Date(header as string);
  if (isNaN(since.getTime())) return false;
  if (Math.floor(stat.mtime.getTime() / 1000) > Math.floor(since.getTime() / 1000)) return false;
  event.node.res.statusCode = 304;
  event.node.res.removeHeader?.('Content-Type');
  return true;
}

/**
 * Serves an already authorised and located regular file: Range support,
 * cache headers (`Last-Modified` and 304 unless immutable) and a stream
 * released when the response closes.
 */
export function sendMediaFile(event: H3Event, file: string, stat: fs.Stats, opts: { contentType: string; immutable: boolean }): fs.ReadStream | string | null {
  const res = event.node.res;
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', opts.contentType);
  res.setHeader('ETag', fileEtag(stat));
  if (opts.immutable) {
    res.setHeader('Cache-Control', CACHE_IMMUTABLE);
  } else {
    res.setHeader('Cache-Control', CACHE_REVALIDATE_DAILY);
    res.setHeader('Last-Modified', stat.mtime.toUTCString());
    if (notModified(event, stat)) return null;
  }
  const size = stat.size;
  const range = ifRangeAllows(event.node.req.headers['if-range'] as string | undefined, stat)
    ? parseByteRange(event.node.req.headers.range as string | undefined, size)
    : { kind: 'none' as const };
  if (range.kind === 'unsatisfiable') {
    res.statusCode = 416;
    res.setHeader('Content-Range', `bytes */${size}`);
    return 'Requested range not satisfiable';
  }
  if (range.kind === 'range') {
    res.statusCode = 206;
    res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
    res.setHeader('Content-Length', range.end - range.start + 1);
    return streamForResponse(event, file, { start: range.start, end: range.end });
  }
  res.statusCode = 200;
  res.setHeader('Content-Length', size);
  return streamForResponse(event, file);
}
