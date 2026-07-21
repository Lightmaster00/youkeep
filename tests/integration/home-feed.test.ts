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
    insertVideo(db, { id: 'v1', channelId: 'c1', uploadDate: '20260101' });
    insertVideo(db, { id: 'v2', channelId: 'c2', uploadDate: '20260101' });
    insertVideo(db, { id: 'v3', channelId: 'c2', uploadDate: '20260102' });
    const event = loginAs('u1');
    insertSubscription(db, { userId: 'u1', channelId: 'c2' });
    const result: any = await handler(event);
    const sectionIds = result.sections.map((s: any) => s.id);
    expect(sectionIds).toContain('suggested');
    expect(sectionIds).toContain('subscriptions');
  });

  it('never shows the same video in both the featured block and a section', async () => {
    insertChannel(db, { id: 'c1' });
    for (let i = 0; i < 10; i++) {
      insertVideo(db, { id: `v${i}`, channelId: 'c1', uploadDate: '20260101', viewCount: 100 - i, createdAt: Date.now() - i * 1000 });
    }
    const result: any = await handler(guestEvent());
    const featuredIds = new Set([
      ...(result.featured.large ? [result.featured.large.id] : []),
      ...result.featured.small.map((v: any) => v.id)
    ]);
    for (const section of result.sections) {
      if (section.videos) {
        for (const v of section.videos) {
          expect(featuredIds.has(v.id)).toBe(false);
        }
      }
    }
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
