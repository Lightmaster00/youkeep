import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { planTidy, runTidy, type RunnerFs } from '../../server/utils/videoTidy';
import { resolveVideoPaths } from '../../server/utils/videoPaths';
import { createTestDb, insertChannel, insertVideo } from '../helpers/testDb';

// Flat partial files left by a legacy (one folder per channel) download that
// never finished: tidying moves them into the video's own folder under its new
// base name, so the resumed download (which looks there) picks them up.

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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yk-tidy-partials-'));
  insertChannel(db, { id: 'c1', title: 'Chan' });
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const write = (file: string, body = 'x') => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
};
const PARTIALS = ['.f137.mp4.part', '.f137.mp4.ytdl', '.f140.m4a', '.mp4.part', '.f137.mp4.part-Frag3.part'];

/** A paused legacy download: flat partial files in the channel folder, plus things that are not its partials. */
function pausedLegacy(chanDir = path.join(dir, 'Chan')) {
  insertVideo(db, { id: 'p1', channelId: 'c1', title: 'Paused: Clip', downloadStatus: 'pending', localVideoPath: null, localThumbnailPath: null });
  for (const s of PARTIALS) write(path.join(chanDir, `p1${s}`), `p1${s}`);
  write(path.join(chanDir, 'p1.jpg'), 'thumb'); // not a partial: left alone
  write(path.join(chanDir, 'p10.f137.mp4.part'), 'look-alike'); // another id
  write(path.join(chanDir, 'notes.txt'), 'keep');
}
const NEW_BASE = 'Paused_ Clip [p1]';

