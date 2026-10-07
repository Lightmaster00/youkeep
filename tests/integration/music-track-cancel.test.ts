import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import cancelHandler from '../../server/api/admin/music/tracks/[id]/cancel.post';
import { activeMusicProcesses, getMusicDownloadsDir, recordFailedMusicAttempt } from '../../server/utils/musicDownloader';
import { assertInTmp, createTestDb, insertMusicArtist, insertMusicTrack, mockEvent } from '../helpers/testDb';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
  (globalThis as any).requireAdmin = async () => ({ id: 'admin', role: 'admin' });
  insertMusicArtist(db, { id: 'a1', name: 'Cancel Artist' });
  db.prepare("UPDATE music_artists SET sync_status = 'downloading'").run();
});
afterEach(() => {
  activeMusicProcesses.clear();
});

const row = (id: string) => db.prepare('SELECT download_status, last_error, retry_count FROM music_tracks WHERE id = ?').get(id) as any;
const cancel = (id: string) => cancelHandler(mockEvent(undefined, { method: 'POST', params: { id } }));
// What the music queue worker picks next (same condition as startMusicQueueWorker).
const pickable = () => (db.prepare(`
  SELECT t.id FROM music_tracks t JOIN music_artists a ON t.artist_id = a.id
  WHERE t.download_status = 'pending' AND a.sync_status = 'downloading'
`).all() as { id: string }[]).map((r) => r.id);

describe('POST /api/admin/music/tracks/:id/cancel', () => {
  it('a running download stays cancelled after its process exits: the worker does not restart it', async () => {
    insertMusicTrack(db, { id: 't1', artistId: 'a1', downloadStatus: 'downloading' });
    const child = { kill: vi.fn() };
    activeMusicProcesses.set('t1', child);

    expect(await cancel('t1')).toEqual({ success: true });
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    // The killed yt-dlp process then makes the running attempt fail.
    recordFailedMusicAttempt('t1', 'Track t1', 'yt-dlp failed with code null');

    expect(row('t1')).toMatchObject({ download_status: 'failed', last_error: 'Cancelled by an admin.', retry_count: 0 });
    expect(pickable()).toEqual([]);
  });

  it('a queued (pending) track leaves the queue', async () => {
    insertMusicTrack(db, { id: 't2', artistId: 'a1', downloadStatus: 'pending' });
    expect(await cancel('t2')).toEqual({ success: true });
    expect(row('t2')).toMatchObject({ download_status: 'failed', last_error: 'Cancelled by an admin.' });
    expect(pickable()).toEqual([]);
  });

  it('never touches a completed track or its files', async () => {
    const dir = path.join(getMusicDownloadsDir(), 'Cancel Artist');
    assertInTmp(dir);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 't3.opus');
    fs.writeFileSync(file, 'audio');
    insertMusicTrack(db, { id: 't3', artistId: 'a1', downloadStatus: 'completed', localFilePath: '/downloads-music/Cancel Artist/t3.opus' });

    expect(await cancel('t3')).toEqual({ success: false });
    expect(row('t3').download_status).toBe('completed');
    expect(fs.existsSync(file)).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('an already failed track stays as it is', async () => {
    insertMusicTrack(db, { id: 't4', artistId: 'a1', downloadStatus: 'failed' });
    db.prepare("UPDATE music_tracks SET last_error = 'HTTP 403' WHERE id = 't4'").run();
    expect(await cancel('t4')).toEqual({ success: true });
    expect(row('t4')).toMatchObject({ download_status: 'failed', last_error: 'HTTP 403' });
  });
});

describe('recordFailedMusicAttempt', () => {
  it('a genuine failure is still re-queued (retry count +1), and a pause keeps it pending', () => {
    insertMusicTrack(db, { id: 't5', artistId: 'a1', downloadStatus: 'downloading' });
    recordFailedMusicAttempt('t5', 'Flaky', 'HTTP 500');
    expect(row('t5')).toMatchObject({ download_status: 'pending', last_error: 'HTTP 500', retry_count: 1 });

    insertMusicTrack(db, { id: 't6', artistId: 'a1', downloadStatus: 'pending' });
    recordFailedMusicAttempt('t6', 'Paused', 'killed');
    expect(row('t6')).toMatchObject({ download_status: 'pending', retry_count: 0 });
  });
});
