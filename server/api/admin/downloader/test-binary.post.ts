import { defineEventHandler, createError } from 'h3';
import { getYtdlPath, isFfmpegAvailable, runProcessAsync, buildSpawnEnv } from '../../../utils/downloader';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);

  const ytdlPath = await getYtdlPath();
  const env = buildSpawnEnv();

  try {
    const child = await runProcessAsync(ytdlPath, ['--version'], env);
    const stdout = child.stdout?.trim();
    const stderr = child.stderr?.trim();
    const status = child.status;

    const ffmpegAvailable = isFfmpegAvailable();

    return {
      success: status === 0,
      version: stdout || 'Inconnue',
      ffmpegAvailable,
      stdout,
      stderr,
      status,
      command: `${ytdlPath} --version`
    };
  } catch (err: any) {
    throw createError({
      statusCode: 500,
      statusMessage: `Impossible d'exécuter yt-dlp : ${err.message || err}`
    });
  }
});
