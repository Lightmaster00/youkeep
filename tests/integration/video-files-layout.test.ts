import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

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

  it('deleting a legacy video still removes its files from the channel folder', async () => {
    const cookie = adminCookie();
    legacy('l1', ['.mp4', '.jpg']);
    legacy('l2', ['.mp4']);
    await deleteHandler(mockEvent(cookie, { method: 'DELETE', params: { id: 'l1' } }));
    expect(fs.readdirSync(path.join(dir, 'Chan'))).toEqual(['l2.mp4']);
  });
});
