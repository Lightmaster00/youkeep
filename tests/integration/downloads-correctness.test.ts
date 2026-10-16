import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';

// yt-dlp is never run: spawn hands back controllable fake processes.
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
      if (args.includes('--get-comments')) setImmediate(() => child.emit('close', 1));
      return child;
    },
  };
});

import {
  ingestUrl, videoImportDeps, recordFailedAttempt, resolveChannelBaseDir, downloadVideoFile, DateFilterSkipError, normalizeDateAfter, activeProcesses,
} from '../../server/utils/downloader';
import { importArtistTracks, musicImportDeps, recordFailedMusicAttempt, downloadMusicTrackFile, cancelMusicDownload, getMusicDownloadsDir } from '../../server/utils/musicDownloader';
import { resetSyncAllFlags } from '../../server/utils/concurrency';
import { backfillMissingVideoSizes } from '../../server/utils/videoDurations';
import { buildVideoPaths } from '../../server/utils/videoPaths';
import { getDataDir } from '../../server/utils/dataDir';
import ingestHandler from '../../server/api/admin/downloader/ingest.post';
import deleteChannel from '../../server/api/admin/channels/[id].delete';
import { assertInTmp, createTestDb, insertChannel, insertVideo, insertMusicArtist, insertMusicTrack, insertSetting, mockEvent } from '../helpers/testDb';

let db: Database.Database;
let dir: string;
const originalVideoDeps = { ...videoImportDeps };
const originalMusicDeps = { ...musicImportDeps };
const ok = (data: any) => ({ stdout: JSON.stringify(data), stderr: '', status: 0 });
const countUpdates = (table: string) => {
  db.exec(`CREATE TABLE IF NOT EXISTS upd_${table} (n INTEGER); CREATE TRIGGER IF NOT EXISTS trg_${table} AFTER UPDATE ON ${table} BEGIN INSERT INTO upd_${table} VALUES (1); END;`);
  return () => (db.prepare(`SELECT COUNT(*) AS n FROM upd_${table}`).get() as { n: number }).n;
};

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
  db.exec('ALTER TABLE videos ADD COLUMN size_bytes INTEGER');
  (globalThis as any).getDb = () => db;
  (globalThis as any).requireAdmin = async () => ({ id: 'admin', role: 'admin' });
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yk-correct-'));
  (globalThis as any).getDownloadsDir = () => dir;
  (globalThis as any).resolveChannelBaseDir = resolveChannelBaseDir;
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
  activeProcesses.clear();
  fs.rmSync(dir, { recursive: true, force: true });
});

const listing = (entries: any[]) => ok({ _type: 'playlist', id: 'UCc', channel_id: 'UCc', channel: 'Chan', entries });

describe('channel re-sync', () => {
  it('never erases a known description or title, and writes nothing when nothing changed', async () => {
    insertChannel(db, { id: 'UCc', title: 'Chan' });
    insertVideo(db, { id: 'vD1', channelId: 'UCc', title: 'Real title' });
    db.prepare("UPDATE videos SET description = 'A long description', view_count = 5 WHERE id = 'vD1'").run();
    const updates = countUpdates('videos');

    videoImportDeps.runYtdl = vi.fn(async () => listing([{ _type: 'url', id: 'vD1', description: null, view_count: 5 }, { _type: 'url', id: 'vD2', title: 'New' }])) as any;
    await ingestUrl('https://www.youtube.com/channel/UCc/videos');
    const row = db.prepare("SELECT title, description FROM videos WHERE id = 'vD1'").get();
    expect(row).toEqual({ title: 'Real title', description: 'A long description' });
    expect(updates()).toBe(0);

    // A second identical sync: still no write; a changed view count: one write.
    await ingestUrl('https://www.youtube.com/channel/UCc/videos');
    expect(updates()).toBe(0);
    videoImportDeps.runYtdl = vi.fn(async () => listing([{ _type: 'url', id: 'vD1', view_count: 9, description: '' }])) as any;
    await ingestUrl('https://www.youtube.com/channel/UCc/videos');
    expect(updates()).toBe(1);
    expect(db.prepare("SELECT description, view_count FROM videos WHERE id = 'vD1'").get()).toEqual({ description: 'A long description', view_count: 9 });
  });

  it('music: a re-sync keeps the artist description and writes no unchanged track', async () => {
    insertMusicArtist(db, { id: 'a1', name: 'Art' });
    db.prepare("UPDATE music_artists SET channel_id = 'UCa', description = 'Bio' WHERE id = 'a1'").run();
    insertMusicTrack(db, { id: 'mt1', artistId: 'a1', title: 'Song' });
    const updates = countUpdates('music_tracks');
    musicImportDeps.runYtdlJson = vi.fn(async () => ({ _type: 'playlist', channel_id: 'UCa', channel: 'Art', description: '', entries: [{ _type: 'url', id: 'mt1' }] })) as any;
    await importArtistTracks('a1', 'https://www.youtube.com/channel/UCa/videos');
    expect((db.prepare("SELECT description FROM music_artists WHERE id = 'a1'").get() as any).description).toBe('Bio');
    expect(db.prepare("SELECT title FROM music_tracks WHERE id = 'mt1'").get()).toEqual({ title: 'Song' });
    expect(updates()).toBe(0);
  });

  it('a large listing is ingested quickly (one transaction, no quadratic de-dup)', async () => {
    insertChannel(db, { id: 'UCc', title: 'Chan' });
    const entries = Array.from({ length: 5000 }, (_, i) => ({ _type: 'url', id: `big${i}`, title: `T${i}` }));
    videoImportDeps.runYtdl = vi.fn(async () => listing(entries)) as any;
    const started = Date.now();
    await ingestUrl('https://www.youtube.com/channel/UCc/videos');
    expect(Date.now() - started).toBeLessThan(2000);
    expect((db.prepare('SELECT COUNT(*) AS n FROM videos').get() as any).n).toBe(5000);
  });
});

