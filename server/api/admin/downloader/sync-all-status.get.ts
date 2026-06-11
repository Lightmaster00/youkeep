import { defineEventHandler } from 'h3';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const db = getDb();
  
  const syncSetting = db.prepare("SELECT value FROM settings WHERE key = 'sync_all_active'").get() as { value: string } | undefined;
  const active = syncSetting ? syncSetting.value === '1' : false;

  return { active };
});
