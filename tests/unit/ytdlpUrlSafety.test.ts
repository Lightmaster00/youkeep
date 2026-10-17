import { describe, it, expect } from 'vitest';
import { requiredUrl } from '../../server/utils/validation';

function reject(value: unknown) {
  try {
    requiredUrl({ url: value }, 'url');
  } catch (e: any) {
    return e.statusCode;
  }
  return 'accepted';
}

describe('URLs handed to yt-dlp', () => {
  it('accepts plain http(s) URLs', () => {
    expect(requiredUrl({ url: 'https://www.youtube.com/@Eminem' }, 'url')).toBe('https://www.youtube.com/@Eminem');
    expect(requiredUrl({ url: 'http://localhost:8080/feed.xml' }, 'url')).toBe('http://localhost:8080/feed.xml');
  });

  it('refuses anything that yt-dlp could read as an option or another scheme', () => {
    for (const bad of ['--batch-file=/etc/passwd', '-o /tmp/x', ' --exec=id', 'file:///etc/passwd', 'ftp://example.com/x', 'javascript:alert(1)', 'not a url', '//evil.com/x', 'https://']) {
      expect(reject(bad), bad).toBe(400);
    }
  });

  it('refuses credentials embedded in the URL', () => {
    expect(reject('https://user:pass@example.com/feed')).toBe(400);
  });
});
