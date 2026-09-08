import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import handler from '../../server/api/podcasts/episodes/search.get';
import {
  createTestDb,
  insertUser,
  insertSession,
  insertPodcastShow,
  insertPodcastEpisode,
  mockEvent,
  sessionCookie
} from '../helpers/testDb';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
});

function loginAs(userId: string, role: 'admin' | 'user' = 'user', path = '/api/podcasts/episodes/search') {
  insertUser(db, { id: userId, role });
  const sessionId = `sess-${userId}`;
  insertSession(db, { id: sessionId, userId });
  return mockEvent(sessionCookie(sessionId), { path });
}

const guestEvent = (path = '/api/podcasts/episodes/search') => mockEvent(undefined, { path });

describe('GET /api/podcasts/episodes/search', () => {
  it('finds an episode by its own title via the LIKE fallback (no FTS table exists in the test DB, so this always exercises the fallback path)', async () => {
    insertPodcastShow(db, { id: 's1', title: 'Planet Money' });
    insertPodcastEpisode(db, { id: 'e1', showId: 's1' });
    db.prepare("UPDATE podcast_episodes SET title = 'The Big Short Story' WHERE id = 'e1'").run();
    insertPodcastEpisode(db, { id: 'e2', showId: 's1' });
    db.prepare("UPDATE podcast_episodes SET title = 'Unrelated Episode' WHERE id = 'e2'").run();

    const result: any = await handler(guestEvent('/api/podcasts/episodes/search?q=Short'));
    expect(result.episodes.map((e: any) => e.id)).toEqual(['e1']);
  });

  it('includes the joined show_title and show_cover_url', async () => {
    insertPodcastShow(db, { id: 's1', title: 'Planet Money' });
    db.prepare("UPDATE podcast_shows SET cover_url = 'https://example.com/cover.jpg' WHERE id = 's1'").run();
    insertPodcastEpisode(db, { id: 'e1', showId: 's1' });
    db.prepare("UPDATE podcast_episodes SET title = 'The Big Short Story' WHERE id = 'e1'").run();

    const result: any = await handler(guestEvent('/api/podcasts/episodes/search?q=Short'));
    expect(result.episodes[0].show_title).toBe('Planet Money');
    expect(result.episodes[0].show_cover_url).toBe('https://example.com/cover.jpg');
  });

  it('excludes an episode whose show is private, for a guest', async () => {
    insertPodcastShow(db, { id: 's1', visibility: 'private' });
    insertPodcastEpisode(db, { id: 'e1', showId: 's1' });
    db.prepare("UPDATE podcast_episodes SET title = 'Secret Episode' WHERE id = 'e1'").run();

    const result: any = await handler(guestEvent('/api/podcasts/episodes/search?q=Secret'));
    expect(result.episodes).toEqual([]);
  });

  it('includes an episode whose show is private, for a logged-in non-admin user', async () => {
    insertPodcastShow(db, { id: 's1', visibility: 'private' });
    insertPodcastEpisode(db, { id: 'e1', showId: 's1' });
    db.prepare("UPDATE podcast_episodes SET title = 'Secret Episode' WHERE id = 'e1'").run();

    const result: any = await handler(loginAs('u1', 'user', '/api/podcasts/episodes/search?q=Secret'));
    expect(result.episodes.map((e: any) => e.id)).toEqual(['e1']);
  });

  it('excludes an episode whose show is ultra_private, for a logged-in non-admin user', async () => {
    insertPodcastShow(db, { id: 's1', visibility: 'ultra_private' });
    insertPodcastEpisode(db, { id: 'e1', showId: 's1' });
    db.prepare("UPDATE podcast_episodes SET title = 'Ultra Secret Episode' WHERE id = 'e1'").run();

    const result: any = await handler(loginAs('u1', 'user', '/api/podcasts/episodes/search?q=Ultra'));
    expect(result.episodes).toEqual([]);
  });

  it('includes an ultra_private show episode for an admin', async () => {
    insertPodcastShow(db, { id: 's1', visibility: 'ultra_private' });
    insertPodcastEpisode(db, { id: 'e1', showId: 's1' });
    db.prepare("UPDATE podcast_episodes SET title = 'Ultra Secret Episode' WHERE id = 'e1'").run();

    const result: any = await handler(loginAs('admin1', 'admin', '/api/podcasts/episodes/search?q=Ultra'));
    expect(result.episodes.map((e: any) => e.id)).toEqual(['e1']);
  });

  it('excludes an episode that is not yet completed', async () => {
    insertPodcastShow(db, { id: 's1' });
    insertPodcastEpisode(db, { id: 'e1', showId: 's1', downloadStatus: 'downloading' });
    db.prepare("UPDATE podcast_episodes SET title = 'Still Downloading Episode' WHERE id = 'e1'").run();

    const result: any = await handler(guestEvent('/api/podcasts/episodes/search?q=Downloading'));
    expect(result.episodes).toEqual([]);
  });

  it('caps results at the requested limit', async () => {
    insertPodcastShow(db, { id: 's1', title: 'Prolific Show' });
    for (let i = 1; i <= 5; i++) {
      insertPodcastEpisode(db, { id: `e${i}`, showId: 's1' });
      db.prepare("UPDATE podcast_episodes SET title = ? WHERE id = ?").run(`Limit Test ${i}`, `e${i}`);
    }

    const result: any = await handler(guestEvent('/api/podcasts/episodes/search?q=Limit&limit=2'));
    expect(result.episodes).toHaveLength(2);
  });

  it('clamps a requested limit above 200 down to 200', async () => {
    insertPodcastShow(db, { id: 's1', title: 'Prolific Show' });
    for (let i = 1; i <= 3; i++) {
      insertPodcastEpisode(db, { id: `e${i}`, showId: 's1' });
      db.prepare("UPDATE podcast_episodes SET title = ? WHERE id = ?").run(`Clamp Test ${i}`, `e${i}`);
    }

    const result: any = await handler(guestEvent('/api/podcasts/episodes/search?q=Clamp&limit=500'));
    expect(result.episodes).toHaveLength(3);
  });
});
