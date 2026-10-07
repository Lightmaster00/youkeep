import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';

// ingestPodcastFeed reads its feed through rss-parser and its database through
// ./db: both are replaced so the test runs on an in-memory DB with a fixed feed.
const state = vi.hoisted(() => ({ db: null as any, feed: null as any }));
vi.mock('../../server/utils/db', () => ({ getDb: () => state.db }));
vi.mock('rss-parser', () => ({
  default: class { async parseURL() { return state.feed; } },
}));

import { ingestPodcastFeed } from '../../server/utils/podcastDownloader';
import { ensurePodcastPubTs, parsePubTs } from '../../server/utils/podcastPubDate';
import { queryRecentEpisodes } from '../../server/utils/recentMedia';
import { createTestDb, insertPodcastShow, insertPodcastEpisode } from '../helpers/testDb';

const DAY = 24 * 3600 * 1000;
const NOW = Date.parse('2026-10-07T12:00:00Z');

let db: Database.Database;
beforeEach(() => {
  db = createTestDb();
  state.db = db;
  (globalThis as any).getDb = () => db;
});

const ids = (page: { items: any[] }) => page.items.map((e: any) => e.id);

describe('parsePubTs', () => {
  it.each([
    ['Tue, 06 Oct 2026 10:00:00 GMT', Date.parse('2026-10-06T10:00:00Z')],
    ['2026-10-06T10:00:00Z', Date.parse('2026-10-06T10:00:00Z')],
    ['not a date', null],
    ['', null],
    [null, null],
    [undefined, null],
  ])('%j → %j', (raw, expected) => {
    expect(parsePubTs(raw as any)).toBe(expected);
  });
});

describe('recent episodes order by publish date', () => {
  it('a back-catalogue show ingested after a newer one does not outrank it', () => {
    insertPodcastShow(db, { id: 'fresh' });
    insertPodcastEpisode(db, { id: 'fresh1', showId: 'fresh', localFilePath: '/p/f1', createdAt: NOW - 10 * DAY, pubTs: NOW - 1 * DAY });
    insertPodcastEpisode(db, { id: 'fresh2', showId: 'fresh', localFilePath: '/p/f2', createdAt: NOW - 10 * DAY, pubTs: NOW - 2 * DAY });
    insertPodcastShow(db, { id: 'archive' });
    for (let i = 0; i < 5; i++) {
      insertPodcastEpisode(db, { id: `old${i}`, showId: 'archive', localFilePath: `/p/o${i}`, createdAt: NOW, pubTs: NOW - (400 + i) * DAY });
    }
    expect(ids(queryRecentEpisodes(db, null, 3))).toEqual(['fresh1', 'fresh2', 'old0']);
  });

  it('falls back to the ingestion time when the publish date is missing or unparsable', () => {
    insertPodcastShow(db, { id: 's1' });
    insertPodcastEpisode(db, { id: 'dated', showId: 's1', localFilePath: '/p/a', createdAt: NOW - 30 * DAY, pubTs: NOW - 5 * DAY });
    insertPodcastEpisode(db, { id: 'garbled', showId: 's1', localFilePath: '/p/b', createdAt: NOW - 3 * DAY, pubDate: 'someday', pubTs: null });
    insertPodcastEpisode(db, { id: 'undated', showId: 's1', localFilePath: '/p/c', createdAt: NOW - 7 * DAY });
    expect(ids(queryRecentEpisodes(db, null, 10))).toEqual(['garbled', 'dated', 'undated']);
  });

  it('pages stay stable when many episodes share a publish date', () => {
    insertPodcastShow(db, { id: 's1' });
    for (let i = 0; i < 25; i++) {
      insertPodcastEpisode(db, { id: `e${String(i).padStart(2, '0')}`, showId: 's1', localFilePath: `/p/${i}`, createdAt: NOW, pubTs: NOW - DAY });
    }
    const seen: string[] = [];
    for (let offset = 0; offset < 25; offset += 7) seen.push(...ids(queryRecentEpisodes(db, null, 7, offset)));
    expect(seen).toHaveLength(25);
    expect(new Set(seen).size).toBe(25);
    expect(seen).toEqual([...seen].sort().reverse());
  });
});

