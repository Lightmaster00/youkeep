import { defineEventHandler, createError } from 'h3';

export default defineEventHandler(async (event) => {
  const user = await requireUser(event);
  const id = event.context.params?.id;
  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Playlist ID is required.'
    });
  }

  const db = getDb();
  const playlist = db.prepare('SELECT user_id FROM personal_playlists WHERE id = ?').get(id) as { user_id: string } | undefined;

  if (!playlist) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Playlist not found.'
    });
  }

  if (playlist.user_id !== user.id && user.role !== 'admin') {
    throw createError({
      statusCode: 403,
      statusMessage: 'You do not have permission to delete this playlist.'
    });
  }

  db.prepare('DELETE FROM personal_playlists WHERE id = ?').run(id);

  return { success: true };
});
