import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../server/utils/db', () => ({ getDb: () => (globalThis as any).getDb() }));

import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { cleanupPartialFiles, resolveChannelBaseDir, sanitizeFolderName } from '../../server/utils/downloader';
import deleteVideo from '../../server/api/admin/videos/[id].delete';
import { buildVideoPaths } from '../../server/utils/videoPaths';
import { createTestDb, insertChannel, insertVideo, mockEvent } from '../helpers/testDb';

// A channel's save folder that changed writability between download attempts:
// the downloader wrote under the default downloads folder for one attempt and
// under the save folder for another. Cancelling, timing out or deleting must
// remove that video's own leftovers from both places, and nothing else.

let db: Database.Database;
let dir: string;
let downloads: string;
let custom: string;

beforeEach(() => {
  db = createTestDb();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yk-allbases-'));
  downloads = path.join(dir, 'downloads');
  custom = path.join(dir, 'custom');
  fs.mkdirSync(downloads);
  fs.mkdirSync(custom);
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('default_downloads_dir', ?)").run(downloads);
  Object.assign(globalThis as any, {
    getDb: () => db, getDownloadsDir: () => downloads, sanitizeFolderName, getQuery: () => ({}),
    requireAdmin: async () => ({}), cancelDownload: () => {}, resolveChannelBaseDir,
  });
  insertChannel(db, { id: 'c1', title: 'Chan', customSavePath: custom });
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const write = (file: string, body = 'x') => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
};
const tree = (root: string): string[] => {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      out.push(path.relative(root, p) + (e.isDirectory() ? '/' : ''));
      if (e.isDirectory()) walk(p);
    }
  };
  walk(root);
  return out.sort();
};

/** Partials of v1 under both bases, plus things that are not v1's. */
function seedPartials() {
  const now = buildVideoPaths({ baseDir: custom, channelFolder: 'Chan', title: 'Clip', id: 'v1' });
  const before = buildVideoPaths({ baseDir: downloads, channelFolder: 'Chan', title: 'Clip', id: 'v1' });
  write(path.join(now.dir, `${now.baseName}.f137.mp4.part`));
  write(path.join(before.dir, `${before.baseName}.f137.mp4.part`));
  write(path.join(before.dir, `${before.baseName}.f140.m4a.ytdl`));
  write(path.join(before.dir, `${before.baseName}.webp`));
  write(path.join(downloads, 'Chan', 'v1.f137.mp4.part')); // legacy flat leftover
  // Not v1's: another video's folder, a foreign file, another id's flat partial.
  const other = buildVideoPaths({ baseDir: downloads, channelFolder: 'Chan', title: 'Other', id: 'v2' });
  write(path.join(other.dir, `${other.baseName}.mp4.part`));
  write(path.join(downloads, 'Chan', 'notes.txt'));
  write(path.join(downloads, 'Chan', 'v2.f137.mp4.part'));
  return { now, before };
}

