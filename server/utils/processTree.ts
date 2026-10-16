import { spawn, type ChildProcess, type SpawnOptions } from 'child_process';

/**
 * Child processes (yt-dlp, ffmpeg, ffprobe) run in their own process group
 * on POSIX systems, so killing one also kills what it started itself (yt-dlp
 * runs ffmpeg to merge formats): `process.kill(-pid)` signals the whole
 * group. Windows has no process groups; there the child alone is killed.
 */
const USE_GROUPS = process.platform !== 'win32';

/** spawn() with the child as the leader of a new process group (POSIX). */
export function spawnInGroup(command: string, args: string[], options: SpawnOptions = {}): ChildProcess {
  return spawn(command, args, { ...options, detached: USE_GROUPS });
}

// Every child started through trackChild, so shutdown can kill them all.
const G_CHILDREN = Symbol.for('YouKeep.trackedChildProcesses');
const _g = globalThis as any;
if (!(_g[G_CHILDREN] instanceof Set)) _g[G_CHILDREN] = new Set<ChildProcess>();
const trackedChildren: Set<ChildProcess> = _g[G_CHILDREN];

/** Remembers `child` until it exits, so killAllTrackedChildren can reach it. */
export function trackChild<T extends ChildProcess>(child: T): T {
  trackedChildren.add(child);
  const forget = () => trackedChildren.delete(child);
  child.once('exit', forget);
  child.once('error', forget);
  return child;
}

/** How many tracked children are still running. */
export function trackedChildCount(): number {
  return trackedChildren.size;
}

/**
 * Kills `child` and every process of its group (when it was started with
 * spawnInGroup). Never throws; a child that already exited is ignored.
 */
export function killProcessTree(child: ChildProcess | null | undefined, signal: NodeJS.Signals = 'SIGKILL'): void {
  if (!child) return;
  const pid = child.pid;
  if (USE_GROUPS && pid && pid > 0) {
    try {
      process.kill(-pid, signal);
      return;
    } catch {
      // Not a group leader (spawned without spawnInGroup) or already gone.
    }
  }
  try { child.kill(signal); } catch {}
}

/** Kills every tracked child process (shutdown). Returns how many were signalled. */
export function killAllTrackedChildren(): number {
  let count = 0;
  for (const child of [...trackedChildren]) {
    if (child.exitCode === null && child.signalCode === null) {
      killProcessTree(child);
      count++;
    }
    trackedChildren.delete(child);
  }
  return count;
}
