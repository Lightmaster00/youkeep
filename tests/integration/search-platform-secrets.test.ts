import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import platformsGet from '../../server/api/admin/system/search-platforms.get';
import platformsPost from '../../server/api/admin/system/search-platforms.post';
import searchChannels from '../../server/api/admin/downloader/search-channels.get';
import searchShows from '../../server/api/admin/podcasts/search-shows.get';
import { requireAdmin } from '../../server/utils/auth';
import { sharedSearchCache } from '../../server/utils/searchCache';
import { redactUrls } from '../../server/utils/redact';
import { createTestDb, insertUser, insertSession, mockEvent, sessionCookie } from '../helpers/testDb';

const KEY = 'AIzaSyD-very-secret-youtube-key-1234';
const PI_KEY = 'PIKEY-abcdefghij-5678';
const PI_SECRET = 'PISECRET-zyxwvutsrq-9999';

let db: Database.Database;
const originalFetch = (globalThis as any).$fetch;

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
  (globalThis as any).requireAdmin = requireAdmin;
  db.exec(`CREATE TABLE search_platforms (id TEXT PRIMARY KEY, api_key TEXT NOT NULL DEFAULT '', api_secret TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL DEFAULT 0)`);
  db.prepare("INSERT INTO search_platforms (id, api_key, api_secret) VALUES ('youtube_data_api', ?, ''), ('podcastindex', ?, ?), ('listennotes', '', '')").run(KEY, PI_KEY, PI_SECRET);
  insertUser(db, { id: 'a1', role: 'admin' });
  insertSession(db, { id: 's-a1', userId: 'a1' });
  sharedSearchCache.clear();
});

afterEach(() => {
  (globalThis as any).$fetch = originalFetch;
  vi.restoreAllMocks();
});

const row = (id: string) => db.prepare('SELECT api_key, api_secret FROM search_platforms WHERE id = ?').get(id) as any;
const post = (body: unknown) => platformsPost(mockEvent(sessionCookie('s-a1'), { method: 'POST', body }));

describe('GET /api/admin/system/search-platforms', () => {
  it('never returns a full key or secret, only configured + a last-4 hint', async () => {
    const res: any = await platformsGet(mockEvent(sessionCookie('s-a1')));
    const text = JSON.stringify(res);
    for (const secret of [KEY, PI_KEY, PI_SECRET]) expect(text).not.toContain(secret);

    const yt = res.platforms.find((p: any) => p.id === 'youtube_data_api');
    expect(yt).toMatchObject({ apiKeyConfigured: true, apiKeyHint: '1234', apiSecretConfigured: false, apiSecretHint: '' });
    // Backward compatible fields the current UI binds to, masked.
    expect(yt.apiKey).toBe('••••1234');
    expect(yt.apiSecret).toBe('');
    const ln = res.platforms.find((p: any) => p.id === 'listennotes');
    expect(ln).toMatchObject({ apiKeyConfigured: false, apiKey: '' });
  });
});

describe('POST /api/admin/system/search-platforms', () => {
  it('keeps the stored values when a secret is empty, missing or the masked value echoed back', async () => {
    await post({ id: 'podcastindex', apiKey: '', apiSecret: '••••9999' });
    expect(row('podcastindex')).toEqual({ api_key: PI_KEY, api_secret: PI_SECRET });
    await post({ id: 'podcastindex' });
    expect(row('podcastindex')).toEqual({ api_key: PI_KEY, api_secret: PI_SECRET });
  });

  it('replaces a value that is sent', async () => {
    await post({ id: 'podcastindex', apiKey: 'NEW-KEY-0000', apiSecret: '' });
    expect(row('podcastindex')).toEqual({ api_key: 'NEW-KEY-0000', api_secret: PI_SECRET });
  });

  it('clears a value only on an explicit clear flag', async () => {
    await post({ id: 'youtube_data_api', clearApiKey: true });
    expect(row('youtube_data_api').api_key).toBe('');
  });

  it.each([null, [], 'x', { id: 'podcastindex', apiKey: 5 }, { id: 'podcastindex', apiSecret: {} }, { id: 'nope' }])('malformed %j is a 400', async (body) => {
    await expect(post(body)).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('API keys are never logged', () => {
  it('redactUrls strips query strings from URLs', () => {
    expect(redactUrls(`[GET] "https://www.googleapis.com/youtube/v3/search?part=snippet&key=${KEY}": <no response> fetch failed`))
      .toBe('[GET] "https://www.googleapis.com/youtube/v3/search?[redacted]": <no response> fetch failed');
  });

  it('search-channels does not print the YouTube key when the API call fails', async () => {
    const logged: string[] = [];
    const capture = (...args: any[]) => { logged.push(args.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : typeof a === 'string' ? a : JSON.stringify(a))).join(' ')); };
    vi.spyOn(console, 'error').mockImplementation(capture);
    vi.spyOn(console, 'log').mockImplementation(capture);
    vi.spyOn(console, 'warn').mockImplementation(capture);
    (globalThis as any).$fetch = vi.fn(async (url: string, opts: any) => {
      const full = `${url}?part=snippet&q=x&key=${opts?.params?.key ?? ''}`;
      throw new Error(`[GET] "${full}": <no response> fetch failed`);
    });
    const err: any = await searchChannels(mockEvent(sessionCookie('s-a1'), { path: '/?q=x' })).then(() => null, (e) => e);
    expect(err).toBeTruthy();
    expect(err.statusCode).toBe(502);
    expect(String(err.statusMessage ?? err.message)).not.toContain(KEY);
    expect(logged.length).toBeGreaterThan(0);
    expect(logged.join('\n')).not.toContain(KEY);
  });

  it('search-shows does not print PodcastIndex credentials when a provider fails', async () => {
    const logged: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: any[]) => { logged.push(args.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : String(a))).join(' ')); });
    (globalThis as any).$fetch = vi.fn(async (url: string, opts: any) => {
      throw new Error(`[GET] "${url}?q=x&api_key=${PI_KEY}": 500 Internal Server Error (key ${opts?.headers?.["X-Auth-Key"] ?? ""})`);
    });
    await searchShows(mockEvent(sessionCookie('s-a1'), { path: '/?q=x' })).catch(() => undefined);
    expect(logged.join('\n')).not.toContain(PI_KEY);
  });
});
