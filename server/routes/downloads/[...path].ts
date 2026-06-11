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
  let isCustom = false;

  const sanitizeFolderName = (name: string) => name.replace(/[\\/:*?"<>|]/g, '_').trim();

  const parts = filePath.split('/');
  if (parts.length >= 2) {
    const fileName = parts[parts.length - 1] || '';
    const videoId = fileName.split('.')[0] || '';
    const db = getDb();
    
    // Find the channel_id for this video
    const video = db.prepare('SELECT channel_id FROM videos WHERE id = ?').get(videoId) as { channel_id: string } | undefined;
    if (video) {
      const channelId = video.channel_id;
      const channel = db.prepare('SELECT title, custom_save_path FROM channels WHERE id = ?').get(channelId) as { title: string; custom_save_path: string | null } | undefined;
      
      if (channel) {
        const remainingPath = parts.slice(1).join('/');
        const basePath = channel.custom_save_path && channel.custom_save_path.trim().length > 0
          ? channel.custom_save_path
          : downloadsDir;
        const resolvedPath = path.resolve(basePath, sanitizeFolderName(channel.title || channelId), remainingPath);
        if (fs.existsSync(resolvedPath)) {
          absolutePath = resolvedPath;
          if (channel.custom_save_path && channel.custom_save_path.trim().length > 0) {
            isCustom = true;
          }
        }
      }
    } else {
      // Fallback if video is not in DB yet (e.g. initial download phase or channel avatar etc.)
      const channelId = parts[0] || '';
      const channel = db.prepare('SELECT title, custom_save_path FROM channels WHERE id = ?').get(channelId) as { title: string; custom_save_path: string | null } | undefined;
      if (channel) {
        const remainingPath = parts.slice(1).join('/');
        const basePath = channel.custom_save_path && channel.custom_save_path.trim().length > 0
          ? channel.custom_save_path
          : downloadsDir;
        const resolvedPath = path.resolve(basePath, sanitizeFolderName(channel.title || channelId), remainingPath);
        if (fs.existsSync(resolvedPath)) {
          absolutePath = resolvedPath;
          if (channel.custom_save_path && channel.custom_save_path.trim().length > 0) {
            isCustom = true;
          }
        }
      }
    }
  }

  if (!isCustom && !absolutePath.startsWith(downloadsDir)) {
    throw createError({ statusCode: 403, statusMessage: 'Access denied' });
  }

  if (!fs.existsSync(absolutePath)) {
    throw createError({ statusCode: 404, statusMessage: 'File not found' });
  }

  // Vérification de sécurité pour les fichiers vidéo
  if (filePath.endsWith('.mp4')) {
    const dbPath = '/downloads/' + filePath;
    const db = getDb();
    const video = db.prepare('SELECT id FROM videos WHERE local_video_path = ?').get(dbPath) as { id: string } | undefined;
    
    if (video) {
      const query = getQuery(event);
      const token = query.token ? String(query.token) : undefined;
      const hasAccess = await canAccessVideo(video.id, event, token);
      if (!hasAccess) {
        throw createError({ statusCode: 403, statusMessage: 'Accès refusé. Ce contenu est restreint.' });
      }
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
