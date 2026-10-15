import { describe, it, expect, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';

// ffmpeg is never run: spawn returns a fake process the test drives.
const spawned: { cmd: string; args: string[]; child: any }[] = [];
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    spawn: (cmd: string, args: string[]) => {
      const child: any = new EventEmitter();
      child.kill = vi.fn();
      spawned.push({ cmd, args, child });
      return child;
    },
  };
});

import { thumbnailDeps, THUMB_FFMPEG_TIMEOUT_MS } from '../../server/utils/thumbnails';

afterEach(() => {
  vi.useRealTimers();
  spawned.length = 0;
});

describe('the default ffmpeg runner', () => {
  it('resolves on exit 0 and rejects on another exit code', async () => {
    const ok = thumbnailDeps.runFfmpeg(['-i', 'a.jpg', 'b.jpg'], 1000);
    expect(spawned[0]!.cmd).toBe('ffmpeg');
    spawned[0]!.child.emit('close', 0);
    await expect(ok).resolves.toBeUndefined();

    const bad = thumbnailDeps.runFfmpeg(['-i', 'a.jpg', 'b.jpg'], 1000);
    spawned[1]!.child.emit('close', 1);
    await expect(bad).rejects.toThrow('code 1');
  });

  it('kills ffmpeg and fails after the 10 second timeout', async () => {
    vi.useFakeTimers();
    expect(THUMB_FFMPEG_TIMEOUT_MS).toBe(10_000);
    const run = thumbnailDeps.runFfmpeg(['-i', 'a.jpg', 'b.jpg'], THUMB_FFMPEG_TIMEOUT_MS);
    const settled = vi.fn();
    run.catch(settled);
    vi.advanceTimersByTime(9_999);
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    await expect(run).rejects.toThrow('timed out');
    expect(spawned[0]!.child.kill).toHaveBeenCalledWith('SIGKILL');
  });
});
