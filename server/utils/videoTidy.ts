import fs from 'fs';
import path from 'path';
import type Database from 'better-sqlite3';
import { buildVideoPaths, channelReadBaseDir, isNewLayoutUrl, storedUrlSegments } from './videoPaths';
import { sanitizeFolderName } from './downloader';

// "Tidy library files": moves legacy video files (flat <channel>/<id>.*) into
// one folder per video, and repairs doubled channel folders. Planning never
// touches the disk; see runTidy below for the move itself.

export interface PlannerFs {
  existsSync(p: string): boolean;
  statSync(p: string): { size: number; isDirectory(): boolean };
  readdirSync(p: string): string[];
  accessSync(p: string, mode?: number): void;
}

export const nodePlannerFs: PlannerFs = {
  existsSync: (p) => fs.existsSync(p),
  statSync: (p) => fs.statSync(p),
  readdirSync: (p) => fs.readdirSync(p),
  accessSync: (p, mode) => fs.accessSync(p, mode),
};

export interface TidyMove { from: string; to: string; size: number | null }

export interface TidyPlanItem {
  id: string;
  title: string;
  channelId: string;
  channelTitle: string;
  kind: 'legacy' | 'duplicate';
  fromDir: string;
  toDir: string;
  moves: TidyMove[];
  /** Folders removed after a successful move, only if empty (deepest first). */
  cleanupDirs: string[];
  oldVideoUrl: string;
  oldThumbUrl: string | null;
  newVideoUrl: string;
  newThumbUrl: string | null;
}

export interface TidyChannelFix { channelId: string; from: string; to: string }

export interface TidyPreview {
  total: number;
  toMove: number;
  alreadyTidy: number;
  conflicts: number;
  missingFiles: number;
  notWritable: number;
  duplicateFolders: number;
  samples: { id: string; title: string; from: string; to: string }[];
  channels: { channelId: string; channel: string; toMove: number }[];
}

export interface TidyPlan { preview: TidyPreview; items: TidyPlanItem[]; channelFixes: TidyChannelFix[] }

const SAMPLE_LIMIT = 10;

interface TidyRow {
  id: string;
  title: string;
  channelId: string;
  videoUrl: string;
  thumbUrl: string | null;
  channelTitle: string | null;
  customPath: string | null;
}

type Classified =
  | { status: 'tidy' | 'missing' | 'conflict' | 'notWritable' }
  | { status: 'move'; item: TidyPlanItem };

function sizeOf(fsx: PlannerFs, p: string): number | null {
  try {
    const stat = fsx.statSync(p);
    return stat.isDirectory() ? null : stat.size;
  } catch {
    return null;
  }
}

