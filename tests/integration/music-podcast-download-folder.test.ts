import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

// yt-dlp is never run: spawn records the arguments and fails the attempt.
const spawned: string[][] = [];
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    spawn: (_cmd: string, args: string[]) => {
      spawned.push(args);
      const child: any = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => {};
      setTimeout(() => child.emit('close', 1), 0);
      return child;
    },
  };
});
vi.mock('../../server/utils/downloader', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/utils/downloader')>();
  return { ...actual, getYtdlPath: async () => '/nonexistent/yt-dlp', isFfmpegAvailable: () => true };
});

import { cleanupPartialMusicFiles, deleteMusicArtist, downloadTrackClip, getMusicDownloadsDir } from '../../server/utils/musicDownloader';
import { cleanupPartialPodcastFiles, deletePodcastShow, downloadEpisodeFile, getPodcastDownloadsDir } from '../../server/utils/podcastDownloader';
import { isContained } from '../../server/utils/videoPaths';
import musicFileRoute from '../../server/routes/downloads-music/[...path]';
import podcastFileRoute from '../../server/routes/downloads-podcasts/[...path]';
import { assertInTmp, createTestDb, insertMusicArtist, insertMusicTrack, insertPodcastEpisode, insertPodcastShow, mockEvent } from '../helpers/testDb';

let db: Database.Database;
let musicBase: string;
let podcastBase: string;

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
  (globalThis as any).getMusicDownloadsDir = getMusicDownloadsDir;
  (globalThis as any).getPodcastDownloadsDir = getPodcastDownloadsDir;
  (globalThis as any).canAccessMusicTrack = async () => true;
  (globalThis as any).canAccessPodcastEpisode = async () => true;
  spawned.length = 0;
  musicBase = getMusicDownloadsDir();
  podcastBase = getPodcastDownloadsDir();
  assertInTmp(musicBase);
  assertInTmp(podcastBase);
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const base of [musicBase, podcastBase]) {
    for (const entry of fs.readdirSync(base)) fs.rmSync(path.join(base, entry), { recursive: true, force: true });
  }
});

const DEGENERATE = ['..', '.', '', '   ', ' .. '];

describe('music: an artist with a degenerate name downloads into <base>/<artist id>', () => {
  for (const name of DEGENERATE) {
    it(`artist named ${JSON.stringify(name)}`, async () => {
      insertMusicArtist(db, { id: 'a1', name });
      insertMusicTrack(db, { id: 't1', artistId: 'a1', downloadStatus: 'completed' });

      await expect(downloadTrackClip('t1')).rejects.toThrow();
      const template = spawned[0]![spawned[0]!.indexOf('-o') + 1]!;
      expect(isContained(musicBase, template)).toBe(true);
      expect(path.dirname(template)).toBe(path.join(musicBase, 'a1'));

      // Partial-file cleanup and delete find that same folder.
      fs.writeFileSync(path.join(musicBase, 'a1', 't1.opus.part'), 'x');
      cleanupPartialMusicFiles('t1', 'a1');
      expect(fs.existsSync(path.join(musicBase, 'a1', 't1.opus.part'))).toBe(false);
      fs.writeFileSync(path.join(musicBase, 'a1', 't1.opus'), 'x');
      deleteMusicArtist('a1');
      expect(fs.existsSync(path.join(musicBase, 'a1'))).toBe(false);
    });
  }

  it('a valid name keeps its folder name (separators replaced as before)', async () => {
    insertMusicArtist(db, { id: 'a2', name: 'AC/DC' });
    insertMusicTrack(db, { id: 't2', artistId: 'a2', downloadStatus: 'completed' });
    await expect(downloadTrackClip('t2')).rejects.toThrow();
    const template = spawned[0]![spawned[0]!.indexOf('-o') + 1]!;
    expect(path.dirname(template)).toBe(path.join(musicBase, 'AC_DC'));
  });
});

describe('podcasts: a show with a degenerate title downloads into <base>/<show id>', () => {
  for (const title of DEGENERATE) {
    it(`show titled ${JSON.stringify(title)}`, async () => {
      insertPodcastShow(db, { id: 's1', title });
      insertPodcastEpisode(db, { id: 'e1', showId: 's1', downloadStatus: 'downloading' });
      vi.stubGlobal('fetch', async () => new Response('audio-bytes', { headers: { 'content-type': 'audio/mpeg' } }));

      await downloadEpisodeFile('e1', 's1');
      const file = path.join(podcastBase, 's1', 'e1.mp3');
      expect(fs.readFileSync(file, 'utf8')).toBe('audio-bytes');
      expect((db.prepare('SELECT local_file_path FROM podcast_episodes WHERE id = ?').get('e1') as any).local_file_path)
        .toBe('/downloads-podcasts/s1/e1.mp3');

      fs.writeFileSync(path.join(podcastBase, 's1', 'e1.mp3.part'), 'x');
      cleanupPartialPodcastFiles('e1', 's1');
      expect(fs.existsSync(path.join(podcastBase, 's1', 'e1.mp3.part'))).toBe(false);
      deletePodcastShow('s1');
      expect(fs.existsSync(path.join(podcastBase, 's1'))).toBe(false);
    });
  }
});

describe('the file routes serve a degenerate-name entity from <base>/<id>', () => {
  const serve = async (route: any, urlPath: string) => {
    const result: any = await route(mockEvent(undefined, { params: { path: urlPath } }));
    const chunks: Buffer[] = [];
    for await (const chunk of result) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString('utf8');
  };

  it('music track of an artist named ".."', async () => {
    insertMusicArtist(db, { id: 'a1', name: '..' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', downloadStatus: 'completed', localFilePath: '/downloads-music/a1/t1.opus' });
    fs.mkdirSync(path.join(musicBase, 'a1'));
    fs.writeFileSync(path.join(musicBase, 'a1', 't1.opus'), 'music');
    expect(await serve(musicFileRoute, 'a1/t1.opus')).toBe('music');
  });

  it('podcast episode of a show titled "."', async () => {
    insertPodcastShow(db, { id: 's1', title: '.' });
    insertPodcastEpisode(db, { id: 'e1', showId: 's1', downloadStatus: 'completed', localFilePath: '/downloads-podcasts/s1/e1.mp3' });
    fs.mkdirSync(path.join(podcastBase, 's1'));
    fs.writeFileSync(path.join(podcastBase, 's1', 'e1.mp3'), 'podcast');
    expect(await serve(podcastFileRoute, 's1/e1.mp3')).toBe('podcast');
  });
});
