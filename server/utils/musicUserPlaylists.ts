import type Database from 'better-sqlite3';
import crypto from 'crypto';
import { createError } from 'h3';
import { MUSIC_TRACK_COLUMNS, MUSIC_TRACK_JOINS } from './musicTrackRows';
import { visibleTrackCondition } from './musicFavorites';
import type { FavoritesSession } from './musicFavorites';
import {
  MAX_PLAYLISTS_PER_USER, MAX_TRACKS_PER_PLAYLIST, isValidMediaId, isPermutationOf,
} from '../../shared/musicPlaylists';
import type { PlaylistFields } from '../../shared/musicPlaylists';

// Personal music playlists. Strictly private: every read and write goes
// through getOwnedPlaylist(), which answers 404 for someone else's playlist
// exactly as for a missing one (admins included), so ids leak nothing.
// Positions are kept dense (0..n-1) by renumberPlaylist() after every change.
// Tracks the caller can no longer see stay in the playlist but are left out of
// every read, count and reorder.

export interface UserPlaylistRow {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  created_at: number;
  updated_at: number;
}

export function getOwnedPlaylist(db: Database.Database, id: unknown, userId: string): UserPlaylistRow {
  const row = isValidMediaId(id)
    ? db.prepare('SELECT * FROM music_user_playlists WHERE id = ? AND user_id = ?').get(id, userId) as UserPlaylistRow | undefined
    : undefined;
  if (!row) {
    throw createError({ statusCode: 404, statusMessage: 'Playlist not found.' });
  }
  return row;
}

function summary(row: UserPlaylistRow, trackCount: number, covers: Array<{ id: string; cover: string | null }>) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    trackCount,
    coverTrackIds: covers.map((c) => c.id),
    coverUrls: covers.map((c) => c.cover).filter((c): c is string => !!c),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Visible track count and first four visible tracks of each of `ids`.
function countsAndCovers(db: Database.Database, session: FavoritesSession, ids: string[]) {
  const counts = new Map<string, number>();
  const covers = new Map<string, Array<{ id: string; cover: string | null }>>();
  if (ids.length === 0) return { counts, covers };
  const visible = visibleTrackCondition(session);
  const placeholders = ids.map(() => '?').join(',');
  const countRows = db.prepare(`
    SELECT pt.playlist_id, COUNT(*) as cnt
    FROM music_user_playlist_tracks pt
    JOIN music_tracks t ON t.id = pt.track_id
    JOIN music_artists a ON t.artist_id = a.id
    WHERE pt.playlist_id IN (${placeholders}) AND ${visible}
    GROUP BY pt.playlist_id
  `).all(...ids) as Array<{ playlist_id: string; cnt: number }>;
  for (const r of countRows) counts.set(r.playlist_id, r.cnt);
  const coverRows = db.prepare(`
    SELECT playlist_id, id, cover FROM (
      SELECT pt.playlist_id, t.id, COALESCE(t.local_thumbnail_path, al.cover_url) as cover,
             ROW_NUMBER() OVER (PARTITION BY pt.playlist_id ORDER BY pt.position) as rn
      FROM music_user_playlist_tracks pt
      JOIN music_tracks t ON t.id = pt.track_id
      ${MUSIC_TRACK_JOINS}
      WHERE pt.playlist_id IN (${placeholders}) AND ${visible}
    ) WHERE rn <= 4 ORDER BY playlist_id, rn
  `).all(...ids) as Array<{ playlist_id: string; id: string; cover: string | null }>;
  for (const r of coverRows) {
    const list = covers.get(r.playlist_id) ?? [];
    list.push({ id: r.id, cover: r.cover });
    covers.set(r.playlist_id, list);
  }
  return { counts, covers };
}

export function playlistSummary(db: Database.Database, session: FavoritesSession, row: UserPlaylistRow) {
  const { counts, covers } = countsAndCovers(db, session, [row.id]);
  return summary(row, counts.get(row.id) ?? 0, covers.get(row.id) ?? []);
}

// The caller's playlists, most recently changed first. With `containsTrack`,
// each entry also says whether that track is already in it.
export function listUserPlaylists(db: Database.Database, session: FavoritesSession, containsTrack?: string) {
  const rows = db.prepare(`
    SELECT * FROM music_user_playlists WHERE user_id = ? ORDER BY updated_at DESC, created_at DESC, id
  `).all(session.id) as UserPlaylistRow[];
  const { counts, covers } = countsAndCovers(db, session, rows.map((r) => r.id));
  const containing = new Set<string>();
  if (containsTrack && rows.length > 0) {
    const found = db.prepare(`
      SELECT pt.playlist_id FROM music_user_playlist_tracks pt
      JOIN music_user_playlists p ON p.id = pt.playlist_id
      WHERE p.user_id = ? AND pt.track_id = ?
    `).all(session.id, containsTrack) as Array<{ playlist_id: string }>;
    for (const f of found) containing.add(f.playlist_id);
  }
  return rows.map((row) => {
    const item: Record<string, unknown> = summary(row, counts.get(row.id) ?? 0, covers.get(row.id) ?? []);
    if (containsTrack) item.containsTrack = containing.has(row.id);
    return item;
  });
}

