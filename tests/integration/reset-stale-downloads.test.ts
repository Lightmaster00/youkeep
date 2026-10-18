import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type Database from 'better-sqlite3';
import { resetStaleDownloads } from '../../server/utils/downloader';
import { resetStaleMusicDownloads } from '../../server/utils/musicDownloader';
import { resetStalePodcastDownloads } from '../../server/utils/podcastDownloader';
import { assertInTmp, insertChannel, insertVideo, insertMusicArtist, insertMusicTrack, insertPodcastShow, insertPodcastEpisode } from '../helpers/testDb';

// What the scheduler plugin runs at startup: a download a restart interrupted
// ('downloading' with no process behind it any more) goes back to 'pending'
// with its progress cleared; every other status is left alone.
const { openDatabase } = await vi.importActual<typeof import('../../server/utils/db')>('../../server/utils/db');

let db: Database.Database;
let dir: string;

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yk-reset-stale-'));
  assertInTmp(dir);
  db = openDatabase(path.join(dir, 'youkeep.db'));
  (globalThis as any).getDb = () => db;
});
afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

// videos.download_status has a CHECK without 'paused' (videos pause per channel).
const STATUSES = (table: string) => ['downloading', 'pending', 'completed', 'failed', ...(table === 'videos' ? [] : ['paused'])];

describe.each([
  ['videos', resetStaleDownloads, (id: string, status: string) => insertVideo(db, { id, channelId: 'c1', downloadStatus: status })],
  ['music_tracks', resetStaleMusicDownloads, (id: string, status: string) => insertMusicTrack(db, { id, artistId: 'a1', downloadStatus: status })],
  ['podcast_episodes', resetStalePodcastDownloads, (id: string, status: string) => insertPodcastEpisode(db, { id, showId: 's1', downloadStatus: status })],
] as const)('%s', (table, reset, insert) => {
  it("puts interrupted downloads back to 'pending' with no progress, and nothing else", () => {
    insertChannel(db, { id: 'c1' });
    insertMusicArtist(db, { id: 'a1' });
    insertPodcastShow(db, { id: 's1' });
    for (const s of STATUSES(table)) insert(`x${s}`, s);
    db.prepare(`UPDATE ${table} SET download_progress = 42, download_speed = '1MiB/s', download_eta = '00:10'`).run();

    reset();

    const rows = db.prepare(`SELECT id, download_status, download_progress, download_speed, download_eta FROM ${table} ORDER BY id`).all() as any[];
    for (const row of rows) {
      if (row.id === 'xdownloading') {
        expect(row).toEqual({ id: 'xdownloading', download_status: 'pending', download_progress: 0, download_speed: null, download_eta: null });
      } else {
        expect(row.download_status).toBe(row.id.slice(1));
        expect(row.download_progress).toBe(42);
      }
    }
  });
});
