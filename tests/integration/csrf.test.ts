import { describe, it, expect } from 'vitest';
import csrfMiddleware from '../../server/middleware/csrf';
import { computeCsrfToken } from '../../server/utils/auth';
import { mockEvent } from '../helpers/testDb';

describe('CSRF middleware', () => {
  const sessionId = 'abc123';
  const validToken = computeCsrfToken(sessionId);

  it('rejects a mutating request with a session cookie but no x-csrf-token header', () => {
    const event = mockEvent(`youkeep_session=${sessionId}; csrf_token=${validToken}`, {
      method: 'POST'
    });

    expect(() => csrfMiddleware(event)).toThrow(
      expect.objectContaining({ statusCode: 403 })
    );
  });

  it('rejects a mutating request with a mismatched x-csrf-token header', () => {
    const event = mockEvent(`youkeep_session=${sessionId}; csrf_token=${validToken}`, {
      method: 'POST',
      headers: { 'x-csrf-token': 'wrong-token' }
    });

    expect(() => csrfMiddleware(event)).toThrow(
      expect.objectContaining({ statusCode: 403 })
    );
  });

  it('allows a mutating request with a matching x-csrf-token header', () => {
    const event = mockEvent(`youkeep_session=${sessionId}; csrf_token=${validToken}`, {
      method: 'POST',
      headers: { 'x-csrf-token': validToken }
    });

    expect(() => csrfMiddleware(event)).not.toThrow();
  });

  it('does not block a mutating request with no session cookie (e.g. login itself)', () => {
    const event = mockEvent(undefined, {
      method: 'POST',
      path: '/api/auth/login'
    });

    expect(() => csrfMiddleware(event)).not.toThrow();
  });

  it('does not block a non-mutating (GET) request even without a matching CSRF cookie', () => {
    const event = mockEvent(`youkeep_session=${sessionId}`, {
      method: 'GET'
    });

    expect(() => csrfMiddleware(event)).not.toThrow();
  });

  it('self-heals a missing or stale CSRF cookie on a GET request with a valid session', () => {
    // No csrf_token cookie present at all — simulates a pre-existing session
    // (or one whose token went stale after a server restart rotated the
    // HMAC secret).
    const event = mockEvent(`youkeep_session=${sessionId}`, { method: 'GET' });

    csrfMiddleware(event);

    const setCookieHeader = String(event.node.res.getHeader('set-cookie'));
    expect(setCookieHeader).toContain(`csrf_token=${validToken}`);
  });
});
