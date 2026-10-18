import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import downloadsRoute from '../../server/routes/downloads/[...path]';
import { sanitizeFolderName } from '../../server/utils/downloader';
import { canAccessVideo } from '../../server/utils/auth';
import { removeVideoFiles, removeEntityFolder } from '../../server/utils/videoPaths';
import { isTidyItemContained, type TidyPlanItem } from '../../server/utils/videoTidy';
import { assertInTmp, createTestDb, insertChannel, insertVideo, mockEvent } from '../helpers/testDb';

// The path-containment checks (isContained and friends) that a reachable
// input can defeat on its own. Each test plants a file just outside the
// folder the code may touch, and asserts it is neither served nor removed.

let db: Database.Database;
let dir: string;

beforeEach(() => {
  db = createTestDb();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yk-contain-'));
  assertInTmp(dir);
  Object.assign(globalThis as any, {
    getDb: () => db, getDownloadsDir: () => path.join(dir, 'downloads'), sanitizeFolderName, canAccessVideo, getQuery: () => ({}),
  });
  fs.mkdirSync(path.join(dir, 'downloads'), { recursive: true });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(async () => {
  await new Promise((r) => setImmediate(r));
  fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

async function get(param: string): Promise<number> {
  const event = mockEvent(undefined, { params: { path: param } });
  try {
    const r: any = await downloadsRoute(event);
    r?.on?.('error', () => {});
    r?.destroy?.();
    return event.node.res.statusCode;
  } catch (e: any) {
    return e.statusCode;
  }
}

describe('/downloads legacy flat files', () => {
  it('a channel titled ".." never serves the file next to the downloads folder', async () => {
    insertChannel(db, { id: 'c1', title: '..', customSavePath: path.join(dir, 'base') });
    fs.mkdirSync(path.join(dir, 'base'), { recursive: true });
    insertVideo(db, { id: 'v1', channelId: 'c1', localVideoPath: null, localThumbnailPath: null });
    // <base>/.. and <downloads>/.. are both `dir`.
    fs.writeFileSync(path.join(dir, 'v1.mp4'), 'outside');
    expect(await get('x/v1.mp4')).toBe(404);
  });

  it('the same file inside its channel folder is served (control)', async () => {
    insertChannel(db, { id: 'c1', title: 'Chan', customSavePath: path.join(dir, 'base') });
    fs.mkdirSync(path.join(dir, 'base', 'Chan'), { recursive: true });
    insertVideo(db, { id: 'v1', channelId: 'c1', localVideoPath: null, localThumbnailPath: null });
    fs.writeFileSync(path.join(dir, 'base', 'Chan', 'v1.mp4'), 'inside');
    expect(await get('Chan/v1.mp4')).toBe(200);
  });

  it('a stored row whose id is not a media id is never served by file name', async () => {
    insertChannel(db, { id: 'c1', title: 'Chan', customSavePath: path.join(dir, 'base') });
    fs.mkdirSync(path.join(dir, 'base', 'Chan'), { recursive: true });
    db.prepare("INSERT INTO videos (id, title, channel_id, visibility, download_status, created_at) VALUES ('a b', 't', 'c1', 'public', 'completed', 0)").run();
    fs.writeFileSync(path.join(dir, 'base', 'Chan', 'a b.mp4'), 'legacy');
    expect(await get('Chan/a%20b.mp4')).toBe(404);
  });
});

describe('removeVideoFiles', () => {
  it('never touches a video folder outside its base', () => {
    const base = path.join(dir, 'base');
    const outside = path.join(dir, 'Victim [v1]');
    fs.mkdirSync(base, { recursive: true });
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(outside, 'Victim [v1].mp4'), 'x');
    fs.writeFileSync(path.join(outside, 'Victim [v1].jpg'), 'x');
    const r = removeVideoFiles({ layout: 'new', baseDir: base, dir: path.join(base, '..', 'Victim [v1]'), baseName: 'Victim [v1]', urlDir: '', videoFile: null });
    expect(r).toEqual({ removed: 0, failed: 0 });
    expect(fs.readdirSync(outside).sort()).toEqual(['Victim [v1].jpg', 'Victim [v1].mp4']);
  });

  it('never treats the base folder itself as a video folder', () => {
    const base = path.join(dir, 'Base [v1]');
    fs.mkdirSync(base, { recursive: true });
    fs.writeFileSync(path.join(base, 'Base [v1].mp4'), 'x');
    expect(removeVideoFiles({ layout: 'new', baseDir: base, dir: base, baseName: 'Base [v1]', urlDir: '', videoFile: null })).toEqual({ removed: 0, failed: 0 });
    expect(fs.existsSync(path.join(base, 'Base [v1].mp4'))).toBe(true);
  });
});

describe('removeEntityFolder', () => {
  it.each(['..', '.', '', '../outside', 'a/b', '/abs'])('refuses the folder %j (not directly inside the base)', (folder) => {
    const base = path.join(dir, 'base');
    fs.mkdirSync(path.join(base, 'a', 'b'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'outside'), { recursive: true });
    for (const f of [path.join(dir, 't1.mp3'), path.join(base, 't1.mp3'), path.join(dir, 'outside', 't1.mp3'), path.join(base, 'a', 'b', 't1.mp3')]) fs.writeFileSync(f, 'x');
    const r = removeEntityFolder({ baseDir: base, folder, ownIds: ['t1'], otherFolders: [], label: 'test' });
    expect(r.removedDir).toBe(false);
    expect(fs.existsSync(path.join(dir, 't1.mp3'))).toBe(true);
    expect(fs.existsSync(path.join(base, 't1.mp3'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'outside', 't1.mp3'))).toBe(true);
    expect(fs.existsSync(path.join(base, 'a', 'b', 't1.mp3'))).toBe(true);
  });
});

describe('removeEntityFolder at the filesystem root', () => {
  it('the root as its own base is refused before anything is listed or removed', () => {
    const readdir = vi.spyOn(fs, 'readdirSync');
    const r = removeEntityFolder({ baseDir: '/', folder: '', ownIds: ['yk-no-such-id'], otherFolders: [], label: 'test' });
    expect(r).toEqual({ removedDir: false, skippedReason: 'the folder / is not inside /' });
    expect(readdir).not.toHaveBeenCalled();
  });
});

describe('isTidyItemContained edge cases', () => {
  const item = (over: Partial<TidyPlanItem>): TidyPlanItem => ({
    id: 'v1', title: 'T', channelId: 'c', channelTitle: 'C', kind: 'legacy',
    fromDir: '/base/C', toDir: '/base/C/T [v1]',
    moves: [{ from: '/base/C/v1.mp4', to: '/base/C/T [v1]/T [v1].mp4', size: 1 } as any],
    cleanupDirs: ['/base/C'], oldVideoUrl: '/downloads/C/v1.mp4', oldThumbUrl: null, newVideoUrl: 'x', newThumbUrl: null,
    ...over,
  });

  it('a move whose source is its folder itself (the filesystem root) is refused', () => {
    expect(isTidyItemContained(item({ fromDir: '/', moves: [{ from: '/', to: '/base/C/T [v1]/x', size: 1 } as any], cleanupDirs: ['/'] }))).toBe(false);
  });

  it('a move whose destination is its folder itself (the filesystem root) is refused', () => {
    expect(isTidyItemContained(item({ toDir: '/', moves: [{ from: '/base/C/v1.mp4', to: '/', size: 1 } as any] }))).toBe(false);
  });

  it('a destination that leaves its folder is refused', () => {
    expect(isTidyItemContained(item({ moves: [{ from: '/base/C/v1.mp4', to: '/base/C/T [v1]/../../../etc/x', size: 1 } as any] }))).toBe(false);
  });

  it('a cleanup folder below the source folder is refused', () => {
    expect(isTidyItemContained(item({ cleanupDirs: ['/base/C/sub'] }))).toBe(false);
    expect(isTidyItemContained(item({ cleanupDirs: ['/base/C', '/base'] }))).toBe(true);
  });
});
