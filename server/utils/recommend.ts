import type Database from 'better-sqlite3';
import { videoVisibilitySql, type VideoViewer } from './videoAccess';
import { parseLabelList } from './videoInfo';
import {
  buildProfile,
  rankCandidates,
  rankSimilar,
  type HistoryItem,
  type Ranked,
  type Reason,
  type ScoreCandidate,
  type UserProfile,
} from './recommendScore';

// The database side of the recommendations: the candidate pool, the viewer's
// profile and the "because you watched" seed. Scoring is in recommendScore.ts.

export interface RecommendedVideo {
  id: string;
  title: string;
  description: string | null;
  duration: number | null;
  view_count: number | null;
  local_video_path: string | null;
  local_thumbnail_path: string | null;
  is_short: number;
  was_live?: number;
  channel_id: string;
  upload_date: string | null;
  created_at: number | null;
  channel_title: string;
  channel_avatar: string | null;
  publicly_shareable: number;
  categories: string[];
  reason?: Reason;
}

export type RecommendType = 'short' | 'video' | 'all';

export interface RecommendOptions {
  type: RecommendType;
  limit: number;
  /** Jitter seed; the current hour by default (same order within the hour). */
  seed?: string;
  /** Ids to leave out (videos already on the page). */
  exclude?: Iterable<string>;
  /** Attach the English `reason` to each video (default true). */
  reasonLabels?: boolean;
  now?: number;
}

export const NEWEST_POOL_SIZE = 600;
export const POPULAR_POOL_SIZE = 200;
/** History rows the profile is built from (the most recent ones; older ones weigh almost nothing). */
export const PROFILE_HISTORY_ROWS = 2000;

type PoolRow = Omit<RecommendedVideo, 'categories' | 'reason'> & { categories_json: string | null; tags_json: string | null };
export type PoolVideo = RecommendedVideo & ScoreCandidate;

export const defaultSeed = (now: number = Date.now()) => String(Math.floor(now / 3_600_000));

function typeClause(type: RecommendType): string {
  return type === 'short' ? 'AND v.is_short = 1' : type === 'video' ? 'AND v.is_short = 0' : '';
}

/**
 * The visible, completed videos worth scoring: the newest ones plus the most
 * viewed ones, de-duplicated, with their local viewer counts. Hidden videos
 * of the viewer are left out.
 */
export function loadCandidatePool(db: Database.Database, viewer: VideoViewer | null, type: RecommendType): PoolVideo[] {
  const visible = videoVisibilitySql(viewer);
  const hidden = viewer ? 'AND v.id NOT IN (SELECT video_id FROM user_hidden_videos WHERE user_id = ?)' : '';
  const hiddenParams = viewer ? [viewer.id] : [];
  const select = (order: string, limit: number) => db.prepare(`
    SELECT v.id, v.title, v.description, v.duration, v.view_count, v.local_video_path, v.local_thumbnail_path,
           v.is_short, v.was_live, v.channel_id, v.upload_date, v.created_at,
           v.categories AS categories_json, v.tags AS tags_json,
           c.title AS channel_title, c.avatar_url AS channel_avatar,
           -- Whether the plain /watch link works for anyone (the Share button).
           CASE WHEN COALESCE(v.visibility, 'public') = 'public' AND COALESCE(c.visibility, 'public') = 'public' THEN 1 ELSE 0 END AS publicly_shareable
    FROM videos v
    JOIN channels c ON v.channel_id = c.id
    WHERE v.download_status = 'completed' ${typeClause(type)}
      ${hidden}
      AND ${visible.sql}
    ORDER BY ${order}
    LIMIT ${limit}
  `).all(...hiddenParams, ...visible.params) as PoolRow[];

  const byId = new Map<string, PoolRow>();
  for (const row of [...select('v.created_at DESC, v.id', NEWEST_POOL_SIZE), ...select('v.view_count DESC, v.id', POPULAR_POOL_SIZE)]) {
    if (!byId.has(row.id)) byId.set(row.id, row);
  }
  if (byId.size === 0) return [];

  // One grouped read of the pool's local viewers (no per-row subquery).
  const viewers = new Map<string, number>();
  const counted = db.prepare(`
    SELECT video_id, COUNT(*) AS n FROM user_history
    WHERE video_id IN (SELECT value FROM json_each(?))
    GROUP BY video_id
  `).all(JSON.stringify([...byId.keys()])) as { video_id: string; n: number }[];
  for (const r of counted) viewers.set(r.video_id, r.n);

  return [...byId.values()].map(({ categories_json, tags_json, ...row }) => ({
    ...row,
    categories: parseLabelList(categories_json),
    tags: parseLabelList(tags_json),
    local_viewers: viewers.get(row.id) ?? 0,
  }));
}

