import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';

// yt-dlp is never run: spawn hands back fake processes and records their arguments.
const spawned: { args: string[]; child: any }[] = [];
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    spawnSync: () => ({ status: 0, stdout: Buffer.from(''), stderr: Buffer.from('') }),
    spawn: (_cmd: string, args: string[]) => {
      const child: any = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = vi.fn();
      spawned.push({ args, child });
      setImmediate(() => child.emit('close', 1));
      return child;
    },
  };
});

import { ingestUrl, videoImportDeps, cleanupPartialFiles, downloadVideoFile } from '../../server/utils/downloader';
import { ingestMusicUrl, musicImportDeps, cleanupPartialMusicFiles, downloadMusicTrackFile } from '../../server/utils/musicDownloader';
import { getDataDir } from '../../server/utils/dataDir';
import { isValidMediaId } from '../../server/utils/videoPaths';
import { assertInTmp, createTestDb, insertChannel, insertMusicArtist } from '../helpers/testDb';

let db: Database.Database;
let dir: string;
const originalVideoDeps = { ...videoImportDeps };
const originalMusicDeps = { ...musicImportDeps };
const ok = (data: any) => ({ stdout: JSON.stringify(data), stderr: '', status: 0 });
const BAD_IDS = ['../../tmp/pwn', 'dQw4w9WgXcQ&/../../tmp/pwn', '', 'a%b', 'a/b', 'x'.repeat(65)];

beforeAll(() => {
  const bin = path.join(getDataDir(), 'bin');
  assertInTmp(bin);
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'yt-dlp'), 'fake');
});

beforeEach(() => {
  db = createTestDb();
  for (const col of ['description TEXT', 'banner_url TEXT', 'download_videos INTEGER DEFAULT 1', 'download_shorts INTEGER DEFAULT 0',
    'download_lives INTEGER DEFAULT 0', 'date_after TEXT']) db.exec(`ALTER TABLE channels ADD COLUMN ${col}`);
  (globalThis as any).getDb = () => db;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yk-ids-'));
  videoImportDeps.startWorker = vi.fn() as any;
  videoImportDeps.syncPlaylists = vi.fn(async () => {}) as any;
  musicImportDeps.startWorker = vi.fn() as any;
  spawned.length = 0;
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  Object.assign(videoImportDeps, originalVideoDeps);
  Object.assign(musicImportDeps, originalMusicDeps);
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

const videoIds = () => (db.prepare('SELECT id FROM videos ORDER BY id').all() as { id: string | null }[]).map((r) => r.id);
const trackIds = () => (db.prepare('SELECT id FROM music_tracks ORDER BY id').all() as { id: string | null }[]).map((r) => r.id);

describe('media ids from yt-dlp are validated at ingest', () => {
  it('isValidMediaId accepts YouTube ids only', () => {
    expect(isValidMediaId('dQw4w9WgXcQ')).toBe(true);
    for (const bad of [...BAD_IDS, null, undefined, 12]) expect(isValidMediaId(bad)).toBe(false);
  });

  it('a channel listing skips entries without a valid id (never a NULL or traversal id row)', async () => {
    videoImportDeps.runYtdl = vi.fn(async () => ok({
      _type: 'playlist', id: 'UCchan', channel_id: 'UCchan', channel: 'Chan',
      entries: [{ _type: 'url', id: 'good1', title: 'Good' }, { _type: 'url', title: 'No id' }, ...BAD_IDS.map((id) => ({ _type: 'url', id, title: 'Bad' }))],
    })) as any;
    const res = await ingestUrl('https://www.youtube.com/channel/UCchan/videos');
    expect(res.success).toBe(true);
    expect(videoIds()).toEqual(['good1']);
  });

  it('a playlist skips invalid entries', async () => {
    videoImportDeps.runYtdl = vi.fn(async () => ok({
      _type: 'playlist', id: 'PL1', title: 'List',
      entries: [{ id: 'good2', channel_id: 'UCx', channel: 'X' }, { channel_id: 'UCx' }, ...BAD_IDS.map((id) => ({ id, channel_id: 'UCx' }))],
    })) as any;
    await ingestUrl('https://www.youtube.com/playlist?list=PL1');
    expect(videoIds()).toEqual(['good2']);
  });

  it('a single video without a valid id is refused', async () => {
    for (const data of [{ title: 'No id' }, { id: '../../tmp/pwn', title: 'Bad' }]) {
      videoImportDeps.runYtdl = vi.fn(async () => ok(data)) as any;
      const res = await ingestUrl('https://www.youtube.com/watch?v=x');
      expect(res.success).toBe(false);
    }
    expect(videoIds()).toEqual([]);
  });

  it('music: a single track with an invalid id is refused, listings skip invalid entries', async () => {
    musicImportDeps.runYtdlJson = vi.fn(async () => ({ id: 'dQw4w9WgXcQ&/../../tmp/pwn', title: 'T', channel_id: 'UCa', channel: 'A' })) as any;
    expect((await ingestMusicUrl('http://h/v/x')).success).toBe(false);
    musicImportDeps.runYtdlJson = vi.fn(async () => ({
      _type: 'playlist', channel_id: 'UCa', channel: 'A', entries: [{ _type: 'url', id: 'goodT' }, { _type: 'url' }, ...BAD_IDS.map((id) => ({ _type: 'url', id }))],
    })) as any;
    await ingestMusicUrl('https://www.youtube.com/playlist?list=PLm');
    expect(trackIds()).toEqual(['goodT']);
  });
});

describe('media ids are validated again before any filesystem use', () => {
  it('cleanupPartialFiles never removes files outside the channel folder for a traversal id', () => {
    insertChannel(db, { id: 'c1', title: 'Chan', customSavePath: path.join(dir, 'base') });
    fs.mkdirSync(path.join(dir, 'base', 'Chan'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'victim.mp4'), 'v');
    fs.writeFileSync(path.join(dir, 'victim.jpg'), 'v');
    cleanupPartialFiles('../../victim', 'c1');
    expect(fs.existsSync(path.join(dir, 'victim.mp4'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'victim.jpg'))).toBe(true);
  });

  it('music cleanup ignores an invalid track id', () => {
    insertMusicArtist(db, { id: 'a1', name: 'Art' });
    const victim = path.join(getDataDir(), 'downloads-music', 'x.opus');
    fs.mkdirSync(path.dirname(victim), { recursive: true });
    fs.writeFileSync(victim, 'v');
    cleanupPartialMusicFiles('../x', 'a1');
    expect(fs.existsSync(victim)).toBe(true);
    fs.rmSync(victim);
  });

  it('downloads with an invalid id fail without starting yt-dlp', async () => {
    insertChannel(db, { id: 'c1', customSavePath: dir });
    insertMusicArtist(db, { id: 'a1', name: 'Art' });
    await expect(downloadVideoFile('../x', 'c1')).rejects.toThrow(/Invalid video id/);
    await expect(downloadMusicTrackFile('a/../b', 'a1')).rejects.toThrow(/Invalid track id/);
    expect(spawned).toEqual([]);
  });

  it('a music output template doubles a literal % from the artist name', async () => {
    insertMusicArtist(db, { id: 'a1', name: '100% Hits' });
    await downloadMusicTrackFile('trk1', 'a1').catch(() => {});
    const args = spawned.find((s) => s.args.includes('-o'))!.args;
    const template = args[args.indexOf('-o') + 1]!;
    expect(template.endsWith(`${path.sep}100%% Hits${path.sep}trk1.%(ext)s`)).toBe(true);
  });
});
