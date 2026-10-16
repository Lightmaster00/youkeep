import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getQuery, type H3Event } from 'h3';
import { getDataDir } from './dataDir';
import { hasEnoughDiskSpace } from './concurrency';
import { buildSpawnEnv } from './downloader';
import { streamForResponse } from './mediaResponse';
import { killProcessTree, spawnInGroup, trackChild } from './processTree';

/**
 * Resized thumbnails: `<image url>?w=<width>` serves a JPEG scaled down to
 * one of these widths, generated once by ffmpeg and cached under
 * data/cache/thumbs. Any other `w` (or none) serves the original file.
 * The cache can be deleted at any time; files are regenerated on demand.
 */
export const THUMB_WIDTHS = [160, 320, 480, 640, 960] as const;
export const THUMB_CACHE_CONTROL = 'private, max-age=86400';
export const THUMB_FFMPEG_TIMEOUT_MS = 10_000;
export const THUMB_MAX_CONCURRENT = 2;
/** A cached variant nobody asked for in this long is removed by the sweep (by last access). */
export const THUMB_CACHE_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
/** A source ffmpeg could not resize is not retried before this long (marker file in the cache). */
export const THUMB_FAILURE_TTL_MS = 10 * 60 * 1000;
/** Requests waiting for an ffmpeg slot beyond this many get the original image at once. */
export const THUMB_MAX_WAITING = 64;
/** Source widths remembered (per path + mtime + size), so the header is not re-read on every request. */
export const THUMB_WIDTH_CACHE_SIZE = 500;
/** A cache hit refreshes the file's mtime (its "last access") at most this often. */
export const THUMB_TOUCH_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** How often the running server sweeps the cache (besides once at startup). */
export const THUMB_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

export function parseThumbWidth(raw: unknown): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const width = Number(value);
  if (String(width) !== String(value)) return null; // canonical digits only: no "0160", " 160", "160.0"

  return (THUMB_WIDTHS as readonly number[]).includes(width) ? width : null;
}

export function getThumbCacheDir(): string {
  return path.join(getDataDir(), 'cache', 'thumbs');
}

/** Width in pixels read (asynchronously) from a JPEG, PNG or WebP header, or null when unknown. */
export async function readImageWidthAsync(file: string): Promise<number | null> {
  let handle: fs.promises.FileHandle | null = null;
  try {
    handle = await fs.promises.open(file, 'r');
    const buf = Buffer.alloc(512 * 1024);
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
    return imageWidthFromHeader(buf.subarray(0, bytesRead));
  } catch {
    return null;
  } finally {
    if (handle) { try { await handle.close(); } catch {} }
  }
}

// Source widths by cache key (path + mtime + size), least recently used first.
const widthCache = new Map<string, number | null>();

/** The source image's width, from the in-memory cache or read once. */
async function cachedSourceWidth(key: string, sourcePath: string): Promise<number | null> {
  if (widthCache.has(key)) {
    const width = widthCache.get(key)!;
    widthCache.delete(key);
    widthCache.set(key, width);
    return width;
  }
  const width = await thumbnailDeps.readWidth(sourcePath);
  widthCache.set(key, width);
  while (widthCache.size > THUMB_WIDTH_CACHE_SIZE) widthCache.delete(widthCache.keys().next().value!);
  return width;
}

/** Test helper: forgets every remembered width. */
export function clearThumbWidthCache(): void {
  widthCache.clear();
}

/** Width in pixels read from a JPEG, PNG or WebP header, or null when unknown. */
export function readImageWidth(file: string): number | null {
  let fd: number | null = null;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(512 * 1024);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    return imageWidthFromHeader(buf.subarray(0, n));
  } catch {
    return null;
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch {} }
  }
}

export function imageWidthFromHeader(buf: Buffer): number | null {
  // PNG: signature, then the IHDR chunk with the width first.
  if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47 && buf.toString('ascii', 12, 16) === 'IHDR') {
    return buf.readUInt32BE(16) || null;
  }
  // WebP: RIFF container with a VP8, VP8L or VP8X first chunk.
  if (buf.length >= 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = buf.toString('ascii', 12, 16);
    if (chunk === 'VP8 ') return (buf.readUInt16LE(26) & 0x3fff) || null;
    if (chunk === 'VP8L') return ((buf.readUInt8(21) | (buf.readUInt8(22) << 8)) & 0x3fff) + 1;
    if (chunk === 'VP8X') return buf.readUIntLE(24, 3) + 1;
    return null;
  }
  // JPEG: walk the segments up to a start-of-frame marker.
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buf.length) {
      if (buf[offset] !== 0xff) return null;
      const marker = buf[offset + 1]!;
      if (marker === 0xff) { offset++; continue; }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
      const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isStartOfFrame) return buf.readUInt16BE(offset + 7) || null;
      offset += 2 + buf.readUInt16BE(offset + 2);
    }
  }
  return null;
}

