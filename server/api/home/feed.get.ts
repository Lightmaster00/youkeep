import { defineEventHandler } from 'h3';
import { getRecommendedVideos } from '../../utils/recommend';
import { getUserFromSession } from '../../utils/auth';
import type { UserSession } from '../../utils/auth';

interface FeedVideo {
  id: string;
  title: string;
  duration: number | null;
  view_count: number | null;
  upload_date: string | null;
  created_at?: number; // present on pool-sourced videos (recent/popular/subscriptions), absent on suggestion-sourced ones — not read by any consumer, so this is safe
  local_video_path: string | null;
  local_thumbnail_path: string | null;
  was_live?: number;
  channel_id: string;
  channel_title: string;
  channel_avatar: string | null;
}

function getVisibilityFilter(session: UserSession | null): { sql: string; params: any[] } {
  if (!session) {
    return { sql: "v.visibility = 'public' AND c.visibility = 'public'", params: [] };
  }
  if (session.role === 'admin') {
    return { sql: '1=1', params: [] };
  }
  return {
    sql: `(
      (v.visibility IN ('public', 'private') AND c.visibility IN ('public', 'private'))
      OR v.channel_id IN (SELECT channel_id FROM user_channel_access WHERE user_id = ?)
    )`,
    params: [session.id]
  };
}

function getHiddenFilter(session: UserSession | null): { sql: string; params: any[] } {
  if (!session) return { sql: '', params: [] };
  return { sql: 'AND v.id NOT IN (SELECT video_id FROM user_hidden_videos WHERE user_id = ?)', params: [session.id] };
}

const FEED_VIDEO_COLUMNS = `
  v.id, v.title, v.duration, v.view_count, v.upload_date, v.created_at,
  v.local_video_path, v.local_thumbnail_path, v.was_live, v.channel_id,
  c.title as channel_title, c.avatar_url as channel_avatar
`;

export default defineEventHandler(async (event) => {
  const session = await getUserFromSession(event);
  const db = getDb();
  const visibility = getVisibilityFilter(session);
  const hidden = getHiddenFilter(session);

  const popularPool = db.prepare(`
    SELECT ${FEED_VIDEO_COLUMNS},
           (SELECT COUNT(DISTINCT user_id) FROM user_history WHERE video_id = v.id) as local_viewers
    FROM videos v
    JOIN channels c ON v.channel_id = c.id
    WHERE v.download_status = 'completed'
      AND ${visibility.sql}
      ${hidden.sql}
    ORDER BY local_viewers DESC, v.view_count DESC
    LIMIT 30
  `).all(...visibility.params, ...hidden.params) as (FeedVideo & { local_viewers: number })[];

  const recentPool = db.prepare(`
    SELECT ${FEED_VIDEO_COLUMNS}
    FROM videos v
    JOIN channels c ON v.channel_id = c.id
    WHERE v.download_status = 'completed'
      AND ${visibility.sql}
      ${hidden.sql}
    ORDER BY v.created_at DESC
    LIMIT 30
  `).all(...visibility.params, ...hidden.params) as FeedVideo[];

  const usedIds = new Set<string>();

  // Claims every video's id into usedIds so later sections can't re-include
  // videos already picked by an earlier section, and returns the same list
  // for convenient inline use.
  const claim = (videos: FeedVideo[]) => {
    for (const v of videos) usedIds.add(v.id);
    return videos;
  };

  // --- Featured block ---
  const large = popularPool[0] ?? null;
  if (large) usedIds.add(large.id);

  // Videos from channels the user is subscribed to are reserved for the
  // dedicated "subscriptions" section below and are not spent filling the
  // generic featured "small" slots, which draw from unsubscribed content.
  let subscribedChannelIds: Set<string> = new Set();
  if (session) {
    const subRows = db.prepare(`
      SELECT channel_id FROM user_subscriptions WHERE user_id = ?
    `).all(session.id) as { channel_id: string }[];
    subscribedChannelIds = new Set(subRows.map(r => r.channel_id));
  }

  const small: FeedVideo[] = [];
  if (session) {
    const suggestions = getRecommendedVideos(db, session.id, { type: 'all', limit: 10 }) as unknown as FeedVideo[];
    const suggestion = suggestions.find(v => !usedIds.has(v.id) && !subscribedChannelIds.has(v.channel_id));
    if (suggestion) {
      small.push(suggestion);
      usedIds.add(suggestion.id);
    }
  }
  for (const v of recentPool) {
    if (small.length >= 4) break;
    if (usedIds.has(v.id)) continue;
    if (subscribedChannelIds.has(v.channel_id)) continue;
    small.push(v);
    usedIds.add(v.id);
  }

  // --- Sections ---
  const sections: any[] = [];

  const recentSection = claim(recentPool.filter(v => !usedIds.has(v.id)).slice(0, 15));
  if (recentSection.length > 0) {
    sections.push({ id: 'recent', title: 'Ajoutés récemment', videos: recentSection });
  }

  const popularSection = claim(popularPool.filter(v => !usedIds.has(v.id)).slice(0, 15));
  if (popularSection.length > 0) {
    sections.push({ id: 'popular', title: 'Populaires', videos: popularSection });
  }

  if (session) {
    const suggestions = getRecommendedVideos(db, session.id, { type: 'all', limit: 20 }) as unknown as FeedVideo[];
    const suggestedSection = claim(suggestions.filter(v => !usedIds.has(v.id)).slice(0, 15));
    if (suggestedSection.length > 0) {
      sections.push({ id: 'suggested', title: 'Suggéré pour toi', videos: suggestedSection });
    }

    const subChannels = db.prepare(`
      SELECT c.id, c.title, c.avatar_url
      FROM channels c
      JOIN user_subscriptions us ON us.channel_id = c.id
      WHERE us.user_id = ?
      ORDER BY us.created_at DESC
    `).all(session.id) as { id: string; title: string; avatar_url: string | null }[];

    const subscriptionChannels: any[] = [];
    for (const ch of subChannels) {
      if (subscriptionChannels.length >= 8) break;
      const chVideos = db.prepare(`
        SELECT ${FEED_VIDEO_COLUMNS}
        FROM videos v
        JOIN channels c ON v.channel_id = c.id
        WHERE v.channel_id = ?
          AND v.download_status = 'completed'
          AND ${visibility.sql}
          ${hidden.sql}
        ORDER BY v.created_at DESC
        LIMIT 20
      `).all(ch.id, ...visibility.params, ...hidden.params) as FeedVideo[];
      const filtered = chVideos.filter(v => !usedIds.has(v.id));
      if (filtered.length >= 2) {
        subscriptionChannels.push({
          channelId: ch.id,
          channelTitle: ch.title,
          channelAvatar: ch.avatar_url,
          videos: claim(filtered.slice(0, 12))
        });
      }
    }

    if (subscriptionChannels.length > 0) {
      sections.push({ id: 'subscriptions', title: 'Par chaîne suivie', channels: subscriptionChannels });
    }
  }

  return {
    featured: { large, small },
    sections
  };
});
