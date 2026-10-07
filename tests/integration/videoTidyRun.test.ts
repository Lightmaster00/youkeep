import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { cancelTidyRun, moveFileVerified, planTidy, runTidy, type RunnerFs } from '../../server/utils/videoTidy';
import { resolveStoredPath } from '../../server/utils/videoPaths';
import { createTestDb, insertChannel, insertVideo } from '../helpers/testDb';

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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yk-tidy-'));
  insertChannel(db, { id: 'c1', title: 'Chan' });
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function legacy(id: string, title: string, suffixes = ['.mp4', '.jpg', '.fr.vtt', '.en.vtt']) {
  insertVideo(db, { id, channelId: 'c1', title, localVideoPath: `/downloads/Chan/${id}.mp4`, localThumbnailPath: `/downloads/Chan/${id}.jpg` });
  fs.mkdirSync(path.join(dir, 'Chan'), { recursive: true });
  for (const s of suffixes) fs.writeFileSync(path.join(dir, 'Chan', `${id}${s}`), `${id}${s}`);
}
const paths = (id: string) => db.prepare('SELECT id, channel_id, title, local_video_path, local_thumbnail_path FROM videos WHERE id = ?').get(id) as any;

describe('runTidy', () => {
  it('moves and renames a legacy video, its thumbnail and subtitles, then updates the database', async () => {
    legacy('v1', 'Hello: World?');
    fs.writeFileSync(path.join(dir, 'Chan', 'other.txt'), 'keep');

    const status = await runTidy({ db, downloadsDir: dir, fsp: realFsp });

    expect(status).toMatchObject({ state: 'done', total: 1, processed: 1, moved: 1, errors: 0 });
    const base = 'Hello_ World_ [v1]';
    const folder = path.join(dir, 'Chan', base);
    expect(fs.readdirSync(folder).sort()).toEqual([`${base}.en.vtt`, `${base}.fr.vtt`, `${base}.jpg`, `${base}.mp4`]);
    expect(fs.readFileSync(path.join(folder, `${base}.mp4`), 'utf8')).toBe('v1.mp4');
    expect(fs.readdirSync(path.join(dir, 'Chan')).sort()).toEqual([base, 'other.txt']);
    const row = paths('v1');
    expect(row.local_video_path).toBe(`/downloads/Chan/${encodeURIComponent(base)}/${encodeURIComponent(`${base}.mp4`)}`);
    expect(row.local_thumbnail_path).toBe(`/downloads/Chan/${encodeURIComponent(base)}/${encodeURIComponent(`${base}.jpg`)}`);
    expect(fs.existsSync(resolveStoredPath(db, row, { downloadsDir: dir }).videoFile!)).toBe(true);
    expect(planTidy(db, { downloadsDir: dir }).preview).toMatchObject({ toMove: 0, alreadyTidy: 1 });
  });

  it('puts every file back when the database update fails', async () => {
    legacy('v1', 'Clip', ['.mp4', '.jpg', '.fr.vtt']);
    db.exec(`CREATE TRIGGER no_update BEFORE UPDATE OF local_video_path ON videos BEGIN SELECT RAISE(ABORT, 'database is locked'); END;`);

    const status = await runTidy({ db, downloadsDir: dir, fsp: realFsp });

    expect(status).toMatchObject({ state: 'done', moved: 0, errors: 1 });
    expect(status.lastError).toContain('database is locked');
    expect(fs.readdirSync(path.join(dir, 'Chan')).sort()).toEqual(['v1.fr.vtt', 'v1.jpg', 'v1.mp4']);
    expect(paths('v1').local_video_path).toBe('/downloads/Chan/v1.mp4');
  });

  it('falls back to copy + verify across devices and never deletes an unverified source', async () => {
    legacy('v1', 'Good', ['.mp4']);
    legacy('v2', 'Bad', ['.mp4']);
    let removedBeforeInPlace = false;
    const crossDevice: RunnerFs = {
      ...realFsp,
      // Only renames across devices fail: the final rename inside the target folder is local.
      rename: async (a, b) => {
        if (path.dirname(a) !== path.dirname(b)) throw Object.assign(new Error('cross-device link not permitted'), { code: 'EXDEV' });
        await fs.promises.rename(a, b);
      },
      copyFile: async (a, b) => {
        if (a.endsWith('v2.mp4')) { await fs.promises.writeFile(b, 'trunc'); return; }
        await fs.promises.copyFile(a, b);
      },
      unlink: async (p) => {
        if (p.endsWith('v1.mp4') && !fs.existsSync(path.join(dir, 'Chan', 'Good [v1]', 'Good [v1].mp4'))) removedBeforeInPlace = true;
        await fs.promises.unlink(p);
      },
    };

    const status = await runTidy({ db, downloadsDir: dir, fsp: crossDevice });

    expect(status).toMatchObject({ moved: 1, errors: 1 });
    expect(removedBeforeInPlace).toBe(false);
    expect(fs.readdirSync(path.join(dir, 'Chan', 'Good [v1]'))).toEqual(['Good [v1].mp4']);
    expect(fs.readFileSync(path.join(dir, 'Chan', 'Good [v1]', 'Good [v1].mp4'), 'utf8')).toBe('v1.mp4');
    expect(fs.existsSync(path.join(dir, 'Chan', 'v1.mp4'))).toBe(false);
    expect(fs.readFileSync(path.join(dir, 'Chan', 'v2.mp4'), 'utf8')).toBe('v2.mp4');
    expect(fs.existsSync(path.join(dir, 'Chan', 'Bad [v2]'))).toBe(false);
    expect(paths('v2').local_video_path).toBe('/downloads/Chan/v2.mp4');
  });

  it('restores the files when a move cannot be verified or the video row changed meanwhile', async () => {
    legacy('v1', 'Lost', ['.mp4', '.jpg']);
    legacy('v2', 'Raced', ['.mp4']);
    const tricky: RunnerFs = {
      ...realFsp,
      rename: async (a, b) => {
        if (a.endsWith('v1.jpg')) return; // reports success but moved nothing
        if (a.endsWith('v2.mp4')) db.prepare("UPDATE videos SET local_video_path = '/downloads/Chan/other.mp4' WHERE id = 'v2'").run();
        await fs.promises.rename(a, b);
      },
    };

    const status = await runTidy({ db, downloadsDir: dir, fsp: tricky });

    expect(status).toMatchObject({ moved: 0, errors: 2 });
    expect(fs.readdirSync(path.join(dir, 'Chan')).sort()).toEqual(['v1.jpg', 'v1.mp4', 'v2.mp4']);
    expect(paths('v1').local_video_path).toBe('/downloads/Chan/v1.mp4');
    expect(paths('v2').local_video_path).toBe('/downloads/Chan/other.mp4');
  });

  it('stops after the current video when cancelled, and a new run finishes the rest', async () => {
    legacy('v1', 'One', ['.mp4']);
    legacy('v2', 'Two', ['.mp4']);
    let renames = 0;
    const cancelling: RunnerFs = { ...realFsp, rename: async (a, b) => { if (++renames === 1) cancelTidyRun(); await fs.promises.rename(a, b); } };

    const first = await runTidy({ db, downloadsDir: dir, fsp: cancelling });
    expect(first).toMatchObject({ state: 'cancelled', processed: 1, moved: 1 });
    expect(planTidy(db, { downloadsDir: dir }).preview).toMatchObject({ toMove: 1, alreadyTidy: 1 });

    const second = await runTidy({ db, downloadsDir: dir, fsp: realFsp });
    expect(second).toMatchObject({ state: 'done', moved: 1 });
  });

  it('leaves a video whose download is active untouched', async () => {
    legacy('v1', 'Busy', ['.mp4']);

    const status = await runTidy({ db, downloadsDir: dir, fsp: realFsp, isVideoBusy: (id) => id === 'v1' });

    expect(status).toMatchObject({ state: 'done', skipped: 1, moved: 0 });
    expect(fs.readdirSync(path.join(dir, 'Chan'))).toEqual(['v1.mp4']);
  });

  it('repairs a doubled channel folder and corrects the channel save path', async () => {
    const custom = path.join(dir, 'Dup');
    insertChannel(db, { id: 'c2', title: 'Dup', customSavePath: custom });
    insertVideo(db, { id: 'd1', channelId: 'c2', title: 'Dup Clip', localVideoPath: '/downloads/Dup/d1.mp4', localThumbnailPath: '/downloads/Dup/d1.jpg' });
    fs.mkdirSync(path.join(custom, 'Dup'), { recursive: true });
    fs.writeFileSync(path.join(custom, 'Dup', 'd1.mp4'), 'd1');
    fs.writeFileSync(path.join(custom, 'Dup', 'd1.jpg'), 'd1j');

    const status = await runTidy({ db, downloadsDir: dir, fsp: realFsp });

    expect(status).toMatchObject({ state: 'done', moved: 1, channelsFixed: 1 });
    expect(fs.readdirSync(custom)).toEqual(['Dup Clip [d1]']);
    expect(fs.readdirSync(path.join(custom, 'Dup Clip [d1]')).sort()).toEqual(['Dup Clip [d1].jpg', 'Dup Clip [d1].mp4']);
    expect((db.prepare('SELECT custom_save_path FROM channels WHERE id = ?').get('c2') as any).custom_save_path).toBe(dir);
    expect(fs.existsSync(resolveStoredPath(db, paths('d1'), { downloadsDir: dir }).videoFile!)).toBe(true);
  });
});

