import { describe, it, expect } from 'vitest';
import { moduleForPagePath, resolveActiveSpaceId } from '../../app/utils/moduleRouting';

describe('moduleForPagePath', () => {
  it.each([
    ['/', 'video'],
    ['/shorts', 'video'],
    ['/channels', 'video'],
    ['/subscriptions', 'video'],
    ['/playlists', 'video'],
    ['/playlists/abc', 'video'],
    ['/watch/jNQXAC9IVRw', 'video'],
    ['/music', 'music'],
    ['/music/anything', 'music'],
    ['/podcasts', 'podcasts'],
    ['/podcasts/shows', 'podcasts'],
  ])('%s belongs to %s', (path, expected) => {
    expect(moduleForPagePath(path)).toBe(expected);
  });

  it.each(['/login', '/account', '/settings', '/search', '/admin', '/admin/users', '/musicfoo', '/podcastsfoo', '/channelsfoo'])(
    '%s belongs to no module (never redirected)',
    (path) => {
      expect(moduleForPagePath(path)).toBeNull();
    }
  );
});

describe('resolveActiveSpaceId', () => {
  const all: ('video' | 'music' | 'podcasts')[] = ['video', 'music', 'podcasts'];

  it('maps music and podcasts paths to themselves for everyone, even when disabled', () => {
    expect(resolveActiveSpaceId('/music', false, all)).toBe('music');
    expect(resolveActiveSpaceId('/music/artists', false, ['video'])).toBe('music');
    expect(resolveActiveSpaceId('/podcasts', true, ['video'])).toBe('podcasts');
    expect(resolveActiveSpaceId('/podcasts/shows', false, ['music'])).toBe('podcasts');
  });

  it.each(['/', '/account', '/search', '/settings', '/watch/x'])('%s maps to video when video is enabled', (p) => {
    expect(resolveActiveSpaceId(p, false, all)).toBe('video');
  });

  it.each(['/', '/account', '/search', '/settings', '/watch/x'])('%s falls back to the first enabled space for a non-admin without video', (p) => {
    expect(resolveActiveSpaceId(p, false, ['music', 'podcasts'])).toBe('music');
    expect(resolveActiveSpaceId(p, false, ['podcasts'])).toBe('podcasts');
  });

  it('keeps video for an admin even when video is disabled', () => {
    expect(resolveActiveSpaceId('/account', true, ['music'])).toBe('video');
  });

  it('falls back to video with an empty enabled list', () => {
    expect(resolveActiveSpaceId('/account', false, [])).toBe('video');
  });

  it('does not treat /musicfoo as music', () => {
    expect(resolveActiveSpaceId('/musicfoo', false, all)).toBe('video');
  });
});
