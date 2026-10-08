/**
 * Shared helpers for the admin "follow" searches (YouTube channels, podcast
 * directories): a request time limit, a short in-memory cache and one timing
 * log line per provider call.
 */

export const SEARCH_TIMEOUT_MS = 8_000;
export const SEARCH_CACHE_TTL_MS = 10 * 60 * 1000;
export const SEARCH_CACHE_MAX_ENTRIES = 100;
export const SEARCH_TIMEOUT_MESSAGE = 'The search took too long. Try again.';

/** A small least-recently-used cache whose entries expire after `ttlMs`. */
export class SearchCache<T> {
  private entries = new Map<string, { value: T; expiresAt: number }>();

  constructor(
    private readonly maxEntries = SEARCH_CACHE_MAX_ENTRIES,
    private readonly ttlMs = SEARCH_CACHE_TTL_MS,
    private readonly now: () => number = () => Date.now(),
  ) {}

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    // Re-insert so the Map's order stays least- to most-recently used.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value as string;
      this.entries.delete(oldest);
    }
  }

  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }
}

const G_SEARCH_CACHE = Symbol.for('YouKeep.searchCache');
const _g = globalThis as any;
if (!(G_SEARCH_CACHE in _g)) _g[G_SEARCH_CACHE] = new SearchCache<unknown[]>();

/** The process-wide search cache (kept across development hot reloads). */
export const sharedSearchCache: SearchCache<unknown[]> = _g[G_SEARCH_CACHE];

function logSearch(provider: string, q: string, ms: number, results: number | string, cache: 'hit' | 'miss') {
  console.log(`[search] provider=${provider} q=${JSON.stringify(q)} ms=${ms} results=${results} cache=${cache}`);
}

/**
 * Returns the cached results for provider+query, or runs `fetcher` and caches
 * its results. Errors and empty results are never cached; errors are
 * rethrown. Every call logs one timing line.
 */
export async function cachedSearch<T>(
  provider: string,
  q: string,
  fetcher: () => Promise<T[]>,
  cache: SearchCache<unknown[]> = sharedSearchCache,
): Promise<T[]> {
  const key = `${provider}\u0000${q.trim().toLowerCase()}`;
  const started = Date.now();
  const hit = cache.get(key) as T[] | undefined;
  if (hit) {
    logSearch(provider, q, Date.now() - started, hit.length, 'hit');
    return hit;
  }
  let results: T[];
  try {
    results = await fetcher();
  } catch (err) {
    logSearch(provider, q, Date.now() - started, isSearchTimeout(err) ? 'timeout' : 'error', 'miss');
    throw err;
  }
  logSearch(provider, q, Date.now() - started, results.length, 'miss');
  if (Array.isArray(results) && results.length > 0) cache.set(key, results);
  return results;
}

/** True when a $fetch error means the request hit its time limit. */
export function isSearchTimeout(err: any): boolean {
  const names = [err?.name, err?.cause?.name];
  if (names.includes('TimeoutError')) return true;
  const text = `${err?.message || ''} ${err?.cause?.message || ''}`;
  return /timed? ?out|timeout/i.test(text);
}
