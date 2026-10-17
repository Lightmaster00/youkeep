/**
 * Starts work that the caller does not wait for (a sync started by a route, a
 * queue worker woken up). A rejection is logged instead of becoming an
 * unhandled rejection (for example when graceful shutdown closed the database
 * under a running sync). Never throws, also when `task` throws synchronously.
 */
export function runInBackground(label: string, task: Promise<unknown> | (() => unknown)): void {
  const report = (err: unknown) => {
    try {
      console.error(`[background] ${label} failed:`, err);
    } catch {}
  };
  try {
    const result = typeof task === 'function' ? task() : task;
    if (result && typeof (result as Promise<unknown>).then === 'function') {
      (result as Promise<unknown>).then(undefined, report);
    }
  } catch (err) {
    report(err);
  }
}
