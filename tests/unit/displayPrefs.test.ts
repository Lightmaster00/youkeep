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
      homeSections: ['popular', 'forYou'], homeHero: false, popularRanking: 'watchTime', rowSize: 30, subscriptionChannels: 16,
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
    [{ homeSections: 'popular' }, 'homeSections'],
    [{ homeSections: ['popular', 'bogus'] }, 'homeSections'],
    [{ homeSections: ['popular', 'popular'] }, 'homeSections'],
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
    expect(validatePartial({ homeSections: ['newEpisodes', 'popular', 'recentMusic'] }).set)
      .toEqual({ homeSections: ['newEpisodes', 'popular', 'recentMusic'] });
    expect(HOME_SECTION_IDS).toEqual(['continue', 'subscriptions', 'forYou', 'popular', 'becauseYouWatched', 'byCategory', 'shorts', 'playlists', 'discoverChannels', 'recentMusic', 'newEpisodes']);
  });

  it('keeps them out of the app default so stored and inherited prefs do not change silently', () => {
    expect(APP_DEFAULTS.homeSections).toEqual(['continue', 'subscriptions', 'forYou', 'popular', 'becauseYouWatched', 'byCategory', 'shorts', 'playlists', 'discoverChannels']);
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
    expect(parseStoredPartial(JSON.stringify({ hiddenNavLinks: ['/shorts', '/nope'], homeSections: ['popular', 'bogus'], density: 'compact' })))
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
    merged.homeSections.push('recentMusic');
    expect(APP_DEFAULTS.hiddenNavLinks).toEqual([]);
    expect(APP_DEFAULTS.homeSections).toEqual(['continue', 'subscriptions', 'forYou', 'popular', 'becauseYouWatched', 'byCategory', 'shorts', 'playlists', 'discoverChannels']);
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

describe('the retired "recent" (Recently added) video section', () => {
  it('is no longer a section id, for anyone', () => {
    expect(HOME_SECTION_IDS).not.toContain('recent');
    expect(GUEST_HOME_SECTIONS).toEqual(['popular', 'byCategory', 'shorts', 'recentMusic', 'newEpisodes']);
    expect(APP_DEFAULTS.homeSections).toEqual(['continue', 'subscriptions', 'forYou', 'popular', 'becauseYouWatched', 'byCategory', 'shorts', 'playlists', 'discoverChannels']);
  });

  it('a stored list naming it is read back without it, keeping the rest and its order', () => {
    expect(parseStoredPartial(JSON.stringify({ homeSections: ['subscriptions', 'recent', 'popular'], density: 'compact' })))
      .toEqual({ homeSections: ['subscriptions', 'popular'], density: 'compact' });
  });

  it('a stored list naming only it falls back to the inherited default instead of an empty home', () => {
    expect(parseStoredPartial(JSON.stringify({ homeSections: ['recent'] }))).toEqual({});
    expect(buildView(parseStoredPartial(JSON.stringify({ homeSections: ['recent'] })), {}).effective.homeSections)
      .toEqual(['continue', 'subscriptions', 'forYou', 'popular', 'becauseYouWatched', 'byCategory', 'shorts', 'playlists', 'discoverChannels']);
    // An explicitly empty list is still a choice and is kept.
    expect(parseStoredPartial(JSON.stringify({ homeSections: [] }))).toEqual({ homeSections: [] });
  });

  it('a write naming it (an old client) is accepted with the id dropped, never a 400', () => {
    expect(validatePartial({ homeSections: ['recent', 'popular'] })).toEqual({ set: { homeSections: ['popular'] }, remove: [] });
    expect(validatePartial({ homeSections: ['recent'] })).toEqual({ set: {}, remove: ['homeSections'] });
  });
});

describe('home sections of the new home (old ids and old defaults)', () => {
  it('accepts the old id "suggested" as "forYou", on read and on write', () => {
    expect(validatePartial({ homeSections: ['suggested', 'popular'] }).set).toEqual({ homeSections: ['forYou', 'popular'] });
    expect(parseStoredPartial(JSON.stringify({ homeSections: ['shorts', 'suggested'] }))).toEqual({ homeSections: ['shorts', 'forYou'] });
    // Both names: one forYou, where it first appears.
    expect(validatePartial({ homeSections: ['forYou', 'popular', 'suggested'] }).set).toEqual({ homeSections: ['forYou', 'popular'] });
  });

  it.each([
    [['popular', 'suggested', 'subscriptions']],
    [['recent', 'popular', 'suggested', 'subscriptions']],
  ])('a stored list equal to an old default (%j) counts as never customised', (old) => {
    expect(parseStoredPartial(JSON.stringify({ homeSections: old, density: 'compact' }))).toEqual({ density: 'compact' });
    expect(buildView(parseStoredPartial(JSON.stringify({ homeSections: old })), parseStoredPartial(JSON.stringify({ homeSections: old }))).effective.homeSections)
      .toEqual(['continue', 'subscriptions', 'forYou', 'popular', 'becauseYouWatched', 'byCategory', 'shorts', 'playlists', 'discoverChannels']);
  });

  it('any other stored list keeps the user choice', () => {
    expect(parseStoredPartial(JSON.stringify({ homeSections: ['subscriptions', 'suggested', 'popular'] })))
      .toEqual({ homeSections: ['subscriptions', 'forYou', 'popular'] });
    expect(parseStoredPartial(JSON.stringify({ homeSections: ['popular', 'suggested'] })))
      .toEqual({ homeSections: ['popular', 'forYou'] });
  });

  it('an admin default stored as an old default is replaced too, and a user override still wins', () => {
    const admin = parseStoredPartial(JSON.stringify({ homeSections: ['popular', 'suggested', 'subscriptions'], rowSize: 10 }));
    expect(admin).toEqual({ rowSize: 10 });
    const view = buildView(admin, parseStoredPartial(JSON.stringify({ homeSections: ['shorts'] })));
    expect(view.effective.homeSections).toEqual(['shorts']);
  });
});
