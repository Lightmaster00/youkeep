import { defineEventHandler, createError } from 'h3';
import { requireSessionAdmin } from '../../../utils/auth';

export default defineEventHandler(async (event) => {
  // A real admin session: an API token cannot wipe or move the library.
  await requireSessionAdmin(event);

  const result = startLibraryWipe();
  if (!result.started) {
    throw createError({ statusCode: 409, statusMessage: result.error });
  }

  return { started: true };
});
