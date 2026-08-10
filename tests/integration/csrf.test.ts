import { describe, it, expect } from 'vitest';
import csrfMiddleware from '../../server/middleware/csrf';
import { mockEvent } from '../helpers/testDb';

describe('CSRF middleware', () => {
  it('rejects a mutating request with a session cookie but no x-csrf-token header', () => {
    const event = mockEvent('youkeep_session=abc123; csrf_token=secret-token', {
      method: 'POST'
    });

    expect(() => csrfMiddleware(event)).toThrow(
      expect.objectContaining({ statusCode: 403 })
    );
  });

  it('rejects a mutating request with a mismatched x-csrf-token header', () => {
    const event = mockEvent('youkeep_session=abc123; csrf_token=secret-token', {
      method: 'POST',
      headers: { 'x-csrf-token': 'wrong-token' }
    });

    expect(() => csrfMiddleware(event)).toThrow(
      expect.objectContaining({ statusCode: 403 })
    );
  });

  it('allows a mutating request with a matching x-csrf-token header', () => {
    const event = mockEvent('youkeep_session=abc123; csrf_token=secret-token', {
      method: 'POST',
      headers: { 'x-csrf-token': 'secret-token' }
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

  it('does not block a non-mutating (GET) request even without a CSRF header', () => {
    const event = mockEvent('youkeep_session=abc123; csrf_token=secret-token', {
      method: 'GET'
    });

    expect(() => csrfMiddleware(event)).not.toThrow();
  });
});
