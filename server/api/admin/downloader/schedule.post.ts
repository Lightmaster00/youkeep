import { defineEventHandler } from 'h3';
import { readJsonObject, readScheduleFields } from '../../../utils/validation';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const { enabled, schedule } = readScheduleFields(await readJsonObject(event));

  const db = getDb();
  
  // Save settings
  db.prepare("UPDATE settings SET value = ? WHERE key = 'sync_cron_enabled'").run(enabled ? '1' : '0');
  db.prepare("UPDATE settings SET value = ? WHERE key = 'sync_cron_schedule'").run(schedule || '0 3 * * *');

  // Restart scheduler
  initScheduler();

  return { success: true };
});
