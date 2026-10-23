import { describe, it, expect } from 'vitest';
import { resolveUiLanguage } from '../../app/utils/uiLanguage';

describe('resolveUiLanguage', () => {
  it('saved language beats cookie', () => expect(resolveUiLanguage({ userLanguage: 'fr', cookie: 'de' })).toBe('fr'));
  it('cookie beats accept', () => expect(resolveUiLanguage({ cookie: 'de', accept: 'es' })).toBe('de'));
  it('ignores an invalid cookie', () => expect(resolveUiLanguage({ cookie: 'xx', accept: 'es' })).toBe('es'));
  it('defaults to en', () => expect(resolveUiLanguage({})).toBe('en'));
  it('reads Accept-Language', () => expect(resolveUiLanguage({ accept: 'it-IT,it;q=0.9' })).toBe('it'));
});