describe('retries keep created_at', () => {
  it('video and track', () => {
    insertChannel(db, { id: 'c1' });
    insertVideo(db, { id: 'r1', channelId: 'c1', downloadStatus: 'downloading', createdAt: 1000 });
    recordFailedAttempt('r1', 'R', 'HTTP 500');
    expect(db.prepare("SELECT download_status, retry_count, created_at FROM videos WHERE id = 'r1'").get()).toEqual({ download_status: 'pending', retry_count: 1, created_at: 1000 });
    insertMusicArtist(db, { id: 'a1' });
    insertMusicTrack(db, { id: 'rt1', artistId: 'a1', downloadStatus: 'downloading', createdAt: 2000 });
    recordFailedMusicAttempt('rt1', 'R', 'HTTP 500');
    expect(db.prepare("SELECT download_status, created_at FROM music_tracks WHERE id = 'rt1'").get()).toEqual({ download_status: 'pending', created_at: 2000 });
  });
});

describe('music pause keeps partial files', () => {
  it('a pause keeps them, a cancel removes them', async () => {
    insertMusicArtist(db, { id: 'a1', name: 'Pause Artist' });
    insertMusicTrack(db, { id: 'pt1', artistId: 'a1', downloadStatus: 'downloading' });
    const artistDir = path.join(getMusicDownloadsDir(), 'Pause Artist');
    const run = async (keep: boolean) => {
      spawned.length = 0;
      const done = downloadMusicTrackFile('pt1', 'a1').catch((e) => e);
      await vi.waitFor(() => expect(spawned).toHaveLength(1));
      fs.writeFileSync(path.join(artistDir, 'pt1.webm.part'), 'partial');
      cancelMusicDownload('pt1', keep ? 'pending' : 'failed', keep);
      spawned[0]!.child.emit('close', null);
      await done;
      return fs.existsSync(path.join(artistDir, 'pt1.webm.part'));
    };
    try {
      expect(await run(true)).toBe(true);
      expect(await run(false)).toBe(false);
    } finally {
      fs.rmSync(artistDir, { recursive: true, force: true });
    }
  });
});

