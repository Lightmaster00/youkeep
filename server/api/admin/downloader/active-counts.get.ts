import { defineEventHandler } from 'h3';
import { getDownloadsDirState } from '../../../utils/downloader';

type Counts = { downloading: number; pending: number; pausedPending: number };
type Kind = 'video' | 'music' | 'podcasts';

// `pending` counts only what a worker can pick up (the same rule as each
// worker's query); pending items of a paused channel/artist/show wait until
// it is resumed and are reported apart as `pausedPending`.
const TABLES: Array<{ kind: Kind; table: string; pickable: string }> = [
  { kind: 'video', table: 'videos', pickable: `(SELECT sync_status FROM channels WHERE id = t.channel_id) = 'downloading' OR t.is_manually_queued = 1` },
  { kind: 'music', table: 'music_tracks', pickable: `(SELECT sync_status FROM music_artists WHERE id = t.artist_id) = 'downloading'` },
  { kind: 'podcasts', table: 'podcast_episodes', pickable: `(SELECT sync_status FROM podcast_shows WHERE id = t.show_id) = 'downloading'` },
];

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const db = getDb();

  const counts: Record<Kind, Counts> = {
    video: { downloading: 0, pending: 0, pausedPending: 0 },
    music: { downloading: 0, pending: 0, pausedPending: 0 },
    podcasts: { downloading: 0, pending: 0, pausedPending: 0 },
  };
  const current: { kind: Kind | null; progress: number | null; speed: string | null } = {
    kind: null, progress: null, speed: null,
  };

  for (const { kind, table, pickable } of TABLES) {
    // A failure in one table must not take down the sidebar badge: it just reads as zeros.
    try {
      const row = db.prepare(`
        SELECT
          COALESCE(SUM(t.download_status = 'downloading'), 0) AS downloading,
          COALESCE(SUM(t.download_status = 'pending' AND (${pickable})), 0) AS pending,
          COALESCE(SUM(t.download_status = 'pending' AND NOT (${pickable})), 0) AS pausedPending
        FROM ${table} t
        WHERE t.download_status IN ('downloading', 'pending')
      `).get() as Counts;
      counts[kind] = { downloading: row.downloading, pending: row.pending, pausedPending: row.pausedPending };

      if (current.kind === null && counts[kind].downloading > 0) {
        const item = db.prepare(
          `SELECT download_progress, download_speed FROM ${table} WHERE download_status = 'downloading' LIMIT 1`
        ).get() as { download_progress: number | null; download_speed: string | null } | undefined;
        if (item) {
          current.kind = kind;
          current.progress = item.download_progress ?? 0;
          current.speed = item.download_speed ?? null;
        }
      }
    } catch {
      counts[kind] = { downloading: 0, pending: 0, pausedPending: 0 };
    }
  }

  const total = TABLES.reduce((sum, { kind }) => sum + counts[kind].downloading + counts[kind].pending, 0);

  // Why video downloads are on hold, when the configured folder is unavailable.
  const blockedReason = getDownloadsDirState().blockedReason;

  return { ...counts, total, current, blockedReason };
});
