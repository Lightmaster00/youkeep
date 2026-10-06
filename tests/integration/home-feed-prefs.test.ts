import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import handler from '../../server/api/home/feed.get';
import { createApiToken } from '../../server/utils/apiTokens';
import {
  createTestDb, insertUser, insertSession, insertChannel, insertVideo, insertUserHistory,
  insertSubscription, insertSetting, insertUserPreferences, mockEvent, sessionCookie,
} from '../helpers/testDb';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
});

function loginAs(userId: string) {
  insertUser(db, { id: userId, role: 'user' });
  insertSession(db, { id: `sess-${userId}`, userId });
  return mockEvent(sessionCookie(`sess-${userId}`));
}
const guestEvent = () => mockEvent();
const setAdminDefaults = (prefs: object) => insertSetting(db, { key: 'display_defaults', value: JSON.stringify(prefs) });
const ids = (section: any) => section.videos.map((v: any) => v.id);
const sectionIds = (r: any) => r.sections.map((s: any) => s.id);

function seedVideos(n: number, channelId = 'c1') {
  insertChannel(db, { id: channelId });
  for (let i = 0; i < n; i++) {
    insertVideo(db, { id: `${channelId}v${i}`, channelId, uploadDate: '20260101', viewCount: 1000 - i, createdAt: Date.now() - i * 1000 });
  }
}

