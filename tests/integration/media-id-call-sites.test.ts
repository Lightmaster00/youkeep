import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type Database from 'better-sqlite3';

// Every place that turns a media id into a file name re-checks the id
// (isValidMediaId). The hostile id used throughout is `abc.f137`: not a media
// id, and exactly the prefix of the per-format partial files of the real
// video `abc` (`abc.f137.mp4.part`), so a missing check would delete another
// download's files. yt-dlp is never run.
const spawned: { args: string[] }[] = [];
let nextStdout: string[] = [];
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    spawnSync: () => ({ status: 0, stdout: Buffer.from(''), stderr: Buffer.from('') }),
    spawn: (_cmd: string, args: string[]) => {
      const child: any = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = vi.fn();
      spawned.push({ args });
      const out = nextStdout.shift();
      setImmediate(() => {
        if (out !== undefined) child.stdout.emit('data', Buffer.from(out));
        child.emit('close', out === undefined ? 1 : 0);
      });
      return child;
    },
  };
});

import { cleanupPartialFiles, syncChannelPlaylists, resolveChannelBaseDir, sanitizeFolderName } from '../../server/utils/downloader';
import { cleanupPartialMusicFiles, getMusicDownloadsDir } from '../../server/utils/musicDownloader';
import { removeVideoLeftovers } from '../../server/utils/videoPaths';
import { getDataDir } from '../../server/utils/dataDir';
import deleteVideo from '../../server/api/admin/videos/[id].delete';
import testDownload from '../../server/api/admin/downloader/test-download.post';
import { assertInTmp, insertChannel, insertVideo, insertMusicArtist, mockEvent } from '../helpers/testDb';

const { openDatabase } = await vi.importActual<typeof import('../../server/utils/db')>('../../server/utils/db');

const HOSTILE = 'abc.f137';
let db: Database.Database;
let dir: string;

beforeAll(() => {
  const bin = path.join(getDataDir(), 'bin');
  assertInTmp(bin);
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'yt-dlp'), 'fake');
});

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yk-id-sites-'));
  assertInTmp(dir);
  db = openDatabase(path.join(dir, 'youkeep.db'));
  Object.assign(globalThis as any, {
    getDb: () => db, requireAdmin: async () => ({ id: 'admin', role: 'admin' }), cancelDownload: () => {},
    getDownloadsDir: () => path.join(dir, 'downloads'), resolveChannelBaseDir, sanitizeFolderName,
  });
  spawned.length = 0;
  nextStdout = [];
});

afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/** A channel folder holding the in-progress per-format partials of the real video `abc`. */
function seedChannelWithPartials(base: string) {
  insertChannel(db, { id: 'c1', title: 'Chan', customSavePath: base });
  const chanDir = path.join(base, 'Chan');
  fs.mkdirSync(chanDir, { recursive: true });
  const victims = ['abc.f137.mp4', 'abc.f137.jpg', 'abc.f137.mp4.part', 'abc.f137.mp4.ytdl', 'abc.f137.f1.part'].map((f) => path.join(chanDir, f));
  for (const f of victims) fs.writeFileSync(f, 'partial of abc');
  return victims;
}

describe('video ids', () => {
  it('cleanupPartialFiles: a non-media id names no file to remove', () => {
    const victims = seedChannelWithPartials(path.join(dir, 'base'));
    cleanupPartialFiles(HOSTILE, 'c1');
    for (const f of victims) expect(fs.existsSync(f)).toBe(true);
  });

  it('removeVideoLeftovers: a non-media id names no file to remove', () => {
    const base = path.join(dir, 'base');
    const victims = seedChannelWithPartials(base);
    removeVideoLeftovers({ bases: [base], channelFolder: 'Chan', id: HOSTILE });
    for (const f of victims) expect(fs.existsSync(f)).toBe(true);
  });

  it('admin video delete: a legacy row with a non-media id removes its row but no file by pattern', async () => {
    const base = path.join(dir, 'base');
    const victims = seedChannelWithPartials(base);
    // A second base (the default downloads folder) with the same leftovers.
    const otherChan = path.join(dir, 'downloads', 'Chan');
    fs.mkdirSync(otherChan, { recursive: true });
    fs.writeFileSync(path.join(otherChan, 'abc.f137.mp4.part'), 'partial of abc');
    insertVideo(db, { id: HOSTILE, channelId: 'c1', localVideoPath: null, localThumbnailPath: null });

    await expect(deleteVideo(mockEvent('', { method: 'DELETE', params: { id: HOSTILE } }))).resolves.toMatchObject({ success: true });

    expect(db.prepare('SELECT COUNT(*) AS n FROM videos').get()).toEqual({ n: 0 });
    for (const f of victims) expect(fs.existsSync(f)).toBe(true);
    expect(fs.existsSync(path.join(otherChan, 'abc.f137.mp4.part'))).toBe(true);
  });

  it('test-download refuses a non-media id without starting yt-dlp', async () => {
    for (const videoId of [HOSTILE, '--exec=touch /tmp/x', '../x', '', 42]) {
      await expect(testDownload(mockEvent('', { method: 'POST', body: { videoId } }))).rejects.toMatchObject({ statusCode: 400 });
    }
    expect(spawned).toEqual([]);
  });

  it('playlist sync never links a stored row whose id is not a media id', async () => {
    insertChannel(db, { id: 'UCchan', title: 'Chan' });
    insertVideo(db, { id: 'good1', channelId: 'UCchan', downloadStatus: 'completed' });
    insertVideo(db, { id: HOSTILE, channelId: 'UCchan', downloadStatus: 'completed' });
    nextStdout = [
      JSON.stringify({ _type: 'playlist', entries: [{ id: 'PL1', title: 'List' }] }),
      JSON.stringify({ _type: 'playlist', entries: [{ id: 'good1' }, { id: HOSTILE }, { id: '../x' }] }),
    ];
    await syncChannelPlaylists('UCchan');
    expect(spawned).toHaveLength(2);
    expect(db.prepare('SELECT video_id FROM playlist_videos WHERE playlist_id = ? ORDER BY position').all('PL1')).toEqual([{ video_id: 'good1' }]);
  });
});

describe('music track ids', () => {
  it('cleanupPartialMusicFiles: a non-media id names no file to remove', () => {
    insertMusicArtist(db, { id: 'a1', name: 'Art' });
    const artistDir = path.join(getMusicDownloadsDir(), 'Art');
    assertInTmp(artistDir);
    fs.mkdirSync(artistDir, { recursive: true });
    const victim = path.join(artistDir, 'trk.f251.webm.part');
    fs.writeFileSync(victim, 'partial of trk');
    try {
      cleanupPartialMusicFiles('trk.f251', 'a1');
      expect(fs.existsSync(victim)).toBe(true);
      // The real track's own cleanup still works.
      cleanupPartialMusicFiles('trk', 'a1');
      expect(fs.existsSync(victim)).toBe(false);
    } finally {
      fs.rmSync(artistDir, { recursive: true, force: true });
    }
  });
});
