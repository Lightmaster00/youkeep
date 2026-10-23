import { describe, it, expect } from 'vitest';
import { SUPPORTED_LANGUAGES, isLanguageCode, pickLanguage, LANGUAGE_NAMES } from '../../shared/languages';

describe('languages', () => {
  it('lists the nine languages, each with a native name', () => {
    expect([...SUPPORTED_LANGUAGES]).toEqual(['en', 'fr', 'es', 'de', 'pt', 'it', 'zh', 'ja', 'ru']);
    for (const c of SUPPORTED_LANGUAGES) expect(LANGUAGE_NAMES[c]).toBeTruthy();
  });
  it('validates codes', () => {
    expect(isLanguageCode('fr')).toBe(true);
    expect(isLanguageCode('xx')).toBe(false);
    expect(isLanguageCode(null)).toBe(false);
  });
  it('picks from Accept-Language by quality, on the primary subtag', () => {
    expect(pickLanguage('fr-CA,fr;q=0.9,en;q=0.8')).toBe('fr');
    expect(pickLanguage('xx;q=1, de;q=0.5')).toBe('de');
    expect(pickLanguage('zh-Hans-CN')).toBe('zh');
    expect(pickLanguage('')).toBe('en');
    expect(pickLanguage(undefined)).toBe('en');
    expect(pickLanguage('xx, yy')).toBe('en');
  });
});
