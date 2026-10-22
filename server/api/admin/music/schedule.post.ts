import { defineEventHandler } from 'h3';
import { readJsonObject, readScheduleFields } from '../../../utils/validation';
import { requireAdmin } from '../../../utils/auth';
import { initMusicScheduler } from '../../../utils/musicDownloader';
import { SYNC_TYPE_CONFIG } from '../../../utils/autoSync';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const { enabled, schedule } = readScheduleFields(await readJsonObject(event));

  const db = getDb();
  db.prepare("INSERT INTO settings (key, value) VALUES ('music_sync_cron_enabled', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(enabled ? '1' : '0');
  db.prepare("INSERT INTO settings (key, value) VALUES ('music_sync_cron_schedule', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(schedule || SYNC_TYPE_CONFIG.music.defaultSchedule);

  initMusicScheduler();

  return { success: true };
});
