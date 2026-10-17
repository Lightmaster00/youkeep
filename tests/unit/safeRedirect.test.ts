import { describe, it, expect } from 'vitest';
import { safeRedirectPath } from '../../app/utils/safeRedirect';

describe('safeRedirectPath', () => {
  it('keeps same-origin paths with query and hash', () => {
    expect(safeRedirectPath('/watch/abc?t=3#c')).toBe('/watch/abc?t=3#c');
    expect(safeRedirectPath('/playlists/p1?token=xyz')).toBe('/playlists/p1?token=xyz');
    expect(safeRedirectPath(['/history'])).toBe('/history');
  });

  it.each([
    '//evil.com',
    '//evil.com/path',
    '/\\evil',
    '/\\/evil.com',
    'https://x',
    'http://evil.com/',
    'javascript:alert(1)',
    'evil.com',
    '',
    '/\tevil',
    '/\nevil',
    '/login',
    '/login?redirect=/x',
    // Normalised into a protocol-relative "//..." path.
    '/.//evil.com',
    '/a/..//x',
    '/%2e%2e//x',
    '/%2F/evil',
    '/%5Cevil',
    '/%09/evil',
    '/\t/evil',
    '/%E0%A4%A',
  ])('refuses %j', (value) => {
    expect(safeRedirectPath(value)).toBeNull();
  });

  it('still accepts encoded characters that stay inside the path', () => {
    expect(safeRedirectPath('/music?q=a%20b')).toBe('/music?q=a%20b');
    expect(safeRedirectPath('/a/../watch/x')).toBe('/watch/x');
  });

  it('refuses non-strings', () => {
    expect(safeRedirectPath(undefined)).toBeNull();
    expect(safeRedirectPath(null)).toBeNull();
    expect(safeRedirectPath(42)).toBeNull();
  });
});
