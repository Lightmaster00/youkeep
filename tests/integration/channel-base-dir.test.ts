import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import fileRoute from '../../server/routes/downloads/[...path]';
import deleteChannel from '../../server/api/admin/channels/[id].delete';
import deleteVideo from '../../server/api/admin/videos/[id].delete';
import { resolveChannelBaseDir, sanitizeFolderName } from '../../server/utils/downloader';
import { canAccessVideo } from '../../server/utils/auth';
import { buildVideoPaths, channelBaseDirs, channelWriteBaseDir, listSubtitleFiles, resolveStoredPath } from '../../server/utils/videoPaths';
import { planTidy } from '../../server/utils/videoTidy';
import { createTestDb, insertChannel, insertVideo, mockEvent } from '../helpers/testDb';

// One rule for where a channel's video files are: the base the downloader
// writes to (its save folder when that is writable, else the default downloads
// folder) is the source of truth for every read (file route, subtitles,
// durations, delete), with the other place the downloader may have written to
// as a fallback.

let db: Database.Database;
let dir: string;
let downloads: string;

beforeEach(() => {
  db = createTestDb();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yk-basedir-'));
  downloads = path.join(dir, 'downloads');
  fs.mkdirSync(downloads);
  Object.assign(globalThis as any, {
    getDb: () => db, getDownloadsDir: () => downloads, sanitizeFolderName, canAccessVideo, getQuery: () => ({}),
    requireAdmin: async () => ({}), cancelDownload: () => {}, resolveChannelBaseDir,
  });
});

afterEach(async () => {
  await new Promise((resolve) => setImmediate(resolve));
  fs.rmSync(dir, { recursive: true, force: true });
});

function closeIfStream(result: any) {
  if (result && typeof result.destroy === 'function') {
    result.on?.('error', () => {});
    result.destroy();
  }
}

/** A save folder the downloader cannot create: its parent is a file. */
function unwritableCustom(): string {
  fs.writeFileSync(path.join(dir, 'not-a-folder'), 'x');
  return path.join(dir, 'not-a-folder', 'videos');
}

/** A new-layout video written where the downloader writes for this channel. */
function seedNew(custom: string | null, writtenTo: string) {
  insertChannel(db, { id: 'c1', title: 'Chan', customSavePath: custom });
  const p = buildVideoPaths({ baseDir: writtenTo, channelFolder: 'Chan', title: 'Clip', id: 'v1' });
  insertVideo(db, { id: 'v1', channelId: 'c1', title: 'Clip', localVideoPath: p.videoUrlFor('mp4'), localThumbnailPath: p.thumbUrlFor('jpg') });
  fs.mkdirSync(p.dir, { recursive: true });
  fs.writeFileSync(path.join(p.dir, `${p.baseName}.mp4`), '0123456789');
  fs.writeFileSync(path.join(p.dir, `${p.baseName}.en.vtt`), 'WEBVTT');
  return p;
}

async function status(url: string): Promise<number> {
  const event = mockEvent(undefined, { params: { path: decodeURIComponent(url.slice('/downloads/'.length)) } });
  try {
    closeIfStream(await fileRoute(event));
    return event.node.res.statusCode;
  } catch (err: any) {
    return err.statusCode;
  }
}

describe('channelWriteBaseDir', () => {
  it('matches the downloader\'s resolveChannelBaseDir, without creating anything', () => {
    const missing = path.join(dir, 'new', 'deep');
    const unwritable = unwritableCustom();
    // Both pick the save folder, or both fall back to the default folder.
    for (const custom of [null, '', '  ', downloads, unwritable]) {
      expect(channelWriteBaseDir(custom, downloads) === custom).toBe(resolveChannelBaseDir(custom) === custom);
    }
    expect(channelWriteBaseDir(unwritable, downloads)).toBe(downloads);
    expect(channelWriteBaseDir(missing, downloads)).toBe(missing);
    expect(fs.existsSync(path.join(dir, 'new'))).toBe(false);
    expect(resolveChannelBaseDir(missing)).toBe(missing);
  });

  it('lists the write base first, then the other place the downloader may have used', () => {
    const custom = path.join(dir, 'custom');
    expect(channelBaseDirs(null, downloads)).toEqual([downloads]);
    expect(channelBaseDirs(custom, downloads)).toEqual([custom, downloads]);
    const unwritable = unwritableCustom();
    expect(channelBaseDirs(unwritable, downloads)).toEqual([downloads, unwritable]);
  });
});

