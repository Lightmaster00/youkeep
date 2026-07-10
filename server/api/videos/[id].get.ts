import { defineEventHandler, createError, getQuery } from 'h3';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getDownloadsDir } from '../../utils/downloader';

export default defineEventHandler(async (event) => {
  const session = await getUserFromSession(event);
  const videoId = event.context.params?.id;
  const query = getQuery(event);
  const token = query.token ? String(query.token) : undefined;

  if (!videoId) {
    throw createError({ statusCode: 400, statusMessage: 'Video ID is required.' });
  }

  const db = getDb();

  const video = db.prepare(`
    SELECT 
      v.*,
      c.title as channel_title,
      c.avatar_url as channel_avatar,
      c.description as channel_description
    FROM videos v
    JOIN channels c ON v.channel_id = c.id
    WHERE v.id = ?
  `).get(videoId) as any;

  if (!video) {
    throw createError({ statusCode: 404, statusMessage: 'Video not found.' });
  }

  // Vérification de permission
  const hasAccess = await canAccessVideo(videoId, event, token);
  if (!hasAccess) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Access denied. You do not have permission to view this video.'
    });
  }
  
  // Enregistrer dans l'historique de visionnage si l'utilisateur est connecté
  if (session) {
    try {
      db.prepare(`
        INSERT INTO user_history (user_id, video_id, watched_at)
        VALUES (?, ?, ?)
        ON CONFLICT(user_id, video_id) DO UPDATE SET watched_at = ?
      `).run(session.id, videoId, Date.now(), Date.now());
    } catch (e) {
      console.error('Failed to update watch history:', e);
    }
  }

  // Auto-générer le share token pour l'admin si non existant
  if (session?.role === 'admin' && !video.share_token) {
    const nextToken = crypto.randomUUID();
    db.prepare('UPDATE videos SET share_token = ? WHERE id = ?').run(nextToken, videoId);
    video.share_token = nextToken;
  }

  // Récupérer les commentaires associés
  const comments = db.prepare(`
    SELECT * FROM comments 
    WHERE video_id = ? 
    ORDER BY like_count DESC, created_at DESC
  `).all(videoId);

  // Détecter les sous-titres locaux disponibles (.vtt)
  const subtitles: { code: string; label: string; url: string }[] = [];
  if (video.local_video_path && video.local_video_path.startsWith('/downloads/')) {
    try {
      const downloadsDir = getDownloadsDir();
      const channel = db.prepare('SELECT title, custom_save_path FROM channels WHERE id = ?').get(video.channel_id) as any;
      const basePath = channel?.custom_save_path && channel.custom_save_path.trim().length > 0
        ? channel.custom_save_path
        : downloadsDir;
      
      const channelFolder = sanitizeFolderName(channel?.title || video.channel_id);
      const dirPath = path.join(basePath, channelFolder);

      if (fs.existsSync(dirPath)) {
        const files = fs.readdirSync(dirPath);
        const prefix = `${video.id}.`;
        
        for (const file of files) {
          if (file.startsWith(prefix) && file.endsWith('.vtt')) {
            const langCode = file.substring(prefix.length, file.length - '.vtt'.length);
            if (langCode && langCode.length > 0) {
              const labelMap: Record<string, string> = {
                en: 'English',
                fr: 'French',
                es: 'Spanish',
                de: 'German',
                it: 'Italian',
                ja: 'Japanese',
                zh: 'Chinese',
                ru: 'Russian',
                pt: 'Portuguese',
              };
              // Match codes like en-US, fr-FR, etc.
              const cleanCode = langCode.split('-')[0]?.toLowerCase() || langCode.toLowerCase();
              const label = labelMap[cleanCode] || langCode.toUpperCase();
              const url = `/downloads/${channelFolder}/${file}`;
              subtitles.push({ code: langCode, label, url });
            }
          }
        }
      }
    } catch (e) {
      console.error('Error scanning subtitles:', e);
    }
  }

  return { video, comments, subtitles };
});
