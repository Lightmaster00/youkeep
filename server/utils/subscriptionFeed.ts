import type Database from 'better-sqlite3';
import { videoVisibilitySql, type VideoViewer } from './videoAccess';
import { FEED_VIDEO_COLUMNS, type FeedVideo } from './homeSections';

// The Subscriptions page data: the followed channels' videos and the channels
// themselves. A video is "new" while the viewer has neither a history row nor
// a "seen" mark (user_seen_videos) for it.

export type SubscriptionSort = 'new' | 'popular' | 'oldest';
export const SUBSCRIPTION_SORTS: readonly SubscriptionSort[] = ['new', 'popular', 'oldest'];
/** "New" in the channel list: added in this window and unseen. */
export const NEW_WINDOW_MS = 14 * 86_400_000;

const ORDER: Record<SubscriptionSort, string> = {
  new: 'v.upload_date DESC, v.created_at DESC, v.id',
  popular: 'v.view_count DESC, v.upload_date DESC, v.id',
  oldest: 'v.upload_date ASC, v.created_at ASC, v.id',
};

export interface SubscriptionVideo extends FeedVideo {
  isNew: boolean;
  /** 0..100: how far the viewer got (position, else watch time). */
  watchedPercent: number;
}

/** Channels the viewer may see (same rule as canAccessChannel), over `c`. */
function channelVisibilitySql(viewer: VideoViewer): { sql: string; params: string[] } {
  if (viewer.role === 'admin') return { sql: '1=1', params: [] };
  return {
    sql: "(c.visibility IN ('public', 'private') OR c.id IN (SELECT channel_id FROM user_channel_access WHERE user_id = ?))",
    params: [viewer.id],
  };
}

export function querySubscriptionFeed(
  db: Database.Database,
  viewer: VideoViewer,
  opts: { channelId?: string; category?: string; sort: SubscriptionSort; type: 'video' | 'short'; page: number; limit: number },
): { videos: SubscriptionVideo[]; total: number } {
  const visible = videoVisibilitySql(viewer);
  const where = `
    FROM user_subscriptions us
    JOIN videos v ON v.channel_id = us.channel_id
    JOIN channels c ON c.id = v.channel_id
    WHERE us.user_id = ?
      AND v.download_status = 'completed'
      AND v.is_short = ?
      AND v.id NOT IN (SELECT video_id FROM user_hidden_videos WHERE user_id = ?)
      ${opts.channelId ? 'AND v.channel_id = ?' : ''}
      ${opts.category ? 'AND instr(v.categories, ?) > 0' : ''}
      AND ${visible.sql}`;
  const params: unknown[] = [viewer.id, opts.type === 'short' ? 1 : 0, viewer.id];
  if (opts.channelId) params.push(opts.channelId);
  if (opts.category) params.push(JSON.stringify(opts.category));
  params.push(...visible.params);

  const total = (db.prepare(`SELECT COUNT(*) AS n ${where}`).get(...params) as { n: number }).n;
  const rows = db.prepare(`
    WITH page AS (
      SELECT ${FEED_VIDEO_COLUMNS}, v.categories AS categories_json
      ${where}
      ORDER BY ${ORDER[opts.sort]}
      LIMIT ? OFFSET ?
    )
    SELECT p.*, uh.video_id AS history_id, sv.video_id AS seen_id,
           uh.position_seconds, uh.watch_time_seconds, COALESCE(uh.duration_seconds, p.duration) AS measured
    FROM page p
    LEFT JOIN user_history uh ON uh.user_id = ? AND uh.video_id = p.id
    LEFT JOIN user_seen_videos sv ON sv.user_id = ? AND sv.video_id = p.id
    ORDER BY ${ORDER[opts.sort].replaceAll('v.', 'p.')}
  `).all(...params, opts.limit, (opts.page - 1) * opts.limit, viewer.id, viewer.id) as any[];

  const videos = rows.map((r) => {
    const { history_id, seen_id, position_seconds, watch_time_seconds, measured, categories_json: _c, ...video } = r;
    const done = position_seconds > 0 ? position_seconds : watch_time_seconds ?? 0;
    const watchedPercent = measured > 0 ? Math.min(100, Math.round((100 * done) / measured)) : 0;
    return { ...video, isNew: history_id === null && seen_id === null, watchedPercent } as SubscriptionVideo;
  });
  return { videos, total };
}

export interface SubscribedChannel {
  id: string;
  title: string;
  avatar_url: string | null;
  subscribedAt: number;
  videoCount: number;
  newCount: number;
  /** YYYYMMDD of the newest video, or null. */
  lastUploadDate: string | null;
  /** The same as a time (UTC midnight), or when the newest video was added. */
  lastUploadAt: number | null;
  categories: string[];
}

