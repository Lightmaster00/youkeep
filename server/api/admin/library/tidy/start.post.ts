import { defineEventHandler, createError } from 'h3';
import { startTidyRun } from '../../../../utils/videoTidy';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const result = startTidyRun({ db: getDb(), downloadsDir: getDownloadsDir() });
  if (!result.started) {
    throw createError({ statusCode: 409, statusMessage: result.error });
  }
  return { started: true };
});
