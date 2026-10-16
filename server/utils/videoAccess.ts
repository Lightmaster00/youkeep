// SQL counterparts of canAccessVideo / canAccessChannel, for lists and counts:
// a guest sees public videos of public channels; a member also sees private
// ones, plus everything in channels they were granted; an admin sees all.

export interface VideoViewer {
  id: string;
  role: 'admin' | 'user';
}

/** WHERE fragment over videos `v` joined with their channel `c` (always a valid expression). */
export function videoVisibilitySql(viewer: VideoViewer | null, v = 'v', c = 'c'): { sql: string; params: string[] } {
  if (!viewer) return { sql: `(${v}.visibility = 'public' AND ${c}.visibility = 'public')`, params: [] };
  if (viewer.role === 'admin') return { sql: '1=1', params: [] };
  return {
    sql: `((${v}.visibility IN ('public', 'private') AND ${c}.visibility IN ('public', 'private'))
      OR ${v}.channel_id IN (SELECT channel_id FROM user_channel_access WHERE user_id = ?))`,
    params: [viewer.id],
  };
}

/**
 * Video columns any viewer may receive. Download queue internals (errors,
 * retries, priority, progress/speed/eta) and share tokens are admin-only.
 */
export const VIDEO_PUBLIC_COLUMNS = [
  'id', 'title', 'description', 'channel_id', 'upload_date', 'duration', 'view_count', 'like_count',
  'local_video_path', 'local_thumbnail_path', 'download_status', 'size_bytes',
  'visibility', 'is_short', 'was_live', 'created_at',
] as const;

export const VIDEO_ADMIN_COLUMNS = [
  'share_token', 'last_error', 'retry_count', 'priority', 'is_manually_queued',
  'download_progress', 'download_speed', 'download_eta',
] as const;

/** `v.col, v.col, ...` for this viewer. */
export function videoColumnsSql(viewer: VideoViewer | null, v = 'v'): string {
  const cols = viewer?.role === 'admin' ? [...VIDEO_PUBLIC_COLUMNS, ...VIDEO_ADMIN_COLUMNS] : [...VIDEO_PUBLIC_COLUMNS];
  return cols.map((col) => `${v}.${col}`).join(', ');
}

/** Channel columns any viewer may receive; server paths, import errors and download options are admin-only. */
export const CHANNEL_PUBLIC_COLUMNS = ['id', 'title', 'description', 'avatar_url', 'banner_url', 'visibility', 'created_at'] as const;
export const CHANNEL_ADMIN_COLUMNS = [
  'download_videos', 'download_shorts', 'download_lives', 'date_after', 'sync_status',
  'custom_save_path', 'import_status', 'import_error',
] as const;

export function channelColumnsSql(viewer: VideoViewer | null, c = 'c'): string {
  const cols = viewer?.role === 'admin' ? [...CHANNEL_PUBLIC_COLUMNS, ...CHANNEL_ADMIN_COLUMNS] : [...CHANNEL_PUBLIC_COLUMNS];
  return cols.map((col) => `${c}.${col}`).join(', ');
}
