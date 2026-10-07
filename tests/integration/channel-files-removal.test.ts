import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import deleteChannel from '../../server/api/admin/channels/[id].delete';
import deleteVideo from '../../server/api/admin/videos/[id].delete';
import { getDownloadsDir as realGetDownloadsDir, resolveChannelBaseDir, sanitizeFolderName } from '../../server/utils/downloader';
import { getWipeReport, isWipeInProgress, startLibraryWipe } from '../../server/utils/libraryWipe';
import { prepareChannelFilesRemoval } from '../../server/utils/videoPaths';
import { assertInTmp, createTestDb, insertChannel, insertVideo, mockEvent } from '../helpers/testDb';

let db: Database.Database;
let dir: string;

beforeEach(() => {
  db = createTestDb();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yk-chdel-'));
  Object.assign(globalThis as any, {
    getDb: () => db, requireAdmin: async () => ({}), cancelDownload: () => {}, getDownloadsDir: () => dir,
    resolveChannelBaseDir, sanitizeFolderName,
  });
  // A channel without a save folder must resolve to a temp folder, never to real media.
  assertInTmp(realGetDownloadsDir());
  assertInTmp(resolveChannelBaseDir(null));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const tree = (root: string): string[] => fs.readdirSync(root, { recursive: true }).map(String).sort();

/** A doubled channel (`<custom>/Dup/...`) whose first video the tidy already moved up, the second still nested. */
function partlyRepaired() {
  const custom = path.join(dir, 'Dup');
  insertChannel(db, { id: 'c2', title: 'Dup', customSavePath: custom });
  const base = 'Moved [d1]';
  insertVideo(db, { id: 'd1', channelId: 'c2', title: 'Moved', localVideoPath: `/downloads/Dup/${encodeURIComponent(base)}/${encodeURIComponent(`${base}.mp4`)}`, localThumbnailPath: null });
  insertVideo(db, { id: 'd2', channelId: 'c2', title: 'Nested', localVideoPath: '/downloads/Dup/d2.mp4', localThumbnailPath: null });
  fs.mkdirSync(path.join(custom, base), { recursive: true });
  fs.writeFileSync(path.join(custom, base, `${base}.mp4`), 'd1');
  fs.mkdirSync(path.join(custom, 'Dup'), { recursive: true });
  fs.writeFileSync(path.join(custom, 'Dup', 'd2.mp4'), 'd2');
  fs.writeFileSync(path.join(dir, 'keep.txt'), 'keep');
  return custom;
}

describe('removing a channel\'s files', () => {
  it('channel delete removes the videos a partly repaired doubled folder moved up, and its channel folder, nothing else', async () => {
    const custom = partlyRepaired();

    await deleteChannel(mockEvent('', { method: 'DELETE', params: { id: 'c2' } }));

    expect(fs.readdirSync(custom)).toEqual([]);
    expect(fs.readFileSync(path.join(dir, 'keep.txt'), 'utf8')).toBe('keep');
  });

  it('library wipe does the same', async () => {
    const custom = partlyRepaired();

    expect(startLibraryWipe()).toEqual({ started: true });
    await vi.waitFor(() => expect(isWipeInProgress()).toBe(false));

    expect(getWipeReport()?.failed).toEqual([]);
    expect(fs.readdirSync(custom)).toEqual([]);
    expect(fs.readFileSync(path.join(dir, 'keep.txt'), 'utf8')).toBe('keep');
  });

  it('never removes the base folder or anything above it for a title like "..", "." or blank', async () => {
    const base = path.join(dir, 'base');
    fs.mkdirSync(path.join(base, 'Real'), { recursive: true });
    fs.writeFileSync(path.join(base, 'Real', 'r.mp4'), 'r');
    const before = tree(dir);
    ['..', '.', ' '].forEach((title, i) => insertChannel(db, { id: `t${i}`, title, customSavePath: base }));

    for (const id of ['t0', 't1', 't2']) {
      // Their folder is the downloader's <base>/_ (not there: nothing to remove), never the base or above.
      const removal = prepareChannelFilesRemoval(db, id, { baseDir: base, downloadsDir: dir });
      expect(removal.channelDir).toBe(path.join(base, '_'));
      expect(removal.remove()).toEqual({ removedChannelDir: false, skippedReason: null });
    }
    await deleteChannel(mockEvent('', { method: 'DELETE', params: { id: 't0' } }));
    expect(startLibraryWipe()).toEqual({ started: true });
    await vi.waitFor(() => expect(isWipeInProgress()).toBe(false));

    expect(tree(dir)).toEqual(before);
    expect(db.prepare('SELECT COUNT(*) AS n FROM channels').get()).toEqual({ n: 0 });
  });

  it('refuses channel and video deletes while library files are being tidied', async () => {
    insertChannel(db, { id: 'c1', title: 'Chan' });
    insertVideo(db, { id: 'v1', channelId: 'c1', title: 'V', localVideoPath: '/downloads/Chan/v1.mp4', localThumbnailPath: null });
    const status = Symbol.for('YouKeep.videoTidyStatus');
    const saved = (globalThis as any)[status];
    (globalThis as any)[status] = { ...saved, state: 'running' };
    try {
      await expect(deleteChannel(mockEvent('', { method: 'DELETE', params: { id: 'c1' } }))).rejects.toMatchObject({ statusCode: 409 });
      await expect(deleteVideo(mockEvent('', { method: 'DELETE', params: { id: 'v1' } }))).rejects.toMatchObject({ statusCode: 409 });
    } finally {
      (globalThis as any)[status] = saved;
    }
    expect(db.prepare('SELECT COUNT(*) AS n FROM videos').get()).toEqual({ n: 1 });
  });
});

describe('a channel folder that holds another channel\'s files', () => {
  const deleteById = (id: string) => deleteChannel(mockEvent('', { method: 'DELETE', params: { id } }));

  /** "YouTube" repaired to custom=<dir>/X (its folder is <dir>/X/YouTube); "Other" then followed with the folder <otherBase>. */
  function repairedThenShared(otherBase: string) {
    const x = path.join(dir, 'X');
    insertChannel(db, { id: 'yt', title: 'YouTube', customSavePath: x });
    const yf = 'Mine [y1]';
    insertVideo(db, { id: 'y1', channelId: 'yt', title: 'Mine', localVideoPath: `/downloads/YouTube/${encodeURIComponent(yf)}/${encodeURIComponent(`${yf}.mp4`)}`, localThumbnailPath: null });
    insertVideo(db, { id: 'y2', channelId: 'yt', title: 'Old', localVideoPath: '/downloads/YouTube/y2.mp4', localThumbnailPath: '/downloads/YouTube/y2.jpg' });
    fs.mkdirSync(path.join(x, 'YouTube', yf), { recursive: true });
    fs.writeFileSync(path.join(x, 'YouTube', yf, `${yf}.mp4`), 'y1');
    fs.writeFileSync(path.join(x, 'YouTube', 'y2.mp4'), 'y2');
    fs.writeFileSync(path.join(x, 'YouTube', 'y2.jpg'), 'y2j');
    insertChannel(db, { id: 'ot', title: 'Other', customSavePath: otherBase });
    const of = 'Theirs [o1]';
    insertVideo(db, { id: 'o1', channelId: 'ot', title: 'Theirs', localVideoPath: `/downloads/Other/${encodeURIComponent(of)}/${encodeURIComponent(`${of}.mp4`)}`, localThumbnailPath: null });
    // Physically always <dir>/X/YouTube/Other, whatever spelling Other's save folder uses.
    fs.mkdirSync(path.join(x, 'YouTube', 'Other', of), { recursive: true });
    fs.writeFileSync(path.join(x, 'YouTube', 'Other', of, `${of}.mp4`), 'o1');
    return path.join(x, 'YouTube');
  }
  const expectOnlyOtherLeft = (youtubeDir: string) => {
    expect(tree(youtubeDir)).toEqual(['Other', path.join('Other', 'Theirs [o1]'), path.join('Other', 'Theirs [o1]', 'Theirs [o1].mp4')]);
  };

  it('deletes only the channel\'s own files when another channel saves inside its folder', async () => {
    const youtubeDir = repairedThenShared(path.join(dir, 'X', 'YouTube'));
    await deleteById('yt');
    expectOnlyOtherLeft(youtubeDir);
  });

  it('removes the folder too once only the channel\'s own files were in it', async () => {
    const youtubeDir = repairedThenShared(path.join(dir, 'X', 'YouTube'));
    fs.rmSync(path.join(youtubeDir, 'Other'), { recursive: true }); // Other followed, nothing downloaded yet
    await deleteById('yt');
    expect(fs.existsSync(youtubeDir)).toBe(false);
  });

  it('recognises the shared folder spelled with another letter case', async () => {
    const youtubeDir = repairedThenShared(path.join(dir, 'x', 'youtube'));
    await deleteById('yt');
    expectOnlyOtherLeft(youtubeDir);
  });

  it('recognises the shared folder reached through a symlink', async () => {
    fs.mkdirSync(path.join(dir, 'X'), { recursive: true });
    fs.symlinkSync(path.join(dir, 'X'), path.join(dir, 'alias'));
    const youtubeDir = repairedThenShared(path.join(dir, 'alias', 'YouTube'));
    await deleteById('yt');
    expectOnlyOtherLeft(youtubeDir);
  });

  it('never removes a music or podcast download root recursively', () => {
    const base = path.join(dir, 'dl');
    insertChannel(db, { id: 'cm', title: 'music', customSavePath: base });
    insertVideo(db, { id: 'm1', channelId: 'cm', title: 'M', localVideoPath: '/downloads/music/m1.mp4', localThumbnailPath: null });
    fs.mkdirSync(path.join(base, 'music', 'Artist'), { recursive: true });
    fs.writeFileSync(path.join(base, 'music', 'm1.mp4'), 'm1');
    fs.writeFileSync(path.join(base, 'music', 'Artist', 'track.mp3'), 'song');

    const removal = prepareChannelFilesRemoval(db, 'cm', { baseDir: base, downloadsDir: dir, protectedRoots: [path.join(base, 'music')] });
    db.prepare("DELETE FROM channels WHERE id = 'cm'").run();
    removal.remove();

    expect(tree(path.join(base, 'music'))).toEqual(['Artist', path.join('Artist', 'track.mp3')]);
  });

  it('still removes an unshared channel folder entirely, and a wipe of every channel removes the shared folder too', async () => {
    insertChannel(db, { id: 'c1', title: 'Chan', customSavePath: path.join(dir, 'solo') });
    fs.mkdirSync(path.join(dir, 'solo', 'Chan', 'unknown-subfolder'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'solo', 'Chan', 'notes.txt'), 'n');
    await deleteById('c1');
    expect(fs.readdirSync(path.join(dir, 'solo'))).toEqual([]);

    const youtubeDir = repairedThenShared(path.join(dir, 'X', 'YouTube'));
    fs.writeFileSync(path.join(youtubeDir, 'notes.txt'), 'n'); // only a recursive removal takes this
    expect(startLibraryWipe()).toEqual({ started: true });
    await vi.waitFor(() => expect(isWipeInProgress()).toBe(false));
    // Nothing is left; the empty folder is Other's save folder, re-created as it always
    // was by resolveChannelBaseDir when Other is deleted.
    expect(tree(path.join(dir, 'X'))).toEqual(['YouTube']);
  });
});

