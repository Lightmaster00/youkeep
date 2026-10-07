import { defineEventHandler, getRouterParam, createError } from 'h3';
import { requireUser } from '../../../../../utils/auth';
import { getOwnedPlaylist, playlistSummary, removeTrackFromPlaylist } from '../../../../../utils/musicUserPlaylists';
import { isValidMediaId } from '../../../../../../shared/musicPlaylists';

export default defineEventHandler(async (event) => {
  const user = await requireUser(event);
  const db = getDb();
  const row = getOwnedPlaylist(db, getRouterParam(event, 'id'), user.id);
  const trackId = getRouterParam(event, 'trackId');
  if (!isValidMediaId(trackId)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid track id.' });
  }
  removeTrackFromPlaylist(db, row.id, trackId);
  return { trackCount: playlistSummary(db, user, row).trackCount };
});
