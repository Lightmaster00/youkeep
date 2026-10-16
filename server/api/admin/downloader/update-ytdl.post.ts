import { defineEventHandler } from 'h3';
import { upstreamFailure } from '../../../utils/validation';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  try {
    const output = await updateYtdl();
    return { success: true, output };
  } catch (err) {
    upstreamFailure('admin/downloader/update-ytdl', err, 'Failed to update yt-dlp. Check the server logs for details.');
  }
});
