import { defineEventHandler, createError } from 'h3';
import { readJsonObject, optionalEnum, badRequest } from '../../../utils/validation';

export default defineEventHandler(async (event) => {
  const user = await requireUser(event);
  const db = getDb();
  const id = event.context.params?.id;

  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Playlist ID required' });
  }

  const visibility = optionalEnum(await readJsonObject(event), 'visibility', ['public', 'unlisted', 'private'] as const);
  if (!visibility) badRequest('Valid visibility is required');

  // Verify ownership
  const playlist = db.prepare('SELECT id FROM personal_playlists WHERE id = ? AND user_id = ?').get(id, user.id);
  if (!playlist) {
    throw createError({ statusCode: 403, statusMessage: 'Unauthorized or playlist not found' });
  }

  // Update visibility
  db.prepare('UPDATE personal_playlists SET visibility = ? WHERE id = ?').run(visibility, id);

  return { success: true, visibility };
});
