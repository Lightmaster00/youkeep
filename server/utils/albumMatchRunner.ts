import type Database from 'better-sqlite3';
import { getDb } from './db';
import { addLog } from './downloader';
import { applyAlbumMatch, backoffDelayMs, defaultItunesClient, isTransientMatchError, RequestThrottle, searchItunesSong, throttledItunesClient, type ApplyOutcome, type ItunesClient, type ItunesMatch } from './albumMatch';

/**
 * The album matcher's background queue: at most one run at a time, fed by
 * the admin tool (the backlog), by finished downloads (one track each) and
 * by a delayed startup check. Progress lives in the database (a track keeps
 * album_match_status NULL until it is checked), so an interrupted run
 * resumes on the next start. A run never throws out of its loop.
 */

export type AlbumMatchScope = 'unchecked' | 'unmatched';
export type AlbumMatchState = 'idle' | 'running' | 'done' | 'failed' | 'cancelled';

export interface AlbumMatchStatus {
  state: AlbumMatchState;
  scope: AlbumMatchScope | null;
  processed: number;
  total: number;
  matched: number;
  unmatched: number;
  skipped: number;
  errors: number;
  lastError: string | null;
}

export interface AlbumMatchPreview {
  completedTracks: number;
  unchecked: number;
  matched: number;
  unmatched: number;
  manual: number;
  enabled: boolean;
}

export const ALBUM_MATCHING_SETTING = 'album_matching_enabled';
export const ITUNES_REQUEST_INTERVAL_MS = 3_000;
export const MAX_CONSECUTIVE_TRANSIENT_FAILURES = 5;
export const STARTUP_ALBUM_MATCH_DELAY_MS = 60_000;

// globalThis-backed so the state survives Nitro development reloads.
const G_STATUS = Symbol.for('YouKeep.albumMatchStatus');
const G_QUEUE = Symbol.for('YouKeep.albumMatchQueue');
const G_CANCEL = Symbol.for('YouKeep.albumMatchCancel');
const G_WAKE = Symbol.for('YouKeep.albumMatchWake');
const G_THROTTLE = Symbol.for('YouKeep.itunesThrottle');
const _g = globalThis as any;

interface QueueItem { id: string; scope: AlbumMatchScope }
interface QueueState { items: QueueItem[]; ids: Set<string> }

function idleStatus(): AlbumMatchStatus {
  return { state: 'idle', scope: null, processed: 0, total: 0, matched: 0, unmatched: 0, skipped: 0, errors: 0, lastError: null };
}
if (!_g[G_STATUS]) _g[G_STATUS] = idleStatus();
if (!_g[G_QUEUE]) _g[G_QUEUE] = { items: [], ids: new Set() } satisfies QueueState;
if (_g[G_CANCEL] === undefined) _g[G_CANCEL] = false;
// One iTunes request every 3 seconds, process-wide.
if (!_g[G_THROTTLE]) _g[G_THROTTLE] = new RequestThrottle(ITUNES_REQUEST_INTERVAL_MS);

const queue = (): QueueState => _g[G_QUEUE];
const status = (): AlbumMatchStatus => _g[G_STATUS];

/** A sleep that a cancel cuts short. */
function wakeableSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      if (_g[G_WAKE] === done) _g[G_WAKE] = null;
      resolve();
    };
    const timer = setTimeout(done, ms);
    _g[G_WAKE] = done;
  });
}

/** Swappable in tests: no real HTTP and no real waiting. */
export const albumMatchDeps = {
  /** The raw iTunes endpoints (no spacing). */
  client: defaultItunesClient as ItunesClient,
  /** Waits for the process-wide request spacing; called before every iTunes request. */
  throttle: (): Promise<void> => (_g[G_THROTTLE] as RequestThrottle).wait(),
  sleep: (ms: number): Promise<void> => wakeableSleep(ms),
  /** One lookup: the search, then (when needed) the collection lookup, each request throttled. */
  search: (artistName: string, title: string): Promise<ItunesMatch | null> =>
    searchItunesSong(artistName, title, throttledItunesClient(albumMatchDeps.client, () => albumMatchDeps.throttle())),
};

export function isAlbumMatchingEnabled(db: Database.Database): boolean {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(ALBUM_MATCHING_SETTING) as { value: string } | undefined;
  return row?.value !== '0';
}

