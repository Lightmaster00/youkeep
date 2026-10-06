import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import deleteHandler from '../../server/api/admin/videos/[id].delete';
import { requireAdmin } from '../../server/utils/auth';
import { sanitizeFolderName } from '../../server/utils/downloader';
import { buildVideoPaths, listSubtitleFiles, resolveStoredPath } from '../../server/utils/videoPaths';
import { createTestDb, insertChannel, insertSession, insertUser, insertVideo, mockEvent, sessionCookie } from '../helpers/testDb';

let db: Database.Database;
let dir: string;

beforeEach(() => {
  db = createTestDb();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yk-files-'));
  (globalThis as any).getDb = () => db;
  (globalThis as any).getDownloadsDir = () => dir;
  (globalThis as any).requireAdmin = requireAdmin;
  (globalThis as any).sanitizeFolderName = sanitizeFolderName;
  // The real cancelDownload also deletes files; stub it so these tests prove the route's own removal.
  (globalThis as any).cancelDownload = () => true;
  insertChannel(db, { id: 'c1', title: 'Chan' });
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

function newLayout(id: string, title: string, suffixes: string[], baseDir = dir) {
  const p = buildVideoPaths({ baseDir, channelFolder: 'Chan', title, id });
  insertVideo(db, { id, channelId: 'c1', title, localVideoPath: p.videoUrlFor('mp4'), localThumbnailPath: p.thumbUrlFor('jpg') });
  fs.mkdirSync(p.dir, { recursive: true });
  for (const s of suffixes) fs.writeFileSync(path.join(p.dir, `${p.baseName}${s}`), 'x');
  return p;
}

function legacy(id: string, suffixes: string[]) {
  insertVideo(db, { id, channelId: 'c1', localVideoPath: `/downloads/Chan/${id}.mp4`, localThumbnailPath: `/downloads/Chan/${id}.jpg` });
  fs.mkdirSync(path.join(dir, 'Chan'), { recursive: true });
  for (const s of suffixes) fs.writeFileSync(path.join(dir, 'Chan', `${id}${s}`), 'x');
}

const row = (id: string) => db.prepare('SELECT id, channel_id, title, local_video_path FROM videos WHERE id = ?').get(id) as any;

function adminCookie() {
  insertUser(db, { id: 'admin1', role: 'admin' });
  insertSession(db, { id: 'sess-admin1', userId: 'admin1' });
  return sessionCookie('sess-admin1');
}

describe('video files in both layouts', () => {
  it('finds subtitles in the video folder (new layout) and in the channel folder (legacy)', () => {
    const p = newLayout('n1', 'New One', ['.mp4', '.fr.vtt', '.en-US.vtt']);
    legacy('l1', ['.mp4', '.jpg', '.es.vtt']);

    const n = resolveStoredPath(db, row('n1'), { downloadsDir: dir });
    expect(n).toMatchObject({ layout: 'new', dir: p.dir, baseName: p.baseName });
    expect(listSubtitleFiles(n).map((s) => [s.code, s.url]).sort()).toEqual([
      ['en-US', p.subtitleUrlFor(`${p.baseName}.en-US.vtt`)],
      ['fr', p.subtitleUrlFor(`${p.baseName}.fr.vtt`)],
    ]);

    const l = resolveStoredPath(db, row('l1'), { downloadsDir: dir });
    expect(l.layout).toBe('legacy');
    expect(listSubtitleFiles(l)).toEqual([{ code: 'es', fileName: 'l1.es.vtt', url: '/downloads/Chan/l1.es.vtt' }]);
  });

  it('deleting a new-layout video removes its folder only when nothing else is in it', async () => {
    const cookie = adminCookie();
    const alone = newLayout('n1', 'Alone', ['.mp4', '.jpg', '.fr.vtt']);
    const shared = newLayout('n2', 'Shared', ['.mp4']);
    fs.writeFileSync(path.join(shared.dir, 'keep-me.txt'), 'x');

    await deleteHandler(mockEvent(cookie, { method: 'DELETE', params: { id: 'n1' } }));
    await deleteHandler(mockEvent(cookie, { method: 'DELETE', params: { id: 'n2' } }));

    expect(fs.existsSync(alone.dir)).toBe(false);
    expect(fs.readdirSync(shared.dir)).toEqual(['keep-me.txt']);
    expect(fs.existsSync(path.join(dir, 'Chan'))).toBe(true);
  });

  it('deleting a new-layout video in a custom save path leaves its sibling and copes with a missing folder', async () => {
    const cookie = adminCookie();
    const custom = path.join(dir, 'custom');
    db.prepare('UPDATE channels SET custom_save_path = ? WHERE id = ?').run(custom, 'c1');
    const gone = newLayout('n1', 'Gone', ['.mp4'], custom);
    const sibling = newLayout('n2', 'Sibling', ['.mp4', '.jpg'], custom);
    const target = newLayout('n3', 'Target', ['.mp4', '.jpg'], custom);
    fs.rmSync(gone.dir, { recursive: true });

    await deleteHandler(mockEvent(cookie, { method: 'DELETE', params: { id: 'n1' } }));
    await deleteHandler(mockEvent(cookie, { method: 'DELETE', params: { id: 'n3' } }));

    expect(fs.existsSync(target.dir)).toBe(false);
    expect(fs.readdirSync(sibling.dir).sort()).toEqual([`${sibling.baseName}.jpg`, `${sibling.baseName}.mp4`]);
    expect(fs.readdirSync(path.join(custom, 'Chan'))).toEqual([sibling.baseName]);
    expect(db.prepare('SELECT COUNT(*) n FROM videos').get()).toEqual({ n: 1 });
  });

  it('deleting removes only known video artifacts; foreign files, a sub-folder and the video folder stay', async () => {
    const cookie = adminCookie();
    const p = newLayout('n1', 'Mixed', ['.mp4', '.f137.mp4.part', '.f140.m4a.ytdl', '.temp.mp4', '.webp', '.en-US.vtt', '.info.json', '.notes.txt']);
    fs.mkdirSync(path.join(p.dir, `${p.baseName}.extras`));
    fs.writeFileSync(path.join(p.dir, `${p.baseName}.extras`, `${p.baseName}.mp4`), 'x');
    // A directory named like an artifact is still not a video file.
    fs.mkdirSync(path.join(p.dir, `${p.baseName}.jpg`));

    const res = await deleteHandler(mockEvent(cookie, { method: 'DELETE', params: { id: 'n1' } }));

    expect(res).toEqual({ success: true });
    expect(fs.readdirSync(p.dir).sort()).toEqual([`${p.baseName}.extras`, `${p.baseName}.jpg`, `${p.baseName}.notes.txt`]);
    expect(fs.readdirSync(path.join(p.dir, `${p.baseName}.extras`))).toEqual([`${p.baseName}.mp4`]);
  });

  it('a file that cannot be removed does not fail the delete; the other files still go', async () => {
    const cookie = adminCookie();
    const p = newLayout('n1', 'Busy', ['.mp4', '.jpg', '.fr.vtt']);
    const realUnlink = fs.unlinkSync;
    vi.spyOn(fs, 'unlinkSync').mockImplementation(((file: fs.PathLike) => {
      if (String(file).endsWith('.mp4')) throw Object.assign(new Error('EBUSY: resource busy'), { code: 'EBUSY' });
      return realUnlink(file);
    }) as any);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await deleteHandler(mockEvent(cookie, { method: 'DELETE', params: { id: 'n1' } }));

    expect(res).toMatchObject({ success: true, warning: expect.stringContaining('1 of its files') });
    expect(fs.readdirSync(p.dir)).toEqual([`${p.baseName}.mp4`]);
    expect(db.prepare('SELECT COUNT(*) n FROM videos').get()).toEqual({ n: 0 });
  });

  it('a stored path pointing at another video\'s folder or another channel\'s folder deletes nothing there', async () => {
    const cookie = adminCookie();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const otherVideo = path.join(dir, 'Chan', 'Other [zzz]');
    const otherChannel = path.join(dir, 'OtherChan', 'Title [n2]');
    for (const [folder, base] of [[otherVideo, 'Other [zzz]'], [otherChannel, 'Title [n2]']] as const) {
      fs.mkdirSync(folder, { recursive: true });
      fs.writeFileSync(path.join(folder, `${base}.mp4`), 'x');
    }
    insertVideo(db, { id: 'n1', channelId: 'c1', localVideoPath: '/downloads/Chan/Other%20%5Bzzz%5D/Other%20%5Bzzz%5D.mp4' });
    insertVideo(db, { id: 'n2', channelId: 'c1', localVideoPath: '/downloads/OtherChan/Title%20%5Bn2%5D/Title%20%5Bn2%5D.mp4' });

    await deleteHandler(mockEvent(cookie, { method: 'DELETE', params: { id: 'n1' } }));
    await deleteHandler(mockEvent(cookie, { method: 'DELETE', params: { id: 'n2' } }));

    expect(fs.readdirSync(otherVideo)).toEqual(['Other [zzz].mp4']);
    expect(fs.readdirSync(otherChannel)).toEqual(['Title [n2].mp4']);
  });

  it('a video without a stored path loses its new-layout folder and its legacy partials, nothing else', async () => {
    const cookie = adminCookie();
    insertVideo(db, { id: 'p1', channelId: 'c1', title: 'Pending', downloadStatus: 'downloading', localVideoPath: null });
    const p = buildVideoPaths({ baseDir: dir, channelFolder: 'Chan', title: 'Pending', id: 'p1' });
    fs.mkdirSync(p.dir, { recursive: true });
    fs.writeFileSync(path.join(p.dir, `${p.baseName}.f137.mp4.part`), 'x');
    for (const f of ['p1.mp4.part', 'p10.mp4.part']) fs.writeFileSync(path.join(dir, 'Chan', f), 'x');

    await deleteHandler(mockEvent(cookie, { method: 'DELETE', params: { id: 'p1' } }));

    expect(fs.readdirSync(path.join(dir, 'Chan'))).toEqual(['p10.mp4.part']);
  });

  it('deleting a legacy video still removes its files from the channel folder', async () => {
    const cookie = adminCookie();
    legacy('l1', ['.mp4', '.jpg']);
    legacy('l2', ['.mp4']);
    await deleteHandler(mockEvent(cookie, { method: 'DELETE', params: { id: 'l1' } }));
    expect(fs.readdirSync(path.join(dir, 'Chan'))).toEqual(['l2.mp4']);
  });
});
