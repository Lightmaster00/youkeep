import { defineEventHandler, createError } from 'h3';
import { prepareChannelFilesRemoval } from '../../../utils/videoPaths';
import { isTidyRunning } from '../../../utils/videoTidy';
import { stopActiveDownloadsOfChannel } from '../../../utils/downloader';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const channelId = event.context.params?.id;

  if (!channelId) {
    throw createError({ statusCode: 400, statusMessage: 'Channel ID is required.' });
  }
  if (isTidyRunning()) {
    throw createError({ statusCode: 409, statusMessage: 'Library files are being tidied. Try again when it has finished.' });
  }

  const db = getDb();

  // Resolve the channel's actual on-disk files *before* deleting its rows,
  // so custom_save_path channels (and videos a partly repaired doubled folder
  // moved up) get cleaned up too.
  const channel = db.prepare('SELECT custom_save_path FROM channels WHERE id = ?').get(channelId) as {
    custom_save_path: string | null;
  } | undefined;
  const files = channel
    ? prepareChannelFilesRemoval(db, channelId, { baseDir: resolveChannelBaseDir(channel.custom_save_path), downloadsDir: getDownloadsDir() })
    : null;

  // 2. Kill only the downloads actually running; their files go with the folder below.
  stopActiveDownloadsOfChannel(channelId);

  // 3. Delete the channel (cascade deletes videos, video_categories, user_channel_access, etc.)
  const res = db.prepare('DELETE FROM channels WHERE id = ?').run(channelId);

  if (res.changes === 0) {
    throw createError({ statusCode: 404, statusMessage: 'Channel not found.' });
  }

  // 4. Delete the channel's media folder (only ever inside its base folder)
  files?.remove();

  return { success: true };
});
