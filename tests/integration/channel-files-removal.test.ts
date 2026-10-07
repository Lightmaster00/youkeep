import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import deleteChannel from '../../server/api/admin/channels/[id].delete';
import deleteVideo from '../../server/api/admin/videos/[id].delete';
import { resolveChannelBaseDir, sanitizeFolderName } from '../../server/utils/downloader';
import { getWipeReport, isWipeInProgress, startLibraryWipe } from '../../server/utils/libraryWipe';
import { prepareChannelFilesRemoval } from '../../server/utils/videoPaths';
import { createTestDb, insertChannel, insertVideo, mockEvent } from '../helpers/testDb';

let db: Database.Database;
let dir: string;

beforeEach(() => {
  db = createTestDb();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yk-chdel-'));
  Object.assign(globalThis as any, {
    getDb: () => db, requireAdmin: async () => ({}), cancelDownload: () => {}, getDownloadsDir: () => dir,
    resolveChannelBaseDir, sanitizeFolderName,
  });
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
      const removal = prepareChannelFilesRemoval(db, id, { baseDir: base, downloadsDir: dir });
      expect(removal.remove()).toMatchObject({ removedChannelDir: false, skippedReason: expect.stringContaining('not inside') });
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
