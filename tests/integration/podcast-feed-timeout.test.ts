import { describe, it, expect, beforeEach, vi } from 'vitest';

// rss-parser is replaced: the test records the options it is built with and
// makes parseURL fail the way rss-parser does when its time limit is reached.
const state = vi.hoisted(() => ({ options: null as any, error: null as Error | null }));
vi.mock('rss-parser', () => ({
  default: class {
    constructor(options: any) { state.options = options; }
    async parseURL() { throw state.error; }
  },
}));

import { ingestPodcastFeed, PODCAST_FEED_TIMEOUT_MS } from '../../server/utils/podcastDownloader';
import { createTestDb } from '../helpers/testDb';

beforeEach(() => {
  const db = createTestDb();
  (globalThis as any).getDb = () => db;
});

describe('podcast feed time limit', () => {
  it('fetches the feed with a 15 s limit and explains a timeout clearly', async () => {
    state.error = new Error(`Request timed out after ${PODCAST_FEED_TIMEOUT_MS}ms`);
    const res = await ingestPodcastFeed('https://feeds.example/slow.xml');
    expect(PODCAST_FEED_TIMEOUT_MS).toBe(15_000);
    expect(state.options.timeout).toBe(PODCAST_FEED_TIMEOUT_MS);
    expect(res).toEqual({ success: false, message: 'The feed did not answer within 15 s. Check the address or try again later.', count: 0 });
  });

  it('keeps the parse error message for other failures', async () => {
    state.error = new Error('Non-whitespace before first tag.');
    const res = await ingestPodcastFeed('https://feeds.example/bad.xml');
    expect(res.message).toBe('Failed to fetch/parse RSS feed: Non-whitespace before first tag.');
  });
});
