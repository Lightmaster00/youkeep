import { describe, it, expect } from 'vitest';
import { formatViewCount, formatUploadDate, formatDateTime } from '../../app/utils/formatCount';

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

describe('formatViewCount in the other UI languages', () => {
  // Own unit tables, not Intl compact notation: server and browser CLDR data differ.
  it.each([
    ['es', '1,2\u00a0mil', '1,5\u00a0M'], ['de', '1.234', '1,5\u00a0Mio.'], ['pt', '1,2\u00a0mil', '1,5\u00a0mi'],
    ['it', '1,2\u00a0K', '1,5\u00a0Mln'], ['zh', '1,234', '150万'], ['ja', '1,234', '150万'], ['ru', '1,2\u00a0тыс.', '1,5\u00a0млн'],
  ])('%s: %s / %s, never the English k / M', (lang, thousand, million) => {
    expect(formatViewCount(1234, lang)).toBe(thousand);
    expect(formatViewCount(1_500_000, lang)).toBe(million);
    expect(formatViewCount(999, lang)).toBe('999');
    expect(formatViewCount(0, lang)).toBe('0');
    expect(formatViewCount(1234, lang)).not.toBe('1.2k');
  });
  it('steps up a unit instead of printing "1000 unit"', () => {
    expect(formatViewCount(999_960, 'ru')).toBe('1\u00a0млн');
    expect(formatViewCount(99_999_999, 'zh')).toBe('1亿');
  });
  it('uses the 10 000 based units of Chinese and Japanese', () => {
    expect(formatViewCount(12_000, 'zh')).toBe('1.2万');
    expect(formatViewCount(250_000_000, 'ja')).toBe('2.5億');
    expect(formatViewCount(420_000, 'ru')).toBe('420\u00a0тыс.');
  });
});

describe('formatDateTime', () => {
  it('joins separately formatted date and time (no engine-specific "a las")', () => {
    const d = new Date(2026, 9, 24, 9, 5);
    const opts = { day: 'numeric', month: 'long', year: 'numeric' } as const;
    expect(formatDateTime(d, 'es', opts)).toBe('24 de octubre de 2026, 09:05');
    expect(formatDateTime(d, 'zh', opts)).toBe('2026年10月24日 09:05');
    expect(formatDateTime(d, 'en', opts)).toMatch(/^October 24, 2026, 09:05\s?AM$/);
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
  it('words the date in each other UI language', () => {
    expect(formatUploadDate('20260315', 'es')).toBe('15 mar 2026');
    expect(formatUploadDate('20260315', 'de')).toBe('15. März 2026');
    expect(formatUploadDate('20260315', 'zh')).toBe('2026年3月15日');
    expect(formatUploadDate('20260315', 'ja')).toBe('2026年3月15日');
    expect(formatUploadDate('20260315', 'ru')).toBe('15 мар. 2026 г.');
    expect(formatUploadDate('20260315', 'pt')).toMatch(/15 de mar\.? de 2026/);
    expect(formatUploadDate('20260315', 'it')).toBe('15 mar 2026');
  });
});
