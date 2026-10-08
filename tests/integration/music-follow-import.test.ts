import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import ingestHandler from '../../server/api/admin/music/ingest.post';
import reimportHandler from '../../server/api/admin/music/artists/[id]/reimport.post';
import {
  ingestMusicUrl, musicImportDeps, resumeInterruptedArtistImports,
} from '../../server/utils/musicDownloader';
import { CHANNEL_METADATA_TIMEOUT_MS } from '../../server/utils/downloader';
import { backgroundImportsIdle, runningImportCount, MAX_CONCURRENT_IMPORTS } from '../../server/utils/backgroundImports';
import { createTestDb, mockEvent } from '../helpers/testDb';

let db: Database.Database;
const originalDeps = { ...musicImportDeps };
let runYtdl: ReturnType<typeof vi.fn>;
let startWorker: ReturnType<typeof vi.fn>;

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: any) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const listing = (channelId: string, ids: string[], extra: Record<string, unknown> = {}) => ({
  _type: 'playlist',
  channel_id: channelId,
  channel: 'Listed Name',
  description: 'About the artist',
  thumbnails: [{ id: 'avatar_uncropped', url: 'https://img/avatar.jpg' }, { id: 'banner_uncropped', url: 'https://img/banner.jpg' }],
  entries: ids.map((id) => ({ _type: 'url', id, title: `Song ${id}`, duration: 200 })),
  ...extra,
});

const artist = (channelId: string) => db.prepare('SELECT * FROM music_artists WHERE channel_id = ?').get(channelId) as any;
const trackCount = (artistId: string) => (db.prepare('SELECT COUNT(*) AS n FROM music_tracks WHERE artist_id = ?').get(artistId) as any).n;
const flush = () => new Promise((r) => setImmediate(r));

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
  (globalThis as any).requireAdmin = async () => ({ id: 'admin', role: 'admin' });
  runYtdl = vi.fn();
  startWorker = vi.fn();
  musicImportDeps.runYtdlJson = runYtdl as any;
  musicImportDeps.startWorker = startWorker as any;
});

afterEach(async () => {
  await backgroundImportsIdle();
  Object.assign(musicImportDeps, originalDeps);
});

