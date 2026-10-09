import type Database from 'better-sqlite3';
import { createError } from 'h3';
import { canAccessMusicArtist } from './auth';
import { MUSIC_TRACK_COLUMNS, MUSIC_TRACK_JOINS } from './musicTrackRows';
import { ALBUM_COVER_URL_FALLBACK_SQL } from './musicAlbumQueries';

// Queries behind the artist page (overview, songs) and the album page. Every
// list only holds completed tracks; access is checked per artist by the
// routes with requireMusicArtistAccess before any of these run.

export const POPULAR_LIMIT = 5;
export const SONG_SORTS = ['popular', 'newest', 'oldest', 'title'] as const;
export type SongSort = typeof SONG_SORTS[number];

const TRACK_COLUMNS = `${MUSIC_TRACK_COLUMNS}, t.view_count, t.upload_date`;

// "(x IS NULL) ASC" keeps unknown values last whatever the direction.
// Popular: views, then how often the caller played the track (0 for guests,
// as no history row has a NULL user), then title.
const SONG_ORDER_SQL: Record<SongSort, string> = {
  popular: `(t.view_count IS NULL) ASC, t.view_count DESC,
    (SELECT COUNT(*) FROM music_play_history h WHERE h.track_id = t.id AND h.user_id = @userId) DESC,
    t.title COLLATE NOCASE ASC, t.id ASC`,
  newest: '(t.upload_date IS NULL) ASC, t.upload_date DESC, t.created_at DESC, t.id DESC',
  oldest: '(t.upload_date IS NULL) ASC, t.upload_date ASC, t.created_at ASC, t.id ASC',
  title: 't.title COLLATE NOCASE ASC, t.id ASC'
};

export function parseSongSort(value: unknown): SongSort {
  return (SONG_SORTS as readonly string[]).includes(String(value)) ? (value as SongSort) : 'popular';
}

// 404 when the artist does not exist, 403 when the caller may not see it.
export async function requireMusicArtistAccess(db: Database.Database, artistId: string | undefined, event: any) {
  if (!artistId) {
    throw createError({ statusCode: 400, statusMessage: 'Artist ID is required.' });
  }
  const artist = db.prepare(`
    SELECT id, name, description, avatar_url, banner_url, visibility
    FROM music_artists
    WHERE id = ?
  `).get(artistId) as any;
  if (!artist) {
    throw createError({ statusCode: 404, statusMessage: 'Artist not found.' });
  }
  if (!(await canAccessMusicArtist(artistId, event))) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Access denied. You do not have permission to view this artist.'
    });
  }
  return artist;
}

export function listArtistSongs(
  db: Database.Database,
  artistId: string,
  opts: { sort: SongSort; userId: string | null; limit: number; offset: number }
): { items: any[]; total: number } {
  const items = db.prepare(`
    SELECT ${TRACK_COLUMNS}
    FROM music_tracks t
    ${MUSIC_TRACK_JOINS}
    WHERE t.artist_id = @artistId AND t.download_status = 'completed'
    ORDER BY ${SONG_ORDER_SQL[opts.sort]}
    LIMIT @limit OFFSET @offset
  `).all({ artistId, userId: opts.userId, limit: Math.trunc(opts.limit), offset: Math.trunc(opts.offset) });
  const total = (db.prepare(`
    SELECT COUNT(*) as cnt FROM music_tracks
    WHERE artist_id = ? AND download_status = 'completed'
  `).get(artistId) as { cnt: number }).cnt;
  return { items, total };
}

// Albums of the artist with at least one completed track, newest year first
// (unknown years last), then the most recently added.
export function listArtistAlbums(db: Database.Database, artistId: string): any[] {
  return db.prepare(`
    SELECT al.id, al.title, al.release_year, al.album_type, al.artist_id, a.name as artist_name,
           al.created_at, COUNT(t.id) as track_count,
           al.cover_url as manual_cover_url,
           ${ALBUM_COVER_URL_FALLBACK_SQL} as cover_url
    FROM music_albums al
    JOIN music_artists a ON a.id = al.artist_id
    JOIN music_tracks t ON t.album_id = al.id AND t.download_status = 'completed'
    WHERE al.artist_id = ?
    GROUP BY al.id
    ORDER BY (al.release_year IS NULL) ASC, al.release_year DESC, al.created_at DESC, al.title ASC
  `).all(artistId);
}

export function isSingleType(albumType: string | null | undefined): boolean {
  return albumType === 'single' || albumType === 'ep';
}

export function buildArtistOverview(db: Database.Database, artist: any, userId: string | null) {
  const all = listArtistAlbums(db, artist.id);
  const albums = all.filter((al) => !isSingleType(al.album_type));
  const singles = all.filter((al) => isSingleType(al.album_type));
  const { items: popular, total } = listArtistSongs(db, artist.id, {
    sort: 'popular', userId, limit: POPULAR_LIMIT, offset: 0
  });

  // Albums are already sorted newest first, so the first one is the latest.
  let latest: { kind: 'album'; album: any } | { kind: 'track'; track: any } | null = null;
  if (all.length > 0) {
    latest = { kind: 'album', album: all[0] };
  } else {
    const track = listArtistSongs(db, artist.id, { sort: 'newest', userId, limit: 1, offset: 0 }).items[0];
    if (track) latest = { kind: 'track', track };
  }

  return {
    artist,
    popular,
    latest,
    albums,
    singles,
    counts: { tracks: total, albums: albums.length, singles: singles.length }
  };
}

export function getAlbumWithTracks(db: Database.Database, albumId: string) {
  const row = db.prepare(`
    SELECT al.id, al.title, al.release_year, al.album_type, al.artist_id, a.name as artist_name,
           al.cover_url as manual_cover_url,
           ${ALBUM_COVER_URL_FALLBACK_SQL} as cover_url
    FROM music_albums al
    JOIN music_artists a ON a.id = al.artist_id
    WHERE al.id = ?
  `).get(albumId) as any;
  if (!row) return null;
  const tracks = db.prepare(`
    SELECT ${TRACK_COLUMNS}
    FROM music_tracks t
    ${MUSIC_TRACK_JOINS}
    WHERE t.album_id = ? AND t.download_status = 'completed'
    ORDER BY (t.track_number IS NULL) ASC, t.track_number ASC, t.title COLLATE NOCASE ASC, t.id ASC
  `).all(albumId);
  return {
    album: {
      id: row.id,
      title: row.title,
      year: row.release_year,
      type: row.album_type,
      coverUrl: row.cover_url,
      manualCoverUrl: row.manual_cover_url,
      artistId: row.artist_id,
      artistName: row.artist_name
    },
    tracks
  };
}
