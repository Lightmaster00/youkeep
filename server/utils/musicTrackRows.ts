// The one track shape every "list of playable tracks" endpoint returns
// (recently added, liked songs, personal playlists), so the player and track
// cards can take any of them. Use with the `t`/`a`/`al` aliases below.
export const MUSIC_TRACK_COLUMNS = `t.id, t.title, t.track_number, t.genre, t.language, t.duration,
           t.local_file_path, t.local_thumbnail_path, t.has_clip, t.artist_id, a.name as artist_name,
           t.album_id, al.title as album_title, al.cover_url as album_cover_url`;

export const MUSIC_TRACK_JOINS = `JOIN music_artists a ON t.artist_id = a.id
    LEFT JOIN music_albums al ON t.album_id = al.id`;
