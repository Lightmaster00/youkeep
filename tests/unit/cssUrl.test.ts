import { describe, it, expect } from 'vitest';
import { cssUrl } from '../../app/utils/cssUrl';

describe('cssUrl', () => {
  it('quotes and encodes legacy paths with spaces and parentheses', () => {
    expect(cssUrl('/downloads/My Channel (old)/thumb.jpg')).toBe('url("/downloads/My%20Channel%20(old)/thumb.jpg")');
  });
  it('does not double-encode an already encoded path', () => {
    expect(cssUrl('/downloads/My%20Channel/t.jpg')).toBe('url("/downloads/My%20Channel/t.jpg")');
  });
  it('cannot be broken out of with quotes, backslashes or newlines', () => {
    const out = cssUrl('/x") , url("https://evil/\\a\nb');
    expect(out.startsWith('url("')).toBe(true);
    expect(out.endsWith('")')).toBe(true);
    expect(out.slice(5, -2)).not.toMatch(/["\\\n]/);
  });
  it('keeps remote URLs working and handles malformed escapes', () => {
    expect(cssUrl('https://i.ytimg.com/vi/abc/hqdefault.jpg')).toBe('url("https://i.ytimg.com/vi/abc/hqdefault.jpg")');
    expect(cssUrl('/a%zz b.jpg')).toBe('url("/a%25zz%20b.jpg")');
    expect(cssUrl('')).toBe('none');
  });

  it.each([
    ['#', '%23'], ['&', '%26'], ['+', '%2B'], ['?', '%3F'], [',', '%2C'],
    [' ', '%20'], ['[', '%5B'], [']', '%5D'], ['é', '%C3%A9'], ['%', '%25'],
  ])('encodes %j exactly once, raw or already encoded', (char, enc) => {
    const want = `url("/media/videos/Short%20clip%20${enc}1.jpg")`;
    if (char !== '%') expect(cssUrl(`/media/videos/Short clip ${char}1.jpg`)).toBe(want);
    // The server encodes each segment: that form is kept, never re-encoded.
    expect(cssUrl(`/media/videos/Short%20clip%20${enc}1.jpg`)).toBe(want);
    // Idempotent.
    expect(cssUrl(want.slice(5, -2))).toBe(want);
  });

  it('keeps the query string of a remote address', () => {
    expect(cssUrl('https://yt3.example.com/a b/x.jpg?s=88&c=k')).toBe('url("https://yt3.example.com/a%20b/x.jpg?s=88&c=k")');
  });
});
