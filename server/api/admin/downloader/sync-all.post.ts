import { defineEventHandler } from 'h3';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  
  const db = getDb();
  const syncSetting = db.prepare("SELECT value FROM settings WHERE key = 'sync_all_active'").get() as { value: string } | undefined;
  
  if (syncSetting?.value === '1') {
    return { success: false, message: 'La mise à jour globale est déjà en cours.' };
  }

  // Trigger asynchronously
  syncAllChannels();

  return { success: true, message: 'Mise à jour globale de toutes les chaînes démarrée.' };
});
