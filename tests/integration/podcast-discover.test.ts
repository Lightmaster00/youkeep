import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import popularHandler from '../../server/api/podcasts/discover/popular.get';
import recentlyUpdatedHandler from '../../server/api/podcasts/discover/recently-updated.get';
import trendingHandler from '../../server/api/podcasts/discover/trending.get';
import becauseHandler from '../../server/api/podcasts/discover/because-you-follow.get';
import languagesHandler from '../../server/api/podcasts/discover/languages.get';
import { TRENDING_WINDOW_MS } from '../../server/utils/podcastDiscover';
import {
  createTestDb, insertUser, insertSession, insertPodcastShow, insertPodcastEpisode, mockEvent, sessionCookie,
} from '../helpers/testDb';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
});

function login(userId: string, role: 'admin' | 'user' = 'user') {
  insertUser(db, { id: userId, role });
  insertSession(db, { id: `sess-${userId}`, userId });
  return sessionCookie(`sess-${userId}`);
}
function user(userId: string) {
  insertUser(db, { id: userId, role: 'user' });
}
const ev = (path: string, cookie?: string) => mockEvent(cookie, { path });
const follow = (userId: string, showId: string, at = Date.now()) =>
  db.prepare('INSERT INTO podcast_show_follows (user_id, show_id, created_at) VALUES (?, ?, ?)').run(userId, showId, at);
const listen = (userId: string, episodeId: string, at: number) =>
  db.prepare(`INSERT INTO podcast_episode_progress (user_id, episode_id, position_seconds, duration_seconds, completed, updated_at)
    VALUES (?, ?, 60, 600, 0, ?)`).run(userId, episodeId, at);
const ids = (list: any[]) => list.map((x) => x.id);

describe('GET /api/podcasts/discover/popular', () => {
  const popular = async (query = '', cookie?: string) => ((await popularHandler(ev(`/api/podcasts/discover/popular${query}`, cookie))) as any).shows;

  beforeEach(() => {
    insertPodcastShow(db, { id: 'one', visibility: 'public', language: 'en' });
    insertPodcastShow(db, { id: 'two', visibility: 'public', language: 'FR' });
    insertPodcastShow(db, { id: 'bigCatalogue', visibility: 'public', language: 'en' });
    insertPodcastShow(db, { id: 'none', visibility: 'public', language: 'en' });
    insertPodcastShow(db, { id: 'priv', visibility: 'private', language: 'en' });
    for (let i = 0; i < 3; i++) insertPodcastEpisode(db, { id: `big${i}`, showId: 'bigCatalogue', downloadStatus: 'pending' });
    ['a', 'b', 'c'].forEach(user);
    follow('a', 'two'); follow('b', 'two');
    follow('a', 'one'); follow('a', 'bigCatalogue');
    follow('a', 'priv'); follow('b', 'priv'); follow('c', 'priv');
  });

  it('orders shows with followers by follower count then episode count, with counts only', async () => {
    const list = await popular();
    expect(ids(list)).toEqual(['two', 'bigCatalogue', 'one']);
    expect(list[0]).toEqual({
      id: 'two', title: 'Show two', author: null, cover_url: null, language: 'FR',
      episode_count: 0, completed_episode_count: 0, followerCount: 2,
    });
    expect(JSON.stringify(list)).not.toMatch(/"(a|b|c)"/);
    expect(ids(await popular('', login('u1')))).toEqual(['priv', 'two', 'bigCatalogue', 'one']);
    expect(ids(await popular('?limit=1'))).toEqual(['two']);
  });

  it('filters by language without regard to case', async () => {
    expect(ids(await popular('?language=fr'))).toEqual(['two']);
    expect(ids(await popular('?language=EN'))).toEqual(['bigCatalogue', 'one']);
    expect(await popular('?language=de')).toEqual([]);
  });
});

describe('GET /api/podcasts/discover/recently-updated', () => {
  const recent = async (query = '', cookie?: string) =>
    ((await recentlyUpdatedHandler(ev(`/api/podcasts/discover/recently-updated${query}`, cookie))) as any).shows;

  it('orders visible shows by their newest playable episode, with its title and date', async () => {
    insertPodcastShow(db, { id: 'old', language: 'en' });
    insertPodcastShow(db, { id: 'fresh', language: 'fr' });
    insertPodcastShow(db, { id: 'pendingOnly' });
    insertPodcastShow(db, { id: 'priv', visibility: 'private' });
    insertPodcastEpisode(db, { id: 'o1', showId: 'old', title: 'Old one', pubTs: 1000, createdAt: 5 });
    insertPodcastEpisode(db, { id: 'f1', showId: 'fresh', title: 'Fresh older', pubTs: 1500, createdAt: 5 });
    insertPodcastEpisode(db, { id: 'f2', showId: 'fresh', title: 'Fresh newest', pubTs: null, createdAt: 3000 });
    insertPodcastEpisode(db, { id: 'f3', showId: 'fresh', title: 'Not downloaded', pubTs: 9000, downloadStatus: 'pending', createdAt: 5 });
    insertPodcastEpisode(db, { id: 'p1', showId: 'pendingOnly', pubTs: 9999, downloadStatus: 'pending', createdAt: 5 });
    insertPodcastEpisode(db, { id: 'v1', showId: 'priv', pubTs: 8000, createdAt: 5 });
    const list = await recent();
    expect(ids(list)).toEqual(['fresh', 'old']);
    expect(list[0]).toMatchObject({ latestEpisodeTitle: 'Fresh newest', latestEpisodeAt: 3000, completed_episode_count: 2, episode_count: 3 });
    expect(ids(await recent('', login('u1')))).toEqual(['priv', 'fresh', 'old']);
    expect(ids(await recent('?language=EN'))).toEqual(['old']);
    expect(ids(await recent('?limit=1'))).toEqual(['fresh']);
  });
});

