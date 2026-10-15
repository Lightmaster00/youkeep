import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { getQuery } from 'h3';
import videoRoute from '../../server/routes/downloads/[...path]';
import musicRoute from '../../server/routes/downloads-music/[...path]';
import podcastRoute from '../../server/routes/downloads-podcasts/[...path]';
import { getDownloadsDir, sanitizeFolderName } from '../../server/utils/downloader';
import { getMusicDownloadsDir } from '../../server/utils/musicDownloader';
import { getPodcastDownloadsDir } from '../../server/utils/podcastDownloader';
import { canAccessVideo } from '../../server/utils/auth';
import { buildVideoPaths } from '../../server/utils/videoPaths';
import {
  THUMB_CACHE_CONTROL, getThumbCacheDir, imageWidthFromHeader, parseThumbWidth, sweepThumbCache, thumbnailDeps,
} from '../../server/utils/thumbnails';
import {
  assertInTmp, createTestDb, insertChannel, insertVideo, insertMusicArtist, insertMusicTrack, insertPodcastShow, insertPodcastEpisode, mockEvent,
} from '../helpers/testDb';

// Minimal image headers: enough for the width probe (the fake ffmpeg never decodes them).
function jpeg(width: number, height = 360): Buffer {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
  const sof = Buffer.alloc(19);
  sof.writeUInt16BE(0xffc0, 0); sof.writeUInt16BE(17, 2); sof.writeUInt8(8, 4);
  sof.writeUInt16BE(height, 5); sof.writeUInt16BE(width, 7); sof.writeUInt8(3, 9);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.from('original-image-bytes')]);
}
function png(width: number): Buffer {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'ascii'); b.writeUInt32BE(width, 16); b.writeUInt32BE(100, 20);
  return b;
}
function webp(kind: 'VP8 ' | 'VP8L' | 'VP8X', width: number): Buffer {
  const b = Buffer.alloc(40);
  b.write('RIFF', 0, 'ascii'); b.write('WEBP', 8, 'ascii'); b.write(kind, 12, 'ascii');
  if (kind === 'VP8 ') b.writeUInt16LE(width, 26);
  if (kind === 'VP8L') { const v = width - 1; b.writeUInt8(v & 0xff, 21); b.writeUInt8((v >> 8) & 0x3f, 22); }
  if (kind === 'VP8X') b.writeUIntLE(width - 1, 24, 3);
  return b;
}

let db: Database.Database;
let ffmpegCalls: string[][];
let ffmpegImpl: (args: string[]) => Promise<void>;
const writeOutput = (args: string[]) => {
  const out = args[args.length - 1]!;
  const width = args[args.indexOf('-vf') + 1]!.replace('scale=', '').replace(':-2', '');
  fs.writeFileSync(out, `resized-${width}`);
};

const channelId = 'thumb-chan';
let channelDir: string;

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
  (globalThis as any).getDownloadsDir = getDownloadsDir;
  (globalThis as any).sanitizeFolderName = sanitizeFolderName;
  (globalThis as any).canAccessVideo = canAccessVideo;
  (globalThis as any).getQuery = getQuery;
  (globalThis as any).getMusicDownloadsDir = getMusicDownloadsDir;
  (globalThis as any).getPodcastDownloadsDir = getPodcastDownloadsDir;
  (globalThis as any).canAccessMusicTrack = async () => true;
  (globalThis as any).canAccessPodcastEpisode = async () => true;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  ffmpegCalls = [];
  ffmpegImpl = async (args) => writeOutput(args);
  vi.spyOn(thumbnailDeps, 'runFfmpeg').mockImplementation(async (args) => { ffmpegCalls.push(args); await ffmpegImpl(args); });
  assertInTmp(getThumbCacheDir());
  fs.rmSync(getThumbCacheDir(), { recursive: true, force: true });
  insertChannel(db, { id: channelId, visibility: 'public' });
  channelDir = path.join(getDownloadsDir(), sanitizeFolderName(`Channel ${channelId}`));
  assertInTmp(channelDir);
  fs.mkdirSync(channelDir, { recursive: true });
});
afterEach(async () => {
  await new Promise((resolve) => setImmediate(resolve));
  vi.restoreAllMocks();
  fs.rmSync(channelDir, { recursive: true, force: true });
  fs.rmSync(getThumbCacheDir(), { recursive: true, force: true });
  for (const base of [getMusicDownloadsDir(), getPodcastDownloadsDir()]) {
    for (const entry of fs.readdirSync(base)) fs.rmSync(path.join(base, entry), { recursive: true, force: true });
  }
});

async function body(result: any): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of result) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('latin1');
}
const videoEvent = (file: string, query = '', headers?: Record<string, string>) =>
  mockEvent(undefined, { path: `/downloads/${channelId}/${file}${query}`, params: { path: `${channelId}/${file}` }, headers });
