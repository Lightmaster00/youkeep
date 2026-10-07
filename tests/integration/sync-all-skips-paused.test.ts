import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { listChannelsToSync } from '../../server/utils/downloader';
import { listMusicArtistsToSync } from '../../server/utils/musicDownloader';
import { listPodcastShowsToSync } from '../../server/utils/podcastDownloader';
import { createTestDb, insertChannel, insertMusicArtist, insertPodcastShow } from '../helpers/testDb';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
});

const statuses = (table: string) =>
  Object.fromEntries((db.prepare(`SELECT id, sync_status FROM ${table} ORDER BY id`).all() as any[]).map((r) => [r.id, r.sync_status]));

describe('sync-all only re-checks followed sources and never resumes paused ones', () => {
  it('channels', () => {
    insertChannel(db, { id: 'c1', title: 'Followed' });
    insertChannel(db, { id: 'c2', title: 'Paused' });
    db.prepare("UPDATE channels SET sync_status = 'downloading' WHERE id = 'c1'").run();
    db.prepare("UPDATE channels SET sync_status = 'paused' WHERE id = 'c2'").run();

    expect(listChannelsToSync(db).map((c) => c.id)).toEqual(['c1']);
    expect(statuses('channels')).toEqual({ c1: 'downloading', c2: 'paused' });
  });

  it('music artists', () => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicArtist(db, { id: 'a2' });
    db.prepare("UPDATE music_artists SET channel_id = 'UC' || id, sync_status = CASE id WHEN 'a1' THEN 'downloading' ELSE 'paused' END").run();

    expect(listMusicArtistsToSync(db).map((a) => a.id)).toEqual(['a1']);
    expect(statuses('music_artists')).toEqual({ a1: 'downloading', a2: 'paused' });
  });

  it('podcast shows', () => {
    insertPodcastShow(db, { id: 's1', feedUrl: 'https://example.com/1', syncStatus: 'downloading' });
    insertPodcastShow(db, { id: 's2', feedUrl: 'https://example.com/2', syncStatus: 'paused' });

    expect(listPodcastShowsToSync(db).map((s) => s.id)).toEqual(['s1']);
    expect(statuses('podcast_shows')).toEqual({ s1: 'downloading', s2: 'paused' });
  });
});
