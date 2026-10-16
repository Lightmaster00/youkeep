import { defineEventHandler, createError } from 'h3';
import { requireSessionUser } from '../../../utils/auth';
import { createApiToken } from '../../../utils/apiTokens';
import { readJsonObject } from '../../../utils/validation';

export default defineEventHandler(async (event) => {
  const userSession = await requireSessionUser(event);
  const body = await readJsonObject(event);
  const label = typeof body.label === 'string' ? body.label.trim() : '';

  if (!label || label.length > 100) {
    throw createError({ statusCode: 400, statusMessage: 'Label must be between 1 and 100 characters.' });
  }

  const result = createApiToken(userSession.id, label);
  return { id: result.id, label, token: result.token };
});
