import fs from 'fs';
import path from 'path';
import type Database from 'better-sqlite3';
import { buildSpawnEnv, getDownloadsDir, runProcessAsync, sanitizeFolderName } from './downloader';

export type DurationProbe = (filePath: string) => Promise<number | null>;

/** Real probe: ffprobe's container duration; resolves null if ffprobe is missing/fails. */
export const ffprobeDuration: DurationProbe = async (filePath) => {
  try {
    const res = await runProcessAsync('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1', filePath,
    ], buildSpawnEnv());
    if (res.status !== 0) return null;
    const n = parseFloat(res.stdout.trim());
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
};

/**
 * Fills `duration` for already-downloaded videos that were ingested without one.
 * Never throws. File path mirrors server/routes/downloads: channel custom_save_path
 * (or the downloads dir) / sanitized channel title / file name.
 */
export async function backfillMissingVideoDurations(
  db: Database.Database,
  probe: DurationProbe = ffprobeDuration,
  opts: { limit?: number; downloadsDir?: string } = {},
): Promise<{ checked: number; updated: number }> {
  const result = { checked: 0, updated: 0 };
  try {
    const limit = opts.limit ?? 500;
    const downloadsDir = opts.downloadsDir ?? getDownloadsDir();
    const rows = db.prepare(`
      SELECT v.id AS id, v.local_video_path AS localPath, c.title AS title, c.custom_save_path AS customPath
      FROM videos v JOIN channels c ON c.id = v.channel_id
      WHERE v.download_status = 'completed' AND v.duration IS NULL
        AND v.local_video_path IS NOT NULL AND v.local_video_path != ''
      LIMIT ?
    `).all(limit) as { id: string; localPath: string; title: string; customPath: string | null }[];
    const update = db.prepare('UPDATE videos SET duration = ? WHERE id = ? AND duration IS NULL');

    for (const row of rows) {
      result.checked++;
      try {
        const fileName = path.basename(row.localPath);
        const base = row.customPath && row.customPath.trim() ? row.customPath : downloadsDir;
        const filePath = path.resolve(base, sanitizeFolderName(row.title || ''), fileName);
        if (!fs.existsSync(filePath)) continue;
        const seconds = await probe(filePath);
        if (typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0) {
          update.run(Math.max(1, Math.round(seconds)), row.id);
          result.updated++;
        }
      } catch (err) {
        console.error(`Duration backfill failed for video ${row.id}:`, err);
      }
    }
  } catch (err) {
    console.error('Duration backfill failed:', err);
  }
  return result;
}
