import type Database from 'better-sqlite3';
import { recomputeCategoriesOfVideos } from './channelCategories';
// Pure extraction of the fields we persist from a yt-dlp `<id>.info.json`.
export interface VideoInfoFields {
  description: string | null;
  views: number | null;
  uploadDate: string | null;
  likeCount: number | null;
  wasLive: 0 | 1;
  duration: number | null;
  /** YouTube categories (e.g. "Gaming"), at most MAX_CATEGORIES. */
  categories: string[];
  /** Lower-cased uploader tags, at most MAX_TAGS. */
  tags: string[];
}

export const MAX_CATEGORIES = 3;
export const MAX_TAGS = 20;
export const MAX_LABEL_LENGTH = 40;

/** Trimmed, de-duplicated categories; a too long one is cut. Anything that is not an array gives []. */
export function sanitizeCategories(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const value = item.trim().slice(0, MAX_LABEL_LENGTH).trim();
    if (!value || out.includes(value)) continue;
    out.push(value);
    if (out.length >= MAX_CATEGORIES) break;
  }
  return out;
}

/** Trimmed, lower-cased, de-duplicated tags; a tag longer than the limit is dropped (a cut tag means nothing). */
export function sanitizeTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const value = item.trim().toLowerCase();
    if (!value || value.length > MAX_LABEL_LENGTH || out.includes(value)) continue;
    out.push(value);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

export function extractInfoFields(infoData: any): VideoInfoFields {
  const d = infoData ?? {};
  return {
    description: d.description || null,
    views: d.view_count || null,
    uploadDate: d.upload_date || null,
    likeCount: d.like_count || null,
    wasLive: d.live_status === 'was_live' ? 1 : 0,
    duration: typeof d.duration === 'number' && Number.isFinite(d.duration) && d.duration > 0
      ? Math.max(1, Math.round(d.duration))
      : null,
    categories: sanitizeCategories(d.categories),
    tags: sanitizeTags(d.tags),
  };
}

/** Parses a stored JSON array column (categories/tags); anything else is []. */
export function parseLabelList(raw: unknown): string[] {
  if (typeof raw !== 'string' || raw === '') return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export interface DownloadedVideoRow {
  videoPath: string | null;
  thumbnailPath: string | null;
  sizeBytes: number | null;
  /** The info.json fields, or null when yt-dlp left no info.json. */
  info: VideoInfoFields | null;
}

/**
 * Records a finished download. Info fields only replace stored values when
 * present; categories/tags come with an info.json, which also marks the video
 * as enriched (the metadata backfill then skips it).
 */
export function saveDownloadedVideo(
  db: Database.Database,
  videoId: string,
  row: DownloadedVideoRow,
  now: number = Date.now(),
): void {
  const info = row.info;
  db.prepare(`
    UPDATE videos
    SET local_video_path = ?,
        local_thumbnail_path = ?,
        description = COALESCE(?, description),
        view_count = COALESCE(?, view_count),
        upload_date = COALESCE(?, upload_date),
        like_count = COALESCE(?, like_count),
        duration = COALESCE(?, duration),
        size_bytes = ?,
        was_live = ?,
        categories = COALESCE(?, categories),
        tags = COALESCE(?, tags),
        metadata_enriched_at = COALESCE(?, metadata_enriched_at)
    WHERE id = ?
  `).run(
    row.videoPath,
    row.thumbnailPath,
    info?.description ?? null,
    info?.views ?? null,
    info?.uploadDate ?? null,
    info?.likeCount ?? null,
    info?.duration ?? null,
    row.sizeBytes,
    info?.wasLive ?? 0,
    info ? JSON.stringify(info.categories) : null,
    info ? JSON.stringify(info.tags) : null,
    info ? now : null,
    videoId,
  );
  // New categories: the channel's automatic categories follow.
  if (info) recomputeCategoriesOfVideos(db, [videoId]);
}
