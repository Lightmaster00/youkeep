import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { performance } from 'perf_hooks';
import Database from 'better-sqlite3';
import { ingestPodcastFeed, PODCAST_FEED_MAX_ITEMS, PODCAST_INSERT_CHUNK } from '../../server/utils/podcastDownloader';
import { safeUrlDeps } from '../../server/utils/safeUrl';
import { createTestDb } from '../helpers/testDb';

// A hostile (or just huge) feed used to be inserted in one synchronous
// transaction (84k items blocked the server 2.3 s). Items are now capped at
// the newest 5000 and inserted 500 per transaction, yielding in between.
let db: Database.Database;
const realLookup = safeUrlDeps.lookup;

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
  safeUrlDeps.lookup = async () => [{ address: '93.184.216.34', family: 4 }];
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  safeUrlDeps.lookup = realLookup;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function feed(count: number): string {
  const base = Date.UTC(2020, 0, 1);
  const items: string[] = [];
  for (let i = 0; i < count; i++) {
    // Shuffled dates: the newest are not simply the first items.
    const day = (i * 7919) % count;
    items.push(`<item><title>Episode ${day}</title><guid>g${i}</guid><pubDate>${new Date(base + day * 3_600_000).toUTCString()}</pubDate><enclosure url="https://cdn.example/${i}.mp3" type="audio/mpeg"/></item>`);
  }
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>Huge</title>${items.join('')}</channel></rss>`;
}

describe('podcast feed size (L3)', () => {
  it('constants', () => {
    expect(PODCAST_FEED_MAX_ITEMS).toBe(5000);
    expect(PODCAST_INSERT_CHUNK).toBe(500);
  });

  it('a 20k-item feed keeps the newest 5000 and never blocks the event loop for long while inserting', async () => {
    const xml = feed(20_000);
    vi.stubGlobal('fetch', async () => new Response(xml, { headers: { 'content-type': 'application/rss+xml' } }));
    const commits: number[] = [];
    const realTransaction = db.transaction.bind(db);
    (db as any).transaction = (fn: any) => { const t = realTransaction(fn); return (...a: any[]) => { const t0 = performance.now(); const r = t(...a); commits.push(performance.now() - t0); return r; }; };

    // Largest gap seen by a loop that re-arms itself on every event-loop turn.
    let last = performance.now();
    let maxGap = 0;
    let turns = 0;
    let running = true;
    const spin = () => { const now = performance.now(); maxGap = Math.max(maxGap, now - last); last = now; turns++; if (running) setImmediate(spin); };
    setImmediate(spin);
    const result = await ingestPodcastFeed('https://feeds.example/huge.xml');
    running = false;

    expect(result.success).toBe(true);
    expect((db.prepare('SELECT COUNT(*) AS n FROM podcast_episodes').get() as any).n).toBe(5000);
    // The newest 5000 (days 15000..19999).
    expect((db.prepare("SELECT COUNT(*) AS n FROM podcast_episodes WHERE title IN ('Episode 19999', 'Episode 15000')").get() as any).n).toBe(2);
    expect((db.prepare("SELECT COUNT(*) AS n FROM podcast_episodes WHERE title = 'Episode 14999'").get() as any).n).toBe(0);
    // 10 transactions of 500, the event loop ran between them.
    expect(commits.length).toBe(10);
    expect(Math.max(...commits)).toBeLessThan(250);
    expect(turns).toBeGreaterThanOrEqual(9);
    // Typically ~150 ms (parsing the 20k-item XML); 10x that only fails on a real block.
    expect(maxGap).toBeLessThan(1500);
  }, 30_000);
});