describe('moveFileVerified with a destination already there', () => {
  it('removes the source only when the destination has the same content, and never overwrites a different file', async () => {
    const write = (name: string, content: string) => { fs.writeFileSync(path.join(dir, name), content); return path.join(dir, name); };

    // Earlier complete copy (interrupted run): same bytes -> the source is removed.
    const sameFrom = write('same.src', 'abcdef');
    const sameTo = write('same.dst', 'abcdef');
    await moveFileVerified(realFsp, sameFrom, sameTo);
    expect(fs.existsSync(sameFrom)).toBe(false);
    expect(fs.readFileSync(sameTo, 'utf8')).toBe('abcdef');

    // Same size, different bytes -> conflict, both files kept.
    const twinFrom = write('twin.src', 'abcdef');
    const twinTo = write('twin.dst', 'abcxyz');
    await expect(moveFileVerified(realFsp, twinFrom, twinTo)).rejects.toThrow(/different/);
    expect(fs.readFileSync(twinFrom, 'utf8')).toBe('abcdef');
    expect(fs.readFileSync(twinTo, 'utf8')).toBe('abcxyz');

    // Different size -> conflict, both files kept.
    const bigFrom = write('big.src', 'abcdef');
    const bigTo = write('big.dst', 'abc');
    await expect(moveFileVerified(realFsp, bigFrom, bigTo)).rejects.toThrow(/different/);
    expect(fs.readFileSync(bigFrom, 'utf8')).toBe('abcdef');
    expect(fs.readFileSync(bigTo, 'utf8')).toBe('abc');
  });
});
