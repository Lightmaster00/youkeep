import { defineEventHandler } from 'h3';
import { upstreamFailure } from '../../../utils/validation';
import { getYtdlPath, isFfmpegAvailable, runProcessAsync, buildSpawnEnv } from '../../../utils/downloader';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);

  try {
    const ytdlPath = await getYtdlPath();
    const env = buildSpawnEnv();
    const child = await runProcessAsync(ytdlPath, ['--version'], env, undefined, 30_000);
    const stdout = child.stdout?.trim();
    const stderr = child.stderr?.trim();
    const status = child.status;

    const ffmpegAvailable = isFfmpegAvailable();

    return {
      success: status === 0,
      version: stdout || 'Unknown',
      ffmpegAvailable,
      stdout,
      stderr,
      status,
      command: `${ytdlPath} --version`
    };
  } catch (err) {
    upstreamFailure('admin/downloader/test-binary', err, 'Could not run yt-dlp. Check the server logs for details.');
  }
});
