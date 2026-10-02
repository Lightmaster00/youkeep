import { defineEventHandler, createError } from 'h3';
import { getUserFromSession } from '../utils/auth';

// A user flagged must_change_password (temporary password set by an admin)
// may only reach what the change-password screen itself needs. Enforced here
// rather than only in the UI so a session cookie or API token cannot be used
// to bypass it.
const ALLOWED_PREFIXES = ['/api/auth/', '/api/account/password', '/api/account/profile', '/api/settings/'];

export default defineEventHandler(async (event) => {
  const path = (event.path || '').split('?')[0] || '';
  // /downloads* (video), /downloads-music* and /downloads-podcasts* serve the
  // media files themselves and sit outside /api.
  const guarded = path.startsWith('/api/') || path.startsWith('/downloads');
  if (!guarded) return;
  if (ALLOWED_PREFIXES.some((prefix) => path.startsWith(prefix))) return;

  const user = await getUserFromSession(event);
  if (user?.mustChangePassword) {
    throw createError({ statusCode: 403, statusMessage: 'You must change your temporary password first.' });
  }
});
