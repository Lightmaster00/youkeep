import { defineEventHandler, readBody, createError } from 'h3';
import { Cron } from 'croner';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const body = await readBody(event);
  const { enabled, schedule } = body;

  if (enabled && !schedule) {
    throw createError({ statusCode: 400, statusMessage: 'Cron schedule expression is required when enabled.' });
  }

  // Validate cron expression if enabled
  if (enabled) {
    try {
      // Create a test instance to validate syntax
      new Cron(schedule);
    } catch (err) {
      throw createError({ statusCode: 400, statusMessage: `Expression cron invalide : ${err}` });
    }
  }

  const db = getDb();
  
  // Save settings
  db.prepare("UPDATE settings SET value = ? WHERE key = 'sync_cron_enabled'").run(enabled ? '1' : '0');
  db.prepare("UPDATE settings SET value = ? WHERE key = 'sync_cron_schedule'").run(schedule || '0 3 * * *');

  // Restart scheduler
  initScheduler();

  return { success: true };
});
