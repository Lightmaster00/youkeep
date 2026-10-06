import { defineEventHandler } from 'h3';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  
  const db = getDb();
  const syncSetting = db.prepare("SELECT value FROM settings WHERE key = 'sync_all_active'").get() as { value: string } | undefined;
  
  if (syncSetting?.value === '1') {
    return { success: false, message: 'A sync of all channels is already running.' };
  }

  // Trigger asynchronously
  syncAllChannels();

  return { success: true, message: 'Sync of all channels started.' };
});
