import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type Database from 'better-sqlite3';
import * as auth from '../../server/utils/auth';
import { createApiToken } from '../../server/utils/apiTokens';
import { assertInTmp, mockEvent, sessionCookie } from '../helpers/testDb';
import channelsIndex from '../../server/api/channels/index.get';
import categoriesGet from '../../server/api/channels/categories.get';
import discoverGet from '../../server/api/channels/discover.get';
import channelGet from '../../server/api/channels/[id].get';
import categoriesPut from '../../server/api/admin/channels/[id]/categories.put';

// The channels directory: filters (category, title search, following),
// sorts, paging, the category counts, the Discover strip and the admin's
// category override. Real schema (description/banner_url are real-only).
const { openDatabase } = await vi.importActual<typeof import('../../server/utils/db')>('../../server/utils/db');

let dir: string;
let db: Database.Database;
let adminToken: string;
const ADMIN = sessionCookie('sess-admin');
const BOB = sessionCookie('sess-bob');
const NOW = Date.now();
const DAY = 86_400_000;

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yk-channels-disc-'));
  assertInTmp(dir);
  db = openDatabase(path.join(dir, 'youkeep.db'));
  (globalThis as any).getDb = () => db;
  Object.assign(globalThis as any, auth);
  for (const [id, role] of [['admin', 'admin'], ['bob', 'user']]) {
    db.prepare('INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)').run(id, id, 'x', role, NOW);
    db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').run(`sess-${id}`, id, NOW + 3_600_000);
  }
  adminToken = createApiToken('admin', 'script').token;
  const channel = db.prepare('INSERT INTO channels (id, title, visibility, categories, categories_override, created_at) VALUES (?, ?, ?, ?, ?, 0)');
  channel.run('alpha', 'Alpha Games', 'public', '["Gaming","Education"]', null);
  channel.run('beta', 'beta music', 'public', '["Music"]', null);
  channel.run('gamma', 'Gamma', 'public', '["Gaming"]', '["Comedy"]');
  channel.run('priv', 'Private Cooking', 'private', '["Howto & Style"]', null);
  channel.run('ultra', 'Ultra Secret', 'ultra_private', '["Secret Cat"]', null);
  channel.run('empty', 'Zulu Empty', 'public', null, null);
  const video = db.prepare(`INSERT INTO videos (id, title, channel_id, visibility, download_status, upload_date, view_count, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  // alpha: 3 completed (1 private video), newest upload 2026-01-05.
  video.run('a1', 'A1', 'alpha', 'public', 'completed', '20260101', 100, NOW - 30 * DAY);
  video.run('a2', 'A2', 'alpha', 'public', 'completed', '20260105', 100, NOW - 30 * DAY);
  video.run('a3', 'A3', 'alpha', 'private', 'completed', '20260103', 100, NOW - 30 * DAY);
  // beta: 2 completed, newest upload 2026-03-01; one pending, newer, not counted for "recent".
  video.run('b1', 'B1', 'beta', 'public', 'completed', '20260301', 5000, NOW - DAY);
  video.run('b2', 'B2', 'beta', 'public', 'completed', '20260201', 5000, NOW - DAY);
  video.run('b3', 'B3', 'beta', 'public', 'pending', '20261001', 0, NOW);
  // gamma: 1 completed, oldest.
  video.run('g1', 'G1', 'gamma', 'public', 'completed', '20250101', 10, NOW - 60 * DAY);
  video.run('p1', 'P1', 'priv', 'public', 'completed', '20260401', 1, NOW - 60 * DAY);
  video.run('u1', 'U1', 'ultra', 'public', 'completed', '20260401', 1, NOW - 60 * DAY);
});
afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const list = (cookie: string | undefined, query = '') => channelsIndex(mockEvent(cookie, { path: `/api/channels${query}` })) as Promise<any>;
const ids = (r: any) => r.channels.map((c: any) => c.id);
const status = async (p: Promise<any>) => { try { await p; return 200; } catch (e: any) { return e?.statusCode ?? 500; } };

describe('GET /api/channels', () => {
  it('lists what each viewer may see, with effective categories and a total', async () => {
    const guest = await list(undefined);
    expect(ids(guest)).toEqual(['alpha', 'beta', 'gamma', 'empty']);
    expect(guest.total).toBe(4);
    expect(guest.channels.find((c: any) => c.id === 'alpha').categories).toEqual(['Gaming', 'Education']);
    // The override wins over the automatic categories.
    expect(guest.channels.find((c: any) => c.id === 'gamma').categories).toEqual(['Comedy']);
    expect(guest.channels.find((c: any) => c.id === 'empty').categories).toEqual([]);
    // Counts cover visible videos only.
    expect(guest.channels.find((c: any) => c.id === 'alpha')).toMatchObject({ completed_count: 2, total_count: 2 });
    expect(ids(await list(BOB))).toEqual(['alpha', 'beta', 'gamma', 'priv', 'empty']);
    expect(ids(await list(ADMIN))).toHaveLength(6);
  });

  it('category= matches the effective categories, ignoring case', async () => {
    expect(ids(await list(undefined, '?category=gaming'))).toEqual(['alpha']);
    expect(ids(await list(undefined, '?category=COMEDY'))).toEqual(['gamma']);
    expect(ids(await list(undefined, '?category=Howto%20%26%20Style'))).toEqual([]);
    expect(ids(await list(BOB, '?category=Howto%20%26%20Style'))).toEqual(['priv']);
    expect(ids(await list(BOB, '?category=Secret%20Cat'))).toEqual([]);
    expect((await list(undefined, '?category=gaming')).total).toBe(1);
  });

  it('q= searches titles, ignoring case', async () => {
    expect(ids(await list(undefined, '?q=GAM'))).toEqual(['alpha', 'gamma']);
    expect(ids(await list(undefined, '?q=nothing-like-this'))).toEqual([]);
  });

  it('sort=videos, recent and watched', async () => {
    expect(ids(await list(undefined, '?sort=videos'))).toEqual(['alpha', 'beta', 'gamma', 'empty']);
    expect(ids(await list(BOB, '?sort=videos'))).toEqual(['alpha', 'beta', 'gamma', 'priv', 'empty']);
    expect(ids(await list(undefined, '?sort=recent'))).toEqual(['beta', 'alpha', 'gamma', 'empty']);
    db.prepare('INSERT INTO user_history (user_id, video_id, watched_at, watch_time_seconds) VALUES (?, ?, ?, ?)').run('bob', 'g1', NOW, 900);
    db.prepare('INSERT INTO user_history (user_id, video_id, watched_at, watch_time_seconds) VALUES (?, ?, ?, ?)').run('bob', 'b1', NOW, 300);
    expect(ids(await list(BOB, '?sort=watched'))).toEqual(['gamma', 'beta', 'alpha', 'priv', 'empty']);
    // A guest has no watch time: title order.
    expect(ids(await list(undefined, '?sort=watched'))).toEqual(['alpha', 'beta', 'gamma', 'empty']);
  });

  it('following=1|0 for a signed-in viewer, with subscribed flags and new counts', async () => {
    db.prepare('INSERT INTO user_subscriptions (user_id, channel_id, created_at) VALUES (?, ?, ?)').run('bob', 'beta', NOW);
    const followed = await list(BOB, '?following=1');
    expect(ids(followed)).toEqual(['beta']);
    expect(followed.channels[0]).toMatchObject({ subscribed: true, new_count: 2 });
    db.prepare('INSERT INTO user_history (user_id, video_id, watched_at, watch_time_seconds) VALUES (?, ?, ?, ?)').run('bob', 'b1', NOW, 10);
    expect((await list(BOB, '?following=1')).channels[0].new_count).toBe(1);
    const others = await list(BOB, '?following=0');
    expect(ids(others)).toEqual(['alpha', 'gamma', 'priv', 'empty']);
    expect(others.channels[0]).toMatchObject({ subscribed: false, new_count: 0 });
    // Guests: ignored.
    expect(ids(await list(undefined, '?following=1'))).toEqual(['alpha', 'beta', 'gamma', 'empty']);
  });

  it('pages with page/limit and keeps the full total', async () => {
    const r = await list(undefined, '?limit=2&page=2');
    expect(ids(r)).toEqual(['gamma', 'empty']);
    expect(r).toMatchObject({ total: 4, page: 2, limit: 2 });
    const first = await list(undefined, '?page=1');
    expect(first.limit).toBe(48);
    expect(ids(first)).toHaveLength(4);
  });

  it.each([
    ['sort=bogus'], ['following=2'], ['limit=0'], ['limit=101'], ['page=0'], ['page=abc'], ['limit=1.5'],
    [`q=${'x'.repeat(101)}`], [`category=${'x'.repeat(41)}`], ['q=a&q=b'], ['category=a&category=b'],
  ])('answers 400 to %s', async (query) => {
    expect(await status(list(undefined, `?${query}`))).toBe(400);
  });

  it('accepts the longest valid values', async () => {
    expect(await status(list(undefined, `?q=${'x'.repeat(100)}&category=${'y'.repeat(40)}&limit=100`))).toBe(200);
  });

  it('keeps the legacy search= and subscribed=true parameters', async () => {
    expect(ids(await list(undefined, '?search=music'))).toEqual(['beta']);
    db.prepare('INSERT INTO user_subscriptions (user_id, channel_id, created_at) VALUES (?, ?, ?)').run('bob', 'alpha', NOW);
    expect(ids(await list(BOB, '?subscribed=true'))).toEqual(['alpha']);
  });
});

describe('GET /api/channels/categories', () => {
  const cats = (cookie?: string) => categoriesGet(mockEvent(cookie, { path: '/api/channels/categories' })) as Promise<any>;

  it('counts effective categories over the channels the viewer may see, by count then name', async () => {
    expect(await cats()).toEqual({ categories: [
      { name: 'Comedy', count: 1 }, { name: 'Education', count: 1 }, { name: 'Gaming', count: 1 }, { name: 'Music', count: 1 },
    ] });
    db.prepare(`UPDATE channels SET categories = '["Music"]' WHERE id = 'empty'`).run();
    expect((await cats()).categories[0]).toEqual({ name: 'Music', count: 2 });
  });

  it('a private channel\'s categories never reach a guest; ultra-private ones only an admin', async () => {
    const names = async (cookie?: string) => (await cats(cookie)).categories.map((c: any) => c.name);
    expect(await names()).not.toContain('Howto & Style');
    expect(await names(BOB)).toContain('Howto & Style');
    expect(await names(BOB)).not.toContain('Secret Cat');
    expect(await names(ADMIN)).toContain('Secret Cat');
  });

  it('merges names that differ only by case', async () => {
    db.prepare(`UPDATE channels SET categories_override = '["gaming"]' WHERE id = 'beta'`).run();
    expect((await cats()).categories).toContainEqual({ name: 'Gaming', count: 2 });
  });
});

describe('GET /api/channels/discover', () => {
  const discover = (cookie?: string) => discoverGet(mockEvent(cookie, { path: '/api/channels/discover' })) as Promise<any>;

  it('is empty for guests', async () => {
    expect(await discover()).toEqual({ channels: [] });
  });

  it('ranks unfollowed channels by the viewer\'s watched categories, then popularity, with a reason', async () => {
    db.prepare(`UPDATE videos SET categories = '["Comedy"]' WHERE id = 'p1'`).run();
    db.prepare('INSERT INTO user_history (user_id, video_id, watched_at, watch_time_seconds) VALUES (?, ?, ?, ?)').run('bob', 'p1', NOW, 600);
    db.prepare('INSERT INTO user_subscriptions (user_id, channel_id, created_at) VALUES (?, ?, ?)').run('bob', 'priv', NOW);
    const r = await discover(BOB);
    // gamma shares Comedy; then beta and alpha by popularity; priv is followed,
    // empty has no video, ultra is not visible.
    expect(r.channels.map((c: any) => c.id)).toEqual(['gamma', 'beta', 'alpha']);
    expect(r.channels[0]).toMatchObject({ reason: 'Because you watch Comedy', categories: ['Comedy'] });
    expect(r.channels[1].reason).toBe('Popular in the library');
  });

  it('returns at most 8 channels', async () => {
    const channel = db.prepare("INSERT INTO channels (id, title, visibility, created_at) VALUES (?, ?, 'public', 0)");
    const video = db.prepare("INSERT INTO videos (id, title, channel_id, download_status, created_at) VALUES (?, 'V', ?, 'completed', 0)");
    for (let i = 0; i < 10; i++) { channel.run(`x${i}`, `X${i}`); video.run(`xv${i}`, `x${i}`); }
    expect((await discover(BOB)).channels).toHaveLength(8);
  });
});

describe('channel detail categories', () => {
  const detail = (cookie?: string) => channelGet(mockEvent(cookie, { path: '/api/channels/gamma', params: { id: 'gamma' } })) as Promise<any>;

  it('every viewer gets the effective categories; only admins the automatic ones and the override', async () => {
    const guest = await detail();
    expect(guest.channel.categories).toEqual(['Comedy']);
    expect(guest.channel).not.toHaveProperty('categories_override');
    expect(guest.channel).not.toHaveProperty('categories_auto');
    const admin = await detail(ADMIN);
    expect(admin.channel).toMatchObject({ categories: ['Comedy'], categories_auto: ['Gaming'], categories_override: ['Comedy'] });
  });
});

describe('PUT /api/admin/channels/:id/categories', () => {
  const put = (headers: Record<string, string>, body: unknown, id = 'alpha') =>
    categoriesPut(mockEvent(headers.cookie, { method: 'PUT', headers, params: { id }, body })) as Promise<any>;
  const row = () => db.prepare("SELECT categories, categories_override FROM channels WHERE id = 'alpha'").get() as any;

  it('guest 401, member 403, admin API token 403', async () => {
    expect(await status(put({}, { categories: ['X'] }))).toBe(401);
    expect(await status(put({ cookie: BOB }, { categories: ['X'] }))).toBe(403);
    expect(await status(put({ authorization: `Bearer ${adminToken}` }, { categories: ['X'] }))).toBe(403);
    expect(row().categories_override).toBeNull();
  });

  it('sets a sanitised override, which the list and its filter then use; null resets to automatic', async () => {
    const r = await put({ cookie: ADMIN }, { categories: ['  Cooking ', 'Travel', 'cooking'] });
    expect(r).toEqual({ categories: ['Cooking', 'Travel'], automatic: ['Gaming', 'Education'], override: ['Cooking', 'Travel'] });
    expect(row().categories_override).toBe('["Cooking","Travel"]');
    expect(ids(await list(undefined, '?category=travel'))).toEqual(['alpha']);
    expect(ids(await list(undefined, '?category=education'))).toEqual([]);
    const reset = await put({ cookie: ADMIN }, { categories: null });
    expect(reset).toEqual({ categories: ['Gaming', 'Education'], automatic: ['Gaming', 'Education'], override: null });
    expect(row().categories_override).toBeNull();
  });

  it('an empty list is an override too (no categories)', async () => {
    expect((await put({ cookie: ADMIN }, { categories: [] })).categories).toEqual([]);
    expect(row().categories_override).toBe('[]');
  });

  it.each([
    ['no categories key', {}],
    ['a string', { categories: 'Gaming' }],
    ['six names', { categories: ['a', 'b', 'c', 'd', 'e', 'f'] }],
    ['a 41-character name', { categories: ['x'.repeat(41)] }],
    ['a control character', { categories: ['a\nb'] }],
    ['no body', undefined],
  ])('answers 400 to %s', async (_label, body) => {
    expect(await status(put({ cookie: ADMIN }, body))).toBe(400);
    expect(row().categories_override).toBeNull();
  });

  it('answers 404 for an unknown channel', async () => {
    expect(await status(put({ cookie: ADMIN }, { categories: ['X'] }, 'nope'))).toBe(404);
  });
});
