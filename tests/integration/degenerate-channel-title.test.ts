import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import deleteChannel from '../../server/api/admin/channels/[id].delete';
import deleteVideo from '../../server/api/admin/videos/[id].delete';
import { cleanupPartialFiles, resolveChannelBaseDir, sanitizeFolderName } from '../../server/utils/downloader';
import { isWipeInProgress, getWipeReport, startLibraryWipe } from '../../server/utils/libraryWipe';
import { buildVideoPaths, videoChannelFolder } from '../../server/utils/videoPaths';
import { createTestDb, insertChannel, insertVideo, mockEvent } from '../helpers/testDb';

// A video channel titled "..", "." or blank downloads into <base>/_ (the
// downloader's channel segment). Delete, wipe and partial cleanup must use
// that same folder, removing exactly the channel's own files there.

let db: Database.Database;
let dir: string;
let base: string;

beforeEach(() => {
  db = createTestDb();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yk-degenerate-'));
  base = path.join(dir, 'base');
  fs.mkdirSync(base);
  Object.assign(globalThis as any, {
    getDb: () => db, requireAdmin: async () => ({}), cancelDownload: () => {}, getDownloadsDir: () => path.join(dir, 'downloads'),
    resolveChannelBaseDir, sanitizeFolderName,
  });
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const tree = (root: string): string[] => fs.readdirSync(root, { recursive: true }).map(String).sort();

function seedVideo(channelId: string, title: string, id: string) {
  const p = buildVideoPaths({ baseDir: base, channelFolder: sanitizeFolderName(title), title: 'Clip', id });
  insertVideo(db, { id, channelId, title: 'Clip', localVideoPath: p.videoUrlFor('mp4'), localThumbnailPath: null });
  fs.mkdirSync(p.dir, { recursive: true });
  fs.writeFileSync(path.join(p.dir, `${p.baseName}.mp4`), id);
  return p;
}

describe('a video channel titled "..", "." or blank', () => {
  it('uses the downloader\'s folder: <base>/_', () => {
    for (const title of ['..', '.', '   ']) {
      expect(videoChannelFolder(title, 'UCx')).toBe('_');
      expect(path.dirname(buildVideoPaths({ baseDir: base, channelFolder: sanitizeFolderName(title), title: 'T', id: 'x' }).dir)).toBe(path.join(base, '_'));
    }
    expect(videoChannelFolder('My Chan', 'UCx')).toBe('My Chan');
    expect(videoChannelFolder('', 'UCx')).toBe('UCx');
  });

  it('channel delete removes its own video folders in <base>/_, never another channel\'s, then the folder once empty', async () => {
    insertChannel(db, { id: 'd', title: '..', customSavePath: base });
    insertChannel(db, { id: 'e', title: '.', customSavePath: base });
    const mine = seedVideo('d', '..', 'v1');
    const theirs = seedVideo('e', '.', 'e1');
    fs.writeFileSync(path.join(dir, 'outside.txt'), 'keep');

    await deleteChannel(mockEvent('', { method: 'DELETE', params: { id: 'd' } }));
    expect(fs.existsSync(mine.dir)).toBe(false);
    expect(fs.existsSync(theirs.dir)).toBe(true);

    await deleteChannel(mockEvent('', { method: 'DELETE', params: { id: 'e' } }));
    expect(fs.existsSync(path.join(base, '_'))).toBe(false);
    expect(tree(dir)).toEqual(['base', 'outside.txt']);
  });

  it('library wipe removes <base>/_ and nothing above it', async () => {
    insertChannel(db, { id: 'd', title: '..', customSavePath: base });
    insertChannel(db, { id: 'e', title: '   ', customSavePath: base });
    seedVideo('d', '..', 'v1');
    seedVideo('e', '   ', 'e1');
    fs.writeFileSync(path.join(dir, 'outside.txt'), 'keep');

    expect(startLibraryWipe()).toEqual({ started: true });
    await vi.waitFor(() => expect(isWipeInProgress()).toBe(false));

    expect(getWipeReport()?.failed).toEqual([]);
    expect(tree(dir)).toEqual(['base', 'outside.txt']);
  });

  it('video delete removes the video\'s folder', async () => {
    insertChannel(db, { id: 'd', title: '..', customSavePath: base });
    const mine = seedVideo('d', '..', 'v1');
    fs.writeFileSync(path.join(dir, 'v1.mp4'), 'keep'); // above the base: not this channel's

    expect(await deleteVideo(mockEvent('', { method: 'DELETE', params: { id: 'v1' } }))).toEqual({ success: true });
    expect(fs.existsSync(mine.dir)).toBe(false);
    expect(fs.readFileSync(path.join(dir, 'v1.mp4'), 'utf8')).toBe('keep');
  });

  it('video delete of a never-finished video never touches legacy names above the base folder', async () => {
    insertChannel(db, { id: 'd', title: '..', customSavePath: base });
    insertVideo(db, { id: 'v1', channelId: 'd', title: 'Clip', downloadStatus: 'pending', localVideoPath: null, localThumbnailPath: null });
    const p = buildVideoPaths({ baseDir: base, channelFolder: '..', title: 'Clip', id: 'v1' });
    fs.mkdirSync(p.dir, { recursive: true });
    fs.writeFileSync(path.join(p.dir, `${p.baseName}.mp4.part`), 'part');
    fs.writeFileSync(path.join(dir, 'v1.mp4'), 'keep');

    expect(await deleteVideo(mockEvent('', { method: 'DELETE', params: { id: 'v1' } }))).toEqual({ success: true });
    expect(fs.existsSync(p.dir)).toBe(false);
    expect(fs.readFileSync(path.join(dir, 'v1.mp4'), 'utf8')).toBe('keep');
  });

  it('partial cleanup removes its video folder and never touches files above the base folder', () => {
    insertChannel(db, { id: 'd', title: '..', customSavePath: base });
    insertVideo(db, { id: 'v1', channelId: 'd', title: 'Clip', downloadStatus: 'pending', localVideoPath: null, localThumbnailPath: null });
    const p = buildVideoPaths({ baseDir: base, channelFolder: '..', title: 'Clip', id: 'v1' });
    fs.mkdirSync(p.dir, { recursive: true });
    fs.writeFileSync(path.join(p.dir, `${p.baseName}.mp4.part`), 'part');
    // Legacy flat names in the folder above the base: not this channel's.
    fs.writeFileSync(path.join(dir, 'v1.mp4'), 'keep');
    fs.writeFileSync(path.join(dir, 'v1.mp4.part'), 'keep');

    cleanupPartialFiles('v1', 'd');

    expect(fs.existsSync(p.dir)).toBe(false);
    expect(fs.readdirSync(dir).sort()).toEqual(['base', 'v1.mp4', 'v1.mp4.part']);
  });
});

describe('a video channel title with a control character', () => {
  it('channel delete removes its video folders (<base>/A_B) and its own legacy files (<base>/A\u0001B)', async () => {
    const title = 'A\u0001B';
    insertChannel(db, { id: 'c', title, customSavePath: base });
    const mine = seedVideo('c', title, 'v1');
    expect(path.basename(path.dirname(mine.dir))).toBe('A_B');
    insertVideo(db, { id: 'v2', channelId: 'c', title: 'Old', localVideoPath: `/downloads/${title}/v2.mp4`, localThumbnailPath: null });
    fs.mkdirSync(path.join(base, title));
    fs.writeFileSync(path.join(base, title, 'v2.mp4'), 'old');

    await deleteChannel(mockEvent('', { method: 'DELETE', params: { id: 'c' } }));

    expect(fs.readdirSync(base)).toEqual([]);
  });
});
