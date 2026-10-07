import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import handler from '../../server/api/admin/music/tracks/[id]/download-clip.post';
import * as musicDownloader from '../../server/utils/musicDownloader';
import { createTestDb, insertUser, insertSession, insertMusicArtist, insertMusicTrack, mockEvent, sessionCookie } from '../helpers/testDb';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
  vi.restoreAllMocks();
  musicDownloader.musicClipBackfillsInFlight.clear();
});

function loginAs(userId: string, role: 'admin' | 'user' = 'user') {
  insertUser(db, { id: userId, role });
  const sessionId = `sess-${userId}`;
  insertSession(db, { id: sessionId, userId });
  return sessionCookie(sessionId);
}

function eventFor(trackId: string, cookieHeader?: string) {
  return mockEvent(cookieHeader, { path: `/api/admin/music/tracks/${trackId}/download-clip`, params: { id: trackId } });
}

describe('POST /api/admin/music/tracks/[id]/download-clip', () => {
  it('returns 401 for a guest and 403 for a non-admin', async () => {
    await expect(handler(eventFor('t1'))).rejects.toMatchObject({ statusCode: 401 });
    const cookie = loginAs('u1', 'user');
    await expect(handler(eventFor('t1', cookie))).rejects.toMatchObject({ statusCode: 403 });
  });

  it('returns 404 for a nonexistent track', async () => {
    const cookie = loginAs('admin1', 'admin');
    await expect(handler(eventFor('missing', cookie))).rejects.toMatchObject({ statusCode: 404 });
  });

  it('returns 409 when the track already has a clip', async () => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', hasClip: true });
    const cookie = loginAs('admin1', 'admin');
    await expect(handler(eventFor('t1', cookie))).rejects.toMatchObject({ statusCode: 409 });
  });

  it('returns 409 when a download is already in progress for this track', async () => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', hasClip: false });
    const cookie = loginAs('admin1', 'admin');

    musicDownloader.activeMusicProcesses.set('t1', {});
    try {
      await expect(handler(eventFor('t1', cookie))).rejects.toMatchObject({ statusCode: 409 });
    } finally {
      musicDownloader.activeMusicProcesses.delete('t1');
    }
  });

  it('returns 409 on a second concurrent request before the first has started spawning (closes the pre-spawn race window)', async () => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', hasClip: false });
    const cookie = loginAs('admin1', 'admin');
    // Never the real download (it would run yt-dlp); it settles on the next tick.
    vi.spyOn(musicDownloader, 'downloadTrackClip').mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 0)));

    const first = handler(eventFor('t1', cookie));
    await expect(handler(eventFor('t1', cookie))).rejects.toMatchObject({ statusCode: 409 });

    // Let the first request's fire-and-forget downloadTrackClip settle so it
    // doesn't leak the reservation into a later test.
    await first;
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  it('returns 200 and queues the download without awaiting it, for an admin', async () => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', hasClip: false });
    const cookie = loginAs('admin1', 'admin');

    const spy = vi.spyOn(musicDownloader, 'downloadTrackClip').mockImplementation(() => new Promise(() => {}));

    const result: any = await handler(eventFor('t1', cookie));
    expect(result).toEqual({ success: true, queued: true });
    expect(spy).toHaveBeenCalledWith('t1');
  });

  it('releases the in-flight reservation once downloadTrackClip settles, allowing a later request through', async () => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', hasClip: false });
    const cookie = loginAs('admin1', 'admin');

    vi.spyOn(musicDownloader, 'downloadTrackClip').mockResolvedValue(undefined);

    await handler(eventFor('t1', cookie));
    // Let the fire-and-forget promise chain (including its .finally cleanup) settle.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(musicDownloader.musicClipBackfillsInFlight.has('t1')).toBe(false);
    await expect(handler(eventFor('t1', cookie))).resolves.toEqual({ success: true, queued: true });
  });
});
