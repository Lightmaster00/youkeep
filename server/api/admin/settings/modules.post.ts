import { defineEventHandler, readBody, createError } from 'h3';
import { requireAdmin } from '../../../utils/auth';
import { MODULE_IDS, getModuleStates, setModulesEnabled, LastModuleError } from '../../../utils/modules';
import type { ModuleId } from '../../../utils/modules';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);

  const body = await readBody(event);
  if (!body || typeof body !== 'object') {
    throw createError({ statusCode: 400, statusMessage: 'A body with video, music and/or podcasts (boolean) is required.' });
  }

  const changes: Partial<Record<ModuleId, boolean>> = {};
  for (const id of MODULE_IDS) {
    if (id in body) {
      if (typeof body[id] !== 'boolean') {
        throw createError({ statusCode: 400, statusMessage: `${id} must be a boolean.` });
      }
      changes[id] = body[id];
    }
  }
  if (Object.keys(changes).length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'At least one of video, music, podcasts (boolean) is required.' });
  }

  const db = getDb();
  try {
    setModulesEnabled(db, changes);
  } catch (err) {
    if (err instanceof LastModuleError) {
      throw createError({ statusCode: 400, statusMessage: 'At least one module must remain enabled.' });
    }
    throw err;
  }

  return getModuleStates(db);
});
