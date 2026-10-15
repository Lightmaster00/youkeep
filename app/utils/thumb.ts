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
