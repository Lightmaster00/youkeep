import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../server/utils/db', () => ({ getDb: () => (globalThis as any).getDb() }));

import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { cleanupPartialFiles } from '../../server/utils/downloader';
import { buildVideoPaths, locateDownloadedFiles } from '../../server/utils/videoPaths';
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
});