describe.each([
  ['unset save folder', () => ({ custom: null as string | null, writtenTo: () => downloads })],
  ['custom save folder', () => ({ custom: path.join(dir, 'custom'), writtenTo: () => path.join(dir, 'custom') })],
  ['unwritable save folder (files went to the default folder)', () => {
    const custom = unwritableCustom();
    return { custom, writtenTo: () => downloads };
  }],
])('a new-layout video, %s', (_name, setup) => {
  it('is served, its subtitles listed, its file found and deleted where the downloader wrote it', async () => {
    const { custom, writtenTo } = setup();
    const p = seedNew(custom, writtenTo());

    expect(await status(p.videoUrlFor('mp4'))).toBe(200);
    const loc = resolveStoredPath(db, { id: 'v1', channel_id: 'c1', local_video_path: p.videoUrlFor('mp4') }, { downloadsDir: downloads });
    expect(loc.dir).toBe(p.dir);
    expect(listSubtitleFiles(loc).map((s) => s.code)).toEqual(['en']);

    const result = await deleteVideo(mockEvent('', { method: 'DELETE', params: { id: 'v1' } }));
    expect(result).toEqual({ success: true });
    expect(fs.existsSync(p.dir)).toBe(false);
  });
});

describe('a legacy flat video', () => {
  it.each([
    ['unset save folder', false],
    ['unwritable save folder', true],
  ])('%s: served from the channel folder the downloader wrote to', async (_name, unwritable) => {
    const custom = unwritable ? unwritableCustom() : null;
    insertChannel(db, { id: 'c1', title: 'Chan', customSavePath: custom });
    insertVideo(db, { id: 'v1', channelId: 'c1', title: 'Old', localVideoPath: '/downloads/Chan/v1.mp4', localThumbnailPath: null });
    fs.mkdirSync(path.join(downloads, 'Chan'));
    fs.writeFileSync(path.join(downloads, 'Chan', 'v1.mp4'), 'old');
    fs.writeFileSync(path.join(downloads, 'Chan', 'v1.fr.vtt'), 'WEBVTT');

    expect(await status('/downloads/Chan/v1.mp4')).toBe(200);
    const loc = resolveStoredPath(db, { id: 'v1', channel_id: 'c1', local_video_path: '/downloads/Chan/v1.mp4' }, { downloadsDir: downloads });
    expect(loc.videoFile).toBe(path.join(downloads, 'Chan', 'v1.mp4'));
    expect(listSubtitleFiles(loc).map((s) => s.code)).toEqual(['fr']);

    await deleteVideo(mockEvent('', { method: 'DELETE', params: { id: 'v1' } }));
    expect(fs.existsSync(path.join(downloads, 'Chan', 'v1.mp4'))).toBe(false);
  });

  it('custom save folder: still read from the save folder', async () => {
    const custom = path.join(dir, 'custom');
    insertChannel(db, { id: 'c1', title: 'Chan', customSavePath: custom });
    insertVideo(db, { id: 'v1', channelId: 'c1', title: 'Old', localVideoPath: '/downloads/Chan/v1.mp4', localThumbnailPath: null });
    fs.mkdirSync(path.join(custom, 'Chan'), { recursive: true });
    fs.writeFileSync(path.join(custom, 'Chan', 'v1.mp4'), 'old');
    expect(await status('/downloads/Chan/v1.mp4')).toBe(200);
  });
});

describe('a save folder that became writable again', () => {
  it('still finds a video downloaded to the default folder while it was not', async () => {
    const custom = path.join(dir, 'custom');
    const p = seedNew(custom, downloads);
    expect(await status(p.videoUrlFor('mp4'))).toBe(200);
    const loc = resolveStoredPath(db, { id: 'v1', channel_id: 'c1', local_video_path: p.videoUrlFor('mp4') }, { downloadsDir: downloads });
    expect(loc.dir).toBe(p.dir);
  });
});

describe('tidy', () => {
  it('moves a legacy video of a channel with an unwritable save folder where the downloader wrote it', () => {
    const custom = unwritableCustom();
    insertChannel(db, { id: 'c1', title: 'Chan', customSavePath: custom });
    insertVideo(db, { id: 'v1', channelId: 'c1', title: 'Old', localVideoPath: '/downloads/Chan/v1.mp4', localThumbnailPath: null });
    fs.mkdirSync(path.join(downloads, 'Chan'));
    fs.writeFileSync(path.join(downloads, 'Chan', 'v1.mp4'), 'old');

    const plan = planTidy(db, { downloadsDir: downloads });

    expect(plan.preview).toMatchObject({ toMove: 1, missingFiles: 0 });
    expect(plan.items[0]!.toDir).toBe(path.join(downloads, 'Chan', 'Old [v1]'));
  });
});

describe('channel delete', () => {
  it('removes a video downloaded to the default folder while the save folder was unwritable, and nothing else there', async () => {
    const custom = path.join(dir, 'custom');
    const p = seedNew(custom, downloads);
    fs.writeFileSync(path.join(downloads, 'Chan', 'foreign.txt'), 'keep');
    fs.mkdirSync(path.join(custom, 'Chan'), { recursive: true });

    await deleteChannel(mockEvent('', { method: 'DELETE', params: { id: 'c1' } }));

    expect(fs.existsSync(p.dir)).toBe(false);
    expect(fs.readdirSync(path.join(downloads, 'Chan'))).toEqual(['foreign.txt']);
    expect(fs.existsSync(path.join(custom, 'Chan'))).toBe(false);
  });
});
