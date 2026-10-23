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

describe('formatViewCount in the other UI languages', () => {
  it.each(['es', 'de', 'pt', 'it', 'zh', 'ja', 'ru'])('%s: compact units, no English "k" / "M" shortcut', (lang) => {
    const out = formatViewCount(1234, lang);
    expect(out).toBe(new Intl.NumberFormat(lang, { notation: 'compact', maximumFractionDigits: 1 }).format(1234));
    expect(out).not.toBe('1.2k');
    expect(formatViewCount(999, lang)).toBe('999');
    expect(formatViewCount(0, lang)).toBe('0');
  });
  it('uses each language\'s own separator and unit', () => {
    const n = (lang: string) => formatViewCount(1_500_000, lang).replace(/\s/g, ' ');
    expect(n('de')).toBe('1,5 Mio.');
    expect(n('es')).toMatch(/^1,5 M$/);
    expect(n('zh')).toBe('150万');
    expect(n('ja')).toBe('150万');
    expect(n('ru')).toMatch(/^1,5 млн$/);
    expect(n('pt')).toMatch(/^1,5 mi$/);
    expect(n('it')).toMatch(/^1,5 Mln$/);
    expect(formatViewCount(12_000, 'zh')).toBe('1.2万');
    expect(formatViewCount(12_000, 'ru').replace(/\s/g, ' ')).toBe('12 тыс.');
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
