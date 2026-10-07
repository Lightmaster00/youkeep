import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { runTidy, type RunnerFs } from '../../server/utils/videoTidy';
import { buildVideoPaths, resolveVideoPaths } from '../../server/utils/videoPaths';
import { cleanupPartialFiles, resolveChannelBaseDir } from '../../server/utils/downloader';
import { createTestDb, insertChannel, insertVideo } from '../helpers/testDb';

// A doubled channel folder (<custom>/<Chan>/<Chan>/...) holding the partial
// files of a paused download: repairing the folder must leave them where the
// resumed download (and its cleanup) will look for them.

let db: Database.Database;
let dir: string;
const realFsp: RunnerFs = {
  rename: (a, b) => fs.promises.rename(a, b),
  copyFile: (a, b) => fs.promises.copyFile(a, b),
  unlink: (p) => fs.promises.unlink(p),
  stat: (p) => fs.promises.stat(p),
  mkdir: (p, o) => fs.promises.mkdir(p, o),
  rmdir: (p) => fs.promises.rmdir(p),
};

beforeEach(() => {
  db = createTestDb();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yk-doubled-'));
  (globalThis as any).getDb = () => db;
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function seed() {
  const custom = path.join(dir, 'Dup');
  insertChannel(db, { id: 'c2', title: 'Dup', customSavePath: custom });
  // Completed, still in the nested folder.
  const done = buildVideoPaths({ baseDir: custom, channelFolder: 'Dup', title: 'Done', id: 'a1' });
  insertVideo(db, { id: 'a1', channelId: 'c2', title: 'Done', localVideoPath: done.videoUrlFor('mp4'), localThumbnailPath: null });
  fs.mkdirSync(done.dir, { recursive: true });
  fs.writeFileSync(path.join(done.dir, `${done.baseName}.mp4`), 'done');
  // Paused (back to pending, progress kept): only partial files, in the nested folder.
  insertVideo(db, { id: 'p1', channelId: 'c2', title: 'Paused', downloadStatus: 'pending', localVideoPath: null, localThumbnailPath: null });
  const paused = resolveVideoPaths({ baseDir: resolveChannelBaseDir(custom), channelFolder: 'Dup', title: 'Paused', id: 'p1' });
  fs.mkdirSync(paused.dir, { recursive: true });
  fs.writeFileSync(path.join(paused.dir, `${paused.baseName}.f137.mp4.part`), 'partial');
  expect(paused.dir).toBe(path.join(custom, 'Dup', 'Paused [p1]'));
  return { custom, partial: path.join(paused.baseName, `${paused.baseName}.f137.mp4.part`) };
}

const savePath = () => (db.prepare('SELECT custom_save_path AS p FROM channels WHERE id = ?').get('c2') as { p: string }).p;

describe('paused partial files in a doubled channel folder', () => {
  it('after the folder is repaired, the resumed download finds and reuses them', async () => {
    const { custom, partial } = seed();

    const status = await runTidy({ db, downloadsDir: path.join(dir, 'downloads'), fsp: realFsp });

    expect(status).toMatchObject({ state: 'done', channelsFixed: 1 });
    expect(savePath()).toBe(dir);
    const resumed = resolveVideoPaths({ baseDir: resolveChannelBaseDir(savePath()), channelFolder: 'Dup', title: 'Paused', id: 'p1' });
    expect(resumed.dir).toBe(path.join(custom, 'Paused [p1]'));
    expect(fs.readFileSync(path.join(custom, partial), 'utf8')).toBe('partial');
    // Nothing orphaned in the old nested folder.
    expect(fs.existsSync(path.join(custom, 'Dup'))).toBe(false);
  });

  it('after the folder is repaired, cancelling the paused download removes them', async () => {
    const { custom } = seed();
    await runTidy({ db, downloadsDir: path.join(dir, 'downloads'), fsp: realFsp });

    cleanupPartialFiles('p1', 'c2');

    expect(fs.readdirSync(custom).sort()).toEqual(['Done [a1]']);
  });

  it('never moves the folder of a video being downloaded', async () => {
    const { custom, partial } = seed();
    await runTidy({ db, downloadsDir: path.join(dir, 'downloads'), fsp: realFsp, isVideoBusy: (id) => id === 'p1' });
    expect(fs.existsSync(path.join(custom, 'Dup', partial))).toBe(true);
  });

  it('before any repair, resume and cleanup use the nested folder the download started in', () => {
    const { custom, partial } = seed();
    const resumed = resolveVideoPaths({ baseDir: resolveChannelBaseDir(savePath()), channelFolder: 'Dup', title: 'Renamed', id: 'p1' });
    expect(path.join(resumed.dir, path.basename(partial))).toBe(path.join(custom, 'Dup', partial));

    cleanupPartialFiles('p1', 'c2');
    expect(fs.existsSync(path.join(custom, 'Dup', 'Paused [p1]'))).toBe(false);
  });
});
