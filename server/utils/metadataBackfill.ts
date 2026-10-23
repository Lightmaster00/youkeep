import type Database from 'better-sqlite3';
import { getDb } from './db';
import { addLog, buildSpawnEnv, getDownloadsDirState, getYtdlPath, runProcessAsync } from './downloader';
import { isShuttingDown } from './processTree';
import { isEffectivelyPaused } from './modules';
import { sanitizeCategories, sanitizeTags } from './videoInfo';

/**
 * Fills the YouTube categories and tags of videos downloaded before they were
 * captured (videos.metadata_enriched_at IS NULL). A resumable background job:
 * progress lives in the database, so an interrupted run continues where it
 * stopped on the next start. One video at a time, at most one yt-dlp request
 * every METADATA_BACKFILL_INTERVAL_MS, never while the server shuts down, and
 * it waits while the downloader is blocked or paused. A video that fails
 * METADATA_BACKFILL_MAX_ATTEMPTS times is marked enriched with empty lists so
 * it never blocks the queue. A run never throws out of its loop.
 */

export type MetadataBackfillState = 'idle' | 'running' | 'done' | 'failed' | 'cancelled';

export interface MetadataBackfillStatus {
  state: MetadataBackfillState;
  processed: number;
  enriched: number;
  failed: number;
  /** Why the run is waiting (downloader blocked or paused), else null. */
  waitingReason: string | null;
  lastError: string | null;
  startedAt: number | null;
  finishedAt: number | null;
}

export interface MetadataBackfillCounts {
  total: number;
  enriched: number;
  pending: number;
  enabled: boolean;
}

export const METADATA_BACKFILL_SETTING = 'metadata_backfill_enabled';
export const METADATA_BACKFILL_INTERVAL_MS = 4_000;
export const METADATA_BACKFILL_TIMEOUT_MS = 60_000;
export const METADATA_BACKFILL_MAX_ATTEMPTS = 3;
export const METADATA_BACKFILL_BLOCKED_POLL_MS = 60_000;
export const METADATA_BACKFILL_MAX_BACKOFF_MS = 5 * 60_000;
export const STARTUP_METADATA_BACKFILL_DELAY_MS = 120_000;
/** YouTube video ids: never anything else reaches the yt-dlp command line. */
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{6,20}$/;

const G_STATUS = Symbol.for('YouKeep.metadataBackfillStatus');
const G_CANCEL = Symbol.for('YouKeep.metadataBackfillCancel');
const G_WAKE = Symbol.for('YouKeep.metadataBackfillWake');
const G_LAST_REQUEST = Symbol.for('YouKeep.metadataBackfillLastRequest');
const _g = globalThis as any;

function idleStatus(): MetadataBackfillStatus {
  return { state: 'idle', processed: 0, enriched: 0, failed: 0, waitingReason: null, lastError: null, startedAt: null, finishedAt: null };
}
if (!_g[G_STATUS]) _g[G_STATUS] = idleStatus();
if (_g[G_CANCEL] === undefined) _g[G_CANCEL] = false;
if (_g[G_LAST_REQUEST] === undefined) _g[G_LAST_REQUEST] = 0;

const status = (): MetadataBackfillStatus => _g[G_STATUS];

/** A sleep that a cancel cuts short. */
function wakeableSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      if (_g[G_WAKE] === done) _g[G_WAKE] = null;
      resolve();
    };
    const timer = setTimeout(done, ms);
    _g[G_WAKE] = done;
  });
}

async function defaultRunYtdl(args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string; status: number | null }> {
  const ytdlPath = await getYtdlPath();
  return runProcessAsync(ytdlPath, args, buildSpawnEnv(), 20 * 1024 * 1024, timeoutMs);
}

/** Swappable in tests: no real yt-dlp and no real waiting. */
export const metadataBackfillDeps = {
  runYtdl: defaultRunYtdl as (args: string[], timeoutMs: number) => Promise<{ stdout: string; stderr: string; status: number | null }>,
  sleep: (ms: number): Promise<void> => wakeableSleep(ms),
  now: (): number => Date.now(),
  isShuttingDown: (): boolean => isShuttingDown(),
  /** Why downloads cannot run now (folder missing, downloader paused, Video module off), or null. */
  blockedReason: (db: Database.Database): string | null => {
    const folder = getDownloadsDirState().blockedReason;
    if (folder) return folder;
    return isEffectivelyPaused(db, 'downloader_paused', 'video') ? 'The downloader is paused or the Video module is off.' : null;
  },
};

