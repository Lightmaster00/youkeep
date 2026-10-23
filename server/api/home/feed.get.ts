import { defineEventHandler } from 'h3';
import { createRecommendCache, getBecauseYouWatched, getRecommendedVideos, getViewerProfile } from '../../utils/recommend';
import { getUserFromSession } from '../../utils/auth';
import { applyVideoTextLanguage } from '../../utils/videoTranslations';
import type { UserSession } from '../../utils/auth';
import { getDisplayView } from '../../utils/displayPrefsStore';
import { isModuleEnabled } from '../../utils/modules';
import { queryRecentEpisodes, queryRecentTracks } from '../../utils/recentMedia';
import { queryContinueWatching } from '../../utils/watchProgress';
import {
  FEED_VIDEO_COLUMNS,
  queryCategoryVideos,
  queryCommonCategories,
  queryDiscoverChannels,
  queryHomePlaylists,
  queryShortsShelf,
  querySubscriptionLatest,
  type FeedVideo,
} from '../../utils/homeSections';
import { APP_DEFAULTS } from '../../../shared/displayPrefs';
import type { DisplayPrefs, HomeSectionId, PopularRanking } from '../../../shared/displayPrefs';

// GET /api/home/feed: { featured: { large, small }, sections: [...] }. Each
// section is { id, title, ... } with one payload key (videos, groups,
// playlists, channels, tracks or episodes), built in the viewer's order and
// left out when empty. A video appears at most once across the hero and the
// video rows. Long videos only, except the "shorts" shelf.

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

const SECTION_TITLES: Record<HomeSectionId, string> = {
  continue: 'Continue watching',
  subscriptions: 'From your subscriptions',
  forYou: 'Recommended for you',
  popular: 'Popular',
  becauseYouWatched: 'Because you watched',
  byCategory: 'Browse by category',
  shorts: 'Shorts',
  playlists: 'Your playlists',
  discoverChannels: 'Channels to discover',
  recentMusic: 'Recently added music',
  newEpisodes: 'New podcast episodes',
};

/** Rows of the byCategory section, and personal playlists shown. */
const CATEGORY_ROWS = 3;
const HOME_PLAYLISTS = 6;

const POPULAR_ORDER: Record<PopularRanking, string> = {
  localViewers: 'local_viewers DESC, v.view_count DESC',
  youtubeViews: 'v.view_count DESC',
  trending7d: 'recent_viewers DESC, v.view_count DESC',
  watchTime: 'watch_total DESC, v.view_count DESC',
};

