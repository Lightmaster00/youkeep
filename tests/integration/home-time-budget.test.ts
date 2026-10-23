import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { performance } from 'perf_hooks';
import type Database from 'better-sqlite3';
import { assertInTmp, mockEvent, sessionCookie } from '../helpers/testDb';
import { seedBigLibrary } from '../helpers/bigLibrary';
import { getUserFromSession } from '../../server/utils/auth';
import { getRecommendedVideos } from '../../server/utils/recommend';
import feedHandler from '../../server/api/home/feed.get';
import subscriptionsFeedHandler from '../../server/api/subscriptions/feed.get';
import subscriptionsChannelsHandler from '../../server/api/subscriptions/channels.get';
import continueHandler from '../../server/api/videos/continue.get';

// The new home on a 20k-video library with 50k history rows (real schema and
// indexes): one Node process answers every request synchronously, so these
// must stay far below a noticeable pause.
const FEED_BUDGET_MS = 1500;
const RECOMMEND_BUDGET_MS = 500;
const SUBSCRIPTIONS_BUDGET_MS = 500;
const HISTORY_ROWS = 50_000;
const CATEGORIES = ['Gaming', 'Music', 'Education', 'Entertainment', 'Science & Technology', 'Howto & Style', 'Sports', 'News & Politics'];
const { openDatabase } = await vi.importActual<typeof import('../../server/utils/db')>('../../server/utils/db');

let dir: string;
let db: Database.Database;

beforeAll(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yk-home-budget-'));
  assertInTmp(dir);
  db = openDatabase(path.join(dir, 'youkeep.db'));
  seedBigLibrary(db, {
    channels: 200, videos: 20_000, artists: 10, tracks: 100, shows: 5, episodes: 100,
    plays: 100, videoHistory: 20_000, favorites: 10, progress: 10,
  });
  const now = Date.now();
  db.transaction(() => {
    const cat = db.prepare('UPDATE videos SET categories = ?, tags = ?, metadata_enriched_at = ? WHERE id = ?');
    for (let i = 0; i < 20_000; i++) {
      cat.run(JSON.stringify([CATEGORIES[i % CATEGORIES.length]]), JSON.stringify([`tag${i % 300}`, `tag${i % 47}`, `topic${i % 97}`]), now, `v${i}`);
    }
    // Top up the history to HISTORY_ROWS rows over more users, with resume positions.
    const user = db.prepare("INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?, ?, 'x', 'user', ?)");
    const history = db.prepare(`INSERT OR IGNORE INTO user_history (user_id, video_id, watched_at, watch_time_seconds, position_seconds, duration_seconds, position_updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`);
    let n = (db.prepare('SELECT COUNT(*) AS n FROM user_history').get() as { n: number }).n;
    for (let u = 0; n < HISTORY_ROWS; u++) {
      user.run(`extra${u}`, `extra${u}`, now);
      for (let i = 0; i < 5000 && n < HISTORY_ROWS; i++) {
        history.run(`extra${u}`, `v${(i * 13 + u) % 20_000}`, now - (i % 60) * 86_400_000, i % 700, i % 500, 600, now - i * 1000);
        n++;
      }
    }
    // The heavy user has started some videos (Continue watching) and seen others.
    db.prepare("UPDATE user_history SET position_seconds = 120, duration_seconds = 1200, position_updated_at = watched_at WHERE user_id = 'heavy' AND rowid % 10 = 0").run();
    const seen = db.prepare("INSERT OR IGNORE INTO user_seen_videos (user_id, video_id, seen_at) VALUES ('heavy', ?, ?)");
    for (let i = 0; i < 2000; i++) seen.run(`v${i * 3}`, now);
  })();
  db.exec('ANALYZE');
  (globalThis as any).getDb = () => db;
  (globalThis as any).getUserFromSession = getUserFromSession;
  expect((db.prepare('SELECT COUNT(*) AS n FROM user_history').get() as { n: number }).n).toBeGreaterThanOrEqual(HISTORY_ROWS);
});
afterAll(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const WHO: Array<[string, string | undefined]> = [['guest', undefined], ['heavy viewer', sessionCookie('sess-heavy')], ['admin', sessionCookie('sess-admin')]];

async function timed(fn: () => unknown): Promise<number> {
  await fn(); // warm the statement cache
  const start = performance.now();
  await fn();
  return performance.now() - start;
}

describe('new home time budget (20k videos, 50k history rows)', () => {
  it(`the home feed with every section answers within ${FEED_BUDGET_MS} ms for every role`, async () => {
    db.prepare('DELETE FROM settings WHERE key = ?').run('display_defaults');
    for (const [who, cookie] of WHO) {
      let sections: string[] = [];
      const ms = await timed(async () => {
        const r: any = await feedHandler(mockEvent(cookie, { path: '/api/home/feed' }));
        sections = r.sections.map((s: any) => s.id);
      });
      expect(ms, `${who}: ${ms.toFixed(0)} ms`).toBeLessThan(FEED_BUDGET_MS);
      if (who === 'heavy viewer') {
        expect(sections).toEqual(expect.arrayContaining(['continue', 'subscriptions', 'forYou', 'popular', 'becauseYouWatched', 'byCategory', 'shorts', 'discoverChannels']));
      }
    }
  });

  it(`recommendations answer within ${RECOMMEND_BUDGET_MS} ms`, async () => {
    for (const viewer of [null, { id: 'heavy', role: 'user' as const }, { id: 'admin', role: 'admin' as const }]) {
      let count = 0;
      const ms = await timed(() => { count = getRecommendedVideos(db, viewer, { type: 'video', limit: 30 }).length; });
      expect(ms, `${viewer?.id ?? 'guest'}: ${ms.toFixed(0)} ms`).toBeLessThan(RECOMMEND_BUDGET_MS);
      expect(count).toBe(30);
    }
  });

  it(`the subscriptions feed, channels and continue watching answer within ${SUBSCRIPTIONS_BUDGET_MS} ms`, async () => {
    for (const [name, handler, url] of [
      ['feed', subscriptionsFeedHandler, '/api/subscriptions/feed?limit=48'],
      ['feed by popularity, page 3', subscriptionsFeedHandler, '/api/subscriptions/feed?sort=popular&page=3'],
      ['feed of one category', subscriptionsFeedHandler, '/api/subscriptions/feed?category=Gaming'],
      ['channels', subscriptionsChannelsHandler, '/api/subscriptions/channels'],
      ['continue', continueHandler, '/api/videos/continue'],
    ] as const) {
      const ms = await timed(() => (handler as any)(mockEvent(sessionCookie('sess-heavy'), { path: url })));
      expect(ms, `${name}: ${ms.toFixed(0)} ms`).toBeLessThan(SUBSCRIPTIONS_BUDGET_MS);
    }
  });
});
