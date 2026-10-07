import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { deleteMusicArtist } from '../../server/utils/musicDownloader';
import { deletePodcastShow } from '../../server/utils/podcastDownloader';
import { createTestDb, insertMusicArtist, insertMusicTrack, insertPodcastShow, insertPodcastEpisode } from '../helpers/testDb';

let db: Database.Database;
let root: string;
let base: string;

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
  // root/sibling.txt + root/base/<entity folders>: '..' from base is root.
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'yk-entity-del-'));
  base = path.join(root, 'base');
  fs.mkdirSync(base);
  fs.writeFileSync(path.join(root, 'sibling.txt'), 'x');
  fs.mkdirSync(path.join(base, 'Someone Else'));
  fs.writeFileSync(path.join(base, 'Someone Else', 'z1.opus'), 'x');
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const exists = (...p: string[]) => fs.existsSync(path.join(...p));

describe('music artist delete never escapes or empties the base folder', () => {
  for (const name of ['..', '.', '   ']) {
    it(`artist named ${JSON.stringify(name)}`, () => {
      insertMusicArtist(db, { id: 'a1', name });
      expect(deleteMusicArtist('a1', { baseDir: base })).toEqual({ success: true });
      expect(exists(root, 'sibling.txt')).toBe(true);
      expect(exists(base, 'Someone Else', 'z1.opus')).toBe(true);
    });
  }

  it('a folder shared with another artist keeps the other artist\'s files', () => {
    insertMusicArtist(db, { id: 'a1', name: 'AC/DC' });
    insertMusicArtist(db, { id: 'a2', name: 'AC_DC' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });
    insertMusicTrack(db, { id: 't2', artistId: 'a2' });
    fs.mkdirSync(path.join(base, 'AC_DC'));
    for (const f of ['t1.opus', 't1.jpg', 't2.opus']) fs.writeFileSync(path.join(base, 'AC_DC', f), 'x');

    deleteMusicArtist('a1', { baseDir: base });
    expect(fs.readdirSync(path.join(base, 'AC_DC'))).toEqual(['t2.opus']);

    deleteMusicArtist('a2', { baseDir: base });
    expect(exists(base, 'AC_DC')).toBe(false);
    expect(exists(base, 'Someone Else', 'z1.opus')).toBe(true);
  });

  it('a normal artist folder is still removed', () => {
    insertMusicArtist(db, { id: 'a1', name: 'Band' });
    fs.mkdirSync(path.join(base, 'Band', 'sub'), { recursive: true });
    fs.writeFileSync(path.join(base, 'Band', 'x.opus'), 'x');
    deleteMusicArtist('a1', { baseDir: base });
    expect(exists(base, 'Band')).toBe(false);
  });
});

describe('podcast show delete never escapes or empties the base folder', () => {
  for (const title of ['..', '.', '   ']) {
    it(`show titled ${JSON.stringify(title)}`, () => {
      insertPodcastShow(db, { id: 's1', title });
      expect(deletePodcastShow('s1', { baseDir: base })).toEqual({ success: true });
      expect(exists(root, 'sibling.txt')).toBe(true);
      expect(exists(base, 'Someone Else', 'z1.opus')).toBe(true);
    });
  }

  it('a folder shared with another show keeps the other show\'s files', () => {
    insertPodcastShow(db, { id: 's1', title: 'News: Daily' });
    insertPodcastShow(db, { id: 's2', title: 'News_ Daily', feedUrl: 'https://example.com/2' });
    insertPodcastEpisode(db, { id: 'e1', showId: 's1' });
    insertPodcastEpisode(db, { id: 'e2', showId: 's2' });
    fs.mkdirSync(path.join(base, 'News_ Daily'));
    for (const f of ['e1.mp3', 'e2.mp3']) fs.writeFileSync(path.join(base, 'News_ Daily', f), 'x');

    deletePodcastShow('s1', { baseDir: base });
    expect(fs.readdirSync(path.join(base, 'News_ Daily'))).toEqual(['e2.mp3']);
  });
});