const seedVideoThumb = (id: string, content: Buffer, opts: { visibility?: string } = {}) => {
  insertVideo(db, { id, channelId, downloadStatus: 'completed', visibility: opts.visibility });
  fs.writeFileSync(path.join(channelDir, `${id}.jpg`), content);
};
const cacheFiles = () => (fs.existsSync(getThumbCacheDir()) ? fs.readdirSync(getThumbCacheDir()) : []);

describe('thumbnail width whitelist and image probe', () => {
  it('accepts only the listed widths', () => {
    for (const w of ['160', '320', '480', '640', '960']) expect(parseThumbWidth(w)).toBe(Number(w));
    for (const w of [undefined, '', '300', '1920', '0', '-160', '160.0', '160px', ' 160', 'abc', '0160']) expect(parseThumbWidth(w)).toBeNull();
    expect(parseThumbWidth(['320', '160'])).toBe(320);
  });

  it('reads the width of JPEG, PNG and WebP headers', () => {
    expect(imageWidthFromHeader(jpeg(1280))).toBe(1280);
    expect(imageWidthFromHeader(png(800))).toBe(800);
    expect(imageWidthFromHeader(webp('VP8 ', 640))).toBe(640);
    expect(imageWidthFromHeader(webp('VP8L', 1000))).toBe(1000);
    expect(imageWidthFromHeader(webp('VP8X', 1920))).toBe(1920);
    expect(imageWidthFromHeader(Buffer.from('not an image'))).toBeNull();
  });
});

