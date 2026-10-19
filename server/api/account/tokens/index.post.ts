import { defineEventHandler, createError } from 'h3';
import { requireSessionUser } from '../../../utils/auth';
import { createApiToken, type ApiTokenScope } from '../../../utils/apiTokens';
import { readJsonObject } from '../../../utils/validation';
import { recordSecurityEvent } from '../../../utils/securityLog';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_EXPIRY_DAYS = 90;

// Body: { name (or legacy label), scope?: 'read' | 'full' (default 'read'),
// expiresInDays?: 1..365 | null (default 90; null = never expires) }.
export default defineEventHandler(async (event) => {
  const userSession = await requireSessionUser(event);
  const body = await readJsonObject(event);
  const rawName = typeof body.name === 'string' ? body.name : body.label;
  const label = typeof rawName === 'string' ? rawName.trim() : '';

  if (!label || label.length > 100) {
    throw createError({ statusCode: 400, statusMessage: 'Label must be between 1 and 100 characters.' });
  }

  let scope: ApiTokenScope = 'read';
  if (body.scope !== undefined) {
    if (body.scope !== 'read' && body.scope !== 'full') {
      throw createError({ statusCode: 400, statusMessage: 'Scope must be "read" or "full".' });
    }
    scope = body.scope;
  }

  let expiresAt: number | null = Date.now() + DEFAULT_EXPIRY_DAYS * DAY_MS;
  if (Object.prototype.hasOwnProperty.call(body, 'expiresInDays')) {
    const days = body.expiresInDays;
    if (days === null) {
      expiresAt = null;
    } else if (typeof days === 'number' && Number.isInteger(days) && days >= 1 && days <= 365) {
      expiresAt = Date.now() + days * DAY_MS;
    } else {
      throw createError({ statusCode: 400, statusMessage: 'expiresInDays must be a whole number from 1 to 365, or null.' });
    }
  }

  const result = createApiToken(userSession.id, label, { scope, expiresAt });
  recordSecurityEvent(event, 'token_created', { userId: userSession.id, username: userSession.username, tokenId: result.id, tokenLabel: label, scope, expiresAt });
  return { id: result.id, label, scope, expiresAt, token: result.token };
});
