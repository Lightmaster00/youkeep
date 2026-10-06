// Pure extraction of the fields we persist from a yt-dlp `<id>.info.json`.
export interface VideoInfoFields {
  description: string | null;
  views: number | null;
  uploadDate: string | null;
  likeCount: number | null;
  wasLive: 0 | 1;
  duration: number | null;
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
  };
}
