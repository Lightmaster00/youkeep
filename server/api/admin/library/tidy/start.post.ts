import { defineEventHandler, createError } from 'h3';
import { startTidyRun } from '../../../../utils/videoTidy';
import { requireSessionAdmin } from '../../../../utils/auth';
import { recordSecurityEvent } from '../../../../utils/securityLog';

export default defineEventHandler(async (event) => {
  // A real admin session: an API token cannot wipe or move the library.
  const admin = await requireSessionAdmin(event);
  const result = startTidyRun({ db: getDb(), downloadsDir: getDownloadsDir() });
  if (!result.started) {
    throw createError({ statusCode: 409, statusMessage: result.error });
  }
  recordSecurityEvent(event, 'library_tidy_started', { userId: admin.id, username: admin.username });
  return { started: true };
});
