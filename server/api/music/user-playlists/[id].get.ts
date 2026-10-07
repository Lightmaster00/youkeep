import { defineEventHandler, getRouterParam } from 'h3';
import { requireUser } from '../../../utils/auth';
import { getOwnedPlaylist, playlistSummary, visiblePlaylistTracks } from '../../../utils/musicUserPlaylists';

export default defineEventHandler(async (event) => {
  const user = await requireUser(event);
  const db = getDb();
  const row = getOwnedPlaylist(db, getRouterParam(event, 'id'), user.id);
  return { playlist: playlistSummary(db, user, row), tracks: visiblePlaylistTracks(db, user, row.id) };
});
