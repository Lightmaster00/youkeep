import { describe, it, expect, vi } from 'vitest';
import { createLoopMonitor, LOOP_SAMPLE_INTERVAL_MS, type DelayHistogram } from '../../server/utils/loopMonitor';

// A histogram whose next readings the test sets (milliseconds in, nanoseconds out).
function fakeHistogram() {
  let maxMs = 0;
  let p99Ms = 0;
  const h: DelayHistogram & { set(max: number, p99: number): void; resets: number; enabled: boolean } = {
    get max() { return maxMs * 1e6; },
    percentile: (p: number) => (p === 99 ? p99Ms * 1e6 : 0),
    reset() { maxMs = 0; p99Ms = 0; h.resets++; },
    enable() { h.enabled = true; },
    disable() { h.enabled = false; },
    set(max: number, p99: number) { maxMs = max; p99Ms = p99; },
    resets: 0,
    enabled: false,
  };
  return h;
}

function setup() {
  let t = 1_000_000;
  const histogram = fakeHistogram();
  const log = vi.fn();
  const monitor = createLoopMonitor({ histogram, now: () => t, log });
  const step = (maxMs: number, p99Ms = maxMs / 2) => { t += LOOP_SAMPLE_INTERVAL_MS; histogram.set(maxMs, p99Ms); return monitor.sample(); };
  return { monitor, histogram, log, step, advance: (ms: number) => { t += ms; } };
}

describe('event loop monitor', () => {
  it('samples in milliseconds and resets the histogram each time', () => {
    const { monitor, histogram, step } = setup();
    expect(step(42.26, 21.04)).toMatchObject({ maxMs: 42.3, p99Ms: 21 });
    expect(histogram.resets).toBe(1);
    expect(monitor.summary().current).toEqual({ maxMs: 42.3, p99Ms: 21 });
  });

  it('keeps a 15-minute ring: older samples drop out of the summary', () => {
    const { monitor, step } = setup();
    step(900, 400); // a stall
    for (let i = 0; i < 89; i++) step(10, 5); // 89 more samples: 15 min = 90 samples
    expect(monitor.samples()).toHaveLength(90);
    expect(monitor.summary().last15min).toEqual({ maxMs: 900, p99Ms: 400, stalls: 1 });
    step(12, 6); // the stall is now older than 15 minutes
    expect(monitor.samples()).toHaveLength(90);
    expect(monitor.summary().last15min).toEqual({ maxMs: 12, p99Ms: 6, stalls: 0 });
  });

  it('counts stalls over 250 ms and logs at most once per 30 s', () => {
    const { monitor, log, step } = setup();
    step(250);
    expect(log).not.toHaveBeenCalled();
    step(251, 120);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenLastCalledWith('[perf] event loop stalled: max=251ms p99=120ms');
    step(600); // 10 s later
    step(700); // 20 s later
    expect(log).toHaveBeenCalledTimes(1);
    step(800); // 30 s later
    expect(log).toHaveBeenCalledTimes(2);
    expect(monitor.summary().last15min.stalls).toBe(4);
  });

  it('reports zeros before the first sample and once every sample is stale', () => {
    const { monitor, step, advance } = setup();
    expect(monitor.summary()).toEqual({ current: { maxMs: 0, p99Ms: 0 }, last15min: { maxMs: 0, p99Ms: 0, stalls: 0 } });
    step(300);
    advance(16 * 60_000);
    expect(monitor.summary()).toEqual({ current: { maxMs: 0, p99Ms: 0 }, last15min: { maxMs: 0, p99Ms: 0, stalls: 0 } });
  });

  it('start enables the histogram and samples every 10 s; stop ends it', () => {
    vi.useFakeTimers();
    try {
      const histogram = fakeHistogram();
      const monitor = createLoopMonitor({ histogram, log: () => {} });
      monitor.start();
      expect(histogram.enabled).toBe(true);
      vi.advanceTimersByTime(LOOP_SAMPLE_INTERVAL_MS * 3);
      expect(monitor.samples()).toHaveLength(3);
      monitor.stop();
      vi.advanceTimersByTime(LOOP_SAMPLE_INTERVAL_MS * 3);
      expect(monitor.samples()).toHaveLength(3);
      expect(histogram.enabled).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('works with the real perf_hooks histogram', () => {
    const monitor = createLoopMonitor({ log: () => {} });
    monitor.start();
    const s = monitor.sample();
    monitor.stop();
    expect(s.maxMs).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(s.p99Ms)).toBe(true);
  });
});
