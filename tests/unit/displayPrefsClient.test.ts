import { describe, it, expect } from 'vitest';
import { filterNavLinks, isHomeFullyHidden, resolveLandingTarget, shouldApplyLanding } from '../../app/utils/displayPrefs';

const videoLinks = [
  { to: '/', label: 'Home' },
  { to: '/shorts', label: 'Shorts' },
  { to: '/channels', label: 'Channels' },
  { to: '/subscriptions', label: 'Subscriptions' },
  { to: '/playlists', label: 'Playlists' },
];

describe('filterNavLinks', () => {
  it('hides only the requested hideable links', () => {
    expect(filterNavLinks(videoLinks, [])).toEqual(videoLinks);
    expect(filterNavLinks(videoLinks, ['/shorts', '/playlists']).map((l) => l.to)).toEqual(['/', '/channels', '/subscriptions']);
  });

  it('never hides Home or the single library link of music/podcasts, even if listed', () => {
    expect(filterNavLinks(videoLinks, ['/', '/shorts', '/channels', '/subscriptions', '/playlists']).map((l) => l.to)).toEqual(['/']);
    const music = [{ to: '/music', label: 'Library' }];
    expect(filterNavLinks(music, ['/music', '/shorts'])).toEqual(music);
  });
});

describe('resolveLandingTarget', () => {
  const all = ['video', 'music', 'podcasts'] as const;

  it('auto stays on the Video home when Video is enabled, else the first enabled module', () => {
    expect(resolveLandingTarget('auto', [...all])).toBeNull();
    expect(resolveLandingTarget('auto', ['music', 'podcasts'])).toBe('/music');
    expect(resolveLandingTarget('auto', ['podcasts'])).toBe('/podcasts');
  });

  it('an explicit enabled choice goes to that module home (video = no redirect)', () => {
    expect(resolveLandingTarget('podcasts', [...all])).toBe('/podcasts');
    expect(resolveLandingTarget('video', [...all])).toBeNull();
  });

  it('an explicit choice that is disabled falls back to auto; nothing enabled is null', () => {
    expect(resolveLandingTarget('music', ['video', 'podcasts'])).toBeNull();
    expect(resolveLandingTarget('music', ['podcasts'])).toBe('/podcasts');
    expect(resolveLandingTarget('music', [])).toBeNull();
  });
});

describe('shouldApplyLanding', () => {
  it('applies only to a plain / with no query', () => {
    expect(shouldApplyLanding('/', {})).toBe(true);
    expect(shouldApplyLanding('/', { q: 'x' })).toBe(false);
    expect(shouldApplyLanding('/music', {})).toBe(false);
  });
});

describe('isHomeFullyHidden', () => {
  it.each([
    [{ homeHero: true, homeSections: [] }, true, false],
    [{ homeHero: false, homeSections: [] }, true, true],
    [{ homeHero: false, homeSections: ['subscriptions'] }, true, false],
    [{ homeHero: false, homeSections: ['suggested', 'subscriptions'] }, false, true],
    [{ homeHero: false, homeSections: ['popular'] }, false, false],
    [{ homeHero: false, homeSections: ['suggested', 'recent'] }, false, false],
  ] as const)('%j (loggedIn=%s) → %s', (prefs, loggedIn, expected) => {
    expect(isHomeFullyHidden({ homeHero: prefs.homeHero, homeSections: [...prefs.homeSections] }, loggedIn)).toBe(expected);
  });
});