describe('GET /downloads/...?w= (video thumbnails)', () => {
  it('generates the variant once, then serves it from the cache with a long-lived Cache-Control', async () => {
    seedVideoThumb('v1', jpeg(1280));
    const first = videoEvent('v1.jpg', '?w=320');
    expect(await body(await videoRoute(first))).toBe('resized-320');
    expect(first.node.res.headers['content-type']).toBe('image/jpeg');
    expect(first.node.res.headers['cache-control']).toBe(THUMB_CACHE_CONTROL);
    expect(first.node.res.headers['content-length']).toBe('resized-320'.length);
    expect(ffmpegCalls).toHaveLength(1);
    expect(ffmpegCalls[0]).toEqual(expect.arrayContaining(['-vf', 'scale=320:-2', '-q:v', '5']));

    const second = videoEvent('v1.jpg', '?w=320');
    expect(await body(await videoRoute(second))).toBe('resized-320');
    expect(ffmpegCalls).toHaveLength(1);
    expect(cacheFiles()).toHaveLength(1);
    expect(cacheFiles()[0]).toMatch(/^[0-9a-f]{40}-320\.jpg$/);
  });

  it('a width outside the whitelist, or none, serves the original', async () => {
    seedVideoThumb('v2', jpeg(1280));
    for (const query of ['', '?w=300', '?w=abc']) {
      const event = videoEvent('v2.jpg', query);
      expect(await body(await videoRoute(event))).toContain('original-image-bytes');
      expect(event.node.res.headers['cache-control']).toBe('private, must-revalidate');
    }
    expect(ffmpegCalls).toHaveLength(0);
  });

  it('never upscales: a source no wider than the asked width is served as is', async () => {
    seedVideoThumb('v3', jpeg(320));
    for (const query of ['?w=320', '?w=960']) {
      expect(await body(await videoRoute(videoEvent('v3.jpg', query)))).toContain('original-image-bytes');
    }
    // An unreadable header is not resized either.
    seedVideoThumb('v3b', Buffer.from('mystery'));
    expect(await body(await videoRoute(videoEvent('v3b.jpg', '?w=160')))).toBe('mystery');
    expect(ffmpegCalls).toHaveLength(0);
  });

  it('a failed or timed-out ffmpeg serves the original and leaves nothing in the cache', async () => {
    seedVideoThumb('v4', jpeg(1280));
    ffmpegImpl = async (args) => { fs.writeFileSync(args[args.length - 1]!, 'half'); throw new Error('ffmpeg timed out after 10000 ms'); };
    const event = videoEvent('v4.jpg', '?w=480');
    expect(await body(await videoRoute(event))).toContain('original-image-bytes');
    expect(event.node.res.headers['cache-control']).toBe('private, must-revalidate');
    expect(cacheFiles()).toEqual([]);

    ffmpegImpl = async () => {}; // exits 0 without writing anything
    expect(await body(await videoRoute(videoEvent('v4.jpg', '?w=480')))).toContain('original-image-bytes');
    expect(cacheFiles()).toEqual([]);
  });

  it('is authorised exactly like the original: denied is the same 404, and a share token works for both', async () => {
    const privateChannel = 'thumb-private';
    insertChannel(db, { id: privateChannel, visibility: 'private' });
    const privateDir = path.join(getDownloadsDir(), sanitizeFolderName(`Channel ${privateChannel}`));
    fs.mkdirSync(privateDir, { recursive: true });
    try {
      fs.writeFileSync(path.join(privateDir, 'p1.jpg'), jpeg(1280));
      insertVideo(db, { id: 'p1', channelId: privateChannel, visibility: 'private', downloadStatus: 'completed', shareToken: 'tok' });
      const ev = (query: string) => mockEvent(undefined, { path: `/downloads/${privateChannel}/p1.jpg${query}`, params: { path: `${privateChannel}/p1.jpg` } });

      await expect(videoRoute(ev(''))).rejects.toMatchObject({ statusCode: 404 });
      await expect(videoRoute(ev('?w=320'))).rejects.toMatchObject({ statusCode: 404 });
      await expect(videoRoute(ev('?token=wrong&w=320'))).rejects.toMatchObject({ statusCode: 404 });
      expect(ffmpegCalls).toHaveLength(0);

      expect(await body(await videoRoute(ev('?token=tok')))).toContain('original-image-bytes');
      expect(await body(await videoRoute(ev('?token=tok&w=320')))).toBe('resized-320');

      // A missing file is the same 404 with or without ?w=.
      insertVideo(db, { id: 'gone', channelId, downloadStatus: 'completed' });
      await expect(videoRoute(videoEvent('gone.jpg'))).rejects.toMatchObject({ statusCode: 404 });
      await expect(videoRoute(videoEvent('gone.jpg', '?w=320'))).rejects.toMatchObject({ statusCode: 404 });
      // Traversal is refused before any resize.
      await expect(videoRoute(mockEvent(undefined, { path: '/downloads/x/../y.jpg?w=320', params: { path: 'x/../../y.jpg' } }))).rejects.toMatchObject({ statusCode: 400 });
    } finally {
      fs.rmSync(privateDir, { recursive: true, force: true });
    }
  });

  it('one-folder-per-video layout: resized for an allowed viewer, the same 404 for a denied one', async () => {
    const seedNew = (id: string, chan: string, visibility: string) => {
      insertChannel(db, { id: chan, title: chan, visibility });
      const p = buildVideoPaths({ baseDir: getDownloadsDir(), channelFolder: chan, title: 'My Title', id });
      insertVideo(db, { id, channelId: chan, title: 'My Title', visibility, localVideoPath: p.videoUrlFor('mp4'), localThumbnailPath: p.thumbUrlFor('jpg') });
      fs.mkdirSync(p.dir, { recursive: true });
      fs.writeFileSync(path.join(p.dir, `${p.baseName}.jpg`), jpeg(1280));
      const url = p.thumbUrlFor('jpg');
      return (query: string) => mockEvent(undefined, { path: `${url}${query}`, params: { path: decodeURIComponent(url.slice('/downloads/'.length)) } });
    };
    try {
      const open = seedNew('nv1', 'NewChan', 'public');
      expect(await body(await videoRoute(open('?w=480')))).toBe('resized-480');
      const closed = seedNew('nv2', 'HiddenChan', 'private');
      await expect(videoRoute(closed(''))).rejects.toMatchObject({ statusCode: 404 });
      await expect(videoRoute(closed('?w=480'))).rejects.toMatchObject({ statusCode: 404 });
      expect(ffmpegCalls).toHaveLength(1);
    } finally {
      for (const chan of ['NewChan', 'HiddenChan']) fs.rmSync(path.join(getDownloadsDir(), chan), { recursive: true, force: true });
    }
  });

  it('concurrent identical requests share one ffmpeg run', async () => {
    seedVideoThumb('v5', jpeg(1280));
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    ffmpegImpl = async (args) => { await gate; writeOutput(args); };
    const pending = [1, 2, 3].map(() => videoRoute(videoEvent('v5.jpg', '?w=640')));
    await new Promise((r) => setImmediate(r));
    release();
    const bodies = await Promise.all(pending.map(async (p) => body(await p)));
    expect(bodies).toEqual(['resized-640', 'resized-640', 'resized-640']);
    expect(ffmpegCalls).toHaveLength(1);
  });

  it('runs at most two ffmpeg processes at once', async () => {
    for (const id of ['c1', 'c2', 'c3', 'c4', 'c5']) seedVideoThumb(id, jpeg(1280));
    let active = 0;
    let peak = 0;
    const releases: Array<() => void> = [];
    ffmpegImpl = async (args) => {
      active++; peak = Math.max(peak, active);
      await new Promise<void>((r) => releases.push(r));
      writeOutput(args);
      active--;
    };
    const pending = ['c1', 'c2', 'c3', 'c4', 'c5'].map((id) => videoRoute(videoEvent(`${id}.jpg`, '?w=160')));
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setImmediate(r));
      releases.shift()?.();
    }
    const bodies = await Promise.all(pending.map(async (p) => body(await p)));
    expect(bodies.every((b) => b === 'resized-160')).toBe(true);
    expect(ffmpegCalls).toHaveLength(5);
    expect(peak).toBe(2);
  });

  it('a changed source file gets a new variant', async () => {
    seedVideoThumb('v6', jpeg(1280));
    await body(await videoRoute(videoEvent('v6.jpg', '?w=160')));
    const file = path.join(channelDir, 'v6.jpg');
    fs.writeFileSync(file, Buffer.concat([jpeg(1280), Buffer.from('-new')]));
    await body(await videoRoute(videoEvent('v6.jpg', '?w=160')));
    expect(ffmpegCalls).toHaveLength(2);
    expect(cacheFiles()).toHaveLength(2);
  });

  it('Range requests on the original video file are unchanged', async () => {
    insertVideo(db, { id: 'v7', channelId, downloadStatus: 'completed' });
    fs.writeFileSync(path.join(channelDir, 'v7.mp4'), 'abcdef');
    const event = videoEvent('v7.mp4', '?w=320', { range: 'bytes=1-2' });
    expect(await body(await videoRoute(event))).toBe('bc');
    expect(event.node.res.statusCode).toBe(206);
    expect(ffmpegCalls).toHaveLength(0);
  });
});