describe('ensurePodcastPubTs (migration)', () => {
  function legacyDb() {
    const old = new Database(':memory:');
    old.exec(`
      CREATE TABLE podcast_episodes (id TEXT PRIMARY KEY, show_id TEXT NOT NULL, title TEXT NOT NULL, pub_date TEXT, created_at INTEGER NOT NULL);
      INSERT INTO podcast_episodes VALUES ('a', 's', 'A', 'Tue, 06 Oct 2026 10:00:00 GMT', 1);
      INSERT INTO podcast_episodes VALUES ('b', 's', 'B', 'garbage', 2);
      INSERT INTO podcast_episodes VALUES ('c', 's', 'C', NULL, 3);
    `);
    return old;
  }
  const pubTs = (d: Database.Database) =>
    Object.fromEntries((d.prepare('SELECT id, pub_ts FROM podcast_episodes ORDER BY id').all() as any[]).map((r) => [r.id, r.pub_ts]));

  it('adds the column and index and backfills parsable dates on a pre-existing DB', () => {
    const old = legacyDb();
    ensurePodcastPubTs(old);
    expect(pubTs(old)).toEqual({ a: Date.parse('2026-10-06T10:00:00Z'), b: null, c: null });
    const index = old.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_podcast_episodes_pub_ts'").get();
    expect(index).toBeTruthy();
  });

  it('is idempotent and never overwrites a value already set', () => {
    const old = legacyDb();
    ensurePodcastPubTs(old);
    old.prepare("UPDATE podcast_episodes SET pub_ts = 42 WHERE id = 'a'").run();
    expect(() => ensurePodcastPubTs(old)).not.toThrow();
    expect(pubTs(old).a).toBe(42);
  });

  const backfillScans = (d: Database.Database) => {
    const spy = vi.spyOn(d, 'prepare');
    ensurePodcastPubTs(d);
    const n = spy.mock.calls.filter(([sql]) => /SELECT\s+id,\s*pub_date\s+FROM\s+podcast_episodes/i.test(String(sql))).length;
    spy.mockRestore();
    return n;
  };

  it('backfills once: a later startup does not re-scan, even with unparsable rows left', () => {
    const old = legacyDb();
    expect(backfillScans(old)).toBe(1);
    expect(pubTs(old)).toEqual({ a: Date.parse('2026-10-06T10:00:00Z'), b: null, c: null });
    // 'b' (garbage) still has a pub_date and a NULL pub_ts, yet no rescan happens.
    expect(backfillScans(old)).toBe(0);
    expect(backfillScans(old)).toBe(0);
  });

  it('a DB that has the flag is left alone; one without it is still filled', () => {
    const old = legacyDb();
    ensurePodcastPubTs(old);
    old.prepare("INSERT INTO podcast_episodes (id, show_id, title, pub_date, created_at) VALUES ('d', 's', 'D', '2026-10-01T00:00:00Z', 4)").run();
    ensurePodcastPubTs(old);
    expect(pubTs(old).d).toBeNull(); // flag set: no second pass (ingest sets pub_ts for new rows)

    const fresh = legacyDb();
    fresh.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    ensurePodcastPubTs(fresh);
    expect(pubTs(fresh).a).toBe(Date.parse('2026-10-06T10:00:00Z'));
  });
});

describe('ingestPodcastFeed', () => {
  const feedWith = (pubDate: string | undefined) => ({
    title: 'Show',
    items: [{ guid: 'g1', title: 'Ep', enclosure: { url: 'https://example.com/a.mp3' }, pubDate }],
  });
  const stored = () => db.prepare('SELECT pub_date, pub_ts FROM podcast_episodes').get() as any;

  it('stores pub_ts with the episode and keeps it in step on refresh', async () => {
    state.feed = feedWith('Tue, 06 Oct 2026 10:00:00 GMT');
    await ingestPodcastFeed('https://example.com/feed.xml');
    expect(stored()).toEqual({ pub_date: 'Tue, 06 Oct 2026 10:00:00 GMT', pub_ts: Date.parse('2026-10-06T10:00:00Z') });

    state.feed = feedWith('Wed, 07 Oct 2026 08:00:00 GMT');
    await ingestPodcastFeed('https://example.com/feed.xml');
    expect(stored().pub_ts).toBe(Date.parse('2026-10-07T08:00:00Z'));

    // A refresh without a date keeps the known one (as pub_date already does).
    state.feed = feedWith(undefined);
    await ingestPodcastFeed('https://example.com/feed.xml');
    expect(stored()).toEqual({ pub_date: 'Wed, 07 Oct 2026 08:00:00 GMT', pub_ts: Date.parse('2026-10-07T08:00:00Z') });
  });

  it('stores null for an unparsable date', async () => {
    state.feed = feedWith('sometime last week');
    await ingestPodcastFeed('https://example.com/feed.xml');
    expect(stored()).toEqual({ pub_date: 'sometime last week', pub_ts: null });
  });
});
