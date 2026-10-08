import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import ingestHandler from '../../server/api/admin/downloader/ingest.post';
import reimportHandler from '../../server/api/admin/channels/[id]/reimport.post';
import {
  ingestUrl, videoImportDeps, resumeInterruptedChannelImports, CHANNEL_METADATA_TIMEOUT_MS,
} from '../../server/utils/downloader';
import { backgroundImportsIdle } from '../../server/utils/backgroundImports';
import { createTestDb, mockEvent } from '../helpers/testDb';

let db: Database.Database;
const originalDeps = { ...videoImportDeps };
let runYtdl: ReturnType<typeof vi.fn>;
let startWorker: ReturnType<typeof vi.fn>;

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

const ok = (data: any) => ({ stdout: JSON.stringify(data), stderr: '', status: 0 });
const tab = (channelId: string, tabName: 'videos' | 'shorts', ids: string[]) => ok({
  _type: 'playlist',
  id: channelId,
  channel_id: channelId,
  channel: 'Listed Channel',
  title: `Listed Channel - ${tabName === 'videos' ? 'Videos' : 'Shorts'}`,
  webpage_url: `https://www.youtube.com/channel/${channelId}/${tabName}`,
  entries: ids.map((id) => ({ _type: 'url', id, title: `Video ${id}` })),
});

const channel = (id: string) => db.prepare('SELECT * FROM channels WHERE id = ?').get(id) as any;
const videoCount = (id: string) => (db.prepare('SELECT COUNT(*) AS n FROM videos WHERE channel_id = ?').get(id) as any).n;
const flush = () => new Promise((r) => setImmediate(r));

beforeEach(() => {
  db = createTestDb();
  for (const col of ['description TEXT', 'banner_url TEXT', 'download_videos INTEGER DEFAULT 1', 'download_shorts INTEGER DEFAULT 0',
    'download_lives INTEGER DEFAULT 0', 'date_after TEXT']) db.exec(`ALTER TABLE channels ADD COLUMN ${col}`);
  (globalThis as any).getDb = () => db;
  (globalThis as any).requireAdmin = async () => ({ id: 'admin', role: 'admin' });
  runYtdl = vi.fn();
  startWorker = vi.fn();
  videoImportDeps.runYtdl = runYtdl as any;
  videoImportDeps.startWorker = startWorker as any;
  videoImportDeps.syncPlaylists = vi.fn(async () => {}) as any;
});

afterEach(async () => {
  await backgroundImportsIdle();
  Object.assign(videoImportDeps, originalDeps);
});