describe('music and podcast cover variants', () => {
  it('music: resized after the same checks; a denied track is the same 403 with or without ?w=', async () => {
    insertMusicArtist(db, { id: 'a1', name: 'Artist' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', downloadStatus: 'completed' });
    fs.mkdirSync(path.join(getMusicDownloadsDir(), 'Artist'), { recursive: true });
    fs.writeFileSync(path.join(getMusicDownloadsDir(), 'Artist', 't1.webp'), webp('VP8X', 1280));
    const ev = (query: string) => mockEvent(undefined, { path: `/downloads-music/Artist/t1.webp${query}`, params: { path: 'Artist/t1.webp' } });

    const resized = ev('?w=160');
    expect(await body(await musicRoute(resized))).toBe('resized-160');
    expect(resized.node.res.headers['content-type']).toBe('image/jpeg');
    expect(resized.node.res.headers['cache-control']).toBe(THUMB_CACHE_CONTROL);

    (globalThis as any).canAccessMusicTrack = async () => false;
    await expect(musicRoute(ev(''))).rejects.toMatchObject({ statusCode: 403 });
    await expect(musicRoute(ev('?w=160'))).rejects.toMatchObject({ statusCode: 403 });
    expect(ffmpegCalls).toHaveLength(1);
  });

  it('podcast: resized after the same checks; a denied episode is the same 403 with or without ?w=', async () => {
    insertPodcastShow(db, { id: 's1', title: 'Show' });
    insertPodcastEpisode(db, { id: 'e1', showId: 's1', downloadStatus: 'completed' });
    fs.mkdirSync(path.join(getPodcastDownloadsDir(), 'Show'), { recursive: true });
    fs.writeFileSync(path.join(getPodcastDownloadsDir(), 'Show', 'e1.png'), png(1400));
    const ev = (query: string) => mockEvent(undefined, { path: `/downloads-podcasts/Show/e1.png${query}`, params: { path: 'Show/e1.png' } });

    expect(await body(await podcastRoute(ev('?w=480')))).toBe('resized-480');

    (globalThis as any).canAccessPodcastEpisode = async () => false;
    await expect(podcastRoute(ev(''))).rejects.toMatchObject({ statusCode: 403 });
    await expect(podcastRoute(ev('?w=480'))).rejects.toMatchObject({ statusCode: 403 });
    expect(ffmpegCalls).toHaveLength(1);
  });
});

describe('thumbnail cache sweep', () => {
  it('removes variants older than 90 days and keeps recent ones', () => {
    const dir = getThumbCacheDir();
    fs.mkdirSync(dir, { recursive: true });
    const now = Date.now();
    const old = path.join(dir, 'old-160.jpg');
    const recent = path.join(dir, 'recent-160.jpg');
    fs.writeFileSync(old, 'x');
    fs.writeFileSync(recent, 'x');
    const longAgo = new Date(now - 91 * 24 * 60 * 60 * 1000);
    fs.utimesSync(old, longAgo, longAgo);
    const lately = new Date(now - 89 * 24 * 60 * 60 * 1000);
    fs.utimesSync(recent, lately, lately);

    expect(sweepThumbCache(undefined, now)).toBe(1);
    expect(fs.readdirSync(dir)).toEqual(['recent-160.jpg']);
  });

  it('a missing cache folder is fine', () => {
    expect(sweepThumbCache()).toBe(0);
  });
});
