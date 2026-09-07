import path from 'path';
import fs from 'fs';

export type WipeItemType = 'channel' | 'artist' | 'show';

export interface WipeOutcome {
  type: WipeItemType;
  id: string;
  name: string;
  error?: string;
}

export interface WipeReport {
  succeeded: { type: WipeItemType; id: string; name: string }[];
  failed: WipeOutcome[];
}

/**
 * Pure: splits a flat list of per-item outcomes into succeeded/failed,
 * preserving each bucket's original relative order. No DB, no fs — the one
 * genuinely unit-testable piece of this module.
 */
export function buildWipeReport(outcomes: WipeOutcome[]): WipeReport {
  const succeeded: WipeReport['succeeded'] = [];
  const failed: WipeOutcome[] = [];
  for (const o of outcomes) {
    if (o.error) {
      failed.push(o);
    } else {
      succeeded.push({ type: o.type, id: o.id, name: o.name });
    }
  }
  return { succeeded, failed };
}

export interface WipePreview {
  channelCount: number;
  videoCount: number;
  artistCount: number;
  trackCount: number;
  showCount: number;
  episodeCount: number;
  estimatedBytes: number;
}

export function getWipePreview(): WipePreview {
  const db = getDb();

  const channelCount = (db.prepare('SELECT COUNT(*) as count FROM channels').get() as any).count;
  const videoAgg = db.prepare('SELECT COUNT(*) as count, SUM(size_bytes) as bytes FROM videos').get() as any;
  const artistCount = (db.prepare('SELECT COUNT(*) as count FROM music_artists').get() as any).count;
  const trackAgg = db.prepare('SELECT COUNT(*) as count, SUM(size_bytes) as bytes FROM music_tracks').get() as any;
  const showCount = (db.prepare('SELECT COUNT(*) as count FROM podcast_shows').get() as any).count;
  // podcast_episodes has no size_bytes column — its contribution to the
  // estimate is always 0, not computed by walking the filesystem (would be
  // slow and is explicitly out of scope per the design's preview being a
  // best-effort estimate, not an exact figure).
  const episodeCount = (db.prepare('SELECT COUNT(*) as count FROM podcast_episodes').get() as any).count;

  const estimatedBytes = (videoAgg.bytes || 0) + (trackAgg.bytes || 0);

  return {
    channelCount,
    videoCount: videoAgg.count,
    artistCount,
    trackCount: trackAgg.count,
    showCount,
    episodeCount,
    estimatedBytes
  };
}

// In-memory wipe state, using the same globalThis-Symbol pattern as
// activeMusicProcesses/isProcessing elsewhere in this codebase, so it
// survives Nitro's dev-mode module reloads without becoming stale across
// two different module instances.
const G_WIPE_IN_PROGRESS = Symbol.for('YouKeep.libraryWipeInProgress');
const G_WIPE_PROGRESS = Symbol.for('YouKeep.libraryWipeProgress');
const G_WIPE_REPORT = Symbol.for('YouKeep.libraryWipeReport');
const _g = globalThis as any;
if (_g[G_WIPE_IN_PROGRESS] === undefined) _g[G_WIPE_IN_PROGRESS] = false;
if (_g[G_WIPE_PROGRESS] === undefined) _g[G_WIPE_PROGRESS] = null;
if (_g[G_WIPE_REPORT] === undefined) _g[G_WIPE_REPORT] = null;

export interface WipeProgress {
  type: WipeItemType;
  name: string;
  index: number;
  total: number;
}

export function isWipeInProgress(): boolean {
  return _g[G_WIPE_IN_PROGRESS];
}

export function getWipeProgress(): WipeProgress | null {
  return _g[G_WIPE_PROGRESS];
}

export function getWipeReport(): WipeReport | null {
  return _g[G_WIPE_REPORT];
}

export function startLibraryWipe(): { started: true } | { started: false; error: string } {
  if (isWipeInProgress()) {
    return { started: false, error: 'A library wipe is already in progress.' };
  }
  _g[G_WIPE_IN_PROGRESS] = true;
  _g[G_WIPE_PROGRESS] = null;
  _g[G_WIPE_REPORT] = null;

  // Fire-and-forget, same pattern as the per-item downloads in the three
  // queue workers — the caller (the API route) returns immediately and the
  // frontend polls getWipeProgress()/getWipeReport() for status.
  runLibraryWipeInternal().catch((err) => {
    console.error('Library wipe crashed unexpectedly:', err);
    _g[G_WIPE_IN_PROGRESS] = false;
    _g[G_WIPE_PROGRESS] = null;
    _g[G_WIPE_REPORT] = { succeeded: [], failed: [{ type: 'channel', id: 'unknown', name: 'Library wipe', error: `Wipe crashed: ${err?.message || String(err)}` }] };
  });

  return { started: true };
}