describe('tidy: partial files of unfinished legacy downloads', () => {
  it('plans to move only the unfinished video\'s own partial files, under the new base name', () => {
    pausedLegacy();

    const plan = planTidy(db, { downloadsDir: dir });

    expect(plan.preview).toMatchObject({ total: 0, toMove: 0, unfinishedToMove: 1, unfinishedFiles: PARTIALS.length });
    expect(plan.items).toHaveLength(1);
    const item = plan.items[0]!;
    expect(item.kind).toBe('partial');
    expect(item.toDir).toBe(path.join(dir, 'Chan', NEW_BASE));
    expect(item.moves.map((m) => path.basename(m.to)).sort()).toEqual(PARTIALS.map((s) => `${NEW_BASE}${s}`).sort());
    expect(item.moves.every((m) => path.dirname(m.from) === path.join(dir, 'Chan'))).toBe(true);
  });

  it('moves them so the resumed download finds them, leaving everything else and the database as is', async () => {
    pausedLegacy();

    const status = await runTidy({ db, downloadsDir: dir, fsp: realFsp });

    expect(status).toMatchObject({ state: 'done', moved: 1, errors: 0 });
    const resumed = resolveVideoPaths({ baseDir: dir, channelFolder: 'Chan', title: 'Paused: Clip', id: 'p1' });
    expect(resumed.dir).toBe(path.join(dir, 'Chan', NEW_BASE));
    expect(fs.readdirSync(resumed.dir).sort()).toEqual(PARTIALS.map((s) => `${NEW_BASE}${s}`).sort());
    expect(fs.readFileSync(path.join(resumed.dir, `${NEW_BASE}.f137.mp4.part`), 'utf8')).toBe('p1.f137.mp4.part');
    expect(fs.readdirSync(path.join(dir, 'Chan')).sort()).toEqual([NEW_BASE, 'notes.txt', 'p1.jpg', 'p10.f137.mp4.part']);
    const row = db.prepare('SELECT download_status, local_video_path FROM videos WHERE id = ?').get('p1');
    expect(row).toEqual({ download_status: 'pending', local_video_path: null });
  });

  it('ignores completed videos (and their stray partials), downloading and busy ones', async () => {
    insertVideo(db, { id: 'v1', channelId: 'c1', title: 'Done', localVideoPath: '/downloads/Chan/v1.mp4', localThumbnailPath: null });
    write(path.join(dir, 'Chan', 'v1.mp4'), 'v1');
    write(path.join(dir, 'Chan', 'v1.f137.mp4.part'), 'stray');
    insertVideo(db, { id: 'd1', channelId: 'c1', title: 'Now', downloadStatus: 'downloading', localVideoPath: null, localThumbnailPath: null });
    write(path.join(dir, 'Chan', 'd1.mp4.part'), 'd1');
    insertVideo(db, { id: 'b1', channelId: 'c1', title: 'Busy', downloadStatus: 'pending', localVideoPath: null, localThumbnailPath: null });
    write(path.join(dir, 'Chan', 'b1.mp4.part'), 'b1');
    // Completed without a stored file (e.g. a cleared path): never treated as unfinished.
    insertVideo(db, { id: 'c9', channelId: 'c1', title: 'Odd', localVideoPath: null, localThumbnailPath: null });
    write(path.join(dir, 'Chan', 'c9.mp4.part'), 'c9');

    const plan = planTidy(db, { downloadsDir: dir });
    expect(plan.items.filter((i) => i.kind === 'partial').map((i) => i.id)).toEqual(['b1']);
    expect(plan.items.find((i) => i.id === 'v1')!.moves.map((m) => path.basename(m.from))).toEqual(['v1.mp4']);

    const status = await runTidy({ db, downloadsDir: dir, fsp: realFsp, isVideoBusy: (id) => id === 'b1' });

    expect(status).toMatchObject({ moved: 1, skipped: 1, errors: 0 });
    for (const f of ['v1.f137.mp4.part', 'd1.mp4.part', 'b1.mp4.part', 'c9.mp4.part']) expect(fs.existsSync(path.join(dir, 'Chan', f))).toBe(true);
  });

  it('never overwrites: a different file already at the destination leaves everything in place', async () => {
    pausedLegacy();
    write(path.join(dir, 'Chan', NEW_BASE, `${NEW_BASE}.f137.mp4.part`), 'a newer attempt');

    const plan = planTidy(db, { downloadsDir: dir });
    expect(plan.items).toHaveLength(0);
    expect(plan.preview.unfinishedToMove).toBe(0);
    expect(plan.preview.problems).toEqual([{ id: 'p1', title: 'Paused: Clip', reason: expect.stringContaining('already') }]);

    await runTidy({ db, downloadsDir: dir, fsp: realFsp });
    for (const s of PARTIALS) expect(fs.existsSync(path.join(dir, 'Chan', `p1${s}`))).toBe(true);
    expect(fs.readFileSync(path.join(dir, 'Chan', NEW_BASE, `${NEW_BASE}.f137.mp4.part`), 'utf8')).toBe('a newer attempt');
  });

  it('refuses a symlinked partial and puts back the files already moved', async () => {
    pausedLegacy();
    write(path.join(dir, 'outside.bin'), 'precious');
    fs.rmSync(path.join(dir, 'Chan', 'p1.mp4.part'));
    fs.symlinkSync(path.join(dir, 'outside.bin'), path.join(dir, 'Chan', 'p1.mp4.part'));

    const status = await runTidy({ db, downloadsDir: dir, fsp: realFsp });

    expect(status).toMatchObject({ moved: 0, errors: 1 });
    expect(status.errorDetails[0]!.message).toContain('symlink');
    for (const s of PARTIALS) expect(fs.lstatSync(path.join(dir, 'Chan', `p1${s}`))).toBeTruthy();
    expect(fs.lstatSync(path.join(dir, 'Chan', 'p1.mp4.part')).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(path.join(dir, 'outside.bin'), 'utf8')).toBe('precious');
    expect(fs.existsSync(path.join(dir, 'Chan', NEW_BASE))).toBe(false);
  });

  it('puts every moved file back when a move fails midway', async () => {
    pausedLegacy();
    let renames = 0;
    const fsp: RunnerFs = {
      ...realFsp,
      rename: async (a, b) => {
        if (++renames === 3) throw Object.assign(new Error('disk on fire'), { code: 'EIO' });
        await fs.promises.rename(a, b);
      },
    };

    const status = await runTidy({ db, downloadsDir: dir, fsp });

    expect(status).toMatchObject({ moved: 0, errors: 1 });
    for (const s of PARTIALS) expect(fs.readFileSync(path.join(dir, 'Chan', `p1${s}`), 'utf8')).toBe(`p1${s}`);
    expect(fs.existsSync(path.join(dir, 'Chan', NEW_BASE))).toBe(false);
  });

  it('skips the video when its download started after the plan', async () => {
    insertVideo(db, { id: 'v1', channelId: 'c1', title: 'Done', localVideoPath: '/downloads/Chan/v1.mp4', localThumbnailPath: null });
    write(path.join(dir, 'Chan', 'v1.mp4'), 'v1');
    pausedLegacy();
    const fsp: RunnerFs = {
      ...realFsp,
      // Moving v1 (planned first) is when p1's download starts.
      rename: async (a, b) => {
        db.prepare("UPDATE videos SET download_status = 'downloading' WHERE id = 'p1'").run();
        await fs.promises.rename(a, b);
      },
    };

    const status = await runTidy({ db, downloadsDir: dir, fsp });

    expect(status).toMatchObject({ moved: 1, skipped: 1, errors: 0 });
    for (const s of PARTIALS) expect(fs.existsSync(path.join(dir, 'Chan', `p1${s}`))).toBe(true);
  });

  it('stops (without moving files back) when the download starts midway', async () => {
    pausedLegacy();
    let renames = 0;
    const fsp: RunnerFs = {
      ...realFsp,
      rename: async (a, b) => {
        await fs.promises.rename(a, b);
        if (++renames === 1) db.prepare("UPDATE videos SET download_status = 'downloading' WHERE id = 'p1'").run();
      },
    };

    const status = await runTidy({ db, downloadsDir: dir, fsp });

    expect(status).toMatchObject({ moved: 0, skipped: 1, errors: 0 });
    expect(fs.readdirSync(path.join(dir, 'Chan', NEW_BASE))).toHaveLength(1);
    expect(PARTIALS.filter((s) => fs.existsSync(path.join(dir, 'Chan', `p1${s}`)))).toHaveLength(PARTIALS.length - 1);
  });

  it('moves partials left in a doubled channel folder; after the repair the download resumes from them', async () => {
    const custom = path.join(dir, 'Chan');
    db.prepare('UPDATE channels SET custom_save_path = ? WHERE id = ?').run(custom, 'c1');
    // A finished legacy video makes the doubled folder repairable.
    insertVideo(db, { id: 'v1', channelId: 'c1', title: 'Done', localVideoPath: '/downloads/Chan/v1.mp4', localThumbnailPath: null });
    write(path.join(custom, 'Chan', 'v1.mp4'), 'v1');
    insertVideo(db, { id: 'p1', channelId: 'c1', title: 'Paused: Clip', downloadStatus: 'pending', localVideoPath: null, localThumbnailPath: null });
    write(path.join(custom, 'Chan', 'p1.f137.mp4.part'), 'partial');

    const status = await runTidy({ db, downloadsDir: path.join(dir, 'downloads'), fsp: realFsp });

    expect(status).toMatchObject({ state: 'done', moved: 2, errors: 0, channelsFixed: 1 });
    const savePath = (db.prepare('SELECT custom_save_path AS p FROM channels WHERE id = ?').get('c1') as { p: string }).p;
    expect(savePath).toBe(dir);
    const resumed = resolveVideoPaths({ baseDir: savePath, channelFolder: 'Chan', title: 'Paused: Clip', id: 'p1' });
    expect(fs.readFileSync(path.join(resumed.dir, `${NEW_BASE}.f137.mp4.part`), 'utf8')).toBe('partial');
    expect(fs.existsSync(path.join(custom, 'Chan'))).toBe(false);
  });

  it('moves partials still in the nested folder of an already repaired doubled channel', async () => {
    insertVideo(db, { id: 'p1', channelId: 'c1', title: 'Paused: Clip', downloadStatus: 'pending', localVideoPath: null, localThumbnailPath: null });
    write(path.join(dir, 'Chan', 'Chan', 'p1.f137.mp4.part'), 'partial');

    const status = await runTidy({ db, downloadsDir: dir, fsp: realFsp });

    expect(status).toMatchObject({ moved: 1, errors: 0 });
    const resumed = resolveVideoPaths({ baseDir: dir, channelFolder: 'Chan', title: 'Paused: Clip', id: 'p1' });
    expect(fs.readFileSync(path.join(resumed.dir, `${NEW_BASE}.f137.mp4.part`), 'utf8')).toBe('partial');
    expect(fs.existsSync(path.join(dir, 'Chan', 'Chan'))).toBe(false);
  });
});