/** The viewer's taste (recent history, subscriptions), and every video they watched among `candidateIds`. */
export function loadProfile(db: Database.Database, viewer: VideoViewer | null, now: number, candidateIds: string[] = []): UserProfile {
  if (!viewer) return buildProfile([], [], now);
  const visible = videoVisibilitySql(viewer);
  const rows = db.prepare(`
    SELECT h.video_id, h.watch_time_seconds, h.position_seconds, COALESCE(h.duration_seconds, v.duration) AS duration,
           h.watched_at, v.channel_id, v.title, v.categories, v.tags
    FROM user_history h
    JOIN videos v ON v.id = h.video_id
    JOIN channels c ON c.id = v.channel_id
    WHERE h.user_id = ? AND ${visible.sql}
    ORDER BY h.watched_at DESC
    LIMIT ${PROFILE_HISTORY_ROWS}
  `).all(viewer.id, ...visible.params) as any[];
  const history: HistoryItem[] = rows.map((r) => ({
    videoId: r.video_id,
    title: r.title,
    channelId: r.channel_id,
    watchSeconds: r.watch_time_seconds ?? 0,
    durationSeconds: r.duration ?? null,
    positionSeconds: r.position_seconds ?? 0,
    watchedAt: r.watched_at,
    categories: parseLabelList(r.categories),
    tags: parseLabelList(r.tags),
  }));
  const subs = (db.prepare('SELECT channel_id FROM user_subscriptions WHERE user_id = ?').all(viewer.id) as { channel_id: string }[])
    .map((r) => r.channel_id);
  const profile = buildProfile(history, subs, now);
  // Watched long ago (outside the recent rows): still never recommended again.
  if (candidateIds.length > 0) {
    const watched = db.prepare(`
      SELECT video_id FROM user_history
      WHERE user_id = ? AND video_id IN (SELECT value FROM json_each(?))
        AND (watch_time_seconds > 0 OR position_seconds >= 10)
    `).all(viewer.id, JSON.stringify(candidateIds)) as { video_id: string }[];
    for (const r of watched) profile.excluded.add(r.video_id);
  }
  return profile;
}

function present(ranked: Ranked<PoolVideo>[], reasonLabels: boolean): RecommendedVideo[] {
  return ranked.map(({ video, reason }) => {
    const { tags: _tags, local_viewers: _lv, ...rest } = video;
    return reasonLabels ? { ...rest, reason } : rest;
  });
}

export function getRecommendedVideos(db: Database.Database, viewer: VideoViewer | null, opts: RecommendOptions): RecommendedVideo[] {
  const now = opts.now ?? Date.now();
  const pool = loadCandidatePool(db, viewer, opts.type);
  if (pool.length === 0) return [];
  const profile = loadProfile(db, viewer, now, pool.map((v) => v.id));
  const ranked = rankCandidates(pool, profile, {
    now,
    seed: opts.seed ?? defaultSeed(now),
    limit: opts.limit,
    exclude: opts.exclude ? new Set(opts.exclude) : undefined,
  });
  return present(ranked, opts.reasonLabels !== false);
}

/**
 * "Because you watched <title>": videos like the viewer's most recently
 * watched long video (same channel, categories, tags), never already watched.
 * Null when there is no such video or nothing similar.
 */
