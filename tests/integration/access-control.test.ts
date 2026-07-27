import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { canAccessVideo, canAccessChannel, canAccessMusicTrack } from '../../server/utils/auth';
import {
  createTestDb,
  insertUser,
  insertSession,
  insertChannel,
  insertVideo,
  grantChannelAccess,
  mockEvent,
  sessionCookie,
  insertMusicArtist,
  insertMusicTrack
} from '../helpers/testDb';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  // auth.ts calls the ambient `getDb()` (Nitro auto-import in production);
  // point it at our in-memory test database for the duration of each test.
  (globalThis as any).getDb = () => db;
});

function loginAs(userId: string, role: 'admin' | 'user') {
  insertUser(db, { id: userId, role });
  const sessionId = `sess-${userId}`;
  insertSession(db, { id: sessionId, userId });
  return mockEvent(sessionCookie(sessionId));
}

const guestEvent = () => mockEvent();

describe('canAccessChannel', () => {
  it('is accessible to a guest when the channel is public', async () => {
    insertChannel(db, { id: 'c1', visibility: 'public' });
    expect(await canAccessChannel('c1', guestEvent())).toBe(true);
  });

  it('is not accessible to a guest when the channel is private', async () => {
    insertChannel(db, { id: 'c1', visibility: 'private' });
    expect(await canAccessChannel('c1', guestEvent())).toBe(false);
  });

  it('is accessible to any logged-in user when the channel is private', async () => {
    insertChannel(db, { id: 'c1', visibility: 'private' });
    const event = loginAs('u1', 'user');
    expect(await canAccessChannel('c1', event)).toBe(true);
  });

  it('is not accessible to a regular user without explicit grant when ultra_private', async () => {
    insertChannel(db, { id: 'c1', visibility: 'ultra_private' });
    const event = loginAs('u1', 'user');
    expect(await canAccessChannel('c1', event)).toBe(false);
  });

  it('is accessible to a user with an explicit user_channel_access grant when ultra_private', async () => {
    insertChannel(db, { id: 'c1', visibility: 'ultra_private' });
    insertUser(db, { id: 'u1', role: 'user' });
    grantChannelAccess(db, 'u1', 'c1');
    const sessionId = 'sess-u1';
    insertSession(db, { id: sessionId, userId: 'u1' });
    expect(await canAccessChannel('c1', mockEvent(sessionCookie(sessionId)))).toBe(true);
  });

  it('is always accessible to an admin regardless of visibility', async () => {
    insertChannel(db, { id: 'c1', visibility: 'ultra_private' });
    const event = loginAs('admin1', 'admin');
    expect(await canAccessChannel('c1', event)).toBe(true);
  });

  it('returns false for a channel that does not exist', async () => {
    expect(await canAccessChannel('missing', guestEvent())).toBe(false);
  });
});