async function runLibraryWipeInternal(): Promise<void> {
  const db = getDb();
  const outcomes: WipeOutcome[] = [];

  const channels = db.prepare('SELECT id, title FROM channels').all() as { id: string; title: string }[];
  const artists = db.prepare('SELECT id, name FROM music_artists').all() as { id: string; name: string }[];
  const shows = db.prepare('SELECT id, title FROM podcast_shows').all() as { id: string; title: string }[];

  const total = channels.length + artists.length + shows.length;
  let index = 0;

  for (const c of channels) {
    index += 1;
    _g[G_WIPE_PROGRESS] = { type: 'channel', name: c.title, index, total };
    outcomes.push(deleteChannelForWipe(c.id, c.title));
    // Every delete call above is fully synchronous (better-sqlite3 and
    // fs.rmSync are both sync APIs) — without this yield, this whole "async"
    // function would run to completion on the first tick with no actual
    // await, blocking the entire Node event loop for the full wipe duration
    // and making startLibraryWipe()'s "returns immediately" and the
    // frontend's progress polling both unreachable. Yielding once per item
    // is enough granularity for a 1s poll to observe real progress.
    await new Promise((r) => setImmediate(r));
  }

  for (const a of artists) {
    index += 1;
    _g[G_WIPE_PROGRESS] = { type: 'artist', name: a.name, index, total };
    const result = deleteMusicArtist(a.id);
    outcomes.push({ type: 'artist', id: a.id, name: a.name, error: result.success ? undefined : result.error });
    await new Promise((r) => setImmediate(r));
  }

  for (const s of shows) {
    index += 1;
    _g[G_WIPE_PROGRESS] = { type: 'show', name: s.title, index, total };
    const result = deletePodcastShow(s.id);
    outcomes.push({ type: 'show', id: s.id, name: s.title, error: result.success ? undefined : result.error });
    await new Promise((r) => setImmediate(r));
  }

  _g[G_WIPE_REPORT] = buildWipeReport(outcomes);
  _g[G_WIPE_PROGRESS] = null;
  _g[G_WIPE_IN_PROGRESS] = false;
}

// Mirrors channels/[id].delete.ts's exact logic (custom_save_path aware),
// but as a plain function rather than an HTTP route, since the wipe loop
// needs to call it many times without going through H3.
function deleteChannelForWipe(channelId: string, title: string): WipeOutcome {
  const db = getDb();
  try {
    const videos = db.prepare('SELECT id FROM videos WHERE channel_id = ?').all(channelId) as { id: string }[];
    const channel = db.prepare('SELECT title, custom_save_path FROM channels WHERE id = ?').get(channelId) as {
      title: string;
      custom_save_path: string | null;
    } | undefined;

    for (const v of videos) {
      cancelDownload(v.id);
    }

    const res = db.prepare('DELETE FROM channels WHERE id = ?').run(channelId);
    if (res.changes === 0) {
      return { type: 'channel', id: channelId, name: title, error: 'Channel not found.' };
    }

    const basePath = channel?.custom_save_path && channel.custom_save_path.trim().length > 0
      ? channel.custom_save_path
      : getDownloadsDir();
    const channelDir = path.resolve(basePath, sanitizeFolderName(channel?.title || channelId));
    if (fs.existsSync(channelDir)) {
      // Own try/catch, deliberately not re-thrown into the outer catch below:
      // the DB row is already deleted at this point (the real "this content
      // is gone" signal), so a directory-removal failure is logged but must
      // not turn this into a reported failure — matches the fix Task 1's
      // review required for deleteMusicArtist, and the convention
      // deletePodcastShow already followed correctly from the start.
      try {
        fs.rmSync(channelDir, { recursive: true, force: true });
      } catch (fsErr: any) {
        console.error(`Failed to delete channel directory ${channelDir}:`, fsErr);
      }
    } else {
      console.warn(`Wipe: channel directory not found, skipping fs removal: ${channelDir} (channel "${channel?.title}", ${videos.length} video(s), custom_save_path=${channel?.custom_save_path ?? 'none'})`);
    }

    return { type: 'channel', id: channelId, name: title };
  } catch (err: any) {
    // This outer catch is for genuine failures BEFORE the DB row is
    // deleted (e.g. a query error) — a real failure, correctly reported.
    return { type: 'channel', id: channelId, name: title, error: err.message || String(err) };
  }
}
