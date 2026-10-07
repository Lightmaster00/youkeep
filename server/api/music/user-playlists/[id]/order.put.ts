import { defineEventHandler, getRouterParam, readBody } from 'h3';
import { requireUser } from '../../../../utils/auth';
import { getOwnedPlaylist, reorderPlaylist } from '../../../../utils/musicUserPlaylists';

// Body `{ trackIds }`: the playlist's tracks in their new order.
export default defineEventHandler(async (event) => {
  const user = await requireUser(event);
  const db = getDb();
  const row = getOwnedPlaylist(db, getRouterParam(event, 'id'), user.id);
  const body = await readBody(event);
  reorderPlaylist(db, user, row.id, body && typeof body === 'object' ? (body as any).trackIds : undefined);
  return { success: true };
});
