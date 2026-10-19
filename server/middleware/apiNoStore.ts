import { defineEventHandler, setHeader } from 'h3';
import { normalizeRequestPath } from '../utils/requestPath';

// Every /api/** response is JSON that depends on who asks (the session or
// API token decides visibility, history, favorites, follows, progress,
// playlists, admin data...): no shared or browser cache may keep it or hand
// it to another user. Media files (/downloads*) and pages sit outside /api
// and keep their own caching rules. Routes may still set their own
// Cache-Control after this runs.
export default defineEventHandler((event) => {
  const path = normalizeRequestPath(event.path);
  if (path !== '/api' && !path.startsWith('/api/')) return;
  setHeader(event, 'Cache-Control', 'no-store');
  setHeader(event, 'Vary', 'Cookie, Authorization');
});
