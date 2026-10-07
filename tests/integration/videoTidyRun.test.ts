import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { cancelTidyRun, getTidyStatus, isTidyRunning, moveFileVerified, planTidy, planTidyAsync, runTidy, startTidyRun, type RunnerFs } from '../../server/utils/videoTidy';
import { resolveStoredPath } from '../../server/utils/videoPaths';
import { createTestDb, insertChannel, insertVideo, mockEvent } from '../helpers/testDb';

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
    const placedNames: string[] = [];
    const crossDevice: RunnerFs = {
      ...realFsp,
      // Only renames across devices fail: the final rename inside the target folder is local.
      rename: async (a, b) => {
        if (path.dirname(a) !== path.dirname(b)) throw Object.assign(new Error('cross-device link not permitted'), { code: 'EXDEV' });
        placedNames.push(path.basename(b));
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
    expect(placedNames).toEqual(['Good [v1].mp4']); // the bad copy never reached its final name
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

/** A filesystem where renames across folders fail like a move to another device. */
function crossDeviceFs(over: Partial<RunnerFs> = {}): RunnerFs {
  return {
    ...realFsp,
    rename: async (a, b) => {
      if (path.dirname(a) !== path.dirname(b)) throw Object.assign(new Error('cross-device link not permitted'), { code: 'EXDEV' });
      await fs.promises.rename(a, b);
    },
    ...over,
  };
}
const chan = (...p: string[]) => path.join(dir, 'Chan', ...p);

describe('runTidy safety guards', () => {
  it('never follows symlinks: a symlinked destination or source is refused and nothing is deleted', async () => {
    legacy('v1', 'Link', ['.mp4']);
    fs.mkdirSync(chan('Link [v1]'));
    fs.symlinkSync(chan('v1.mp4'), chan('Link [v1]', 'Link [v1].mp4'));
    fs.mkdirSync(path.join(dir, 'media'));
    fs.writeFileSync(path.join(dir, 'media', 'x.mp4'), 'real');
    insertVideo(db, { id: 'v2', channelId: 'c1', title: 'Out', localVideoPath: '/downloads/Chan/v2.mp4', localThumbnailPath: null });
    fs.symlinkSync('../media/x.mp4', chan('v2.mp4'));

    const status = await runTidy({ db, downloadsDir: dir, fsp: realFsp });

    expect(status).toMatchObject({ moved: 0, errors: 2 });
    expect(status.errorDetails.map((e) => e.message).join(' ')).toMatch(/Destination is a symlink[\s\S]*Source is a symlink/);
    expect(fs.readFileSync(chan('v1.mp4'), 'utf8')).toBe('v1.mp4');
    expect(fs.lstatSync(chan('Link [v1]', 'Link [v1].mp4')).isSymbolicLink()).toBe(true);
    expect(fs.readlinkSync(chan('v2.mp4'))).toBe('../media/x.mp4');
    expect(fs.readFileSync(path.join(dir, 'media', 'x.mp4'), 'utf8')).toBe('real');
    expect(fs.existsSync(chan('Out [v2]'))).toBe(false);
    expect(paths('v1').local_video_path).toBe('/downloads/Chan/v1.mp4');
  });

  it('refuses a destination that is a link to another identical file or a hard link to the source', async () => {
    const src = path.join(dir, 'a.src');
    fs.writeFileSync(src, 'same');
    fs.writeFileSync(path.join(dir, 'elsewhere'), 'same');
    fs.symlinkSync(path.join(dir, 'elsewhere'), path.join(dir, 'sym.dst'));
    fs.linkSync(src, path.join(dir, 'hard.dst'));

    await expect(moveFileVerified(realFsp, src, path.join(dir, 'sym.dst'))).rejects.toThrow(/symlink/);
    await expect(moveFileVerified(realFsp, src, path.join(dir, 'hard.dst'))).rejects.toThrow(/same file/);
    expect(fs.readFileSync(src, 'utf8')).toBe('same');
    expect(fs.readFileSync(path.join(dir, 'hard.dst'), 'utf8')).toBe('same');
  });

  it('across devices: flushes the new folder entry and the copy, renames it into place, flushes the folder, verifies, and only then removes the source', async () => {
    legacy('v1', 'Order', ['.mp4']);
    const calls: string[] = [];
    const rel = (p: string) => path.relative(dir, p);
    const base = crossDeviceFs();
    const recording = crossDeviceFs({
      mkdir: async (p, o) => { calls.push(`mkdir ${rel(p)}`); return fs.promises.mkdir(p, o); },
      copyFile: async (a, b) => { calls.push(`copy ${rel(b)}`); await base.copyFile(a, b); },
      fsyncFile: async (p) => { calls.push(`fsync ${rel(p)}`); },
      rename: async (a, b) => { calls.push(`rename ${rel(a)} -> ${rel(b)}`); await base.rename(a, b); },
      fsyncDir: async (p) => { calls.push(`fsyncDir ${rel(p)}`); },
      lstat: async (p) => { calls.push(`lstat ${rel(p)}`); return fs.promises.lstat(p); },
      unlink: async (p) => { calls.push(`unlink ${rel(p)}`); await base.unlink(p); },
    });

    const status = await runTidy({ db, downloadsDir: dir, fsp: recording });

    expect(status).toMatchObject({ moved: 1, errors: 0 });
    const to = path.join('Chan', 'Order [v1]', 'Order [v1].mp4');
    const tail = calls.slice(calls.indexOf(`mkdir ${path.dirname(to)}`));
    expect(tail.slice(0, tail.indexOf(`unlink ${path.join('Chan', 'v1.mp4')}`) + 1).filter((c) => !c.startsWith('lstat') || c === `lstat ${to}`)).toEqual([
      `mkdir ${path.dirname(to)}`,
      `fsyncDir Chan`,
      `lstat ${to}`,
      `rename ${path.join('Chan', 'v1.mp4')} -> ${to}`, // fails with EXDEV
      `copy ${to}.tidy-part`,
      `fsync ${to}.tidy-part`,
      `lstat ${to}`,
      `rename ${to}.tidy-part -> ${to}`,
      `fsyncDir ${path.dirname(to)}`,
      `lstat ${to}`,
      `unlink ${path.join('Chan', 'v1.mp4')}`,
    ]);
  });

  it('across devices: a file appearing at the destination is never overwritten, and a bad placed copy never costs the source', async () => {
    legacy('v1', 'Race', ['.mp4']);
    legacy('v2', 'Shrunk', ['.mp4']);
    const exdev = crossDeviceFs();
    const fsp = crossDeviceFs({
      copyFile: async (a, b) => {
        await fs.promises.copyFile(a, b);
        if (a.endsWith('v1.mp4')) fs.writeFileSync(b.slice(0, -'.tidy-part'.length), 'foreign');
      },
      rename: async (a, b) => {
        await exdev.rename(a, b);
        if (b.endsWith('Shrunk [v2].mp4')) fs.writeFileSync(b, 'x');
      },
    });

    const status = await runTidy({ db, downloadsDir: dir, fsp });

    expect(status).toMatchObject({ moved: 0, errors: 2 });
    expect(fs.readFileSync(chan('Race [v1]', 'Race [v1].mp4'), 'utf8')).toBe('foreign');
    expect(fs.readdirSync(chan('Race [v1]'))).toEqual(['Race [v1].mp4']);
    expect(fs.readFileSync(chan('v1.mp4'), 'utf8')).toBe('v1.mp4');
    expect(fs.readFileSync(chan('v2.mp4'), 'utf8')).toBe('v2.mp4');
    expect(fs.existsSync(chan('Shrunk [v2]'))).toBe(false);
  });

  it('treats a filesystem that cannot fsync folders (ENOSYS) as unsupported, not as a failure', async () => {
    legacy('v1', 'Nosys', ['.mp4']);
    const fsp = crossDeviceFs({ fsyncDir: async () => { throw Object.assign(new Error('function not implemented'), { code: 'ENOSYS' }); } });

    const status = await runTidy({ db, downloadsDir: dir, fsp });

    expect(status).toMatchObject({ moved: 1, errors: 0 });
    expect(fs.existsSync(chan('v1.mp4'))).toBe(false);
  });

  it('across devices: a placed destination that is not a regular file is refused and the source kept', async () => {
    legacy('v1', 'Swap', ['.mp4']); // 'v1.mp4' is 6 bytes, like the link target 'x.real'
    const exdev = crossDeviceFs();
    const fsp = crossDeviceFs({
      rename: async (a, b) => {
        await exdev.rename(a, b);
        if (a.endsWith('.tidy-part')) {
          fs.renameSync(b, path.join(path.dirname(b), 'x.real'));
          fs.symlinkSync('x.real', b);
        }
      },
    });

    const status = await runTidy({ db, downloadsDir: dir, fsp });

    expect(status).toMatchObject({ moved: 0, errors: 1 });
    expect(fs.readFileSync(chan('v1.mp4'), 'utf8')).toBe('v1.mp4');
    expect(fs.existsSync(chan('Swap [v1]', 'Swap [v1].mp4'))).toBe(false);
  });

  it('never removes a stale partial copy that is a folder or a symlink', async () => {
    legacy('v1', 'Odd', ['.mp4', '.jpg']);
    // The symlink sits on the first planned move so a missing check is not hidden by the folder failing first.
    fs.mkdirSync(chan('Odd [v1]', 'Odd [v1].jpg.tidy-part'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'target'), 'precious');
    fs.symlinkSync(path.join(dir, 'target'), chan('Odd [v1]', 'Odd [v1].mp4.tidy-part'));

    const status = await runTidy({ db, downloadsDir: dir, fsp: crossDeviceFs() });

    expect(status).toMatchObject({ moved: 0, errors: 1 });
    expect(fs.statSync(chan('Odd [v1]', 'Odd [v1].jpg.tidy-part')).isDirectory()).toBe(true);
    expect(fs.lstatSync(chan('Odd [v1]', 'Odd [v1].mp4.tidy-part')).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(path.join(dir, 'target'), 'utf8')).toBe('precious');
    expect(fs.readdirSync(chan()).sort()).toEqual(['Odd [v1]', 'v1.jpg', 'v1.mp4']);
  });

  it('clears a stale partial copy only in the folder being written and only while its source exists', async () => {
    legacy('v1', 'Part', ['.mp4']);
    fs.mkdirSync(chan('Part [v1]'));
    fs.writeFileSync(chan('Part [v1]', 'Part [v1].mp4.tidy-part'), 'half');
    fs.writeFileSync(chan('Part [v1]', 'Part [v1].jpg.tidy-part'), 'keep');
    // Interrupted after the move: the source is gone, so its partial copy is left alone.
    legacy('v2', 'Done', ['.mp4']);
    fs.mkdirSync(chan('Done [v2]'));
    fs.renameSync(chan('v2.mp4'), chan('Done [v2]', 'Done [v2].mp4'));
    fs.writeFileSync(chan('Done [v2]', 'Done [v2].mp4.tidy-part'), 'keep');

    const status = await runTidy({ db, downloadsDir: dir, fsp: crossDeviceFs() });

    expect(status).toMatchObject({ moved: 2, errors: 0 });
    expect(fs.readdirSync(chan('Part [v1]')).sort()).toEqual(['Part [v1].jpg.tidy-part', 'Part [v1].mp4']);
    expect(fs.readdirSync(chan('Done [v2]')).sort()).toEqual(['Done [v2].mp4', 'Done [v2].mp4.tidy-part']);
    expect(fs.readFileSync(chan('Part [v1]', 'Part [v1].mp4'), 'utf8')).toBe('v1.mp4');
  });

  it('reports both paths when a file cannot be moved back, keeps it, and continues with the next video', async () => {
    legacy('v1', 'Stuck', ['.mp4']);
    legacy('v2', 'Fine', ['.mp4']);
    db.exec(`CREATE TRIGGER no_v1 BEFORE UPDATE OF local_video_path ON videos WHEN NEW.id = 'v1' BEGIN SELECT RAISE(ABORT, 'database is locked'); END;`);
    const fsp: RunnerFs = {
      ...realFsp,
      rename: async (a, b) => {
        if (a.includes('Stuck [v1]')) throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
        await fs.promises.rename(a, b);
      },
    };

    const status = await runTidy({ db, downloadsDir: dir, fsp });

    expect(status).toMatchObject({ state: 'done', moved: 1, errors: 1 });
    expect(status.lastError).toContain(`${chan('Stuck [v1]', 'Stuck [v1].mp4')} -> ${chan('v1.mp4')}`);
    expect(fs.readFileSync(chan('Stuck [v1]', 'Stuck [v1].mp4'), 'utf8')).toBe('v1.mp4');
    expect(fs.existsSync(chan('Fine [v2]', 'Fine [v2].mp4'))).toBe(true);
  });

  it('skips a video that started downloading after the plan, leaving it untouched', async () => {
    legacy('v1', 'First', ['.mp4']);
    legacy('v2', 'Second', ['.mp4']);
    const fsp: RunnerFs = {
      ...realFsp,
      rename: async (a, b) => {
        db.prepare("UPDATE videos SET download_status = 'downloading' WHERE id = 'v2'").run();
        await fs.promises.rename(a, b);
      },
    };

    const status = await runTidy({ db, downloadsDir: dir, fsp });

    expect(status).toMatchObject({ moved: 1, skipped: 1 });
    expect(fs.readdirSync(chan()).sort()).toEqual(['First [v1]', 'v2.mp4']);
  });

  it('resumes an interrupted video: source already gone and destination present -> database updated, nothing deleted', async () => {
    legacy('v1', 'Half', ['.mp4', '.jpg']);
    fs.mkdirSync(chan('Half [v1]'));
    fs.renameSync(chan('v1.mp4'), chan('Half [v1]', 'Half [v1].mp4'));

    const status = await runTidy({ db, downloadsDir: dir, fsp: realFsp });

    expect(status).toMatchObject({ moved: 1, errors: 0 });
    expect(fs.readdirSync(chan('Half [v1]')).sort()).toEqual(['Half [v1].jpg', 'Half [v1].mp4']);
    expect(fs.readFileSync(chan('Half [v1]', 'Half [v1].mp4'), 'utf8')).toBe('v1.mp4');
    expect(paths('v1').local_video_path).toBe('/downloads/Chan/Half%20%5Bv1%5D/Half%20%5Bv1%5D.mp4');
  });

  it('caps errorDetails at 50 while counting every error', async () => {
    for (let i = 0; i < 51; i++) legacy(`e${i}`, `E${i}`, ['.mp4']);
    db.exec(`CREATE TRIGGER no_update BEFORE UPDATE OF local_video_path ON videos BEGIN SELECT RAISE(ABORT, 'database is locked'); END;`);

    const status = await runTidy({ db, downloadsDir: dir, fsp: realFsp, batchPauseMs: 0 });

    expect(status.errors).toBe(51);
    expect(status.errorDetails).toHaveLength(50);
  });

  it('startTidyRun runs one at a time and refuses during a library wipe', async () => {
    legacy('v1', 'Slow', ['.mp4']);
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const slow: RunnerFs = { ...realFsp, rename: async (a, b) => { await gate; await fs.promises.rename(a, b); } };

    expect(startTidyRun({ db, downloadsDir: dir, fsp: slow })).toEqual({ started: true });
    expect(isTidyRunning()).toBe(true);
    expect(startTidyRun({ db, downloadsDir: dir, fsp: realFsp })).toMatchObject({ started: false });
    release();
    await vi.waitFor(() => expect(getTidyStatus().state).toBe('done'));
    expect(getTidyStatus().moved).toBe(1);

    const wipeFlag = Symbol.for('YouKeep.libraryWipeInProgress');
    (globalThis as any)[wipeFlag] = true;
    try {
      expect(startTidyRun({ db, downloadsDir: dir, fsp: realFsp })).toMatchObject({ started: false, error: expect.stringContaining('wipe') });
    } finally {
      (globalThis as any)[wipeFlag] = false;
    }
  });
});

describe('doubled channel folder repair guards', () => {
  const custom = () => path.join(dir, 'Dup');
  function doubled() {
    insertChannel(db, { id: 'c2', title: 'Dup', customSavePath: custom() });
    insertVideo(db, { id: 'd1', channelId: 'c2', title: 'Dup Clip', localVideoPath: '/downloads/Dup/d1.mp4', localThumbnailPath: null });
    fs.mkdirSync(path.join(custom(), 'Dup'), { recursive: true });
    fs.writeFileSync(path.join(custom(), 'Dup', 'd1.mp4'), 'd1');
  }
  const savePath = () => (db.prepare('SELECT custom_save_path FROM channels WHERE id = ?').get('c2') as any).custom_save_path;

  it('keeps the save path while another video of the channel is still in the old layout', async () => {
    doubled();
    insertVideo(db, { id: 'd2', channelId: 'c2', title: 'Gone', localVideoPath: '/downloads/Dup/d2.mp4', localThumbnailPath: null });

    const status = await runTidy({ db, downloadsDir: dir, fsp: realFsp });

    expect(status).toMatchObject({ moved: 1, channelsFixed: 0 });
    expect(savePath()).toBe(custom());
  });

  it('keeps the save path while a video of the channel is downloading', async () => {
    doubled();
    insertVideo(db, { id: 'd3', channelId: 'c2', title: 'Now', downloadStatus: 'downloading', localVideoPath: null, localThumbnailPath: null });

    const status = await runTidy({ db, downloadsDir: dir, fsp: realFsp });

    expect(status).toMatchObject({ moved: 1, channelsFixed: 0 });
    expect(savePath()).toBe(custom());
  });

  it('never overwrites a save path changed while the run was moving files', async () => {
    doubled();
    const fsp: RunnerFs = {
      ...realFsp,
      rename: async (a, b) => {
        db.prepare("UPDATE channels SET custom_save_path = '/elsewhere' WHERE id = 'c2'").run();
        await fs.promises.rename(a, b);
      },
    };

    const status = await runTidy({ db, downloadsDir: dir, fsp });

    expect(status).toMatchObject({ moved: 1, channelsFixed: 0 });
    expect(savePath()).toBe('/elsewhere');
  });
});

describe('planTidyAsync', () => {
  it('lets other work run while it plans', async () => {
    for (let i = 0; i < 100; i++) insertVideo(db, { id: `m${i}`, channelId: 'c1', title: `M${i}`, localVideoPath: `/downloads/Chan/m${i}.mp4`, localThumbnailPath: null });
    let ticks = 0;
    let running = true;
    const tick = () => { if (running) { ticks++; setImmediate(tick); } };
    setImmediate(tick);

    const plan = await planTidyAsync(db, { downloadsDir: dir });
    running = false;

    expect(plan.preview.missingFiles).toBe(100);
    expect(ticks).toBeGreaterThan(5);
  });

  it('gives the same plan as planTidy and never plans a temporary partial copy', async () => {
    legacy('v1', 'Alpha');
    legacy('v2', 'Beta', ['.mp4']);
    const custom = path.join(dir, 'Dup');
    insertChannel(db, { id: 'c2', title: 'Dup', customSavePath: custom });
    const base = 'Clip [d1]';
    insertVideo(db, { id: 'd1', channelId: 'c2', title: 'Clip', localVideoPath: `/downloads/Dup/${encodeURIComponent(base)}/${encodeURIComponent(`${base}.mp4`)}`, localThumbnailPath: null });
    fs.mkdirSync(path.join(custom, 'Dup', base), { recursive: true });
    fs.writeFileSync(path.join(custom, 'Dup', base, `${base}.mp4`), 'd1');
    fs.writeFileSync(path.join(custom, 'Dup', base, `${base}.mp4.tidy-part`), 'd');

    const sync = planTidy(db, { downloadsDir: dir });
    const async = await planTidyAsync(db, { downloadsDir: dir, everyRows: 1 });

    expect(async).toEqual(sync);
    expect(sync.items).toHaveLength(3);
    const dup = sync.items.find((i) => i.id === 'd1')!;
    expect(dup.moves.map((m) => path.basename(m.from))).toEqual([`${base}.mp4`]);
  });
});

describe('doubled-looking folders that must not be repaired', () => {
  const savePathOf = (id: string) => (db.prepare('SELECT custom_save_path FROM channels WHERE id = ?').get(id) as any).custom_save_path;

  it('leaves a base folder shared with other channels as is, and a later channel delete removes only that channel', async () => {
    const shared = path.join(dir, 'X', 'YouTube');
    insertChannel(db, { id: 'yt', title: 'YouTube', customSavePath: shared });
    insertChannel(db, { id: 'ot', title: 'Other', customSavePath: shared });
    insertVideo(db, { id: 'y1', channelId: 'yt', title: 'Yclip', localVideoPath: '/downloads/YouTube/y1.mp4', localThumbnailPath: null });
    insertVideo(db, { id: 'o1', channelId: 'ot', title: 'Oclip', localVideoPath: '/downloads/Other/o1.mp4', localThumbnailPath: null });
    fs.mkdirSync(path.join(shared, 'YouTube'), { recursive: true });
    fs.mkdirSync(path.join(shared, 'Other'), { recursive: true });
    fs.writeFileSync(path.join(shared, 'YouTube', 'y1.mp4'), 'y1');
    fs.writeFileSync(path.join(shared, 'Other', 'o1.mp4'), 'o1');

    const preview = planTidy(db, { downloadsDir: dir }).preview;
    expect(preview.duplicateFolders).toBe(0);
    expect(preview.channelNotes).toEqual([expect.objectContaining({ channelId: 'yt', note: expect.stringContaining('shared with other channels') })]);

    const status = await runTidy({ db, downloadsDir: dir, fsp: realFsp });

    expect(status).toMatchObject({ moved: 2, channelsFixed: 0, errors: 0 });
    expect(savePathOf('yt')).toBe(shared);
    expect(fs.readdirSync(shared).sort()).toEqual(['Other', 'YouTube']);
    expect(fs.readdirSync(path.join(shared, 'YouTube'))).toEqual(['Yclip [y1]']);
    expect(fs.readFileSync(path.join(shared, 'Other', 'Oclip [o1]', 'Oclip [o1].mp4'), 'utf8')).toBe('o1');

    const { default: deleteChannel } = await import('../../server/api/admin/channels/[id].delete');
    const downloader = await import('../../server/utils/downloader');
    Object.assign(globalThis as any, {
      getDb: () => db, requireAdmin: async () => ({}), cancelDownload: () => {},
      resolveChannelBaseDir: downloader.resolveChannelBaseDir, sanitizeFolderName: downloader.sanitizeFolderName,
    });
    await deleteChannel(mockEvent('', { method: 'DELETE', params: { id: 'yt' } }));
    expect(fs.readdirSync(shared)).toEqual(['Other']);
    expect(fs.readFileSync(path.join(shared, 'Other', 'Oclip [o1]', 'Oclip [o1].mp4'), 'utf8')).toBe('o1');
  });

  it('does not repair a folder named like the channel that holds other files', async () => {
    const custom = path.join(dir, 'Lib', 'Vid');
    insertChannel(db, { id: 'cv', title: 'Vid', customSavePath: custom });
    insertVideo(db, { id: 'w1', channelId: 'cv', title: 'Wclip', localVideoPath: '/downloads/Vid/w1.mp4', localThumbnailPath: null });
    fs.mkdirSync(path.join(custom, 'Vid'), { recursive: true });
    fs.writeFileSync(path.join(custom, 'Vid', 'w1.mp4'), 'w1');
    fs.writeFileSync(path.join(custom, 'notes.txt'), 'mine');

    const status = await runTidy({ db, downloadsDir: dir, fsp: realFsp });

    expect(status).toMatchObject({ moved: 1, channelsFixed: 0 });
    expect(savePathOf('cv')).toBe(custom);
    expect(fs.readdirSync(custom).sort()).toEqual(['Vid', 'notes.txt']);
    expect(fs.existsSync(path.join(custom, 'Vid', 'Wclip [w1]', 'Wclip [w1].mp4'))).toBe(true);
  });

  it('does not repair the default downloads folder itself, nor a folder without any of the channel\'s files', () => {
    const downloads = path.join(dir, 'videos');
    db.prepare("DELETE FROM channels WHERE id = 'c1'").run();
    insertChannel(db, { id: 'cd', title: 'videos', customSavePath: downloads });
    insertVideo(db, { id: 'z1', channelId: 'cd', title: 'Z', localVideoPath: '/downloads/videos/z1.mp4', localThumbnailPath: null });
    fs.mkdirSync(path.join(downloads, 'videos'), { recursive: true });
    fs.writeFileSync(path.join(downloads, 'videos', 'z1.mp4'), 'z1');
    const custom = path.join(dir, 'Empty');
    insertChannel(db, { id: 'ce', title: 'Empty', customSavePath: custom });
    insertVideo(db, { id: 'e1', channelId: 'ce', title: 'E', localVideoPath: '/downloads/Empty/e1.mp4', localThumbnailPath: null });
    fs.mkdirSync(path.join(custom, 'Empty'), { recursive: true });
    fs.writeFileSync(path.join(custom, 'Empty', 'x.txt'), 'x');

    const preview = planTidy(db, { downloadsDir: downloads }).preview;

    expect(preview.duplicateFolders).toBe(0);
    const notes = Object.fromEntries(preview.channelNotes.map((n) => [n.channelId, n.note]));
    expect(notes.cd).toContain('default downloads folder');
    expect(notes.ce).toContain('none of its files');
  });

  it('re-checks the folder right before correcting the save path', async () => {
    const custom = path.join(dir, 'Dup');
    insertChannel(db, { id: 'c2', title: 'Dup', customSavePath: custom });
    insertVideo(db, { id: 'd1', channelId: 'c2', title: 'Dup Clip', localVideoPath: '/downloads/Dup/d1.mp4', localThumbnailPath: null });
    fs.mkdirSync(path.join(custom, 'Dup'), { recursive: true });
    fs.writeFileSync(path.join(custom, 'Dup', 'd1.mp4'), 'd1');
    const fsp: RunnerFs = { ...realFsp, rename: async (a, b) => { await fs.promises.rename(a, b); fs.writeFileSync(path.join(custom, 'arrived.txt'), 'new'); } };

    const status = await runTidy({ db, downloadsDir: dir, fsp });

    expect(status).toMatchObject({ moved: 1, channelsFixed: 0 });
    expect(savePathOf('c2')).toBe(custom);
  });
});
