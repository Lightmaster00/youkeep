import type { LibrarySection } from './settingsTabs';

export type SourceKind = LibrarySection;
export type SourceVisibility = 'public' | 'private' | 'ultra_private';

export interface SearchResultView {
  title: string;
  meta: string;
  description: string;
  imageUrl: string;
}

export interface FollowedSource {
  id: string;
  name: string;
  imageUrl: string;
  countLabel: string;
  /** True only when the server will download new items (sync_status === 'downloading'). */
  syncActive: boolean;
  visibility: string;
  href: string;
}

export interface FollowOptions {
  autoSync: boolean;
  /** '' = keep the current value (Public if new) — music and podcasts only. */
  visibility: '' | SourceVisibility;
  downloadVideos: boolean;
  downloadShorts: boolean;
  downloadLives: boolean;
  /** YYYY-MM-DD from <input type="date">, or ''. */
  dateAfter: string;
  saveFolder: string;
}

export interface LibrarySourceConfig {
  kind: SourceKind;
  title: string;
  description: string;
  searchPlaceholder: string;
  searchEndpoint: string;
  readSearchResults: (data: any) => any[];
  toResultView: (raw: any) => SearchResultView;
  /** URL or feed to follow for a search result, or null when it can't be followed. */
  followTarget: (raw: any) => string | null;
  /** When the search box holds a pasted URL/handle/feed, the target to follow directly. */
  directTarget: (query: string) => string | null;
  noTargetMessage: string;
  noResultsMessage: string;
  ingestEndpoint: string;
  buildIngestBody: (target: string, options: FollowOptions, raw: any | null) => Record<string, unknown>;
  listEndpoint: string;
  readFollowing: (data: any) => FollowedSource[];
  emptyFollowingMessage: string;
  pauseUrl: (id: string) => string;
  /** Also used to resume: the sync route sets the source back to 'downloading'. */
  syncUrl: (id: string) => string;
  syncAllEndpoint: string;
  syncAllStartedMessage: string;
  /** Only channels have a visibility route. */
  visibilityUrl: ((id: string) => string) | null;
  hasVideoOptions: boolean;
}

export const DEFAULT_SAVE_FOLDER = '/downloads/videos';

export function defaultFollowOptions(kind: SourceKind): FollowOptions {
  return {
    autoSync: true,
    visibility: kind === 'videos' ? 'public' : '',
    downloadVideos: true,
    downloadShorts: false,
    downloadLives: false,
    dateAfter: '',
    saveFolder: DEFAULT_SAVE_FOLDER,
  };
}

const VISIBILITY_LABELS: Record<string, string> = { public: 'Public', private: 'Private', ultra_private: 'Ultra private' };

