import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import Database from 'better-sqlite3';
import { createApp, defineEventHandler, toNodeListener } from 'h3';
import handler from '../../server/routes/downloads/[...path]';
import { sanitizeFolderName } from '../../server/utils/downloader';
import { canAccessVideo } from '../../server/utils/auth';
import { buildVideoPaths } from '../../server/utils/videoPaths';
import { parseByteRange, sendMediaFile, statRegularFile } from '../../server/utils/mediaResponse';
import { downloadEpisodeFile, extensionFromUrl } from '../../server/utils/podcastDownloader';
import { createTestDb, insertChannel, insertVideo, insertPodcastShow, insertPodcastEpisode, mockEvent } from '../helpers/testDb';
import { safeUrlDeps } from '../../server/utils/safeUrl';

let db: Database.Database;
let dir: string;

beforeEach(() => {
  db = createTestDb();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yk-media-'));
  (globalThis as any).getDb = () => db;
  (globalThis as any).getDownloadsDir = () => dir;
  (globalThis as any).sanitizeFolderName = sanitizeFolderName;
  (globalThis as any).canAccessVideo = canAccessVideo;
  (globalThis as any).getQuery = () => ({});
});
afterEach(async () => {
  await new Promise((r) => setImmediate(r));
  vi.unstubAllGlobals();
  fs.rmSync(dir, { recursive: true, force: true });
});

const close = (r: any) => { if (r && typeof r.destroy === 'function') { r.on?.('error', () => {}); r.destroy(); } };
const ev = (param: string, headers?: Record<string, string>) => mockEvent(undefined, { params: { path: param }, headers });
async function status(param: string, headers?: Record<string, string>) {
  const event = ev(param, headers);
  try { close(await handler(event)); return { code: event.node.res.statusCode as number, headers: event.node.res.headers }; } catch (e: any) { return { code: e.statusCode as number, headers: {} }; }
}

describe('parseByteRange', () => {
  it('clamps, refuses and keeps only the first range', () => {
    expect(parseByteRange('bytes=0-99', 10)).toEqual({ kind: 'range', start: 0, end: 9 });
    expect(parseByteRange('bytes=5-', 10)).toEqual({ kind: 'range', start: 5, end: 9 });
    expect(parseByteRange('bytes=-3', 10)).toEqual({ kind: 'range', start: 7, end: 9 });
    expect(parseByteRange('bytes=-30', 10)).toEqual({ kind: 'range', start: 0, end: 9 });
    expect(parseByteRange('bytes=10-12', 10)).toEqual({ kind: 'unsatisfiable' });
    expect(parseByteRange('bytes=-0', 10)).toEqual({ kind: 'unsatisfiable' });
    expect(parseByteRange('bytes=1-2,4-5', 10)).toEqual({ kind: 'range', start: 1, end: 2 });
    expect(parseByteRange('bytes=abc', 10)).toEqual({ kind: 'none' });
    expect(parseByteRange('items=0-1', 10)).toEqual({ kind: 'none' });
    expect(parseByteRange(undefined, 10)).toEqual({ kind: 'none' });
  });
  it('statRegularFile refuses directories', () => {
    expect(statRegularFile(dir)).toBeNull();
  });
});

describe('If-Range, ETag and reversed ranges (R6)', () => {
  function serve(headers: Record<string, string>) {
    const file = path.join(dir, 'a.mp3');
    if (!fs.existsSync(file)) fs.writeFileSync(file, '0123456789');
    const stat = fs.statSync(file);
    const event = mockEvent(undefined, { headers });
    close(sendMediaFile(event, file, stat, { contentType: 'audio/mpeg', immutable: false }));
    return { code: event.node.res.statusCode as number, headers: event.node.res.headers as Record<string, any>, stat };
  }

  it('a reversed range (end < start) is ignored: the whole file (200)', () => {
    expect(parseByteRange('bytes=5-2', 10)).toEqual({ kind: 'none' });
    expect(serve({ range: 'bytes=5-2' }).code).toBe(200);
  });

  it('every response carries an ETag', () => {
    const r = serve({});
    expect(r.headers.etag).toMatch(/^"[0-9a-f]+-[0-9a-f]+"$/);
  });

  it('If-Range with the current ETag or Last-Modified honours the range (206)', () => {
    const { headers } = serve({});
    expect(serve({ range: 'bytes=0-3', 'if-range': headers.etag }).code).toBe(206);
    expect(serve({ range: 'bytes=0-3', 'if-range': headers['last-modified'] }).code).toBe(206);
  });

  it('If-Range with another ETag, a weak one or another date sends the full file (200)', () => {
    const { headers, stat } = serve({});
    for (const ifRange of ['"bogus"', `W/${headers.etag}`, new Date(stat.mtime.getTime() - 5000).toUTCString(), 'not a date']) {
      const r = serve({ range: 'bytes=0-3', 'if-range': ifRange });
      expect(r.code).toBe(200);
      expect(r.headers['content-length']).toBe(10);
    }
  });

  it('If-None-Match with the current ETag is a 304', () => {
    const { headers } = serve({});
    expect(serve({ 'if-none-match': headers.etag }).code).toBe(304);
    expect(serve({ 'if-none-match': '"other"' }).code).toBe(200);
  });
});

