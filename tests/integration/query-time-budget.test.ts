import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { performance } from 'perf_hooks';
import type Database from 'better-sqlite3';
import { assertInTmp, mockEvent, sessionCookie } from '../helpers/testDb';
import { seedBigLibrary, REGRESSION_SIZES } from '../helpers/bigLibrary';
import { getUserFromSession } from '../../server/utils/auth';
import feedHandler from '../../server/api/home/feed.get';
import videosHandler from '../../server/api/videos/index.get';
import exploreHandler from '../../server/api/music/artists/explore.get';
import likedMixHandler from '../../server/api/music/playlists/liked-mix.get';
import genresHandler from '../../server/api/music/genres/index.get';
import recentAlbumsHandler from '../../server/api/music/albums/recent.get';
import mostPlayedHandler from '../../server/api/music/playlists/most-played.get';
import rediscoverHandler from '../../server/api/music/playlists/rediscover.get';
import musicHistoryHandler from '../../server/api/music/history/index.get';
import artistsHandler from '../../server/api/music/artists/index.get';
import podcastHistoryHandler from '../../server/api/podcasts/history/index.get';
import trendingHandler from '../../server/api/podcasts/discover/trending.get';
import popularHandler from '../../server/api/podcasts/discover/popular.get';
import recentlyUpdatedHandler from '../../server/api/podcasts/discover/recently-updated.get';
import becauseHandler from '../../server/api/podcasts/discover/because-you-follow.get';

// Discover, home and history queries on a ~20k-track / 30k-play library (real
// schema and indexes). A per-row correlated subquery made "artists to explore"
// take over a minute here; every route must stay far below the budget.
const BUDGET_MS = 1500;
const { openDatabase } = await vi.importActual<typeof import('../../server/utils/db')>('../../server/utils/db');

let dir: string;
let db: Database.Database;

beforeAll(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yk-query-budget-'));
  assertInTmp(dir);
  db = openDatabase(path.join(dir, 'youkeep.db'));
  seedBigLibrary(db, REGRESSION_SIZES);
  (globalThis as any).getDb = () => db;
  (globalThis as any).getUserFromSession = getUserFromSession;
});
afterAll(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const ROUTES: Array<[string, (e: any) => any, string]> = [
  ['home feed', feedHandler, '/api/home/feed'],
  ['videos', videosHandler, '/api/videos'],
  ['artists to explore', exploreHandler, '/api/music/artists/explore'],
  ['liked mix', likedMixHandler, '/api/music/playlists/liked-mix?seed=s'],
  ['genres', genresHandler, '/api/music/genres'],
  ['recent albums', recentAlbumsHandler, '/api/music/albums/recent'],
  ['most played', mostPlayedHandler, '/api/music/playlists/most-played'],
  ['rediscover', rediscoverHandler, '/api/music/playlists/rediscover'],
  ['music history', musicHistoryHandler, '/api/music/history'],
  ['artists', artistsHandler, '/api/music/artists'],
  ['podcast history', podcastHistoryHandler, '/api/podcasts/history'],
  ['podcast trending', trendingHandler, '/api/podcasts/discover/trending'],
  ['podcast popular', popularHandler, '/api/podcasts/discover/popular'],
  ['podcast recently updated', recentlyUpdatedHandler, '/api/podcasts/discover/recently-updated'],
  ['podcast because you follow', becauseHandler, '/api/podcasts/discover/because-you-follow'],
];
const WHO: Array<[string, string | undefined]> = [
  ['guest', undefined], ['heavy listener', sessionCookie('sess-heavy')], ['admin', sessionCookie('sess-admin')],
];

describe('query time budget on a big library', () => {
  for (const [name, handler, url] of ROUTES) {
    it(`${name} answers within ${BUDGET_MS} ms for every role`, async () => {
      for (const [who, cookie] of WHO) {
        const start = performance.now();
        try {
          await handler(mockEvent(cookie, { path: url }));
        } catch (e: any) {
          if (e?.statusCode !== 401) throw e; // personal routes refuse guests
        }
        const ms = performance.now() - start;
        expect(ms, `${name} as ${who}`).toBeLessThan(BUDGET_MS);
      }
    }, 120_000);
  }

  it('the home feed stays within budget with every popularity ranking', async () => {
    for (const ranking of ['localViewers', 'trending7d', 'watchTime', 'youtubeViews']) {
      db.prepare(`INSERT INTO user_preferences (user_id, data, updated_at) VALUES ('heavy', ?, 0)
        ON CONFLICT(user_id) DO UPDATE SET data = excluded.data`).run(JSON.stringify({ popularRanking: ranking }));
      const start = performance.now();
      await feedHandler(mockEvent(sessionCookie('sess-heavy'), { path: '/api/home/feed' }));
      expect(performance.now() - start, ranking).toBeLessThan(BUDGET_MS);
    }
  }, 120_000);
});
