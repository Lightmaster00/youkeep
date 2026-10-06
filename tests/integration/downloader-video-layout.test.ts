import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../server/utils/db', () => ({ getDb: () => (globalThis as any).getDb() }));

import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { cleanupPartialFiles, cancelDownload, cleanupAfterFailedExit, activeProcesses } from '../../server/utils/downloader';
import { buildVideoPaths, locateDownloadedFiles, resolveVideoPaths } from '../../server/utils/videoPaths';
import { createTestDb, insertChannel, insertVideo } from '../helpers/testDb';

let db: Database.Database;
let dir: string;

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yk-dl-'));
  insertChannel(db, { id: 'c1', title: 'Chan', customSavePath: dir });
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('downloader, one folder per video', () => {
  it('finds what yt-dlp wrote in the video folder and builds the stored URLs', () => {
    const p = buildVideoPaths({ baseDir: dir, channelFolder: 'Chan', title: 'Hello World', id: 'abc' });
    fs.mkdirSync(p.dir, { recursive: true });
    fs.writeFileSync(path.join(p.dir, 'Hello World [abc].mp4.part'), 'x');
    expect(locateDownloadedFiles(p).videoUrl).toBeNull();

    for (const f of ['Hello World [abc].webm', 'Hello World [abc].webp', 'Hello World [abc].fr.vtt']) fs.writeFileSync(path.join(p.dir, f), 'x');
    const found = locateDownloadedFiles(p);
    const folder = 'Hello%20World%20%5Babc%5D';
    expect(found.videoFile).toBe(path.join(dir, 'Chan', 'Hello World [abc]', 'Hello World [abc].webm'));
    expect(found.videoUrl).toBe(`/downloads/Chan/${folder}/${folder}.webm`);
    expect(found.thumbnailUrl).toBe(`/downloads/Chan/${folder}/${folder}.webp`);
    expect(found.infoJsonFile).toBe(path.join(p.dir, 'Hello World [abc].info.json'));
  });

  it('cleanup after a failed or cancelled download removes only that video\'s files', () => {
    insertVideo(db, { id: 'abc', channelId: 'c1', title: 'Hello World', downloadStatus: 'downloading' });
    insertVideo(db, { id: 'def', channelId: 'c1', title: 'Other', downloadStatus: 'downloading' });
    const a = buildVideoPaths({ baseDir: dir, channelFolder: 'Chan', title: 'Hello World', id: 'abc' });
    const b = buildVideoPaths({ baseDir: dir, channelFolder: 'Chan', title: 'Other', id: 'def' });
    fs.mkdirSync(a.dir, { recursive: true });
    fs.mkdirSync(b.dir, { recursive: true });
    fs.writeFileSync(path.join(a.dir, `${a.baseName}.f137.mp4.part`), 'x');
    fs.writeFileSync(path.join(a.dir, `${a.baseName}.webp`), 'x');
    fs.writeFileSync(path.join(b.dir, `${b.baseName}.mp4.part`), 'x');
    fs.writeFileSync(path.join(b.dir, 'notes.txt'), 'x');
    fs.writeFileSync(path.join(dir, 'Chan', 'abc.mp4.part'), 'x'); // legacy leftover

    cleanupPartialFiles('abc', 'c1');
    cleanupPartialFiles('def', 'c1');

    expect(fs.existsSync(a.dir)).toBe(false);
    expect(fs.readdirSync(b.dir)).toEqual(['notes.txt']);
    expect(fs.existsSync(path.join(dir, 'Chan', 'abc.mp4.part'))).toBe(false);
  });

  it('a resumed download keeps the folder already on disk when the title changed, and never takes another id\'s folder', () => {
    const old = path.join(dir, 'Chan', 'Old Title [abc]');
    fs.mkdirSync(old, { recursive: true });
    fs.writeFileSync(path.join(old, 'Old Title [abc].f137.mp4.part'), 'x');
    fs.mkdirSync(path.join(dir, 'Chan', 'New Title [abcd]'));

    const p = resolveVideoPaths({ baseDir: dir, channelFolder: 'Chan', title: 'New Title', id: 'abc' });
    expect(p.dir).toBe(old);
    expect(p.outputTemplate).toBe(`${path.join(old, 'Old Title [abc]')}.%(ext)s`);
    expect(p.videoUrlFor('mp4')).toBe('/downloads/Chan/Old%20Title%20%5Babc%5D/Old%20Title%20%5Babc%5D.mp4');

    // A folder for a different id (similar name) is never reused.
    expect(resolveVideoPaths({ baseDir: dir, channelFolder: 'Chan', title: 'New Title', id: 'bc' }).dir).toBe(path.join(dir, 'Chan', 'New Title [bc]'));
  });

  it('two folders for one id: the one holding the video\'s files wins, else name order', () => {
    const chan = path.join(dir, 'Chan');
    for (const f of ['B [abc]', 'C [abc]']) fs.mkdirSync(path.join(chan, f), { recursive: true });
    expect(resolveVideoPaths({ baseDir: dir, channelFolder: 'Chan', title: 'Z', id: 'abc' }).baseName).toBe('B [abc]');
    fs.writeFileSync(path.join(chan, 'C [abc]', 'C [abc].mp4.part'), 'x');
    expect(resolveVideoPaths({ baseDir: dir, channelFolder: 'Chan', title: 'Z', id: 'abc' }).baseName).toBe('C [abc]');
  });

  it('cancel cleanup after a title change removes the folder on disk and legacy format partials', () => {
    insertVideo(db, { id: 'abc', channelId: 'c1', title: 'New Title', downloadStatus: 'downloading' });
    const chan = path.join(dir, 'Chan');
    const old = path.join(chan, 'Old Title [abc]');
    fs.mkdirSync(old, { recursive: true });
    fs.writeFileSync(path.join(old, 'Old Title [abc].f137.mp4.part'), 'x');
    for (const f of ['abc.f137.mp4.part', 'abc.f140.m4a.ytdl', 'abcd.f137.mp4.part']) fs.writeFileSync(path.join(chan, f), 'x');

    cleanupPartialFiles('abc', 'c1');

    expect(fs.existsSync(old)).toBe(false);
    expect(fs.readdirSync(chan)).toEqual(['abcd.f137.mp4.part']);
  });

  it('a pause keeps partial files through the process exit; a later failure and a cancel still clean up', () => {
    insertVideo(db, { id: 'abc', channelId: 'c1', title: 'Hello World', downloadStatus: 'downloading' });
    db.prepare('UPDATE videos SET download_progress = 60 WHERE id = ?').run('abc');
    const p = buildVideoPaths({ baseDir: dir, channelFolder: 'Chan', title: 'Hello World', id: 'abc' });
    const partial = path.join(p.dir, `${p.baseName}.f137.mp4.part`);
    const legacyFragment = path.join(dir, 'Chan', 'abc.f140.m4a.part');
    const seedPartials = () => {
      fs.mkdirSync(p.dir, { recursive: true });
      fs.writeFileSync(partial, 'x');
      fs.writeFileSync(legacyFragment, 'x');
    };
    const fakeChild = () => {
      const child = { kill: vi.fn() };
      activeProcesses.set('abc', child);
      return child;
    };

    // Pause (what pause.post.ts does), then yt-dlp exits after the SIGKILL.
    seedPartials();
    const paused = fakeChild();
    cancelDownload('abc', 'pending', true);
    cleanupAfterFailedExit('abc', 'c1');
    expect(paused.kill).toHaveBeenCalledWith('SIGKILL');
    expect(fs.existsSync(partial)).toBe(true);
    expect(fs.existsSync(legacyFragment)).toBe(true);
    expect(db.prepare('SELECT download_status, download_progress FROM videos WHERE id = ?').get('abc')).toEqual({ download_status: 'pending', download_progress: 60 });

    // The resumed attempt then fails for real: its files are cleaned.
    cleanupAfterFailedExit('abc', 'c1');
    expect(fs.existsSync(p.dir)).toBe(false);
    expect(fs.existsSync(legacyFragment)).toBe(false);

    // A real cancel removes them too, including after the process exit.
    seedPartials();
    fakeChild();
    cancelDownload('abc');
    cleanupAfterFailedExit('abc', 'c1');
    expect(fs.existsSync(p.dir)).toBe(false);
    expect(fs.existsSync(legacyFragment)).toBe(false);
  });
});
