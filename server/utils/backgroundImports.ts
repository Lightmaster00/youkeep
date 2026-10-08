/**
 * A small in-process queue for the slow part of following a source: listing
 * every track/video of a YouTube channel. The follow request returns as soon
 * as the source row exists; the listing runs here, at most
 * MAX_CONCURRENT_IMPORTS at a time, and a failing task never crashes the
 * process (each task records its own failure in the database).
 */

export const MAX_CONCURRENT_IMPORTS = 2;

interface QueuedImport {
  key: string;
  task: () => Promise<void>;
}

interface ImportQueueState {
  running: Set<string>;
  pending: QueuedImport[];
  idleWaiters: Array<() => void>;
}

// Global-backed so development hot reloads keep one queue (same pattern as
// the download workers' state).
const G_IMPORT_QUEUE = Symbol.for('YouKeep.backgroundImportQueue');
const _g = globalThis as any;
if (!(G_IMPORT_QUEUE in _g)) {
  _g[G_IMPORT_QUEUE] = { running: new Set(), pending: [], idleWaiters: [] } satisfies ImportQueueState;
}
const state: ImportQueueState = _g[G_IMPORT_QUEUE];

function isQueued(key: string): boolean {
  return state.running.has(key) || state.pending.some((p) => p.key === key);
}

function notifyIdle() {
  if (state.running.size > 0 || state.pending.length > 0) return;
  const waiters = state.idleWaiters.splice(0);
  for (const w of waiters) w();
}

function pump() {
  while (state.running.size < MAX_CONCURRENT_IMPORTS && state.pending.length > 0) {
    const next = state.pending.shift()!;
    state.running.add(next.key);
    // Deferred to the next turn of the event loop: the request that queued
    // the import always answers before any of its work starts.
    setImmediate(() => {
      Promise.resolve()
        .then(next.task)
        .catch((err) => {
          console.error(`[import] Background import ${next.key} failed unexpectedly:`, err);
        })
        .finally(() => {
          state.running.delete(next.key);
          pump();
          notifyIdle();
        });
    });
  }
}

/**
 * Queues `task` under `key`. Returns false (and queues nothing) when an
 * import with the same key is already queued or running.
 */
export function enqueueBackgroundImport(key: string, task: () => Promise<void>): boolean {
  if (isQueued(key)) return false;
  state.pending.push({ key, task });
  pump();
  return true;
}

/** Number of imports running right now (never more than MAX_CONCURRENT_IMPORTS). */
export function runningImportCount(): number {
  return state.running.size;
}

/** Resolves once no import is queued or running. */
export function backgroundImportsIdle(): Promise<void> {
  if (state.running.size === 0 && state.pending.length === 0) return Promise.resolve();
  return new Promise((resolve) => state.idleWaiters.push(resolve));
}
