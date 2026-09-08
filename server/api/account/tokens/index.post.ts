import { defineEventHandler, readBody, createError } from 'h3';
import { requireUser } from '../../../utils/auth';
import { createApiToken } from '../../../utils/apiTokens';

export default defineEventHandler(async (event) => {
  const userSession = await requireUser(event);
  const body = await readBody(event);
  const label = typeof body?.label === 'string' ? body.label.trim() : '';

  if (!label || label.length > 100) {
    throw createError({ statusCode: 400, statusMessage: 'Label must be between 1 and 100 characters.' });
  }

  const result = createApiToken(userSession.id, label);
  return { id: result.id, label, token: result.token };
});
