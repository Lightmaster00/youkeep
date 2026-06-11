import { defineEventHandler, readBody, createError } from 'h3';
import fs from 'fs';
import path from 'path';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const body = await readBody(event);
  const { path: dirPath } = body;

  const trimmed = (dirPath || '').trim();

  if (trimmed.length > 0) {
    // Validate that it's an absolute path
    if (!path.isAbsolute(trimmed)) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Le chemin doit être un chemin absolu (ex: /var/nas/myteub).'
      });
    }

    // Try to ensure directory exists or can be created
    try {
      if (!fs.existsSync(trimmed)) {
        fs.mkdirSync(trimmed, { recursive: true });
      }
    } catch (err: any) {
      throw createError({
        statusCode: 400,
        statusMessage: `Impossible de créer ou d'accéder au dossier : ${err.message}`
      });
    }
  }

  const db = getDb();
  db.prepare("UPDATE settings SET value = ? WHERE key = 'default_downloads_dir'").run(trimmed);

  return { success: true };
});
