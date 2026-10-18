import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type Database from 'better-sqlite3';
import * as auth from '../../server/utils/auth';
import { createApiToken } from '../../server/utils/apiTokens';
import { startLibraryWipe, isWipeInProgress, getWipeReport, getWipeProgress } from '../../server/utils/libraryWipe';
import { getDownloadsDir, resolveChannelBaseDir, sanitizeFolderName } from '../../server/utils/downloader';
import { getMusicDownloadsDir } from '../../server/utils/musicDownloader';
import { getPodcastDownloadsDir } from '../../server/utils/podcastDownloader';
import { buildVideoPaths } from '../../server/utils/videoPaths';
import {
  assertInTmp, insertChannel, insertVideo, insertMusicArtist, insertMusicTrack, insertPodcastShow, insertPodcastEpisode,
  mockEvent, sessionCookie,
} from '../helpers/testDb';
import wipeAll from '../../server/api/admin/system/wipe-all.post';
import wipeStatus from '../../server/api/admin/system/wipe-status.get';

// The library wipe end to end: the route starts it, the loop removes every
// channel, artist and show from the database and from disk, and the report
// lists them. Nothing outside the seeded folders is touched.
const { openDatabase } = await vi.importActual<typeof import('../../server/utils/db')>('../../server/utils/db');

let dir: string;
let db: Database.Database;
const cleanup: string[] = [];

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yk-wipe-run-'));
  assertInTmp(dir);
  db = openDatabase(path.join(dir, 'youkeep.db'));
  Object.assign(globalThis as any, auth, {
    getDb: () => db, startLibraryWipe, getWipeReport, getWipeProgress, isWipeInProgress, getDownloadsDir, resolveChannelBaseDir, sanitizeFolderName,
  });
  const now = Date.now();
  for (const [id, role] of [['admin', 'admin'], ['bob', 'user']]) {
    db.prepare('INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)').run(id, id, 'x', role, now);
    db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').run(`sess-${id}`, id, now + 3_600_000);
  }
});
afterEach(async () => {
  await waitForWipe();
  db.close();
  for (const p of cleanup.splice(0)) fs.rmSync(p, { recursive: true, force: true });
  fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

async function waitForWipe() {
  for (let i = 0; i < 400 && isWipeInProgress(); i++) await new Promise((r) => setTimeout(r, 5));
  expect(isWipeInProgress()).toBe(false);
}

const status = async (p: Promise<any>) => { try { await p; return 200; } catch (e: any) { return e?.statusCode ?? 500; } };
const as = (who: 'admin' | 'bob') => mockEvent(sessionCookie(`sess-${who}`), { method: 'POST' });

function write(file: string, body = 'x') {
  assertInTmp(file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
}

/** One channel with a downloaded video, one artist with a track, one show with an episode, all on disk. */
function seedLibrary() {
  const videoBase = path.join(dir, 'videos');
  insertChannel(db, { id: 'c1', title: 'Chan', customSavePath: videoBase });
  const p = buildVideoPaths({ baseDir: videoBase, channelFolder: 'Chan', title: 'Clip', id: 'v1' });
  insertVideo(db, { id: 'v1', channelId: 'c1', title: 'Clip', localVideoPath: p.videoUrlFor('mp4'), localThumbnailPath: null });
  write(path.join(p.dir, `${p.baseName}.mp4`));

  const musicDir = path.join(getMusicDownloadsDir(), 'Wipe Artist');
  cleanup.push(musicDir);
  insertMusicArtist(db, { id: 'a1', name: 'Wipe Artist' });
  insertMusicTrack(db, { id: 'trk1', artistId: 'a1', localFilePath: '/downloads-music/Wipe%20Artist/trk1.opus' });
  write(path.join(musicDir, 'trk1.opus'));

  const showDir = path.join(getPodcastDownloadsDir(), 'Wipe Show');
  cleanup.push(showDir);
  insertPodcastShow(db, { id: 's1', title: 'Wipe Show' });
  insertPodcastEpisode(db, { id: 'ep1', showId: 's1', localFilePath: '/downloads-podcasts/Wipe%20Show/ep1.mp3' });
  write(path.join(showDir, 'ep1.mp3'));

  // Not YouKeep's: must survive the wipe.
  write(path.join(videoBase, 'notes.txt'), 'keep');
  return { channelDir: path.join(videoBase, 'Chan'), musicDir, showDir, keep: path.join(videoBase, 'notes.txt') };
}

const count = (table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

describe('library wipe', () => {
  it('removes every channel, artist and show from the database and disk, and reports them', async () => {
    const seeded = seedLibrary();
    expect(await wipeAll(as('admin'))).toEqual({ started: true });
    await waitForWipe();

    for (const table of ['channels', 'videos', 'music_artists', 'music_tracks', 'podcast_shows', 'podcast_episodes']) expect(count(table)).toBe(0);
    expect(fs.existsSync(seeded.channelDir)).toBe(false);
    expect(fs.existsSync(seeded.musicDir)).toBe(false);
    expect(fs.existsSync(seeded.showDir)).toBe(false);
    expect(fs.readFileSync(seeded.keep, 'utf8')).toBe('keep');

    const report = getWipeReport()!;
    expect(report.failed).toEqual([]);
    expect(report.succeeded).toEqual([
      { type: 'channel', id: 'c1', name: 'Chan' },
      { type: 'artist', id: 'a1', name: 'Wipe Artist' },
      { type: 'show', id: 's1', name: 'Wipe Show' },
    ]);
    expect(getWipeProgress()).toBeNull();
    // Users and their sessions are not part of the library.
    expect(count('users')).toBe(2);
  });

  it('reports progress while it runs, and a second start meanwhile is a 409', async () => {
    seedLibrary();
    expect(await wipeAll(as('admin'))).toEqual({ started: true });
    expect(isWipeInProgress()).toBe(true);
    expect(getWipeProgress()).toMatchObject({ type: 'channel', name: 'Chan', index: 1, total: 3 });
    await expect(wipeAll(as('admin'))).rejects.toMatchObject({ statusCode: 409 });
    await waitForWipe();
    // Once finished, a new wipe may start again.
    expect(await wipeAll(as('admin'))).toEqual({ started: true });
  });

  it('a member (403), a guest (401) and an admin API token (403) start nothing', async () => {
    seedLibrary();
    const token = createApiToken('admin', 'script').token;
    expect(await status(wipeAll(as('bob')))).toBe(403);
    expect(await status(wipeAll(mockEvent(undefined, { method: 'POST' })))).toBe(401);
    expect(await status(wipeAll(mockEvent(undefined, { method: 'POST', headers: { authorization: `Bearer ${token}` } })))).toBe(403);
    expect(isWipeInProgress()).toBe(false);
    expect(count('channels')).toBe(1);
    expect(count('music_artists')).toBe(1);
    expect(count('podcast_shows')).toBe(1);
  });

  it('the status route is admin-only and returns the report', async () => {
    seedLibrary();
    await wipeAll(as('admin'));
    await waitForWipe();
    expect(await status(wipeStatus(mockEvent(sessionCookie('sess-bob'))))).toBe(403);
    const r: any = await wipeStatus(mockEvent(sessionCookie('sess-admin')));
    expect(r).toMatchObject({ inProgress: false });
    expect(JSON.stringify(r)).toContain('Wipe Show');
  });
});
