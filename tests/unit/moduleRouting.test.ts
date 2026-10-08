import { describe, it, expect } from 'vitest';
import { moduleForPagePath, resolveActiveSpaceId } from '../../app/utils/moduleRouting';

describe('moduleForPagePath', () => {
  it.each([
    ['/', 'video'],
    ['/shorts', 'video'],
    ['/playlists/abc', 'video'],
    ['/watch/jNQXAC9IVRw', 'video'],
    ['/music', 'music'],
    ['/music/anything', 'music'],
    ['/podcasts', 'podcasts'],
    ['/podcasts/shows', 'podcasts'],
    ['/music/recent', 'music'],
    ['/podcasts/recent', 'podcasts'],
    ['/music/discover', 'music'],
    ['/music/genre/Hip%20Hop', 'music'],
    ['/podcasts/discover', 'podcasts'],
  ])('%s belongs to %s', (path, expected) => {
    expect(moduleForPagePath(path)).toBe(expected);
  });

  it.each(['/login', '/settings', '/admin/users', '/musicfoo', '/podcastsfoo', '/channelsfoo'])(
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
    expect(resolveActiveSpaceId('/music/recent', false, all)).toBe('music');
    expect(resolveActiveSpaceId('/podcasts/recent', false, all)).toBe('podcasts');
  });

  it('uses video for module-less pages when video is enabled (and /musicfoo is not music)', () => {
    expect(resolveActiveSpaceId('/account', false, all)).toBe('video');
    expect(resolveActiveSpaceId('/musicfoo', false, all)).toBe('video');
  });

  it('falls back to the first enabled space for a non-admin without video', () => {
    expect(resolveActiveSpaceId('/', false, ['music', 'podcasts'])).toBe('music');
    expect(resolveActiveSpaceId('/search', false, ['podcasts'])).toBe('podcasts');
  });

  it('keeps video for an admin even when video is disabled, and with an empty enabled list', () => {
    expect(resolveActiveSpaceId('/account', true, ['music'])).toBe('video');
    expect(resolveActiveSpaceId('/account', false, [])).toBe('video');
  });
});
