import { describe, it, expect } from 'vitest';
import { generateApiToken, hashApiToken } from '../../server/utils/apiTokens';

describe('generateApiToken', () => {
  it('is yk_ + a fresh base64url 32-byte payload (43 URL-safe characters, no padding)', () => {
    const token = generateApiToken();
    expect(token).toMatch(/^yk_[A-Za-z0-9_-]{43}$/);
    expect(generateApiToken()).not.toBe(token);
  });
});

describe('hashApiToken', () => {
  it('is a deterministic one-way sha256 hex digest', () => {
    const hash = hashApiToken('yk_sometoken');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashApiToken('yk_sometoken')).toBe(hash);
    expect(hashApiToken('yk_tokenB')).not.toBe(hash);
  });
});
