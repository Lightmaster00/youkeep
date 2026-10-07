import { defineEventHandler, getRouterParam, readBody } from 'h3';
import { requireUser } from '../../../../utils/auth';
import { assertVisibleTrack } from '../../../../utils/musicFavorites';
import { addTrackToPlaylist, getOwnedPlaylist, playlistSummary } from '../../../../utils/musicUserPlaylists';

// Appends a track. Adding one that is already there changes nothing.
export default defineEventHandler(async (event) => {
  const user = await requireUser(event);
  const db = getDb();
  const row = getOwnedPlaylist(db, getRouterParam(event, 'id'), user.id);
  const body = await readBody(event);
  const trackId = assertVisibleTrack(db, user, body && typeof body === 'object' ? (body as any).trackId : undefined);
  const added = addTrackToPlaylist(db, row.id, trackId);
  return { added, trackCount: playlistSummary(db, user, row).trackCount };
});
