import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { downloadEpisodeFile, podcastDownloadLimits, getPodcastDownloadsDir } from '../../server/utils/podcastDownloader';
import { safeUrlDeps } from '../../server/utils/safeUrl';
import { activeProcesses, cancelDownload, normalizeCustomSavePath } from '../../server/utils/downloader';
import { buildVideoPaths } from '../../server/utils/videoPaths';
import { thumbnailDeps, getResizedThumbnail, clearThumbWidthCache } from '../../server/utils/thumbnails';
import optionsHandler from '../../server/api/admin/channels/[id]/options.put';
import clearQueueHandler from '../../server/api/admin/downloader/clear-queue.post';
import ingestHandler from '../../server/api/admin/downloader/ingest.post';
import { createTestDb, insertChannel, insertVideo, insertPodcastShow, insertPodcastEpisode, mockEvent } from '../helpers/testDb';

let db: Database.Database;
let dir: string;
const realLimits = { ...podcastDownloadLimits };
const realLookup = safeUrlDeps.lookup;

beforeEach(() => {
  db = createTestDb();
  for (const col of ['description TEXT', 'banner_url TEXT', 'download_videos INTEGER DEFAULT 1', 'download_shorts INTEGER DEFAULT 0',
    'download_lives INTEGER DEFAULT 0', 'date_after TEXT']) db.exec(`ALTER TABLE channels ADD COLUMN ${col}`);
  (globalThis as any).getDb = () => db;
  (globalThis as any).requireAdmin = async () => ({ id: 'admin', role: 'admin' });
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yk-hygiene-'));
  safeUrlDeps.lookup = async (host: string) => [{ address: host.endsWith('.lan') ? '10.0.0.7' : '93.184.216.34', family: 4 }];
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  Object.assign(podcastDownloadLimits, realLimits);
  safeUrlDeps.lookup = realLookup;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  activeProcesses.clear();
  fs.rmSync(dir, { recursive: true, force: true });
  for (const e of fs.readdirSync(getPodcastDownloadsDir())) fs.rmSync(path.join(getPodcastDownloadsDir(), e), { recursive: true, force: true });
});

function seedEpisode(audioUrl: string) {
  insertPodcastShow(db, { id: 's1', title: 'Show' });
  insertPodcastEpisode(db, { id: 'e1', showId: 's1', downloadStatus: 'downloading', audioUrl });
}
const showFiles = () => (fs.existsSync(path.join(getPodcastDownloadsDir(), 'Show')) ? fs.readdirSync(path.join(getPodcastDownloadsDir(), 'Show')) : []);

