import { defineEventHandler, createError } from 'h3';
import { readJsonObject, optionalString } from '../../../utils/validation';
import fs from 'fs';
import path from 'path';
import { requireSessionAdmin } from '../../../utils/auth';

export default defineEventHandler(async (event) => {
  // A real admin session: an API token cannot wipe or move the library.
  await requireSessionAdmin(event);
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

    // The folder must already exist and be writable: it is never created
    // (a missing folder is usually an unmounted share; creating it would
    // fill the local disk instead).
    let ok = false;
    try {
      ok = fs.statSync(trimmed).isDirectory();
      if (ok) fs.accessSync(trimmed, fs.constants.W_OK);
    } catch (err: any) {
      if (err?.code !== 'ENOENT') console.error('[admin/downloader/default-dir]', err);
      ok = false;
    }
    if (!ok) {
      throw createError({
        statusCode: 400,
        statusMessage: 'The folder does not exist or is not writable. Create it (or mount the share) first.'
      });
    }
  }

  const db = getDb();
  db.prepare("UPDATE settings SET value = ? WHERE key = 'default_downloads_dir'").run(trimmed);

  return { success: true };
});
