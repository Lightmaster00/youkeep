import { defineEventHandler, readBody, createError, setResponseStatus } from 'h3';
import { requireUser } from '../../../utils/auth';
import { createUserPlaylist, playlistSummary } from '../../../utils/musicUserPlaylists';
import { validatePlaylistFields } from '../../../../shared/musicPlaylists';

export default defineEventHandler(async (event) => {
  const user = await requireUser(event);
  const result = validatePlaylistFields(await readBody(event), false);
  if (!result.ok) {
    throw createError({ statusCode: 400, statusMessage: result.error });
  }
  const db = getDb();
  const row = createUserPlaylist(db, user.id, { ...result.fields, title: result.fields.title! });
  setResponseStatus(event, 201);
  return playlistSummary(db, user, row);
});
