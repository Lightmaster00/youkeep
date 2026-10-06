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

// Production shape (verified against h3 1.15.11): h3 percent-decodes the path
// before routing EXCEPT %25 and %2F, which stay encoded. So params.path holds
// spaces/brackets/accents decoded, and a literal "%" or "/" still as %25 / %2F.
function productionParam(url: string): string {
  const rest = url.slice('/downloads/'.length);
  const keep = rest.replace(/%25/gi, '\u0001').replace(/%2f/gi, '\u0002');
  let decoded = keep;
  try { decoded = decodeURIComponent(keep); } catch { /* malformed: h3 leaves it as is */ }
  return decoded.replace(/\u0001/g, '%25').replace(/\u0002/g, '%2F');
}
const eventFor = (url: string, headers?: Record<string, string>) =>
  mockEvent(undefined, { path: url, params: { path: productionParam(url) }, headers });
const eventRaw = (param: string) => mockEvent(undefined, { params: { path: param } });

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
    await expect(handler(eventFor(secret.videoUrlFor('mp4')))).rejects.toMatchObject({ statusCode: 404 });
  });

  it('serves a title containing %, # and spaces; a literal %2F stays rejected', async () => {
    const p = seed({ id: 'v1', channelId: 'c1', channelTitle: 'My Chan', title: 'Episode #3: 100% done? ', baseDir: dir });
    const event = eventRaw('My Chan/Episode #3_ 100%25 done_ [v1]/Episode #3_ 100%25 done_ [v1].mp4');
    closeIfStream(await handler(event));
    expect(event.node.res.statusCode).toBe(200);
    expect(p.baseName).toBe('Episode #3_ 100% done_ [v1]');
    await expect(handler(eventRaw(`My Chan/${p.baseName.replace(/%/g, '%25')}/..%2Fsecret.txt`))).rejects.toMatchObject({ statusCode: 400 });

    // ' ( ) ! * are percent-encoded (unquoted CSS url() needs it) and still served.
    const q = seed({ id: 'v2', channelId: 'c2', channelTitle: 'My Chan', title: "Don't Stop (Official Video)!*", baseDir: dir });
    expect(q.videoUrlFor('mp4')).not.toMatch(/[!'()*]/);
    const served = eventFor(q.videoUrlFor('mp4'));
    closeIfStream(await handler(served));
    expect(served.node.res.statusCode).toBe(200);
  });

  it('honours share tokens and does not reveal what exists to guests', async () => {
    const p = seed({ id: 'v2', channelId: 'c3', channelTitle: 'Secret', title: 'Hidden', baseDir: dir, visibility: 'private' });
    db.prepare("UPDATE videos SET share_token = 'tok' WHERE id = 'v2'").run();
    fs.writeFileSync(path.join(p.dir, `${p.baseName}.fr.vtt`), 'WEBVTT');
    const fileUrl = (name: string) => `/downloads/Secret/${encodeURIComponent(p.baseName)}/${encodeURIComponent(name)}`;
    const status = async (url: string) => {
      try { closeIfStream(await handler(eventFor(url))); return 200; } catch (e: any) { return e.statusCode; }
    };
    // Guest: right file, existing sidecar, missing sidecar, wrong folder, unknown id: all the same 404.
    expect(await status(p.videoUrlFor('mp4'))).toBe(404);
    expect(await status(fileUrl(`${p.baseName}.fr.vtt`))).toBe(404);
    expect(await status(fileUrl(`${p.baseName}.de.vtt`))).toBe(404);
    expect(await status(`/downloads/Secret/${encodeURIComponent('Guess [v2]')}/x.mp4`)).toBe(404);
    expect(await status(`/downloads/Secret/${encodeURIComponent('Guess [nope]')}/x.mp4`)).toBe(404);
    // A valid share token opens the video and its sidecars.
    (globalThis as any).getQuery = () => ({ token: 'tok' });
    expect(await status(p.videoUrlFor('mp4'))).toBe(200);
    expect(await status(fileUrl(`${p.baseName}.fr.vtt`))).toBe(200);
    expect(await status(fileUrl(`${p.baseName}.de.vtt`))).toBe(404);
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
