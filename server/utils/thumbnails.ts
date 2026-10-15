import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getQuery, type H3Event } from 'h3';
import { getDataDir } from './dataDir';
import { buildSpawnEnv } from './downloader';

/**
 * Resized thumbnails: `<image url>?w=<width>` serves a JPEG scaled down to
 * one of these widths, generated once by ffmpeg and cached under
 * data/cache/thumbs. Any other `w` (or none) serves the original file.
 * The cache can be deleted at any time; files are regenerated on demand.
 */
export const THUMB_WIDTHS = [160, 320, 480, 640, 960] as const;
export const THUMB_CACHE_CONTROL = 'private, max-age=31536000, immutable';
export const THUMB_FFMPEG_TIMEOUT_MS = 10_000;
export const THUMB_MAX_CONCURRENT = 2;
export const THUMB_CACHE_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

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

/** The process runner, injectable so tests never start a real ffmpeg. */
export const thumbnailDeps = {
  runFfmpeg(args: string[], timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      let child: ReturnType<typeof spawn>;
      try {
        child = spawn('ffmpeg', args, { env: buildSpawnEnv(), stdio: 'ignore' });
      } catch (err) {
        reject(err);
        return;
      }
      const timer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch {}
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
async function withFfmpegSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= THUMB_MAX_CONCURRENT) await new Promise<void>((resolve) => waiting.push(resolve));
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

function cacheFileFor(sourcePath: string, stat: fs.Stats, width: number): string {
  const hash = crypto.createHash('sha1').update(`${sourcePath}\u0000${stat.mtimeMs}\u0000${stat.size}`).digest('hex');
  return path.join(getThumbCacheDir(), `${hash}-${width}.jpg`);
}

/**
 * The cached resized copy of `sourcePath` at `width`, generating it when
 * missing. Null means "serve the original": unknown or not wider source
 * (never upscaled), or ffmpeg failed or timed out.
 */
export async function getResizedThumbnail(sourcePath: string, stat: fs.Stats, width: number): Promise<string | null> {
  const sourceWidth = readImageWidth(sourcePath);
  if (!sourceWidth || sourceWidth <= width) return null;

  const out = cacheFileFor(sourcePath, stat, width);
  if (fs.existsSync(out)) return out;

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
  return fs.createReadStream(out);
}

/** Removes cached variants (and leftover temp files) older than `maxAgeMs`. Returns how many were removed. */
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
      if (st.isFile() && now - st.mtimeMs > maxAgeMs) {
        fs.rmSync(file, { force: true });
        removed++;
      }
    } catch {}
  }
  return removed;
}
