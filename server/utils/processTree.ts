import { spawn, type ChildProcess, type SpawnOptions } from 'child_process';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';

/**
 * Child processes (yt-dlp, ffmpeg, ffprobe) run in their own process group
 * on POSIX systems, so killing one also kills what it started itself (yt-dlp
 * runs ffmpeg to merge formats): `process.kill(-pid)` signals the whole
 * group. Windows has no process groups; there the child alone is killed.
 */
const USE_GROUPS = process.platform !== 'win32';

/**
 * A child that never started: it reports an 'error' (code ESHUTDOWN) then a
 * 'close', like a spawn() that failed, so every caller's usual failure path runs.
 */
function refusedChild(command: string): ChildProcess {
  const child: any = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = null;
  child.pid = undefined;
  child.exitCode = null;
  child.signalCode = null;
  child.killed = false;
  child.kill = () => false;
  setImmediate(() => {
    const err: NodeJS.ErrnoException = new Error(`Not starting ${command}: the server is shutting down.`);
    err.code = 'ESHUTDOWN';
    child.emit('error', err);
    child.stdout.end();
    child.stderr.end();
    child.exitCode = 1;
    child.emit('exit', 1, null);
    child.emit('close', 1, null);
  });
  return child as ChildProcess;
}

/**
 * spawn() with the child as the leader of a new process group (POSIX). Once
 * the server is shutting down nothing is started: such a child would outlive
 * the server (its own process group does not die with it).
 */
export function spawnInGroup(command: string, args: string[], options: SpawnOptions = {}): ChildProcess {
  if (isShuttingDown()) return refusedChild(command);
  return spawn(command, args, { ...options, detached: USE_GROUPS });
}

// Every child started through trackChild, so shutdown can kill them all.
const G_CHILDREN = Symbol.for('YouKeep.trackedChildProcesses');
const _g = globalThis as any;
if (!(_g[G_CHILDREN] instanceof Set)) _g[G_CHILDREN] = new Set<ChildProcess>();
const trackedChildren: Set<ChildProcess> = _g[G_CHILDREN];

/** Remembers `child` until it exits, so killAllTrackedChildren can reach it. */
export function trackChild<T extends ChildProcess>(child: T): T {
  // Shutdown already killed the tracked children: a late one is killed at once.
  if (isShuttingDown()) {
    killProcessTree(child);
    return child;
  }
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

// Set once the server is shutting down: a download killed by the shutdown is
// not recorded as a failed attempt (it resumes, as 'pending', after a restart).
const G_SHUTTING_DOWN = Symbol.for('YouKeep.shuttingDown');
if (typeof _g[G_SHUTTING_DOWN] !== 'boolean') _g[G_SHUTTING_DOWN] = false;

export function isShuttingDown(): boolean {
  return _g[G_SHUTTING_DOWN];
}

export function markShuttingDown(value = true): void {
  _g[G_SHUTTING_DOWN] = value;
}

/**
 * Makes `child`'s stdout and stderr emit UTF-8 strings decoded across chunk
 * boundaries (a StringDecoder): `data.toString()` per chunk turned a
 * multi-byte character split between two 64 KB chunks into U+FFFD, corrupting
 * titles in yt-dlp's JSON. Ignores streams without setEncoding (test fakes).
 */
export function decodeChildOutput<T extends { stdout?: any; stderr?: any }>(child: T): T {
  for (const stream of [child.stdout, child.stderr]) {
    if (stream && typeof stream.setEncoding === 'function') stream.setEncoding('utf8');
  }
  return child;
}
