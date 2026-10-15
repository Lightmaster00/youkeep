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
