import { describe, it, expect, afterEach } from 'vitest';
import middleware from '../../server/middleware/securityHeaders';
import { mockEvent } from '../helpers/testDb';

const originalEnv = process.env.NODE_ENV;
afterEach(() => {
  process.env.NODE_ENV = originalEnv;
});

function headersFor(opts?: Parameters<typeof mockEvent>[1]) {
  const event = mockEvent(undefined, opts);
  middleware(event);
  return event.node.res.headers as Record<string, string>;
}

describe('securityHeaders middleware', () => {
  it('always sets the baseline headers', () => {
    const h = headersFor();
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['x-frame-options']).toBe('SAMEORIGIN');
    expect(h['referrer-policy']).toBe('same-origin');
  });

  it('sets a locked-down CSP in production only', () => {
    process.env.NODE_ENV = 'production';
    const csp = headersFor()['content-security-policy'];
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'self'");
    process.env.NODE_ENV = 'development';
    expect(headersFor()['content-security-policy']).toBeUndefined();
  });

  it('sends HSTS only for HTTPS requests, never on plain HTTP', () => {
    expect(headersFor()['strict-transport-security']).toBeUndefined();
    expect(headersFor({ headers: { 'x-forwarded-proto': 'https' } })['strict-transport-security']).toContain('max-age=');
  });
});
