import fs from 'fs';
import path from 'path';
import { defineEventHandler, createError } from 'h3';

export default defineEventHandler(async (event) => {
  const filePath = event.context.params?.path;
  if (!filePath) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid file path' });
  }

  // Resolve absolute path and prevent directory traversal
  const downloadsDir = getDownloadsDir();
  let absolutePath = path.resolve(downloadsDir, filePath);
  let matchedVideoId: string | undefined;

  const parts = filePath.split('/');
  if (parts.length < 2) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid file path' });
  }
  {
    const fileName = parts[parts.length - 1] || '';
    // Files are always stored flat as {channelDir}/{videoId}.{ext} — never in
    // nested subdirectories — so the remainder after the channel segment must
    // be a single, plain filename. Reject anything else outright.
    const remainingPath = parts.slice(1).join('/');
    if (parts.length !== 2 || remainingPath !== fileName || remainingPath.includes('..')) {
      throw createError({ statusCode: 400, statusMessage: 'Invalid file path' });
    }

    const videoId = fileName.split('.')[0] || '';
    const db = getDb();

    // Find the channel_id for this video, falling back to treating the first
    // path segment as a channel id directly (e.g. avatar/before video is ingested)
    const video = db.prepare('SELECT id, channel_id FROM videos WHERE id = ?').get(videoId) as { id: string; channel_id: string } | undefined;
    const channelId = video ? video.channel_id : (parts[0] || '');
    if (video) matchedVideoId = video.id;

    const channel = db.prepare('SELECT title, custom_save_path FROM channels WHERE id = ?').get(channelId) as { title: string; custom_save_path: string | null } | undefined;
    if (channel) {
      const hasCustomPath = !!(channel.custom_save_path && channel.custom_save_path.trim().length > 0);
      const basePath = hasCustomPath ? (channel.custom_save_path as string) : downloadsDir;
      const channelDir = path.resolve(basePath, sanitizeFolderName(channel.title || channelId));
      const resolvedPath = path.resolve(channelDir, fileName);

      // Containment check: resolvedPath must stay inside channelDir, whether
      // it's the default downloads dir or a channel's custom save path.
      const relativeToChannelDir = path.relative(channelDir, resolvedPath);
      if (relativeToChannelDir.startsWith('..') || path.isAbsolute(relativeToChannelDir)) {
        throw createError({ statusCode: 403, statusMessage: 'Access denied' });
      }

      if (fs.existsSync(resolvedPath)) {
        absolutePath = resolvedPath;
      }
    }
  }

  // Belt-and-braces containment check against the default downloads dir for
  // paths that never matched a channel above (e.g. malformed single-segment paths).
  const relativeToDownloadsDir = path.relative(downloadsDir, absolutePath);
  const withinDownloadsDir = !relativeToDownloadsDir.startsWith('..') && !path.isAbsolute(relativeToDownloadsDir);
  if (!withinDownloadsDir && absolutePath === path.resolve(downloadsDir, filePath)) {
    throw createError({ statusCode: 403, statusMessage: 'Access denied' });
  }

  if (!fs.existsSync(absolutePath)) {
    throw createError({ statusCode: 404, statusMessage: 'File not found' });
  }

  // Vérification de sécurité: toute ressource rattachée à une vidéo connue
  // (fichier vidéo, miniature, sous-titres, ...) respecte les mêmes règles
  // de visibilité que la vidéo elle-même — pas seulement les extensions vidéo.
  if (matchedVideoId) {
    const query = getQuery(event);
    const token = query.token ? String(query.token) : undefined;
    const hasAccess = await canAccessVideo(matchedVideoId, event, token);
    if (!hasAccess) {
      throw createError({ statusCode: 403, statusMessage: 'Accès refusé. Ce contenu est restreint.' });
    }
  }

  const stat = fs.statSync(absolutePath);
  const fileSize = stat.size;
  const range = event.node.req.headers.range;

  // Determine Content-Type
  const ext = path.extname(absolutePath).toLowerCase();
  let contentType = 'application/octet-stream';
  if (ext === '.mp4') contentType = 'video/mp4';
  else if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
  else if (ext === '.png') contentType = 'image/png';
  else if (ext === '.webp') contentType = 'image/webp';
  else if (ext === '.vtt') contentType = 'text/vtt';

  event.node.res.setHeader('Accept-Ranges', 'bytes');
  event.node.res.setHeader('Content-Type', contentType);

  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0] || '0', 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

    if (start >= fileSize || end >= fileSize) {
      event.node.res.statusCode = 416;
      event.node.res.setHeader('Content-Range', `bytes */${fileSize}`);
      return 'Requested range not satisfiable';
    }

    const chunksize = (end - start) + 1;
    const fileStream = fs.createReadStream(absolutePath, { start, end });

    event.node.res.statusCode = 206;
    event.node.res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
    event.node.res.setHeader('Content-Length', chunksize);

    return fileStream;
  } else {
    event.node.res.statusCode = 200;
    event.node.res.setHeader('Content-Length', fileSize);
    const fileStream = fs.createReadStream(absolutePath);
    return fileStream;
  }
});