export function querySubscribedChannels(db: Database.Database, viewer: VideoViewer, now: number = Date.now()): SubscribedChannel[] {
  const visible = videoVisibilitySql(viewer);
  const channelVisible = channelVisibilitySql(viewer);
  const rows = db.prepare(`
    SELECT c.id, c.title, c.avatar_url, us.created_at AS subscribedAt,
           COUNT(v.id) AS videoCount,
           COALESCE(SUM(CASE WHEN v.created_at >= ? AND uh.video_id IS NULL AND sv.video_id IS NULL THEN 1 ELSE 0 END), 0) AS newCount,
           MAX(v.upload_date) AS lastUploadDate,
           MAX(v.created_at) AS lastAddedAt
    FROM user_subscriptions us
    JOIN channels c ON c.id = us.channel_id
    LEFT JOIN videos v ON v.channel_id = c.id
      AND v.download_status = 'completed'
      AND v.id NOT IN (SELECT video_id FROM user_hidden_videos WHERE user_id = ?)
      AND ${visible.sql}
    LEFT JOIN user_history uh ON uh.user_id = us.user_id AND uh.video_id = v.id
    LEFT JOIN user_seen_videos sv ON sv.user_id = us.user_id AND sv.video_id = v.id
    WHERE us.user_id = ? AND ${channelVisible.sql}
    GROUP BY c.id
    ORDER BY lastUploadDate IS NULL, lastUploadDate DESC, lastAddedAt DESC, c.title
  `).all(now - NEW_WINDOW_MS, viewer.id, ...visible.params, viewer.id, ...channelVisible.params) as any[];
  if (rows.length === 0) return [];

  const categoryRows = db.prepare(`
    SELECT v.channel_id, j.value AS category, COUNT(*) AS n
    FROM videos v
    JOIN channels c ON c.id = v.channel_id
    JOIN json_each(CASE WHEN json_valid(v.categories) THEN v.categories ELSE '[]' END) j
    WHERE v.download_status = 'completed' AND v.categories IS NOT NULL
      AND v.channel_id IN (SELECT value FROM json_each(?))
      AND ${visible.sql}
    GROUP BY v.channel_id, j.value
  `).all(JSON.stringify(rows.map((r) => r.id)), ...visible.params) as { channel_id: string; category: string; n: number }[];
  const categories = new Map<string, { category: string; n: number }[]>();
  for (const r of categoryRows) {
    if (typeof r.category !== 'string' || r.category === '') continue;
    const list = categories.get(r.channel_id) ?? [];
    list.push(r);
    categories.set(r.channel_id, list);
  }

  return rows.map(({ lastAddedAt, ...r }) => {
    const d: string | null = r.lastUploadDate;
    const lastUploadAt = d && /^\d{8}$/.test(d) ? Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8)) : lastAddedAt ?? null;
    return {
      ...r,
      lastUploadAt,
      categories: (categories.get(r.id) ?? []).sort((a, b) => b.n - a.n || (a.category < b.category ? -1 : 1)).slice(0, 3).map((x) => x.category),
    };
  });
}

/** Marks these videos seen (only ones the viewer may see); returns how many marks are new. */
export function markVideosSeen(db: Database.Database, viewer: VideoViewer, videoIds: string[], now: number = Date.now()): number {
  if (videoIds.length === 0) return 0;
  const visible = videoVisibilitySql(viewer);
  return db.prepare(`
    INSERT OR IGNORE INTO user_seen_videos (user_id, video_id, seen_at)
    SELECT ?, v.id, ?
    FROM videos v JOIN channels c ON c.id = v.channel_id
    WHERE v.id IN (SELECT value FROM json_each(?)) AND ${visible.sql}
  `).run(viewer.id, now, JSON.stringify(videoIds), ...visible.params).changes;
}

/** Marks every still-new video of the followed channels seen. */
export function markAllSubscriptionsSeen(db: Database.Database, viewer: VideoViewer, now: number = Date.now()): number {
  const visible = videoVisibilitySql(viewer);
  return db.prepare(`
    INSERT OR IGNORE INTO user_seen_videos (user_id, video_id, seen_at)
    SELECT ?, v.id, ?
    FROM user_subscriptions us
    JOIN videos v ON v.channel_id = us.channel_id
    JOIN channels c ON c.id = v.channel_id
    LEFT JOIN user_history uh ON uh.user_id = us.user_id AND uh.video_id = v.id
    WHERE us.user_id = ? AND v.download_status = 'completed' AND uh.video_id IS NULL AND ${visible.sql}
  `).run(viewer.id, now, viewer.id, ...visible.params).changes;
}