describe('following a video channel from a search result (hints)', () => {
  it('answers before the listing runs, then lists the tabs in the background', async () => {
    const videos = deferred<any>();
    runYtdl.mockReturnValueOnce(videos.promise);

    const res = await ingestUrl('https://www.youtube.com/channel/UCv', {
      background: true, sync_status: 'downloading', download_videos: 1, download_shorts: 0,
      hints: { channelId: 'UCv', name: 'Hinted', avatarUrl: 'https://img/a.jpg' },
    });

    expect(res).toEqual({ success: true, message: expect.any(String), count: 0, importing: true, channelId: 'UCv' });
    expect(channel('UCv')).toMatchObject({ title: 'Hinted', avatar_url: 'https://img/a.jpg', sync_status: 'downloading', import_status: 'importing' });
    expect(runYtdl).not.toHaveBeenCalled();

    await flush();
    expect(runYtdl).toHaveBeenCalledTimes(1);
    expect(runYtdl.mock.calls[0][0]).toEqual(['--dump-single-json', '--flat-playlist', 'https://www.youtube.com/channel/UCv/videos']);

    videos.resolve(tab('UCv', 'videos', ['v1', 'v2']));
    await backgroundImportsIdle();
    expect(channel('UCv').import_status).toBe('done');
    expect(videoCount('UCv')).toBe(2);
    expect(startWorker).toHaveBeenCalled();
  });

  it('lists the Shorts tab too when chosen, and a Shorts failure does not fail the import', async () => {
    runYtdl.mockResolvedValueOnce(tab('UCs', 'videos', ['v1']));
    runYtdl.mockResolvedValueOnce({ stdout: '', stderr: 'no shorts tab', status: 1 });
    await ingestUrl('https://www.youtube.com/channel/UCs', { background: true, download_shorts: 1, hints: { channelId: 'UCs', name: 'S' } });
    await backgroundImportsIdle();
    expect(runYtdl.mock.calls.map((c) => c[0].at(-1))).toEqual([
      'https://www.youtube.com/channel/UCs/videos', 'https://www.youtube.com/channel/UCs/shorts',
    ]);
    expect(channel('UCs').import_status).toBe('done');
  });

  it('records a failure; the reimport route runs the listing again', async () => {
    runYtdl.mockResolvedValueOnce({ stdout: '', stderr: 'HTTP Error 429', status: 1 });
    await ingestUrl('https://www.youtube.com/channel/UCf', { background: true, hints: { channelId: 'UCf', name: 'F' } });
    await backgroundImportsIdle();
    expect(channel('UCf').import_status).toBe('failed');
    expect(channel('UCf').import_error).toContain('HTTP Error 429');

    runYtdl.mockResolvedValueOnce(tab('UCf', 'videos', ['x']));
    expect(await reimportHandler(mockEvent('', { method: 'POST', params: { id: 'UCf' } }))).toEqual({ success: true, importing: true });
    await backgroundImportsIdle();
    expect(channel('UCf').import_status).toBe('done');
    expect(channel('UCf').import_error).toBeNull();
    expect(videoCount('UCf')).toBe(1);

    await expect(reimportHandler(mockEvent('', { method: 'POST', params: { id: 'nope' } }))).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('following a pasted channel address (no hints)', () => {
  it('does the quick one-entry lookup with a time limit, then lists in the background', async () => {
    runYtdl.mockResolvedValueOnce(tab('UCp', 'videos', ['first']));
    const full = deferred<any>();
    runYtdl.mockReturnValueOnce(full.promise);

    const res = await ingestUrl('https://www.youtube.com/@pasted', { background: true });
    expect(runYtdl.mock.calls[0]).toEqual([
      ['--dump-single-json', '--flat-playlist', '--playlist-end', '1', 'https://www.youtube.com/@pasted'],
      CHANNEL_METADATA_TIMEOUT_MS,
    ]);
    expect(res).toMatchObject({ success: true, importing: true, channelId: 'UCp', count: 0 });
    expect(channel('UCp').import_status).toBe('importing');
    expect(videoCount('UCp')).toBe(0);

    full.resolve(tab('UCp', 'videos', ['first', 'second']));
    await backgroundImportsIdle();
    expect(channel('UCp').import_status).toBe('done');
    expect(videoCount('UCp')).toBe(2);
  });

  it('without background, a channel is still listed synchronously (sync-all path)', async () => {
    runYtdl.mockResolvedValueOnce(tab('UCsync', 'videos', ['a']));
    runYtdl.mockResolvedValueOnce(tab('UCsync', 'videos', ['a', 'b']));
    const res = await ingestUrl('https://www.youtube.com/channel/UCsync', { download_shorts: 0 });
    expect(res).toMatchObject({ success: true, count: 2 });
    expect(res.importing).toBeUndefined();
    expect(channel('UCsync').import_status).toBeNull();
  });
});

describe('restart', () => {
  it('resumes the channel imports a restart interrupted', async () => {
    db.prepare("INSERT INTO channels (id, title, import_status, created_at) VALUES ('UCr', 'R', 'importing', 1), ('UCd', 'D', 'done', 1)").run();
    runYtdl.mockResolvedValue(tab('UCr', 'videos', ['r1']));
    expect(resumeInterruptedChannelImports()).toBe(1);
    await backgroundImportsIdle();
    expect(runYtdl).toHaveBeenCalledTimes(1);
    expect(channel('UCr').import_status).toBe('done');
    expect(videoCount('UCr')).toBe(1);
  });
});

describe('POST /api/admin/downloader/ingest', () => {
  it('follows in the background with the search hints', async () => {
    runYtdl.mockResolvedValue(tab('UCroute', 'videos', []));
    const res: any = await ingestHandler(mockEvent('', {
      method: 'POST',
      body: { url: 'https://www.youtube.com/channel/UCroute', sync_status: 'paused', channelId: 'UCroute', name: 'Route', avatarUrl: 'https://img/r.jpg' },
    }));
    expect(res).toMatchObject({ success: true, importing: true, count: 0 });
    expect(channel('UCroute')).toMatchObject({ title: 'Route', sync_status: 'paused', import_status: 'importing' });
  });
});
