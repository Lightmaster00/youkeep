import { describe, it, expect } from 'vitest';
import { MODULE_IDS, MODULE_SETTING_KEYS, moduleForPath } from '../../server/utils/modules';

describe('module constants', () => {
  it('lists the three modules in navigation order', () => {
    expect(MODULE_IDS).toEqual(['video', 'music', 'podcasts']);
  });

  it('keeps the existing music setting key unchanged (no migration)', () => {
    expect(MODULE_SETTING_KEYS.music).toBe('music_module_enabled');
    expect(MODULE_SETTING_KEYS.video).toBe('video_module_enabled');
    expect(MODULE_SETTING_KEYS.podcasts).toBe('podcasts_module_enabled');
  });
});

describe('moduleForPath', () => {
  it.each([
    ['/api/videos', 'video'],
    ['/api/videos/abc', 'video'],
    ['/api/videos/recommend', 'video'],
    ['/api/channels', 'video'],
    ['/api/channels/c1/videos', 'video'],
    ['/api/playlists', 'video'],
    ['/api/home/feed', 'video'],
    ['/downloads', 'video'],
    ['/downloads/chan/v.mp4', 'video'],
    ['/api/music', 'music'],
    ['/api/music/artists', 'music'],
    ['/downloads-music', 'music'],
    ['/downloads-music/a/t.opus', 'music'],
    ['/api/podcasts', 'podcasts'],
    ['/api/podcasts/shows/1/episodes', 'podcasts'],
    ['/downloads-podcasts', 'podcasts'],
    ['/downloads-podcasts/s/e.mp3', 'podcasts'],
  ])('maps %s to %s', (path, expected) => {
    expect(moduleForPath(path)).toBe(expected);
  });

  it.each([
    '/api/auth/me',
    '/api/account/tokens',
    '/api/settings/modules',
    '/api/admin/music/ingest',
    '/api/admin/downloader/queue',
    '/api/musicfoo',
    '/api/videosfoo',
    '/downloadsfoo',
    '/login',
    '/',
  ])('does not gate %s', (path) => {
    expect(moduleForPath(path)).toBeNull();
  });

  it('never lets /downloads match /downloads-music or /downloads-podcasts', () => {
    expect(moduleForPath('/downloads-music/x')).toBe('music');
    expect(moduleForPath('/downloads-podcasts/x')).toBe('podcasts');
  });

  it('ignores the query string', () => {
    expect(moduleForPath('/api/music/artists?x=1')).toBe('music');
    expect(moduleForPath('/api/auth/me?x=/api/music')).toBeNull();
  });
});
