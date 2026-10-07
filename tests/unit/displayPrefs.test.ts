import { describe, it, expect } from 'vitest';
import {
  APP_DEFAULTS,
  InvalidPrefError,
  validatePartial,
  parseStoredPartial,
  mergePrefs,
  applyChange,
  buildView,
  HOME_SECTION_IDS,
  GUEST_HOME_SECTIONS,
} from '../../shared/displayPrefs';

describe('validatePartial', () => {
  it('accepts a valid value for every key, including empty arrays', () => {
    const all = {
      density: 'compact', hiddenNavLinks: ['/shorts', '/playlists'], landingSpace: 'music',
      homeSections: ['popular', 'recent'], homeHero: false, popularRanking: 'watchTime', rowSize: 30, subscriptionChannels: 16,
    };
    expect(validatePartial(all)).toEqual({ set: all, remove: [] });
    expect(validatePartial({ hiddenNavLinks: [], homeSections: [] }).set).toEqual({ hiddenNavLinks: [], homeSections: [] });
  });

  it('treats null as a removal marker and ignores unknown keys', () => {
    expect(validatePartial({ density: null, rowSize: null, landingSpace: 'video', theme: 'light' }))
      .toEqual({ set: { landingSpace: 'video' }, remove: ['density', 'rowSize'] });
    expect(validatePartial({ theme: 'light' })).toEqual({ set: {}, remove: [] });
  });

  // One case per distinct rejection branch of validateValue.
  it.each([
    [{ density: 'huge' }, 'density'],
    [{ density: 3 }, 'density'],
    [{ landingSpace: 'nowhere' }, 'landingSpace'],
    [{ homeHero: 'yes' }, 'homeHero'],
    [{ popularRanking: 'random' }, 'popularRanking'],
    [{ rowSize: 12 }, 'rowSize'],
    [{ rowSize: '15' }, 'rowSize'],
    [{ subscriptionChannels: 7 }, 'subscriptionChannels'],
    [{ homeSections: 'recent' }, 'homeSections'],
    [{ homeSections: ['recent', 'bogus'] }, 'homeSections'],
    [{ homeSections: ['recent', 'recent'] }, 'homeSections'],
    [{ homeSections: ['recentMusic', 'recentMusic'] }, 'homeSections'],
    [{ homeSections: ['recentmusic'] }, 'homeSections'],
    [{ hiddenNavLinks: 'shorts' }, 'hiddenNavLinks'],
    [{ hiddenNavLinks: ['/'] }, 'hiddenNavLinks'],
    [{ hiddenNavLinks: [1] }, 'hiddenNavLinks'],
    [{ hiddenNavLinks: ['/shorts', '/shorts'] }, 'hiddenNavLinks'],
    [null, 'body'],
    ['x', 'body'],
    [[], 'body'],
  ])('rejects %j (key %s)', (input, key) => {
    expect(() => validatePartial(input)).toThrow(expect.objectContaining({ name: 'InvalidPrefError', key }));
  });
});

describe('music and podcast home sections', () => {
  it('accepts recentMusic and newEpisodes in any order, mixed with the video sections', () => {
    expect(validatePartial({ homeSections: ['newEpisodes', 'recent', 'recentMusic'] }).set)
      .toEqual({ homeSections: ['newEpisodes', 'recent', 'recentMusic'] });
    expect(HOME_SECTION_IDS).toEqual(['recent', 'popular', 'suggested', 'subscriptions', 'recentMusic', 'newEpisodes']);
  });

  it('keeps them out of the app default so stored and inherited prefs do not change silently', () => {
    expect(APP_DEFAULTS.homeSections).toEqual(['recent', 'popular', 'suggested', 'subscriptions']);
    expect(buildView({}, {}).effective.homeSections).not.toContain('recentMusic');
    expect(buildView({}, {}).effective.homeSections).not.toContain('newEpisodes');
  });

  it('lets guests see them (visibility rules still apply server side)', () => {
    expect(GUEST_HOME_SECTIONS).toContain('recentMusic');
    expect(GUEST_HOME_SECTIONS).toContain('newEpisodes');
  });

  it('keeps a stored list containing them when read back', () => {
    expect(parseStoredPartial(JSON.stringify({ homeSections: ['recentMusic', 'popular'] })))
      .toEqual({ homeSections: ['recentMusic', 'popular'] });
  });
});

