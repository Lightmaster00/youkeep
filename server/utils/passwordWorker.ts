import { Worker } from 'node:worker_threads';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';

// bcrypt is deliberately slow (~50 ms per hash at cost 10) and bcryptjs is
// pure JavaScript. Its async API yields only between ~100 ms chunks, and a
// whole cost-10 hash fits in one chunk: 8 parallel logins froze the event
// loop for ~420 ms, and even one at a time every HTTP request waited a hash
// per loop turn (150-230 ms for a health check). So the hashing runs in a
// worker thread, off the main event loop. If the worker cannot start, it
// falls back to the async API in this thread, one hash at a time.

const WORKER_SOURCE = `
import { parentPort, workerData } from 'node:worker_threads';
const bcrypt = (await import(workerData.bcryptUrl)).default;
parentPort.on('message', async (msg) => {
  try {
    const result = msg.op === 'hash'
      ? await bcrypt.hash(msg.password, msg.rounds)
      : await bcrypt.compare(msg.password, msg.hash);
    parentPort.postMessage({ id: msg.id, result });
  } catch (err) {
    parentPort.postMessage({ id: msg.id, error: String((err && err.message) || err) });
  }
});
`;

type Pending = { resolve: (value: any) => void; reject: (err: Error) => void };

let worker: Worker | null = null;
let workerDisabled = false;
let nextId = 1;
const pending = new Map<number, Pending>();

// bcryptjs's ESM entry, found by walking up to the nearest node_modules (the
// project's in development and tests, .output/server/node_modules in a build).
function findBcryptEntry(): string | null {
  const starts = [path.dirname(fileURLToPath(import.meta.url)), process.cwd()];
  for (const start of starts) {
    let dir = start;
    for (;;) {
      const candidate = path.join(dir, 'node_modules', 'bcryptjs', 'index.js');
      if (fs.existsSync(candidate)) return candidate;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return null;
}

/** The worker died (crash, exit) before answering: not an answer about the password. */
class WorkerFailure extends Error {}

function failAll(cause: Error) {
  const err = new WorkerFailure(cause.message);
  for (const p of pending.values()) p.reject(err);
  pending.clear();
}

function getWorker(): Worker | null {
  if (workerDisabled) return null;
  if (worker) return worker;
  const entry = findBcryptEntry();
  if (!entry) {
    workerDisabled = true;
    return null;
  }
  try {
    const w = new Worker(new URL(`data:text/javascript,${encodeURIComponent(WORKER_SOURCE)}`), {
      workerData: { bcryptUrl: pathToFileURL(entry).href }
    });
    w.unref();
    w.on('message', (msg: { id: number; result?: unknown; error?: string }) => {
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.error !== undefined) p.reject(new Error(msg.error));
      else p.resolve(msg.result);
    });
    w.on('error', (err) => {
      console.error('YouKeep: password hashing worker failed, falling back to the main thread:', err);
      workerDisabled = true;
      worker = null;
      failAll(err instanceof Error ? err : new Error(String(err)));
    });
    w.on('exit', () => {
      if (worker === w) worker = null;
      failAll(new Error('Password hashing worker exited.'));
    });
    worker = w;
    return w;
  } catch (err) {
    console.error('YouKeep: could not start the password hashing worker:', err);
    workerDisabled = true;
    return null;
  }
}

// Fallback: bcryptjs's async API, one operation at a time so concurrent
// logins do not run their chunks back to back.
let inlineQueue: Promise<unknown> = Promise.resolve();
function runInline<T>(task: () => Promise<T>): Promise<T> {
  const run = inlineQueue.then(task, task);
  inlineQueue = run.catch(() => undefined);
  return run;
}

function runInWorker<T>(message: Record<string, unknown>, inline: () => Promise<T>): Promise<T> {
  const w = getWorker();
  if (!w) return runInline(inline);
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.ref(); // keep the process alive while an answer is pending
    w.postMessage({ id, ...message });
  }).finally(() => {
    if (pending.size === 0) worker?.unref();
  }).catch((err) => {
    // A crash is not an answer: retry once in this thread, so a correct
    // password is never reported wrong (nor a hash a 500) because of it.
    // An error bcrypt itself reported (a malformed hash) is not retried.
    if (err instanceof WorkerFailure) return runInline(inline);
    throw err;
  });
}

export function bcryptHash(password: string, rounds: number): Promise<string> {
  return runInWorker({ op: 'hash', password, rounds }, () => bcrypt.hash(password, rounds));
}

export function bcryptCompare(password: string, hash: string): Promise<boolean> {
  return runInWorker({ op: 'compare', password, hash }, () => bcrypt.compare(password, hash));
}

/** Tests: force the in-thread fallback (true) or allow the worker again (false). */
export function setPasswordWorkerDisabledForTests(disabled: boolean): void {
  workerDisabled = disabled;
  if (disabled && worker) {
    void worker.terminate();
    worker = null;
  }
}

/** Tests: simulate a worker crash (it exits with requests pending). */
export function crashPasswordWorkerForTests(): void {
  if (worker) void worker.terminate();
}

/** True when hashing currently runs in the worker thread. */
export function isPasswordWorkerActive(): boolean {
  return worker !== null;
}