describe('canAccessVideo', () => {
  it('is accessible to a guest when both video and channel are public', async () => {
    insertChannel(db, { id: 'c1', visibility: 'public' });
    insertVideo(db, { id: 'v1', channelId: 'c1', visibility: 'public' });
    expect(await canAccessVideo('v1', guestEvent())).toBe(true);
  });

  it('uses the most restrictive of video and channel visibility', async () => {
    // Channel is public, but this specific video is ultra_private: a regular
    // user without an explicit grant must still be denied (regression guard
    // for the playlist-leak class of bug).
    insertChannel(db, { id: 'c1', visibility: 'public' });
    insertVideo(db, { id: 'v1', channelId: 'c1', visibility: 'ultra_private' });
    const event = loginAs('u1', 'user');
    expect(await canAccessVideo('v1', event)).toBe(false);
  });

  it('grants access via user_channel_access even when the video itself is ultra_private', async () => {
    insertChannel(db, { id: 'c1', visibility: 'public' });
    insertVideo(db, { id: 'v1', channelId: 'c1', visibility: 'ultra_private' });
    insertUser(db, { id: 'u1', role: 'user' });
    grantChannelAccess(db, 'u1', 'c1');
    const sessionId = 'sess-u1';
    insertSession(db, { id: sessionId, userId: 'u1' });
    expect(await canAccessVideo('v1', mockEvent(sessionCookie(sessionId)))).toBe(true);
  });

  it('denies a guest access to a private video', async () => {
    insertChannel(db, { id: 'c1', visibility: 'public' });
    insertVideo(db, { id: 'v1', channelId: 'c1', visibility: 'private' });
    expect(await canAccessVideo('v1', guestEvent())).toBe(false);
  });

  it('allows any logged-in user to view a private video', async () => {
    insertChannel(db, { id: 'c1', visibility: 'public' });
    insertVideo(db, { id: 'v1', channelId: 'c1', visibility: 'private' });
    const event = loginAs('u1', 'user');
    expect(await canAccessVideo('v1', event)).toBe(true);
  });

  it('grants access via a valid share token even to a guest', async () => {
    insertChannel(db, { id: 'c1', visibility: 'public' });
    insertVideo(db, { id: 'v1', channelId: 'c1', visibility: 'ultra_private', shareToken: 'secret-token' });
    expect(await canAccessVideo('v1', guestEvent(), 'secret-token')).toBe(true);
  });

  it('rejects an incorrect share token', async () => {
    insertChannel(db, { id: 'c1', visibility: 'public' });
    insertVideo(db, { id: 'v1', channelId: 'c1', visibility: 'ultra_private', shareToken: 'secret-token' });
    expect(await canAccessVideo('v1', guestEvent(), 'wrong-token')).toBe(false);
  });

  it('is always accessible to an admin regardless of visibility', async () => {
    insertChannel(db, { id: 'c1', visibility: 'ultra_private' });
    insertVideo(db, { id: 'v1', channelId: 'c1', visibility: 'ultra_private' });
    const event = loginAs('admin1', 'admin');
    expect(await canAccessVideo('v1', event)).toBe(true);
  });

  it('returns false for a video that does not exist', async () => {
    expect(await canAccessVideo('missing', guestEvent())).toBe(false);
  });
});

describe('canAccessMusicTrack', () => {
  it('is accessible to a guest when the artist is public', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'public' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });
    expect(await canAccessMusicTrack('t1', guestEvent())).toBe(true);
  });

  it('denies a guest access to a track from a private artist', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'private' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });
    expect(await canAccessMusicTrack('t1', guestEvent())).toBe(false);
  });

  it('allows any logged-in user to access a track from a private artist', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'private' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });
    const event = loginAs('u1', 'user');
    expect(await canAccessMusicTrack('t1', event)).toBe(true);
  });

  it('is not accessible to a regular user when the artist is ultra_private (no grant mechanism exists for music)', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'ultra_private' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });
    const event = loginAs('u1', 'user');
    expect(await canAccessMusicTrack('t1', event)).toBe(false);
  });

  it('is always accessible to an admin regardless of visibility', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'ultra_private' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });
    const event = loginAs('admin1', 'admin');
    expect(await canAccessMusicTrack('t1', event)).toBe(true);
  });

  it('returns false for a track that does not exist', async () => {
    expect(await canAccessMusicTrack('missing', guestEvent())).toBe(false);
  });

  it('returns false when the track exists but its artist row does not (orphaned data)', async () => {
    // Exercises the INNER JOIN in the implementation: a track whose artist_id
    // doesn't resolve should be treated as inaccessible, not throw.
    db.exec(`PRAGMA foreign_keys = OFF;`);
    insertMusicTrack(db, { id: 't1', artistId: 'missing-artist' });
    db.exec(`PRAGMA foreign_keys = ON;`);
    expect(await canAccessMusicTrack('t1', guestEvent())).toBe(false);
  });
});
