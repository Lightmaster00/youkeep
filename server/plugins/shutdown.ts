import { defineNitroPlugin } from 'nitropack/dist/runtime/plugin';
import { gracefulShutdown, installFatalListenErrorHandler } from '../utils/shutdown';

/**
 * Graceful shutdown: Nitro's own SIGTERM/SIGINT handling (node-server preset)
 * calls the 'close' hook, which stops the workers, kills yt-dlp/ffmpeg process
 * groups, flushes progress and closes the database. When nothing else handles
 * the signal (shutdown handling disabled, dev server), this plugin does it and
 * exits itself. gracefulShutdown is idempotent.
 */
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('close', () => gracefulShutdown());

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      // Another listener (Nitro's graceful shutdown) exits the process after the close hook.
      if (process.listenerCount(signal) > 0) return;
      gracefulShutdown()
        .catch((err) => console.error('[shutdown] failed:', err))
        .finally(() => process.exit(0));
    });
  }

  installFatalListenErrorHandler();
});
