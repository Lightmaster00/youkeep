import fs from 'fs';
import path from 'path';
import { defineEventHandler, createError } from 'h3';
import { candidateVideoDirs, channelBaseDirs, decodeUrlSegments, idFromVideoFolder, isContained, storedUrlSegments } from '../../utils/videoPaths';

export default defineEventHandler(async (event) => {
  const filePath = event.context.params?.path;
  if (!filePath) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid file path' });
  }

  // Resolve absolute path and prevent directory traversal
  const downloadsDir = getDownloadsDir();
  let absolutePath = path.resolve(downloadsDir, filePath);

  const parts = filePath.split('/');
  if (parts.length === 3) {
    // One folder per video: <channel folder>/<Title [id]>/<file>, percent-encoded.
    // The id comes from the folder name, and the folder must be the one stored
    // for that video (the database is the source of truth for file locations).
    const segments = decodeUrlSegments(parts);
    const videoId = segments ? idFromVideoFolder(segments[1]!) : null;
    if (!segments || !videoId) {
      throw createError({ statusCode: 400, statusMessage: 'Invalid file path' });
    }
    const [channelSegment, videoFolder, fileName] = segments as [string, string, string];
    const db = getDb();
    const video = db.prepare(`
      SELECT v.id, v.local_video_path, v.local_thumbnail_path, c.custom_save_path
      FROM videos v JOIN channels c ON c.id = v.channel_id
      WHERE v.id = ?
    `).get(videoId) as { id: string; local_video_path: string | null; local_thumbnail_path: string | null; custom_save_path: string | null } | undefined;
    // Authorise before revealing anything: denied and nonexistent must be
    // indistinguishable (404), so folder names and sidecars cannot be probed.
    const query = getQuery(event);
    const token = query.token ? String(query.token) : undefined;
    if (!video || !(await canAccessVideo(video.id, event, token))) {
      throw createError({ statusCode: 404, statusMessage: 'File not found' });
    }
    const stored = storedUrlSegments(video.local_video_path) ?? storedUrlSegments(video.local_thumbnail_path);
    if (!stored || stored[0] !== channelSegment || stored[1] !== videoFolder) {
      throw createError({ statusCode: 404, statusMessage: 'File not found' });
    }
    // Where the downloader writes this channel's files first, then the other
    // place it may have written them (see channelBaseDirs).
    const candidates = channelBaseDirs(video.custom_save_path, downloadsDir).flatMap((baseDir) =>
      candidateVideoDirs(baseDir, channelSegment, videoFolder).map((dir) => ({ baseDir, file: path.resolve(dir, fileName) })));
    if (candidates.some((candidate) => !isContained(candidate.baseDir, candidate.file))) {
      throw createError({ statusCode: 403, statusMessage: 'Access denied' });
    }
    absolutePath = (candidates.find((candidate) => fs.existsSync(candidate.file)) ?? candidates[0]!).file;
  } else {
    if (parts.length < 2) {
      throw createError({ statusCode: 400, statusMessage: 'Invalid file path' });
    }
    {
      const fileName = parts[parts.length - 1] || '';
      // Legacy files are stored flat as {channelDir}/{videoId}.{ext} — never in
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
      if (video) {
        // Authorise before probing the disk: denied and nonexistent must be
        // indistinguishable (404), so legacy sidecars cannot be probed either.
        const query = getQuery(event);
        const token = query.token ? String(query.token) : undefined;
        if (!(await canAccessVideo(video.id, event, token))) {
          throw createError({ statusCode: 404, statusMessage: 'File not found' });
        }
      }

      const channel = db.prepare('SELECT title, custom_save_path FROM channels WHERE id = ?').get(channelId) as { title: string; custom_save_path: string | null } | undefined;
      if (channel) {
        // Same bases, same order as the new layout above.
        for (const basePath of channelBaseDirs(channel.custom_save_path, downloadsDir)) {
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
            break;
          }
        }
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

  // Every file tied to a known video (video, thumbnail, subtitles, ...) was
  // authorised above, before any disk probe, with the video's own visibility rules.
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

  const isImmutableMedia = ext === '.mp4';
  if (isImmutableMedia) {
    event.node.res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  } else {
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
  }

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
