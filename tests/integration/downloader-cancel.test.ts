import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import cancelHandler from '../../server/api/admin/downloader/cancel.post';
import { activeProcesses, cancelDownload, recordFailedAttempt } from '../../server/utils/downloader';
import { buildVideoPaths } from '../../server/utils/videoPaths';
import { createTestDb, insertChannel, insertVideo, mockEvent } from '../helpers/testDb';

let db: Database.Database;
let dir: string;

beforeEach(() => {
  db = createTestDb();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yk-cancel-'));
  (globalThis as any).getDb = () => db;
  (globalThis as any).requireAdmin = async () => ({ id: 'admin', role: 'admin' });
  (globalThis as any).cancelDownload = cancelDownload;
  insertChannel(db, { id: 'c1', title: 'Chan', customSavePath: dir });
  db.prepare("UPDATE channels SET sync_status = 'downloading'").run();
});
afterEach(() => {
  activeProcesses.clear();
  fs.rmSync(dir, { recursive: true, force: true });
});

const row = (id: string) => db.prepare('SELECT download_status, last_error, retry_count, is_manually_queued FROM videos WHERE id = ?').get(id) as any;
const cancel = (videoId: string) => cancelHandler(mockEvent(undefined, { method: 'POST', body: { videoId } }));
// What the queue worker picks next (same condition as startQueueWorker).
const pickable = () => (db.prepare(`
  SELECT v.id FROM videos v JOIN channels c ON v.channel_id = c.id
  WHERE v.download_status = 'pending' AND (c.sync_status = 'downloading' OR v.is_manually_queued = 1)
`).all() as { id: string }[]).map((r) => r.id);

describe('POST /api/admin/downloader/cancel', () => {
  it('a running download stays cancelled after its process exits: the worker does not restart it', async () => {
    insertVideo(db, { id: 'v1', channelId: 'c1', title: 'Clip', downloadStatus: 'downloading' });
    const child = { kill: vi.fn() };
    activeProcesses.set('v1', child);

    expect(await cancel('v1')).toEqual({ success: true });
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    // The killed yt-dlp process then makes the running attempt fail.
    recordFailedAttempt('v1', 'Clip', 'yt-dlp failed with code null');

    expect(row('v1')).toMatchObject({ download_status: 'failed', last_error: 'Cancelled by an admin.' });
    expect(pickable()).toEqual([]);
  });

  it('a queued (pending, manually queued) video leaves the queue', async () => {
    insertVideo(db, { id: 'v2', channelId: 'c1', title: 'Queued', downloadStatus: 'pending' });
    db.prepare('UPDATE videos SET is_manually_queued = 1 WHERE id = ?').run('v2');
    await cancel('v2');
    expect(row('v2')).toMatchObject({ download_status: 'failed', is_manually_queued: 0 });
    expect(pickable()).toEqual([]);
  });

  it('never touches a completed video or its files', async () => {
    const p = buildVideoPaths({ baseDir: dir, channelFolder: 'Chan', title: 'Done', id: 'v3' });
    insertVideo(db, { id: 'v3', channelId: 'c1', title: 'Done', downloadStatus: 'completed', localVideoPath: p.videoUrlFor('mp4') });
    fs.mkdirSync(p.dir, { recursive: true });
    fs.writeFileSync(path.join(p.dir, `${p.baseName}.mp4`), 'video');

    expect(await cancel('v3')).toEqual({ success: false });
    expect(row('v3').download_status).toBe('completed');
    expect(fs.existsSync(path.join(p.dir, `${p.baseName}.mp4`))).toBe(true);
  });
});

describe('recordFailedAttempt', () => {
  it('a genuine failure is still re-queued (retry count +1), and a pause keeps it pending', () => {
    insertVideo(db, { id: 'v4', channelId: 'c1', title: 'Flaky', downloadStatus: 'downloading' });
    recordFailedAttempt('v4', 'Flaky', 'HTTP 500');
    expect(row('v4')).toMatchObject({ download_status: 'pending', last_error: 'HTTP 500', retry_count: 1 });

    insertVideo(db, { id: 'v5', channelId: 'c1', title: 'Paused', downloadStatus: 'pending' });
    recordFailedAttempt('v5', 'Paused', 'killed');
    expect(row('v5')).toMatchObject({ download_status: 'pending', retry_count: 0 });
  });
});
