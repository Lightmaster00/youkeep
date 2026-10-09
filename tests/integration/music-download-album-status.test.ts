import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

// yt-dlp is never run: spawn writes the files a successful download leaves
// behind (the media file and its .info.json), then exits with code 0.
const infoJson: { value: Record<string, any> } = { value: {} };
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    spawn: (_cmd: string, args: string[]) => {
      const template = args[args.indexOf('-o') + 1]!;
      const child: any = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => {};
      fs.writeFileSync(template.replace('%(ext)s', 'mp4'), 'media');
      fs.writeFileSync(template.replace('%(ext)s', 'info.json'), JSON.stringify(infoJson.value));
      setTimeout(() => child.emit('close', 0), 0);
      return child;
    },
  };
});
vi.mock('../../server/utils/downloader', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/utils/downloader')>();
  return { ...actual, getYtdlPath: async () => '/nonexistent/yt-dlp', isFfmpegAvailable: () => true };
});
const enqueued = vi.hoisted(() => [] as string[]);
vi.mock('../../server/utils/albumMatchRunner', () => ({ enqueueAlbumMatch: (id: string) => { enqueued.push(id); return true; } }));

import { downloadTrackClip, getMusicDownloadsDir, markMusicTrackCompleted } from '../../server/utils/musicDownloader';
import { assertInTmp, createTestDb, insertMusicAlbum, insertMusicArtist, insertMusicTrack } from '../helpers/testDb';

let db: Database.Database;
let base: string;

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
  base = getMusicDownloadsDir();
  assertInTmp(base);
  enqueued.length = 0;
  insertMusicArtist(db, { id: 'a1', name: 'Daft Punk' });
});
afterEach(() => {
  for (const entry of fs.readdirSync(base)) fs.rmSync(path.join(base, entry), { recursive: true, force: true });
});

const track = (id: string) => db.prepare('SELECT * FROM music_tracks WHERE id = ?').get(id) as any;

describe('album matching and the download pipeline', () => {
  it('a yt-dlp album marks the track manual, so the matcher never overrides it', async () => {
    infoJson.value = { album: 'Discovery', release_year: 2001 };
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });
    await downloadTrackClip('t1');
    const row = track('t1');
    expect(row.album_match_status).toBe('manual');
    expect((db.prepare('SELECT title FROM music_albums WHERE id = ?').get(row.album_id) as any).title).toBe('Discovery');
  });

  it('without a yt-dlp album the track stays unchecked', async () => {
    infoJson.value = {};
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });
    await downloadTrackClip('t1');
    expect(track('t1')).toMatchObject({ album_id: null, album_match_status: null });
  });

  it('a matched album is never replaced by the yt-dlp album of a later download', async () => {
    infoJson.value = { album: 'Some YouTube Album' };
    insertMusicAlbum(db, { id: 'itunes', artistId: 'a1', title: 'Random Access Memories' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', albumId: 'itunes', albumMatchStatus: 'matched' });
    await downloadTrackClip('t1');
    expect(track('t1')).toMatchObject({ album_id: 'itunes', album_match_status: 'matched' });
    expect(db.prepare('SELECT COUNT(*) AS n FROM music_albums').get()).toEqual({ n: 1 });
  });

  it('a finished download queues its track for album matching', () => {
    insertMusicTrack(db, { id: 't1', artistId: 'a1', downloadStatus: 'downloading' });
    markMusicTrackCompleted('t1', null);
    expect(track('t1').download_status).toBe('completed');
    expect(enqueued).toEqual(['t1']);
  });
});
