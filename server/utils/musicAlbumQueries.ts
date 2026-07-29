// Shared SQL fragment for computing an album's "effective" cover art: the
// admin-set manual cover_url if one exists, otherwise the first completed
// track's thumbnail (by track_number, then creation order). Used by both
// the artist-detail read endpoint and the album edit endpoint so the two
// can never silently disagree about what "effective cover" means.
export const ALBUM_COVER_URL_FALLBACK_SQL = `
  COALESCE(
    al.cover_url,
    (
      SELECT t2.local_thumbnail_path
      FROM music_tracks t2
      WHERE t2.album_id = al.id AND t2.download_status = 'completed'
      ORDER BY t2.track_number ASC, t2.created_at ASC
      LIMIT 1
    )
  )
`;
