import path from 'path';

// One folder per video: <base>/<Channel>/<Title> [<id>]/<Title> [<id>].<ext>
// (spec docs/superpowers/specs/2026-10-06-video-storage-layout-design.md).

export const VIDEO_BASENAME_MAX_BYTES = 120;
export const VIDEO_EXTENSIONS = ['mp4', 'webm', 'mkv', '3gp', 'flv'];
export const THUMB_EXTENSIONS = ['jpg', 'jpeg', 'webp', 'png'];

// Path-forbidden characters on common filesystems (incl. SMB shares) and control characters.
const FORBIDDEN_CHARS = /[\\/:*?"<>|\u0000-\u001f\u007f]/g;

function cleanName(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .replace(FORBIDDEN_CHARS, '_')
    .replace(/^[\s.]+|[\s.]+$/g, '');
}

// Iterates by code point, so a multi-byte character is either kept whole or dropped.
function truncateToBytes(value: string, maxBytes: number): string {
  let out = '';
  let used = 0;
  for (const ch of value) {
    const size = Buffer.byteLength(ch, 'utf8');
    if (used + size > maxBytes) break;
    out += ch;
    used += size;
  }
  return out;
}

export function videoBaseName(title: string | null | undefined, id: string): string {
  const safeId = cleanName(id) || '_';
  const suffix = ` [${safeId}]`;
  const budget = Math.max(0, VIDEO_BASENAME_MAX_BYTES - Buffer.byteLength(suffix, 'utf8'));
  let name = cleanName(truncateToBytes(cleanName(title ?? ''), budget));
  if (!name) name = cleanName(truncateToBytes(safeId, budget)) || '_';
  return `${name}${suffix}`;
}

export function videoFolderName(title: string | null | undefined, id: string): string {
  return videoBaseName(title, id);
}

export interface VideoPaths {
  /** Absolute folder holding every file of the video. */
  dir: string;
  /** File-name stem shared by every file of the video; equals the folder name. */
  baseName: string;
  /** Web folder, `/downloads/<channel>/<video folder>`, each segment percent-encoded. */
  urlDir: string;
  /** yt-dlp `-o` value; literal `%` doubled so yt-dlp does not read it as a field. */
  outputTemplate: string;
  subtitleGlob: string;
  videoUrlFor(ext: string): string;
  thumbUrlFor(ext: string): string;
  subtitleUrlFor(fileName: string): string;
}

export function buildVideoPaths(opts: { baseDir: string; channelFolder: string; title: string | null | undefined; id: string }): VideoPaths {
  const channelFolder = !opts.channelFolder || opts.channelFolder === '.' || opts.channelFolder === '..' ? '_' : opts.channelFolder;
  const baseName = videoBaseName(opts.title, opts.id);
  const dir = path.join(opts.baseDir, channelFolder, baseName);
  const urlDir = `/downloads/${encodeURIComponent(channelFolder)}/${encodeURIComponent(baseName)}`;
  const fileUrl = (fileName: string) => `${urlDir}/${encodeURIComponent(fileName)}`;
  return {
    dir,
    baseName,
    urlDir,
    outputTemplate: `${path.join(dir, baseName).replace(/%/g, '%%')}.%(ext)s`,
    subtitleGlob: `${baseName}.*.vtt`,
    videoUrlFor: (ext) => fileUrl(`${baseName}.${ext}`),
    thumbUrlFor: (ext) => fileUrl(`${baseName}.${ext}`),
    subtitleUrlFor: (fileName) => fileUrl(fileName),
  };
}

/** Decodes URL path segments; null when one is malformed or could escape its folder. */
export function decodeUrlSegments(rawSegments: string[]): string[] | null {
  const out: string[] = [];
  for (const raw of rawSegments) {
    let segment: string;
    try {
      segment = decodeURIComponent(raw);
    } catch {
      return null;
    }
    if (!segment || segment === '.' || segment === '..' || /[\\/\u0000]/.test(segment)) return null;
    out.push(segment);
  }
  return out;
}

/** `[channel folder, video folder, file]` (decoded) for a new-layout stored URL, else null. */
export function storedUrlSegments(url: string | null | undefined): [string, string, string] | null {
  if (!url || !url.startsWith('/downloads/')) return null;
  const raw = url.slice('/downloads/'.length).split('/');
  if (raw.length !== 3) return null;
  const segments = decodeUrlSegments(raw);
  return segments ? [segments[0]!, segments[1]!, segments[2]!] : null;
}

/** The id between the last brackets of a video folder name (`<Title> [<id>]`). */
export function idFromVideoFolder(folder: string): string | null {
  const match = folder.match(/\[([^[\]]+)\]$/);
  return match ? match[1]! : null;
}

export function isNewLayoutUrl(url: string | null | undefined, id: string): boolean {
  const segments = storedUrlSegments(url);
  return !!segments && segments[1].endsWith(`[${id}]`);
}

/** Base folder used to READ a channel's files (same rule the file route has always used). */
export function channelReadBaseDir(customSavePath: string | null | undefined, downloadsDir: string): string {
  return customSavePath && customSavePath.trim().length > 0 ? customSavePath : downloadsDir;
}

/**
 * Folders where a new-layout video may live, in lookup order. The second entry
 * covers a channel whose custom save path already ends with the channel folder
 * name (the doubled-folder case) once the tidy tool has moved its videos up.
 */
export function candidateVideoDirs(baseDir: string, channelFolder: string, videoFolder: string): string[] {
  const resolvedBase = path.resolve(baseDir);
  const dirs = [path.resolve(resolvedBase, channelFolder, videoFolder)];
  if (path.basename(resolvedBase) === channelFolder) dirs.push(path.resolve(resolvedBase, videoFolder));
  return dirs;
}

/** True when `child` is strictly inside `parent`. */
export function isContained(parent: string, child: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}
