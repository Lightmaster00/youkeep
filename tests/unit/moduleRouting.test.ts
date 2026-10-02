import { describe, it, expect } from 'vitest';
import { moduleForPagePath } from '../../app/utils/moduleRouting';

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
