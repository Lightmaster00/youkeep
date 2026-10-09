import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import {
  albumMatchDeps,
  cancelAlbumMatchRun,
  enqueueAlbumMatch,
  getAlbumMatchPreview,
  getAlbumMatchStatus,
  isAlbumMatchRunning,
  scheduleStartupAlbumMatch,
  setAlbumMatchingEnabled,
  startAlbumMatchRun,
} from '../../server/utils/albumMatchRunner';
import type { ItunesMatch } from '../../server/utils/albumMatch';
import { markMusicTrackCompleted } from '../../server/utils/musicDownloader';
import { createTestDb, insertMusicAlbum, insertMusicArtist, insertMusicTrack, insertSetting } from '../helpers/testDb';

let db: Database.Database;
const realDeps = { ...albumMatchDeps };
let searchCalls: Array<[string, string]>;
let sleeps: number[];
let search: (artist: string, title: string) => Promise<ItunesMatch | null>;

const match = (collectionId: string, collectionName = `Album ${collectionId}`): ItunesMatch => ({
  collectionId, collectionName, albumType: 'album', artworkUrl: 'https://art/600x600bb.jpg', releaseYear: 2001, trackNumber: 1, genre: 'Pop',
});
const track = (id: string) => db.prepare('SELECT * FROM music_tracks WHERE id = ?').get(id) as any;

async function waitIdle() {
  for (let i = 0; i < 400; i++) {
    if (!isAlbumMatchRunning()) return getAlbumMatchStatus();
    await new Promise((r) => setTimeout(r, 2));
  }
  throw new Error('album matching did not finish');
}

beforeEach(async () => {
  await waitIdle();
  db = createTestDb();
  (globalThis as any).getDb = () => db;
  insertMusicArtist(db, { id: 'a1', name: 'Daft Punk' });
  searchCalls = [];
  sleeps = [];
  search = async (_artist, title) => (title.includes('Lucky') ? match('1', 'Random Access Memories') : null);
  albumMatchDeps.search = async (artist, title) => {
    searchCalls.push([artist, title]);
    return search(artist, title);
  };
  albumMatchDeps.throttle = async () => {};
  albumMatchDeps.sleep = async (ms) => { sleeps.push(ms); };
});

afterEach(async () => {
  cancelAlbumMatchRun();
  await waitIdle();
  Object.assign(albumMatchDeps, realDeps);
  vi.useRealTimers();
});

