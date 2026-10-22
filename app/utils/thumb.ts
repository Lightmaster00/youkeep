/** Widths the file routes can resize an image to (server/utils/thumbnails.ts). */
export const THUMB_WIDTHS = [160, 320, 480, 640, 960] as const;
export type ThumbWidth = (typeof THUMB_WIDTHS)[number];

const LOCAL_FILE_URL = /^\/downloads(?:-music|-podcasts)?\//;

/**
 * The URL of an image resized to `width` px: `?w=` is added only to the app's
 * own file URLs (/downloads, /downloads-music, /downloads-podcasts), whose
 * server scales them down and caches the result. External URLs (YouTube,
 * iTunes covers, data: URIs) and empty values come back unchanged.
 */
export function thumbUrl<T extends string | null | undefined>(src: T, width: ThumbWidth): T | string {
  if (!src || !LOCAL_FILE_URL.test(src)) return src;
  if (/[?&]w=/.test(src)) return src;
  return `${src}${src.includes('?') ? '&' : '?'}w=${width}`;
}

/**
 * YouTube's own thumbnail of a video, for when no local one exists. A long
 * video gets mqdefault (320x180, true 16:9); hqdefault is 4:3 with black bars
 * above and below. A Short keeps hqdefault: its vertical frame sits
 * pillarboxed in the middle of the 4:3 image, so a 9:16 cover box shows
 * exactly that frame and none of the bars.
 */
export function youtubeThumb(id: string | null | undefined, kind: 'video' | 'short' | 'hero' = 'video'): string {
  if (!id) return '';
  return `https://i.ytimg.com/vi/${encodeURIComponent(id)}/${YOUTUBE_THUMB_FILE[kind]}.jpg`;
}

// 'hero' (the home banner) asks for the 1280x720 maxresdefault, also 16:9,
// which some videos lack: its error handler then falls back to mqdefault.
const YOUTUBE_THUMB_FILE = { video: 'mqdefault', short: 'hqdefault', hero: 'maxresdefault' } as const;

/** The image a video card shows: the resized local thumbnail, else YouTube's. */
export function videoThumbSrc(
  video: { id: string; local_thumbnail_path?: string | null; is_short?: number | boolean | null },
  width: ThumbWidth,
): string {
  return thumbUrl(video.local_thumbnail_path, width) || youtubeThumb(video.id, video.is_short ? 'short' : 'video');
}
