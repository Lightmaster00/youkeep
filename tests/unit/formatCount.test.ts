import { describe, it, expect } from 'vitest';
import { formatViewCount, formatUploadDate } from '../../app/utils/formatCount';

describe('formatViewCount', () => {
  it('keeps the short English spelling', () => {
    expect(formatViewCount(0, 'en')).toBe('0');
    expect(formatViewCount(null, 'en')).toBe('0');
    expect(formatViewCount(999, 'en')).toBe('999');
    expect(formatViewCount(1000, 'en')).toBe('1k');
    expect(formatViewCount(1234, 'en')).toBe('1.2k');
    expect(formatViewCount(1_500_000, 'en')).toBe('1.5M');
    expect(formatViewCount(2_000_000, 'en')).toBe('2M');
  });

  it('follows the French separators and units', () => {
    const fr = (n: number) => formatViewCount(n, 'fr').replace(/\s/g, ' ');
    expect(fr(999)).toBe('999');
    expect(fr(1234)).toMatch(/^1,2 k$/);
    expect(fr(1_500_000)).toMatch(/^1,5 M$/);
  });
});

describe('formatUploadDate', () => {
  it('words a YYYYMMDD date in the UI language', () => {
    expect(formatUploadDate('20260315', 'en')).toBe('Mar 15, 2026');
    expect(formatUploadDate('20260315', 'fr')).toBe('15 mars 2026');
  });
  it('returns an empty string for none and the raw text for garbage', () => {
    expect(formatUploadDate(null, 'en')).toBe('');
    expect(formatUploadDate('soon', 'en')).toBe('soon');
  });
});
