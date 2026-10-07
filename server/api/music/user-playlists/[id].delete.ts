import { defineEventHandler, getRouterParam } from 'h3';
import { requireUser } from '../../../utils/auth';
import { getOwnedPlaylist } from '../../../utils/musicUserPlaylists';

export default defineEventHandler(async (event) => {
  const user = await requireUser(event);
  const db = getDb();
  const row = getOwnedPlaylist(db, getRouterParam(event, 'id'), user.id);
  db.prepare('DELETE FROM music_user_playlists WHERE id = ?').run(row.id);
  return { success: true };
});
