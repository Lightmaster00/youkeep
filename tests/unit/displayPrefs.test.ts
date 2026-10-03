import { describe, it, expect } from 'vitest';
import {
  APP_DEFAULTS,
  HIDEABLE_NAV_LINKS,
  InvalidPrefError,
  validatePartial,
  parseStoredPartial,
  mergePrefs,
  applyChange,
  buildView,
} from '../../shared/displayPrefs';

describe('APP_DEFAULTS', () => {
  it('has the documented defaults', () => {
    expect(APP_DEFAULTS).toMatchObject({ density: 'comfortable', hiddenNavLinks: [], landingSpace: 'auto' });
  });

  it('lists exactly the four hideable links', () => {
    expect([...HIDEABLE_NAV_LINKS]).toEqual(['/shorts', '/channels', '/subscriptions', '/playlists']);
  });
});

describe('validatePartial', () => {
  it('accepts valid values for every key', () => {
    const result = validatePartial({ density: 'compact', hiddenNavLinks: ['/shorts', '/playlists'], landingSpace: 'music' });
    expect(result.set).toEqual({ density: 'compact', hiddenNavLinks: ['/shorts', '/playlists'], landingSpace: 'music' });
    expect(result.remove).toEqual([]);
  });

  it('treats null as a removal marker', () => {
    const result = validatePartial({ density: null, landingSpace: 'video' });
    expect(result.set).toEqual({ landingSpace: 'video' });
    expect(result.remove).toEqual(['density']);
  });

  it('ignores unknown keys', () => {
    const result = validatePartial({ density: 'spacious', theme: 'light', extra: 1 });
    expect(result.set).toEqual({ density: 'spacious' });
    expect(result.remove).toEqual([]);
  });

  it('returns an empty change when there is no recognised key', () => {
    expect(validatePartial({ theme: 'light' })).toEqual({ set: {}, remove: [] });
  });

  it.each([
    [{ density: 'huge' }, 'density'],
    [{ density: 3 }, 'density'],
    [{ landingSpace: 'nowhere' }, 'landingSpace'],
    [{ hiddenNavLinks: 'shorts' }, 'hiddenNavLinks'],
    [{ hiddenNavLinks: ['/'] }, 'hiddenNavLinks'],
    [{ hiddenNavLinks: ['/music'] }, 'hiddenNavLinks'],
    [{ hiddenNavLinks: ['/shorts', '/shorts'] }, 'hiddenNavLinks'],
    [{ hiddenNavLinks: [1] }, 'hiddenNavLinks'],
  ])('rejects %j as invalid for %s', (input, key) => {
    try {
      validatePartial(input);
      throw new Error('expected validatePartial to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidPrefError);
      expect((err as InvalidPrefError).key).toBe(key);
    }
  });

  it.each([null, undefined, 'x', 5, [], [1]])('rejects a non-object body %j', (input) => {
    expect(() => validatePartial(input)).toThrow(InvalidPrefError);
  });

  it('accepts an empty array for hiddenNavLinks (show everything)', () => {
    expect(validatePartial({ hiddenNavLinks: [] }).set).toEqual({ hiddenNavLinks: [] });
  });
});

describe('parseStoredPartial', () => {
  it('returns an empty partial for missing input', () => {
    expect(parseStoredPartial(null)).toEqual({});
    expect(parseStoredPartial(undefined)).toEqual({});
    expect(parseStoredPartial('')).toEqual({});
  });

  it('parses a valid stored object', () => {
    expect(parseStoredPartial('{"density":"compact"}')).toEqual({ density: 'compact' });
  });

  it.each(['not json', '[]', '"str"', '{"density":"huge"}', '{"hiddenNavLinks":["/nope"]}'])(
    'treats corrupt or no-longer-valid JSON %s as an empty partial',
    (raw) => {
      expect(parseStoredPartial(raw)).toEqual({});
    }
  );
});

describe('parseStoredPartial per-key tolerance', () => {
  it('keeps valid keys when another key is invalid', () => {
    expect(parseStoredPartial(JSON.stringify({ density: 'compact', rowSize: 99, landingSpace: 'music' })))
      .toEqual({ density: 'compact', landingSpace: 'music' });
  });
  it('ignores unknown keys', () => {
    expect(parseStoredPartial(JSON.stringify({ density: 'compact', bogus: 1 }))).toEqual({ density: 'compact' });
  });
  it('treats corrupt JSON as empty', () => {
    expect(parseStoredPartial('{oops')).toEqual({});
  });
  it('drops a null value (removal marker is write-time only)', () => {
    expect(parseStoredPartial(JSON.stringify({ density: null, rowSize: 10 }))).toEqual({ rowSize: 10 });
  });
  it('validatePartial still throws on any invalid value', () => {
    expect(() => validatePartial({ density: 'compact', rowSize: 99 })).toThrow();
  });
});

describe('mergePrefs', () => {
  it('overlays only the keys present in the partial', () => {
    expect(mergePrefs(APP_DEFAULTS, { density: 'compact' })).toEqual({ ...APP_DEFAULTS, density: 'compact' });
  });

  it('replaces an array instead of merging it', () => {
    const base = { ...APP_DEFAULTS, hiddenNavLinks: ['/shorts', '/channels'] };
    expect(mergePrefs(base, { hiddenNavLinks: ['/playlists'] }).hiddenNavLinks).toEqual(['/playlists']);
  });

  it('lets an explicit empty array override a non-empty default', () => {
    const base = { ...APP_DEFAULTS, hiddenNavLinks: ['/shorts'] };
    expect(mergePrefs(base, { hiddenNavLinks: [] }).hiddenNavLinks).toEqual([]);
  });

  it('copies arrays so callers cannot mutate the defaults', () => {
    const merged = mergePrefs(APP_DEFAULTS, null);
    merged.hiddenNavLinks.push('/shorts');
    expect(APP_DEFAULTS.hiddenNavLinks).toEqual([]);
  });
});

describe('applyChange', () => {
  it('sets then removes keys', () => {
    expect(applyChange({ density: 'compact', landingSpace: 'music' }, { set: { density: 'spacious' }, remove: ['landingSpace'] }))
      .toEqual({ density: 'spacious' });
  });
});

describe('buildView', () => {
  it('uses app defaults for a guest with no admin defaults', () => {
    expect(buildView({}, null)).toEqual({ effective: APP_DEFAULTS, defaults: APP_DEFAULTS, overrides: null, adminDefaults: {} });
  });

  it('resolves app defaults → admin defaults → user overrides', () => {
    const view = buildView({ density: 'compact', landingSpace: 'music' }, { landingSpace: 'podcasts' });
    expect(view.defaults).toEqual({ ...APP_DEFAULTS, density: 'compact', landingSpace: 'music' });
    expect(view.effective).toEqual({ ...APP_DEFAULTS, density: 'compact', landingSpace: 'podcasts' });
    expect(view.overrides).toEqual({ landingSpace: 'podcasts' });
    expect(view.adminDefaults).toEqual({ density: 'compact', landingSpace: 'music' });
  });

  it('gives a logged-in user with no choices an empty overrides object, not null', () => {
    expect(buildView({}, {}).overrides).toEqual({});
  });
});

describe('home feed keys', () => {
  it('has the documented home feed defaults', () => {
    expect(APP_DEFAULTS.homeSections).toEqual(['recent', 'popular', 'suggested', 'subscriptions']);
    expect(APP_DEFAULTS.homeHero).toBe(true);
    expect(APP_DEFAULTS.popularRanking).toBe('localViewers');
    expect(APP_DEFAULTS.rowSize).toBe(15);
    expect(APP_DEFAULTS.subscriptionChannels).toBe(8);
  });

  it('accepts valid values', () => {
    const r = validatePartial({
      homeSections: ['popular', 'recent'], homeHero: false, popularRanking: 'watchTime', rowSize: 30, subscriptionChannels: 16,
    });
    expect(r.set).toEqual({
      homeSections: ['popular', 'recent'], homeHero: false, popularRanking: 'watchTime', rowSize: 30, subscriptionChannels: 16,
    });
  });

  it('accepts an empty homeSections array (all hidden)', () => {
    expect(validatePartial({ homeSections: [] }).set).toEqual({ homeSections: [] });
  });

  it.each([
    [{ homeSections: ['recent', 'recent'] }],
    [{ homeSections: ['recent', 'bogus'] }],
    [{ homeSections: 'recent' }],
    [{ homeHero: 'yes' }],
    [{ popularRanking: 'random' }],
    [{ rowSize: 12 }],
    [{ rowSize: '15' }],
    [{ subscriptionChannels: 7 }],
  ])('rejects invalid value %j', (input) => {
    expect(() => validatePartial(input)).toThrow(InvalidPrefError);
  });

  it('treats null as removal for the new keys', () => {
    expect(validatePartial({ rowSize: null, homeSections: null }).remove).toEqual(['homeSections', 'rowSize']);
  });

  it('mergePrefs replaces homeSections instead of merging', () => {
    expect(mergePrefs(APP_DEFAULTS, { homeSections: ['popular'] }).homeSections).toEqual(['popular']);
  });

  it('mergePrefs copies homeSections so callers cannot mutate the defaults', () => {
    const merged = mergePrefs(APP_DEFAULTS, null);
    merged.homeSections.push('recent');
    expect(APP_DEFAULTS.homeSections).toEqual(['recent', 'popular', 'suggested', 'subscriptions']);
  });

  it('parseStoredPartial drops a stored row holding an invalid new value', () => {
    expect(parseStoredPartial(JSON.stringify({ rowSize: 99 }))).toEqual({});
  });

  it('buildView resolves the new keys admin → user', () => {
    const view = buildView({ popularRanking: 'youtubeViews', rowSize: 10 }, { rowSize: 20 });
    expect(view.defaults.rowSize).toBe(10);
    expect(view.effective.rowSize).toBe(20);
    expect(view.effective.popularRanking).toBe('youtubeViews');
  });
});
