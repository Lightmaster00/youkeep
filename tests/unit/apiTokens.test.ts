import { describe, it, expect } from 'vitest';
import { generateApiToken, hashApiToken } from '../../server/utils/apiTokens';

describe('generateApiToken', () => {
  it('starts with the yk_ prefix', () => {
    expect(generateApiToken()).toMatch(/^yk_/);
  });

  it('produces a base64url-encoded 32-byte payload after the prefix (43 characters, no padding, URL-safe alphabet)', () => {
    const token = generateApiToken();
    const payload = token.slice(3);
    expect(payload).toHaveLength(43);
    expect(payload).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(payload).not.toContain('=');
  });

  it('produces a different token on every call', () => {
    const a = generateApiToken();
    const b = generateApiToken();
    expect(a).not.toBe(b);
  });
});

describe('hashApiToken', () => {
  it('produces a 64-character lowercase hex SHA-256 digest', () => {
    const hash = hashApiToken('yk_sometoken');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic: the same input always produces the same hash', () => {
    expect(hashApiToken('yk_sometoken')).toBe(hashApiToken('yk_sometoken'));
  });

  it('produces different hashes for different inputs', () => {
    expect(hashApiToken('yk_tokenA')).not.toBe(hashApiToken('yk_tokenB'));
  });

  it('never returns the input itself (one-way, trivially)', () => {
    const input = 'yk_sometoken';
    expect(hashApiToken(input)).not.toBe(input);
    expect(hashApiToken(input)).not.toContain(input);
  });
});