describe('GET /api/podcasts/discover/trending', () => {
  const NOW = 1_800_000_000_000;
  const trending = async (query = '', cookie?: string) => ((await trendingHandler(ev(`/api/podcasts/discover/trending${query}`, cookie))) as any).episodes;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    insertPodcastShow(db, { id: 'pub' });
    insertPodcastShow(db, { id: 'priv', visibility: 'private' });
    insertPodcastEpisode(db, { id: 'hot', showId: 'pub', pubTs: 100, localFilePath: '/p/hot.mp3' });
    insertPodcastEpisode(db, { id: 'warmOld', showId: 'pub', pubTs: 100 });
    insertPodcastEpisode(db, { id: 'warmNew', showId: 'pub', pubTs: 200 });
    insertPodcastEpisode(db, { id: 'stale', showId: 'pub', pubTs: 300 });
    insertPodcastEpisode(db, { id: 'quiet', showId: 'pub', pubTs: 400 });
    insertPodcastEpisode(db, { id: 'pending', showId: 'pub', pubTs: 500, downloadStatus: 'pending' });
    insertPodcastEpisode(db, { id: 'hidden', showId: 'priv', pubTs: 600 });
    ['a', 'b', 'c'].forEach(user);
    const edge = NOW - TRENDING_WINDOW_MS;
    listen('a', 'hot', NOW); listen('b', 'hot', edge); listen('c', 'hot', NOW - 1000);
    listen('a', 'warmOld', NOW); listen('a', 'warmNew', NOW);
    listen('a', 'stale', edge - 1); listen('b', 'stale', edge - 1);
    listen('a', 'pending', NOW); listen('b', 'pending', NOW);
    for (const u of ['a', 'b', 'c']) listen(u, 'hidden', NOW);
  });
  afterEach(() => vi.useRealTimers());

  it('ranks visible playable episodes by distinct listeners in the window, newest first on ties', async () => {
    const list = await trending();
    expect(ids(list)).toEqual(['hot', 'warmNew', 'warmOld']);
    expect(list[0]).toMatchObject({ listenerCount: 3, show_title: 'Show pub', local_file_path: '/p/hot.mp3', download_status: 'completed' });
    expect(Object.keys(list[0])).not.toContain('user_id');
    expect(ids(await trending('', login('u1')))).toEqual(['hidden', 'hot', 'warmNew', 'warmOld']);
    expect(ids(await trending('?limit=2'))).toEqual(['hot', 'warmNew']);
  });

  it('counts the window boundary in and anything older out', async () => {
    db.prepare("DELETE FROM podcast_episode_progress WHERE episode_id = 'hot' AND user_id != 'b'").run();
    expect((await trending()).find((e: any) => e.id === 'hot')?.listenerCount).toBe(1);
    db.prepare("UPDATE podcast_episode_progress SET updated_at = updated_at - 1 WHERE episode_id = 'hot'").run();
    expect(ids(await trending())).not.toContain('hot');
  });
});

