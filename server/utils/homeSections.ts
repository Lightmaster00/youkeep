import type Database from 'better-sqlite3';
import { videoVisibilitySql, type VideoViewer } from './videoAccess';
import type { UserProfile } from './recommendScore';

// Queries behind the rows of the new home (server/api/home/feed.get.ts).
// Every one is a bounded set-based read (grouped aggregates, window
// functions, json_each lists): no per-row correlated subquery.

export const FEED_VIDEO_COLUMNS = `
  v.id, v.title, v.duration, v.view_count, v.upload_date, v.created_at,
  v.local_video_path, v.local_thumbnail_path, v.was_live, v.channel_id, v.is_short,
  c.title AS channel_title, c.avatar_url AS channel_avatar
`;

export interface FeedVideo {
  id: string;
  title: string;
  duration: number | null;
  view_count: number | null;
  upload_date: string | null;
  created_at?: number;
  local_video_path: string | null;
  local_thumbnail_path: string | null;
  was_live?: number;
  is_short?: number;
  channel_id: string;
  channel_title: string;
  channel_avatar: string | null;
}

function hiddenSql(viewer: VideoViewer | null): { sql: string; params: string[] } {
  return viewer
    ? { sql: 'AND v.id NOT IN (SELECT video_id FROM user_hidden_videos WHERE user_id = ?)', params: [viewer.id] }
    : { sql: '', params: [] };
}

const excludeJson = (exclude: Iterable<string>) => JSON.stringify([...exclude]);

/**
 * The newest long videos of the followed channels: at most `perChannel` per
 * channel, from at most `maxChannels` channels, newest first. `isNew` when the
 * viewer has neither a history row nor a "seen" mark for it.
 */
export function querySubscriptionLatest(
  db: Database.Database,
  viewer: VideoViewer,
  opts: { limit: number; maxChannels: number; perChannel?: number; exclude?: Iterable<string> },
): (FeedVideo & { isNew: boolean })[] {
  const visible = videoVisibilitySql(viewer);
  const perChannel = opts.perChannel ?? 2;
  const rows = db.prepare(`
    WITH ranked AS (
      SELECT ${FEED_VIDEO_COLUMNS},
             ROW_NUMBER() OVER (PARTITION BY v.channel_id ORDER BY v.upload_date DESC, v.created_at DESC, v.id) AS rn
      FROM user_subscriptions us
      JOIN videos v ON v.channel_id = us.channel_id
      JOIN channels c ON c.id = v.channel_id
      WHERE us.user_id = ?
        AND v.download_status = 'completed'
        AND v.is_short = 0
        AND v.id NOT IN (SELECT video_id FROM user_hidden_videos WHERE user_id = ?)
        AND v.id NOT IN (SELECT value FROM json_each(?))
        AND ${visible.sql}
    )
    SELECT r.*, CASE WHEN uh.video_id IS NULL AND sv.video_id IS NULL THEN 1 ELSE 0 END AS is_new
    FROM ranked r
    LEFT JOIN user_history uh ON uh.user_id = ? AND uh.video_id = r.id
    LEFT JOIN user_seen_videos sv ON sv.user_id = ? AND sv.video_id = r.id
    WHERE r.rn <= ?
    ORDER BY r.upload_date DESC, r.created_at DESC, r.id
  `).all(viewer.id, viewer.id, excludeJson(opts.exclude ?? []), ...visible.params, viewer.id, viewer.id, perChannel) as any[];

  const channels = new Set<string>();
  const out: (FeedVideo & { isNew: boolean })[] = [];
  for (const { rn: _rn, is_new, ...video } of rows) {
    if (out.length >= opts.limit) break;
    if (!channels.has(video.channel_id)) {
      if (channels.size >= opts.maxChannels) continue;
      channels.add(video.channel_id);
    }
    out.push({ ...video, isNew: is_new === 1 });
  }
  return out;
}

