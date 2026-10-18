import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';

// Some containment checks sit behind another layer that already keeps paths
// inside their base (folder-name sanitising, path builders). Those checks
// only matter if that layer regresses, so these tests make it regress on
// purpose, for one marked input, and assert the outer check still holds.
const EVIL = 'EVIL-NAME';
vi.mock('../../server/utils/videoPaths', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/utils/videoPaths')>();
  return {
    ...actual,
    // A sanitiser regression: this name maps to the parent folder.
    entityFolderName: (name: string | null | undefined, id: string) => (name === EVIL ? '..' : actual.entityFolderName(name, id)),
    // A path-builder regression: the video `esc1` is placed next to the base.
    buildVideoPaths: (opts: Parameters<typeof actual.buildVideoPaths>[0]) => {
      const built = actual.buildVideoPaths(opts);
      return opts.id === 'esc1' ? { ...built, dir: path.join(opts.baseDir, '..', 'Escaped [esc1]') } : built;
    },
    // A candidate-folder regression: the folder `X [esc2]` resolves next to the base.
    candidateVideoDirs: (baseDir: string, channelFolder: string, videoFolder: string) =>
      (videoFolder.endsWith('[esc2]') ? [path.resolve(baseDir, '..', videoFolder)] : actual.candidateVideoDirs(baseDir, channelFolder, videoFolder)),
  };
});

import { cleanupPartialMusicFiles, getMusicDownloadsDir } from '../../server/utils/musicDownloader';
import { cleanupPartialPodcastFiles, getPodcastDownloadsDir } from '../../server/utils/podcastDownloader';
import { planTidy } from '../../server/utils/videoTidy';
import { sanitizeFolderName } from '../../server/utils/downloader';
import { canAccessVideo, canAccessMusicTrack } from '../../server/utils/auth';
import downloadsRoute from '../../server/routes/downloads/[...path]';
import musicRoute from '../../server/routes/downloads-music/[...path]';
import { assertInTmp, createTestDb, insertChannel, insertVideo, insertMusicArtist, insertMusicTrack, insertPodcastShow, insertPodcastEpisode, mockEvent } from '../helpers/testDb';

let db: Database.Database;
let dir: string;
const planted: string[] = [];

beforeEach(() => {
  db = createTestDb();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yk-defence-'));
  assertInTmp(dir);
  Object.assign(globalThis as any, {
    getDb: () => db, getDownloadsDir: () => path.join(dir, 'downloads'), sanitizeFolderName, canAccessVideo, canAccessMusicTrack,
    getMusicDownloadsDir, getQuery: () => ({}),
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(async () => {
  await new Promise((r) => setImmediate(r));
  for (const f of planted.splice(0)) fs.rmSync(f, { recursive: true, force: true });
  fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function plant(file: string) {
  assertInTmp(file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'victim');
  planted.push(file);
  return file;
}

async function status(handler: (e: any) => any, param: string): Promise<number> {
  const event = mockEvent(undefined, { params: { path: param } });
  try {
    const r: any = await handler(event);
    r?.on?.('error', () => {});
    r?.destroy?.();
    return event.node.res.statusCode;
  } catch (e: any) {
    return e.statusCode;
  }
}

describe('partial cleanup stays inside the music / podcast base', () => {
  it('music: an artist folder resolving to the parent of the base is never listed', () => {
    insertMusicArtist(db, { id: 'a1', name: EVIL });
    const base = getMusicDownloadsDir();
    fs.mkdirSync(base, { recursive: true });
    const victim = plant(path.join(base, '..', 'trk1.opus'));
    cleanupPartialMusicFiles('trk1', 'a1');
    expect(fs.existsSync(victim)).toBe(true);
  });

  it('podcasts: a show folder resolving to the parent of the base is never listed', () => {
    insertPodcastShow(db, { id: 's1', title: EVIL });
    const base = getPodcastDownloadsDir();
    fs.mkdirSync(base, { recursive: true });
    const victim = plant(path.join(base, '..', 'ep1.mp3'));
    cleanupPartialPodcastFiles('ep1', 's1');
    expect(fs.existsSync(victim)).toBe(true);
  });
});

describe('tidy never plans a move outside its write base', () => {
  it('an unfinished download whose target folder escapes the base is left alone', () => {
    const downloads = path.join(dir, 'downloads');
    insertChannel(db, { id: 'c1', title: 'Chan' });
    insertVideo(db, { id: 'esc1', channelId: 'c1', title: 'T', downloadStatus: 'pending', localVideoPath: null, localThumbnailPath: null });
    plant(path.join(downloads, 'Chan', 'esc1.f137.mp4.part'));
    const plan = planTidy(db, { downloadsDir: downloads });
    expect(plan.items.map((i) => i.id)).not.toContain('esc1');
  });
});

describe('file routes never serve outside their base', () => {
  it('/downloads (one folder per video): a candidate folder outside the base is a 404', async () => {
    const base = path.join(dir, 'downloads');
    insertChannel(db, { id: 'c1', title: 'Chan' });
    insertVideo(db, { id: 'esc2', channelId: 'c1', localVideoPath: '/downloads/Chan/X%20%5Besc2%5D/X%20%5Besc2%5D.mp4', localThumbnailPath: null });
    plant(path.join(base, '..', 'X [esc2]', 'X [esc2].mp4'));
    expect(await status(downloadsRoute, 'Chan/X%20%5Besc2%5D/X%20%5Besc2%5D.mp4')).toBe(404);
  });

  it('/downloads-music: an artist folder resolving outside the music base is a 404', async () => {
    insertMusicArtist(db, { id: 'a1', name: EVIL });
    insertMusicTrack(db, { id: 'trk1', artistId: 'a1', downloadStatus: 'completed' });
    const base = getMusicDownloadsDir();
    fs.mkdirSync(base, { recursive: true });
    plant(path.join(base, '..', 'trk1.opus'));
    expect(await status(musicRoute, 'x/trk1.opus')).toBe(404);
  });

  it('/downloads-music: the same track in its artist folder is served (control)', async () => {
    insertMusicArtist(db, { id: 'a2', name: 'Fine' });
    insertMusicTrack(db, { id: 'trk2', artistId: 'a2', downloadStatus: 'completed' });
    plant(path.join(getMusicDownloadsDir(), 'Fine', 'trk2.opus'));
    expect(await status(musicRoute, 'Fine/trk2.opus')).toBe(200);
  });
});
