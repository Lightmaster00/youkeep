import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { keepFinishedOutputAfterError } from '../../server/utils/downloader';
import { buildVideoPaths } from '../../server/utils/videoPaths';
import { createTestDb, insertChannel, insertVideo } from '../helpers/testDb';

let db: Database.Database;
let dir: string;

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yk-exit-'));
  insertChannel(db, { id: 'c1', title: 'Chan', customSavePath: dir });
  insertVideo(db, { id: 'abc', channelId: 'c1', title: 'Hello', downloadStatus: 'downloading' });
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function seed(files: Record<string, string>) {
  const p = buildVideoPaths({ baseDir: dir, channelFolder: 'Chan', title: 'Hello', id: 'abc' });
  fs.mkdirSync(p.dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(p.dir, `${p.baseName}.${name}`), content);
  return p;
}

describe('yt-dlp non-zero exit after the video was produced', () => {
  it('keeps a finished video file (exit 1 from a failed subtitle request) and reports it as done', () => {
    const p = seed({ mp4: 'video', jpg: 'thumb', 'en.vtt': 'subs', 'info.json': '{}' });
    expect(keepFinishedOutputAfterError('abc', 'c1', 1, p)).toBe(true);
    expect(fs.readdirSync(p.dir).sort()).toEqual([`${p.baseName}.en.vtt`, `${p.baseName}.info.json`, `${p.baseName}.jpg`, `${p.baseName}.mp4`]);
  });

  it('a real failure (only partials, or an empty file) still removes only its own partial files', () => {
    const p = seed({ 'f137.mp4.part': 'x', webp: 'thumb' });
    const other = buildVideoPaths({ baseDir: dir, channelFolder: 'Chan', title: 'Other', id: 'zzz' });
    fs.mkdirSync(other.dir, { recursive: true });
    fs.writeFileSync(path.join(other.dir, `${other.baseName}.mp4`), 'video');
    expect(keepFinishedOutputAfterError('abc', 'c1', 1, p)).toBe(false);
    expect(fs.existsSync(p.dir)).toBe(false);
    expect(fs.existsSync(path.join(other.dir, `${other.baseName}.mp4`))).toBe(true);

    const empty = seed({ mp4: '' });
    expect(keepFinishedOutputAfterError('abc', 'c1', 2, empty)).toBe(false);
    expect(fs.existsSync(empty.dir)).toBe(false);
  });

  it('a process killed by a signal (cancel, pause, timeout) never counts as finished', () => {
    const p = seed({ mp4: 'video' });
    expect(keepFinishedOutputAfterError('abc', 'c1', null, p)).toBe(false);
  });
});