/** The yt-dlp arguments for one video's metadata (no download, no comments). */
export function metadataArgs(videoId: string): string[] {
  return ['--skip-download', '--dump-json', '--no-playlist', '--', `https://www.youtube.com/watch?v=${videoId}`];
}

export function isMetadataBackfillEnabled(db: Database.Database): boolean {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(METADATA_BACKFILL_SETTING) as { value: string } | undefined;
  return row?.value !== '0';
}

export function setMetadataBackfillEnabled(db: Database.Database, enabled: boolean): void {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(METADATA_BACKFILL_SETTING, enabled ? '1' : '0');
  if (!enabled) cancelMetadataBackfill();
}

export function getMetadataBackfillStatus(): MetadataBackfillStatus {
  return { ...status() };
}

export function isMetadataBackfillRunning(): boolean {
  return status().state === 'running';
}

export function getMetadataBackfillCounts(db: Database.Database): MetadataBackfillCounts {
  const row = db.prepare(`
    SELECT COUNT(*) AS total,
           COALESCE(SUM(CASE WHEN metadata_enriched_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS enriched
    FROM videos WHERE download_status = 'completed'
  `).get() as { total: number; enriched: number };
  return { total: row.total, enriched: row.enriched, pending: row.total - row.enriched, enabled: isMetadataBackfillEnabled(db) };
}

function nextVideo(db: Database.Database): { id: string } | undefined {
  // Newest first: those are the ones the home shows.
  return db.prepare(`
    SELECT id FROM videos
    WHERE download_status = 'completed' AND metadata_enriched_at IS NULL
    ORDER BY created_at DESC, id
    LIMIT 1
  `).get() as { id: string } | undefined;
}

function markEnriched(db: Database.Database, videoId: string, categories: string[], tags: string[]): void {
  db.prepare('UPDATE videos SET categories = ?, tags = ?, metadata_enriched_at = ? WHERE id = ?')
    .run(JSON.stringify(categories), JSON.stringify(tags), metadataBackfillDeps.now(), videoId);
}

/** Waits until the next request is allowed (one every METADATA_BACKFILL_INTERVAL_MS, process-wide). */
async function throttle(): Promise<void> {
  // Capped at one interval, so a clock set back never stalls the queue.
  const wait = Math.min(METADATA_BACKFILL_INTERVAL_MS, (_g[G_LAST_REQUEST] as number) + METADATA_BACKFILL_INTERVAL_MS - metadataBackfillDeps.now());
  if (wait > 0) await metadataBackfillDeps.sleep(wait);
}

async function fetchInfo(videoId: string): Promise<any> {
  _g[G_LAST_REQUEST] = metadataBackfillDeps.now();
  const res = await metadataBackfillDeps.runYtdl(metadataArgs(videoId), METADATA_BACKFILL_TIMEOUT_MS);
  if (res.status !== 0) {
    const lastLine = (res.stderr || '').trim().split('\n').pop() || `exit code ${res.status}`;
    throw new Error(lastLine.slice(0, 300));
  }
  return JSON.parse(res.stdout);
}

/**
 * Starts the backfill in the background (the request never waits for yt-dlp).
 * Already running: nothing changes.
 */
export function startMetadataBackfill(db: Database.Database = getDb()):
  { started: true; alreadyRunning: boolean; pending: number } | { started: false; error: string } {
  if (!isMetadataBackfillEnabled(db)) return { started: false, error: 'Video category lookup is turned off.' };
  const pending = getMetadataBackfillCounts(db).pending;
  if (isMetadataBackfillRunning()) return { started: true, alreadyRunning: true, pending };
  if (pending === 0) {
    _g[G_STATUS] = { ...idleStatus(), state: 'done', finishedAt: metadataBackfillDeps.now() } satisfies MetadataBackfillStatus;
    return { started: true, alreadyRunning: false, pending: 0 };
  }
  _g[G_STATUS] = { ...idleStatus(), state: 'running', startedAt: metadataBackfillDeps.now() } satisfies MetadataBackfillStatus;
  _g[G_CANCEL] = false;
  runLoop(db).catch((err) => {
    // runLoop catches everything itself; this is a last resort.
    _g[G_STATUS] = { ...status(), state: 'failed', lastError: err?.message || String(err) };
  });
  return { started: true, alreadyRunning: false, pending };
}

