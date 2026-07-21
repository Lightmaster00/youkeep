import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import handler from '../../server/api/home/feed.get';
import {
  createTestDb,
  insertUser,
  insertSession,
  insertChannel,
  insertVideo,
  insertUserHistory,
  insertSubscription,
  mockEvent,
  sessionCookie
} from '../helpers/testDb';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
});

function loginAs(userId: string) {
  insertUser(db, { id: userId, role: 'user' });
  const sessionId = `sess-${userId}`;
  insertSession(db, { id: sessionId, userId });
  return mockEvent(sessionCookie(sessionId));
}

const guestEvent = () => mockEvent();

describe('GET /api/home/feed', () => {
  it('omits suggested and subscriptions sections for a guest', async () => {
    insertChannel(db, { id: 'c1' });
    insertVideo(db, { id: 'v1', channelId: 'c1', uploadDate: '20260101' });
    const result: any = await handler(guestEvent());
    const sectionIds = result.sections.map((s: any) => s.id);
    expect(sectionIds).not.toContain('suggested');
    expect(sectionIds).not.toContain('subscriptions');
  });

  it('includes suggested and subscriptions sections for a logged-in user with data', async () => {
    insertChannel(db, { id: 'c1' });
    insertChannel(db, { id: 'c2' });
    // c1 is a large, recent, popular "filler" channel: it deterministically
    // fills (and is fully eligible to fill) the recent/popular sections on
    // its own, since every c1 video is newer and more-viewed than every c2
    // video. c2 (subscribed, old, unpopular) is therefore never selected by
    // the recentPool/popularPool SQL queries (LIMIT 30 each), so — now that
    // every section claims its picks into usedIds — c2's videos remain
    // available for the suggested/subscriptions sections regardless of how
    // much of c1 the recent/popular sections consume.
    for (let i = 0; i < 30; i++) {
      insertVideo(db, { id: `c1v${i}`, channelId: 'c1', uploadDate: '20260101', viewCount: 100000 - i, createdAt: Date.now() - i * 1000 });
    }
    for (let i = 0; i < 30; i++) {
      insertVideo(db, { id: `c2v${i}`, channelId: 'c2', uploadDate: '20200101', viewCount: 0, createdAt: 1000 + i });
    }
    const event = loginAs('u1');
    insertSubscription(db, { userId: 'u1', channelId: 'c2' });
    const result: any = await handler(event);
    const sectionIds = result.sections.map((s: any) => s.id);
    expect(sectionIds).toContain('suggested');
    expect(sectionIds).toContain('subscriptions');
  });

  it('never shows the same video ID twice anywhere in the response (featured, or across sections)', async () => {
    insertChannel(db, { id: 'c1' });
    // 30 videos is comfortably more than the 15+15 caps on recentSection and
    // popularSection, and view_count/created_at are ordered identically here,
    // so — absent proper cross-section exclusion — recentPool and popularPool
    // would independently pick largely the same leftover videos after the
    // featured block is filled. This is the shape that previously produced
    // fully identical recent/popular sections.
    for (let i = 0; i < 30; i++) {
      insertVideo(db, { id: `v${i}`, channelId: 'c1', uploadDate: '20260101', viewCount: 1000 - i, createdAt: Date.now() - i * 1000 });
    }
    const result: any = await handler(guestEvent());

    const allIds: string[] = [];
    if (result.featured.large) allIds.push(result.featured.large.id);
    for (const v of result.featured.small) allIds.push(v.id);
    for (const section of result.sections) {
      if (section.videos) {
        for (const v of section.videos) allIds.push(v.id);
      }
      if (section.channels) {
        for (const ch of section.channels) {
          for (const v of ch.videos) allIds.push(v.id);
        }
      }
    }

    expect(allIds.length).toBeGreaterThan(0);
    expect(allIds.length).toBe(new Set(allIds).size);
  });

  it('excludes a subscribed channel row entirely if the user has fewer than 2 visible videos left from it after exclusion', async () => {
    insertChannel(db, { id: 'c1' });
    insertVideo(db, { id: 'v1', channelId: 'c1', uploadDate: '20260101', viewCount: 1000 });
    const event = loginAs('u1');
    insertSubscription(db, { userId: 'u1', channelId: 'c1' });
    const result: any = await handler(event);
    const subsSection = result.sections.find((s: any) => s.id === 'subscriptions');
    // c1's only video is very likely to be the featured "large" pick (highest view_count),
    // leaving 0 videos for its subscription row, so the row should not appear.
    if (subsSection) {
      expect(subsSection.channels.find((c: any) => c.channelId === 'c1')).toBeUndefined();
    }
  });

  it('orders the popular section by local viewers first, view_count as tiebreaker', async () => {
    insertChannel(db, { id: 'c1' });
    insertVideo(db, { id: 'v1', channelId: 'c1', uploadDate: '20260101', viewCount: 1000000 });
    insertVideo(db, { id: 'v2', channelId: 'c1', uploadDate: '20260101', viewCount: 10 });
    insertUser(db, { id: 'watcher', role: 'user' });
    insertUserHistory(db, { userId: 'watcher', videoId: 'v2' });
    const result: any = await handler(guestEvent());
    // v2 has a local viewer and no session data was requested by guests, but local
    // popularity is a property of the video, not the requester, so it still ranks first.
    const allPopular = [
      ...(result.featured.large ? [result.featured.large] : []),
      ...result.featured.small,
      ...(result.sections.find((s: any) => s.id === 'popular')?.videos ?? [])
    ];
    const v1Index = allPopular.findIndex((v: any) => v.id === 'v1');
    const v2Index = allPopular.findIndex((v: any) => v.id === 'v2');
    expect(v2Index).toBeLessThan(v1Index);
  });
});
