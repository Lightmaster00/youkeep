import { defineEventHandler } from 'h3';
import { readJsonObject, readScheduleFields } from '../../../utils/validation';
import { requireAdmin } from '../../../utils/auth';
import { initPodcastScheduler } from '../../../utils/podcastDownloader';
import { SYNC_TYPE_CONFIG } from '../../../utils/autoSync';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const { enabled, schedule } = readScheduleFields(await readJsonObject(event));

  const db = getDb();
  db.prepare("INSERT INTO settings (key, value) VALUES ('podcast_sync_cron_enabled', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(enabled ? '1' : '0');
  db.prepare("INSERT INTO settings (key, value) VALUES ('podcast_sync_cron_schedule', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(schedule || SYNC_TYPE_CONFIG.podcast.defaultSchedule);

  initPodcastScheduler();

  return { success: true };
});
