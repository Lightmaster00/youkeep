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
});