describe('following an artist from a search result (hints)', () => {
  it('answers before the listing runs, then imports the tracks in the background and starts the worker', async () => {
    const pending = deferred<any>();
    runYtdl.mockReturnValue(pending.promise);

    const result = await ingestMusicUrl('https://www.youtube.com/@artist', {
      sync_status: 'downloading',
      hints: { channelId: 'UCabc', name: 'Hinted Name', avatarUrl: 'https://img/hint.jpg' },
    });

    const row = artist('UCabc');
    expect(result).toEqual({ success: true, message: expect.any(String), count: 0, importing: true, artistId: row.id });
    expect(row).toMatchObject({ name: 'Hinted Name', avatar_url: 'https://img/hint.jpg', sync_status: 'downloading', visibility: 'public', import_status: 'importing' });
    expect(trackCount(row.id)).toBe(0);
    // The listing has not even started when the follow answers.
    expect(runYtdl).not.toHaveBeenCalled();

    await flush();
    expect(runYtdl).toHaveBeenCalledTimes(1);
    expect(runYtdl.mock.calls[0][0]).toEqual(['--dump-single-json', '--flat-playlist', 'https://www.youtube.com/channel/UCabc/videos']);
    expect(artist('UCabc').import_status).toBe('importing');
    expect(startWorker).not.toHaveBeenCalled();

    pending.resolve(listing('UCabc', ['t1', 't2', 't2', 't3']));
    await backgroundImportsIdle();

    const after = artist('UCabc');
    expect(after.import_status).toBe('done');
    expect(after.import_error).toBeNull();
    expect(after.description).toBe('About the artist');
    expect(after.banner_url).toBe('https://img/banner.jpg');
    expect(trackCount(after.id)).toBe(3);
    expect(startWorker).toHaveBeenCalledTimes(1);
  });

  it('does not start the worker for a paused artist', async () => {
    runYtdl.mockResolvedValue(listing('UCp', ['t1']));
    await ingestMusicUrl('https://www.youtube.com/@p', { sync_status: 'paused', hints: { channelId: 'UCp', name: 'P' } });
    await backgroundImportsIdle();
    expect(artist('UCp').import_status).toBe('done');
    expect(startWorker).not.toHaveBeenCalled();
  });

  it('keeps an existing artist and its settings when no value is given', async () => {
    db.prepare("INSERT INTO music_artists (id, channel_id, name, sync_status, visibility, created_at) VALUES ('a1', 'UCx', 'Old', 'downloading', 'private', 1)").run();
    runYtdl.mockResolvedValue(listing('UCx', []));
    const result = await ingestMusicUrl('https://www.youtube.com/@x', { hints: { channelId: 'UCx', name: 'New' } });
    expect(result.artistId).toBe('a1');
    expect(artist('UCx')).toMatchObject({ id: 'a1', name: 'New', sync_status: 'downloading', visibility: 'private', import_status: 'importing' });
  });

  it('records a failure, and the reimport route runs the listing again', async () => {
    runYtdl.mockRejectedValueOnce(new Error('yt-dlp metadata fetch failed: HTTP 429'));
    await ingestMusicUrl('https://www.youtube.com/@f', { sync_status: 'downloading', hints: { channelId: 'UCf', name: 'F' } });
    await backgroundImportsIdle();

    const failed = artist('UCf');
    expect(failed.import_status).toBe('failed');
    expect(failed.import_error).toContain('HTTP 429');
    expect(trackCount(failed.id)).toBe(0);

    runYtdl.mockResolvedValueOnce(listing('UCf', ['t9']));
    const res = await reimportHandler(mockEvent('', { method: 'POST', params: { id: failed.id } }));
    expect(res).toEqual({ success: true, importing: true });
    expect(artist('UCf').import_status).toBe('importing');
    expect(artist('UCf').import_error).toBeNull();
    await backgroundImportsIdle();
    expect(artist('UCf').import_status).toBe('done');
    expect(trackCount(failed.id)).toBe(1);
  });

  it('reimport answers 404 for an unknown artist and 400 for one without a channel', async () => {
    await expect(reimportHandler(mockEvent('', { method: 'POST', params: { id: 'nope' } }))).rejects.toMatchObject({ statusCode: 404 });
    db.prepare("INSERT INTO music_artists (id, name, created_at) VALUES ('feat', 'Feat', 1)").run();
    await expect(reimportHandler(mockEvent('', { method: 'POST', params: { id: 'feat' } }))).rejects.toMatchObject({ statusCode: 400 });
    expect(runYtdl).not.toHaveBeenCalled();
  });

  it('never runs more than two listings at once', async () => {
    expect(MAX_CONCURRENT_IMPORTS).toBe(2);
    const pendings = [deferred<any>(), deferred<any>(), deferred<any>()];
    let call = 0;
    runYtdl.mockImplementation(() => pendings[call++].promise);

    for (const id of ['UC1', 'UC2', 'UC3']) {
      await ingestMusicUrl(`https://www.youtube.com/channel/${id}`, { hints: { channelId: id, name: id } });
    }
    await flush();
    await flush();
    expect(runYtdl).toHaveBeenCalledTimes(2);
    expect(runningImportCount()).toBe(2);

    pendings[0].resolve(listing('UC1', ['a']));
    await flush();
    await flush();
    expect(runYtdl).toHaveBeenCalledTimes(3);
    expect(runningImportCount()).toBe(2);

    pendings[1].resolve(listing('UC2', ['b']));
    pendings[2].resolve(listing('UC3', ['c']));
    await backgroundImportsIdle();
    expect(['UC1', 'UC2', 'UC3'].map((id) => artist(id).import_status)).toEqual(['done', 'done', 'done']);
  });

  it('ignores hints without a usable channel id and falls back to the URL', async () => {
    runYtdl.mockResolvedValueOnce(listing('UCreal', ['t1']));
    runYtdl.mockResolvedValueOnce(listing('UCreal', ['t1']));
    await ingestMusicUrl('https://www.youtube.com/@real', { hints: { channelId: '../../x', name: 'Bad' } });
    expect(runYtdl.mock.calls[0][0]).toContain('--playlist-end');
    await backgroundImportsIdle();
    expect(artist('UCreal').name).toBe('Listed Name');
  });
});

