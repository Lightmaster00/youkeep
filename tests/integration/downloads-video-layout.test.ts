import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import handler from '../../server/routes/downloads/[...path]';
import { createTestDb, insertChannel, insertVideo, mockEvent } from '../helpers/testDb';
import { sanitizeFolderName } from '../../server/utils/downloader';
import { canAccessVideo } from '../../server/utils/auth';
import { buildVideoPaths } from '../../server/utils/videoPaths';

let db: Database.Database;
let dir: string;

beforeEach(() => {
  db = createTestDb();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yk-route-'));
  (globalThis as any).getDb = () => db;
  (globalThis as any).getDownloadsDir = () => dir;
  (globalThis as any).sanitizeFolderName = sanitizeFolderName;
  (globalThis as any).canAccessVideo = canAccessVideo;
  (globalThis as any).getQuery = () => ({});
});

afterEach(async () => {
  // Let any lazily-opened read stream settle before removing its file.
  await new Promise((resolve) => setImmediate(resolve));
  fs.rmSync(dir, { recursive: true, force: true });
});

function closeIfStream(result: any) {
  if (result && typeof result.destroy === 'function') {
    result.on?.('error', () => {});
    result.destroy();
  }
}

function seed(opts: { id: string; channelId: string; channelTitle: string; title: string; baseDir: string; visibility?: string; customSavePath?: string }) {
  insertChannel(db, { id: opts.channelId, title: opts.channelTitle, visibility: opts.visibility, customSavePath: opts.customSavePath ?? null });
  const p = buildVideoPaths({ baseDir: opts.baseDir, channelFolder: opts.channelTitle, title: opts.title, id: opts.id });
  insertVideo(db, { id: opts.id, channelId: opts.channelId, title: opts.title, visibility: opts.visibility, localVideoPath: p.videoUrlFor('mp4'), localThumbnailPath: p.thumbUrlFor('jpg') });
  fs.mkdirSync(p.dir, { recursive: true });
  fs.writeFileSync(path.join(p.dir, `${p.baseName}.mp4`), '0123456789');
  return p;
}

// The stored (percent-encoded) URL is what the browser requests; h3 hands the
// route the raw remainder of the path, still encoded.
const eventFor = (url: string, headers?: Record<string, string>) =>
  mockEvent(undefined, { path: url, params: { path: url.slice('/downloads/'.length) }, headers });

