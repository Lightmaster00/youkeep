import { defineEventHandler } from 'h3';
import { readJsonObject, readScheduleFields } from '../../../utils/validation';
import { SYNC_TYPE_CONFIG } from '../../../utils/autoSync';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const { enabled, schedule } = readScheduleFields(await readJsonObject(event));

  const db = getDb();
  
  // Save settings
  db.prepare("UPDATE settings SET value = ? WHERE key = 'sync_cron_enabled'").run(enabled ? '1' : '0');
  db.prepare("UPDATE settings SET value = ? WHERE key = 'sync_cron_schedule'").run(schedule || SYNC_TYPE_CONFIG.video.defaultSchedule);

  // Restart scheduler
  initScheduler();

  return { success: true };
});
