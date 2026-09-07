import { defineEventHandler, createError } from 'h3';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);

  const result = startLibraryWipe();
  if (!result.started) {
    throw createError({ statusCode: 409, statusMessage: result.error });
  }

  return { started: true };
});
