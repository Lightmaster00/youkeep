import { defineEventHandler } from 'h3';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const db = getDb();

  const enabledSetting = db.prepare("SELECT value FROM settings WHERE key = 'sync_cron_enabled'").get() as { value: string } | undefined;
  const scheduleSetting = db.prepare("SELECT value FROM settings WHERE key = 'sync_cron_schedule'").get() as { value: string } | undefined;

  return {
    enabled: enabledSetting ? enabledSetting.value === '1' : false,
    schedule: scheduleSetting?.value || '0 3 * * *'
  };
});
