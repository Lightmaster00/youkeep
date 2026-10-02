import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isSecureRequest } from '../../server/utils/auth';
import { mockEvent } from '../helpers/testDb';

const original = process.env.COOKIE_SECURE;

beforeEach(() => {
  delete process.env.COOKIE_SECURE;
});

afterEach(() => {
  if (original === undefined) delete process.env.COOKIE_SECURE;
  else process.env.COOKIE_SECURE = original;
});

describe('isSecureRequest', () => {
  it('is false for a plain-HTTP request (e.g. LAN access), so browsers keep the cookie', () => {
    expect(isSecureRequest(mockEvent())).toBe(false);
  });

  it('is true when a reverse proxy reports X-Forwarded-Proto: https', () => {
    expect(isSecureRequest(mockEvent(undefined, { headers: { 'x-forwarded-proto': 'https' } }))).toBe(true);
  });

  it('is false when X-Forwarded-Proto says http', () => {
    expect(isSecureRequest(mockEvent(undefined, { headers: { 'x-forwarded-proto': 'http' } }))).toBe(false);
  });

  it('COOKIE_SECURE=true forces Secure even on plain HTTP', () => {
    process.env.COOKIE_SECURE = 'true';
    expect(isSecureRequest(mockEvent())).toBe(true);
  });

  it('COOKIE_SECURE=false forces non-Secure even behind HTTPS', () => {
    process.env.COOKIE_SECURE = 'false';
    expect(isSecureRequest(mockEvent(undefined, { headers: { 'x-forwarded-proto': 'https' } }))).toBe(false);
  });
});