export function setAlbumMatchingEnabled(db: Database.Database, enabled: boolean): void {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(ALBUM_MATCHING_SETTING, enabled ? '1' : '0');
  if (!enabled) cancelAlbumMatchRun();
}

export function getAlbumMatchStatus(): AlbumMatchStatus {
  return { ...status() };
}

export function isAlbumMatchRunning(): boolean {
  return status().state === 'running';
}

export function getAlbumMatchPreview(db: Database.Database): AlbumMatchPreview {
  const row = db.prepare(`
    SELECT
      COUNT(*) AS completedTracks,
      COALESCE(SUM(CASE WHEN album_match_status IS NULL AND album_id IS NULL THEN 1 ELSE 0 END), 0) AS unchecked,
      COALESCE(SUM(CASE WHEN album_match_status = 'matched' THEN 1 ELSE 0 END), 0) AS matched,
      COALESCE(SUM(CASE WHEN album_match_status = 'unmatched' THEN 1 ELSE 0 END), 0) AS unmatched,
      COALESCE(SUM(CASE WHEN album_match_status = 'manual' OR (album_match_status IS NULL AND album_id IS NOT NULL) THEN 1 ELSE 0 END), 0) AS manual
    FROM music_tracks
    WHERE download_status = 'completed'
  `).get() as Omit<AlbumMatchPreview, 'enabled'>;
  return { ...row, enabled: isAlbumMatchingEnabled(db) };
}

function selectTrackIds(db: Database.Database, scope: AlbumMatchScope): string[] {
  const condition = scope === 'unmatched' ? "album_match_status = 'unmatched'" : 'album_match_status IS NULL AND album_id IS NULL';
  const rows = db.prepare(`SELECT id FROM music_tracks WHERE download_status = 'completed' AND ${condition} ORDER BY created_at, id`).all() as { id: string }[];
  return rows.map((r) => r.id);
}

/** Adds tracks to the running queue (each once); returns how many were new. */
function addToQueue(ids: string[], scope: AlbumMatchScope): number {
  const q = queue();
  let added = 0;
  for (const id of ids) {
    if (q.ids.has(id)) continue;
    q.ids.add(id);
    q.items.push({ id, scope });
    added++;
  }
  status().total += added;
  return added;
}

function launch(db: Database.Database, ids: string[], scope: AlbumMatchScope): void {
  _g[G_STATUS] = { ...idleStatus(), state: 'running', scope } satisfies AlbumMatchStatus;
  _g[G_QUEUE] = { items: [], ids: new Set() } satisfies QueueState;
  _g[G_CANCEL] = false;
  addToQueue(ids, scope);
  runAlbumMatchLoop(db).catch((err) => {
    // runAlbumMatchLoop catches everything itself; this is a last resort.
    _g[G_STATUS] = { ...status(), state: 'failed', lastError: err?.message || String(err) };
  });
}

/**
 * Starts matching the backlog ('unchecked') or retrying 'unmatched' tracks.
 * While a run is going, the tracks join it instead (still one run).
 */
export function startAlbumMatchRun(scope: AlbumMatchScope, db: Database.Database = getDb()):
  { started: true; joined: boolean; queued: number } | { started: false; error: string } {
  if (!isAlbumMatchingEnabled(db)) return { started: false, error: 'Album matching is turned off.' };
  const ids = selectTrackIds(db, scope);
  if (isAlbumMatchRunning()) return { started: true, joined: true, queued: addToQueue(ids, scope) };
  if (ids.length === 0) {
    _g[G_STATUS] = { ...idleStatus(), state: 'done', scope } satisfies AlbumMatchStatus;
    return { started: true, joined: false, queued: 0 };
  }
  launch(db, ids, scope);
  return { started: true, joined: false, queued: ids.length };
}

/** Queues one freshly downloaded track. Does nothing while matching is turned off. */
export function enqueueAlbumMatch(trackId: string, db: Database.Database = getDb()): boolean {
  if (!isAlbumMatchingEnabled(db)) return false;
  if (isAlbumMatchRunning()) return addToQueue([trackId], 'unchecked') > 0;
  launch(db, [trackId], 'unchecked');
  return true;
}

/** Asks the running matcher to stop after the current track. */
export function cancelAlbumMatchRun(): boolean {
  if (!isAlbumMatchRunning()) return false;
  _g[G_CANCEL] = true;
  const wake = _g[G_WAKE] as (() => void) | null | undefined;
  if (wake) wake();
  return true;
}

