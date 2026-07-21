import type Database from 'better-sqlite3';

export interface RecommendedVideo {
  id: string;
  title: string;
  description: string | null;
  duration: number | null;
  view_count: number | null;
  local_video_path: string | null;
  local_thumbnail_path: string | null;
  is_short: number;
  channel_id: string;
  upload_date: string | null;
  channel_title: string;
  channel_avatar: string | null;
}

const CANDIDATE_POOL_SIZE = 500;

export function getRecommendedVideos(
  db: Database.Database,
  userId: string,
  opts: { type: 'short' | 'video' | 'all'; limit: number }
): RecommendedVideo[] {
  // 1. Get user channel watch times
  const channelTimes = db.prepare(`
    SELECT v.channel_id, SUM(uh.watch_time_seconds) as total_time
    FROM user_history uh
    JOIN videos v ON uh.video_id = v.id
    WHERE uh.user_id = ?
    GROUP BY v.channel_id
  `).all(userId) as { channel_id: string; total_time: number }[];

  const channelWeights = new Map<string, number>();
  for (const row of channelTimes) {
    channelWeights.set(row.channel_id, row.total_time);
  }

  // 2. Get user watch time per video to penalize already watched videos
  const watchedVideos = db.prepare(`
    SELECT video_id, watch_time_seconds
    FROM user_history
    WHERE user_id = ?
  `).all(userId) as { video_id: string; watch_time_seconds: number }[];

  const watchedTimeMap = new Map<string, number>();
  for (const row of watchedVideos) {
    watchedTimeMap.set(row.video_id, row.watch_time_seconds);
  }

  // 3. Get a bounded pool of completed videos with channel info to score.
  const isShortClause = opts.type === 'short' ? 'AND v.is_short = 1' : opts.type === 'video' ? 'AND v.is_short = 0' : '';
  const candidates = db.prepare(`
    SELECT v.id, v.title, v.description, v.duration, v.view_count, v.local_video_path, v.local_thumbnail_path, v.is_short, v.channel_id, v.upload_date,
           c.title as channel_title, c.avatar_url as channel_avatar
    FROM videos v
    JOIN channels c ON v.channel_id = c.id
    WHERE v.download_status = 'completed' ${isShortClause}
      AND v.id NOT IN (SELECT video_id FROM user_hidden_videos WHERE user_id = ?)
      AND (
        (v.visibility IN ('public', 'private') AND c.visibility IN ('public', 'private'))
        OR
        v.channel_id IN (SELECT channel_id FROM user_channel_access WHERE user_id = ?)
      )
    ORDER BY v.upload_date DESC
    LIMIT ?
  `).all(userId, userId, CANDIDATE_POOL_SIZE) as RecommendedVideo[];

  if (candidates.length === 0) {
    return [];
  }

  // 4. Calculate score for each candidate
  const scoredCandidates = candidates.map((video) => {
    let score = 10; // Base score (minimum weight)

    const weight = channelWeights.get(video.channel_id) || 0;
    score += weight;

    const watchedTime = watchedTimeMap.get(video.id) || 0;
    if (watchedTime > 0) {
      if (video.duration && watchedTime >= video.duration - 10) {
        score *= 0.05;
      } else {
        score *= 0.5;
      }
    }

    score *= (0.8 + Math.random() * 0.4);

    return { video, score };
  });

  scoredCandidates.sort((a, b) => b.score - a.score);

  return scoredCandidates.slice(0, opts.limit).map(c => c.video);
}
