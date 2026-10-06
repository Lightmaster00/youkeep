import { defineEventHandler } from 'h3';

type Counts = { downloading: number; pending: number };
type Kind = 'video' | 'music' | 'podcasts';

const TABLES: Array<{ kind: Kind; table: string }> = [
  { kind: 'video', table: 'videos' },
  { kind: 'music', table: 'music_tracks' },
  { kind: 'podcasts', table: 'podcast_episodes' },
];

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const db = getDb();

  const counts: Record<Kind, Counts> = {
    video: { downloading: 0, pending: 0 },
    music: { downloading: 0, pending: 0 },
    podcasts: { downloading: 0, pending: 0 },
  };
  const current: { kind: Kind | null; progress: number | null; speed: string | null } = {
    kind: null, progress: null, speed: null,
  };

  for (const { kind, table } of TABLES) {
    // A failure in one table must not take down the sidebar badge: it just reads as zeros.
    try {
      const rows = db.prepare(
        `SELECT download_status AS status, COUNT(*) AS count FROM ${table} WHERE download_status IN ('downloading', 'pending') GROUP BY download_status`
      ).all() as Array<{ status: 'downloading' | 'pending'; count: number }>;
      for (const row of rows) counts[kind][row.status] = row.count;

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
      counts[kind] = { downloading: 0, pending: 0 };
    }
  }

  const total = TABLES.reduce((sum, { kind }) => sum + counts[kind].downloading + counts[kind].pending, 0);

  return { ...counts, total, current };
});