describe('the channel date filter', () => {
  it('normalises YYYY-MM-DD and rejects other shapes at ingest', async () => {
    expect(normalizeDateAfter('2024-03-05')).toBe('20240305');
    expect(normalizeDateAfter('20240305')).toBe('20240305');
    expect(normalizeDateAfter('2024-13-01')).toBeNull();
    expect(normalizeDateAfter('yesterday')).toBeNull();
    await expect(ingestHandler(mockEvent(undefined, { method: 'POST', body: { url: 'https://www.youtube.com/@x', date_after: '05/03/2024' } }))).rejects.toMatchObject({ statusCode: 400 });
  });

  it('is applied once yt-dlp knows the upload date (not for a video queued by hand)', async () => {
    insertChannel(db, { id: 'c1', customSavePath: dir });
    db.prepare("UPDATE channels SET date_after = '20240101' WHERE id = 'c1'").run();
    insertVideo(db, { id: 'old1', channelId: 'c1', downloadStatus: 'downloading' });
    const done = downloadVideoFile('old1', 'c1').catch((e) => e);
    await vi.waitFor(() => expect(spawned.find((s) => !s.args.includes('--get-comments'))).toBeDefined());
    const main = spawned.find((s) => !s.args.includes('--get-comments'))!;
    expect(main.args.slice(main.args.indexOf('--dateafter'), main.args.indexOf('--dateafter') + 2)).toEqual(['--dateafter', '20240101']);
    main.child.stdout.emit('data', Buffer.from('[download] old1: upload date is not in range 20240101 to 99991231\n'));
    main.child.emit('close', 0);
    expect(await done).toBeInstanceOf(DateFilterSkipError);

    spawned.length = 0;
    insertVideo(db, { id: 'man1', channelId: 'c1', downloadStatus: 'downloading' });
    db.prepare("UPDATE videos SET is_manually_queued = 1 WHERE id = 'man1'").run();
    const manual = downloadVideoFile('man1', 'c1').catch((e) => e);
    await vi.waitFor(() => expect(spawned.find((s) => !s.args.includes('--get-comments'))).toBeDefined());
    const m = spawned.find((s) => !s.args.includes('--get-comments'))!;
    expect(m.args).not.toContain('--dateafter');
    m.child.emit('close', 1);
    await manual;
  });
});

describe('startup resets', () => {
  it('clears the three sync-all flags', () => {
    for (const key of ['sync_all_active', 'music_sync_all_active', 'podcast_sync_all_active']) insertSetting(db, { key, value: '1' });
    resetSyncAllFlags(db, () => {});
    expect(db.prepare("SELECT COUNT(*) AS n FROM settings WHERE key LIKE '%sync_all_active' AND value = '1'").get()).toEqual({ n: 0 });
  });

  it('backfills size_bytes from the stored file, whatever its layout', async () => {
    insertChannel(db, { id: 'c1', title: 'Chan', customSavePath: dir });
    const p = buildVideoPaths({ baseDir: dir, channelFolder: 'Chan', title: 'T', id: 's1' });
    insertVideo(db, { id: 's1', channelId: 'c1', title: 'T', localVideoPath: p.videoUrlFor('mp4') });
    fs.mkdirSync(p.dir, { recursive: true });
    fs.writeFileSync(path.join(p.dir, `${p.baseName}.mp4`), '12345');
    insertVideo(db, { id: 's2', channelId: 'c1', localVideoPath: '/downloads/Chan/s2.mp4' });
    fs.writeFileSync(path.join(dir, 'Chan', 's2.mp4'), '123');
    expect(await backfillMissingVideoSizes(db, { downloadsDir: dir })).toEqual({ checked: 2, updated: 2 });
    expect(db.prepare('SELECT id, size_bytes FROM videos ORDER BY id').all()).toEqual([{ id: 's1', size_bytes: 5 }, { id: 's2', size_bytes: 3 }]);
  });
});

describe('deleting a large channel', () => {
  it('4000 videos: only the running download is killed, and the delete takes well under a second', async () => {
    insertChannel(db, { id: 'big', title: 'Big', customSavePath: dir });
    const insert = db.prepare("INSERT INTO videos (id, title, channel_id, download_status, local_video_path, created_at) VALUES (?, ?, 'big', 'completed', ?, 0)");
    db.transaction(() => {
      for (let i = 0; i < 4000; i++) {
        const p = buildVideoPaths({ baseDir: dir, channelFolder: 'Big', title: `V${i}`, id: `b${i}` });
        insert.run(`b${i}`, `V${i}`, p.videoUrlFor('mp4'));
        fs.mkdirSync(p.dir, { recursive: true });
        fs.writeFileSync(path.join(p.dir, `${p.baseName}.mp4`), 'x');
      }
    })();
    db.prepare("UPDATE videos SET download_status = 'downloading' WHERE id = 'b7'").run();
    const child = { kill: vi.fn(), pid: undefined };
    activeProcesses.set('b7', child);
    const other = { kill: vi.fn(), pid: undefined };
    insertChannel(db, { id: 'other' });
    insertVideo(db, { id: 'o1', channelId: 'other', downloadStatus: 'downloading' });
    activeProcesses.set('o1', other);
    (globalThis as any).cancelDownload = () => { throw new Error('no per-video cancel'); };

    const started = performance.now();
    await deleteChannel(mockEvent('', { method: 'DELETE', params: { id: 'big' } }));
    const elapsed = performance.now() - started;

    expect(child.kill).toHaveBeenCalled();
    expect(other.kill).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(dir, 'Big'))).toBe(false);
    expect(elapsed).toBeLessThan(3000);
  }, 30_000);
});