/** Asks the running backfill to stop after the current video. */
export function cancelMetadataBackfill(): boolean {
  if (!isMetadataBackfillRunning()) return false;
  _g[G_CANCEL] = true;
  const wake = _g[G_WAKE] as (() => void) | null | undefined;
  if (wake) wake();
  return true;
}

/** After a delay, starts the backfill when it is on and there is work. */
export function scheduleStartupMetadataBackfill(delayMs: number = STARTUP_METADATA_BACKFILL_DELAY_MS): ReturnType<typeof setTimeout> {
  const timer = setTimeout(() => {
    try {
      const db = getDb();
      if (!isMetadataBackfillEnabled(db) || isMetadataBackfillRunning() || metadataBackfillDeps.isShuttingDown()) return;
      const result = startMetadataBackfill(db);
      if (result.started && result.pending > 0) addLog(`Video categories: looking up ${result.pending} video(s) in the background.`);
    } catch (err) {
      console.error('[metadata-backfill] Could not start the startup run:', err);
    }
  }, delayMs);
  (timer as any).unref?.();
  return timer;
}

function stopRequested(db: Database.Database, s: MetadataBackfillStatus): boolean {
  if (_g[G_CANCEL] || metadataBackfillDeps.isShuttingDown()) {
    s.state = 'cancelled';
    return true;
  }
  if (!isMetadataBackfillEnabled(db)) {
    s.state = 'cancelled';
    s.lastError = 'Video category lookup was turned off.';
    return true;
  }
  return false;
}

async function runLoop(db: Database.Database): Promise<void> {
  // Never do any of the work inside the request that started the run.
  await new Promise((resolve) => setImmediate(resolve));
  const s = status();
  const attempts = new Map<string, number>();
  let consecutiveFailures = 0;
  try {
    while (true) {
      if (stopRequested(db, s)) break;
      const blocked = metadataBackfillDeps.blockedReason(db);
      if (blocked) {
        s.waitingReason = blocked;
        await metadataBackfillDeps.sleep(METADATA_BACKFILL_BLOCKED_POLL_MS);
        continue;
      }
      s.waitingReason = null;

      const video = nextVideo(db);
      if (!video) break;
      if (!VIDEO_ID_RE.test(video.id)) {
        // Not a YouTube id (an import from elsewhere): nothing to look up.
        markEnriched(db, video.id, [], []);
        s.processed++;
        continue;
      }

      await throttle();
      if (stopRequested(db, s)) break;
      try {
        const info = await fetchInfo(video.id);
        markEnriched(db, video.id, sanitizeCategories(info?.categories), sanitizeTags(info?.tags));
        s.processed++;
        s.enriched++;
        consecutiveFailures = 0;
      } catch (err: any) {
        const message = err?.message || String(err);
        s.lastError = message;
        const tries = (attempts.get(video.id) ?? 0) + 1;
        attempts.set(video.id, tries);
        if (tries >= METADATA_BACKFILL_MAX_ATTEMPTS) {
          // Give up on this one so it never blocks the queue.
          markEnriched(db, video.id, [], []);
          s.processed++;
          s.failed++;
          addLog(`Video categories: ${video.id} failed ${tries} times and is skipped: ${message}`);
        }
        consecutiveFailures++;
        const backoff = Math.min(METADATA_BACKFILL_MAX_BACKOFF_MS, METADATA_BACKFILL_INTERVAL_MS * 2 ** consecutiveFailures);
        await metadataBackfillDeps.sleep(backoff);
      }
    }
    if (s.state === 'running') s.state = 'done';
  } catch (err: any) {
    s.state = 'failed';
    s.lastError = err?.message || String(err);
    console.error('[metadata-backfill] The run stopped unexpectedly:', err);
  } finally {
    s.waitingReason = null;
    s.finishedAt = metadataBackfillDeps.now();
    _g[G_CANCEL] = false;
    if (s.state === 'done' && s.processed > 0) {
      addLog(`Video categories: ${s.enriched} video(s) updated, ${s.failed} skipped after errors.`);
    }
  }
}
