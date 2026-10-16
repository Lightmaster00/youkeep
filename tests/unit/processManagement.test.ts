import { describe, it, expect, vi, afterEach } from 'vitest';
import net from 'net';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runProcessAsync, DEFAULT_PROCESS_TIMEOUT_MS } from '../../server/utils/downloader';
import { killProcessTree, spawnInGroup, trackChild, killAllTrackedChildren, trackedChildCount } from '../../server/utils/processTree';
import { startAfterUpdate } from '../../server/utils/startup';
import { isFatalListenError, installFatalListenErrorHandler } from '../../server/utils/shutdown';
import { workerErrorBackoffMs } from '../../server/utils/concurrency';

const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(process.platform === 'win32')('process groups', () => {
  it('a timed-out runProcessAsync kills the grandchildren too (yt-dlp -> ffmpeg)', async () => {
    const pidFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'yk-pg-')), 'pid');
    const run = runProcessAsync('/bin/sh', ['-c', `sleep 30 & echo $! > '${pidFile}'; wait`], process.env, undefined, 300);
    await expect(run).rejects.toThrow(/Timed out after/);
    const timedOutGrandchild = Number(fs.readFileSync(pidFile, 'utf8').trim());
    await vi.waitFor(() => expect(alive(timedOutGrandchild)).toBe(false), { timeout: 3000 });

    // The same through killProcessTree directly (what the download watchdog and cancel use).
    let grandchild = 0;
    const child = trackChild(spawnInGroup('/bin/sh', ['-c', 'sleep 30 & echo $!; wait']));
    grandchild = await new Promise<number>((resolve) => child.stdout!.once('data', (d) => resolve(Number(String(d).trim()))));
    expect(alive(grandchild)).toBe(true);
    killProcessTree(child);
    await vi.waitFor(() => expect(alive(grandchild)).toBe(false), { timeout: 3000 });
  });

  it('every call has a time limit, and shutdown kills every tracked child', async () => {
    expect(DEFAULT_PROCESS_TIMEOUT_MS).toBeGreaterThan(0);
    const child = trackChild(spawnInGroup('/bin/sleep', ['30']));
    await sleep(50);
    expect(trackedChildCount()).toBeGreaterThan(0);
    expect(killAllTrackedChildren()).toBeGreaterThanOrEqual(1);
    await vi.waitFor(() => expect(alive(child.pid!)).toBe(false), { timeout: 3000 });
  });
});

describe('startup never waits forever for yt-dlp -U', () => {
  afterEach(() => vi.useRealTimers());
  it('starts the workers once after a hanging update, after a failure, and after a success', async () => {
    vi.useFakeTimers();
    const log = () => {};
    const hanging = vi.fn();
    startAfterUpdate(() => new Promise(() => {}), hanging, 1000, log);
    vi.advanceTimersByTime(999);
    expect(hanging).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(hanging).toHaveBeenCalledTimes(1);

    vi.spyOn(console, 'error').mockImplementation(() => {});
    const failed = vi.fn();
    startAfterUpdate(() => Promise.reject(new Error('no network')), failed, 1000, log);
    await vi.advanceTimersByTimeAsync(0);
    expect(failed).toHaveBeenCalledTimes(1);
    const thrown = vi.fn();
    startAfterUpdate(() => { throw new Error('sync throw'); }, thrown, 1000, log);
    await vi.advanceTimersByTimeAsync(0);
    expect(thrown).toHaveBeenCalledTimes(1);

    const ok = vi.fn();
    startAfterUpdate(() => Promise.resolve('up to date'), ok, 1000, log);
    await vi.advanceTimersByTimeAsync(5000);
    expect(ok).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });
});

describe('a listen error ends the process', () => {
  it('recognises EADDRINUSE from a real taken port and exits with code 1', async () => {
    const first = net.createServer();
    await new Promise<void>((r) => first.listen(0, '127.0.0.1', () => r()));
    const port = (first.address() as net.AddressInfo).port;
    const second = net.createServer();
    const err = await new Promise<any>((resolve) => { second.once('error', resolve); second.listen(port, '127.0.0.1'); });
    await new Promise<void>((r) => first.close(() => r()));
    expect(isFatalListenError(err)).toBe(true);
    expect(isFatalListenError(new Error('other'))).toBe(false);

    const exit = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const handler = installFatalListenErrorHandler(exit);
    try {
      handler(new Error('unrelated'));
      expect(exit).not.toHaveBeenCalled();
      handler(err);
      expect(exit).toHaveBeenCalledWith(1);
    } finally {
      process.off('uncaughtException', handler);
      vi.restoreAllMocks();
    }
  });
});

describe('queue worker error backoff', () => {
  it('doubles from 5 s up to 60 s and never gives up', () => {
    expect([1, 2, 3, 4, 5, 6, 50].map(workerErrorBackoffMs)).toEqual([5000, 10000, 20000, 40000, 60000, 60000, 60000]);
  });
});