export function visibilityLabel(visibility: string): string {
  return VISIBILITY_LABELS[visibility] ?? visibility;
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function handleUrl(handle: unknown): string | null {
  if (typeof handle !== 'string' || !handle.trim()) return null;
  const h = handle.trim();
  return `https://www.youtube.com${h.startsWith('/') ? '' : '/'}${h}`;
}

function idUrl(id: unknown): string | null {
  return typeof id === 'string' && id.trim() ? `https://www.youtube.com/channel/${id.trim()}` : null;
}

export function youtubeChannelUrl(raw: any, prefer: 'handle' | 'id'): string | null {
  return prefer === 'handle'
    ? handleUrl(raw?.handle) ?? idUrl(raw?.id)
    : idUrl(raw?.id) ?? handleUrl(raw?.handle);
}

export function youtubeDirectTarget(query: string): string | null {
  const q = query.trim();
  if (!q) return null;
  if (/^https?:\/\//i.test(q)) return q;
  if (/^(www\.|m\.)?youtube\.com\//i.test(q)) return `https://${q}`;
  if (/^@[\w.-]+$/.test(q)) return `https://www.youtube.com/${q}`;
  return null;
}

export function feedDirectTarget(query: string): string | null {
  const q = query.trim();
  return /^https?:\/\//i.test(q) ? q : null;
}

export function channelResultView(raw: any): SearchResultView {
  const meta = [
    raw?.subscriberCount ? `${raw.subscriberCount} subscribers` : '',
    raw?.videoCount ? `${raw.videoCount} videos` : '',
  ].filter(Boolean).join(' · ');
  return {
    title: raw?.title || 'Untitled channel',
    meta,
    description: raw?.description || '',
    imageUrl: raw?.avatarUrl || '',
  };
}

function syncBody(options: FollowOptions) {
  return {
    sync_status: options.autoSync ? 'downloading' : 'paused',
    ...(options.visibility ? { visibility: options.visibility } : {}),
  };
}

const enc = encodeURIComponent;

export const musicSource: LibrarySourceConfig = {
  kind: 'music',
  title: 'Music',
  description: 'Follow artists on YouTube. New tracks are downloaded as audio automatically.',
  searchPlaceholder: 'Artist name, YouTube channel URL or @handle',
  searchEndpoint: '/api/admin/downloader/search-channels',
  readSearchResults: (data) => (Array.isArray(data?.channels) ? data.channels : []),
  toResultView: channelResultView,
  followTarget: (raw) => youtubeChannelUrl(raw, 'handle'),
  directTarget: youtubeDirectTarget,
  noTargetMessage: "This result has no channel address, so it can't be followed.",
  noResultsMessage: 'No artists found for this search.',
  ingestEndpoint: '/api/admin/music/ingest',
  buildIngestBody: (target, options) => ({ url: target, ...syncBody(options) }),
  listEndpoint: '/api/admin/music/queue',
  readFollowing: (data) => (Array.isArray(data?.artists) ? data.artists : []).map((a: any) => ({
    id: String(a.id),
    name: String(a.name ?? ''),
    imageUrl: a.avatar_url || '',
    countLabel: plural(Number(a.track_count) || 0, 'track'),
    syncActive: a.sync_status === 'downloading',
    visibility: String(a.visibility || 'public'),
    href: `/music?artistId=${enc(String(a.id))}`,
  })),
  emptyFollowingMessage: "You're not following any artist yet.",
  pauseUrl: (id) => `/api/admin/music/artists/${enc(id)}/pause`,
  syncUrl: (id) => `/api/admin/music/artists/${enc(id)}/sync`,
  syncAllEndpoint: '/api/admin/music/sync-all',
  syncAllStartedMessage: 'Sync started for every followed artist.',
  visibilityUrl: null,
  hasVideoOptions: false,
};

export const podcastsSource: LibrarySourceConfig = {
  kind: 'podcasts',
  title: 'Podcasts',
  description: 'Follow podcasts by name or RSS feed. New episodes are downloaded automatically.',
  searchPlaceholder: 'Podcast name or RSS feed URL',
  searchEndpoint: '/api/admin/podcasts/search-shows',
  readSearchResults: (data) => (Array.isArray(data?.shows) ? data.shows : []),
  toResultView: (raw) => ({
    title: raw?.title || 'Untitled podcast',
    meta: raw?.author || '',
    description: raw?.description || '',
    imageUrl: raw?.artworkUrl || '',
  }),
  followTarget: (raw) => (typeof raw?.feedUrl === 'string' && raw.feedUrl.trim() ? raw.feedUrl.trim() : null),
  directTarget: feedDirectTarget,
  noTargetMessage: "This podcast has no usable RSS feed, so it can't be followed.",
  noResultsMessage: 'No podcasts found for this search.',
  ingestEndpoint: '/api/admin/podcasts/ingest',
  buildIngestBody: (target, options) => ({ feedUrl: target, ...syncBody(options) }),
  listEndpoint: '/api/admin/podcasts/queue',
  readFollowing: (data) => (Array.isArray(data?.shows) ? data.shows : []).map((s: any) => ({
    id: String(s.id),
    name: String(s.title ?? ''),
    imageUrl: s.cover_url || '',
    countLabel: plural(Number(s.episode_count) || 0, 'episode'),
    syncActive: s.sync_status === 'downloading',
    visibility: String(s.visibility || 'public'),
    href: `/podcasts?showId=${enc(String(s.id))}`,
  })),
  emptyFollowingMessage: "You're not following any podcast yet.",
  pauseUrl: (id) => `/api/admin/podcasts/shows/${enc(id)}/pause`,
  syncUrl: (id) => `/api/admin/podcasts/shows/${enc(id)}/sync`,
  syncAllEndpoint: '/api/admin/podcasts/sync-all',
  syncAllStartedMessage: 'Sync started for every followed podcast.',
  visibilityUrl: null,
  hasVideoOptions: false,
};

export const videosSource: LibrarySourceConfig = {
  kind: 'videos',
  title: 'Videos',
  description: 'Follow YouTube channels. New videos are downloaded automatically.',
  searchPlaceholder: 'Channel name, YouTube URL or @handle',
  searchEndpoint: '/api/admin/downloader/search-channels',
  readSearchResults: (data) => (Array.isArray(data?.channels) ? data.channels : []),
  toResultView: channelResultView,
  followTarget: (raw) => youtubeChannelUrl(raw, 'id'),
  directTarget: youtubeDirectTarget,
  noTargetMessage: "This result has no channel address, so it can't be followed.",
  noResultsMessage: 'No channels found for this search.',
  ingestEndpoint: '/api/admin/downloader/ingest',
  buildIngestBody: (target, options) => {
    // The base folder only: the downloader adds the channel folder and one
    // folder per video inside it.
    const savePath = options.saveFolder.trim();
    return {
      url: target,
      download_videos: options.downloadVideos,
      download_shorts: options.downloadShorts,
      download_lives: options.downloadLives,
      ...(options.dateAfter ? { date_after: options.dateAfter.replace(/-/g, '') } : {}),
      sync_status: options.autoSync ? 'downloading' : 'paused',
      visibility: options.visibility || 'public',
      ...(savePath ? { custom_save_path: savePath } : {}),
    };
  },
  listEndpoint: '/api/channels',
  readFollowing: (data) => (Array.isArray(data?.channels) ? data.channels : []).map((c: any) => ({
    id: String(c.id),
    name: String(c.title ?? ''),
    imageUrl: c.avatar_url || '',
    countLabel: plural(Number(c.completed_count) || 0, 'video'),
    syncActive: c.sync_status === 'downloading',
    visibility: String(c.visibility || 'public'),
    href: `/channels?channelId=${enc(String(c.id))}`,
  })),
  emptyFollowingMessage: "You're not following any channel yet.",
  pauseUrl: (id) => `/api/admin/channels/${enc(id)}/pause`,
  syncUrl: (id) => `/api/admin/channels/${enc(id)}/sync`,
  syncAllEndpoint: '/api/admin/downloader/sync-all',
  syncAllStartedMessage: 'Sync started for every followed channel.',
  visibilityUrl: (id) => `/api/admin/channels/${enc(id)}/visibility`,
  hasVideoOptions: true,
};

export const LIBRARY_SOURCES: Record<SourceKind, LibrarySourceConfig> = {
  videos: videosSource,
  music: musicSource,
  podcasts: podcastsSource,
};
