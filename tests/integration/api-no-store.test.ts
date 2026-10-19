import { describe, it, expect } from 'vitest';
import middleware from '../../server/middleware/apiNoStore';
import { mockEvent } from '../helpers/testDb';

function headersFor(path: string) {
  const event = mockEvent(undefined, { path });
  event.node.req.url = path;
  middleware(event);
  return event.node.res.headers as Record<string, string>;
}

describe('apiNoStore middleware', () => {
  it.each([
    '/api/auth/me', '/api/account/tokens', '/api/account/profile', '/api/music/history', '/api/music/favorites',
    '/api/podcasts/follows', '/api/podcasts/episodes/e1/progress', '/api/music/user-playlists/p1',
    '/api/admin/system/security-events?limit=5', '/api/home/feed', '/API//Account/tokens/', '/api/videos?page=2',
  ])('marks %s as private and uncacheable', (path) => {
    const h = headersFor(path);
    expect(h['cache-control']).toBe('no-store');
    expect(h['vary']).toBe('Cookie, Authorization');
  });

  it.each(['/', '/watch/abc', '/downloads/c1/video.mp4', '/downloads-music/a/t.m4a', '/downloads-podcasts/s/e.mp3', '/apis', '/_nuxt/app.js'])(
    'leaves %s alone (pages and media routes keep their own caching)', (path) => {
      const h = headersFor(path);
      expect(h['cache-control']).toBeUndefined();
      expect(h['vary']).toBeUndefined();
    });
});
