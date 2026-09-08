import { defineEventHandler } from 'h3';
import { requireUser } from '../../../utils/auth';
import { listApiTokens } from '../../../utils/apiTokens';

export default defineEventHandler(async (event) => {
  const userSession = await requireUser(event);
  const tokens = listApiTokens(userSession.id);
  return { tokens };
});
