import { defineEventHandler } from 'h3';
import { parseMaxConcurrentDownloads } from '../../../utils/concurrency';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const db = getDb();

  const row = db.prepare("SELECT value FROM settings WHERE key = 'podcast_max_concurrent_downloads'").get() as { value: string } | undefined;

  return { maxConcurrentDownloads: parseMaxConcurrentDownloads(row?.value) };
});
