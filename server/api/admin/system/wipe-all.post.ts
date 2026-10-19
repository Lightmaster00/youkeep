import { defineEventHandler, createError } from 'h3';
import { requireSessionAdmin } from '../../../utils/auth';
import { recordSecurityEvent } from '../../../utils/securityLog';

export default defineEventHandler(async (event) => {
  // A real admin session: an API token cannot wipe or move the library.
  const admin = await requireSessionAdmin(event);

  const result = startLibraryWipe();
  if (!result.started) {
    throw createError({ statusCode: 409, statusMessage: result.error });
  }
  recordSecurityEvent(event, 'library_wipe_started', { userId: admin.id, username: admin.username });

  return { started: true };
});
