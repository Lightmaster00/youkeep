// A self re-arming poll loop that can be stopped for good. The usual
// `await task(); setTimeout(run, ms)` re-arms even when the component was
// unmounted while the request was in flight, leaving an orphan loop that
// polls forever from whatever page comes next.
export interface Poller {
  start(): void;
  stop(): void;
}

/** nextDelay returns the wait before the next run in ms, or null to stop. */
export function createPoller(task: () => Promise<unknown>, nextDelay: () => number | null): Poller {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = true;

  async function run() {
    timer = null;
    if (stopped) return;
    try {
      await task();
    } catch {
      // A failed poll is retried on the next tick.
    }
    if (stopped) return;
    const delay = nextDelay();
    if (delay === null) return;
    timer = setTimeout(run, delay);
  }

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      run();
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
