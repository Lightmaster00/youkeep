import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  SearchCache, cachedSearch, isSearchTimeout, SEARCH_CACHE_TTL_MS, SEARCH_CACHE_MAX_ENTRIES, SEARCH_TIMEOUT_MS,
} from '../../server/utils/searchCache';

afterEach(() => vi.restoreAllMocks());

describe('SearchCache', () => {
  it('uses a 10 minute time to live, 100 entries and an 8 s request limit', () => {
    expect(SEARCH_CACHE_TTL_MS).toBe(600_000);
    expect(SEARCH_CACHE_MAX_ENTRIES).toBe(100);
    expect(SEARCH_TIMEOUT_MS).toBe(8_000);
  });

  it('forgets an entry once its time to live has passed', () => {
    let now = 1_000;
    const cache = new SearchCache<number[]>(10, 500, () => now);
    cache.set('k', [1]);
    now = 1_499;
    expect(cache.get('k')).toEqual([1]);
    now = 1_500;
    expect(cache.get('k')).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it('evicts the least recently used entry beyond the maximum', () => {
    const cache = new SearchCache<number[]>(2, 10_000);
    cache.set('a', [1]);
    cache.set('b', [2]);
    expect(cache.get('a')).toEqual([1]); // a is now the most recent
    cache.set('c', [3]);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toEqual([1]);
    expect(cache.get('c')).toEqual([3]);
  });
});

describe('cachedSearch', () => {
  it('fetches once, then answers from the cache (query case and spaces ignored), and logs the timing', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const cache = new SearchCache<unknown[]>();
    const fetcher = vi.fn(async () => ['x']);
    expect(await cachedSearch('p', 'Daft Punk', fetcher, cache)).toEqual(['x']);
    expect(await cachedSearch('p', ' daft punk ', fetcher, cache)).toEqual(['x']);
    expect(fetcher).toHaveBeenCalledTimes(1);
    // Another provider has its own entry.
    await cachedSearch('other', 'Daft Punk', fetcher, cache);
    expect(fetcher).toHaveBeenCalledTimes(2);
    const lines = log.mock.calls.map((c) => String(c[0]));
    expect(lines[0]).toMatch(/^\[search\] provider=p q="Daft Punk" ms=\d+ results=1 cache=miss$/);
    expect(lines[1]).toMatch(/^\[search\] provider=p q=" daft punk " ms=\d+ results=1 cache=hit$/);
  });

  it('never caches empty results or errors', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const cache = new SearchCache<unknown[]>();
    const empty = vi.fn(async () => []);
    await cachedSearch('p', 'q', empty, cache);
    await cachedSearch('p', 'q', empty, cache);
    expect(empty).toHaveBeenCalledTimes(2);

    const failing = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(['ok']);
    await expect(cachedSearch('p', 'r', failing, cache)).rejects.toThrow('boom');
    expect(await cachedSearch('p', 'r', failing, cache)).toEqual(['ok']);
    expect(failing).toHaveBeenCalledTimes(2);
    expect(cache.size).toBe(1);
  });
});

describe('isSearchTimeout', () => {
  it('recognises time limit errors only', () => {
    expect(isSearchTimeout({ name: 'TimeoutError' })).toBe(true);
    expect(isSearchTimeout({ name: 'FetchError', cause: { name: 'TimeoutError' } })).toBe(true);
    expect(isSearchTimeout(new Error('[GET] "https://x": <no response> The operation was aborted due to timeout'))).toBe(true);
    expect(isSearchTimeout(new Error('fetch failed'))).toBe(false);
    expect(isSearchTimeout(undefined)).toBe(false);
  });
});
