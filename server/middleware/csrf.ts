import { defineEventHandler, getCookie, getHeader, createError } from 'h3';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export default defineEventHandler((event) => {
  if (!MUTATING_METHODS.has(event.method)) return;

  const sessionId = getCookie(event, 'youkeep_session');
  if (!sessionId) return; // no session to protect (e.g. login itself)

  const cookieToken = getCookie(event, 'csrf_token');
  const headerToken = getHeader(event, 'x-csrf-token');

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    throw createError({ statusCode: 403, statusMessage: 'Invalid or missing CSRF token. Please refresh the page and try again.' });
  }
});