/** The most common categories of the visible long videos (count, then name). */
export function queryCommonCategories(db: Database.Database, viewer: VideoViewer | null, limit: number): string[] {
  const visible = videoVisibilitySql(viewer);
  const rows = db.prepare(`
    SELECT j.value AS category, COUNT(*) AS n
    FROM videos v
    JOIN channels c ON c.id = v.channel_id
    JOIN json_each(CASE WHEN json_valid(v.categories) THEN v.categories ELSE '[]' END) j
    WHERE v.download_status = 'completed' AND v.is_short = 0 AND v.categories IS NOT NULL AND ${visible.sql}
    GROUP BY j.value
    ORDER BY n DESC, j.value
    LIMIT ?
  `).all(...visible.params, Math.trunc(limit)) as { category: string; n: number }[];
  return rows.map((r) => r.category).filter((c) => typeof c === 'string' && c !== '');
}

/** Popular long videos of one category. */
export function queryCategoryVideos(
  db: Database.Database,
  viewer: VideoViewer | null,
  category: string,
  opts: { limit: number; exclude?: Iterable<string> },
): FeedVideo[] {
  const visible = videoVisibilitySql(viewer);
  const hidden = hiddenSql(viewer);
  // Stored lists are JSON.stringify output, so the quoted name is an exact token.
  return db.prepare(`
    SELECT ${FEED_VIDEO_COLUMNS}
    FROM videos v
    JOIN channels c ON c.id = v.channel_id
    WHERE v.download_status = 'completed' AND v.is_short = 0
      AND instr(v.categories, ?) > 0
      AND v.id NOT IN (SELECT value FROM json_each(?))
      ${hidden.sql}
      AND ${visible.sql}
    ORDER BY v.view_count DESC, v.created_at DESC, v.id
    LIMIT ?
  `).all(JSON.stringify(category), excludeJson(opts.exclude ?? []), ...hidden.params, ...visible.params, Math.trunc(opts.limit)) as FeedVideo[];
}

/** Shorts for the vertical shelf: newest and most viewed, taking turns. */
export function queryShortsShelf(db: Database.Database, viewer: VideoViewer | null, limit: number): FeedVideo[] {
  const visible = videoVisibilitySql(viewer);
  const hidden = hiddenSql(viewer);
  const select = (order: string) => db.prepare(`
    SELECT ${FEED_VIDEO_COLUMNS}
    FROM videos v
    JOIN channels c ON c.id = v.channel_id
    WHERE v.download_status = 'completed' AND v.is_short = 1
      ${hidden.sql}
      AND ${visible.sql}
    ORDER BY ${order}
    LIMIT ?
  `).all(...hidden.params, ...visible.params, Math.trunc(limit)) as FeedVideo[];
  const newest = select('v.created_at DESC, v.id');
  const popular = select('v.view_count DESC, v.id');
  const out: FeedVideo[] = [];
  const seen = new Set<string>();
  for (let i = 0; out.length < limit && (i < newest.length || i < popular.length); i++) {
    for (const v of [newest[i], popular[i]]) {
      if (v && !seen.has(v.id) && out.length < limit) {
        seen.add(v.id);
        out.push(v);
      }
    }
  }
  return out;
}

export interface HomePlaylist {
  id: string;
  title: string;
  visibility: string;
  created_at: number;
  video_count: number;
  cover_video_id: string | null;
  thumbnail_path: string | null;
}

/**
 * The viewer's newest personal playlists, with the count and first video of
 * what the viewer may see. (Playlists have no "updated" time: newest created.)
 */
export function queryHomePlaylists(db: Database.Database, viewer: VideoViewer, limit: number): HomePlaylist[] {
  const visible = videoVisibilitySql(viewer);
  return db.prepare(`
    WITH mine AS (
      SELECT id, title, visibility, created_at FROM personal_playlists
      WHERE user_id = ? ORDER BY created_at DESC, id LIMIT ?
    ),
    entries AS (
      SELECT pv.playlist_id, pv.video_id, v.local_thumbnail_path,
             ROW_NUMBER() OVER (PARTITION BY pv.playlist_id ORDER BY pv.position, pv.video_id) AS rn
      FROM personal_playlist_videos pv
      JOIN mine m ON m.id = pv.playlist_id
      JOIN videos v ON v.id = pv.video_id
      JOIN channels c ON c.id = v.channel_id
      WHERE ${visible.sql}
    )
    SELECT m.id, m.title, m.visibility, m.created_at,
           COUNT(e.video_id) AS video_count,
           MAX(CASE WHEN e.rn = 1 THEN e.video_id END) AS cover_video_id,
           MAX(CASE WHEN e.rn = 1 THEN e.local_thumbnail_path END) AS thumbnail_path
    FROM mine m
    LEFT JOIN entries e ON e.playlist_id = m.id
    GROUP BY m.id
    ORDER BY m.created_at DESC, m.id
  `).all(viewer.id, Math.trunc(limit), ...visible.params) as HomePlaylist[];
}

