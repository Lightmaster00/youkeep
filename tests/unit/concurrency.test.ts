import { describe, it, expect } from 'vitest';
import {
  DEFAULT_MAX_CONCURRENT_DOWNLOADS,
  parseMaxConcurrentDownloads,
  hasCapacityForMoreDownloads,
  isValidMaxConcurrentValue,
} from '../../server/utils/concurrency';

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
