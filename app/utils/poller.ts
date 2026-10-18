// A self re-arming poll loop that can be stopped for good. The usual
// `await task(); setTimeout(run, ms)` re-arms even when the component was
// unmounted while the request was in flight, leaving an orphan loop that
// polls forever from whatever page comes next.
//
// While the browser tab is hidden the loop pauses (no request at all) and
// runs again as soon as the tab is visible.
export interface Poller {
  start(): void;
  stop(): void;
}

const isHidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';

/** nextDelay returns the wait before the next run in ms, or null to stop. */
export function createPoller(task: () => Promise<unknown>, nextDelay: () => number | null): Poller {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = true;
  let pausedForHidden = false;

  async function run() {
    timer = null;
    if (stopped) return;
    if (isHidden()) {
      pausedForHidden = true;
      return;
    }
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

  function onVisibilityChange() {
    if (stopped || !pausedForHidden || isHidden()) return;
    pausedForHidden = false;
    run();
  }

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      pausedForHidden = false;
      if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibilityChange);
      run();
    },
    stop() {
      stopped = true;
      pausedForHidden = false;
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibilityChange);
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
