import { defineEventHandler, getCookie, getHeader, setCookie, createError } from 'h3';
import { SESSION_COOKIE_NAME, CSRF_COOKIE_NAME, SESSION_DURATION, computeCsrfToken, isSecureRequest } from '../utils/auth';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export default defineEventHandler((event) => {
  const sessionId = getCookie(event, SESSION_COOKIE_NAME);
  if (!sessionId) return; // no session to protect (e.g. login itself)

  const expectedToken = computeCsrfToken(sessionId);

  if (!MUTATING_METHODS.has(event.method)) {
    // Self-heal: keep the CSRF cookie in sync on safe (non-mutating)
    // requests, so a session that predates this feature — or whose token
    // went stale across a server restart, which rotates the HMAC secret —
    // transparently gets a fresh, valid cookie on the user's very next page
    // load. Never done on a mutating request itself: that would let an
    // attacker mint and self-satisfy the pair in one request.
    if (event.method === 'GET' && getCookie(event, CSRF_COOKIE_NAME) !== expectedToken) {
      setCookie(event, CSRF_COOKIE_NAME, expectedToken, {
        httpOnly: false,
        secure: isSecureRequest(event),
        sameSite: 'lax',
        maxAge: SESSION_DURATION / 1000,
        path: '/'
      });
    }
    return;
  }

  const headerToken = getHeader(event, 'x-csrf-token');
  if (!headerToken || headerToken !== expectedToken) {
    throw createError({ statusCode: 403, statusMessage: 'Invalid or missing CSRF token. Please refresh the page and try again.' });
  }
});
