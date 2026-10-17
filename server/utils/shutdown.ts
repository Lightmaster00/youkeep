import type Database from 'better-sqlite3';
import { getDb } from './db';
import { activeProcesses, activeCommentProcesses, stopScheduler, stopVideoWorkerNow } from './downloader';
import { activeMusicProcesses, stopMusicScheduler, stopMusicWorkerNow } from './musicDownloader';
import { abortAllPodcastDownloads, stopPodcastScheduler, stopPodcastWorkerNow } from './podcastDownloader';
import { stopAllProgressWriters } from './progressWriter';
import { stopThumbCacheSweep } from './thumbnails';
import { isShuttingDown, killAllTrackedChildren, killProcessTree, markShuttingDown } from './processTree';

/**
 * Stops everything the server started, in an order that loses nothing:
 * 1. no new work: workers told to stop, cron jobs and the cache sweep stopped;
 * 2. running downloads ended: yt-dlp/ffmpeg process groups killed, podcast
 *    fetches aborted. Their rows stay 'downloading' and their partial files
 *    stay; the next start resets them to 'pending' and resumes;
 * 3. throttled progress flushed;
 * 4. the database checkpointed (WAL folded back) and closed.
 * Idempotent: a second call (Nitro's close hook after a signal) does nothing.
 */
export async function gracefulShutdown(deps: { getDb?: () => Database.Database; log?: (msg: string) => void } = {}): Promise<void> {
  if (isShuttingDown()) return;
  markShuttingDown();
  const log = deps.log ?? ((msg: string) => console.log(`[shutdown] ${msg}`));
  const step = (label: string, fn: () => void) => {
    try { fn(); } catch (err) { console.error(`[shutdown] ${label} failed:`, err); }
  };

  step('stopping workers', () => { stopVideoWorkerNow(); stopMusicWorkerNow(); stopPodcastWorkerNow(); });
  step('stopping cron jobs', () => { stopScheduler(); stopMusicScheduler(); stopPodcastScheduler(); stopThumbCacheSweep(); });

  let killed = 0;
  step('killing downloads', () => {
    for (const map of [activeProcesses, activeCommentProcesses, activeMusicProcesses]) {
      for (const [id, child] of [...map]) {
        killProcessTree(child);
        map.delete(id);
        killed++;
      }
    }
    killed += abortAllPodcastDownloads();
    killed += killAllTrackedChildren();
  });
  if (killed > 0) log(`Stopped ${killed} running process(es) and download(s).`);

  step('flushing progress', () => { stopAllProgressWriters(); });
  // Let the killed processes' exit handlers run while the database is still open.
  await new Promise((resolve) => setTimeout(resolve, 50));

  // A child that a loop started in the window above (it raced the flag) is
  // killed too, before the database closes under its handlers.
  step('killing late processes', () => {
    const late = killAllTrackedChildren();
    if (late > 0) log(`Stopped ${late} process(es) started during shutdown.`);
  });

  step('closing the database', () => {
    const db = (deps.getDb ?? getDb)();
    if (!db.open) return;
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.close();
    log('Database checkpointed and closed.');
  });
}

/** True for an error that means the HTTP server could not listen (port taken, no permission). */
export function isFatalListenError(err: any): boolean {
  return !!err && (err.syscall === 'listen' || err.code === 'EADDRINUSE');
}

/**
 * Exits with code 1 on a listen error. Nitro traps uncaught exceptions and
 * only logs them, so a taken port would otherwise leave the download workers
 * running behind a server that serves nothing.
 */
export function installFatalListenErrorHandler(exit: (code: number) => void = (code) => process.exit(code)): (err: any) => void {
  const handler = (err: any) => {
    if (!isFatalListenError(err)) return;
    console.error(`YouKeep: the server could not listen (${err.code || 'error'}: ${err.message || err}). Exiting.`);
    exit(1);
  };
  process.on('uncaughtException', handler);
  return handler;
}
