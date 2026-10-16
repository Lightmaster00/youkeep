/** Longest the queue workers wait for the startup yt-dlp update before starting anyway. */
export const STARTUP_UPDATE_GUARD_MS = 150_000;

/**
 * Runs `start` exactly once: when `update` settles (success or failure), or
 * after `guardMs` if it hangs. A slow, failing or hanging `yt-dlp -U` never
 * keeps the download queues from starting.
 */
export function startAfterUpdate(update: () => Promise<unknown>, start: () => void, guardMs: number = STARTUP_UPDATE_GUARD_MS, log: (msg: string) => void = console.log): void {
  let started = false;
  const once = (reason: string) => {
    if (started) return;
    started = true;
    clearTimeout(guard);
    log(`YouKeep Scheduler Plugin: ${reason}. Starting the queue workers...`);
    try { start(); } catch (err) { console.error('YouKeep Scheduler Plugin: could not start the queue workers:', err); }
  };
  const guard = setTimeout(() => once(`yt-dlp update still running after ${Math.round(guardMs / 1000)} s`), guardMs);
  (guard as any).unref?.();
  let pending: Promise<unknown>;
  try {
    pending = Promise.resolve(update());
  } catch (err) {
    pending = Promise.reject(err);
  }
  pending.then(
    () => once('yt-dlp check/update completed'),
    (err) => { console.error('YouKeep Scheduler Plugin: yt-dlp auto-update check failed:', err); once('yt-dlp update failed'); },
  );
}
