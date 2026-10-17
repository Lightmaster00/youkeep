// Service worker registration and cache cleanup (see public/sw.js).

export function serviceWorkerUrl(buildId: string): string {
  return `/sw.js?v=${encodeURIComponent(buildId || 'dev')}`;
}

/**
 * Drops every Cache Storage entry of this origin: asks the active service
 * worker to do it, and deletes them from the page as well in case there is no
 * worker (or it is outdated). Never throws.
 */
export async function clearClientCaches(): Promise<void> {
  try {
    navigator.serviceWorker?.controller?.postMessage({ type: 'clear-caches' });
  } catch {
    // No worker or not allowed: the direct cleanup below still runs.
  }
  try {
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
  } catch {
    // Cache Storage unavailable (insecure context, private mode).
  }
}
