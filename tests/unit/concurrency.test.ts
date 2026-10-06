import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs';
import {
  DEFAULT_MAX_CONCURRENT_DOWNLOADS,
  parseMaxConcurrentDownloads,
  hasCapacityForMoreDownloads,
  isValidMaxConcurrentValue,
  hasEnoughDiskSpace,
  MIN_FREE_DISK_SPACE_BYTES,
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
  it('defaults when the raw value is missing', () => {
    expect(parseMaxConcurrentDownloads(undefined)).toBe(DEFAULT_MAX_CONCURRENT_DOWNLOADS);
    expect(parseMaxConcurrentDownloads(null)).toBe(DEFAULT_MAX_CONCURRENT_DOWNLOADS);
  });

  it('defaults when the raw value is not a positive integer', () => {
    expect(parseMaxConcurrentDownloads('0')).toBe(DEFAULT_MAX_CONCURRENT_DOWNLOADS);
    expect(parseMaxConcurrentDownloads('-1')).toBe(DEFAULT_MAX_CONCURRENT_DOWNLOADS);
    expect(parseMaxConcurrentDownloads('abc')).toBe(DEFAULT_MAX_CONCURRENT_DOWNLOADS);
    expect(parseMaxConcurrentDownloads('')).toBe(DEFAULT_MAX_CONCURRENT_DOWNLOADS);
  });

  it('parses a valid positive integer string', () => {
    expect(parseMaxConcurrentDownloads('1')).toBe(1);
    expect(parseMaxConcurrentDownloads('5')).toBe(5);
  });
});

describe('hasCapacityForMoreDownloads', () => {
  it('returns true when active count is below the max', () => {
    expect(hasCapacityForMoreDownloads(1, 3)).toBe(true);
  });

  it('returns false when active count equals the max', () => {
    expect(hasCapacityForMoreDownloads(3, 3)).toBe(false);
  });

  it('returns false when active count exceeds the max (e.g. after lowering the setting)', () => {
    expect(hasCapacityForMoreDownloads(5, 3)).toBe(false);
  });

  it('returns true when nothing is active', () => {
    expect(hasCapacityForMoreDownloads(0, 1)).toBe(true);
  });
});

describe('isValidMaxConcurrentValue', () => {
  it('accepts positive integers', () => {
    expect(isValidMaxConcurrentValue(1)).toBe(true);
    expect(isValidMaxConcurrentValue(10)).toBe(true);
  });

  it('rejects zero and negative numbers', () => {
    expect(isValidMaxConcurrentValue(0)).toBe(false);
    expect(isValidMaxConcurrentValue(-1)).toBe(false);
  });

  it('rejects values above the upper bound of 10', () => {
    expect(isValidMaxConcurrentValue(11)).toBe(false);
    expect(isValidMaxConcurrentValue(100)).toBe(false);
  });

  it('rejects non-integers and non-numbers', () => {
    expect(isValidMaxConcurrentValue(1.5)).toBe(false);
    expect(isValidMaxConcurrentValue('3')).toBe(false);
    expect(isValidMaxConcurrentValue(null)).toBe(false);
    expect(isValidMaxConcurrentValue(undefined)).toBe(false);
  });
});

describe('hasEnoughDiskSpace', () => {
  it('returns true when free space is above the threshold', async () => {
    vi.spyOn(fs.promises, 'statfs').mockResolvedValue({
      bavail: 10_000_000,
      bsize: 1024, // 10,000,000 * 1024 bytes = ~9.5 GB free, well above 500 MB
    } as any);

    const result = await hasEnoughDiskSpace('/some/dir');
    expect(result).toBe(true);
  });

  it('returns false when free space is below the threshold', async () => {
    vi.spyOn(fs.promises, 'statfs').mockResolvedValue({
      bavail: 100,
      bsize: 1024, // 100 * 1024 bytes = ~100 KB free, well below 500 MB
    } as any);

    const result = await hasEnoughDiskSpace('/some/dir');
    expect(result).toBe(false);
  });

  it('returns true (fails open) when statfs throws', async () => {
    vi.spyOn(fs.promises, 'statfs').mockRejectedValue(new Error('ENOENT'));

    const result = await hasEnoughDiskSpace('/nonexistent/dir');
    expect(result).toBe(true);
  });

  it('exports the 500 MB threshold constant', () => {
    expect(MIN_FREE_DISK_SPACE_BYTES).toBe(500 * 1024 * 1024);
  });
});

describe('resetStaleDownloadsForTable', () => {
  it('resets downloading videos to pending and clears progress/speed/eta', () => {
    const db = createTestDb();
    insertChannel(db, { id: 'c1' });
    insertVideo(db, { id: 'v1', channelId: 'c1', downloadStatus: 'downloading' });
    db.prepare("UPDATE videos SET download_progress = 42, download_speed = '1MB/s', download_eta = '00:10' WHERE id = 'v1'").run();

    const log = vi.fn();
    resetStaleDownloadsForTable(db, 'videos', 'téléchargements interrompus', 'downloads', log);

    const row = db.prepare('SELECT download_status, download_progress, download_speed, download_eta FROM videos WHERE id = ?').get('v1') as any;
    expect(row.download_status).toBe('pending');
    expect(row.download_progress).toBe(0);
    expect(row.download_speed).toBeNull();
    expect(row.download_eta).toBeNull();
    expect(log).toHaveBeenCalledWith('Réinitialisation de 1 téléchargements interrompus.');
  });

  it('resets downloading music tracks to pending using the music_tracks table', () => {
    const db = createTestDb();
    insertMusicArtist(db, { id: 'a1' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', downloadStatus: 'downloading' });

    const log = vi.fn();
    resetStaleDownloadsForTable(db, 'music_tracks', 'téléchargements musicaux interrompus', 'music downloads', log);

    const row = db.prepare('SELECT download_status FROM music_tracks WHERE id = ?').get('t1') as any;
    expect(row.download_status).toBe('pending');
    expect(log).toHaveBeenCalledWith('Réinitialisation de 1 téléchargements musicaux interrompus.');
  });

  it('resets downloading podcast episodes to pending using the podcast_episodes table', () => {
    const db = createTestDb();
    insertPodcastShow(db, { id: 'sh1' });
    insertPodcastEpisode(db, { id: 'e1', showId: 'sh1', downloadStatus: 'downloading' });

    const log = vi.fn();
    resetStaleDownloadsForTable(db, 'podcast_episodes', 'téléchargements de podcasts interrompus', 'podcast downloads', log);

    const row = db.prepare('SELECT download_status FROM podcast_episodes WHERE id = ?').get('e1') as any;
    expect(row.download_status).toBe('pending');
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

  it('leaves unrelated rows (not in downloading status) untouched', () => {
    const db = createTestDb();
    insertChannel(db, { id: 'c1' });
    insertVideo(db, { id: 'v1', channelId: 'c1', downloadStatus: 'downloading' });
    insertVideo(db, { id: 'v2', channelId: 'c1', downloadStatus: 'completed' });
    insertVideo(db, { id: 'v3', channelId: 'c1', downloadStatus: 'failed' });

    const log = vi.fn();
    resetStaleDownloadsForTable(db, 'videos', 'téléchargements interrompus', 'downloads', log);

    expect((db.prepare('SELECT download_status FROM videos WHERE id = ?').get('v2') as any).download_status).toBe('completed');
    expect((db.prepare('SELECT download_status FROM videos WHERE id = ?').get('v3') as any).download_status).toBe('failed');
    expect(log).toHaveBeenCalledWith('Réinitialisation de 1 téléchargements interrompus.');
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
