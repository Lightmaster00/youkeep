import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import searchChannels from '../../server/api/admin/downloader/search-channels.get';
import searchShows from '../../server/api/admin/podcasts/search-shows.get';
import { sharedSearchCache } from '../../server/utils/searchCache';
import { createTestDb, mockEvent } from '../helpers/testDb';

const fixture = readFileSync(fileURLToPath(new URL('../fixtures/youtube-channel-search.html', import.meta.url)), 'utf8');
const timeoutError = () => Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });

let db: Database.Database;
let fetchMock: ReturnType<typeof vi.fn>;
const originalFetch = (globalThis as any).$fetch;

beforeEach(() => {
  db = createTestDb();
  db.exec('CREATE TABLE search_platforms (id TEXT PRIMARY KEY, api_key TEXT NOT NULL DEFAULT \'\', api_secret TEXT NOT NULL DEFAULT \'\', updated_at INTEGER NOT NULL)');
  (globalThis as any).getDb = () => db;
  (globalThis as any).requireAdmin = async () => ({ id: 'admin', role: 'admin' });
  fetchMock = vi.fn();
  (globalThis as any).$fetch = fetchMock;
  sharedSearchCache.clear();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  (globalThis as any).$fetch = originalFetch;
  vi.restoreAllMocks();
});

const ev = (q: string) => mockEvent('', { path: `/?q=${encodeURIComponent(q)}` });

describe('GET /api/admin/downloader/search-channels (scrape)', () => {
  it('scrapes with an 8 s limit, then answers the same search from the cache', async () => {
    fetchMock.mockResolvedValue(fixture);
    const first: any = await searchChannels(ev('daft punk'));
    expect(first.channels.map((c: any) => c.id)).toEqual(['UCabcdefghijklmnopqrstuv', 'UCzyxwvutsrqponmlkjihgfe']);
    expect(fetchMock.mock.calls[0][1].timeout).toBe(8000);
    const second: any = await searchChannels(ev('Daft Punk'));
    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('answers 504 with a clear message on a time limit, and does not cache it', async () => {
    fetchMock.mockRejectedValueOnce(timeoutError());
    await expect(searchChannels(ev('slow'))).rejects.toMatchObject({ statusCode: 504, statusMessage: 'The search took too long. Try again.' });
    fetchMock.mockResolvedValueOnce(fixture);
    const res: any = await searchChannels(ev('slow'));
    expect(res.channels).toHaveLength(2);
  });

  it('keeps answering 500 for other failures and does not cache empty pages', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNRESET'));
    await expect(searchChannels(ev('x'))).rejects.toMatchObject({ statusCode: 500 });
    fetchMock.mockResolvedValueOnce('<html></html>');
    expect(await searchChannels(ev('x'))).toEqual({ channels: [] });
    fetchMock.mockResolvedValueOnce(fixture);
    expect(((await searchChannels(ev('x'))) as any).channels).toHaveLength(2);
  });
});

describe('GET /api/admin/podcasts/search-shows', () => {
  const itunes = { results: [{ collectionId: 1, collectionName: 'Show', artistName: 'Host', feedUrl: 'https://f/1.xml', artworkUrl600: 'https://img/1.jpg' }] };

  it('caches the iTunes results with an 8 s limit', async () => {
    fetchMock.mockResolvedValue(itunes);
    const first: any = await searchShows(ev('show'));
    expect(first.shows).toHaveLength(1);
    expect(fetchMock.mock.calls[0][1].timeout).toBe(8000);
    await searchShows(ev('show'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('answers 504 when every provider asked hit its time limit', async () => {
    fetchMock.mockRejectedValueOnce(timeoutError());
    await expect(searchShows(ev('slow'))).rejects.toMatchObject({ statusCode: 504, statusMessage: 'The search took too long. Try again.' });
  });

  it('still answers an empty list for a plain failure', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNRESET'));
    expect(await searchShows(ev('down'))).toEqual({ shows: [] });
  });
});
