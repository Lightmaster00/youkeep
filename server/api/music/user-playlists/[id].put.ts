import { defineEventHandler, getRouterParam, readBody, createError } from 'h3';
import { requireUser } from '../../../utils/auth';
import { getOwnedPlaylist, playlistSummary, updateUserPlaylist } from '../../../utils/musicUserPlaylists';
import { validatePlaylistFields } from '../../../../shared/musicPlaylists';

// Rename and/or change the description.
export default defineEventHandler(async (event) => {
  const user = await requireUser(event);
  const db = getDb();
  const row = getOwnedPlaylist(db, getRouterParam(event, 'id'), user.id);
  const result = validatePlaylistFields(await readBody(event), true);
  if (!result.ok) {
    throw createError({ statusCode: 400, statusMessage: result.error });
  }
  return playlistSummary(db, user, updateUserPlaylist(db, row, result.fields));
});
