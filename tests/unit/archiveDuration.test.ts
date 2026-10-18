import { describe, it, expect } from 'vitest';
import { formatArchiveDuration } from '../../app/utils/archiveDuration';

describe('formatArchiveDuration (#24)', () => {
  it.each([
    [0, '0 min'], [null, '0 min'], [30, '< 1 min'], [6 * 60, '6 min'], [59 * 60 + 59, '59 min'],
    [3600, '1h 00m'], [2 * 3600 + 5 * 60, '2h 05m'], [150 * 3600, '150h'], [1234 * 3600, '1,234h'],
  ])('%j -> %s', (secs, text) => {
    expect(formatArchiveDuration(secs as any)).toBe(text);
  });
});
