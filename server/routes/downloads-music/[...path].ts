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
  '.m4a': 'audio/mp4',
  '.opus': 'audio/opus',
  '.webm': 'audio/webm',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
};

export default defineEventHandler(async (event) => {
  const filePath = event.context.params?.path;
  if (!filePath) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid file path' });
  }

  // Files are always stored flat as {artistDir}/{trackId}.{ext} — exactly two
  // path segments, no nesting.
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

  const trackId = fileName.slice(0, fileName.length - ext.length);
  const db = getDb();

  const track = db.prepare(`
    SELECT t.id, a.id as artist_id, a.name as artist_name
    FROM music_tracks t
    JOIN music_artists a ON t.artist_id = a.id
    WHERE t.id = ? AND t.download_status = 'completed'
  `).get(trackId) as { id: string; artist_id: string; artist_name: string } | undefined;

  if (!track) {
    throw createError({ statusCode: 404, statusMessage: 'File not found' });
  }

  const hasAccess = await canAccessMusicTrack(trackId, event);
  if (!hasAccess) {
    throw createError({ statusCode: 403, statusMessage: 'Accès refusé. Ce contenu est restreint.' });
  }

  const downloadsDir = getMusicDownloadsDir();
  const artistDir = path.resolve(downloadsDir, sanitizeFolderName(track.artist_name || track.artist_id));
  const resolvedPath = path.resolve(artistDir, fileName);

  // Containment check: resolvedPath must stay inside artistDir.
  const relativeToArtistDir = path.relative(artistDir, resolvedPath);
  if (relativeToArtistDir.startsWith('..') || path.isAbsolute(relativeToArtistDir)) {
    throw createError({ statusCode: 403, statusMessage: 'Access denied' });
  }

  // Belt-and-braces: resolvedPath must also stay inside the overall music downloads dir.
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
    event.node.res.setHeader('Content-Length', stat.size);
    event.node.res.statusCode = 200;
    return fs.createReadStream(resolvedPath);
  }

  // Audio: support HTTP Range requests so the <audio> element can seek
  // without downloading the whole file — mirrors server/routes/downloads/[...path].ts's
  // existing video-streaming Range logic verbatim.
  const fileSize = stat.size;
  const range = event.node.req.headers.range;

  event.node.res.setHeader('Accept-Ranges', 'bytes');
  event.node.res.setHeader('Content-Type', contentType);

  if (range) {
    const rangeParts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(rangeParts[0] || '0', 10);
    const end = rangeParts[1] ? parseInt(rangeParts[1], 10) : fileSize - 1;

    if (start >= fileSize || end >= fileSize) {
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
