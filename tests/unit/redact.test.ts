import { describe, it, expect } from 'vitest';
import { secretHint, maskSecret, redactUrls } from '../../server/utils/redact';

describe('secretHint / maskSecret', () => {
  it('reveals nothing of a short secret (under 12 characters)', () => {
    for (const s of ['abcd', 'abcdefgh', 'abcdefghijk']) {
      expect(secretHint(s)).toBe('');
      expect(maskSecret(s)).toBe('••••');
      expect(maskSecret(s)).not.toContain(s.slice(-4));
    }
  });

  it('reveals only the last 4 characters of a long secret', () => {
    expect(secretHint('abcdefghijkl')).toBe('ijkl');
    expect(maskSecret('sk-0123456789abcdef')).toBe('••••cdef');
  });

  it('masks nothing when no secret is stored', () => {
    expect(maskSecret('')).toBe('');
  });
});

describe('redactUrls', () => {
  it('drops query strings and every listed secret', () => {
    expect(redactUrls('GET https://api.example.com/v3/search?key=SECRETKEY&q=x failed', ['SECRETKEY']))
      .toBe('GET https://api.example.com/v3/search?[redacted] failed');
    expect(redactUrls('token SECRETKEY leaked', ['SECRETKEY'])).toBe('token [redacted] leaked');
  });
});