export function getBecauseYouWatched(
  db: Database.Database,
  viewer: VideoViewer,
  opts: { limit: number; seed?: string; exclude?: Iterable<string>; now?: number },
): { seed: { id: string; title: string }; videos: RecommendedVideo[] } | null {
  const now = opts.now ?? Date.now();
  const visible = videoVisibilitySql(viewer);
  const seedRow = db.prepare(`
    SELECT v.id, v.title, v.channel_id, v.categories, v.tags
    FROM user_history h
    JOIN videos v ON v.id = h.video_id
    JOIN channels c ON c.id = v.channel_id
    WHERE h.user_id = ? AND h.watch_time_seconds > 0 AND v.is_short = 0 AND v.download_status = 'completed'
      AND ${visible.sql}
    ORDER BY h.watched_at DESC
    LIMIT 1
  `).get(viewer.id, ...visible.params) as { id: string; title: string; channel_id: string; categories: string | null; tags: string | null } | undefined;
  if (!seedRow) return null;
  const pool = loadCandidatePool(db, viewer, 'video');
  // Same-channel videos may be older than the pool: add the channel's newest ones.
  const channelRows = db.prepare(`
    SELECT v.id FROM videos v JOIN channels c ON c.id = v.channel_id
    WHERE v.channel_id = ? AND v.download_status = 'completed' AND v.is_short = 0 AND ${visible.sql}
    ORDER BY v.upload_date DESC LIMIT 50
  `).all(seedRow.channel_id, ...visible.params) as { id: string }[];
  const inPool = new Set(pool.map((v) => v.id));
  const missing = channelRows.map((r) => r.id).filter((id) => !inPool.has(id));
  const extra = missing.length > 0 ? loadVideosByIds(db, viewer, missing) : [];
  const candidates = [...pool, ...extra];
  const profile = loadProfile(db, viewer, now, candidates.map((v) => v.id));
  const ranked = rankSimilar(candidates, {
    id: seedRow.id,
    title: seedRow.title,
    channel_id: seedRow.channel_id,
    categories: parseLabelList(seedRow.categories),
    tags: parseLabelList(seedRow.tags),
  }, profile, {
    now,
    seed: opts.seed ?? defaultSeed(now),
    limit: opts.limit,
    exclude: opts.exclude ? new Set(opts.exclude) : undefined,
  });
  if (ranked.length === 0) return null;
  return { seed: { id: seedRow.id, title: seedRow.title }, videos: present(ranked, true) };
}

/** Pool-shaped rows for these ids (visible, completed, not hidden), local viewers left at 0. */
function loadVideosByIds(db: Database.Database, viewer: VideoViewer, ids: string[]): PoolVideo[] {
  const visible = videoVisibilitySql(viewer);
  const rows = db.prepare(`
    SELECT v.id, v.title, v.description, v.duration, v.view_count, v.local_video_path, v.local_thumbnail_path,
           v.is_short, v.was_live, v.channel_id, v.upload_date, v.created_at,
           v.categories AS categories_json, v.tags AS tags_json,
           c.title AS channel_title, c.avatar_url AS channel_avatar,
           CASE WHEN COALESCE(v.visibility, 'public') = 'public' AND COALESCE(c.visibility, 'public') = 'public' THEN 1 ELSE 0 END AS publicly_shareable
    FROM videos v JOIN channels c ON c.id = v.channel_id
    WHERE v.id IN (SELECT value FROM json_each(?))
      AND v.download_status = 'completed'
      AND v.id NOT IN (SELECT video_id FROM user_hidden_videos WHERE user_id = ?)
      AND ${visible.sql}
  `).all(JSON.stringify(ids), viewer.id, ...visible.params) as PoolRow[];
  return rows.map(({ categories_json, tags_json, ...row }) => ({
    ...row, categories: parseLabelList(categories_json), tags: parseLabelList(tags_json), local_viewers: 0,
  }));
}
