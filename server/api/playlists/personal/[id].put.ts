import { defineEventHandler, readBody } from 'h3';

export default defineEventHandler(async (event) => {
  const user = await requireUser(event);
  const db = getDb();
  const id = event.context.params?.id;

  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Playlist ID required' });
  }

  const body = await readBody(event);
  const { visibility } = body;

  if (!visibility || !['public', 'unlisted', 'private'].includes(visibility)) {
    throw createError({ statusCode: 400, statusMessage: 'Valid visibility is required' });
  }

  // Verify ownership
  const playlist = db.prepare('SELECT id FROM personal_playlists WHERE id = ? AND user_id = ?').get(id, user.id);
  if (!playlist) {
    throw createError({ statusCode: 403, statusMessage: 'Unauthorized or playlist not found' });
  }

  // Update visibility
  db.prepare('UPDATE personal_playlists SET visibility = ? WHERE id = ?').run(visibility, id);

  return { success: true, visibility };
});
