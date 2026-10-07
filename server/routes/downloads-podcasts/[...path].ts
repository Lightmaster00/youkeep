import fs from 'fs';
import path from 'path';
import { defineEventHandler, createError } from 'h3';

const IMAGE_CONTENT_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.png': 'image/png',
};

const AUDIO_CONTENT_TYPES: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.m4b': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.wav': 'audio/wav',
  '.opus': 'audio/opus',
  '.webm': 'audio/webm',
  '.weba': 'audio/webm',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.mp4': 'video/mp4',
};

export default defineEventHandler(async (event) => {
  const filePath = event.context.params?.path;
  if (!filePath) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid file path' });
  }

  // Files are always stored flat as {showDir}/{episodeId}.{ext} — exactly two
  // path segments, no nesting. See downloadEpisodeFile in podcastDownloader.ts.
  const parts = filePath.split('/');
  if (parts.length !== 2) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid file path' });
  }

  const fileName = parts[1] || '';
  const ext = path.extname(fileName).toLowerCase();
  const isAudio = ext in AUDIO_CONTENT_TYPES;
  const contentType = isAudio ? AUDIO_CONTENT_TYPES[ext] : IMAGE_CONTENT_TYPES[ext];
  if (!contentType) {
    // Includes any extension outside both maps — a 404 here reveals nothing
    // about whether a differently-extensioned file exists at this path.
    throw createError({ statusCode: 404, statusMessage: 'File not found' });
  }

  const episodeId = fileName.slice(0, fileName.length - ext.length);
  const db = getDb();

  const episode = db.prepare(`
    SELECT e.id, s.id as show_id, s.title as show_title
    FROM podcast_episodes e
    JOIN podcast_shows s ON e.show_id = s.id
    WHERE e.id = ? AND e.download_status = 'completed'
  `).get(episodeId) as { id: string; show_id: string; show_title: string } | undefined;

  if (!episode) {
    throw createError({ statusCode: 404, statusMessage: 'File not found' });
  }

  const hasAccess = await canAccessPodcastEpisode(episodeId, event);
  if (!hasAccess) {
    throw createError({ statusCode: 403, statusMessage: 'Access denied. This content is restricted.' });
  }

  // Resolve the show directory the same way downloadEpisodeFile built it —
  // sanitizeFolderName(show.title || showId) — rather than trusting the
  // stored local_file_path, which is a URL path, not a filesystem path.
  const downloadsDir = getPodcastDownloadsDir();
  const showDir = path.resolve(downloadsDir, sanitizeFolderName(episode.show_title || episode.show_id));
  const resolvedPath = path.resolve(showDir, fileName);

  // Containment check: resolvedPath must stay inside showDir.
  const relativeToShowDir = path.relative(showDir, resolvedPath);
  if (relativeToShowDir.startsWith('..') || path.isAbsolute(relativeToShowDir)) {
    throw createError({ statusCode: 403, statusMessage: 'Access denied' });
  }

  // Belt-and-braces: resolvedPath must also stay inside the overall podcast downloads dir.
  const relativeToDownloadsDir = path.relative(downloadsDir, resolvedPath);
  if (relativeToDownloadsDir.startsWith('..') || path.isAbsolute(relativeToDownloadsDir)) {
    throw createError({ statusCode: 403, statusMessage: 'Access denied' });
  }

  if (!fs.existsSync(resolvedPath)) {
    throw createError({ statusCode: 404, statusMessage: 'File not found' });
  }

  const stat = fs.statSync(resolvedPath);

  if (!isAudio) {
    event.node.res.setHeader('Content-Type', contentType);
    event.node.res.setHeader('Cache-Control', 'private, must-revalidate');
    event.node.res.setHeader('Last-Modified', stat.mtime.toUTCString());

    const ifModifiedSince = event.node.req.headers['if-modified-since'];
    if (ifModifiedSince) {
      const ifModifiedSinceDate = new Date(ifModifiedSince as string);
      if (!isNaN(ifModifiedSinceDate.getTime())) {
        const fileSeconds = Math.floor(stat.mtime.getTime() / 1000);
        const ifModifiedSinceSeconds = Math.floor(ifModifiedSinceDate.getTime() / 1000);
        if (fileSeconds <= ifModifiedSinceSeconds) {
          event.node.res.statusCode = 304;
          event.node.res.removeHeader?.('Content-Type');
          return null;
        }
      }
    }

    event.node.res.setHeader('Content-Length', stat.size);
    event.node.res.statusCode = 200;
    return fs.createReadStream(resolvedPath);
  }

  // Audio: support HTTP Range requests so the <audio> element can seek
  // without downloading the whole file — mirrors downloads-music's audio
  // branch verbatim. Range support matters more here than for music: podcast
  // episodes routinely run an hour or more.
  const fileSize = stat.size;
  const range = event.node.req.headers.range;

  event.node.res.setHeader('Accept-Ranges', 'bytes');
  event.node.res.setHeader('Content-Type', contentType);
  event.node.res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');

  if (range) {
    const rangeParts = range.replace(/bytes=/, '').split('-');
    let start: number;
    let end: number;

    if (rangeParts[0] === '') {
      // Suffix range, e.g. "bytes=-500" — last N bytes of the file.
      const suffixLength = parseInt(rangeParts[1] || '', 10);
      start = Number.isFinite(suffixLength) && suffixLength >= 0
        ? Math.max(0, fileSize - suffixLength)
        : NaN;
      end = fileSize - 1;
    } else {
      start = parseInt(rangeParts[0], 10);
      end = rangeParts[1] ? parseInt(rangeParts[1], 10) : fileSize - 1;
    }

    const isValidRange =
      Number.isFinite(start) && Number.isFinite(end) &&
      Number.isInteger(start) && Number.isInteger(end) &&
      start >= 0 && end >= start;

    if (!isValidRange || start >= fileSize || end >= fileSize) {
      event.node.res.statusCode = 416;
      event.node.res.setHeader('Content-Range', `bytes */${fileSize}`);
      return 'Requested range not satisfiable';
    }

    const chunksize = (end - start) + 1;
    const fileStream = fs.createReadStream(resolvedPath, { start, end });

    event.node.res.statusCode = 206;
    event.node.res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
    event.node.res.setHeader('Content-Length', chunksize);

    return fileStream;
  }

  event.node.res.statusCode = 200;
  event.node.res.setHeader('Content-Length', fileSize);
  return fs.createReadStream(resolvedPath);
});
