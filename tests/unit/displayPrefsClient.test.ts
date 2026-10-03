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
  it('returns every link when nothing is hidden', () => {
    expect(filterNavLinks(videoLinks, [])).toEqual(videoLinks);
  });

  it('hides only the requested hideable links', () => {
    expect(filterNavLinks(videoLinks, ['/shorts', '/playlists']).map((l) => l.to)).toEqual(['/', '/channels', '/subscriptions']);
  });

  it('never hides Home, even if "/" is listed', () => {
    expect(filterNavLinks(videoLinks, ['/', '/shorts', '/channels', '/subscriptions', '/playlists']).map((l) => l.to)).toEqual(['/']);
  });

  it('never hides the single library link of the music and podcasts spaces', () => {
    const music = [{ to: '/music', label: 'Bibliothèque' }];
    const podcasts = [{ to: '/podcasts', label: 'Bibliothèque' }];
    expect(filterNavLinks(music, ['/music', '/shorts'])).toEqual(music);
    expect(filterNavLinks(podcasts, ['/podcasts'])).toEqual(podcasts);
  });

  it('does not mutate its input', () => {
    const input = [...videoLinks];
    filterNavLinks(input, ['/shorts']);
    expect(input).toEqual(videoLinks);
  });
});

describe('resolveLandingTarget', () => {
  const all = ['video', 'music', 'podcasts'] as const;

  it('auto with Video enabled stays on the Video home (no redirect)', () => {
    expect(resolveLandingTarget('auto', [...all])).toBeNull();
  });

  it('auto without Video goes to the first enabled module', () => {
    expect(resolveLandingTarget('auto', ['music', 'podcasts'])).toBe('/music');
    expect(resolveLandingTarget('auto', ['podcasts'])).toBe('/podcasts');
  });

  it('an explicit enabled choice goes to that module home', () => {
    expect(resolveLandingTarget('music', [...all])).toBe('/music');
    expect(resolveLandingTarget('podcasts', [...all])).toBe('/podcasts');
  });

  it('an explicit Video choice means no redirect', () => {
    expect(resolveLandingTarget('video', [...all])).toBeNull();
  });

  it('an explicit choice that is disabled falls back to auto', () => {
    expect(resolveLandingTarget('music', ['video', 'podcasts'])).toBeNull();
    expect(resolveLandingTarget('music', ['podcasts'])).toBe('/podcasts');
  });

  it('returns null when nothing is enabled', () => {
    expect(resolveLandingTarget('auto', [])).toBeNull();
    expect(resolveLandingTarget('music', [])).toBeNull();
  });
});

describe('shouldApplyLanding', () => {
  it('applies only to a plain / with no query', () => {
    expect(shouldApplyLanding('/', {})).toBe(true);
    expect(shouldApplyLanding('/', { q: 'x' })).toBe(false);
    expect(shouldApplyLanding('/', { page: '3' })).toBe(false);
    expect(shouldApplyLanding('/music', {})).toBe(false);
  });
});

describe('isHomeFullyHidden', () => {
  it('is false while the hero is shown', () => {
    expect(isHomeFullyHidden({ homeHero: true, homeSections: [] }, true)).toBe(false);
  });
  it('is true with no hero and no sections', () => {
    expect(isHomeFullyHidden({ homeHero: false, homeSections: [] }, true)).toBe(true);
  });
  it('is false with no hero but a visible section', () => {
    expect(isHomeFullyHidden({ homeHero: false, homeSections: ['recent'] }, false)).toBe(false);
  });
  it('treats suggested/subscriptions as invisible to a guest', () => {
    expect(isHomeFullyHidden({ homeHero: false, homeSections: ['suggested', 'subscriptions'] }, false)).toBe(true);
    expect(isHomeFullyHidden({ homeHero: false, homeSections: ['suggested'] }, true)).toBe(false);
  });
});