describe('album matching runs', () => {
  it('matches the backlog of unchecked completed tracks only', async () => {
    insertMusicAlbum(db, { id: 'yt', artistId: 'a1', title: 'From yt-dlp' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', title: 'Get Lucky (Official Video)' });
    insertMusicTrack(db, { id: 't2', artistId: 'a1', title: 'Unknown Song' });
    insertMusicTrack(db, { id: 'manual', artistId: 'a1', title: 'Get Lucky', albumMatchStatus: 'manual' });
    insertMusicTrack(db, { id: 'ytdlp', artistId: 'a1', title: 'Get Lucky', albumId: 'yt' });
    insertMusicTrack(db, { id: 'pending', artistId: 'a1', title: 'Get Lucky', downloadStatus: 'pending' });

    const result = startAlbumMatchRun('unchecked', db);
    expect(result).toEqual({ started: true, joined: false, queued: 2 });
    // Nothing runs inside the request that started it.
    expect(searchCalls).toEqual([]);

    const status = await waitIdle();
    expect(status).toMatchObject({ state: 'done', scope: 'unchecked', total: 2, processed: 2, matched: 1, unmatched: 1, errors: 0 });
    expect(searchCalls).toEqual([['Daft Punk', 'Get Lucky (Official Video)'], ['Daft Punk', 'Unknown Song']]);
    expect(track('t1')).toMatchObject({ album_match_status: 'matched' });
    expect(track('t2')).toMatchObject({ album_match_status: 'unmatched', album_id: null });
    expect(track('manual')).toMatchObject({ album_match_status: 'manual', album_id: null });
    expect(track('ytdlp')).toMatchObject({ album_id: 'yt' });
    expect(track('pending').album_match_status).toBeNull();
  });

  it('spaces every iTunes request (search and collection lookup) through the throttle', async () => {
    const order: string[] = [];
    albumMatchDeps.search = realDeps.search;
    albumMatchDeps.throttle = async () => { order.push('throttle'); };
    albumMatchDeps.client = {
      search: async (term) => {
        order.push(`search ${term}`);
        return [1, 2].map((n) => ({ wrapperType: 'track', kind: 'song', artistName: 'Daft Punk', trackName: 'Get Lucky', collectionId: n, collectionName: `Album ${n}`, releaseDate: '2013-05-17T07:00:00Z' }));
      },
      lookup: async (ids) => {
        order.push(`lookup ${ids.join(',')}`);
        return [{ wrapperType: 'collection', collectionId: 2, collectionType: 'Album', releaseDate: '2001-01-01T00:00:00Z', trackCount: 10 }];
      },
    };
    insertMusicTrack(db, { id: 't1', artistId: 'a1', title: 'Get Lucky (Official Video)' });
    startAlbumMatchRun('unchecked', db);
    expect(await waitIdle()).toMatchObject({ state: 'done', matched: 1 });
    expect(order).toEqual(['throttle', 'search Daft Punk Get Lucky', 'throttle', 'lookup 1,2']);
    expect((db.prepare('SELECT a.title, a.release_year FROM music_tracks t JOIN music_albums a ON a.id = t.album_id').get() as any))
      .toEqual({ title: 'Album 2', release_year: 2001 });
  });

  it('a transient lookup failure backs off and leaves the track unchecked', async () => {
    albumMatchDeps.search = realDeps.search;
    albumMatchDeps.client = {
      search: async () => [1, 2].map((n) => ({ wrapperType: 'track', kind: 'song', artistName: 'Daft Punk', trackName: 'Get Lucky', collectionId: n, collectionName: `Album ${n}` })),
      lookup: async () => { throw Object.assign(new Error('Too Many Requests'), { statusCode: 429 }); },
    };
    insertMusicTrack(db, { id: 't1', artistId: 'a1', title: 'Get Lucky' });
    startAlbumMatchRun('unchecked', db);
    expect(await waitIdle()).toMatchObject({ state: 'done', errors: 1, matched: 0 });
    expect(sleeps).toEqual([30_000]);
    expect(track('t1').album_match_status).toBeNull();
  });

  it('retries only the unmatched tracks when asked', async () => {
    insertMusicTrack(db, { id: 'u1', artistId: 'a1', title: 'Get Lucky', albumMatchStatus: 'unmatched' });
    insertMusicTrack(db, { id: 'n1', artistId: 'a1', title: 'Fresh' });
    startAlbumMatchRun('unmatched', db);
    expect(await waitIdle()).toMatchObject({ state: 'done', scope: 'unmatched', total: 1, matched: 1 });
    expect(searchCalls.map((c) => c[1])).toEqual(['Get Lucky']);
    expect(track('n1').album_match_status).toBeNull();
  });

  it('runs one at a time: a second start joins the running run without duplicates', async () => {
    let release!: () => void;
    let active = 0;
    let maxActive = 0;
    search = async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise<void>((r) => { release = r; });
      active--;
      return null;
    };
    insertMusicTrack(db, { id: 't1', artistId: 'a1', title: 'One', createdAt: 1 });
    insertMusicTrack(db, { id: 't2', artistId: 'a1', title: 'Two', createdAt: 2 });
    startAlbumMatchRun('unchecked', db);
    await vi.waitFor(() => expect(searchCalls).toHaveLength(1));

    insertMusicTrack(db, { id: 't3', artistId: 'a1', title: 'Three', createdAt: 3 });
    expect(startAlbumMatchRun('unchecked', db)).toEqual({ started: true, joined: true, queued: 1 });
    expect(enqueueAlbumMatch('t2', db)).toBe(false);
    expect(getAlbumMatchStatus().total).toBe(3);

    for (let i = 1; i <= 3; i++) {
      await vi.waitFor(() => expect(searchCalls).toHaveLength(i));
      release();
    }
    expect(await waitIdle()).toMatchObject({ state: 'done', processed: 3, unmatched: 3 });
    expect(maxActive).toBe(1);
    expect(searchCalls.map((c) => c[1])).toEqual(['One', 'Two', 'Three']);
  });

  it('cancels after the current track; the rest stays unchecked and a later run resumes it', async () => {
    let release!: () => void;
    search = async () => { await new Promise<void>((r) => { release = r; }); return null; };
    insertMusicTrack(db, { id: 't1', artistId: 'a1', title: 'One', createdAt: 1 });
    insertMusicTrack(db, { id: 't2', artistId: 'a1', title: 'Two', createdAt: 2 });
    startAlbumMatchRun('unchecked', db);
    await vi.waitFor(() => expect(searchCalls).toHaveLength(1));
    expect(cancelAlbumMatchRun()).toBe(true);
    release();
    expect(await waitIdle()).toMatchObject({ state: 'cancelled', processed: 1 });
    expect(track('t2').album_match_status).toBeNull();
    expect(cancelAlbumMatchRun()).toBe(false);

    search = async () => null;
    expect(startAlbumMatchRun('unchecked', db)).toMatchObject({ started: true, queued: 1 });
    expect(await waitIdle()).toMatchObject({ state: 'done', processed: 1 });
    expect(track('t2').album_match_status).toBe('unmatched');
  });

  it('backs off exponentially on 429/5xx, leaves those tracks unchecked and gives up after 5 in a row', async () => {
    search = async () => { throw Object.assign(new Error('Service Unavailable'), { statusCode: 503 }); };
    for (let i = 1; i <= 6; i++) insertMusicTrack(db, { id: `t${i}`, artistId: 'a1', title: `Song ${i}`, createdAt: i });
    startAlbumMatchRun('unchecked', db);
    const status = await waitIdle();
    expect(status).toMatchObject({ state: 'failed', processed: 5, errors: 5 });
    expect(status.lastError).toContain('did not answer 5 times in a row');
    expect(sleeps).toEqual([30_000, 60_000, 120_000, 240_000]);
    for (let i = 1; i <= 6; i++) expect(track(`t${i}`).album_match_status).toBeNull();
  });

  it('a success resets the backoff; other errors are counted without waiting', async () => {
    const replies: Array<() => ItunesMatch | null> = [
      () => { throw Object.assign(new Error('Too Many Requests'), { statusCode: 429 }); },
      () => null,
      () => { throw Object.assign(new Error('Too Many Requests'), { statusCode: 429 }); },
      () => { throw Object.assign(new Error('Bad Request'), { statusCode: 400 }); },
    ];
    search = async () => replies.shift()!();
    for (let i = 1; i <= 4; i++) insertMusicTrack(db, { id: `t${i}`, artistId: 'a1', title: `Song ${i}`, createdAt: i });
    startAlbumMatchRun('unchecked', db);
    expect(await waitIdle()).toMatchObject({ state: 'done', processed: 4, errors: 3, unmatched: 1, lastError: 'Bad Request' });
    expect(sleeps).toEqual([30_000, 30_000]);
  });

  it('is crash-safe: a database error during a run fails it without throwing', async () => {
    insertMusicTrack(db, { id: 't1', artistId: 'a1', title: 'Get Lucky' });
    search = async () => { db.exec('DROP TABLE music_albums'); return match('1'); };
    startAlbumMatchRun('unchecked', db);
    const status = await waitIdle();
    expect(['done', 'failed']).toContain(status.state);
    expect(status.errors).toBe(1);
  });

  it('respects the setting: refuses to start, ignores downloads, and stops a running run when turned off', async () => {
    insertMusicTrack(db, { id: 't1', artistId: 'a1', title: 'One', createdAt: 1 });
    insertMusicTrack(db, { id: 't2', artistId: 'a1', title: 'Two', createdAt: 2 });
    setAlbumMatchingEnabled(db, false);
    expect(startAlbumMatchRun('unchecked', db)).toEqual({ started: false, error: 'Album matching is turned off.' });
    expect(enqueueAlbumMatch('t1', db)).toBe(false);
    expect(isAlbumMatchRunning()).toBe(false);

    setAlbumMatchingEnabled(db, true);
    let release!: () => void;
    search = async () => { await new Promise<void>((r) => { release = r; }); return null; };
    startAlbumMatchRun('unchecked', db);
    await vi.waitFor(() => expect(searchCalls).toHaveLength(1));
    setAlbumMatchingEnabled(db, false);
    release();
    expect(await waitIdle()).toMatchObject({ state: 'cancelled', processed: 1 });
    expect(searchCalls).toHaveLength(1);
  });

  it('stops at the next track when the setting is turned off directly in the database', async () => {
    let release!: () => void;
    search = async () => { await new Promise<void>((r) => { release = r; }); return null; };
    insertMusicTrack(db, { id: 't1', artistId: 'a1', title: 'One', createdAt: 1 });
    insertMusicTrack(db, { id: 't2', artistId: 'a1', title: 'Two', createdAt: 2 });
    startAlbumMatchRun('unchecked', db);
    await vi.waitFor(() => expect(searchCalls).toHaveLength(1));
    insertSetting(db, { key: 'album_matching_enabled', value: '0' });
    release();
    expect(await waitIdle()).toMatchObject({ state: 'cancelled', processed: 1, lastError: 'Album matching was turned off.' });
    expect(track('t2').album_match_status).toBeNull();
  });

  it('turning matching off (or cancelling) cuts a backoff wait short', async () => {
    albumMatchDeps.sleep = realDeps.sleep;
    search = async () => { throw Object.assign(new Error('Service Unavailable'), { statusCode: 503 }); };
    insertMusicTrack(db, { id: 't1', artistId: 'a1', title: 'One', createdAt: 1 });
    insertMusicTrack(db, { id: 't2', artistId: 'a1', title: 'Two', createdAt: 2 });
    startAlbumMatchRun('unchecked', db);
    await vi.waitFor(() => expect(getAlbumMatchStatus().errors).toBe(1));
    setAlbumMatchingEnabled(db, false);
    expect(await waitIdle()).toMatchObject({ state: 'cancelled', processed: 1 });
    expect(searchCalls).toHaveLength(1);
  });

  it('a finished download queues its track (no real HTTP), unless matching is off', async () => {
    insertMusicTrack(db, { id: 't1', artistId: 'a1', title: 'Get Lucky', downloadStatus: 'downloading' });
    markMusicTrackCompleted('t1', null);
    expect(track('t1').download_status).toBe('completed');
    expect(await waitIdle()).toMatchObject({ state: 'done', matched: 1 });
    expect(track('t1').album_match_status).toBe('matched');

    insertSetting(db, { key: 'album_matching_enabled', value: '0' });
    insertMusicTrack(db, { id: 't2', artistId: 'a1', title: 'Get Lucky', downloadStatus: 'downloading' });
    markMusicTrackCompleted('t2', null);
    await waitIdle();
    expect(track('t2')).toMatchObject({ download_status: 'completed', album_match_status: null });
    expect(searchCalls).toHaveLength(1);
  });

  it('at startup, starts after a delay when unchecked tracks exist and matching is on', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', title: 'Get Lucky' });
    scheduleStartupAlbumMatch(1000);
    await vi.advanceTimersByTimeAsync(999);
    expect(isAlbumMatchRunning()).toBe(false);
    expect(searchCalls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    vi.useRealTimers();
    await vi.waitFor(() => expect(track('t1').album_match_status).toBe('matched'));
    expect(await waitIdle()).toMatchObject({ state: 'done', matched: 1 });

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    insertMusicTrack(db, { id: 't2', artistId: 'a1', title: 'Get Lucky' });
    setAlbumMatchingEnabled(db, false);
    scheduleStartupAlbumMatch(1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(isAlbumMatchRunning()).toBe(false);
    expect(track('t2').album_match_status).toBeNull();
  });

  it('previews the counts of completed tracks', () => {
    insertMusicAlbum(db, { id: 'yt', artistId: 'a1' });
    insertMusicTrack(db, { id: 'n1', artistId: 'a1' });
    insertMusicTrack(db, { id: 'n2', artistId: 'a1' });
    insertMusicTrack(db, { id: 'm1', artistId: 'a1', albumMatchStatus: 'matched' });
    insertMusicTrack(db, { id: 'u1', artistId: 'a1', albumMatchStatus: 'unmatched' });
    insertMusicTrack(db, { id: 'x1', artistId: 'a1', albumMatchStatus: 'manual' });
    insertMusicTrack(db, { id: 'y1', artistId: 'a1', albumId: 'yt' });
    insertMusicTrack(db, { id: 'p1', artistId: 'a1', downloadStatus: 'pending' });
    expect(getAlbumMatchPreview(db)).toEqual({ completedTracks: 6, unchecked: 2, matched: 1, unmatched: 1, manual: 2, enabled: true });
    setAlbumMatchingEnabled(db, false);
    expect(getAlbumMatchPreview(db).enabled).toBe(false);
  });
});