describe('following a pasted channel address (no hints)', () => {
  it('looks up the channel with a one-entry listing and a time limit, then imports in the background', async () => {
    const full = deferred<any>();
    runYtdl.mockResolvedValueOnce(listing('UCpasted', ['first']));
    runYtdl.mockReturnValueOnce(full.promise);

    const result = await ingestMusicUrl('https://www.youtube.com/@pasted/', { sync_status: 'downloading' });

    expect(runYtdl).toHaveBeenCalledTimes(1);
    expect(runYtdl.mock.calls[0]).toEqual([
      ['--dump-single-json', '--flat-playlist', '--playlist-end', '1', 'https://www.youtube.com/@pasted/videos'],
      CHANNEL_METADATA_TIMEOUT_MS,
    ]);
    expect(CHANNEL_METADATA_TIMEOUT_MS).toBe(20_000);
    const row = artist('UCpasted');
    expect(result).toMatchObject({ success: true, count: 0, importing: true, artistId: row.id });
    expect(row).toMatchObject({ name: 'Listed Name', avatar_url: 'https://img/avatar.jpg', import_status: 'importing' });
    expect(trackCount(row.id)).toBe(0);

    await flush();
    expect(runYtdl.mock.calls[1][0]).toEqual(['--dump-single-json', '--flat-playlist', 'https://www.youtube.com/channel/UCpasted/videos']);
    full.resolve(listing('UCpasted', ['first', 'second']));
    await backgroundImportsIdle();
    expect(artist('UCpasted').import_status).toBe('done');
    expect(trackCount(row.id)).toBe(2);
  });

  it('fails without creating anything when the lookup fails', async () => {
    runYtdl.mockRejectedValueOnce(new Error('yt-dlp execution error: Timed out after 20 s'));
    const result = await ingestMusicUrl('https://www.youtube.com/@slow');
    expect(result).toEqual({ success: false, message: 'yt-dlp execution error: Timed out after 20 s', count: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM music_artists').get()).toEqual({ n: 0 });
  });
});

describe('single videos and playlists stay synchronous', () => {
  it('imports a single video at once, without a background import', async () => {
    runYtdl.mockResolvedValueOnce({ id: 'vid1', title: 'One song', channel_id: 'UCs', channel: 'Solo' });
    const result = await ingestMusicUrl('https://www.youtube.com/watch?v=vid1', { sync_status: 'downloading' });
    expect(result).toEqual({ success: true, message: 'Track "One song" ingested.', count: 1 });
    expect(runYtdl).toHaveBeenCalledTimes(1);
    expect(runningImportCount()).toBe(0);
    expect(artist('UCs').import_status).toBeNull();
    expect(trackCount(artist('UCs').id)).toBe(1);
    expect(startWorker).toHaveBeenCalledTimes(1);
  });

  it('imports a playlist at once', async () => {
    runYtdl.mockResolvedValueOnce(listing('UCpl', ['p1', 'p2']));
    const result = await ingestMusicUrl('https://www.youtube.com/playlist?list=PL1');
    expect(result).toMatchObject({ success: true, count: 2 });
    expect(result.importing).toBeUndefined();
    expect(trackCount(artist('UCpl').id)).toBe(2);
    expect(artist('UCpl').import_status).toBeNull();
  });
});

describe('restart', () => {
  it('resumes the imports a restart interrupted', async () => {
    db.prepare("INSERT INTO music_artists (id, channel_id, name, sync_status, import_status, created_at) VALUES ('r1', 'UCr', 'R', 'downloading', 'importing', 1)").run();
    db.prepare("INSERT INTO music_artists (id, channel_id, name, import_status, created_at) VALUES ('d1', 'UCd', 'D', 'done', 1)").run();
    db.prepare("INSERT INTO music_artists (id, channel_id, name, import_status, created_at) VALUES ('f1', 'UCff', 'F', 'failed', 1)").run();
    runYtdl.mockResolvedValue(listing('UCr', ['x', 'y']));

    expect(resumeInterruptedArtistImports()).toBe(1);
    await backgroundImportsIdle();

    expect(runYtdl).toHaveBeenCalledTimes(1);
    expect(runYtdl.mock.calls[0][0]).toContain('https://www.youtube.com/channel/UCr/videos');
    expect(artist('UCr').import_status).toBe('done');
    expect(trackCount('r1')).toBe(2);
    expect(startWorker).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/admin/music/ingest', () => {
  it('passes the search hints through and answers with importing', async () => {
    runYtdl.mockResolvedValue(listing('UCroute', []));
    const res: any = await ingestHandler(mockEvent('', {
      method: 'POST',
      body: { url: 'https://www.youtube.com/@route', sync_status: 'paused', channelId: 'UCroute', name: 'Route', avatarUrl: 'https://img/r.jpg' },
    }));
    expect(res).toMatchObject({ success: true, importing: true, count: 0 });
    expect(artist('UCroute')).toMatchObject({ name: 'Route', avatar_url: 'https://img/r.jpg', sync_status: 'paused' });
  });

  it('still works with only a url', async () => {
    runYtdl.mockResolvedValueOnce({ id: 'v', title: 'T', channel_id: 'UCu', channel: 'U' });
    const res: any = await ingestHandler(mockEvent('', { method: 'POST', body: { url: 'https://www.youtube.com/watch?v=v' } }));
    expect(res).toMatchObject({ success: true, count: 1 });
  });
});