describe('/downloads: Range, directories and legacy paths', () => {
  function seedNew() {
    insertChannel(db, { id: 'c1', title: 'Chan' });
    const p = buildVideoPaths({ baseDir: dir, channelFolder: 'Chan', title: 'T', id: 'v1' });
    insertVideo(db, { id: 'v1', channelId: 'c1', title: 'T', localVideoPath: p.videoUrlFor('mp4'), localThumbnailPath: p.thumbUrlFor('jpg') });
    fs.mkdirSync(p.dir, { recursive: true });
    fs.writeFileSync(path.join(p.dir, `${p.baseName}.mp4`), '0123456789');
    return p;
  }
  const param = (p: ReturnType<typeof buildVideoPaths>, file: string) => `Chan/${p.baseName}/${file}`;

  it('a range end at or after the size is clamped (206), a start past it is 416 with bytes */size', async () => {
    const p = seedNew();
    const clamped = await status(param(p, `${p.baseName}.mp4`), { range: 'bytes=4-500' });
    expect(clamped.code).toBe(206);
    expect(clamped.headers['content-range']).toBe('bytes 4-9/10');
    expect(clamped.headers['content-length']).toBe(6);
    const bad = await status(param(p, `${p.baseName}.mp4`), { range: 'bytes=10-' });
    expect(bad.code).toBe(416);
    expect(bad.headers['content-range']).toBe('bytes */10');
    const multi = await status(param(p, `${p.baseName}.mp4`), { range: 'bytes=0-1,5-6' });
    expect(multi.code).toBe(206);
    expect(multi.headers['content-range']).toBe('bytes 0-1/10');
  });

  it('a directory where a file is expected is a 404, never a 500', async () => {
    const p = seedNew();
    fs.mkdirSync(path.join(p.dir, `${p.baseName}.jpg`));
    expect((await status(param(p, `${p.baseName}.jpg`))).code).toBe(404);
    insertChannel(db, { id: 'c2', title: 'Old' });
    insertVideo(db, { id: 'old2', channelId: 'c2', localVideoPath: '/downloads/Old/old2.mp4' });
    fs.mkdirSync(path.join(dir, 'Old', 'old2.mp4'), { recursive: true });
    expect((await status('Old/old2.mp4')).code).toBe(404);
  });

  it('a file two levels down that belongs to no known video is a 404 (legacy fallback removed)', async () => {
    insertChannel(db, { id: 'chP', title: 'chP', visibility: 'ultra_private' });
    fs.mkdirSync(path.join(dir, 'Photos'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'Photos', 'family.jpg'), 'x');
    fs.mkdirSync(path.join(dir, 'chP'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'chP', 'leftover-notes.txt'), 'x');
    expect((await status('Photos/family.jpg')).code).toBe(404);
    expect((await status('chP/leftover-notes.txt')).code).toBe(404);
    // A known video id with a file in a folder that is not its channel's: 404 too.
    seedNew();
    fs.writeFileSync(path.join(dir, 'Photos', 'v1.mp4'), 'x');
    expect((await status('Photos/v1.mp4')).code).toBe(404);
  });

  it('every legitimate layout still serves: legacy flat, renamed legacy, custom save path, nested, doubled', async () => {
    // Legacy flat in the default folder.
    insertChannel(db, { id: 'L', title: 'Legacy Chan' });
    insertVideo(db, { id: 'lg1', channelId: 'L', localVideoPath: '/downloads/Legacy%20Chan/lg1.mp4' });
    fs.mkdirSync(path.join(dir, 'Legacy Chan'));
    fs.writeFileSync(path.join(dir, 'Legacy Chan', 'lg1.mp4'), 'x');
    fs.writeFileSync(path.join(dir, 'Legacy Chan', 'lg1.en.vtt'), 'x');
    expect((await status('Legacy Chan/lg1.mp4')).code).toBe(200);
    expect((await status('Legacy Chan/lg1.en.vtt')).code).toBe(200);
    // Legacy file under the name the channel had when it was downloaded.
    insertChannel(db, { id: 'R', title: 'Renamed Now' });
    insertVideo(db, { id: 'rn1', channelId: 'R', localVideoPath: '/downloads/Before/rn1.mp4' });
    fs.mkdirSync(path.join(dir, 'Before'));
    fs.writeFileSync(path.join(dir, 'Before', 'rn1.mp4'), 'x');
    expect((await status('Before/rn1.mp4')).code).toBe(200);
    // Legacy flat in a custom save folder.
    const custom = path.join(dir, 'custom');
    insertChannel(db, { id: 'C', title: 'Custom Chan', customSavePath: custom });
    insertVideo(db, { id: 'cu1', channelId: 'C', localVideoPath: '/downloads/Custom%20Chan/cu1.mp4' });
    fs.mkdirSync(path.join(custom, 'Custom Chan'), { recursive: true });
    fs.writeFileSync(path.join(custom, 'Custom Chan', 'cu1.mp4'), 'x');
    expect((await status('Custom Chan/cu1.mp4')).code).toBe(200);
    // New nested layout.
    const p = seedNew();
    expect((await status(`Chan/${p.baseName}/${p.baseName}.mp4`)).code).toBe(200);
    // Doubled save folder (<custom>/Dup) whose video was moved up to <custom>/Dup/<video folder>.
    const dup = path.join(dir, 'Dup');
    insertChannel(db, { id: 'D', title: 'Dup', customSavePath: dup });
    const d = buildVideoPaths({ baseDir: dup, channelFolder: 'Dup', title: 'X', id: 'dp1' });
    insertVideo(db, { id: 'dp1', channelId: 'D', title: 'X', localVideoPath: d.videoUrlFor('mp4') });
    fs.mkdirSync(path.join(dup, d.baseName), { recursive: true });
    fs.writeFileSync(path.join(dup, d.baseName, `${d.baseName}.mp4`), 'x');
    expect((await status(`Dup/${d.baseName}/${d.baseName}.mp4`)).code).toBe(200);
  });

  it('a video named after its id is immutable; a thumbnail revalidates daily', async () => {
    const p = seedNew();
    fs.writeFileSync(path.join(p.dir, `${p.baseName}.jpg`), 'x');
    expect((await status(param(p, `${p.baseName}.mp4`))).headers['cache-control']).toBe('private, max-age=31536000, immutable');
    expect((await status(param(p, `${p.baseName}.jpg`))).headers['cache-control']).toBe('private, max-age=86400, must-revalidate');
  });
});