describe('GET /downloads/<channel>/<Title [id]>/<file>', () => {
  it('serves a file from the video folder, with Range support', async () => {
    const p = seed({ id: 'v1', channelId: 'c1', channelTitle: 'My Chan', title: 'Episode #3: 100% done?', baseDir: dir });
    const event = eventFor(p.videoUrlFor('mp4'), { range: 'bytes=0-3' });
    closeIfStream(await handler(event));
    expect(event.node.res.statusCode).toBe(206);
    expect(event.node.res.headers['content-range']).toBe('bytes 0-3/10');
    expect(event.node.res.headers['content-type']).toBe('video/mp4');
  });

  it('finds a video already moved up out of a doubled channel folder', async () => {
    const custom = path.join(dir, 'Dup');
    const p = seed({ id: 'd1', channelId: 'c2', channelTitle: 'Dup', title: 'Clip', baseDir: custom, customSavePath: custom });
    fs.renameSync(p.dir, path.join(custom, p.baseName));
    const event = eventFor(p.videoUrlFor('mp4'));
    closeIfStream(await handler(event));
    expect(event.node.res.statusCode).toBe(200);
  });

  it('refuses traversal, folders that are not the video\'s own, and private videos', async () => {
    const p = seed({ id: 'v1', channelId: 'c1', channelTitle: 'My Chan', title: 'Clip', baseDir: dir });
    const folder = encodeURIComponent(p.baseName);
    await expect(handler(eventFor('/downloads/My%20Chan/..%2F..%2Fetc/passwd'))).rejects.toMatchObject({ statusCode: 400 });
    await expect(handler(eventFor(`/downloads/My%20Chan/${folder}/..`))).rejects.toMatchObject({ statusCode: 400 });
    await expect(handler(eventFor('/downloads/My%20Chan/No%20id%20here/x.mp4'))).rejects.toMatchObject({ statusCode: 400 });
    // Same video folder name copied under another channel folder: not the stored folder.
    fs.mkdirSync(path.join(dir, 'Other', p.baseName), { recursive: true });
    fs.writeFileSync(path.join(dir, 'Other', p.baseName, `${p.baseName}.mp4`), 'x');
    await expect(handler(eventFor(`/downloads/Other/${folder}/${encodeURIComponent(`${p.baseName}.mp4`)}`))).rejects.toMatchObject({ statusCode: 404 });

    // Right id, wrong folder name: not the stored folder either.
    fs.mkdirSync(path.join(dir, 'My Chan', 'Renamed [v1]'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'My Chan', 'Renamed [v1]', 'a.mp4'), 'x');
    await expect(handler(eventFor('/downloads/My%20Chan/Renamed%20%5Bv1%5D/a.mp4'))).rejects.toMatchObject({ statusCode: 404 });

    const secret = seed({ id: 'v2', channelId: 'c3', channelTitle: 'Secret', title: 'Hidden', baseDir: dir, visibility: 'private' });
    await expect(handler(eventFor(secret.videoUrlFor('mp4')))).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe('traversal and legacy paths', () => {
  it('rejects encoded, backslash, absolute and double-encoded escapes', async () => {
    const p = seed({ id: 'v1', channelId: 'c1', channelTitle: 'My Chan', title: 'Clip', baseDir: dir });
    const folder = encodeURIComponent(p.baseName);
    fs.writeFileSync(path.join(dir, 'secret.txt'), 'top secret');
    const bad = [
      `/downloads/My%20Chan/${folder}/%2e%2e`,
      `/downloads/%2e%2e/${folder}/x.mp4`,
      `/downloads/My%20Chan/${folder}/..%5Csecret.txt`,
      `/downloads/My%20Chan/${folder}/%2Fetc%2Fpasswd`,
      `/downloads/My%20Chan/${folder}/%00.mp4`,
      `/downloads/My%20Chan/${folder}/%E0%A4%A`,
    ];
    for (const url of bad) {
      await expect(handler(eventFor(url))).rejects.toMatchObject({ statusCode: 400 });
    }
    // Double encoding is decoded once only: "%252e%252e" is the literal name "%2e%2e", not "..".
    await expect(handler(eventFor(`/downloads/My%20Chan/${folder}/%252e%252e`))).rejects.toMatchObject({ statusCode: 404 });
    // A stored-folder match with a file name that climbs out is refused before any read.
    await expect(handler(eventFor(`/downloads/My%20Chan/${folder}/..%2Fsecret.txt`))).rejects.toMatchObject({ statusCode: 400 });
  });

  it('still serves legacy flat paths and rejects deeper legacy traversal', async () => {
    insertChannel(db, { id: 'c9', title: 'Old Chan' });
    insertVideo(db, { id: 'old1', channelId: 'c9', localVideoPath: '/downloads/Old%20Chan/old1.mp4' });
    fs.mkdirSync(path.join(dir, 'Old Chan'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'Old Chan', 'old1.mp4'), '0123456789');
    const event = eventFor('/downloads/Old%20Chan/old1.mp4', { range: 'bytes=2-5' });
    closeIfStream(await handler(event));
    expect(event.node.res.statusCode).toBe(206);
    await expect(handler(eventFor('/downloads/Old%20Chan/..'))).rejects.toMatchObject({ statusCode: 400 });
    await expect(handler(eventFor('/downloads/a/b/c/d.mp4'))).rejects.toMatchObject({ statusCode: 400 });
  });
});
