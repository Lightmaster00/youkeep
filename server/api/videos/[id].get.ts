import { defineEventHandler, createError, getQuery } from 'h3';
import crypto from 'crypto';
import { listSubtitleFiles, resolveStoredPath } from '../../utils/videoPaths';

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

  // Permission check
  const hasAccess = await canAccessVideo(videoId, event, token);
  if (!hasAccess) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Access denied. You do not have permission to view this video.'
    });
  }
  
  // Record in the watch history if the user is logged in
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

  // Auto-generate the share token for the admin if missing
  if (session?.role === 'admin' && !video.share_token) {
    const nextToken = crypto.randomUUID();
    db.prepare('UPDATE videos SET share_token = ? WHERE id = ?').run(nextToken, videoId);
    video.share_token = nextToken;
  }

  // Fetch the associated comments
  const comments = db.prepare(`
    SELECT * FROM comments
    WHERE video_id = ?
    ORDER BY like_count DESC, created_at DESC
  `).all(videoId);

  // Retrieve chapters for this video
  const chapters = db.prepare(`
    SELECT start_time, title, source FROM video_chapters
    WHERE video_id = ?
    ORDER BY start_time ASC
  `).all(videoId);

  // Local subtitles (.vtt) next to the video: in its own folder (one folder per
  // video) or, for legacy videos, in the channel folder as <id>.<lang>.vtt.
  const subtitles: { code: string; label: string; url: string }[] = [];
  if (video.local_video_path && video.local_video_path.startsWith('/downloads/')) {
    try {
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
      const location = resolveStoredPath(db, video, { downloadsDir: getDownloadsDir() });
      for (const sub of listSubtitleFiles(location)) {
        // Match codes like en-US, fr-FR, etc.
        const cleanCode = sub.code.split('-')[0]?.toLowerCase() || sub.code.toLowerCase();
        subtitles.push({ code: sub.code, label: labelMap[cleanCode] || sub.code.toUpperCase(), url: sub.url });
      }
    } catch (e) {
      console.error('Error scanning subtitles:', e);
    }
  }

  return { video, comments, subtitles, chapters };
});
