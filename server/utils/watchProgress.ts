import type Database from 'better-sqlite3';
import { videoVisibilitySql, type VideoViewer } from './videoAccess';

// Server-side resume positions (user_history.position_seconds), shared by the
// "Continue watching" list, the home feed and the recommendations (which
// leave started videos to "Continue watching").

/** Below this position there is nothing worth resuming. */
export const RESUME_MIN_SECONDS = 10;
/** Past this share of the video it counts as watched. */
export const RESUME_DONE_RATIO = 0.95;

/** The duration a history row is measured against: what the player reported, else the stored one. */
export const effectiveDurationSql = (h = 'h', v = 'v') => `COALESCE(${h}.duration_seconds, ${v}.duration)`;

/** True for a history row `h` of video `v` that was started and not finished. */
export function inProgressSql(h = 'h', v = 'v'): string {
  const d = effectiveDurationSql(h, v);
  return `(${h}.position_seconds >= ${RESUME_MIN_SECONDS} AND (${d} IS NULL OR ${d} <= 0 OR ${h}.position_seconds < ${RESUME_DONE_RATIO} * ${d}))`;
}

/** True for a history row `h` of video `v` that was watched to (nearly) the end. */
export function completedSql(h = 'h', v = 'v'): string {
  const d = effectiveDurationSql(h, v);
  return `(${d} > 0 AND (${h}.position_seconds >= ${RESUME_DONE_RATIO} * ${d} OR ${h}.watch_time_seconds >= 0.9 * ${d}))`;
}

export interface ContinueVideo {
  id: string;
  title: string;
  duration: number | null;
  view_count: number | null;
  upload_date: string | null;
  local_video_path: string | null;
  local_thumbnail_path: string | null;
  was_live: number;
  is_short: number;
  channel_id: string;
  channel_title: string;
  channel_avatar: string | null;
  positionSeconds: number;
  durationSeconds: number | null;
  /** 0..1 (0 when the duration is unknown). */
  progress: number;
}

/** The viewer's started long videos, most recently moved position first. */
export function queryContinueWatching(db: Database.Database, viewer: VideoViewer, limit: number, excludeIds: Set<string> = new Set()): ContinueVideo[] {
  const visible = videoVisibilitySql(viewer);
  const rows = db.prepare(`
    SELECT v.id, v.title, v.duration, v.view_count, v.upload_date, v.local_video_path, v.local_thumbnail_path,
           v.was_live, v.is_short, v.channel_id, c.title AS channel_title, c.avatar_url AS channel_avatar,
           h.position_seconds AS positionSeconds, ${effectiveDurationSql()} AS durationSeconds
    FROM user_history h
    JOIN videos v ON v.id = h.video_id
    JOIN channels c ON c.id = v.channel_id
    LEFT JOIN user_hidden_videos hv ON hv.user_id = h.user_id AND hv.video_id = v.id
    WHERE h.user_id = ?
      AND hv.video_id IS NULL
      AND v.download_status = 'completed'
      AND v.is_short = 0
      AND ${inProgressSql()}
      AND ${visible.sql}
    ORDER BY COALESCE(h.position_updated_at, h.watched_at) DESC, v.id
    LIMIT ?
  `).all(viewer.id, ...visible.params, Math.trunc(limit) + excludeIds.size) as Omit<ContinueVideo, 'progress'>[];
  return rows
    .filter((r) => !excludeIds.has(r.id))
    .slice(0, Math.trunc(limit))
    .map((r) => ({
      ...r,
      progress: r.durationSeconds && r.durationSeconds > 0 ? Math.min(1, Math.max(0, r.positionSeconds / r.durationSeconds)) : 0,
    }));
}