export interface DiscoverChannel {
  id: string;
  title: string;
  avatar_url: string | null;
  video_count: number;
  categories: string[];
}

/** Channels with at least this many watched videos are not "to discover". */
const DISCOVER_MAX_WATCHED = 2;

/**
 * Library channels the viewer does not follow and has watched little, ranked
 * by popularity, lifted when they share the viewer's top categories.
 */
export function queryDiscoverChannels(db: Database.Database, viewer: VideoViewer, profile: UserProfile, limit: number): DiscoverChannel[] {
  const visible = videoVisibilitySql(viewer);
  const stats = db.prepare(`
    SELECT v.channel_id AS id, c.title, c.avatar_url, COUNT(*) AS video_count, SUM(COALESCE(v.view_count, 0)) AS views
    FROM videos v
    JOIN channels c ON c.id = v.channel_id
    WHERE v.download_status = 'completed' AND v.is_short = 0 AND ${visible.sql}
    GROUP BY v.channel_id
  `).all(...visible.params) as { id: string; title: string; avatar_url: string | null; video_count: number; views: number }[];
  if (stats.length === 0) return [];

  const watched = new Map((db.prepare(`
    SELECT v.channel_id, COUNT(*) AS n
    FROM user_history h JOIN videos v ON v.id = h.video_id
    WHERE h.user_id = ? AND h.watch_time_seconds > 0
    GROUP BY v.channel_id
  `).all(viewer.id) as { channel_id: string; n: number }[]).map((r) => [r.channel_id, r.n]));

  const candidates = stats.filter((s) => !profile.subscribed.has(s.id) && (watched.get(s.id) ?? 0) < DISCOVER_MAX_WATCHED);
  if (candidates.length === 0) return [];

  const categoryRows = db.prepare(`
    SELECT v.channel_id, j.value AS category, COUNT(*) AS n
    FROM videos v
    JOIN channels c ON c.id = v.channel_id
    JOIN json_each(CASE WHEN json_valid(v.categories) THEN v.categories ELSE '[]' END) j
    WHERE v.download_status = 'completed' AND v.is_short = 0 AND v.categories IS NOT NULL
      AND v.channel_id IN (SELECT value FROM json_each(?))
      AND ${visible.sql}
    GROUP BY v.channel_id, j.value
  `).all(JSON.stringify(candidates.map((c) => c.id)), ...visible.params) as { channel_id: string; category: string; n: number }[];
  const categories = new Map<string, { category: string; n: number }[]>();
  for (const r of categoryRows) {
    if (typeof r.category !== 'string' || r.category === '') continue;
    const list = categories.get(r.channel_id) ?? [];
    list.push({ category: r.category, n: r.n });
    categories.set(r.channel_id, list);
  }

  const maxLog = Math.max(...candidates.map((c) => Math.log10(1 + c.views)), 0);
  return candidates
    .map((c) => {
      const cats = (categories.get(c.id) ?? []).sort((a, b) => b.n - a.n || (a.category < b.category ? -1 : 1)).slice(0, 3).map((x) => x.category);
      const match = Math.max(0, ...cats.map((cat) => profile.categoryAffinity.get(cat) ?? 0));
      const popularity = maxLog > 0 ? Math.log10(1 + c.views) / maxLog : 0;
      return { channel: { id: c.id, title: c.title, avatar_url: c.avatar_url, video_count: c.video_count, categories: cats }, score: popularity * (1 + match) };
    })
    .sort((a, b) => b.score - a.score || (a.channel.id < b.channel.id ? -1 : 1))
    .slice(0, Math.trunc(limit))
    .map((x) => x.channel);
}
