import path from 'path';
import { defineEventHandler, createError } from 'h3';
import { serveResizedThumbnail } from '../../utils/thumbnails';
import { candidateVideoDirs, channelBaseDirs, decodeUrlSegments, idFromVideoFolder, isContained, isValidMediaId, storedUrlSegments, videoBaseName } from '../../utils/videoPaths';
import { sendMediaFile, statRegularFile } from '../../utils/mediaResponse';

const CONTENT_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.vtt': 'text/vtt',
};
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mkv']);

const notFound = () => createError({ statusCode: 404, statusMessage: 'File not found' });

/**
 * Every file is tied to a known video the requester may see; anything else
 * (a folder YouKeep did not create, a file two levels down that belongs to
 * no video, a directory) is a 404, indistinguishable from a missing file.
 * Layouts:
 * - one folder per video: `<channel folder>/<Title [id]>/<file>` (percent-encoded),
 *   the folder being the one stored for that video;
 * - legacy flat files: `<channel folder>/<id>.<ext>` (and `<id>.<lang>.vtt`), in
 *   the channel's current folder or the folder its stored path names.
 * Both are looked up under every base the downloader may have written to
 * (custom save folder, default folder, a doubled save folder moved up).
 */
export default defineEventHandler(async (event) => {
  const filePath = event.context.params?.path;
  if (!filePath) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid file path' });
  }

  const downloadsDir = getDownloadsDir();
  const db = getDb();
  const query = getQuery(event);
  const token = query.token ? String(query.token) : undefined;
  const parts = filePath.split('/');
  let absolutePath: string | null = null;
  let videoId: string;

  if (parts.length === 3) {
    // The id comes from the folder name, and the folder must be the one stored
    // for that video (the database is the source of truth for file locations).
    const segments = decodeUrlSegments(parts);
    const id = segments ? idFromVideoFolder(segments[1]!) : null;
    if (!segments || !id) {
      throw createError({ statusCode: 400, statusMessage: 'Invalid file path' });
    }
    videoId = id;
    const [channelSegment, videoFolder, fileName] = segments as [string, string, string];
    const video = db.prepare(`
      SELECT v.id, v.local_video_path, v.local_thumbnail_path, c.custom_save_path
      FROM videos v JOIN channels c ON c.id = v.channel_id
      WHERE v.id = ?
    `).get(videoId) as { id: string; local_video_path: string | null; local_thumbnail_path: string | null; custom_save_path: string | null } | undefined;
    // Authorise before revealing anything: denied and nonexistent must be
    // indistinguishable (404), so folder names and sidecars cannot be probed.
    if (!video || !(await canAccessVideo(video.id, event, token))) throw notFound();
    const stored = storedUrlSegments(video.local_video_path) ?? storedUrlSegments(video.local_thumbnail_path);
    if (!stored || stored[0] !== channelSegment || stored[1] !== videoFolder) throw notFound();
    const candidates = channelBaseDirs(video.custom_save_path, downloadsDir).flatMap((baseDir) =>
      candidateVideoDirs(baseDir, channelSegment, videoFolder).map((dir) => ({ baseDir, file: path.resolve(dir, fileName) })));
    absolutePath = candidates.find((c) => isContained(c.baseDir, c.file) && statRegularFile(c.file))?.file ?? null;
  } else if (parts.length === 2) {
    // Legacy URLs were stored unencoded: take the file name decoded when it decodes, else as is.
    const fileName = decodeUrlSegments([parts[1]!])?.[0] ?? parts[1]!;
    if (!fileName || fileName === '.' || fileName === '..' || /[\\/\u0000]/.test(fileName)) {
      throw createError({ statusCode: 400, statusMessage: 'Invalid file path' });
    }
    videoId = fileName.split('.')[0] || '';
    // Only a known video's own legacy file: never "whatever sits two levels down".
    if (!isValidMediaId(videoId)) throw notFound();
    const video = db.prepare(`
      SELECT v.id, v.channel_id, v.local_video_path, v.local_thumbnail_path, c.title, c.custom_save_path
      FROM videos v JOIN channels c ON c.id = v.channel_id
      WHERE v.id = ?
    `).get(videoId) as { id: string; channel_id: string; local_video_path: string | null; local_thumbnail_path: string | null; title: string | null; custom_save_path: string | null } | undefined;
    if (!video || !(await canAccessVideo(video.id, event, token))) throw notFound();
    // Folders this video's legacy files may be in: the channel's folder as
    // named now, and the one its stored paths name (a channel renamed since).
    const folders = new Set([sanitizeFolderName(video.title || video.channel_id)]);
    for (const stored of [video.local_video_path, video.local_thumbnail_path]) {
      const raw = stored?.startsWith('/downloads/') ? stored.slice('/downloads/'.length).split('/') : [];
      const decoded = raw.length === 2 ? decodeUrlSegments([raw[0]!]) : null;
      if (decoded) folders.add(decoded[0]!);
    }
    search: for (const basePath of channelBaseDirs(video.custom_save_path, downloadsDir)) {
      for (const folder of folders) {
        const channelDir = path.resolve(basePath, folder);
        const resolvedPath = path.resolve(channelDir, fileName);
        if (!isContained(basePath, channelDir) || path.dirname(resolvedPath) !== channelDir) continue;
        if (statRegularFile(resolvedPath)) {
          absolutePath = resolvedPath;
          break search;
        }
      }
    }
  } else {
    throw createError({ statusCode: 400, statusMessage: 'Invalid file path' });
  }

  // Directories, devices and missing files: the same 404.
  const stat = absolutePath ? statRegularFile(absolutePath) : null;
  if (!absolutePath || !stat) throw notFound();

  // `?w=` on an image: a resized copy, after exactly the checks above.
  const resized = await serveResizedThumbnail(event, absolutePath, stat);
  if (resized) return resized;

  const ext = path.extname(absolutePath).toLowerCase();
  const contentType = CONTENT_TYPES[ext] ?? 'application/octet-stream';
  // A video file named after its id (`<Title> [<id>].<ext>` or `<id>.<ext>`) never
  // changes behind its URL: immutable. Everything else revalidates daily.
  const base = path.basename(absolutePath, ext);
  const immutable = VIDEO_EXTENSIONS.has(ext) && (base === videoId || base.endsWith(` [${videoId}]`) || base === videoBaseName(null, videoId));
  return sendMediaFile(event, absolutePath, stat, { contentType, immutable });
});
