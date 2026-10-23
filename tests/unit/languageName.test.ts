import { describe, it, expect } from 'vitest';
import { languageName } from '../../app/utils/languageName';

describe('languageName (#35)', () => {
  it.each([
    ['en', 'English'], ['fr', 'French'], ['de', 'German'], ['pt-BR', 'Brazilian Portuguese'],
    ['', ''], [null, ''], ['not a code!', 'not a code!'], ['qq', 'qq'],
  ])('%j -> %j', (code, name) => {
    expect(languageName(code as any)).toBe(name);
  });
});

describe('languageName in each UI locale', () => {
  it.each([
    ['es', 'fr', 'francés'], ['de', 'fr', 'Französisch'], ['pt', 'fr', 'francês'], ['it', 'fr', 'francese'],
    ['zh', 'fr', '法语'], ['ja', 'fr', 'フランス語'], ['ru', 'fr', 'французский'],
    ['es', 'en', 'inglés'], ['de', 'en', 'Englisch'], ['zh', 'en', '英语'], ['ja', 'en', '英語'], ['ru', 'en', 'английский'],
  ])('%s names %s as %j', (locale, code, expected) => {
    expect(languageName(code, locale)).toBe(expected);
  });
  it('never leaks the English name in another locale', () => {
    for (const locale of ['es', 'de', 'pt', 'it', 'zh', 'ja', 'ru']) {
      expect(languageName('fr', locale)).not.toBe('French');
    }
  });
});
