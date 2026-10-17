import { defineEventHandler, createError } from 'h3';
import { getUserFromSession } from '../utils/auth';
import { moduleForPath, isModuleEnabled } from '../utils/modules';
import { normalizeRequestPath } from '../utils/requestPath';

export default defineEventHandler(async (event) => {
  const path = (event.path || '').split('?')[0] ?? '';
  const moduleId = moduleForPath(normalizeRequestPath(path));
  if (!moduleId) return;

  let enabled = true;
  try {
    enabled = isModuleEnabled(getDb(), moduleId);
  } catch {
    enabled = true;
  }
  if (enabled) return;

  try {
    const session = await getUserFromSession(event);
    if (session?.role === 'admin') return;
  } catch {
    return;
  }

  throw createError({ statusCode: 404, statusMessage: `Cannot find any route matching ${path}.` });
});
