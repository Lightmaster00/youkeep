import fs from 'fs';
import type Database from 'better-sqlite3';
import { spawn } from 'child_process';
import { buildSpawnEnv, getDownloadsDir } from './downloader';
import { isContained, resolveStoredPath } from './videoPaths';
import { isWipeInProgress } from './libraryWipe';
import { isModuleEnabled } from './modules';

export type DurationProbe = (filePath: string) => Promise<number | null>;

const PROBE_TIMEOUT_MS = 20_000;

/** Real probe: ffprobe's container duration; resolves null on failure, missing binary or timeout. */
export function runFfprobe(
  filePath: string,
  deps: { spawnFn?: typeof spawn; timeoutMs?: number } = {},
): Promise<number | null> {
  const spawnFn = deps.spawnFn ?? spawn;
  const timeoutMs = deps.timeoutMs ?? PROBE_TIMEOUT_MS;
  return new Promise((resolve) => {
    let done = false;
    let timer: NodeJS.Timeout | null = null;
    const finish = (v: number | null) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      resolve(v);
    };
    try {
      const child = spawnFn('ffprobe', [
        '-v', 'error', '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1', filePath,
      ], { env: buildSpawnEnv() });
      let out = '';
      timer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch {}
        finish(null);
      }, timeoutMs);
      child.stdout?.on('data', (d: any) => { out += d.toString(); });
      child.on('error', () => finish(null));
      child.on('close', (code: number | null) => {
        const n = parseFloat(out.trim());
        finish(code === 0 && Number.isFinite(n) && n > 0 ? n : null);
      });
    } catch {
      finish(null);
    }
  });
}

export const ffprobeDuration: DurationProbe = (filePath) => runFfprobe(filePath);

const EXAMINED_CAP = 5000;
const BATCH_SIZE = 200;

/**
 * Fills `duration` for already-downloaded videos that were ingested without one.
 * Never throws. File path comes from resolveStoredPath (same mapping as
 * server/routes/downloads).
 */
export async function backfillMissingVideoDurations(
  db: Database.Database,
  probe: DurationProbe = ffprobeDuration,
  opts: { limit?: number; downloadsDir?: string; maxExamined?: number } = {},
): Promise<{ checked: number; updated: number }> {
  const result = { checked: 0, updated: 0 };
  try {
    if (isWipeInProgress() || !isModuleEnabled(db, 'video')) return result;
    const limit = opts.limit ?? 500;
    const maxExamined = opts.maxExamined ?? EXAMINED_CAP;
    const downloadsDir = opts.downloadsDir ?? getDownloadsDir();
    const select = db.prepare(`
      SELECT v.id AS id, v.local_video_path AS localPath, c.id AS channelId, c.title AS title, c.custom_save_path AS customPath
      FROM videos v JOIN channels c ON c.id = v.channel_id
      WHERE v.download_status = 'completed' AND v.duration IS NULL
        AND v.local_video_path IS NOT NULL AND v.local_video_path != ''
        AND v.id > ?
      ORDER BY v.id
      LIMIT ?
    `);
    const update = db.prepare('UPDATE videos SET duration = ? WHERE id = ? AND duration IS NULL');

    let lastId = '';
    let examined = 0;
    while (result.checked < limit && examined < maxExamined) {
      const rows = select.all(lastId, BATCH_SIZE) as {
        id: string; localPath: string; channelId: string; title: string; customPath: string | null;
      }[];
      if (rows.length === 0) break;
      for (const row of rows) {
        if (result.checked >= limit || examined >= maxExamined) break;
        examined++;
        lastId = row.id;
        try {
          // Same mapping as server/routes/downloads: the stored path decides the
          // folder (one folder per video, or the channel folder for legacy rows).
          const location = resolveStoredPath(db, { id: row.id, channel_id: row.channelId, local_video_path: row.localPath }, { downloadsDir });
          const filePath = location.videoFile;
          if (!filePath || !isContained(location.baseDir, filePath)) continue;
          if (!fs.existsSync(filePath)) continue;
          result.checked++;
          const seconds = await probe(filePath);
          if (typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0) {
            update.run(Math.max(1, Math.round(seconds)), row.id);
            result.updated++;
          }
        } catch (err) {
          console.error(`Duration backfill failed for video ${row.id}:`, err);
        }
      }
    }
  } catch (err) {
    console.error('Duration backfill failed:', err);
  }
  return result;
}
