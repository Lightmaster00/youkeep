import fs from 'fs';
import path from 'path';
import type Database from 'better-sqlite3';
import { spawn } from 'child_process';
import { buildSpawnEnv, getDownloadsDir, sanitizeFolderName } from './downloader';
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
 * Never throws. File path mirrors server/routes/downloads: channel custom_save_path
 * (or the downloads dir) / sanitized channel title / file name.
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
          const fileName = path.basename(row.localPath);
          const base = row.customPath && row.customPath.trim() ? row.customPath : downloadsDir;
          const channelDir = path.resolve(base, sanitizeFolderName(row.title || row.channelId));
          const filePath = path.resolve(channelDir, fileName);
          const rel = path.relative(channelDir, filePath);
          const relDir = path.relative(path.resolve(base), channelDir);
          if (rel.startsWith('..') || path.isAbsolute(rel) || relDir.startsWith('..') || path.isAbsolute(relDir)) continue;
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