export function createUserPlaylist(db: Database.Database, userId: string, fields: Required<Pick<PlaylistFields, 'title'>> & PlaylistFields): UserPlaylistRow {
  const count = (db.prepare('SELECT COUNT(*) as cnt FROM music_user_playlists WHERE user_id = ?').get(userId) as { cnt: number }).cnt;
  if (count >= MAX_PLAYLISTS_PER_USER) {
    throw createError({ statusCode: 400, statusMessage: `You can have at most ${MAX_PLAYLISTS_PER_USER} playlists.` });
  }
  const now = Date.now();
  const row: UserPlaylistRow = {
    id: crypto.randomUUID(),
    user_id: userId,
    title: fields.title,
    description: fields.description ?? null,
    created_at: now,
    updated_at: now,
  };
  db.prepare(`
    INSERT INTO music_user_playlists (id, user_id, title, description, created_at, updated_at)
    VALUES (@id, @user_id, @title, @description, @created_at, @updated_at)
  `).run(row);
  return row;
}

export function updateUserPlaylist(db: Database.Database, row: UserPlaylistRow, fields: PlaylistFields): UserPlaylistRow {
  const next: UserPlaylistRow = {
    ...row,
    title: fields.title ?? row.title,
    description: fields.description !== undefined ? fields.description : row.description,
    updated_at: Date.now(),
  };
  db.prepare('UPDATE music_user_playlists SET title = ?, description = ?, updated_at = ? WHERE id = ?')
    .run(next.title, next.description, next.updated_at, row.id);
  return next;
}

function touch(db: Database.Database, playlistId: string) {
  db.prepare('UPDATE music_user_playlists SET updated_at = ? WHERE id = ?').run(Date.now(), playlistId);
}

// Every row of a playlist in play order, hidden tracks included.
function allTrackIds(db: Database.Database, playlistId: string): string[] {
  return (db.prepare(`
    SELECT track_id FROM music_user_playlist_tracks WHERE playlist_id = ? ORDER BY position, added_at, track_id
  `).all(playlistId) as Array<{ track_id: string }>).map((r) => r.track_id);
}

function writePositions(db: Database.Database, playlistId: string, orderedIds: string[]) {
  const stmt = db.prepare('UPDATE music_user_playlist_tracks SET position = ? WHERE playlist_id = ? AND track_id = ?');
  orderedIds.forEach((trackId, index) => stmt.run(index, playlistId, trackId));
}

// Rewrites positions as 0..n-1 in the current order (closes the gaps left by
// a removal, including rows removed by a cascading track delete).
export function renumberPlaylist(db: Database.Database, playlistId: string): void {
  db.transaction(() => writePositions(db, playlistId, allTrackIds(db, playlistId)))();
}

// The tracks the caller can see, in play order, in the recently-added shape.
export function visiblePlaylistTracks(db: Database.Database, session: FavoritesSession, playlistId: string): any[] {
  return db.prepare(`
    SELECT ${MUSIC_TRACK_COLUMNS}, pt.added_at
    FROM music_user_playlist_tracks pt
    JOIN music_tracks t ON t.id = pt.track_id
    ${MUSIC_TRACK_JOINS}
    WHERE pt.playlist_id = ? AND ${visibleTrackCondition(session)}
    ORDER BY pt.position, pt.added_at, t.id
  `).all(playlistId);
}

export function addTrackToPlaylist(db: Database.Database, playlistId: string, trackId: string): boolean {
  return db.transaction(() => {
    const ids = allTrackIds(db, playlistId);
    if (ids.includes(trackId)) return false;
    if (ids.length >= MAX_TRACKS_PER_PLAYLIST) {
      throw createError({ statusCode: 400, statusMessage: `A playlist holds at most ${MAX_TRACKS_PER_PLAYLIST} tracks.` });
    }
    writePositions(db, playlistId, ids);
    db.prepare('INSERT INTO music_user_playlist_tracks (playlist_id, track_id, position, added_at) VALUES (?, ?, ?, ?)')
      .run(playlistId, trackId, ids.length, Date.now());
    touch(db, playlistId);
    return true;
  })();
}

export function removeTrackFromPlaylist(db: Database.Database, playlistId: string, trackId: string): void {
  db.transaction(() => {
    const res = db.prepare('DELETE FROM music_user_playlist_tracks WHERE playlist_id = ? AND track_id = ?').run(playlistId, trackId);
    renumberPlaylist(db, playlistId);
    if (res.changes > 0) touch(db, playlistId);
  })();
}

// `proposed` must be a permutation of the tracks the caller can see. Those
// take the new order; tracks hidden from the caller keep their slots.
export function reorderPlaylist(db: Database.Database, session: FavoritesSession, playlistId: string, proposed: unknown): void {
  db.transaction(() => {
    const visibleIds = visiblePlaylistTracks(db, session, playlistId).map((t: any) => t.id as string);
    if (!isPermutationOf(visibleIds, proposed)) {
      throw createError({ statusCode: 400, statusMessage: 'trackIds must list every track of the playlist exactly once.' });
    }
    const visible = new Set(visibleIds);
    let next = 0;
    const merged = allTrackIds(db, playlistId).map((id) => (visible.has(id) ? proposed[next++]! : id));
    writePositions(db, playlistId, merged);
    touch(db, playlistId);
  })();
}