describe('GET /api/podcasts/discover/because-you-follow', () => {
  const because = async (cookie?: string, query = '') => (await becauseHandler(ev(`/api/podcasts/discover/because-you-follow${query}`, cookie))) as any;

  beforeEach(() => {
    insertPodcastShow(db, { id: 'mine1', title: 'Mine 1', language: 'en', createdAt: 1 });
    insertPodcastShow(db, { id: 'mine2', title: 'Mine 2', language: 'fr', createdAt: 1 });
    insertPodcastShow(db, { id: 'enPopular', language: ' EN ', createdAt: 1 });
    insertPodcastShow(db, { id: 'enFresh', language: 'en', createdAt: 1 });
    insertPodcastShow(db, { id: 'enOld', language: 'en', createdAt: 1 });
    insertPodcastShow(db, { id: 'frShow', language: 'fr', createdAt: 1 });
    insertPodcastShow(db, { id: 'deShow', language: 'de', createdAt: 1 });
    insertPodcastShow(db, { id: 'enPrivate', language: 'en', visibility: 'private', createdAt: 1 });
    insertPodcastShow(db, { id: 'enUltra', language: 'en', visibility: 'ultra_private', createdAt: 1 });
    insertPodcastEpisode(db, { id: 'fresh1', showId: 'enFresh', pubTs: 5000 });
    insertPodcastEpisode(db, { id: 'old1', showId: 'enOld', pubTs: 100 });
    insertPodcastEpisode(db, { id: 'fr1', showId: 'frShow', pubTs: 50 });
    ['x', 'y'].forEach(user);
    follow('x', 'enPopular'); follow('y', 'enPopular');
  });

  it('is empty for guests and for users following nothing', async () => {
    expect(await because()).toEqual({ basedOn: null, shows: [] });
    expect(await because(login('u1'))).toEqual({ basedOn: null, shows: [] });
  });

  it('suggests unfollowed visible shows in the followed languages, by followers then recency', async () => {
    const c = login('u1');
    follow('u1', 'mine1', 100);
    follow('u1', 'mine2', 200);
    const r = await because(c);
    expect(r.basedOn).toEqual({ id: 'mine2', title: 'Mine 2' });
    expect(ids(r.shows)).toEqual(['enPopular', 'enFresh', 'enOld', 'frShow', 'enPrivate']);
    expect(r.shows[0].followerCount).toBe(2);
    expect(ids((await because(c, '?limit=2')).shows)).toEqual(['enPopular', 'enFresh']);
  });

  it('has nothing to suggest when the followed shows have no language', async () => {
    insertPodcastShow(db, { id: 'nolang', title: 'No language' });
    const c = login('u1');
    follow('u1', 'nolang');
    expect(await because(c)).toEqual({ basedOn: { id: 'nolang', title: 'No language' }, shows: [] });
  });

  it('ignores follows of shows the user can no longer see', async () => {
    const c = login('u1');
    follow('u1', 'enUltra');
    expect(await because(c)).toEqual({ basedOn: null, shows: [] });
  });
});

describe('accented podcast languages', () => {
  beforeEach(() => {
    insertPodcastShow(db, { id: 'fr1', language: 'Français', createdAt: 1 });
    insertPodcastShow(db, { id: 'fr2', language: 'FRANÇAIS', createdAt: 1 });
    insertPodcastShow(db, { id: 'fr3', language: 'franc\u0327ais ', createdAt: 1 });
    insertPodcastShow(db, { id: 'plain', language: 'francais', createdAt: 1 });
    insertPodcastEpisode(db, { id: 'ep1', showId: 'fr1', pubTs: 300 });
    insertPodcastEpisode(db, { id: 'ep2', showId: 'fr2', pubTs: 200 });
    insertPodcastEpisode(db, { id: 'ep3', showId: 'fr3', pubTs: 100 });
    insertPodcastEpisode(db, { id: 'ep4', showId: 'plain', pubTs: 400 });
    ['a', 'b'].forEach(user);
    follow('a', 'fr1'); follow('a', 'fr2'); follow('b', 'fr2'); follow('a', 'fr3'); follow('a', 'plain');
  });

  it('merges spellings into one language chip', async () => {
    const r: any = await languagesHandler(ev('/api/podcasts/discover/languages'));
    expect(r.languages).toEqual([{ language: 'FRANÇAIS', showCount: 3 }, { language: 'francais', showCount: 1 }]);
  });

  it('filters popular and recently updated shows by any spelling', async () => {
    for (const lang of ['français', 'FRANÇAIS', encodeURIComponent('franc\u0327ais')]) {
      const popular: any = await popularHandler(ev(`/api/podcasts/discover/popular?language=${lang}`));
      expect(ids(popular.shows)).toEqual(['fr2', 'fr1', 'fr3']);
      const recent: any = await recentlyUpdatedHandler(ev(`/api/podcasts/discover/recently-updated?language=${lang}`));
      expect(ids(recent.shows)).toEqual(['fr1', 'fr2', 'fr3']);
    }
  });

  it('suggests shows of the same language in another spelling', async () => {
    const c = login('u1');
    follow('u1', 'fr1');
    expect(ids((await becauseHandler(ev('/api/podcasts/discover/because-you-follow', c)) as any).shows)).toEqual(['fr2', 'fr3']);
  });
});

describe('GET /api/podcasts/discover/languages', () => {
  it('counts visible shows per language, grouped without regard to case', async () => {
    insertPodcastShow(db, { id: 'a', language: 'en' });
    insertPodcastShow(db, { id: 'b', language: 'EN' });
    insertPodcastShow(db, { id: 'c', language: 'en ' });
    insertPodcastShow(db, { id: 'd', language: 'fr' });
    insertPodcastShow(db, { id: 'e', language: '' });
    insertPodcastShow(db, { id: 'f', language: null });
    insertPodcastShow(db, { id: 'g', language: 'de', visibility: 'private' });
    const langs = async (cookie?: string) => ((await languagesHandler(ev('/api/podcasts/discover/languages', cookie))) as any).languages;
    expect(await langs()).toEqual([{ language: 'en', showCount: 3 }, { language: 'fr', showCount: 1 }]);
    expect(await langs(login('u1'))).toEqual([{ language: 'en', showCount: 3 }, { language: 'de', showCount: 1 }, { language: 'fr', showCount: 1 }]);
  });
});
