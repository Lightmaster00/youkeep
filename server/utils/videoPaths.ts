import fs from 'fs';
import path from 'path';
import type Database from 'better-sqlite3';
import { getDownloadsDir, sanitizeFolderName } from './downloader';
import { getDataDir } from './dataDir';

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

// A channel folder is one path segment. It must stay byte-for-byte what
// sanitizeFolderName produced (channel delete and library wipe remove
// `<base>/<sanitizeFolderName(title)>`), so only separators, control
// characters and the degenerate '', '.', '..' are replaced.
function channelSegment(channelFolder: string): string {
  const cleaned = (channelFolder ?? '').replace(/[\\/\u0000-\u001f\u007f]/g, '_');
  return !cleaned || cleaned === '.' || cleaned === '..' ? '_' : cleaned;
}

// encodeURIComponent leaves ! ' ( ) * as is; they break unquoted CSS url(...).
function encodeSegment(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
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

export function buildVideoPaths(opts: { baseDir: string; channelFolder: string; title: string | null | undefined; id: string; folderName?: string }): VideoPaths {
  const channelFolder = channelSegment(opts.channelFolder);
  // An existing folder name (found on disk) wins over one built from the title.
  const baseName = opts.folderName ?? videoBaseName(opts.title, opts.id);
  let dir = path.join(opts.baseDir, channelFolder, baseName);
  if (!isContained(opts.baseDir, dir)) dir = path.join(opts.baseDir, '_', baseName);
  const urlDir = `/downloads/${encodeSegment(channelFolder)}/${encodeSegment(baseName)}`;
  const fileUrl = (fileName: string) => `${urlDir}/${encodeSegment(fileName)}`;
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

/** The id as it appears between the brackets of a video folder name. */
export function folderIdOf(id: string): string {
  return cleanName(id) || '_';
}

/** The id between the last brackets of a video folder name (`<Title> [<id>]`). */
export function idFromVideoFolder(folder: string): string | null {
  // Only the LAST `[...]` group counts; the id itself may contain brackets.
  if (!folder.endsWith(']')) return null;
  const start = folder.lastIndexOf(' [');
  const id = start >= 0 ? folder.slice(start + 2, -1) : folder.startsWith('[') ? folder.slice(1, -1) : '';
  return id || null;
}

export function isNewLayoutUrl(url: string | null | undefined, id: string): boolean {
  const segments = storedUrlSegments(url);
  return !!segments && segments[1].endsWith(`[${cleanName(id) || '_'}]`);
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
  const channel = channelSegment(channelFolder);
  const dirs = [path.resolve(resolvedBase, channel, videoFolder)];
  if (path.basename(resolvedBase) === channel) dirs.push(path.resolve(resolvedBase, videoFolder));
  return dirs;
}

/** True when `child` is strictly inside `parent`. */
export function isContained(parent: string, child: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

/** Locates the files yt-dlp produced for a video (any container / thumbnail extension). */
export function locateDownloadedFiles(p: VideoPaths): { videoFile: string | null; videoUrl: string | null; thumbnailUrl: string | null; infoJsonFile: string } {
  let videoFile: string | null = null;
  let videoUrl: string | null = null;
  for (const ext of VIDEO_EXTENSIONS) {
    const candidate = path.join(p.dir, `${p.baseName}.${ext}`);
    if (fs.existsSync(candidate)) {
      videoFile = candidate;
      videoUrl = p.videoUrlFor(ext);
      break;
    }
  }
  let thumbnailUrl: string | null = null;
  for (const ext of THUMB_EXTENSIONS) {
    if (fs.existsSync(path.join(p.dir, `${p.baseName}.${ext}`))) {
      thumbnailUrl = p.thumbUrlFor(ext);
      break;
    }
  }
  return { videoFile, videoUrl, thumbnailUrl, infoJsonFile: path.join(p.dir, `${p.baseName}.info.json`) };
}

export interface StoredVideoLocation {
  layout: 'new' | 'legacy';
  /** Absolute channel base folder (custom save path or downloads dir). */
  baseDir: string;
  /** Absolute folder holding the video's files. */
  dir: string;
  /** File-name stem: '<Title> [<id>]' (new layout) or '<id>' (legacy). */
  baseName: string;
  /** Web folder: percent-encoded for the new layout, raw (as always) for legacy. */
  urlDir: string;
  /** Absolute path of the stored video file, when a path is stored. */
  videoFile: string | null;
}

// Extra containers yt-dlp may write per format before merging (audio streams).
const FRAGMENT_EXTENSIONS = [...VIDEO_EXTENSIONS, 'm4a', 'opus', 'mka', 'mp3', 'aac', 'ogg'];
const MEDIA_RE = new RegExp(`^(?:(?:f[A-Za-z0-9_-]+|temp)\\.)?(?:${FRAGMENT_EXTENSIONS.join('|')})$`, 'i');
const THUMB_RE = new RegExp(`^(?:${THUMB_EXTENSIONS.join('|')})$`, 'i');
const SUBTITLE_RE = /^[A-Za-z0-9_-]+\.vtt$/i;
// Download leftovers: <file>.part, <file>.ytdl, <file>.part-Frag<n>[.part].
const PARTIAL_SUFFIX_RE = /(?:\.part(?:-Frag\d+(?:\.part)?)?|\.ytdl)$/i;

/**
 * True when `entry` is a file name yt-dlp produces for this video: the media
 * (incl. per-format fragments, merge temp files and partials), thumbnail,
 * `<lang>.vtt` subtitles, `.info.json` or a `.description` (moved in by the
 * tidy tool from a legacy download). Anything else is a foreign file.
 */
export function isVideoArtifactName(baseName: string, entry: string): boolean {
  const prefix = `${baseName}.`;
  if (!entry.startsWith(prefix)) return false;
  const rest = entry.slice(prefix.length);
  if (rest === 'info.json' || rest === 'description') return true;
  const core = rest.replace(PARTIAL_SUFFIX_RE, '');
  return MEDIA_RE.test(core) || THUMB_RE.test(core) || SUBTITLE_RE.test(core);
}

function isRegularFile(file: string): boolean {
  try {
    return fs.lstatSync(file).isFile();
  } catch {
    return false;
  }
}

/**
 * Removes a new-layout video's files: only regular files that are known video
 * artifacts (never a directory, symlink or foreign file), then the folder
 * itself (non-recursively) when nothing else was in it. Never throws: each
 * failure is logged and counted. Legacy locations are left to their callers'
 * existing file lists.
 */
export function removeVideoFiles(loc: StoredVideoLocation): { removed: number; failed: number } {
  const result = { removed: 0, failed: 0 };
  if (loc.layout !== 'new' || !isContained(loc.baseDir, loc.dir)) return result;
  let entries: string[];
  try {
    if (!fs.existsSync(loc.dir)) return result;
    entries = fs.readdirSync(loc.dir);
  } catch (err) {
    console.error(`Failed to read video folder ${loc.dir}:`, err);
    result.failed++;
    return result;
  }
  const own = entries.filter((entry) => isVideoArtifactName(loc.baseName, entry) && isRegularFile(path.join(loc.dir, entry)));
  for (const entry of own) {
    const file = path.join(loc.dir, entry);
    try {
      fs.unlinkSync(file);
      result.removed++;
    } catch (err: any) {
      if (err?.code === 'ENOENT') continue;
      console.error(`Failed to delete video file ${file}:`, err);
      result.failed++;
    }
  }
  if (own.length === entries.length && result.failed === 0) {
    try {
      fs.rmdirSync(loc.dir);
    } catch (err: any) {
      // ENOTEMPTY: something new appeared meanwhile; the folder stays with it.
      if (err?.code !== 'ENOENT' && err?.code !== 'ENOTEMPTY') {
        console.error(`Failed to delete video folder ${loc.dir}:`, err);
        result.failed++;
      }
    }
  }
  return result;
}

/**
 * Name of a video folder already on disk in `channelDir` for this id (its
 * `[<id>]` suffix matches), or null. Several matches: the first, in name order,
 * that holds a file named after it (media or `.part`), else the first.
 */
export function findExistingVideoDir(channelDir: string, id: string): string | null {
  const wanted = cleanName(id) || '_';
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(channelDir, { withFileTypes: true });
  } catch {
    return null;
  }
  const matches = entries
    .filter((entry) => entry.isDirectory() && idFromVideoFolder(entry.name) === wanted)
    .map((entry) => entry.name)
    .sort();
  if (matches.length === 0) return null;
  const withOwnFiles = matches.find((name) => {
    try {
      return fs.readdirSync(path.join(channelDir, name)).some((f) => f.startsWith(`${name}.`));
    } catch {
      return false;
    }
  });
  return withOwnFiles ?? matches[0]!;
}

/**
 * Paths for downloading (or cleaning up) a video: reuses the video's folder
 * already on disk, so a title change between attempts keeps resume and cleanup
 * in the same folder; otherwise the folder is named from the current title.
 */
export function resolveVideoPaths(opts: { baseDir: string; channelFolder: string; title: string | null | undefined; id: string }): VideoPaths {
  const existing = findExistingVideoDir(path.join(opts.baseDir, channelSegment(opts.channelFolder)), opts.id);
  return buildVideoPaths({ ...opts, folderName: existing ?? undefined });
}

/**
 * Where a video's files are on disk. The stored path is the source of truth:
 * a new-layout URL maps to its own folder (looked up the same way the file
 * route does), a legacy URL to the channel folder; only a video without a
 * stored path yet gets its folder computed from title + id (reusing a folder
 * already on disk for this id, like the downloader does).
 */
export function resolveStoredPath(
  db: Database.Database,
  row: { id: string; channel_id: string; title?: string | null; local_video_path: string | null },
  opts: { downloadsDir?: string } = {},
): StoredVideoLocation {
  const channel = db.prepare('SELECT title, custom_save_path FROM channels WHERE id = ?').get(row.channel_id) as
    { title: string | null; custom_save_path: string | null } | undefined;
  const downloadsDir = opts.downloadsDir ?? getDownloadsDir();
  const baseDir = path.resolve(channelReadBaseDir(channel?.custom_save_path, downloadsDir));
  const channelFolder = sanitizeFolderName(channel?.title || row.channel_id);

  const stored = isNewLayoutUrl(row.local_video_path, row.id) ? storedUrlSegments(row.local_video_path) : null;
  if (stored) {
    const [channelFolderSegment, videoFolder, fileName] = stored;
    const candidates = candidateVideoDirs(baseDir, channelFolderSegment, videoFolder);
    const dir = candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0]!;
    return {
      layout: 'new',
      baseDir,
      dir,
      baseName: videoFolder,
      urlDir: `/downloads/${encodeSegment(channelFolderSegment)}/${encodeSegment(videoFolder)}`,
      videoFile: path.join(dir, fileName),
    };
  }
  if (row.local_video_path) {
    const dir = path.resolve(baseDir, channelFolder);
    return {
      layout: 'legacy',
      baseDir,
      dir,
      baseName: row.id,
      urlDir: `/downloads/${channelFolder}`,
      videoFile: path.resolve(dir, path.posix.basename(row.local_video_path)),
    };
  }
  const p = resolveVideoPaths({ baseDir, channelFolder, title: row.title, id: row.id });
  return { layout: 'new', baseDir, dir: p.dir, baseName: p.baseName, urlDir: p.urlDir, videoFile: null };
}

/** Subtitle files `<baseName>.<code>.vtt` next to the video. */
export function listSubtitleFiles(loc: StoredVideoLocation): { code: string; fileName: string; url: string }[] {
  if (!isContained(loc.baseDir, loc.dir) || !fs.existsSync(loc.dir)) return [];
  const prefix = `${loc.baseName}.`;
  return fs.readdirSync(loc.dir)
    .filter((file) => file.startsWith(prefix) && file.endsWith('.vtt'))
    .map((file) => ({
      code: file.slice(prefix.length, file.length - '.vtt'.length),
      fileName: file,
      url: loc.layout === 'new' ? `${loc.urlDir}/${encodeSegment(file)}` : `${loc.urlDir}/${file}`,
    }))
    .filter((sub) => sub.code.length > 0);
}

/**
 * Where the music and podcast downloaders write: the defaults and local
 * fallbacks of getMusicDownloadsDir / getPodcastDownloadsDir. Listed here
 * (not computed by calling them: they create folders) so a video channel
 * folder that happens to be one of them is never removed recursively.
 */
export function musicAndPodcastRoots(): string[] {
  return [
    '/downloads/music',
    '/downloads/podcasts',
    path.join(getDataDir(), 'downloads-music'),
    path.join(getDataDir(), 'downloads-podcasts'),
  ];
}

/**
 * A path in a form that compares equal for every way of naming one folder:
 * the real path of its deepest existing part (symlinks and aliases resolved),
 * then the rest as written; no trailing separator; lower case (folders that
 * differ only by case are the same folder on case-insensitive disks and SMB).
 */
function comparablePath(p: string): string {
  const resolved = path.resolve(p);
  const rest: string[] = [];
  let probe = resolved;
  let real = resolved;
  for (;;) {
    try {
      real = path.join(fs.realpathSync(probe), ...rest);
      break;
    } catch {
      const parent = path.dirname(probe);
      if (parent === probe) {
        real = resolved;
        break;
      }
      rest.unshift(path.basename(probe));
      probe = parent;
    }
  }
  const trimmed = real.length > 1 ? real.replace(/[\\/]+$/, '') : real;
  return trimmed.toLowerCase();
}

/** True when `child` is `parent` itself or inside it, however either is spelled. */
function sameOrInsideFolder(parent: string, child: string): boolean {
  const a = comparablePath(parent);
  const b = comparablePath(child);
  return a === b || b.startsWith(a.endsWith(path.sep) ? a : a + path.sep);
}

/**
 * Removes a music artist's or podcast show's folder `<base>/<folder>`, whose
 * files are named `<item id>.<ext>`. Same rules as removing a channel folder:
 * - the folder is only ever touched when it is strictly inside `baseDir`: a
 *   name like `..`, `.` or blank never points at the base folder or above;
 * - when another entity's folder name (`otherFolders`) is the same folder
 *   (same name, or differing only by case), only this entity's own files
 *   (`<id>.*` regular files for `ownIds`) are removed, and the folder itself
 *   only when it is then empty.
 * Never throws: failures are logged.
 */
export function removeEntityFolder(opts: { baseDir: string; folder: string; ownIds: string[]; otherFolders: string[]; label: string }): { removedDir: boolean; skippedReason: string | null } {
  const baseDir = path.resolve(opts.baseDir);
  const dir = path.resolve(baseDir, opts.folder);
  if (!isContained(baseDir, dir) || path.dirname(dir) !== baseDir) {
    const skippedReason = `the folder ${dir} is not inside ${baseDir}`;
    console.error(`${opts.label}: files left in place because ${skippedReason}.`);
    return { removedDir: false, skippedReason };
  }
  if (!fs.existsSync(dir)) {
    console.warn(`${opts.label}: folder not found, skipping file removal: ${dir}`);
    return { removedDir: false, skippedReason: null };
  }
  const shared = opts.otherFolders.some((other) => comparablePath(path.resolve(baseDir, other)) === comparablePath(dir));
  if (!shared) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return { removedDir: true, skippedReason: null };
    } catch (err) {
      console.error(`${opts.label}: failed to delete folder ${dir}:`, err);
      return { removedDir: false, skippedReason: null };
    }
  }
  const ids = new Set(opts.ownIds);
  try {
    for (const entry of fs.readdirSync(dir)) {
      const id = entry.slice(0, Math.max(0, entry.indexOf('.')));
      const file = path.join(dir, entry);
      if (ids.has(id) && isRegularFile(file)) {
        try { fs.unlinkSync(file); } catch (err) { console.error(`${opts.label}: failed to delete file ${file}:`, err); }
      }
    }
    fs.rmdirSync(dir); // only when nothing else is left in it
    return { removedDir: true, skippedReason: null };
  } catch (err: any) {
    if (err?.code !== 'ENOTEMPTY' && err?.code !== 'EEXIST') console.error(`${opts.label}: failed to clean folder ${dir}:`, err);
    return { removedDir: false, skippedReason: 'the folder holds another entity\'s files' };
  }
}

