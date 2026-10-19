import { defineEventHandler, createError } from 'h3';
import { requireUser } from '../../../utils/auth';
import { revokeApiToken } from '../../../utils/apiTokens';
import { recordSecurityEvent } from '../../../utils/securityLog';

export default defineEventHandler(async (event) => {
  const userSession = await requireUser(event);
  const tokenId = event.context.params?.id;

  if (!tokenId) {
    throw createError({ statusCode: 404, statusMessage: 'Token not found.' });
  }

  const revoked = revokeApiToken(userSession.id, tokenId);
  if (!revoked) {
    throw createError({ statusCode: 404, statusMessage: 'Token not found.' });
  }
  recordSecurityEvent(event, 'token_revoked', { userId: userSession.id, username: userSession.username, tokenId });

  return { success: true };
});
