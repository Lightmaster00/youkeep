import { defineEventHandler, readBody, createError } from 'h3';
import { Cron } from 'croner';
import { requireAdmin } from '../../../utils/auth';
import { initMusicScheduler } from '../../../utils/musicDownloader';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const body = await readBody(event);
  const { enabled, schedule } = body;

  if (enabled && !schedule) {
    throw createError({ statusCode: 400, statusMessage: 'Cron schedule expression is required when enabled.' });
  }

  if (enabled) {
    try {
      new Cron(schedule);
    } catch (err) {
      throw createError({ statusCode: 400, statusMessage: `Expression cron invalide : ${err}` });
    }
  }

  const db = getDb();
  db.prepare("INSERT INTO settings (key, value) VALUES ('music_sync_cron_enabled', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(enabled ? '1' : '0');
  db.prepare("INSERT INTO settings (key, value) VALUES ('music_sync_cron_schedule', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(schedule || '30 3 * * *');

  initMusicScheduler();

  return { success: true };
});
