import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import handler from '../../server/api/home/feed.get';
import {
  createTestDb, insertUser, insertSession, insertChannel, insertVideo, insertUserHistory, insertSubscription,
  insertSetting, insertHiddenVideo, insertSeenVideo, insertPersonalPlaylist, mockEvent, sessionCookie,
} from '../helpers/testDb';

// The sections of the new home (part 2A): shapes, guests, empties, order.
let db: Database.Database;
const DAY = 86_400_000;

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
});

function loginAs(userId: string, role: 'admin' | 'user' = 'user') {
  insertUser(db, { id: userId, role });
  insertSession(db, { id: `sess-${userId}`, userId });
  return mockEvent(sessionCookie(`sess-${userId}`));
}
const guestEvent = () => mockEvent();
const setAdminDefaults = (prefs: object) => insertSetting(db, { key: 'display_defaults', value: JSON.stringify(prefs) });
const section = (r: any, id: string) => r.sections.find((s: any) => s.id === id);
const ids = (videos: any[]) => videos.map((v: any) => v.id);

/** Every video id the feed returned (hero, rows, category groups). */
function allVideoIds(r: any): string[] {
  const out: string[] = [];
  if (r.featured.large) out.push(r.featured.large.id);
  out.push(...r.featured.small.map((v: any) => v.id));
  for (const s of r.sections) {
    if (s.videos) out.push(...ids(s.videos));
    if (s.groups) for (const g of s.groups) out.push(...ids(g.videos));
  }
  return out;
}

function seedLibrary() {
  const now = Date.now();
  insertChannel(db, { id: 'gaming', title: 'Gaming Channel' });
  insertChannel(db, { id: 'music', title: 'Music Channel' });
  insertChannel(db, { id: 'cooking', title: 'Cooking Channel' });
  insertChannel(db, { id: 'secret', title: 'Secret', visibility: 'private' });
  for (let i = 0; i < 8; i++) {
    insertVideo(db, { id: `g${i}`, channelId: 'gaming', categories: ['Gaming'], tags: ['minecraft'], viewCount: 1000 + i, duration: 600, uploadDate: '20261001', createdAt: now - i * 1000 });
    insertVideo(db, { id: `m${i}`, channelId: 'music', categories: ['Music'], viewCount: 5000 + i, duration: 600, uploadDate: '20260901', createdAt: now - 10_000 - i * 1000 });
    insertVideo(db, { id: `k${i}`, channelId: 'cooking', categories: ['Howto & Style'], viewCount: 100 + i, duration: 600, uploadDate: '20260801', createdAt: now - 20_000 - i * 1000 });
  }
  insertVideo(db, { id: 'secretV', channelId: 'secret', categories: ['Gaming'], viewCount: 1e9, duration: 600 });
  for (let i = 0; i < 4; i++) insertVideo(db, { id: `s${i}`, channelId: 'gaming', isShort: true, viewCount: 10 + i, duration: 30, createdAt: now - i });
}

describe('guest home', () => {
  it('gets popular, byCategory and shorts by default, never personal rows and never private videos', async () => {
    seedLibrary();
    setAdminDefaults({ rowSize: 10 });
    const r: any = await handler(guestEvent());
    expect(r.sections.map((s: any) => s.id)).toEqual(['popular', 'byCategory', 'shorts']);
    expect(allVideoIds(r)).not.toContain('secretV');
    const shorts = section(r, 'shorts');
    expect(shorts.videos.length).toBe(4);
    expect(shorts.videos.every((v: any) => v.is_short === 1)).toBe(true);
    for (const g of section(r, 'byCategory').groups) expect(g.videos.length).toBeGreaterThan(0);
    // Guests: the most common categories of the visible library (alone, nothing claimed them).
    db.prepare("UPDATE settings SET value = ? WHERE key = 'display_defaults'").run(JSON.stringify({ homeHero: false, homeSections: ['byCategory'] }));
    const alone: any = await handler(guestEvent());
    const groups = section(alone, 'byCategory').groups;
    expect(groups.map((g: any) => g.category)).toEqual(['Gaming', 'Howto & Style', 'Music']);
    expect(groups[0]).toMatchObject({ title: 'Gaming' });
    expect(allVideoIds(alone)).not.toContain('secretV');
  });

  it('omits empty sections (no categories, no Shorts)', async () => {
    insertChannel(db, { id: 'c' });
    for (let i = 0; i < 20; i++) insertVideo(db, { id: `plain${i}`, channelId: 'c' });
    const r: any = await handler(guestEvent());
    expect(r.sections.map((s: any) => s.id)).toEqual(['popular']);
  });
});

