import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs';
import {
  DEFAULT_MAX_CONCURRENT_DOWNLOADS,
  parseMaxConcurrentDownloads,
  hasCapacityForMoreDownloads,
  isValidMaxConcurrentValue,
  hasEnoughDiskSpace,
  MIN_FREE_DISK_SPACE_BYTES,
} from '../../server/utils/concurrency';

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