describe('partial cleanup across every base the downloader used', () => {
  it('cancel/timeout cleanup removes the video\'s partials from the old base too, and nothing else', () => {
    insertVideo(db, { id: 'v1', channelId: 'c1', title: 'Clip', downloadStatus: 'downloading', localVideoPath: null, localThumbnailPath: null });
    seedPartials();

    cleanupPartialFiles('v1', 'c1');

    expect(tree(custom)).toEqual(['Chan/']);
    expect(tree(downloads)).toEqual(['Chan/', 'Chan/Other [v2]/', 'Chan/Other [v2]/Other [v2].mp4.part', 'Chan/notes.txt', 'Chan/v2.f137.mp4.part']);
  });

  it('keeps a foreign file and a symlink in the old video folder (and so the folder)', () => {
    insertVideo(db, { id: 'v1', channelId: 'c1', title: 'Clip', downloadStatus: 'downloading', localVideoPath: null, localThumbnailPath: null });
    const { before } = seedPartials();
    write(path.join(dir, 'outside.mp4'), 'precious');
    fs.symlinkSync(path.join(dir, 'outside.mp4'), path.join(before.dir, `${before.baseName}.mp4`));
    write(path.join(before.dir, 'mine.txt'));
    fs.symlinkSync(path.join(dir, 'outside.mp4'), path.join(downloads, 'Chan', 'v1.mp4.part'));

    cleanupPartialFiles('v1', 'c1');

    expect(fs.readdirSync(before.dir).sort()).toEqual([`${before.baseName}.mp4`, 'mine.txt']);
    expect(fs.readFileSync(path.join(dir, 'outside.mp4'), 'utf8')).toBe('precious');
    expect(fs.lstatSync(path.join(downloads, 'Chan', 'v1.mp4.part')).isSymbolicLink()).toBe(true);
  });

  it('finds the old folder moved up out of a doubled channel folder (base named like the channel)', () => {
    const chanBase = path.join(dir, 'Chan');
    db.prepare("UPDATE settings SET value = ? WHERE key = 'default_downloads_dir'").run(chanBase);
    insertVideo(db, { id: 'v1', channelId: 'c1', title: 'Clip', downloadStatus: 'downloading', localVideoPath: null, localThumbnailPath: null });
    const up = buildVideoPaths({ baseDir: chanBase, channelFolder: 'Chan', title: 'Clip', id: 'v1' });
    const upDir = path.join(chanBase, up.baseName);
    write(path.join(upDir, `${up.baseName}.f137.mp4.part`));
    write(path.join(chanBase, 'Other [v2]', 'Other [v2].mp4.part'));

    cleanupPartialFiles('v1', 'c1');

    expect(fs.existsSync(upDir)).toBe(false);
    expect(fs.existsSync(path.join(chanBase, 'Other [v2]', 'Other [v2].mp4.part'))).toBe(true);
  });

  it('never looks outside a base for a channel named ".."', () => {
    insertChannel(db, { id: 'c9', title: '..', customSavePath: custom });
    insertVideo(db, { id: 'v9', channelId: 'c9', title: 'Clip', downloadStatus: 'downloading', localVideoPath: null, localThumbnailPath: null });
    write(path.join(dir, 'v9.f137.mp4.part'));
    write(path.join(dir, 'v9.mp4'));

    cleanupPartialFiles('v9', 'c9');

    expect(fs.existsSync(path.join(dir, 'v9.f137.mp4.part'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'v9.mp4'))).toBe(true);
  });

  it('never removes the stored, finished copy under the other base', () => {
    const stored = buildVideoPaths({ baseDir: downloads, channelFolder: 'Chan', title: 'Clip', id: 'v1' });
    insertVideo(db, { id: 'v1', channelId: 'c1', title: 'Clip', downloadStatus: 'downloading', localVideoPath: stored.videoUrlFor('mp4'), localThumbnailPath: null });
    write(path.join(stored.dir, `${stored.baseName}.mp4`), 'done');
    const now = buildVideoPaths({ baseDir: custom, channelFolder: 'Chan', title: 'Clip', id: 'v1' });
    write(path.join(now.dir, `${now.baseName}.f137.mp4.part`));

    cleanupPartialFiles('v1', 'c1');

    expect(fs.existsSync(now.dir)).toBe(false);
    expect(fs.readFileSync(path.join(stored.dir, `${stored.baseName}.mp4`), 'utf8')).toBe('done');
  });

  it('deleting a downloaded video also removes its stale partials under the other base', async () => {
    const p = buildVideoPaths({ baseDir: custom, channelFolder: 'Chan', title: 'Clip', id: 'v1' });
    insertVideo(db, { id: 'v1', channelId: 'c1', title: 'Clip', localVideoPath: p.videoUrlFor('mp4'), localThumbnailPath: null });
    write(path.join(p.dir, `${p.baseName}.mp4`));
    seedPartials();

    await deleteVideo(mockEvent('', { method: 'DELETE', params: { id: 'v1' } }));

    expect(tree(custom)).toEqual(['Chan/']);
    expect(tree(downloads)).toEqual(['Chan/', 'Chan/Other [v2]/', 'Chan/Other [v2]/Other [v2].mp4.part', 'Chan/notes.txt', 'Chan/v2.f137.mp4.part']);
  });

  it('deleting a not-yet-downloaded video removes its partials under both bases', async () => {
    insertVideo(db, { id: 'v1', channelId: 'c1', title: 'Clip', downloadStatus: 'pending', localVideoPath: null, localThumbnailPath: null });
    seedPartials();

    await deleteVideo(mockEvent('', { method: 'DELETE', params: { id: 'v1' } }));

    expect(tree(custom)).toEqual(['Chan/']);
    expect(tree(downloads)).toEqual(['Chan/', 'Chan/Other [v2]/', 'Chan/Other [v2]/Other [v2].mp4.part', 'Chan/notes.txt', 'Chan/v2.f137.mp4.part']);
  });
});
