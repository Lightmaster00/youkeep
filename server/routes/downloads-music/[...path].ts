import fs from 'fs';
import path from 'path';
import { defineEventHandler, createError } from 'h3';

const IMAGE_CONTENT_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.png': 'image/png',
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
  const contentType = IMAGE_CONTENT_TYPES[ext];
  if (!contentType) {
    // Includes audio extensions and anything else — this route serves
    // images only. A 404 here reveals nothing about whether a non-image
    // file exists at this path.
    throw createError({ statusCode: 404, statusMessage: 'File not found' });
  }

  const trackId = fileName.slice(0, fileName.length - ext.length);
  const db = getDb();

  const track = db.prepare(`
    SELECT t.id, a.id as artist_id, a.name as artist_name
    FROM music_tracks t
    JOIN music_artists a ON t.artist_id = a.id
    WHERE t.id = ?
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
  event.node.res.setHeader('Content-Type', contentType);
  event.node.res.setHeader('Content-Length', stat.size);
  event.node.res.statusCode = 200;
  return fs.createReadStream(resolvedPath);
});
