import { defineEventHandler } from 'h3';
import { getRecommendedVideos } from '../../utils/recommend';
import { getUserFromSession } from '../../utils/auth';
import type { UserSession } from '../../utils/auth';
import { getDisplayView } from '../../utils/displayPrefsStore';
import { APP_DEFAULTS } from '../../../shared/displayPrefs';
import type { DisplayPrefs, HomeSectionId, PopularRanking } from '../../../shared/displayPrefs';

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

const SECTION_TITLES: Record<HomeSectionId, string> = {
  recent: 'Ajoutés récemment',
  popular: 'Populaires',
  suggested: 'Suggéré pour toi',
  subscriptions: 'Par chaîne suivie',
};

const POPULAR_ORDER: Record<PopularRanking, string> = {
  localViewers: 'local_viewers DESC, v.view_count DESC',
  youtubeViews: 'v.view_count DESC',
  trending7d: 'recent_viewers DESC, v.view_count DESC',
  watchTime: 'watch_total DESC, v.view_count DESC',
};

const POOL_SIZE = 100;
const TRENDING_WINDOW_MS = 7 * 24 * 3600 * 1000;

function readPrefs(db: any, userId: string | null): DisplayPrefs {
  try {
    return getDisplayView(db, userId).effective;
  } catch {
    return APP_DEFAULTS;
  }
}

export default defineEventHandler(async (event) => {
  const session = await getUserFromSession(event);
  const db = getDb();
  const visibility = getVisibilityFilter(session);
  const hidden = getHiddenFilter(session);

  const prefs = readPrefs(db, session?.id ?? null);
  const cutoff = Date.now() - TRENDING_WINDOW_MS;

  const popularPool = db.prepare(`
    SELECT ${FEED_VIDEO_COLUMNS},
           (SELECT COUNT(DISTINCT user_id) FROM user_history WHERE video_id = v.id) as local_viewers,
           (SELECT COUNT(DISTINCT user_id) FROM user_history WHERE video_id = v.id AND watched_at >= ${cutoff}) as recent_viewers,
           (SELECT COALESCE(SUM(watch_time_seconds), 0) FROM user_history WHERE video_id = v.id) as watch_total
    FROM videos v
    JOIN channels c ON v.channel_id = c.id
    WHERE v.download_status = 'completed'
      AND ${visibility.sql}
      ${hidden.sql}
    ORDER BY ${POPULAR_ORDER[prefs.popularRanking] ?? POPULAR_ORDER.localViewers}
    LIMIT ${POOL_SIZE}
  `).all(...visibility.params, ...hidden.params) as FeedVideo[];

  const recentPool = db.prepare(`
    SELECT ${FEED_VIDEO_COLUMNS}
    FROM videos v
    JOIN channels c ON v.channel_id = c.id
    WHERE v.download_status = 'completed'
      AND ${visibility.sql}
      ${hidden.sql}
    ORDER BY v.created_at DESC
    LIMIT ${POOL_SIZE}
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
  let large: FeedVideo | null = null;
  const small: FeedVideo[] = [];

  // Videos from channels the user is subscribed to are reserved for the
  // dedicated "subscriptions" section and are not spent filling the generic
  // featured "small" slots, which draw from unsubscribed content.
  let subscribedChannelIds: Set<string> = new Set();
  if (session) {
    const subRows = db.prepare(`
      SELECT channel_id FROM user_subscriptions WHERE user_id = ?
    `).all(session.id) as { channel_id: string }[];
    subscribedChannelIds = new Set(subRows.map(r => r.channel_id));
  }

  if (prefs.homeHero) {
    large = popularPool[0] ?? null;
    if (large) usedIds.add(large.id);

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
  }

  // --- Sections, built in the configured order ---
  const sections: any[] = [];
  const rowSize = prefs.rowSize;

  const builders: Record<HomeSectionId, () => any | null> = {
    recent: () => {
      const videos = claim(recentPool.filter(v => !usedIds.has(v.id)).slice(0, rowSize));
      return videos.length > 0 ? { id: 'recent', title: SECTION_TITLES.recent, videos } : null;
    },
    popular: () => {
      const videos = claim(popularPool.filter(v => !usedIds.has(v.id)).slice(0, rowSize));
      return videos.length > 0 ? { id: 'popular', title: SECTION_TITLES.popular, videos } : null;
    },
    suggested: () => {
      if (!session) return null;
      const suggestions = getRecommendedVideos(db, session.id, { type: 'all', limit: Math.max(20, rowSize + 10) }) as unknown as FeedVideo[];
      const videos = claim(suggestions.filter(v => !usedIds.has(v.id)).slice(0, rowSize));
      return videos.length > 0 ? { id: 'suggested', title: SECTION_TITLES.suggested, videos } : null;
    },
    subscriptions: () => {
      if (!session) return null;
      const subChannels = db.prepare(`
        SELECT c.id, c.title, c.avatar_url
        FROM channels c
        JOIN user_subscriptions us ON us.channel_id = c.id
        WHERE us.user_id = ?
        ORDER BY us.created_at DESC
      `).all(session.id) as { id: string; title: string; avatar_url: string | null }[];

      const subscriptionChannels: any[] = [];
      for (const ch of subChannels) {
        if (subscriptionChannels.length >= prefs.subscriptionChannels) break;
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
      return subscriptionChannels.length > 0
        ? { id: 'subscriptions', title: SECTION_TITLES.subscriptions, channels: subscriptionChannels }
        : null;
    },
  };

  for (const sectionId of prefs.homeSections) {
    const section = builders[sectionId]?.();
    if (section) sections.push(section);
  }

  return {
    featured: { large, small },
    sections
  };
});
