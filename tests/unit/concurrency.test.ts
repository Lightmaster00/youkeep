import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs';
import {
  DEFAULT_MAX_CONCURRENT_DOWNLOADS,
  parseMaxConcurrentDownloads,
  hasCapacityForMoreDownloads,
  isValidMaxConcurrentValue,
  hasEnoughDiskSpace,
  resetStaleDownloadsForTable,
} from '../../server/utils/concurrency';
import {
  createTestDb,
  insertChannel,
  insertVideo,
  insertMusicArtist,
  insertMusicTrack,
  insertPodcastShow,
  insertPodcastEpisode,
} from '../helpers/testDb';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('parseMaxConcurrentDownloads', () => {
  it.each([undefined, null, '', '0', '-1', 'abc'])('defaults for %j', (raw) => {
    expect(parseMaxConcurrentDownloads(raw as any)).toBe(DEFAULT_MAX_CONCURRENT_DOWNLOADS);
  });

  it('parses a valid positive integer string', () => {
    expect(parseMaxConcurrentDownloads('1')).toBe(1);
    expect(parseMaxConcurrentDownloads('5')).toBe(5);
  });
});

describe('hasCapacityForMoreDownloads', () => {
  it('has capacity only while active < max (also after lowering the setting)', () => {
    expect(hasCapacityForMoreDownloads(0, 1)).toBe(true);
    expect(hasCapacityForMoreDownloads(2, 3)).toBe(true);
    expect(hasCapacityForMoreDownloads(3, 3)).toBe(false);
    expect(hasCapacityForMoreDownloads(5, 3)).toBe(false);
  });
});

describe('isValidMaxConcurrentValue', () => {
  it.each([
    [1, true], [10, true], [0, false], [-1, false], [11, false], [1.5, false], ['3', false], [null, false], [undefined, false],
  ])('%j → %s', (value, expected) => {
    expect(isValidMaxConcurrentValue(value)).toBe(expected);
  });
});

describe('hasEnoughDiskSpace', () => {
  it('compares free space with the 500 MB threshold', async () => {
    const statfs = vi.spyOn(fs.promises, 'statfs');
    statfs.mockResolvedValueOnce({ bavail: 500 * 1024, bsize: 1024 } as any);
    expect(await hasEnoughDiskSpace('/some/dir')).toBe(true);
    statfs.mockResolvedValueOnce({ bavail: 500 * 1024 - 1, bsize: 1024 } as any);
    expect(await hasEnoughDiskSpace('/some/dir')).toBe(false);
  });

  it('returns true (fails open) when statfs throws', async () => {
    vi.spyOn(fs.promises, 'statfs').mockRejectedValue(new Error('ENOENT'));
    expect(await hasEnoughDiskSpace('/nonexistent/dir')).toBe(true);
  });
});

describe('resetStaleDownloadsForTable', () => {
  it('resets only downloading rows to pending, clears progress/speed/eta and logs the count', () => {
    const db = createTestDb();
    insertChannel(db, { id: 'c1' });
    insertVideo(db, { id: 'v1', channelId: 'c1', downloadStatus: 'downloading' });
    insertVideo(db, { id: 'v2', channelId: 'c1', downloadStatus: 'completed' });
    insertVideo(db, { id: 'v3', channelId: 'c1', downloadStatus: 'failed' });
    db.prepare("UPDATE videos SET download_progress = 42, download_speed = '1MB/s', download_eta = '00:10' WHERE id = 'v1'").run();

    const log = vi.fn();
    resetStaleDownloadsForTable(db, 'videos', 'téléchargements interrompus', 'downloads', log);

    const row = db.prepare('SELECT download_status, download_progress, download_speed, download_eta FROM videos WHERE id = ?').get('v1') as any;
    expect(row).toEqual({ download_status: 'pending', download_progress: 0, download_speed: null, download_eta: null });
    const status = (id: string) => (db.prepare('SELECT download_status FROM videos WHERE id = ?').get(id) as any).download_status;
    expect(status('v2')).toBe('completed');
    expect(status('v3')).toBe('failed');
    expect(log).toHaveBeenCalledWith('Réinitialisation de 1 téléchargements interrompus.');
  });

  it('works on the music_tracks and podcast_episodes tables', () => {
    const db = createTestDb();
    insertMusicArtist(db, { id: 'a1' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', downloadStatus: 'downloading' });
    insertPodcastShow(db, { id: 'sh1' });
    insertPodcastEpisode(db, { id: 'e1', showId: 'sh1', downloadStatus: 'downloading' });

    const log = vi.fn();
    resetStaleDownloadsForTable(db, 'music_tracks', 'téléchargements musicaux interrompus', 'music downloads', log);
    resetStaleDownloadsForTable(db, 'podcast_episodes', 'téléchargements de podcasts interrompus', 'podcast downloads', log);

    expect((db.prepare('SELECT download_status FROM music_tracks WHERE id = ?').get('t1') as any).download_status).toBe('pending');
    expect((db.prepare('SELECT download_status FROM podcast_episodes WHERE id = ?').get('e1') as any).download_status).toBe('pending');
    expect(log).toHaveBeenCalledWith('Réinitialisation de 1 téléchargements musicaux interrompus.');
    expect(log).toHaveBeenCalledWith('Réinitialisation de 1 téléchargements de podcasts interrompus.');
  });

  it('does not call log when no rows were changed', () => {
    const db = createTestDb();
    insertChannel(db, { id: 'c1' });
    insertVideo(db, { id: 'v1', channelId: 'c1', downloadStatus: 'completed' });
    const log = vi.fn();
    resetStaleDownloadsForTable(db, 'videos', 'téléchargements interrompus', 'downloads', log);
    expect(log).not.toHaveBeenCalled();
  });

  it('catches a query failure, logs to console.error, and does not throw or call log', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const brokenDb = { prepare: () => { throw new Error('boom'); } } as any;
    const log = vi.fn();
    expect(() => resetStaleDownloadsForTable(brokenDb, 'videos', 'téléchargements interrompus', 'downloads', log)).not.toThrow();
    expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to reset stale downloads:', expect.any(Error));
    expect(log).not.toHaveBeenCalled();
  });
});