describe('homeSections', () => {
  it('keeps the historical guest order recent → popular by default, then honours the configured order and omissions', async () => {
    seedVideos(40);
    let r: any = await handler(guestEvent());
    expect(sectionIds(r)).toEqual(['recent', 'popular']);
    expect(r.featured.large).not.toBeNull();
    setAdminDefaults({ homeSections: ['popular', 'recent'] });
    r = await handler(guestEvent());
    expect(sectionIds(r)).toEqual(['popular', 'recent']);
    db.prepare("UPDATE settings SET value = ? WHERE key = 'display_defaults'").run(JSON.stringify({ homeSections: ['recent'] }));
    r = await handler(guestEvent());
    expect(sectionIds(r)).toEqual(['recent']);
  });

  it('returns no sections but still a hero when the list is empty', async () => {
    seedVideos(10);
    setAdminDefaults({ homeSections: [] });
    const r: any = await handler(guestEvent());
    expect(r.sections).toEqual([]);
    expect(r.featured.large).not.toBeNull();
  });

  it('ignores suggested and subscriptions for a guest without failing', async () => {
    seedVideos(40);
    setAdminDefaults({ homeSections: ['suggested', 'subscriptions', 'recent'] });
    const r: any = await handler(guestEvent());
    expect(sectionIds(r)).toEqual(['recent']);
  });

  it('never repeats a video across hero and sections whatever the order', async () => {
    seedVideos(60);
    setAdminDefaults({ homeSections: ['popular', 'recent'] });
    const r: any = await handler(guestEvent());
    const all = [r.featured.large?.id, ...r.featured.small.map((v: any) => v.id), ...r.sections.flatMap(ids)].filter(Boolean);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('homeHero', () => {
  it('returns an empty hero and reserves no video when hidden', async () => {
    seedVideos(5);
    setAdminDefaults({ homeHero: false, homeSections: ['popular'] });
    const r: any = await handler(guestEvent());
    expect(r.featured).toEqual({ large: null, small: [] });
    // c1v0 has the highest view_count: with the hero on it would be the hero; hidden, it leads the popular row.
    expect(ids(r.sections[0])[0]).toBe('c1v0');
    expect(ids(r.sections[0])).toHaveLength(5);
  });
});

describe('popularRanking', () => {
  function seedRankingDataset() {
    insertChannel(db, { id: 'c1' });
    const now = Date.now();
    const old = now - 30 * 24 * 3600 * 1000;
    for (const [id, views] of [['A', 1000], ['B', 10], ['C', 500], ['D', 1]] as const) {
      insertVideo(db, { id, channelId: 'c1', viewCount: views, createdAt: now });
    }
    for (const u of ['u1', 'u2', 'u3']) insertUser(db, { id: u, role: 'user' });
    insertUserHistory(db, { userId: 'u1', videoId: 'B', watchTimeSeconds: 5, watchedAt: old });
    insertUserHistory(db, { userId: 'u2', videoId: 'B', watchTimeSeconds: 5, watchedAt: old });
    insertUserHistory(db, { userId: 'u1', videoId: 'C', watchTimeSeconds: 100, watchedAt: now });
    insertUserHistory(db, { userId: 'u1', videoId: 'D', watchTimeSeconds: 1, watchedAt: old });
    insertUserHistory(db, { userId: 'u2', videoId: 'D', watchTimeSeconds: 1, watchedAt: old });
    insertUserHistory(db, { userId: 'u3', videoId: 'D', watchTimeSeconds: 1, watchedAt: old });
  }

  it.each([
    ['localViewers', ['D', 'B', 'C', 'A']],
    ['youtubeViews', ['A', 'C', 'B', 'D']],
    ['trending7d', ['C', 'A', 'B', 'D']],
    ['watchTime', ['C', 'B', 'D', 'A']],
  ])('%s orders the popular row as %j', async (ranking, expected) => {
    seedRankingDataset();
    setAdminDefaults({ homeHero: false, homeSections: ['popular'], popularRanking: ranking });
    const r: any = await handler(guestEvent());
    expect(ids(r.sections[0])).toEqual(expected);
  });

  it('also uses the ranking to choose the hero large video', async () => {
    seedRankingDataset();
    setAdminDefaults({ popularRanking: 'youtubeViews' });
    const r: any = await handler(guestEvent());
    expect(r.featured.large.id).toBe('A');
  });
});

describe('logged-in viewers', () => {
  const allIds = (r: any) => [
    r.featured.large?.id,
    ...r.featured.small.map((v: any) => v.id),
    ...r.sections.flatMap((s: any) => s.videos ? ids(s) : s.channels.flatMap((c: any) => c.videos.map((v: any) => v.id))),
  ].filter(Boolean);

  it('with the hero off, suggested then recent both appear without duplicates', async () => {
    seedVideos(30, 'c1');
    seedVideos(30, 'c2');
    const event = loginAs('viewer');
    insertUserHistory(db, { userId: 'viewer', videoId: 'c1v0', watchTimeSeconds: 50, watchedAt: Date.now() });
    setAdminDefaults({ homeHero: false, homeSections: ['suggested', 'recent'] });
    const r: any = await handler(event);
    expect(sectionIds(r)).toEqual(['suggested', 'recent']);
    const all = allIds(r);
    expect(new Set(all).size).toBe(all.length);
  });

  it('a subscriber never sees a video twice across hero and sections', async () => {
    seedVideos(30, 'c1');
    seedVideos(30, 'c2');
    const event = loginAs('viewer');
    insertSubscription(db, { userId: 'viewer', channelId: 'c1' });
    insertUserHistory(db, { userId: 'viewer', videoId: 'c2v0', watchTimeSeconds: 50, watchedAt: Date.now() });
    const r: any = await handler(event);
    expect(sectionIds(r)).toEqual(['recent', 'popular', 'suggested', 'subscriptions']);
    expect(r.featured.large).not.toBeNull();
    const all = allIds(r);
    expect(all.length).toBeGreaterThan(5);
    expect(new Set(all).size).toBe(all.length);
    expect(r.featured.small.every((v: any) => v.channel_id !== 'c1')).toBe(true);
  });
});

describe('subscriptions section', () => {
  it('drops a subscribed channel with fewer than 2 videos left after the hero claimed its only one (and the section when empty)', async () => {
    insertChannel(db, { id: 'c1' });
    insertVideo(db, { id: 'v1', channelId: 'c1', uploadDate: '20260101', viewCount: 1000 });
    const event = loginAs('u1');
    insertSubscription(db, { userId: 'u1', channelId: 'c1' });
    const r: any = await handler(event);
    expect(r.featured.large.id).toBe('v1');
    expect(sectionIds(r)).not.toContain('subscriptions');
  });
});

describe('sizes', () => {
  it('limits a row to rowSize', async () => {
    seedVideos(40);
    setAdminDefaults({ homeHero: false, homeSections: ['popular'], rowSize: 10 });
    const r: any = await handler(guestEvent());
    expect(ids(r.sections[0])).toHaveLength(10);
  });

  it('fills a 30-video row even after the hero and earlier sections claimed videos', async () => {
    seedVideos(80);
    setAdminDefaults({ homeSections: ['recent', 'popular'], rowSize: 30 });
    const r: any = await handler(guestEvent());
    expect(ids(r.sections.find((s: any) => s.id === 'recent'))).toHaveLength(30);
    expect(ids(r.sections.find((s: any) => s.id === 'popular'))).toHaveLength(30);
  });

  it('limits the subscription channels to subscriptionChannels', async () => {
    const event = loginAs('u1');
    for (let c = 0; c < 6; c++) {
      seedVideos(3, `ch${c}`);
      insertSubscription(db, { userId: 'u1', channelId: `ch${c}` });
    }
    setAdminDefaults({ homeHero: false, homeSections: ['subscriptions'], subscriptionChannels: 4 });
    const r: any = await handler(event);
    expect(r.sections[0].channels).toHaveLength(4);
  });
});

describe('preference sources', () => {
  it('a user override wins over the admin default', async () => {
    seedVideos(40);
    const event = loginAs('u1');
    setAdminDefaults({ homeSections: ['recent'] });
    insertUserPreferences(db, { userId: 'u1', data: JSON.stringify({ homeSections: ['popular'] }) });
    const r: any = await handler(event);
    expect(sectionIds(r)).toEqual(['popular']);
  });

  it('a corrupt stored row falls back to defaults without failing', async () => {
    seedVideos(40);
    const event = loginAs('u1');
    insertUserPreferences(db, { userId: 'u1', data: '{not json' });
    const r: any = await handler(event);
    expect(sectionIds(r)).toContain('recent');
  });
});

describe('Bearer token caller', () => {
  it('gets the preferences stored for the token owner', async () => {
    seedVideos(40);
    insertUser(db, { id: 'u1', role: 'user' });
    insertUserPreferences(db, { userId: 'u1', data: JSON.stringify({ homeSections: ['popular'] }) });
    const created = createApiToken('u1', 'My Phone');
    const event = mockEvent(undefined, { headers: { authorization: `Bearer ${created.token}` } });
    const r: any = await handler(event);
    expect(sectionIds(r)).toEqual(['popular']);
  });
});

describe('lazy recent/popular sizing', () => {
  it('keeps a full recent row after a section that claims most of the newest videos', async () => {
    const now = Date.now();
    insertChannel(db, { id: 'old' });
    for (let i = 0; i < 120; i++) {
      insertVideo(db, { id: `old${i}`, channelId: 'old', uploadDate: '20250101', viewCount: 10, createdAt: now - 1_000_000 - i * 1000 });
    }
    const event = loginAs('u1');
    for (let c = 0; c < 8; c++) {
      insertChannel(db, { id: `sub${c}` });
      insertSubscription(db, { userId: 'u1', channelId: `sub${c}` });
      for (let i = 0; i < 12; i++) {
        insertVideo(db, { id: `sub${c}v${i}`, channelId: `sub${c}`, uploadDate: '20260101', viewCount: 5, createdAt: now - (c * 12 + i) * 10 });
      }
    }
    insertUserPreferences(db, { userId: 'u1', data: JSON.stringify({ homeSections: ['subscriptions', 'recent'], homeHero: false, rowSize: 15 }) });
    const r: any = await handler(event);
    expect(sectionIds(r)).toEqual(['subscriptions', 'recent']);
    const recent = r.sections.find((s: any) => s.id === 'recent');
    expect(recent.videos).toHaveLength(15);
    const all = r.sections.flatMap((s: any) => s.id === 'subscriptions' ? s.channels.flatMap(ids) : ids(s));
    expect(new Set(all).size).toBe(all.length);
  });
});
