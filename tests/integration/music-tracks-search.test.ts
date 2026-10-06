import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import handler from '../../server/api/music/tracks/search.get';
import {
  createTestDb,
  insertUser,
  insertSession,
  insertMusicArtist,
  insertMusicAlbum,
  insertMusicTrack,
  mockEvent,
  sessionCookie
} from '../helpers/testDb';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
});

function loginAs(userId: string, role: 'admin' | 'user' = 'user', path = '/api/music/tracks/search') {
  insertUser(db, { id: userId, role });
  const sessionId = `sess-${userId}`;
  insertSession(db, { id: sessionId, userId });
  return mockEvent(sessionCookie(sessionId), { path });
}

const guestEvent = (path = '/api/music/tracks/search') => mockEvent(undefined, { path });

describe('GET /api/music/tracks/search', () => {
  it('finds a track by its own title via the LIKE fallback (no FTS table exists in the test DB, so this always exercises the fallback path)', async () => {
    insertMusicArtist(db, { id: 'a1', name: 'Daft Punk' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });
    db.prepare("UPDATE music_tracks SET title = 'Get Lucky' WHERE id = 't1'").run();
    insertMusicTrack(db, { id: 't2', artistId: 'a1' });
    db.prepare("UPDATE music_tracks SET title = 'Around The World' WHERE id = 't2'").run();

    const result: any = await handler(guestEvent('/api/music/tracks/search?q=Lucky'));
    expect(result.tracks.map((t: any) => t.id)).toEqual(['t1']);
  });

  it('includes the joined artist_name and album_title (null for a standalone track)', async () => {
    insertMusicArtist(db, { id: 'a1', name: 'Daft Punk' });
    insertMusicAlbum(db, { id: 'al1', artistId: 'a1', title: 'Random Access Memories' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', albumId: 'al1' });
    insertMusicTrack(db, { id: 't2', artistId: 'a1' });
    db.prepare("UPDATE music_tracks SET title = 'Get Lucky' WHERE id = 't1'").run();
    db.prepare("UPDATE music_tracks SET title = 'Lucky Star' WHERE id = 't2'").run();

    const result: any = await handler(guestEvent('/api/music/tracks/search?q=Lucky'));
    const byId = Object.fromEntries(result.tracks.map((t: any) => [t.id, t]));
    expect(byId.t1).toMatchObject({ artist_name: 'Daft Punk', album_title: 'Random Access Memories' });
    expect(byId.t2.album_title).toBeNull();
  });

  it('applies artist visibility per viewer (guest: public; user: + private; admin: + ultra_private) and skips incomplete tracks', async () => {
    insertMusicArtist(db, { id: 'pub', visibility: 'public' });
    insertMusicArtist(db, { id: 'priv', visibility: 'private' });
    insertMusicArtist(db, { id: 'ultra', visibility: 'ultra_private' });
    insertMusicTrack(db, { id: 't-pub', artistId: 'pub' });
    insertMusicTrack(db, { id: 't-priv', artistId: 'priv' });
    insertMusicTrack(db, { id: 't-ultra', artistId: 'ultra' });
    insertMusicTrack(db, { id: 't-dl', artistId: 'pub', downloadStatus: 'downloading' });
    db.prepare("UPDATE music_tracks SET title = 'Secret ' || id").run();
    const path = '/api/music/tracks/search?q=Secret';
    const sorted = (r: any) => r.tracks.map((t: any) => t.id).sort();

    expect(sorted(await handler(guestEvent(path)))).toEqual(['t-pub']);
    expect(sorted(await handler(loginAs('u1', 'user', path)))).toEqual(['t-priv', 't-pub']);
    expect(sorted(await handler(loginAs('admin1', 'admin', path)))).toEqual(['t-priv', 't-pub', 't-ultra']);
  });

  it('caps results at the requested limit, clamped to 200', async () => {
    insertMusicArtist(db, { id: 'a1', name: 'Prolific Artist' });
    const insert = db.transaction(() => {
      for (let i = 1; i <= 205; i++) insertMusicTrack(db, { id: `t${i}`, artistId: 'a1' });
    });
    insert();
    db.prepare("UPDATE music_tracks SET title = 'Limit Test ' || id").run();

    expect((await handler(guestEvent('/api/music/tracks/search?q=Limit&limit=2')) as any).tracks).toHaveLength(2);
    expect((await handler(guestEvent('/api/music/tracks/search?q=Limit&limit=500')) as any).tracks).toHaveLength(200);
  });
});
