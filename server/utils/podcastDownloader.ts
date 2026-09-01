import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import Parser from 'rss-parser';
import { Cron } from 'croner';
import { getDb } from './db';
import { addLog, sanitizeFolderName, isDirWritable } from './downloader';
import { parseMaxConcurrentDownloads, hasCapacityForMoreDownloads, hasEnoughDiskSpace, resetStaleDownloadsForTable, runSyncAllEntities } from './concurrency';

// Define global-backed state to survive development HMR module hot reloads,
// same pattern as downloader.ts's and musicDownloader.ts's own worker state.
const _g = globalThis as any;
const G_PODCAST_PROCESSING = Symbol.for('YouKeep.isPodcastProcessing');
const G_PODCAST_SHOULD_RUN = Symbol.for('YouKeep.podcastWorkerShouldRun');
const G_PODCAST_ACTIVE_DOWNLOAD_COUNT = Symbol.for('YouKeep.activePodcastDownloadCount');
// No G_PODCAST_PROCESSES map of child processes — RSS ingestion has no yt-dlp
// child process to track. Downloads are cancelled via AbortController.abort()
// instead of child.kill(), so this tracks controllers instead.
const G_PODCAST_ABORT_CONTROLLERS = Symbol.for('YouKeep.activePodcastAbortControllers');
const G_PODCAST_DOWNLOAD_START_TIMES = Symbol.for('YouKeep.activePodcastDownloadStartTimes');
// Deliberately a SEPARATE symbol from downloader.ts's G_CRON and
// musicDownloader.ts's G_MUSIC_CRON — the video, music, and podcast cron
// jobs must be independently startable/stoppable, never sharing a handle.
const G_PODCAST_CRON = Symbol.for('YouKeep.activePodcastCronJob');

if (!(G_PODCAST_PROCESSING in _g)) _g[G_PODCAST_PROCESSING] = false;
if (!(G_PODCAST_SHOULD_RUN in _g)) _g[G_PODCAST_SHOULD_RUN] = false;
if (!(G_PODCAST_ACTIVE_DOWNLOAD_COUNT in _g)) _g[G_PODCAST_ACTIVE_DOWNLOAD_COUNT] = 0;
if (!(G_PODCAST_ABORT_CONTROLLERS in _g)) _g[G_PODCAST_ABORT_CONTROLLERS] = new Map<string, AbortController>();
if (!(G_PODCAST_DOWNLOAD_START_TIMES in _g)) _g[G_PODCAST_DOWNLOAD_START_TIMES] = new Map<string, number>();
if (!(G_PODCAST_CRON in _g)) _g[G_PODCAST_CRON] = null;

function getActivePodcastCronJob(): Cron | null { return _g[G_PODCAST_CRON]; }
function setActivePodcastCronJob(val: Cron | null) { _g[G_PODCAST_CRON] = val; }

function getIsPodcastProcessing(): boolean { return _g[G_PODCAST_PROCESSING]; }
function setIsPodcastProcessing(val: boolean) { _g[G_PODCAST_PROCESSING] = val; }
function getPodcastWorkerShouldRun(): boolean { return _g[G_PODCAST_SHOULD_RUN]; }
function setPodcastWorkerShouldRun(val: boolean) { _g[G_PODCAST_SHOULD_RUN] = val; }
export function getActivePodcastDownloadCount(): number { return _g[G_PODCAST_ACTIVE_DOWNLOAD_COUNT]; }
function incrementActivePodcastDownloadCount() { _g[G_PODCAST_ACTIVE_DOWNLOAD_COUNT]++; }
function decrementActivePodcastDownloadCount() { _g[G_PODCAST_ACTIVE_DOWNLOAD_COUNT] = Math.max(0, _g[G_PODCAST_ACTIVE_DOWNLOAD_COUNT] - 1); }

let podcastWorkerWakeResolver: (() => void) | null = null;

function sleepOrWakeablePodcast(ms: number) {
  return new Promise<void>(resolve => {
    let timeoutId: any = null;
    const cleanResolve = () => {
      if (timeoutId) clearTimeout(timeoutId);
      podcastWorkerWakeResolver = null;
      resolve();
    };
    podcastWorkerWakeResolver = cleanResolve;
    timeoutId = setTimeout(cleanResolve, ms);
  });
}

export function wakePodcastWorker() {
  if (podcastWorkerWakeResolver) {
    podcastWorkerWakeResolver();
  }
}

// Maximum time (ms) a single episode download is allowed to run before being
// aborted. Duplicated from downloader.ts's/musicDownloader.ts's own constant
// of the same value (not exported by either) rather than importing it — this
// is a constant, not logic, so the duplication is cheap and avoids coupling
// this file to an unrelated module's internals.
const PODCAST_DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

export const activePodcastAbortControllers: Map<string, AbortController> = _g[G_PODCAST_ABORT_CONTROLLERS];
export const activePodcastDownloadStartTimes: Map<string, number> = _g[G_PODCAST_DOWNLOAD_START_TIMES];

export function getPodcastDownloadsDir(): string {
  const defaultPath = '/downloads/podcasts';
  if (isDirWritable(defaultPath)) {
    return defaultPath;
  }

  const localFallback = path.resolve(process.cwd(), 'data/downloads-podcasts');
  try { fs.mkdirSync(localFallback, { recursive: true }); } catch (err) {}
  return localFallback;
}

export function cleanupPartialPodcastFiles(episodeId: string, showId: string, opts: { newerThan?: number } = {}): void {
  const db = getDb();
  const show = db.prepare('SELECT title FROM podcast_shows WHERE id = ?').get(showId) as { title: string } | undefined;
  const basePath = getPodcastDownloadsDir();
  const showDir = path.join(basePath, sanitizeFolderName(show?.title || showId));

  if (!fs.existsSync(showDir)) return;

  const prefix = `${episodeId}.`;
  let entries: string[];
  try {
    entries = fs.readdirSync(showDir);
  } catch (e) {
    return;
  }

  for (const entry of entries) {
    if (!entry.startsWith(prefix)) continue;
    const fullPath = path.join(showDir, entry);
    if (opts.newerThan !== undefined) {
      // A file that predates this download attempt is a previously-completed
      // file, not a partial artifact of the attempt being aborted — leave it alone.
      try {
        if (fs.statSync(fullPath).mtimeMs < opts.newerThan) continue;
      } catch (e) {
        continue;
      }
    }
    try { fs.unlinkSync(fullPath); } catch (e) {}
  }
}