/** The process runner and header reader, injectable so tests never start a real ffmpeg. */
export const thumbnailDeps = {
  readWidth: (file: string): Promise<number | null> => readImageWidthAsync(file),
  /** Free space where the cache is written (its data folder, which always exists). */
  hasSpace: (): Promise<boolean> => hasEnoughDiskSpace(getDataDir()),
  runFfmpeg(args: string[], timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      let child: ReturnType<typeof spawnInGroup>;
      try {
        child = trackChild(spawnInGroup('ffmpeg', args, { env: buildSpawnEnv(), stdio: 'ignore' }));
      } catch (err) {
        reject(err);
        return;
      }
      const timer = setTimeout(() => {
        killProcessTree(child);
        reject(new Error(`ffmpeg timed out after ${timeoutMs} ms`));
      }, timeoutMs);
      child.on('error', (err) => { clearTimeout(timer); reject(err); });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg exited with code ${code}`));
      });
    });
  },
};

// At most THUMB_MAX_CONCURRENT ffmpeg processes; later requests wait their turn.
let running = 0;
const waiting: Array<() => void> = [];
/** Thrown when too many requests already wait for ffmpeg: the caller serves the original. */
class QueueFullError extends Error {}

async function withFfmpegSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= THUMB_MAX_CONCURRENT) {
    if (waiting.length >= THUMB_MAX_WAITING) throw new QueueFullError('Too many thumbnails waiting for ffmpeg');
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  else running++;
  try {
    return await fn();
  } finally {
    // A waiting request takes this slot over directly, so the count never overshoots.
    const next = waiting.shift();
    if (next) next();
    else running--;
  }
}

// Concurrent requests for the same variant share one generation.
const inFlight = new Map<string, Promise<string | null>>();

function cacheKeyFor(sourcePath: string, stat: fs.Stats): string {
  return crypto.createHash('sha1').update(`${sourcePath}\u0000${stat.mtimeMs}\u0000${stat.size}`).digest('hex');
}

function cacheFileFor(sourcePath: string, stat: fs.Stats, width: number): string {
  return path.join(getThumbCacheDir(), `${cacheKeyFor(sourcePath, stat)}-${width}.jpg`);
}

/** Marker of a failed resize of this exact source (path + mtime + size), any width. */
function failureMarkerFor(sourcePath: string, stat: fs.Stats): string {
  return path.join(getThumbCacheDir(), `${cacheKeyFor(sourcePath, stat)}.failed`);
}

function recentFailure(marker: string, now = Date.now()): boolean {
  try {
    return now - fs.statSync(marker).mtimeMs < THUMB_FAILURE_TTL_MS;
  } catch {
    return false;
  }
}

/** A cache hit marks the variant as used (its mtime), at most once per THUMB_TOUCH_INTERVAL_MS. */
function touchOnHit(file: string): void {
  try {
    const now = Date.now();
    if (now - fs.statSync(file).mtimeMs < THUMB_TOUCH_INTERVAL_MS) return;
    const t = new Date(now);
    fs.utimesSync(file, t, t);
  } catch {}
}

/**
 * The cached resized copy of `sourcePath` at `width`, generating it when
 * missing. Null means "serve the original": unknown or not wider source
 * (never upscaled), or ffmpeg failed or timed out.
 */
export async function getResizedThumbnail(sourcePath: string, stat: fs.Stats, width: number): Promise<string | null> {
  const out = cacheFileFor(sourcePath, stat, width);
  if (fs.existsSync(out)) {
    touchOnHit(out);
    return out;
  }
  // A source that could not be resized a moment ago is not handed to ffmpeg again.
  const marker = failureMarkerFor(sourcePath, stat);
  if (recentFailure(marker)) return null;

  const sourceWidth = await cachedSourceWidth(cacheKeyFor(sourcePath, stat), sourcePath);
  if (!sourceWidth || sourceWidth <= width) return null;
  // A nearly full disk: no new variants, the original is served.
  if (!(await thumbnailDeps.hasSpace())) return null;

  const existing = inFlight.get(out);
  if (existing) return existing;

  const job = withFfmpegSlot(async () => {
    if (fs.existsSync(out)) return out;
    fs.mkdirSync(path.dirname(out), { recursive: true });
    // Written next to the final name, then renamed: a reader never sees a partial file.
    const tmp = `${out.slice(0, -'.jpg'.length)}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp.jpg`;
    try {
      await thumbnailDeps.runFfmpeg(
        ['-hide_banner', '-loglevel', 'error', '-y', '-i', sourcePath, '-vf', `scale=${width}:-2`, '-q:v', '5', tmp],
        THUMB_FFMPEG_TIMEOUT_MS,
      );
      if (!fs.existsSync(tmp) || fs.statSync(tmp).size === 0) throw new Error('ffmpeg wrote no output');
      fs.renameSync(tmp, out);
      return out;
    } catch (err: any) {
      console.warn(`[thumbs] Could not resize ${path.basename(sourcePath)} to ${width}px: ${err?.message || err}`);
      try { fs.rmSync(tmp, { force: true }); } catch {}
      try { fs.writeFileSync(marker, ''); } catch {}
      return null;
    }
  }).catch(() => null);

  inFlight.set(out, job);
  try {
    return await job;
  } finally {
    inFlight.delete(out);
  }
}

/**
 * Serves the resized variant asked for with `?w=`, for an image file the
 * calling route has ALREADY authorised and located (`sourcePath`, `stat`).
 * Returns null when the original should be served instead, so every route
 * keeps exactly one authorisation and containment path for both.
 */
export async function serveResizedThumbnail(event: H3Event, sourcePath: string, stat: fs.Stats): Promise<fs.ReadStream | null> {
  if (!IMAGE_EXTENSIONS.has(path.extname(sourcePath).toLowerCase())) return null;
  const width = parseThumbWidth(getQuery(event).w);
  if (!width) return null;

  const out = await getResizedThumbnail(sourcePath, stat, width);
  if (!out) return null;
  let size: number;
  try {
    size = fs.statSync(out).size;
  } catch {
    return null; // removed by a cache sweep in between
  }
  event.node.res.statusCode = 200;
  event.node.res.setHeader('Content-Type', 'image/jpeg');
  event.node.res.setHeader('Cache-Control', THUMB_CACHE_CONTROL);
  event.node.res.setHeader('Content-Length', size);
  return streamForResponse(event, out);
}

/**
 * Removes cached variants (and leftover temp files) not used for `maxAgeMs`
 * (a hit refreshes a variant's mtime, see touchOnHit), and failure markers
 * past their TTL. Returns how many were removed.
 */
export function sweepThumbCache(maxAgeMs: number = THUMB_CACHE_MAX_AGE_MS, now: number = Date.now()): number {
  const dir = getThumbCacheDir();
  let removed = 0;
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return 0;
  }
  for (const name of names) {
    const file = path.join(dir, name);
    try {
      const st = fs.statSync(file);
      const ttl = name.endsWith('.failed') ? THUMB_FAILURE_TTL_MS : maxAgeMs;
      if (st.isFile() && now - st.mtimeMs > ttl) {
        fs.rmSync(file, { force: true });
        removed++;
      }
    } catch {}
  }
  return removed;
}

// The periodic sweep of a running server (the scheduler plugin also sweeps once at startup).
const G_SWEEP_TIMER = Symbol.for('YouKeep.thumbSweepTimer');
const _g = globalThis as any;

/** Starts the daily cache sweep (idempotent). Returns a function that stops it. */
export function startThumbCacheSweep(intervalMs: number = THUMB_SWEEP_INTERVAL_MS): () => void {
  if (!_g[G_SWEEP_TIMER]) {
    const timer = setInterval(() => {
      try {
        const removed = sweepThumbCache();
        if (removed > 0) console.log(`[thumbs] Removed ${removed} cached thumbnail(s) unused for 90 days.`);
      } catch (err) {
        console.error('[thumbs] Thumbnail cache sweep failed:', err);
      }
    }, intervalMs);
    (timer as any).unref?.();
    _g[G_SWEEP_TIMER] = timer;
  }
  return stopThumbCacheSweep;
}

export function stopThumbCacheSweep(): void {
  if (_g[G_SWEEP_TIMER]) clearInterval(_g[G_SWEEP_TIMER]);
  _g[G_SWEEP_TIMER] = null;
}
