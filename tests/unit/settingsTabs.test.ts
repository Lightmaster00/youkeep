import { describe, it, expect } from 'vitest';
import { normalizeSettingsTab } from '../../app/utils/settingsTabs';

describe('normalizeSettingsTab', () => {
  it.each([
    [{ tab: 'users' }, { tab: 'users', section: null }],
    [{ tab: 'library' }, { tab: 'library', section: null }],
    [{ tab: 'library', section: 'podcasts' }, { tab: 'library', section: 'podcasts' }],
    [{ tab: 'library', section: 'nope' }, { tab: 'library', section: null }],
    [{ tab: 'downloads', section: 'music' }, { tab: 'downloads', section: null }],
  ])('keeps a current key: %o', (query, expected) => {
    expect(normalizeSettingsTab(query)).toEqual(expected);
  });

  it.each([
    [{ tab: 'stats' }, { tab: 'overview', section: null }],
    [{ tab: 'music' }, { tab: 'library', section: 'music' }],
    [{ tab: 'podcasts' }, { tab: 'library', section: 'podcasts' }],
    [{ tab: 'music', section: 'videos' }, { tab: 'library', section: 'music' }],
  ])('maps a legacy key: %o', (query, expected) => {
    expect(normalizeSettingsTab(query)).toEqual(expected);
  });

  it.each([[{}], [{ tab: 'unknown' }], [{ tab: 'constructor' }], [{ tab: '__proto__' }], [{ tab: 42 }]])(
    'falls back to overview: %o',
    (query) => {
      expect(normalizeSettingsTab(query)).toEqual({ tab: 'overview', section: null });
    }
  );

  it('reads the first value of a repeated query parameter', () => {
    expect(normalizeSettingsTab({ tab: ['library', 'users'], section: ['music'] })).toEqual({ tab: 'library', section: 'music' });
  });
});
