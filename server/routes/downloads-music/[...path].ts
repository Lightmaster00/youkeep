import path from 'path';
import { defineEventHandler, createError } from 'h3';
import { entityFolderName } from '../../utils/videoPaths';
import { serveResizedThumbnail } from '../../utils/thumbnails';
import { sendMediaFile, statRegularFile } from '../../utils/mediaResponse';

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
    // Restricted and missing answer the same, so private ids cannot be probed.
    throw createError({ statusCode: 404, statusMessage: 'File not found' });
  }

  const downloadsDir = getMusicDownloadsDir();
  const artistDir = path.resolve(downloadsDir, entityFolderName(track.artist_name, track.artist_id));
  const resolvedPath = path.resolve(artistDir, fileName);

  // Containment check: resolvedPath must stay inside artistDir.
  const relativeToArtistDir = path.relative(artistDir, resolvedPath);
  if (relativeToArtistDir.startsWith('..') || path.isAbsolute(relativeToArtistDir)) {
    throw createError({ statusCode: 404, statusMessage: 'File not found' });
  }

  // Belt-and-braces: resolvedPath must also stay inside the overall music downloads dir.
  const relativeToDownloadsDir = path.relative(downloadsDir, resolvedPath);
  if (relativeToDownloadsDir.startsWith('..') || path.isAbsolute(relativeToDownloadsDir)) {
    throw createError({ statusCode: 404, statusMessage: 'File not found' });
  }

  // Directories, devices and missing files: the same 404.
  const stat = statRegularFile(resolvedPath);
  if (!stat) {
    throw createError({ statusCode: 404, statusMessage: 'File not found' });
  }

  if (!isAudio) {
    // `?w=`: a resized copy, after exactly the checks above.
    const resized = await serveResizedThumbnail(event, resolvedPath, stat);
    if (resized) return resized;
  }
  // Audio and images can be replaced (a clip backfill, a re-download) or lose
  // visibility: revalidated daily, never cached as immutable.
  return sendMediaFile(event, resolvedPath, stat, { contentType: contentType!, immutable: false });
});
