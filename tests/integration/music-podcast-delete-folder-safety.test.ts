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

  it('a normal artist folder is removed once its own files are gone', () => {
    insertMusicArtist(db, { id: 'a1', name: 'Band' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });
    fs.mkdirSync(path.join(base, 'Band'), { recursive: true });
    for (const f of ['t1.opus', 't1.jpg', 't1.opus.part']) fs.writeFileSync(path.join(base, 'Band', f), 'x');
    deleteMusicArtist('a1', { baseDir: base });
    expect(exists(base, 'Band')).toBe(false);
  });

  it('never removes recursively: a folder of the admin\'s own music named like the artist keeps its files', () => {
    insertMusicArtist(db, { id: 'a1', name: 'Queen' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });
    fs.mkdirSync(path.join(base, 'Queen', 'A Night at the Opera'), { recursive: true });
    fs.writeFileSync(path.join(base, 'Queen', 'A Night at the Opera', '01.flac'), 'x');
    fs.writeFileSync(path.join(base, 'Queen', 'cover.jpg'), 'x');
    fs.writeFileSync(path.join(base, 'Queen', 't1.opus'), 'x');
    deleteMusicArtist('a1', { baseDir: base });
    expect(fs.readdirSync(path.join(base, 'Queen')).sort()).toEqual(['A Night at the Opera', 'cover.jpg']);
    expect(exists(base, 'Queen', 'A Night at the Opera', '01.flac')).toBe(true);
  });

  it('also removes files stored under the folder of a name the artist had before a rename', () => {
    insertMusicArtist(db, { id: 'a1', name: 'New Name' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', localFilePath: '/downloads-music/Old Name/t1.opus', localThumbnailPath: '/downloads-music/Old Name/t1.jpg' });
    insertMusicTrack(db, { id: 't2', artistId: 'a1', localFilePath: '/downloads-music/../outside/t2.opus' });
    fs.mkdirSync(path.join(base, 'Old Name'));
    for (const f of ['t1.opus', 't1.jpg']) fs.writeFileSync(path.join(base, 'Old Name', f), 'x');
    fs.mkdirSync(path.join(root, 'outside'));
    fs.writeFileSync(path.join(root, 'outside', 't2.opus'), 'x');
    deleteMusicArtist('a1', { baseDir: base });
    expect(exists(base, 'Old Name')).toBe(false);
    expect(exists(root, 'outside', 't2.opus')).toBe(true);
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

  it('also removes episode files stored under the folder of a title the show had before a rename', () => {
    insertPodcastShow(db, { id: 's1', title: 'New Title' });
    insertPodcastEpisode(db, { id: 'e1', showId: 's1', localFilePath: '/downloads-podcasts/Old Title/e1.mp3' });
    fs.mkdirSync(path.join(base, 'Old Title'));
    fs.writeFileSync(path.join(base, 'Old Title', 'e1.mp3'), 'x');
    fs.writeFileSync(path.join(base, 'Old Title', 'mine.mp3'), 'x');
    deletePodcastShow('s1', { baseDir: base });
    expect(fs.readdirSync(path.join(base, 'Old Title'))).toEqual(['mine.mp3']);
  });
});
