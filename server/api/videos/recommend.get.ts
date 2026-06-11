import { defineEventHandler, createError } from 'h3';

export default defineEventHandler(async (event) => {
  const session = await getUserFromSession(event);
  if (!session) {
    throw createError({ statusCode: 401, statusMessage: 'Non autorisé.' });
  }

  const db = getDb();

  // 1. Get user channel watch times
  const channelTimes = db.prepare(`
    SELECT v.channel_id, SUM(uh.watch_time_seconds) as total_time
    FROM user_history uh
    JOIN videos v ON uh.video_id = v.id
    WHERE uh.user_id = ?
    GROUP BY v.channel_id
  `).all(session.id) as { channel_id: string; total_time: number }[];

  const channelWeights = new Map<string, number>();
  for (const row of channelTimes) {
    channelWeights.set(row.channel_id, row.total_time);
  }

  // 2. Get user watch time per video to penalize already watched videos
  const watchedVideos = db.prepare(`
    SELECT video_id, watch_time_seconds
    FROM user_history
    WHERE user_id = ?
  `).all(session.id) as { video_id: string; watch_time_seconds: number }[];

  const watchedTimeMap = new Map<string, number>();
  for (const row of watchedVideos) {
    watchedTimeMap.set(row.video_id, row.watch_time_seconds);
  }

  // 3. Get all completed videos with channel info
  const candidates = db.prepare(`
    SELECT v.id, v.title, v.description, v.duration, v.view_count, v.local_video_path, v.local_thumbnail_path, v.is_short, v.channel_id, v.upload_date,
           c.title as channel_title, c.avatar_url as channel_avatar
    FROM videos v
    JOIN channels c ON v.channel_id = c.id
    WHERE v.download_status = 'completed' AND v.is_short = 1
      AND v.id NOT IN (SELECT video_id FROM user_hidden_videos WHERE user_id = ?)
      AND (
        (v.visibility IN ('public', 'private') AND c.visibility IN ('public', 'private'))
        OR
        v.channel_id IN (SELECT channel_id FROM user_channel_access WHERE user_id = ?)
      )
  `).all(session.id, session.id) as any[];

  if (candidates.length === 0) {
    return { videos: [] };
  }

  // 4. Calculate score for each candidate
  const scoredCandidates = candidates.map((video) => {
    let score = 10; // Base score (minimum weight)
    
    // Add weights from matching channel
    const weight = channelWeights.get(video.channel_id) || 0;
    score += weight; // Increments score by total seconds watched in this channel

    // Penalize if watched
    const watchedTime = watchedTimeMap.get(video.id) || 0;
    if (watchedTime > 0) {
      if (video.duration && watchedTime >= video.duration - 10) {
        // Fully watched video penalty
        score *= 0.05;
      } else {
        // Partially watched video adjustment
        score *= 0.5;
      }
    }

    // Add a small random factor to prevent absolute locking and allow discovery
    score *= (0.8 + Math.random() * 0.4);

    return { video, score };
  });

  // Sort by score descending
  scoredCandidates.sort((a, b) => b.score - a.score);

  // Take top 15 and return
  const recommendedVideos = scoredCandidates.slice(0, 15).map(c => c.video);

  return { videos: recommendedVideos };
});