describe('signed-in home', () => {
  function seedViewer() {
    seedLibrary();
    const event = loginAs('u1');
    const now = Date.now();
    insertSubscription(db, { userId: 'u1', channelId: 'music' });
    // Watched gaming videos (the newest one seeds "Because you watched"), one started.
    insertUserHistory(db, { userId: 'u1', videoId: 'g7', watchTimeSeconds: 600, watchedAt: now - 2 * DAY });
    insertUserHistory(db, { userId: 'u1', videoId: 'g6', watchTimeSeconds: 600, watchedAt: now - DAY });
    insertUserHistory(db, { userId: 'u1', videoId: 'g5', watchTimeSeconds: 200, positionSeconds: 200, durationSeconds: 600, positionUpdatedAt: now, watchedAt: now });
    return event;
  }

  it('builds every section in the default order, without any video twice', async () => {
    const event = seedViewer();
    insertChannel(db, { id: 'misc' });
    for (let i = 0; i < 60; i++) {
      insertChannel(db, { id: `misc${i}` });
      insertVideo(db, { id: `x${i}`, channelId: `misc${i % 20}`, categories: [i % 2 ? 'Education' : 'Gaming'], viewCount: 50 + i, duration: 600 });
    }
    insertPersonalPlaylist(db, { id: 'p1', userId: 'u1', title: 'Mine', videoIds: ['k1', 'k0'] });
    setAdminDefaults({ rowSize: 10 });
    const r: any = await handler(event);
    expect(r.sections.map((s: any) => s.id)).toEqual(['continue', 'subscriptions', 'forYou', 'popular', 'becauseYouWatched', 'byCategory', 'shorts', 'playlists', 'discoverChannels']);
    const all = allVideoIds(r);
    expect(new Set(all).size).toBe(all.length);
  });

  it('continue: the started long video with its position and progress', async () => {
    const event = seedViewer();
    setAdminDefaults({ homeHero: false, homeSections: ['continue'] });
    const r: any = await handler(event);
    expect(section(r, 'continue')).toMatchObject({ title: 'Continue watching' });
    expect(section(r, 'continue').videos).toEqual([expect.objectContaining({ id: 'g5', positionSeconds: 200, durationSeconds: 600, progress: 200 / 600 })]);
  });

  it('subscriptions: newest first, at most 2 per channel, flagged isNew without history or seen mark', async () => {
    const event = seedViewer();
    insertSubscription(db, { userId: 'u1', channelId: 'cooking' });
    insertSeenVideo(db, { userId: 'u1', videoId: 'm1' });
    insertUserHistory(db, { userId: 'u1', videoId: 'k0', watchTimeSeconds: 0 });
    setAdminDefaults({ homeHero: false, homeSections: ['subscriptions'] });
    const r: any = await handler(event);
    const videos = section(r, 'subscriptions').videos;
    expect(ids(videos)).toEqual(['m0', 'm1', 'k0', 'k1']);
    expect(videos.map((v: any) => v.isNew)).toEqual([true, false, false, true]);
  });

  it('subscriptions: honours subscriptionChannels as the number of channels', async () => {
    const event = seedViewer();
    insertSubscription(db, { userId: 'u1', channelId: 'cooking' });
    insertSubscription(db, { userId: 'u1', channelId: 'gaming' });
    setAdminDefaults({ homeHero: false, homeSections: ['subscriptions'], subscriptionChannels: 4 });
    let r: any = await handler(event);
    expect(new Set(section(r, 'subscriptions').videos.map((v: any) => v.channel_id)).size).toBe(3);
    db.prepare("UPDATE settings SET value = ? WHERE key = 'display_defaults'").run(JSON.stringify({ homeHero: false, homeSections: ['subscriptions'], subscriptionChannels: 4, rowSize: 10 }));
    r = await handler(event);
    expect(section(r, 'subscriptions').videos.length).toBeLessThanOrEqual(10);
  });

  it('forYou: recommendations with reasons, never watched, started or hidden videos', async () => {
    const event = seedViewer();
    insertHiddenVideo(db, { userId: 'u1', videoId: 'm2' });
    setAdminDefaults({ homeHero: false, homeSections: ['forYou'] });
    const r: any = await handler(event);
    const s = section(r, 'forYou');
    expect(s.title).toBe('Recommended for you');
    const got = ids(s.videos);
    for (const id of ['g7', 'g6', 'g5', 'm2']) expect(got).not.toContain(id);
    for (const v of s.videos) expect(v.reason).toEqual(expect.objectContaining({ kind: expect.any(String), label: expect.any(String) }));
    expect(s.videos.some((v: any) => v.reason.kind === 'subscription')).toBe(true);
  });

  it('becauseYouWatched: seeded by the most recently watched video, without watched ones', async () => {
    const event = seedViewer();
    setAdminDefaults({ homeHero: false, homeSections: ['becauseYouWatched'] });
    const r: any = await handler(event);
    const s = section(r, 'becauseYouWatched');
    expect(s.seed).toEqual({ id: 'g5', title: 'Video g5' });
    expect(s.title).toBe('Because you watched Video g5');
    expect(s.videos.length).toBeGreaterThan(0);
    for (const v of s.videos) expect(['g5', 'g6', 'g7']).not.toContain(v.id);
    expect(s.videos[0].channel_id).toBe('gaming');
  });

  it('byCategory: one row per top category of the profile, most watched first', async () => {
    const event = seedViewer();
    setAdminDefaults({ homeHero: false, homeSections: ['byCategory'] });
    const r: any = await handler(event);
    const groups = section(r, 'byCategory').groups;
    expect(groups[0].category).toBe('Gaming');
    expect(groups.length).toBeLessThanOrEqual(3);
    expect(groups.map((g: any) => g.category)).toEqual(['Gaming', 'Howto & Style', 'Music']);
    // Never twice across the groups.
    const all = groups.flatMap((g: any) => ids(g.videos));
    expect(new Set(all).size).toBe(all.length);
  });

  it('playlists: the 6 newest personal playlists of the viewer with cover and count', async () => {
    const event = seedViewer();
    loginAs('u2');
    insertChannel(db, { id: 'ultra', visibility: 'ultra_private' });
    insertVideo(db, { id: 'u0', channelId: 'ultra' });
    for (let i = 0; i < 7; i++) insertPersonalPlaylist(db, { id: `p${i}`, userId: 'u1', createdAt: 1000 + i, videoIds: i === 6 ? ['u0', 'k3', 'secretV'] : [] });
    insertPersonalPlaylist(db, { id: 'other', userId: 'u2', visibility: 'public', createdAt: 99_999 });
    setAdminDefaults({ homeHero: false, homeSections: ['playlists'] });
    const r: any = await handler(event);
    const lists = section(r, 'playlists').playlists;
    expect(lists.map((p: any) => p.id)).toEqual(['p6', 'p5', 'p4', 'p3', 'p2', 'p1']);
    // Counts and covers only use videos the viewer may see (secretV is private: a member sees it; u0 is not).
    expect(lists[0]).toMatchObject({ title: 'Playlist p6', video_count: 2, cover_video_id: 'k3' });
    expect(lists[1]).toMatchObject({ video_count: 0, cover_video_id: null });
  });

  it('discoverChannels: unfollowed, little-watched channels, with avatar, count and categories', async () => {
    const event = seedViewer();
    setAdminDefaults({ homeHero: false, homeSections: ['discoverChannels'] });
    const r: any = await handler(event);
    const channels = section(r, 'discoverChannels').channels;
    const got = channels.map((c: any) => c.id);
    // music is followed, gaming is watched a lot.
    expect(got).not.toContain('music');
    expect(got).not.toContain('gaming');
    expect(got).toContain('cooking');
    expect(channels.find((c: any) => c.id === 'cooking')).toMatchObject({ title: 'Cooking Channel', video_count: 8, categories: ['Howto & Style'] });
  });

  it('a guest never gets the personal sections, even when listed', async () => {
    seedLibrary();
    setAdminDefaults({ homeSections: ['continue', 'subscriptions', 'forYou', 'becauseYouWatched', 'playlists', 'discoverChannels', 'popular'] });
    const r: any = await handler(guestEvent());
    expect(r.sections.map((s: any) => s.id)).toEqual(['popular']);
  });

  it('an admin sees private channels in the rows', async () => {
    seedLibrary();
    const event = loginAs('ad', 'admin');
    setAdminDefaults({ homeHero: false, homeSections: ['popular'] });
    const r: any = await handler(event);
    expect(ids(section(r, 'popular').videos)[0]).toBe('secretV');
  });
});
