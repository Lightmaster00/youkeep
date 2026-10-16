import type Database from 'better-sqlite3';

/**
 * What a download shows while it runs. `progress` and `eta` may be null to
 * keep the stored value (e.g. a podcast without Content-Length has no percent).
 */
export interface ProgressSnapshot {
  progress: number | null;
  speed: string | null;
  eta: string | null;
}

export interface ProgressWriter {
  /** Records the latest values; persisted at most once per interval, only when they changed. */
  update(snapshot: ProgressSnapshot): void;
  /** Persists a pending (throttled) value now. */
  flush(): void;
  /** Flushes, then ignores every later update. Call on completion, failure, pause and cancel. */
  stop(): void;
}

/** The download queue polls every 500 ms while something downloads: at most ~1 s stale. */
export const PROGRESS_WRITE_INTERVAL_MS = 1000;

const snapshotKey = (s: ProgressSnapshot) => `${s.progress ?? ''}\u0000${s.speed ?? ''}\u0000${s.eta ?? ''}`;

/**
 * Throttles progress persistence: the first update is written at once, later
 * ones at most once per `intervalMs` (the latest value of a window is written
 * when the window ends), and an update equal to what was last written is
 * dropped. Every yt-dlp progress line used to be its own synchronous SQLite
 * commit, which blocked the event loop on a slow disk.
 */
export function createProgressWriter(
  write: (snapshot: ProgressSnapshot) => void,
  opts: { intervalMs?: number; now?: () => number } = {},
): ProgressWriter {
  const intervalMs = opts.intervalMs ?? PROGRESS_WRITE_INTERVAL_MS;
  const now = opts.now ?? Date.now;
  let lastKey: string | null = null;
  let lastWriteAt = Number.NEGATIVE_INFINITY;
  let pending: ProgressSnapshot | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const clearTimer = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const persist = (snapshot: ProgressSnapshot) => {
    pending = null;
    lastKey = snapshotKey(snapshot);
    lastWriteAt = now();
    try {
      write(snapshot);
    } catch {
      // Progress is cosmetic: a failed write (SQLITE_BUSY, closed database
      // during shutdown) must never break the download itself.
    }
  };

  const flush = () => {
    clearTimer();
    if (pending && !stopped) persist(pending);
  };

  return {
    update(snapshot) {
      if (stopped) return;
      if (snapshotKey(snapshot) === lastKey) {
        // Already what the database shows: nothing newer to write.
        pending = null;
        clearTimer();
        return;
      }
      const wait = lastWriteAt + intervalMs - now();
      if (wait <= 0) {
        clearTimer();
        persist(snapshot);
        return;
      }
      pending = snapshot;
      if (!timer) {
        timer = setTimeout(() => {
          timer = null;
          if (pending && !stopped) persist(pending);
        }, wait);
        (timer as any).unref?.();
      }
    },
    flush,
    stop() {
      flush();
      stopped = true;
    },
  };
}

export type ProgressTable = 'videos' | 'music_tracks' | 'podcast_episodes';
const PROGRESS_TABLES: readonly ProgressTable[] = ['videos', 'music_tracks', 'podcast_episodes'];

/**
 * A progress writer for one row. The statement is prepared once per download
 * attempt, and it only touches a row still in 'downloading': a write can never
 * resurrect progress on an item that was paused, cancelled, failed or completed.
 */
export function createDbProgressWriter(db: Database.Database, table: ProgressTable, id: string, opts?: { intervalMs?: number; now?: () => number }): ProgressWriter {
  if (!PROGRESS_TABLES.includes(table)) throw new Error(`Unknown progress table: ${table}`);
  const statement = db.prepare(`
    UPDATE ${table}
    SET download_progress = COALESCE(?, download_progress), download_speed = ?, download_eta = COALESCE(?, download_eta)
    WHERE id = ? AND download_status = 'downloading'
  `);
  return createProgressWriter((s) => { statement.run(s.progress, s.speed, s.eta, id); }, opts);
}

// One live writer per download, so a pause or cancel can flush it before the
// status changes. Kept on globalThis like the downloaders' own process maps.
const G_WRITERS = Symbol.for('youkeep.progressWriters');
const _g = globalThis as any;
if (!_g[G_WRITERS]) _g[G_WRITERS] = new Map<string, ProgressWriter>();
const writers: Map<string, ProgressWriter> = _g[G_WRITERS];
const writerKey = (table: ProgressTable, id: string) => `${table}:${id}`;

/** Starts (and registers) the writer of a new download attempt, stopping any older one for the same row. */
export function startProgressWriter(db: Database.Database, table: ProgressTable, id: string): ProgressWriter {
  const key = writerKey(table, id);
  writers.get(key)?.stop();
  const writer = createDbProgressWriter(db, table, id);
  writers.set(key, writer);
  return writer;
}

/** Ends one attempt's writer: flushes it, and unregisters it unless a newer attempt replaced it. */
export function finishProgressWriter(table: ProgressTable, id: string, writer: ProgressWriter): void {
  writer.stop();
  const key = writerKey(table, id);
  if (writers.get(key) === writer) writers.delete(key);
}

/** Pause/cancel: flushes and stops the row's live writer (if any) before its status changes. */
export function stopProgressWriter(table: ProgressTable, id: string): void {
  const key = writerKey(table, id);
  const writer = writers.get(key);
  if (!writer) return;
  writer.stop();
  writers.delete(key);
}

/** Shutdown: flushes and stops every live writer. Returns how many there were. */
export function stopAllProgressWriters(): number {
  const count = writers.size;
  for (const writer of writers.values()) writer.stop();
  writers.clear();
  return count;
}
