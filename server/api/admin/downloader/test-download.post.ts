import { defineEventHandler, readBody, createError } from 'h3';
import { getYtdlPath, runProcessAsync } from '../../../utils/downloader';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const body = await readBody(event);
  const { videoId } = body || {};

  if (!videoId) {
    throw createError({ statusCode: 400, statusMessage: 'ID de vidéo requis pour le test.' });
  }

  const ytdlPath = await getYtdlPath();
  const env = { ...process.env };
  env.PATH = `/opt/homebrew/bin:/usr/local/bin:${env.PATH || ''}`;

  try {
    // Run yt-dlp asynchronously to dump json for the single video (very fast check)
    const child = await runProcessAsync(ytdlPath, ['--dump-json', `https://www.youtube.com/watch?v=${videoId}`], env);
    const stdout = child.stdout?.trim();
    const stderr = child.stderr?.trim();
    const status = child.status;

    let parsed = null;
    if (status === 0 && stdout) {
      try {
        parsed = JSON.parse(stdout);
      } catch (e) {}
    }

    return {
      success: status === 0,
      title: parsed?.title || null,
      views: parsed?.view_count || null,
      description: parsed?.description ? parsed.description.slice(0, 100) + '...' : null,
      stderr,
      status
    };
  } catch (err: any) {
    throw createError({
      statusCode: 500,
      statusMessage: `Échec du test yt-dlp : ${err.message || err}`
    });
  }
});
