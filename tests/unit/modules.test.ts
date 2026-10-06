import { describe, it, expect } from 'vitest';
import { MODULE_SETTING_KEYS, moduleForPath } from '../../server/utils/modules';

describe('module constants', () => {
  it('keeps the existing music setting key unchanged (no migration)', () => {
    expect(MODULE_SETTING_KEYS.music).toBe('music_module_enabled');
  });
});

describe('moduleForPath', () => {
  it.each([
    ['/api/videos', 'video'],
    ['/api/channels/c1/videos', 'video'],
    ['/api/playlists', 'video'],
    ['/api/home/feed', 'video'],
    ['/downloads/chan/v.mp4', 'video'],
    ['/api/music/artists', 'music'],
    ['/downloads-music', 'music'],
    ['/downloads-music/a/t.opus', 'music'],
    ['/api/podcasts', 'podcasts'],
    ['/downloads-podcasts/s/e.mp3', 'podcasts'],
    ['/api/music/artists?x=1', 'music'],
  ])('maps %s to %s', (path, expected) => {
    expect(moduleForPath(path)).toBe(expected);
  });

  it.each([
    '/api/auth/me',
    '/api/settings/modules',
    '/api/admin/music/ingest',
    '/api/musicfoo',
    '/downloadsfoo',
    '/api/auth/me?x=/api/music',
    '/',
  ])('does not gate %s', (path) => {
    expect(moduleForPath(path)).toBeNull();
  });
});
