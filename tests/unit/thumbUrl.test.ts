import { describe, it, expect } from 'vitest';
import { thumbUrl, THUMB_WIDTHS } from '../../app/utils/thumb';
import { THUMB_WIDTHS as SERVER_WIDTHS } from '../../server/utils/thumbnails';

describe('thumbUrl', () => {
  it('adds ?w= to the app\'s own file URLs', () => {
    expect(thumbUrl('/downloads/Chan/A%20%5Bx%5D/A%20%5Bx%5D.jpg', 480)).toBe('/downloads/Chan/A%20%5Bx%5D/A%20%5Bx%5D.jpg?w=480');
    expect(thumbUrl('/downloads-music/Artist/t1.webp', 320)).toBe('/downloads-music/Artist/t1.webp?w=320');
    expect(thumbUrl('/downloads-podcasts/Show/e1.jpg', 160)).toBe('/downloads-podcasts/Show/e1.jpg?w=160');
  });

  it('keeps an existing query (share token) and never adds a second width', () => {
    expect(thumbUrl('/downloads/c/v.jpg?token=abc', 320)).toBe('/downloads/c/v.jpg?token=abc&w=320');
    expect(thumbUrl('/downloads/c/v.jpg?w=160', 320)).toBe('/downloads/c/v.jpg?w=160');
  });

  it('leaves external URLs, data URIs and empty values unchanged', () => {
    for (const src of ['https://i.ytimg.com/vi/x/hqdefault.jpg', 'https://is1-ssl.mzstatic.com/a.jpg', 'data:image/svg+xml;utf8,<svg/>', '/downloadsX/a.jpg', '/api/downloads/a.jpg', '//downloads/a.jpg']) {
      expect(thumbUrl(src, 320)).toBe(src);
    }
    expect(thumbUrl(null, 320)).toBeNull();
    expect(thumbUrl(undefined, 320)).toBeUndefined();
    expect(thumbUrl('', 320)).toBe('');
  });

  it('offers the same widths the server accepts', () => {
    expect([...THUMB_WIDTHS]).toEqual([...SERVER_WIDTHS]);
  });
});

describe('youtubeThumb / videoThumbSrc', () => {
  it('uses the 16:9 mqdefault for a long video (hqdefault is 4:3 with black bars)', async () => {
    const { youtubeThumb, videoThumbSrc } = await import('../../app/utils/thumb');
    expect(youtubeThumb('abc')).toBe('https://i.ytimg.com/vi/abc/mqdefault.jpg');
    expect(videoThumbSrc({ id: 'abc' }, 480)).toBe('https://i.ytimg.com/vi/abc/mqdefault.jpg');
    expect(videoThumbSrc({ id: 'abc', local_thumbnail_path: null }, 480)).toBe('https://i.ytimg.com/vi/abc/mqdefault.jpg');
  });

  it('prefers the resized local thumbnail', async () => {
    const { videoThumbSrc } = await import('../../app/utils/thumb');
    expect(videoThumbSrc({ id: 'abc', local_thumbnail_path: '/downloads/c/a.jpg' }, 320)).toBe('/downloads/c/a.jpg?w=320');
  });

  it('keeps hqdefault for a Short: its pillarboxed vertical frame fills a 9:16 cover box exactly', async () => {
    const { youtubeThumb, videoThumbSrc } = await import('../../app/utils/thumb');
    expect(youtubeThumb('s1', 'short')).toBe('https://i.ytimg.com/vi/s1/hqdefault.jpg');
    expect(videoThumbSrc({ id: 's1', is_short: 1 }, 480)).toBe('https://i.ytimg.com/vi/s1/hqdefault.jpg');
  });

  it('asks for the 16:9 maxresdefault for the home hero', async () => {
    const { youtubeThumb } = await import('../../app/utils/thumb');
    expect(youtubeThumb('h1', 'hero')).toBe('https://i.ytimg.com/vi/h1/maxresdefault.jpg');
  });

  it('encodes the id and returns an empty string without one', async () => {
    const { youtubeThumb } = await import('../../app/utils/thumb');
    expect(youtubeThumb('a/b?c')).toBe('https://i.ytimg.com/vi/a%2Fb%3Fc/mqdefault.jpg');
    expect(youtubeThumb('')).toBe('');
    expect(youtubeThumb(undefined)).toBe('');
  });
});
