import { defineEventHandler } from 'h3';
import { readJsonObject, requiredString, optionalString, optionalEnum } from '../../../utils/validation';
import crypto from 'crypto';

export default defineEventHandler(async (event) => {
  const user = await requireUser(event);
  const body = await readJsonObject(event);
  const title = requiredString(body, 'title', { max: 200 });
  const description = optionalString(body, 'description', { max: 5000 }) || null;
  const visibility = optionalEnum(body, 'visibility', ['public', 'unlisted', 'private'] as const) ?? 'private';

  const db = getDb();
  const playlistId = crypto.randomUUID();
  const shareToken = crypto.randomBytes(16).toString('hex');

  db.prepare(`
    INSERT INTO personal_playlists (id, title, description, user_id, visibility, share_token, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    playlistId,
    title,
    description,
    user.id,
    visibility,
    shareToken,
    Date.now()
  );

  const playlist = db.prepare('SELECT * FROM personal_playlists WHERE id = ?').get(playlistId);

  return { playlist };
});
