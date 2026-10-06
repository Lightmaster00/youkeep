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

  it('applies show visibility per viewer (guest: public; user: + private; admin: + ultra_private) and skips incomplete episodes', async () => {
    insertPodcastShow(db, { id: 'pub', visibility: 'public' });
    insertPodcastShow(db, { id: 'priv', visibility: 'private' });
    insertPodcastShow(db, { id: 'ultra', visibility: 'ultra_private' });
    insertPodcastEpisode(db, { id: 'e-pub', showId: 'pub' });
    insertPodcastEpisode(db, { id: 'e-priv', showId: 'priv' });
    insertPodcastEpisode(db, { id: 'e-ultra', showId: 'ultra' });
    insertPodcastEpisode(db, { id: 'e-dl', showId: 'pub', downloadStatus: 'downloading' });
    db.prepare("UPDATE podcast_episodes SET title = 'Secret ' || id").run();
    const path = '/api/podcasts/episodes/search?q=Secret';
    const sorted = (r: any) => r.episodes.map((e: any) => e.id).sort();

    expect(sorted(await handler(guestEvent(path)))).toEqual(['e-pub']);
    expect(sorted(await handler(loginAs('u1', 'user', path)))).toEqual(['e-priv', 'e-pub']);
    expect(sorted(await handler(loginAs('admin1', 'admin', path)))).toEqual(['e-priv', 'e-pub', 'e-ultra']);
  });

  it('caps results at the requested limit, clamped to 200', async () => {
    insertPodcastShow(db, { id: 's1', title: 'Prolific Show' });
    const insert = db.transaction(() => {
      for (let i = 1; i <= 205; i++) insertPodcastEpisode(db, { id: `e${i}`, showId: 's1' });
    });
    insert();
    db.prepare("UPDATE podcast_episodes SET title = 'Limit Test ' || id").run();

    expect((await handler(guestEvent('/api/podcasts/episodes/search?q=Limit&limit=2')) as any).episodes).toHaveLength(2);
    expect((await handler(guestEvent('/api/podcasts/episodes/search?q=Limit&limit=500')) as any).episodes).toHaveLength(200);
  });
});