// The one metric column each ranking orders by (youtubeViews uses a plain
// column), and the grouped aggregate it comes from. Keyed by the validated
// enum, so no user input reaches the SQL. Each aggregate reads user_history
// once and is joined, instead of a correlated count per video.
const POPULAR_METRIC = (cutoff: number): Record<PopularRanking, { column: string; join: string }> => ({
  localViewers: {
    column: 'COALESCE(pm.n, 0) as local_viewers',
    join: 'LEFT JOIN (SELECT video_id, COUNT(DISTINCT user_id) as n FROM user_history GROUP BY video_id) pm ON pm.video_id = v.id',
  },
  youtubeViews: { column: '', join: '' },
  trending7d: {
    column: 'COALESCE(pm.n, 0) as recent_viewers',
    join: `LEFT JOIN (SELECT video_id, COUNT(DISTINCT user_id) as n FROM user_history WHERE watched_at >= ${Math.trunc(cutoff)} GROUP BY video_id) pm ON pm.video_id = v.id`,
  },
  watchTime: {
    column: 'COALESCE(pm.n, 0) as watch_total',
    join: 'LEFT JOIN (SELECT video_id, SUM(watch_time_seconds) as n FROM user_history GROUP BY video_id) pm ON pm.video_id = v.id',
  },
});

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

  // Same SELECT/ORDER BY for the up-front pools (hero) and the lazy re-queries
  // done by the section builders. `limit` is a server-side integer. Every
  // video row of the home is long videos only: Shorts live on /shorts.
  const queryPool = (kind: 'popular' | 'newest', limit: number): FeedVideo[] => {
    const popular = kind === 'popular';
    const ranking: PopularRanking = POPULAR_ORDER[prefs.popularRanking] ? prefs.popularRanking : 'localViewers';
    const metric = popular ? POPULAR_METRIC(cutoff)[ranking] : { column: '', join: '' };
    return db.prepare(`
      SELECT ${FEED_VIDEO_COLUMNS}${metric.column ? `,\n             ${metric.column}` : ''}
      FROM videos v
      JOIN channels c ON v.channel_id = c.id
      ${metric.join}
      WHERE v.download_status = 'completed'
        AND v.is_short = 0
        AND ${visibility.sql}
        ${hidden.sql}
      ORDER BY ${popular ? POPULAR_ORDER[ranking] : 'v.created_at DESC'}
      LIMIT ${Math.trunc(limit)}
    `).all(...visibility.params, ...hidden.params) as FeedVideo[];
  };

  const popularPool = queryPool('popular', POOL_SIZE);
  // Newest videos: only the hero's small slots draw from it (there is no
  // "Recently added" row any more).
  const newestPool = queryPool('newest', POOL_SIZE);

  const usedIds = new Set<string>();
  // One candidate pool and viewer profile for every recommendation row of this request.
  const cache = createRecommendCache();

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
  // featured "small" slots, which draw from unsubscribed content. Only the hero
  // uses this set (the subscriptions section runs its own query), so the lookup
  // is skipped when the hero is off.
  let subscribedChannelIds: Set<string> = new Set();
  if (session && prefs.homeHero) {
    const subRows = db.prepare(`
      SELECT channel_id FROM user_subscriptions WHERE user_id = ?
    `).all(session.id) as { channel_id: string }[];
    subscribedChannelIds = new Set(subRows.map(r => r.channel_id));
  }

  if (prefs.homeHero) {
    // The pools hold long videos only, so the 16:9 hero is never a Short.
    large = popularPool[0] ?? null;
    if (large) usedIds.add(large.id);

    if (session) {
      const suggestions = getRecommendedVideos(db, session, { type: 'video', limit: 10, cache }) as unknown as FeedVideo[];
      const suggestion = suggestions.find(v => !usedIds.has(v.id) && !subscribedChannelIds.has(v.channel_id));
      if (suggestion) {
        small.push(suggestion);
        usedIds.add(suggestion.id);
      }
    }
    for (const v of newestPool) {
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

  // Lazy builders re-query sized from what earlier sections already claimed, so
  // moving 'popular' below big sections never starves it.
  const builders: Record<HomeSectionId, () => any | null> = {
    continue: () => {
      if (!session) return null;
      const videos = claim(queryContinueWatching(db, session, rowSize, usedIds) as unknown as FeedVideo[]);
      return videos.length > 0 ? { id: 'continue', title: SECTION_TITLES.continue, videos } : null;
    },
    subscriptions: () => {
      if (!session) return null;
      const videos = claim(querySubscriptionLatest(db, session, { limit: rowSize, maxChannels: prefs.subscriptionChannels, exclude: usedIds }));
      return videos.length > 0 ? { id: 'subscriptions', title: SECTION_TITLES.subscriptions, videos } : null;
    },
    forYou: () => {
      if (!session) return null;
      const videos = claim(getRecommendedVideos(db, session, { type: 'video', limit: rowSize, exclude: usedIds, cache }) as unknown as FeedVideo[]);
      return videos.length > 0 ? { id: 'forYou', title: SECTION_TITLES.forYou, videos } : null;
    },
    popular: () => {
      const videos = claim(queryPool('popular', usedIds.size + rowSize).filter(v => !usedIds.has(v.id)).slice(0, rowSize));
      return videos.length > 0 ? { id: 'popular', title: SECTION_TITLES.popular, videos } : null;
    },
    becauseYouWatched: () => {
      if (!session) return null;
      const result = getBecauseYouWatched(db, session, { limit: rowSize, exclude: usedIds, cache });
      if (!result) return null;
      const videos = claim(result.videos as unknown as FeedVideo[]);
      return { id: 'becauseYouWatched', title: `${SECTION_TITLES.becauseYouWatched} ${result.seed.title}`, seed: result.seed, videos };
    },
    byCategory: () => {
      // The viewer's top categories, completed by the most common ones of the library.
      const categories: string[] = [];
      if (session) {
        const profile = getViewerProfile(db, session, cache);
        categories.push(...[...profile.categoryAffinity.entries()]
          .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
          .slice(0, CATEGORY_ROWS)
          .map(([category]) => category));
      }
      if (categories.length < CATEGORY_ROWS) {
        for (const category of queryCommonCategories(db, session, CATEGORY_ROWS * 2)) {
          if (categories.length >= CATEGORY_ROWS) break;
          if (!categories.includes(category)) categories.push(category);
        }
      }
      const groups: { category: string; title: string; videos: FeedVideo[] }[] = [];
      for (const category of categories) {
        const videos = claim(queryCategoryVideos(db, session, category, { limit: rowSize, exclude: usedIds }));
        if (videos.length > 0) groups.push({ category, title: category, videos });
      }
      return groups.length > 0 ? { id: 'byCategory', title: SECTION_TITLES.byCategory, groups } : null;
    },
    shorts: () => {
      const videos = claim(queryShortsShelf(db, session, rowSize));
      return videos.length > 0 ? { id: 'shorts', title: SECTION_TITLES.shorts, videos } : null;
    },
    playlists: () => {
      if (!session) return null;
      const playlists = queryHomePlaylists(db, session, HOME_PLAYLISTS);
      return playlists.length > 0 ? { id: 'playlists', title: SECTION_TITLES.playlists, playlists } : null;
    },
    discoverChannels: () => {
      if (!session) return null;
      const channels = queryDiscoverChannels(db, session, getViewerProfile(db, session, cache), rowSize);
      return channels.length > 0 ? { id: 'discoverChannels', title: SECTION_TITLES.discoverChannels, channels } : null;
    },
    // Music and podcast rows: never share ids with the video sections, so no
    // claim(); a module that is off contributes nothing.
    recentMusic: () => {
      if (!isModuleEnabled(db, 'music')) return null;
      const tracks = queryRecentTracks(db, session, rowSize).items;
      return tracks.length > 0 ? { id: 'recentMusic', title: SECTION_TITLES.recentMusic, tracks } : null;
    },
    newEpisodes: () => {
      if (!isModuleEnabled(db, 'podcasts')) return null;
      const episodes = queryRecentEpisodes(db, session, rowSize).items;
      return episodes.length > 0 ? { id: 'newEpisodes', title: SECTION_TITLES.newEpisodes, episodes } : null;
    },
  };

  for (const sectionId of prefs.homeSections) {
    const section = builders[sectionId]?.();
    if (section) sections.push(section);
  }

  // Every video of the page is translated at once (one cache query). The
  // "because you watched" seed is a video too, and its section title embeds it.
  const textRows: any[] = [];
  if (large) textRows.push(large);
  textRows.push(...small);
  for (const section of sections) {
    if (Array.isArray(section.videos)) textRows.push(...section.videos);
    if (Array.isArray(section.groups)) for (const group of section.groups) textRows.push(...group.videos);
    if (section.seed) textRows.push(section.seed);
  }
  applyVideoTextLanguage(db, session, textRows);
  for (const section of sections) {
    if (section.id === 'becauseYouWatched' && section.seed?.original_title) {
      section.title = `${SECTION_TITLES.becauseYouWatched} ${section.seed.title}`;
    }
  }

  return {
    featured: { large, small },
    sections
  };
});