function isWritable(fsx: PlannerFs, dir: string): boolean {
  let probe = dir;
  while (!fsx.existsSync(probe)) {
    const parent = path.dirname(probe);
    if (parent === probe) return false;
    probe = parent;
  }
  try {
    fsx.accessSync(probe, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/** The target folder may only hold this video's own files (from an earlier, interrupted run). */
function targetHasForeignContent(fsx: PlannerFs, dir: string, baseName: string): boolean {
  if (!fsx.existsSync(dir)) return false;
  try {
    if (!fsx.statSync(dir).isDirectory()) return true;
  } catch {
    return true;
  }
  return fsx.readdirSync(dir).some((entry) => !entry.startsWith(`${baseName}.`));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isDoubled(customPath: string | null, baseDir: string, channelFolder: string): boolean {
  return !!(customPath && customPath.trim()) && path.basename(baseDir) === channelFolder;
}

function classify(row: TidyRow, downloadsDir: string, fsx: PlannerFs): Classified {
  const baseDir = path.resolve(channelReadBaseDir(row.customPath, downloadsDir));
  const channelFolder = sanitizeFolderName(row.channelTitle || row.channelId);
  const common = { id: row.id, title: row.title, channelId: row.channelId, channelTitle: row.channelTitle || row.channelId, oldVideoUrl: row.videoUrl, oldThumbUrl: row.thumbUrl };

  if (isNewLayoutUrl(row.videoUrl, row.id)) {
    const [channelSegment, videoFolder, fileName] = storedUrlSegments(row.videoUrl)!;
    if (!isDoubled(row.customPath, baseDir, channelSegment)) return { status: 'tidy' };
    const finalDir = path.join(baseDir, videoFolder);
    if (fsx.existsSync(path.join(finalDir, fileName))) return { status: 'tidy' };
    const nestedDir = path.join(baseDir, channelSegment, videoFolder);
    if (!fsx.existsSync(path.join(nestedDir, fileName))) return { status: 'missing' };
    if (targetHasForeignContent(fsx, finalDir, videoFolder)) return { status: 'conflict' };
    if (!isWritable(fsx, nestedDir) || !isWritable(fsx, finalDir)) return { status: 'notWritable' };
    // The video file first (it is what the preview samples show), then the rest by name.
    const moves = [...fsx.readdirSync(nestedDir)].sort()
      .filter((entry) => entry.startsWith(`${videoFolder}.`))
      .sort((a, b) => Number(b === fileName) - Number(a === fileName))
      .map((entry) => ({ from: path.join(nestedDir, entry), to: path.join(finalDir, entry), size: sizeOf(fsx, path.join(nestedDir, entry)) }));
    // Never overwrite a different file already at the final place.
    if (moves.some((m) => fsx.existsSync(m.to) && sizeOf(fsx, m.to) !== m.size)) return { status: 'conflict' };
    return {
      status: 'move',
      item: {
        ...common,
        kind: 'duplicate',
        fromDir: nestedDir,
        toDir: finalDir,
        moves,
        cleanupDirs: [nestedDir, path.join(baseDir, channelSegment)],
        newVideoUrl: row.videoUrl,
        newThumbUrl: row.thumbUrl,
      },
    };
  }

  const fileName = path.posix.basename(row.videoUrl);
  if (!fileName.startsWith(`${row.id}.`)) return { status: 'conflict' };
  const srcDir = path.join(baseDir, channelFolder);
  const doubled = isDoubled(row.customPath, baseDir, channelFolder);
  const target = buildVideoPaths({ baseDir: doubled ? path.dirname(baseDir) : baseDir, channelFolder, title: row.title, id: row.id });
  const moves: TidyMove[] = [];
  // Set when a destination file already exists with a different size: never overwrite it.
  let clash = false;
  const addMove = (sourceName: string): boolean => {
    const from = path.join(srcDir, sourceName);
    const to = path.join(target.dir, `${target.baseName}${sourceName.slice(row.id.length)}`);
    const fromSize = sizeOf(fsx, from);
    const toSize = sizeOf(fsx, to);
    if (fromSize !== null && fsx.existsSync(to) && toSize !== fromSize) clash = true;
    const size = fromSize ?? toSize;
    if (size === null) return false;
    moves.push({ from, to, size });
    return true;
  };

  if (!addMove(fileName)) return { status: 'missing' };
  const thumbName = row.thumbUrl ? path.posix.basename(row.thumbUrl) : '';
  // A thumbnail not named after the id is not one of this video's own files:
  // it is left where it is and its URL kept as is.
  let newThumbUrl: string | null = thumbName.startsWith(`${row.id}.`) ? null : row.thumbUrl;
  if (thumbName.startsWith(`${row.id}.`) && addMove(thumbName)) {
    newThumbUrl = target.thumbUrlFor(thumbName.slice(row.id.length + 1));
  }
  const subtitlePattern = new RegExp(`^${escapeRegExp(row.id)}(\\..+)?\\.vtt$`);
  if (fsx.existsSync(srcDir)) {
    for (const entry of [...fsx.readdirSync(srcDir)].sort()) {
      if (subtitlePattern.test(entry)) addMove(entry);
    }
  }
  if (clash || targetHasForeignContent(fsx, target.dir, target.baseName)) return { status: 'conflict' };
  if (!isWritable(fsx, srcDir) || !isWritable(fsx, target.dir)) return { status: 'notWritable' };

  return {
    status: 'move',
    item: {
      ...common,
      kind: doubled ? 'duplicate' : 'legacy',
      fromDir: srcDir,
      toDir: target.dir,
      moves,
      // A normal channel folder now holds the new video folders: never empty.
      cleanupDirs: doubled ? [srcDir] : [],
      newVideoUrl: target.videoUrlFor(fileName.slice(row.id.length + 1)),
      newThumbUrl,
    },
  };
}

export function planTidy(db: Database.Database, opts: { downloadsDir: string; fs?: PlannerFs }): TidyPlan {
  const fsx = opts.fs ?? nodePlannerFs;
  const rows = db.prepare(`
    SELECT v.id AS id, v.title AS title, v.channel_id AS channelId,
           v.local_video_path AS videoUrl, v.local_thumbnail_path AS thumbUrl,
           c.title AS channelTitle, c.custom_save_path AS customPath
    FROM videos v JOIN channels c ON c.id = v.channel_id
    WHERE v.download_status = 'completed' AND v.local_video_path IS NOT NULL AND v.local_video_path != ''
    ORDER BY v.channel_id, v.id
  `).all() as TidyRow[];

  const preview: TidyPreview = {
    total: rows.length, toMove: 0, alreadyTidy: 0, conflicts: 0, missingFiles: 0, notWritable: 0, duplicateFolders: 0,
    samples: [], channels: [],
  };
  const items: TidyPlanItem[] = [];
  const perChannel = new Map<string, { channelId: string; channel: string; toMove: number }>();
  const fixes = new Map<string, TidyChannelFix>();

  for (const row of rows) {
    const baseDir = path.resolve(channelReadBaseDir(row.customPath, opts.downloadsDir));
    if (isDoubled(row.customPath, baseDir, sanitizeFolderName(row.channelTitle || row.channelId)) && !fixes.has(row.channelId)) {
      fixes.set(row.channelId, { channelId: row.channelId, from: row.customPath as string, to: path.dirname(baseDir) });
    }

    const result = classify(row, opts.downloadsDir, fsx);
    if (result.status === 'tidy') preview.alreadyTidy++;
    else if (result.status === 'missing') preview.missingFiles++;
    else if (result.status === 'conflict') preview.conflicts++;
    else if (result.status === 'notWritable') preview.notWritable++;
    else {
      const item = result.item;
      items.push(item);
      preview.toMove++;
      const entry = perChannel.get(item.channelId) ?? { channelId: item.channelId, channel: item.channelTitle, toMove: 0 };
      entry.toMove++;
      perChannel.set(item.channelId, entry);
      if (preview.samples.length < SAMPLE_LIMIT && item.moves[0]) {
        preview.samples.push({ id: item.id, title: item.title, from: item.moves[0].from, to: item.moves[0].to });
      }
    }
  }

  preview.duplicateFolders = fixes.size;
  preview.channels = [...perChannel.values()];
  return { preview, items, channelFixes: [...fixes.values()] };
}