/**
 * After a delay, starts matching the tracks nobody checked yet (a run that a
 * restart interrupted, or tracks downloaded before this feature existed).
 */
export function scheduleStartupAlbumMatch(delayMs: number = STARTUP_ALBUM_MATCH_DELAY_MS): ReturnType<typeof setTimeout> {
  const timer = setTimeout(() => {
    try {
      const db = getDb();
      if (!isAlbumMatchingEnabled(db) || isAlbumMatchRunning()) return;
      const result = startAlbumMatchRun('unchecked', db);
      if (result.started && result.queued > 0) addLog(`Album matching: resuming with ${result.queued} unchecked track(s).`);
    } catch (err) {
      console.error('[album-match] Could not start the startup run:', err);
    }
  }, delayMs);
  (timer as any).unref?.();
  return timer;
}

async function matchOne(db: Database.Database, item: QueueItem): Promise<ApplyOutcome> {
  const allowUnmatched = item.scope === 'unmatched';
  const track = db.prepare(`
    SELECT t.id, t.title, t.album_id, t.album_match_status, t.download_status, a.name AS artist_name
    FROM music_tracks t JOIN music_artists a ON a.id = t.artist_id
    WHERE t.id = ?
  `).get(item.id) as { id: string; title: string; album_id: string | null; album_match_status: string | null; download_status: string; artist_name: string } | undefined;
  if (!track || track.download_status !== 'completed') return 'skipped';
  const matchable = !track.album_id && (track.album_match_status === null || (allowUnmatched && track.album_match_status === 'unmatched'));
  // Not matchable: no request; the apply step only marks a yt-dlp album track 'manual'.
  if (!matchable) return applyAlbumMatch(db, track.id, null, { allowUnmatched });

  const match = await albumMatchDeps.search(track.artist_name, track.title);
  return applyAlbumMatch(db, track.id, match, { allowUnmatched });
}

async function runAlbumMatchLoop(db: Database.Database): Promise<void> {
  // Never do any of the work inside the request that started the run.
  await new Promise((resolve) => setImmediate(resolve));
  const s = status();
  let consecutiveFailures = 0;
  try {
    while (queue().items.length > 0) {
      if (_g[G_CANCEL]) {
        s.state = 'cancelled';
        break;
      }
      if (!isAlbumMatchingEnabled(db)) {
        s.state = 'cancelled';
        s.lastError = 'Album matching was turned off.';
        break;
      }
      const item = queue().items.shift()!;
      let outcome: ApplyOutcome;
      try {
        outcome = await matchOne(db, item);
      } catch (err: any) {
        const message = err?.message || String(err);
        s.processed++;
        s.errors++;
        s.lastError = message;
        if (!isTransientMatchError(err)) {
          addLog(`Album matching: track ${item.id} failed and stays unchecked: ${message}`);
          continue;
        }
        consecutiveFailures++;
        if (consecutiveFailures >= MAX_CONSECUTIVE_TRANSIENT_FAILURES) {
          s.state = 'failed';
          s.lastError = `iTunes did not answer ${consecutiveFailures} times in a row: ${message}`;
          addLog(`Album matching stopped: ${s.lastError}`);
          break;
        }
        const delay = backoffDelayMs(consecutiveFailures);
        addLog(`Album matching: iTunes is unavailable (${message}); waiting ${Math.round(delay / 1000)} s.`);
        await albumMatchDeps.sleep(delay);
        continue;
      }
      consecutiveFailures = 0;
      s.processed++;
      if (outcome === 'matched') s.matched++;
      else if (outcome === 'unmatched') s.unmatched++;
      else s.skipped++;
    }
    if (s.state === 'running') s.state = 'done';
  } catch (err: any) {
    s.state = 'failed';
    s.lastError = err?.message || String(err);
    console.error('[album-match] The run stopped unexpectedly:', err);
  } finally {
    _g[G_QUEUE] = { items: [], ids: new Set() } satisfies QueueState;
    _g[G_CANCEL] = false;
    if (s.state === 'done' && (s.matched || s.unmatched || s.errors)) {
      addLog(`Album matching finished: ${s.matched} matched, ${s.unmatched} without a match, ${s.errors} error(s).`);
    }
  }
}
