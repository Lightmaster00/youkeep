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
    expect(APP_DEFAULTS).toEqual({ density: 'comfortable', hiddenNavLinks: [], landingSpace: 'auto' });
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

describe('mergePrefs', () => {
  it('overlays only the keys present in the partial', () => {
    expect(mergePrefs(APP_DEFAULTS, { density: 'compact' })).toEqual({ density: 'compact', hiddenNavLinks: [], landingSpace: 'auto' });
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
    expect(view.defaults).toEqual({ density: 'compact', hiddenNavLinks: [], landingSpace: 'music' });
    expect(view.effective).toEqual({ density: 'compact', hiddenNavLinks: [], landingSpace: 'podcasts' });
    expect(view.overrides).toEqual({ landingSpace: 'podcasts' });
    expect(view.adminDefaults).toEqual({ density: 'compact', landingSpace: 'music' });
  });

  it('gives a logged-in user with no choices an empty overrides object, not null', () => {
    expect(buildView({}, {}).overrides).toEqual({});
  });
});
