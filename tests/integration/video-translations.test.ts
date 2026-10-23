import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type Database from 'better-sqlite3';
import getHandler from '../../server/api/account/content-language.get';
import putHandler from '../../server/api/account/content-language.put';
import meHandler from '../../server/api/auth/me.get';
import listHandler from '../../server/api/videos/index.get';
import detailHandler from '../../server/api/videos/[id].get';
import { getUserFromSession } from '../../server/utils/auth';
import { fetchLocalizations, whenTranslationQueueIdle, NEGATIVE_TTL_MS, POSITIVE_TTL_MS } from '../../server/utils/videoTranslations';
import fs from 'fs';
import os from 'os';
import path from 'path';
import homeHandler from '../../server/api/home/feed.get';
import subsHandler from '../../server/api/subscriptions/feed.get';
import continueHandler from '../../server/api/videos/continue.get';
import personalPlaylistHandler from '../../server/api/playlists/personal/[id].get';
import playlistHandler from '../../server/api/playlists/[id].get';
import { assertInTmp, insertSubscription, insertPersonalPlaylist, insertUserHistory, insertUser, insertSession, insertChannel, insertVideo, mockEvent, sessionCookie } from '../helpers/testDb';

let db: Database.Database;
let fetchMock: ReturnType<typeof vi.fn>;
const DAY = 86_400_000;
const { openDatabase } = await vi.importActual<typeof import('../../server/utils/db')>('../../server/utils/db');
let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yk-vtr-'));
  assertInTmp(dir);
  db = openDatabase(path.join(dir, 'youkeep.db'));
  (globalThis as any).getDb = () => db;
  (globalThis as any).getUserFromSession = getUserFromSession;
  (globalThis as any).canAccessVideo = async () => true;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  fetchMock = vi.fn(async () => ({ items: [] }));
  vi.stubGlobal('$fetch', fetchMock);
  insertUser(db, { id: 'u1', role: 'user' });
  insertUser(db, { id: 'u2', role: 'user' });
  insertSession(db, { id: 's1', userId: 'u1' });
  insertSession(db, { id: 's2', userId: 'u2' });
  insertChannel(db, { id: 'ch' });
  insertVideo(db, { id: 'v1', channelId: 'ch', title: 'Hello', uploadDate: '20240101' });
  insertVideo(db, { id: 'v2', channelId: 'ch', title: 'World', uploadDate: '20240102' });
});
afterEach(async () => {
  await whenTranslationQueueIdle();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const c1 = sessionCookie('s1');
const setLang = (userId: string, lang: string | null) => db.prepare('UPDATE users SET content_language = ? WHERE id = ?').run(lang, userId);
const setKey = (key = 'KEY123456') => db.prepare("INSERT OR REPLACE INTO search_platforms (id, api_key, api_secret, updated_at) VALUES ('youtube_data_api', ?, '', 1)").run(key);
const cache = (id: string, lang: string, title: string | null, description: string | null, fetchedAt = Date.now()) =>
  db.prepare('INSERT OR REPLACE INTO video_translations (video_id, lang, title, description, fetched_at) VALUES (?, ?, ?, ?, ?)').run(id, lang, title, description, fetchedAt);
const rowsOf = () => db.prepare('SELECT * FROM video_translations ORDER BY video_id').all() as any[];
const list = async (cookie?: string) => ((await listHandler(mockEvent(cookie, { path: '/api/videos' }))) as any).videos as any[];
const byId = (videos: any[], id: string) => videos.find((v) => v.id === id);
const apiVideo = (items: any[]) => ({ items });

describe('/api/account/content-language', () => {
  const get = (c?: string) => getHandler(mockEvent(c, { path: '/api/account/content-language' }));
  const put = (c: string | undefined, body: any) => putHandler(mockEvent(c, { path: '/api/account/content-language', body, method: 'PUT' }));

  it('defaults to original, stores a language, and original clears it', async () => {
    expect(await get(c1)).toEqual({ contentLanguage: 'original', available: false });
    expect(await put(c1, { contentLanguage: 'fr' })).toMatchObject({ contentLanguage: 'fr' });
    expect(await get(c1)).toMatchObject({ contentLanguage: 'fr' });
    await put(c1, { contentLanguage: 'original' });
    expect(db.prepare('SELECT content_language c FROM users WHERE id = ?').get('u1')).toEqual({ c: null });
  });
  it('reports availability from the configured key', async () => {
    setKey();
    expect((await get(c1) as any).available).toBe(true);
    setKey('');
    expect((await get(c1) as any).available).toBe(false);
  });
  it('rejects bad values and anonymous callers', async () => {
    await expect(put(c1, { contentLanguage: 'xx' })).rejects.toMatchObject({ statusCode: 400 });
    await expect(put(c1, { contentLanguage: null })).rejects.toMatchObject({ statusCode: 400 });
    await expect(put(c1, {})).rejects.toMatchObject({ statusCode: 400 });
    await expect(get(undefined)).rejects.toMatchObject({ statusCode: 401 });
  });
  it('is exposed on /api/auth/me', async () => {
    const me = (cookie: string) => meHandler(mockEvent(cookie, { path: '/api/auth/me' })) as Promise<any>;
    expect((await me(c1)).user.contentLanguage).toBe('original');
    await put(c1, { contentLanguage: 'de' });
    expect((await me(c1)).user.contentLanguage).toBe('de');
  });
});

describe('overlay', () => {
  it('replaces the title for a viewer with a content language, keeping the original', async () => {
    setLang('u1', 'fr');
    cache('v1', 'fr', 'Bonjour', 'Desc fr');
    const videos = await list(c1);
    expect(byId(videos, 'v1')).toMatchObject({ title: 'Bonjour', original_title: 'Hello' });
    expect(byId(videos, 'v2').title).toBe('World');
    expect(byId(videos, 'v2').original_title).toBeUndefined();
  });
  it('does nothing for original viewers and guests, and never fetches for them', async () => {
    setKey();
    cache('v1', 'fr', 'Bonjour', null);
    setLang('u1', 'fr');
    expect(byId(await list(undefined), 'v1').title).toBe('Hello');
    expect(byId(await list(sessionCookie('s2')), 'v1').title).toBe('Hello');
    await whenTranslationQueueIdle();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('uses the language of each viewer', async () => {
    setLang('u1', 'fr');
    setLang('u2', 'de');
    cache('v1', 'fr', 'Bonjour', null);
    cache('v1', 'de', 'Hallo', null);
    expect(byId(await list(c1), 'v1').title).toBe('Bonjour');
    expect(byId(await list(sessionCookie('s2')), 'v1').title).toBe('Hallo');
  });
  it('translates the detail route (title and description)', async () => {
    setLang('u1', 'fr');
    db.prepare("UPDATE videos SET description = 'Orig desc' WHERE id = 'v1'").run();
    cache('v1', 'fr', 'Bonjour', 'Desc fr');
    const r: any = await detailHandler(mockEvent(c1, { path: '/api/videos/v1', params: { id: 'v1' } }));
    expect(r.video).toMatchObject({ title: 'Bonjour', description: 'Desc fr', original_title: 'Hello' });
  });
  it('does one cache query per list request', async () => {
    setLang('u1', 'fr');
    insertVideo(db, { id: 'v3', channelId: 'ch', title: 'Three', uploadDate: '20240103' });
    cache('v1', 'fr', 'Bonjour', null);
    let n = 0;
    const real = db.prepare.bind(db);
    vi.spyOn(db, 'prepare').mockImplementation(((sql: string) => {
      if (/FROM video_translations/.test(sql)) n++;
      return real(sql);
    }) as any);
    await list(c1);
    expect(n).toBe(1);
  });
});

describe('background fetch and cache', () => {
  it('fetches missing ids once, stores positive and negative entries, then serves from cache', async () => {
    setKey();
    setLang('u1', 'fr');
    fetchMock.mockResolvedValue(apiVideo([{ id: 'v1', localizations: { fr: { title: 'Bonjour', description: 'D' } }, snippet: { defaultLanguage: 'en' } }]));
    expect(byId(await list(c1), 'v1').title).toBe('Hello'); // not cached yet: original now
    await whenTranslationQueueIdle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0] as any;
    expect(url).toBe('https://www.googleapis.com/youtube/v3/videos');
    expect(opts.params).toMatchObject({ part: 'localizations,snippet' });
    expect(opts.params.id.split(',').sort()).toEqual(['v1', 'v2']);
    const rows = rowsOf();
    expect(rows.map((r) => [r.video_id, r.lang, r.title])).toEqual([['v1', 'fr', 'Bonjour'], ['v2', 'fr', null]]); // v2 absent from the API reply: negative
    expect(byId(await list(c1), 'v1').title).toBe('Bonjour');
    await whenTranslationQueueIdle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('honours a negative entry for 14 days, then refetches', async () => {
    setKey();
    setLang('u1', 'fr');
    cache('v1', 'fr', null, null, Date.now() - (NEGATIVE_TTL_MS - DAY));
    cache('v2', 'fr', null, null, Date.now() - (NEGATIVE_TTL_MS - DAY));
    await list(c1);
    await whenTranslationQueueIdle();
    expect(fetchMock).not.toHaveBeenCalled();
    cache('v1', 'fr', null, null, Date.now() - (NEGATIVE_TTL_MS + DAY));
    await list(c1);
    await whenTranslationQueueIdle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0] as any)[1].params.id).toBe('v1');
  });
  it('shows a stale positive entry and refreshes it in the background', async () => {
    setKey();
    setLang('u1', 'fr');
    cache('v1', 'fr', 'Ancien', null, Date.now() - (POSITIVE_TTL_MS + DAY));
    cache('v2', 'fr', null, null);
    fetchMock.mockResolvedValue(apiVideo([{ id: 'v1', localizations: { fr: { title: 'Nouveau' } } }]));
    expect(byId(await list(c1), 'v1').title).toBe('Ancien');
    await whenTranslationQueueIdle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(byId(await list(c1), 'v1').title).toBe('Nouveau');
  });
  it('without a key: no fetch', async () => {
    setLang('u1', 'fr');
    await list(c1);
    await whenTranslationQueueIdle();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(rowsOf()).toEqual([]);
  });
  it('a failed fetch (403 quota) writes nothing, not even negative entries, and never logs the key', async () => {
    setKey('SECRETKEY99');
    setLang('u1', 'fr');
    fetchMock.mockRejectedValue(Object.assign(new Error('403 Forbidden: https://www.googleapis.com/youtube/v3/videos?key=SECRETKEY99'), { statusCode: 403 }));
    expect((await list(c1)).length).toBe(2);
    await whenTranslationQueueIdle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(rowsOf()).toEqual([]);
    expect(JSON.stringify((console.error as any).mock.calls)).not.toContain('SECRETKEY99');
  });
  it('a video already written in the content language gets a negative entry', async () => {
    setKey();
    setLang('u1', 'fr');
    fetchMock.mockResolvedValue(apiVideo([{ id: 'v1', localizations: { fr: { title: 'X' } }, snippet: { defaultLanguage: 'fr-FR' } }]));
    await list(c1);
    await whenTranslationQueueIdle();
    expect(rowsOf().find((r) => r.video_id === 'v1').title).toBeNull();
  });
  it('does not queue the same id twice while a fetch is in flight', async () => {
    setKey();
    setLang('u1', 'fr');
    let release!: () => void;
    fetchMock.mockImplementation(() => new Promise((r) => { release = () => r(apiVideo([])); }));
    await list(c1);
    await list(c1);
    release();
    await whenTranslationQueueIdle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('deleting a video removes its translations', () => {
    db.pragma('foreign_keys = ON');
    cache('v1', 'fr', 'Bonjour', null);
    db.prepare("DELETE FROM videos WHERE id = 'v1'").run();
    expect(rowsOf()).toEqual([]);
  });
});

describe('fetchLocalizations', () => {
  it('batches 50 ids per request and stops after the first failed batch', async () => {
    const ids = Array.from({ length: 120 }, (_, i) => `id${i}`);
    fetchMock.mockResolvedValue(apiVideo([]));
    const ok = await fetchLocalizations(ids, 'K');
    expect(fetchMock.mock.calls.map((c: any) => c[1].params.id.split(',').length)).toEqual([50, 50, 20]);
    expect(ok.size).toBe(120);
    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(apiVideo([])).mockRejectedValue(new Error('quota'));
    const partial = await fetchLocalizations(ids, 'K');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(partial.size).toBe(50);
  });
});

describe('other video routes are overlaid', () => {
  beforeEach(() => {
    setLang('u1', 'fr');
    cache('v1', 'fr', 'Bonjour', null);
    cache('v2', 'fr', 'Monde', null);
  });
  const titles = (videos: any[]) => videos.map((v) => v.title).sort();

  it('home feed (hero and rows, original_title kept), none for guests', async () => {
    const r: any = await homeHandler(mockEvent(c1, { path: '/api/home/feed' }));
    const all = [r.featured.large, ...r.featured.small, ...r.sections.flatMap((s: any) => s.videos ?? [])].filter(Boolean);
    expect(all.length).toBeGreaterThan(0);
    for (const v of all) expect(['Bonjour', 'Monde']).toContain(v.title);
    for (const v of all) expect(['Hello', 'World']).toContain(v.original_title);
    const g: any = await homeHandler(mockEvent(undefined, { path: '/api/home/feed' }));
    for (const v of [g.featured.large, ...g.featured.small, ...g.sections.flatMap((s: any) => s.videos ?? [])].filter(Boolean)) {
      expect(['Hello', 'World']).toContain(v.title);
    }
  });
  it('subscription feed', async () => {
    insertSubscription(db, { userId: 'u1', channelId: 'ch' });
    const r: any = await subsHandler(mockEvent(c1, { path: '/api/subscriptions/feed' }));
    expect(titles(r.videos)).toEqual(['Bonjour', 'Monde']);
  });
  it('continue watching', async () => {
    insertUserHistory(db, { userId: 'u1', videoId: 'v1', positionSeconds: 60, durationSeconds: 600 });
    const r: any = await continueHandler(mockEvent(c1, { path: '/api/videos/continue' }));
    expect(titles(r.videos)).toEqual(['Bonjour']);
  });
  it('personal playlists (both routes)', async () => {
    insertPersonalPlaylist(db, { id: 'p1', userId: 'u1', videoIds: ['v1', 'v2'] });
    const a: any = await personalPlaylistHandler(mockEvent(c1, { path: '/api/playlists/personal/p1', params: { id: 'p1' } }));
    expect(titles(a.videos)).toEqual(['Bonjour', 'Monde']);
    const b: any = await playlistHandler(mockEvent(c1, { path: '/api/playlists/p1', params: { id: 'p1' } }));
    expect(titles(b.videos)).toEqual(['Bonjour', 'Monde']);
    const guestEvent = mockEvent(undefined, { path: '/api/playlists/p1', params: { id: 'p1' } });
    await expect(playlistHandler(guestEvent)).rejects.toMatchObject({ statusCode: 404 }); // private: hidden from guests
  });
});
