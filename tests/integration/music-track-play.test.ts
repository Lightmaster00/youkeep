import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import handler from '../../server/api/music/tracks/[id]/play.post';
import {
  createTestDb,
  insertUser,
  insertSession,
  insertMusicArtist,
  insertMusicTrack,
  mockEvent,
  sessionCookie
} from '../helpers/testDb';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
});
afterEach(() => {
  vi.useRealTimers();
});

function loginAs(userId: string, role: 'admin' | 'user' = 'user') {
  insertUser(db, { id: userId, role });
  const sessionId = `sess-${userId}`;
  insertSession(db, { id: sessionId, userId });
  return sessionCookie(sessionId);
}

function eventFor(trackId: string, cookieHeader?: string) {
  return mockEvent(cookieHeader, { path: `/api/music/tracks/${trackId}/play`, params: { id: trackId } });
}

describe('POST /api/music/tracks/[id]/play', () => {
  it('returns 404 for a nonexistent track, 403 for a private track to a guest and for an ultra_private one to a user', async () => {
    const cookie = loginAs('u1');
    await expect(handler(eventFor('missing', cookie))).rejects.toMatchObject({ statusCode: 404 });
    insertMusicArtist(db, { id: 'a1', visibility: 'private' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });
    await expect(handler(eventFor('t1'))).rejects.toMatchObject({ statusCode: 403 });
    insertMusicArtist(db, { id: 'a2', visibility: 'ultra_private' });
    insertMusicTrack(db, { id: 't2', artistId: 'a2' });
    await expect(handler(eventFor('t2', cookie))).rejects.toMatchObject({ statusCode: 403 });
    expect(((await handler(eventFor('t2', loginAs('admin1', 'admin')))) as any).recorded).toBe(true);
  });

  it('does not record a play and returns recorded:false for a guest on a public track', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'public' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });

    const result: any = await handler(eventFor('t1'));
    expect(result.recorded).toBe(false);
    const rows = db.prepare('SELECT COUNT(*) as cnt FROM music_play_history').get() as { cnt: number };
    expect(rows.cnt).toBe(0);
  });

  it('records one new row per play for a logged-in user (no upserted count)', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'public' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });
    const cookie = loginAs('u1');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_000_000_000_000);

    expect(((await handler(eventFor('t1', cookie))) as any).recorded).toBe(true);
    vi.setSystemTime(1_000_000_000_000 + 31_000);
    await handler(eventFor('t1', cookie));
    const rows = db.prepare('SELECT track_id, user_id FROM music_play_history').all() as any[];
    expect(rows).toEqual([{ track_id: 't1', user_id: 'u1' }, { track_id: 't1', user_id: 'u1' }]);
  });

  it('ignores a replay of the same track by the same user within 30 s', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'public' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });
    insertMusicTrack(db, { id: 't2', artistId: 'a1' });
    const cookie = loginAs('u1');
    const other = loginAs('u2');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_000_000_000_000);

    expect(((await handler(eventFor('t1', cookie))) as any).recorded).toBe(true);
    vi.setSystemTime(1_000_000_000_000 + 29_000);
    expect(await handler(eventFor('t1', cookie))).toEqual({ recorded: false, reason: 'duplicate' });
    // Another track, or another user, is not a duplicate.
    expect(((await handler(eventFor('t2', cookie))) as any).recorded).toBe(true);
    expect(((await handler(eventFor('t1', other))) as any).recorded).toBe(true);
    expect((db.prepare('SELECT COUNT(*) as n FROM music_play_history').get() as any).n).toBe(3);
  });

  it('records at most 120 plays per user per hour', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'public' });
    for (let i = 0; i < 125; i++) insertMusicTrack(db, { id: `t${i}`, artistId: 'a1' });
    const cookie = loginAs('u1');
    vi.useFakeTimers({ toFake: ['Date'] });
    const start = 1_000_000_000_000;
    let recorded = 0;
    for (let i = 0; i < 125; i++) {
      vi.setSystemTime(start + i * 1000);
      if (((await handler(eventFor(`t${i}`, cookie))) as any).recorded) recorded++;
    }
    expect(recorded).toBe(120);
    expect(await handler(eventFor('t124', cookie))).toEqual({ recorded: false, reason: 'rate_limited' });
    // An hour after the first plays, there is room again.
    vi.setSystemTime(start + 3_600_000 + 5_000);
    expect(((await handler(eventFor('t124', cookie))) as any).recorded).toBe(true);
  });
});