/**
 * Prepares removing a channel's files from disk. Call it BEFORE the channel's
 * rows are deleted (it reads them), then call `remove()` afterwards.
 * - `<base>/<Channel>` is only ever touched when it is strictly inside the base
 *   folder: a title like `..`, `.` or blank never points at the base or above.
 * - It is removed recursively only when it holds no one else's files: when
 *   another channel's base or channel folder (outside `excludeChannelIds`), the
 *   default downloads folder, or a music/podcast download root is that folder
 *   or inside it, only this channel's own video files and folders are removed,
 *   and the channel folder itself only if it is then empty.
 * - Videos a partly repaired doubled channel folder already moved up to
 *   `<base>/<Title> [<id>]` are removed with the rules of deleting one video.
 */
export function prepareChannelFilesRemoval(
  db: Database.Database,
  channelId: string,
  opts: { baseDir: string; downloadsDir?: string; excludeChannelIds?: Set<string>; protectedRoots?: string[] },
): { channelDir: string; remove(): { removedChannelDir: boolean; skippedReason: string | null } } {
  const channel = db.prepare('SELECT title FROM channels WHERE id = ?').get(channelId) as { title: string | null } | undefined;
  const baseDir = path.resolve(opts.baseDir);
  const downloadsDir = opts.downloadsDir ?? getDownloadsDir();
  const channelFolder = sanitizeFolderName(channel?.title || channelId);
  const channelDir = path.resolve(baseDir, channelFolder);
  const rows = db.prepare('SELECT id, channel_id, title, local_video_path FROM videos WHERE channel_id = ?').all(channelId) as
    { id: string; channel_id: string; title: string | null; local_video_path: string | null }[];
  const locations = rows.map((row) => resolveStoredPath(db, row, { downloadsDir }));
  const movedUp = locations.filter((loc, i) => !!rows[i]!.local_video_path && loc.layout === 'new'
    && path.dirname(loc.dir) === loc.baseDir && path.basename(loc.baseDir) === channelFolder);
  const ids = new Set(rows.map((row) => row.id));

  /** Why `channelDir` may hold someone else's files, or null. */
  const sharedReason = (): string | null => {
    const roots = [downloadsDir, ...(opts.protectedRoots ?? musicAndPodcastRoots())];
    if (roots.some((root) => sameOrInsideFolder(channelDir, root))) return 'a download root is that folder or inside it';
    const others = db.prepare('SELECT id, title, custom_save_path FROM channels WHERE id != ?').all(channelId) as
      { id: string; title: string | null; custom_save_path: string | null }[];
    for (const other of others) {
      if (opts.excludeChannelIds?.has(other.id)) continue;
      const folder = sanitizeFolderName(other.title || other.id);
      // Where it reads (its save folder) and where the downloader writes when that
      // folder is not writable (the default folder). Not resolveChannelBaseDir:
      // it creates missing folders.
      const bases = [channelReadBaseDir(other.custom_save_path, downloadsDir), downloadsDir];
      if (bases.some((base) => sameOrInsideFolder(channelDir, base) || sameOrInsideFolder(channelDir, path.join(base, folder)))) {
        return `channel "${other.title || other.id}" keeps its files there`;
      }
    }
    return null;
  };

  return {
    channelDir,
    remove() {
      for (const loc of movedUp) removeVideoFiles(loc);
      if (!isContained(baseDir, channelDir)) {
        const skippedReason = `the channel folder ${channelDir} is not inside its base folder ${baseDir}`;
        console.error(`Channel ${channelId}: files left in place because ${skippedReason}.`);
        return { removedChannelDir: false, skippedReason };
      }
      if (!fs.existsSync(channelDir)) return { removedChannelDir: false, skippedReason: null };
      const shared = sharedReason();
      if (shared) {
        // Only this channel's own files: its video folders, then its legacy <id>.* files.
        for (const loc of locations) if (loc.layout === 'new') removeVideoFiles(loc);
        try {
          for (const entry of fs.readdirSync(channelDir)) {
            const id = entry.slice(0, Math.max(0, entry.indexOf('.')));
            const file = path.join(channelDir, entry);
            if (ids.has(id) && isVideoArtifactName(id, entry) && isRegularFile(file)) {
              try { fs.unlinkSync(file); } catch (err) { console.error(`Failed to delete video file ${file}:`, err); }
            }
          }
          fs.rmdirSync(channelDir); // only when nothing else is left in it
          return { removedChannelDir: true, skippedReason: null };
        } catch (err: any) {
          if (err?.code !== 'ENOTEMPTY' && err?.code !== 'EEXIST') console.error(`Failed to clean channel directory ${channelDir}:`, err);
          console.warn(`Channel ${channelId}: ${channelDir} kept because ${shared}; only this channel's own files were removed.`);
          return { removedChannelDir: false, skippedReason: `the folder is shared: ${shared}` };
        }
      }
      try {
        fs.rmSync(channelDir, { recursive: true, force: true });
        return { removedChannelDir: true, skippedReason: null };
      } catch (err) {
        console.error(`Failed to delete channel directory ${channelDir}:`, err);
        return { removedChannelDir: false, skippedReason: null };
      }
    },
  };
}