describe('parseStoredPartial', () => {
  it.each([null, '', 'not json', '[]', '"str"'])('treats missing or corrupt %j as an empty partial', (raw) => {
    expect(parseStoredPartial(raw)).toEqual({});
  });

  it('validates each key alone: keeps valid ones, drops invalid/unknown/null ones and whole bad arrays', () => {
    expect(parseStoredPartial(JSON.stringify({ density: 'compact', rowSize: 99, landingSpace: 'music', bogus: 1 })))
      .toEqual({ density: 'compact', landingSpace: 'music' });
    expect(parseStoredPartial(JSON.stringify({ density: null, rowSize: 10 }))).toEqual({ rowSize: 10 });
    expect(parseStoredPartial(JSON.stringify({ hiddenNavLinks: ['/shorts', '/nope'], homeSections: ['recent', 'bogus'], density: 'compact' })))
      .toEqual({ density: 'compact' });
  });

  it('validatePartial still throws where parseStoredPartial would tolerate', () => {
    expect(() => validatePartial({ density: 'compact', rowSize: 99 })).toThrow(InvalidPrefError);
  });
});

describe('mergePrefs / applyChange', () => {
  it('overlays only the keys present and replaces (never merges) arrays', () => {
    expect(mergePrefs(APP_DEFAULTS, { density: 'compact' })).toEqual({ ...APP_DEFAULTS, density: 'compact' });
    const base = { ...APP_DEFAULTS, hiddenNavLinks: ['/shorts', '/channels'] };
    expect(mergePrefs(base, { hiddenNavLinks: ['/playlists'] }).hiddenNavLinks).toEqual(['/playlists']);
    expect(mergePrefs(base, { hiddenNavLinks: [] }).hiddenNavLinks).toEqual([]);
    expect(mergePrefs(APP_DEFAULTS, { homeSections: ['popular'] }).homeSections).toEqual(['popular']);
  });

  it('copies arrays so callers cannot mutate the defaults', () => {
    const merged = mergePrefs(APP_DEFAULTS, null);
    merged.hiddenNavLinks.push('/shorts');
    merged.homeSections.push('recent');
    expect(APP_DEFAULTS.hiddenNavLinks).toEqual([]);
    expect(APP_DEFAULTS.homeSections).toEqual(['recent', 'popular', 'suggested', 'subscriptions']);
  });

  it('applyChange sets then removes keys', () => {
    expect(applyChange({ density: 'compact', landingSpace: 'music' }, { set: { density: 'spacious' }, remove: ['landingSpace'] }))
      .toEqual({ density: 'spacious' });
  });
});

describe('buildView', () => {
  it('uses app defaults for a guest with no admin defaults', () => {
    expect(buildView({}, null)).toEqual({ effective: APP_DEFAULTS, defaults: APP_DEFAULTS, overrides: null, adminDefaults: {} });
  });

  it('resolves app defaults → admin defaults → user overrides', () => {
    const view = buildView({ density: 'compact', landingSpace: 'music', rowSize: 10 }, { landingSpace: 'podcasts' });
    expect(view.defaults).toEqual({ ...APP_DEFAULTS, density: 'compact', landingSpace: 'music', rowSize: 10 });
    expect(view.effective).toEqual({ ...APP_DEFAULTS, density: 'compact', landingSpace: 'podcasts', rowSize: 10 });
    expect(view.overrides).toEqual({ landingSpace: 'podcasts' });
    expect(view.adminDefaults).toEqual({ density: 'compact', landingSpace: 'music', rowSize: 10 });
  });

  it('gives a logged-in user with no choices an empty overrides object, not null', () => {
    expect(buildView({}, {}).overrides).toEqual({});
  });
});
