import { defineEventHandler, createError } from 'h3';
import { readJsonObject, optionalString } from '../../../utils/validation';
import fs from 'fs';
import path from 'path';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  // An empty or missing path means "back to the built-in default".
  const trimmed = optionalString(await readJsonObject(event), 'path', { max: 1024 }) ?? '';
  if (trimmed.includes('\0')) {
    throw createError({ statusCode: 400, statusMessage: 'The path contains an invalid character.' });
  }

  if (trimmed.length > 0) {
    // Validate that it's an absolute path
    if (!path.isAbsolute(trimmed)) {
      throw createError({
        statusCode: 400,
        statusMessage: 'The path must be an absolute path (e.g. /var/nas/youkeep).'
      });
    }

    // Try to ensure directory exists or can be created
    try {
      if (!fs.existsSync(trimmed)) {
        fs.mkdirSync(trimmed, { recursive: true });
      }
    } catch (err: any) {
      console.error('[admin/downloader/default-dir]', err);
      throw createError({
        statusCode: 400,
        statusMessage: 'Unable to create or access the folder. Check the server logs for details.'
      });
    }
  }

  const db = getDb();
  db.prepare("UPDATE settings SET value = ? WHERE key = 'default_downloads_dir'").run(trimmed);

  return { success: true };
});
