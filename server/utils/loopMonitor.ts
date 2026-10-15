import { monitorEventLoopDelay } from 'perf_hooks';

/**
 * Event-loop stall monitor. Everything in this server (HTTP, SQLite, the
 * download workers) shares one thread, so a synchronous stall (e.g. a slow
 * disk fsync) freezes every page. The delay histogram is read every 10 s into
 * a 15-minute ring; a stall over 250 ms is logged (at most every 30 s).
 */
export const LOOP_RESOLUTION_MS = 20;
export const LOOP_SAMPLE_INTERVAL_MS = 10_000;
export const LOOP_WINDOW_MS = 15 * 60_000;
export const LOOP_STALL_THRESHOLD_MS = 250;
export const LOOP_STALL_LOG_INTERVAL_MS = 30_000;

/** What the monitor needs from perf_hooks' histogram (values in nanoseconds). */
export interface DelayHistogram {
  readonly max: number;
  percentile(p: number): number;
  reset(): void;
  enable(): boolean | void;
  disable(): boolean | void;
}

export interface LoopSample { at: number; maxMs: number; p99Ms: number }

export interface LoopSummary {
  current: { maxMs: number; p99Ms: number };
  last15min: { maxMs: number; p99Ms: number; stalls: number };
}

const toMs = (ns: number) => (Number.isFinite(ns) && ns > 0 ? Math.round(ns / 1e5) / 10 : 0);

export function createLoopMonitor(opts: { histogram?: DelayHistogram; now?: () => number; log?: (message: string) => void } = {}) {
  const histogram = opts.histogram ?? monitorEventLoopDelay({ resolution: LOOP_RESOLUTION_MS });
  const now = opts.now ?? Date.now;
  const log = opts.log ?? ((message: string) => console.warn(message));
  const samples: LoopSample[] = [];
  let lastLogAt = Number.NEGATIVE_INFINITY;
  let timer: ReturnType<typeof setInterval> | null = null;

  function sample(): LoopSample {
    const at = now();
    const entry: LoopSample = { at, maxMs: toMs(histogram.max), p99Ms: toMs(histogram.percentile(99)) };
    histogram.reset();
    samples.push(entry);
    while (samples.length && samples[0]!.at <= at - LOOP_WINDOW_MS) samples.shift();
    if (entry.maxMs > LOOP_STALL_THRESHOLD_MS && at - lastLogAt >= LOOP_STALL_LOG_INTERVAL_MS) {
      lastLogAt = at;
      log(`[perf] event loop stalled: max=${entry.maxMs}ms p99=${entry.p99Ms}ms`);
    }
    return entry;
  }

  function summary(): LoopSummary {
    const cutoff = now() - LOOP_WINDOW_MS;
    const recent = samples.filter((s) => s.at > cutoff);
    const latest = recent[recent.length - 1];
    return {
      current: latest ? { maxMs: latest.maxMs, p99Ms: latest.p99Ms } : { maxMs: 0, p99Ms: 0 },
      last15min: {
        maxMs: recent.reduce((m, s) => Math.max(m, s.maxMs), 0),
        p99Ms: recent.reduce((m, s) => Math.max(m, s.p99Ms), 0),
        stalls: recent.filter((s) => s.maxMs > LOOP_STALL_THRESHOLD_MS).length,
      },
    };
  }

  function start(): void {
    if (timer) return;
    histogram.enable();
    timer = setInterval(sample, LOOP_SAMPLE_INTERVAL_MS);
    (timer as any).unref?.();
  }

  function stop(): void {
    if (timer) clearInterval(timer);
    timer = null;
    histogram.disable();
  }

  return { sample, summary, start, stop, samples: () => samples.slice() };
}

export type LoopMonitor = ReturnType<typeof createLoopMonitor>;

// One monitor per server process (kept on globalThis so a dev reload does not start a second one).
const G_MONITOR = Symbol.for('youkeep.loopMonitor');

export function getLoopMonitor(): LoopMonitor {
  const g = globalThis as any;
  if (!g[G_MONITOR]) g[G_MONITOR] = createLoopMonitor();
  return g[G_MONITOR];
}
