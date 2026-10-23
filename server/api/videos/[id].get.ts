import { defineEventHandler, createError, getQuery } from 'h3';
import crypto from 'crypto';
import { listSubtitleFiles, resolveStoredPath } from '../../utils/videoPaths';
import { videoColumnsSql } from '../../utils/videoAccess';

export default defineEventHandler(async (event) => {
  const session = await getUserFromSession(event);
  const videoId = event.context.params?.id;
  const query = getQuery(event);
  const token = query.token ? String(query.token) : undefined;

  if (!videoId) {
    throw createError({ statusCode: 400, statusMessage: 'Video ID is required.' });
  }

  const db = getDb();

  // Explicit columns: queue internals and the share token are admin-only.
  const video = db.prepare(`
    SELECT
      ${videoColumnsSql(session)},
      c.title as channel_title,
      c.avatar_url as channel_avatar,
      c.description as channel_description,
      c.visibility as channel_visibility,
      -- Whether a plain /watch link works for anyone (the Share button for non-admins).
      CASE WHEN COALESCE(v.visibility, 'public') = 'public' AND COALESCE(c.visibility, 'public') = 'public' THEN 1 ELSE 0 END as publicly_shareable
    FROM videos v
    JOIN channels c ON v.channel_id = c.id
    WHERE v.id = ?
  `).get(videoId) as any;

  // A video the viewer may not see answers exactly like a missing one.
  if (!video || !(await canAccessVideo(videoId, event, token))) {
    throw createError({ statusCode: 404, statusMessage: 'Video not found.' });
  }
  
  // Where this viewer left the video (server-side resume), before the visit below.
  let resumePosition: number | null = null;
  if (session) {
    const row = db.prepare('SELECT position_seconds FROM user_history WHERE user_id = ? AND video_id = ?').get(session.id, videoId) as { position_seconds: number } | undefined;
    resumePosition = row && row.position_seconds > 0 ? row.position_seconds : null;
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
    SELECT id, video_id, author, author_thumbnail, text, time_text, like_count, created_at
    FROM comments
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

  return { video, comments, subtitles, chapters, resume: { positionSeconds: resumePosition } };
});