describe('an aborted request releases its file descriptor', () => {
  const openFds = () => fs.readdirSync(process.platform === 'linux' ? '/proc/self/fd' : '/dev/fd').length;

  it('the read stream is destroyed when the client goes away', async () => {
    const file = path.join(dir, 'big.bin');
    fs.writeFileSync(file, Buffer.alloc(32 * 1024 * 1024));
    const streams: fs.ReadStream[] = [];
    const app = createApp().use(defineEventHandler((event) => {
      const out = sendMediaFile(event, file, statRegularFile(file)!, { contentType: 'video/mp4', immutable: true }) as fs.ReadStream;
      streams.push(out);
      return out;
    }));
    const server = http.createServer(toNodeListener(app));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const port = (server.address() as any).port;
    const before = openFds();
    try {
      for (let i = 0; i < 5; i++) {
        await new Promise<void>((resolve) => {
          const req = http.get({ host: '127.0.0.1', port, path: '/' }, (res) => {
            res.once('data', () => { req.destroy(); resolve(); });
          });
          req.on('error', () => resolve());
        });
      }
      await vi.waitFor(() => expect(streams.every((s) => s.destroyed)).toBe(true), { timeout: 3000 });
      await vi.waitFor(() => expect(openFds()).toBeLessThanOrEqual(before + 1), { timeout: 3000 });
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});

describe('podcast episode files always get a playable extension', () => {
  it('maps an unknown URL extension to the content type or mp3', async () => {
    expect(extensionFromUrl('https://h/ep.php?id=1')).toBeNull();
    expect(extensionFromUrl('https://h/ep.m4a')).toBe('m4a');
    insertPodcastShow(db, { id: 's1', title: 'Show' });
    insertPodcastEpisode(db, { id: 'e1', showId: 's1', downloadStatus: 'downloading', audioUrl: 'https://feeds.example/download.php?id=1' });
    safeUrlDeps.lookup = async () => [{ address: '93.184.216.34', family: 4 }];
    vi.stubGlobal('fetch', async () => new Response('abc', { headers: { 'content-type': 'text/html' } }));
    (globalThis as any).isWipeInProgress = () => false;
    await downloadEpisodeFile('e1', 's1');
    const row = db.prepare("SELECT local_file_path FROM podcast_episodes WHERE id = 'e1'").get() as any;
    expect(row.local_file_path).toMatch(/\/e1\.mp3$/);
  });
});