describe('episode downloads (third-party addresses)', () => {
  it('refuses enclosures on loopback, the LAN or metadata addresses, and redirects there, without fetching them', async () => {
    const fetchFn = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest' } }));
    vi.stubGlobal('fetch', fetchFn);
    for (const url of ['http://127.0.0.1:3000/api/admin/x', 'http://nas.lan/ep.mp3', 'http://[::1]/x', 'file:///etc/passwd']) {
      db = createTestDb(); (globalThis as any).getDb = () => db;
      seedEpisode(url);
      await expect(downloadEpisodeFile('e1', 's1')).rejects.toThrow(/allowed/);
    }
    expect(fetchFn).not.toHaveBeenCalled();
    db = createTestDb(); (globalThis as any).getDb = () => db;
    seedEpisode('https://cdn.example/ep.mp3');
    await expect(downloadEpisodeFile('e1', 's1')).rejects.toThrow(/not allowed/);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('aborts when the server sends more than its Content-Length', async () => {
    seedEpisode('https://cdn.example/ep.mp3');
    vi.stubGlobal('fetch', async () => new Response(new ReadableStream({
      start(c) { c.enqueue(new Uint8Array(60)); c.enqueue(new Uint8Array(60)); c.close(); },
    }), { headers: { 'content-type': 'audio/mpeg', 'content-length': '100' } }));
    await expect(downloadEpisodeFile('e1', 's1')).rejects.toThrow(/more than the 100 bytes/);
    expect(showFiles()).toEqual([]);
  });

  it('aborts past the hard cap when no length is announced', async () => {
    podcastDownloadLimits.maxBytes = 1000;
    seedEpisode('https://cdn.example/ep.mp3');
    vi.stubGlobal('fetch', async () => new Response(new ReadableStream({
      start(c) { for (let i = 0; i < 5; i++) c.enqueue(new Uint8Array(400)); c.close(); },
    }), { headers: { 'content-type': 'audio/mpeg' } }));
    await expect(downloadEpisodeFile('e1', 's1')).rejects.toThrow(/larger than/);
    expect(showFiles()).toEqual([]);
  });

  it('checks free space in the show folder while downloading', async () => {
    podcastDownloadLimits.spaceCheckBytes = 100;
    seedEpisode('https://cdn.example/ep.mp3');
    const statfs = vi.spyOn(fs.promises, 'statfs').mockResolvedValue({ bavail: 0, bsize: 4096 } as any);
    vi.stubGlobal('fetch', async () => new Response(new ReadableStream({
      start(c) { for (let i = 0; i < 3; i++) c.enqueue(new Uint8Array(80)); c.close(); },
    }), { headers: { 'content-type': 'audio/mpeg' } }));
    await expect(downloadEpisodeFile('e1', 's1')).rejects.toThrow(/Not enough free disk space/);
    expect(statfs.mock.calls[0]![0]).toBe(path.join(getPodcastDownloadsDir(), 'Show'));
  });
});

describe('episode downloads of a LAN show', () => {
  const ok = () => new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(10)); c.close(); } }), { headers: { 'content-type': 'audio/mpeg' } });
  function seedLan(feedUrl: string, audioUrl: string) {
    insertPodcastShow(db, { id: 's1', title: 'Show', feedUrl });
    insertPodcastEpisode(db, { id: 'e1', showId: 's1', downloadStatus: 'downloading', audioUrl });
  }

  it('a show whose feed is on the LAN may download its enclosures from the LAN', async () => {
    const fetchFn = vi.fn(async () => ok());
    vi.stubGlobal('fetch', fetchFn);
    seedLan('http://nas.lan/feed.xml', 'http://nas.lan/ep.mp3');
    await downloadEpisodeFile('e1', 's1');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(showFiles()).toEqual(['e1.mp3']);
  });

  it('metadata and link-local addresses stay blocked for a LAN show', async () => {
    const fetchFn = vi.fn(async () => ok());
    vi.stubGlobal('fetch', fetchFn);
    seedLan('http://192.168.1.5/feed.xml', 'http://169.254.169.254/latest/meta-data');
    await expect(downloadEpisodeFile('e1', 's1')).rejects.toThrow(/not allowed/);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('a show whose feed is public still may not reach the LAN', async () => {
    const fetchFn = vi.fn(async () => ok());
    vi.stubGlobal('fetch', fetchFn);
    seedLan('https://feeds.example/feed.xml', 'http://nas.lan/ep.mp3');
    await expect(downloadEpisodeFile('e1', 's1')).rejects.toThrow(/not allowed/);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('compressed enclosures', () => {
  it('a Content-Encoding response is not cut at its (compressed) Content-Length', async () => {
    seedEpisode('https://cdn.example/ep.mp3');
    vi.stubGlobal('fetch', async () => new Response(new ReadableStream({
      start(c) { c.enqueue(new Uint8Array(60)); c.enqueue(new Uint8Array(60)); c.close(); },
    }), { headers: { 'content-type': 'audio/mpeg', 'content-length': '100', 'content-encoding': 'gzip' } }));
    await downloadEpisodeFile('e1', 's1');
    expect(fs.statSync(path.join(getPodcastDownloadsDir(), 'Show', 'e1.mp3')).size).toBe(120);
  });

  it('the hard cap still applies to decompressed bytes', async () => {
    podcastDownloadLimits.maxBytes = 1000;
    seedEpisode('https://cdn.example/ep.mp3');
    vi.stubGlobal('fetch', async () => new Response(new ReadableStream({
      start(c) { for (let i = 0; i < 5; i++) c.enqueue(new Uint8Array(400)); c.close(); },
    }), { headers: { 'content-type': 'audio/mpeg', 'content-length': '50', 'content-encoding': 'br' } }));
    await expect(downloadEpisodeFile('e1', 's1')).rejects.toThrow(/larger than/);
    expect(showFiles()).toEqual([]);
  });
});

describe('queue changes stop running downloads and remove their partial files', () => {
  function seedRunning(id: string, opts: { isShort?: boolean } = {}) {
    const p = buildVideoPaths({ baseDir: dir, channelFolder: 'Chan', title: 'T', id });
    insertVideo(db, { id, channelId: 'c1', title: 'T', downloadStatus: 'downloading', isShort: opts.isShort });
    fs.mkdirSync(p.dir, { recursive: true });
    fs.writeFileSync(path.join(p.dir, `${p.baseName}.mp4.part`), 'partial');
    const child = { kill: vi.fn(), pid: undefined };
    activeProcesses.set(id, child);
    return { child, dir: p.dir };
  }
  beforeEach(() => {
    insertChannel(db, { id: 'c1', title: 'Chan', customSavePath: dir });
    (globalThis as any).cancelDownload = cancelDownload;
  });

  it('channel options that drop a running video', async () => {
    const run = seedRunning('o1', { isShort: true });
    await optionsHandler(mockEvent(undefined, { method: 'PUT', params: { id: 'c1' }, body: { downloadVideos: true, downloadShorts: false } }));
    expect(run.child.kill).toHaveBeenCalled();
    expect(fs.existsSync(run.dir)).toBe(false);
    expect(db.prepare("SELECT COUNT(*) AS n FROM videos WHERE id = 'o1'").get()).toEqual({ n: 0 });
  });

  it('clearing the queue, paused partial downloads included', async () => {
    const run = seedRunning('q1');
    const p = buildVideoPaths({ baseDir: dir, channelFolder: 'Chan', title: 'P', id: 'q2' });
    insertVideo(db, { id: 'q2', channelId: 'c1', title: 'P', downloadStatus: 'pending' });
    db.prepare("UPDATE videos SET download_progress = 40 WHERE id = 'q2'").run();
    fs.mkdirSync(p.dir, { recursive: true });
    fs.writeFileSync(path.join(p.dir, `${p.baseName}.mp4.part`), 'partial');
    await clearQueueHandler(mockEvent(undefined, { method: 'POST' }));
    expect(run.child.kill).toHaveBeenCalled();
    expect(fs.existsSync(run.dir)).toBe(false);
    expect(fs.existsSync(p.dir)).toBe(false);
  });
});

describe('custom save folders', () => {
  it('must be absolute, normalised and without ..', async () => {
    expect(normalizeCustomSavePath('/media/videos/')).toBe('/media/videos');
    expect(normalizeCustomSavePath('/media//videos')).toBe('/media/videos');
    for (const bad of ['relative/path', './x', '/media/../etc', '/media/./x', '', 42, null]) expect(normalizeCustomSavePath(bad)).toBeNull();
    insertChannel(db, { id: 'c2', title: 'C' });
    await expect(optionsHandler(mockEvent(undefined, { method: 'PUT', params: { id: 'c2' }, body: { downloadVideos: true, customSavePath: 'videos/here' } }))).rejects.toMatchObject({ statusCode: 400 });
    await expect(optionsHandler(mockEvent(undefined, { method: 'PUT', params: { id: 'c2' }, body: { downloadVideos: true, customSavePath: '/srv/../etc' } }))).rejects.toMatchObject({ statusCode: 400 });
    await expect(ingestHandler(mockEvent(undefined, { method: 'POST', body: { url: 'https://www.youtube.com/@x', custom_save_path: 'rel' } }))).rejects.toMatchObject({ statusCode: 400 });
    await optionsHandler(mockEvent(undefined, { method: 'PUT', params: { id: 'c2' }, body: { downloadVideos: true, customSavePath: `${dir}/` } }));
    expect((db.prepare("SELECT custom_save_path FROM channels WHERE id = 'c2'").get() as any).custom_save_path).toBe(dir);
  });
});

describe('thumbnail cache free space', () => {
  it('serves the original when the disk is nearly full', async () => {
    clearThumbWidthCache();
    const src = path.join(dir, 'big.jpg');
    fs.writeFileSync(src, 'x');
    vi.spyOn(thumbnailDeps, 'readWidth').mockResolvedValue(2000);
    vi.spyOn(thumbnailDeps, 'hasSpace').mockResolvedValue(false);
    const run = vi.spyOn(thumbnailDeps, 'runFfmpeg');
    expect(await getResizedThumbnail(src, fs.statSync(src), 320)).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });
});
