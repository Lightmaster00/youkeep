import fs from 'fs';
import path from 'path';
import type Database from 'better-sqlite3';
import { buildVideoPaths, channelReadBaseDir, isNewLayoutUrl, storedUrlSegments } from './videoPaths';
import { activeProcesses, addLog, sanitizeFolderName } from './downloader';
import { isWipeInProgress } from './libraryWipe';

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

/**
 * Per-plan memo over the injected fs: the plan never changes the disk, so each
 * folder is listed, each path probed and each folder's writability checked once.
 * A channel folder with thousands of legacy videos is read once, not once per video.
 */
class PlanFsCache implements PlannerFs {
  private readonly lists = new Map<string, string[] | Error>();
  private readonly exists = new Map<string, boolean>();
  private readonly stats = new Map<string, { size: number; isDirectory(): boolean } | Error>();
  private readonly access = new Map<string, Error | null>();
  private readonly writable = new Map<string, boolean>();
  private readonly subtitleIndexes = new Map<string, Map<string, string[]>>();

  constructor(private readonly inner: PlannerFs) {}

  existsSync(p: string): boolean {
    let hit = this.exists.get(p);
    if (hit === undefined) {
      hit = this.inner.existsSync(p);
      this.exists.set(p, hit);
    }
    return hit;
  }

  statSync(p: string): { size: number; isDirectory(): boolean } {
    let hit = this.stats.get(p);
    if (hit === undefined) {
      try {
        hit = this.inner.statSync(p);
      } catch (err) {
        hit = err instanceof Error ? err : new Error(String(err));
      }
      this.stats.set(p, hit);
    }
    if (hit instanceof Error) throw hit;
    return hit;
  }

  /** Sorted, so every plan is deterministic. Callers must not mutate the result. */
  readdirSync(p: string): string[] {
    let hit = this.lists.get(p);
    if (hit === undefined) {
      try {
        hit = [...this.inner.readdirSync(p)].sort();
      } catch (err) {
        hit = err instanceof Error ? err : new Error(String(err));
      }
      this.lists.set(p, hit);
    }
    if (hit instanceof Error) throw hit;
    return hit;
  }

  accessSync(p: string, mode?: number): void {
    const key = `${mode ?? ''}:${p}`;
    let hit = this.access.get(key);
    if (hit === undefined) {
      try {
        this.inner.accessSync(p, mode);
        hit = null;
      } catch (err) {
        hit = err instanceof Error ? err : new Error(String(err));
      }
      this.access.set(key, hit);
    }
    if (hit) throw hit;
  }

  isWritable(dir: string): boolean {
    let hit = this.writable.get(dir);
    if (hit === undefined) {
      hit = isWritable(this, dir);
      this.writable.set(dir, hit);
    }
    return hit;
  }

  /**
   * Subtitle files of a legacy channel folder for one video id, from an index
   * built from a single listing. `<id>.vtt` and `<id>.<anything>.vtt` belong to
   * `<id>`: every prefix of a `.vtt` entry ending just before a dot is a
   * candidate id, which keeps look-alikes apart (`v10.fr.vtt` is never `v1`'s).
   */
  subtitlesFor(dir: string, id: string): string[] {
    let index = this.subtitleIndexes.get(dir);
    if (!index) {
      index = new Map();
      const entries = this.existsSync(dir) ? this.readdirSync(dir) : [];
      for (const entry of entries) {
        if (!entry.endsWith('.vtt')) continue;
        const lastDot = entry.length - '.vtt'.length;
        for (let i = entry.indexOf('.'); i > 0 && i <= lastDot; i = entry.indexOf('.', i + 1)) {
          const key = entry.slice(0, i);
          const list = index.get(key) ?? [];
          list.push(entry);
          index.set(key, list);
        }
      }
      this.subtitleIndexes.set(dir, index);
    }
    return index.get(id) ?? [];
  }
}

// A channel folder name that is empty or a dot segment would point at (or above)
// the base folder: such a video is reported as a conflict, never moved.
function isUnsafeFolderSegment(name: string): boolean {
  return !name || name === '.' || name === '..' || /[\\/\u0000-\u001f\u007f]/.test(name);
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

function isDoubled(customPath: string | null, baseDir: string, channelFolder: string): boolean {
  return !!(customPath && customPath.trim()) && path.basename(baseDir) === channelFolder;
}

function classify(row: TidyRow, downloadsDir: string, fsx: PlanFsCache): Classified {
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
    if (!fsx.isWritable(nestedDir) || !fsx.isWritable(finalDir)) return { status: 'notWritable' };
    // The video file first (it is what the preview samples show), then the rest by name.
    const moves = fsx.readdirSync(nestedDir)
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
  if (isUnsafeFolderSegment(channelFolder)) return { status: 'conflict' };
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
  for (const entry of fsx.subtitlesFor(srcDir, row.id)) addMove(entry);
  if (clash || targetHasForeignContent(fsx, target.dir, target.baseName)) return { status: 'conflict' };
  if (!fsx.isWritable(srcDir) || !fsx.isWritable(target.dir)) return { status: 'notWritable' };

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
  const fsx = new PlanFsCache(opts.fs ?? nodePlannerFs);
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

// ---------------------------------------------------------------------------
// Runner: moves the planned files, verifies them, then updates the database.
// ---------------------------------------------------------------------------

export type TidyState = 'idle' | 'running' | 'done' | 'failed' | 'cancelled';

export interface TidyStatus {
  state: TidyState;
  processed: number;
  total: number;
  moved: number;
  skipped: number;
  errors: number;
  lastError: string | null;
  errorDetails: { id: string; title: string; message: string }[];
  channelsFixed: number;
}

export interface RunnerFs {
  rename(from: string, to: string): Promise<void>;
  copyFile(from: string, to: string): Promise<void>;
  unlink(p: string): Promise<void>;
  stat(p: string): Promise<{ size: number; isDirectory(): boolean }>;
  mkdir(p: string, opts: { recursive: true }): Promise<unknown>;
  rmdir(p: string): Promise<void>;
  /** Flushes a copied file to disk. Defaults to an fsync through Node. */
  fsyncFile?(p: string): Promise<void>;
  /** Byte-for-byte comparison of two files. Defaults to a streaming compare through Node. */
  sameContent?(a: string, b: string): Promise<boolean>;
}

export interface TidyRunDeps {
  db: Database.Database;
  downloadsDir: string;
  plannerFs?: PlannerFs;
  fsp?: RunnerFs;
  batchSize?: number;
  batchPauseMs?: number;
  isVideoBusy?: (id: string) => boolean;
}

const ERROR_DETAILS_LIMIT = 50;
/** Suffix of the temporary copy made during a cross-device move (never left at the final name). */
const PARTIAL_SUFFIX = '.tidy-part';
const COMPARE_CHUNK = 1024 * 1024;

// globalThis-backed, like libraryWipe.ts, so the state survives Nitro dev reloads.
const G_TIDY_STATUS = Symbol.for('YouKeep.videoTidyStatus');
const G_TIDY_CANCEL = Symbol.for('YouKeep.videoTidyCancel');
const _g = globalThis as any;

function idleStatus(): TidyStatus {
  return { state: 'idle', processed: 0, total: 0, moved: 0, skipped: 0, errors: 0, lastError: null, errorDetails: [], channelsFixed: 0 };
}
if (!_g[G_TIDY_STATUS]) _g[G_TIDY_STATUS] = idleStatus();
if (_g[G_TIDY_CANCEL] === undefined) _g[G_TIDY_CANCEL] = false;

export function getTidyStatus(): TidyStatus {
  const status = _g[G_TIDY_STATUS] as TidyStatus;
  return { ...status, errorDetails: [...status.errorDetails] };
}

export function isTidyRunning(): boolean {
  return (_g[G_TIDY_STATUS] as TidyStatus).state === 'running';
}

/** Asks the running tidy to stop after the current video. */
export function cancelTidyRun(): boolean {
  if (!isTidyRunning()) return false;
  _g[G_TIDY_CANCEL] = true;
  return true;
}

async function nodeFsyncFile(p: string): Promise<void> {
  const handle = await fs.promises.open(p, 'r+');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function nodeSameContent(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([fs.promises.open(a, 'r'), fs.promises.open(b, 'r')]);
  try {
    const ba = Buffer.alloc(COMPARE_CHUNK);
    const bb = Buffer.alloc(COMPARE_CHUNK);
    for (;;) {
      const [ra, rb] = await Promise.all([ha.read(ba, 0, COMPARE_CHUNK, null), hb.read(bb, 0, COMPARE_CHUNK, null)]);
      if (ra.bytesRead !== rb.bytesRead) return false;
      if (ra.bytesRead === 0) return true;
      if (!ba.subarray(0, ra.bytesRead).equals(bb.subarray(0, rb.bytesRead))) return false;
    }
  } finally {
    await Promise.all([ha.close(), hb.close()]);
  }
}

const nodeRunnerFs: RunnerFs = {
  rename: (from, to) => fs.promises.rename(from, to),
  copyFile: (from, to) => fs.promises.copyFile(from, to),
  unlink: (p) => fs.promises.unlink(p),
  stat: (p) => fs.promises.stat(p),
  mkdir: (p, opts) => fs.promises.mkdir(p, opts),
  rmdir: (p) => fs.promises.rmdir(p),
  fsyncFile: nodeFsyncFile,
  sameContent: nodeSameContent,
};

async function statOrNull(fsp: RunnerFs, p: string): Promise<{ size: number; isDirectory(): boolean } | null> {
  try {
    return await fsp.stat(p);
  } catch {
    return null;
  }
}

function conflictError(to: string): Error {
  return new Error(`A different file already exists at ${to}; both files were left in place.`);
}

/**
 * Moves one file without ever deleting the source before an identical copy is
 * verified at the destination, and without ever overwriting a different file.
 * - Source gone, destination present: already moved by an earlier, interrupted run.
 * - Destination present: same size AND same bytes -> earlier complete copy, the
 *   source is removed; anything else is a conflict and both files are kept.
 * - Same filesystem: rename. Across devices (EXDEV): copy to `<to>.tidy-part`,
 *   flush, check the size, rename into place, check again, then remove the source.
 */
export async function moveFileVerified(fsp: RunnerFs, from: string, to: string): Promise<void> {
  const source = await statOrNull(fsp, from);
  const existing = await statOrNull(fsp, to);
  if (!source) {
    if (existing) return;
    throw new Error(`Source file is missing: ${from}`);
  }
  if (existing) {
    const same = existing.size === source.size && !existing.isDirectory()
      && await (fsp.sameContent ?? nodeSameContent)(from, to).catch(() => false);
    if (!same) throw conflictError(to);
    await fsp.unlink(from);
    return;
  }
  try {
    await fsp.rename(from, to);
    return;
  } catch (err: any) {
    if (err?.code !== 'EXDEV') throw err;
  }

  const partial = `${to}${PARTIAL_SUFFIX}`;
  // A leftover partial copy is our own (the source is intact): start again.
  if (await statOrNull(fsp, partial)) await fsp.unlink(partial);
  try {
    await fsp.copyFile(from, partial);
    await (fsp.fsyncFile ?? nodeFsyncFile)(partial);
    const copied = await statOrNull(fsp, partial);
    if (!copied || copied.size !== source.size) throw new Error(`The copy of ${from} could not be verified.`);
    if (await statOrNull(fsp, to)) throw conflictError(to);
    await fsp.rename(partial, to);
  } catch (err) {
    try { await fsp.unlink(partial); } catch {}
    throw err;
  }
  const placed = await statOrNull(fsp, to);
  if (!placed || placed.size !== source.size) throw new Error(`The copy of ${from} could not be verified.`);
  await fsp.unlink(from);
}

type ItemOutcome = { result: 'moved' | 'skipped' } | { result: 'error'; message: string };

async function tidyOne(db: Database.Database, item: TidyPlanItem, fsp: RunnerFs, isBusy: (id: string) => boolean): Promise<ItemOutcome> {
  const row = db.prepare('SELECT download_status AS status, local_video_path AS url FROM videos WHERE id = ?').get(item.id) as
    { status: string; url: string | null } | undefined;
  if (!row || row.status !== 'completed' || row.url !== item.oldVideoUrl || isBusy(item.id)) return { result: 'skipped' };

  const createdDir = !(await statOrNull(fsp, item.toDir));
  const done: TidyMove[] = [];
  try {
    if (createdDir) await fsp.mkdir(item.toDir, { recursive: true });
    for (const move of item.moves) {
      await moveFileVerified(fsp, move.from, move.to);
      done.push(move);
    }
    for (const move of item.moves) {
      const stat = await statOrNull(fsp, move.to);
      if (!stat || (move.size !== null && stat.size !== move.size)) throw new Error(`Moved file could not be verified: ${move.to}`);
    }
    db.transaction(() => {
      const result = db.prepare('UPDATE videos SET local_video_path = ?, local_thumbnail_path = ? WHERE id = ? AND local_video_path = ?')
        .run(item.newVideoUrl, item.newThumbUrl, item.id, item.oldVideoUrl);
      if (result.changes !== 1) throw new Error('The video changed while its files were being moved.');
    })();
  } catch (err: any) {
    const notRestored: string[] = [];
    for (const move of [...done].reverse()) {
      try {
        await moveFileVerified(fsp, move.to, move.from);
      } catch {
        notRestored.push(`${move.to} -> ${move.from}`);
      }
    }
    if (createdDir) {
      try { await fsp.rmdir(item.toDir); } catch {} // only succeeds on an empty folder
    }
    const message = err?.message || String(err);
    return { result: 'error', message: notRestored.length ? `${message} Could not move back: ${notRestored.join('; ')}` : message };
  }

  for (const dir of item.cleanupDirs) {
    try { await fsp.rmdir(dir); } catch {} // only succeeds on an empty folder
  }
  return { result: 'moved' };
}

/** Corrects a doubled custom save path once every video of the channel sits at its final place. */
function applyChannelFix(db: Database.Database, fix: TidyChannelFix, fsx: PlannerFs): boolean {
  const channel = db.prepare('SELECT custom_save_path FROM channels WHERE id = ?').get(fix.channelId) as { custom_save_path: string | null } | undefined;
  if (!channel || channel.custom_save_path !== fix.from) return false;
  const base = path.resolve(fix.from);
  const channelFolder = path.basename(base);
  const rows = db.prepare('SELECT id, download_status AS status, local_video_path AS url FROM videos WHERE channel_id = ?').all(fix.channelId) as
    { id: string; status: string; url: string | null }[];
  const ready = rows.every((r) => {
    if (r.status === 'downloading') return false;
    if (!r.url) return true;
    if (!isNewLayoutUrl(r.url, r.id)) return false;
    const [channelSegment, videoFolder, fileName] = storedUrlSegments(r.url)!;
    return channelSegment === channelFolder && fsx.existsSync(path.join(base, videoFolder, fileName));
  });
  if (!ready) return false;
  return db.prepare('UPDATE channels SET custom_save_path = ? WHERE id = ? AND custom_save_path = ?').run(fix.to, fix.channelId, fix.from).changes === 1;
}

/** Runs one tidy pass. Callers wanting a background run use startTidyRun (one at a time). */
export async function runTidy(deps: TidyRunDeps): Promise<TidyStatus> {
  const status: TidyStatus = { ...idleStatus(), state: 'running' };
  _g[G_TIDY_STATUS] = status;
  _g[G_TIDY_CANCEL] = false;
  const plannerFs = deps.plannerFs ?? nodePlannerFs;
  const fsp = deps.fsp ?? nodeRunnerFs;
  const isBusy = deps.isVideoBusy ?? ((id: string) => activeProcesses.has(id));
  const batchSize = Math.max(1, deps.batchSize ?? 25);
  const batchPauseMs = deps.batchPauseMs ?? 50;

  try {
    // Always plan fresh: never trust an older preview.
    const plan = planTidy(deps.db, { downloadsDir: deps.downloadsDir, fs: plannerFs });
    status.total = plan.items.length;
    for (let i = 0; i < plan.items.length; i++) {
      if (_g[G_TIDY_CANCEL]) {
        status.state = 'cancelled';
        break;
      }
      const item = plan.items[i]!;
      const outcome = await tidyOne(deps.db, item, fsp, isBusy);
      status.processed++;
      if (outcome.result === 'moved') status.moved++;
      else if (outcome.result === 'skipped') status.skipped++;
      else {
        status.errors++;
        status.lastError = outcome.message;
        if (status.errorDetails.length < ERROR_DETAILS_LIMIT) status.errorDetails.push({ id: item.id, title: item.title, message: outcome.message });
        addLog(`Tidy library files: "${item.title}" (${item.id}) was left in place: ${outcome.message}`);
      }
      // Moves are async, but planning/DB work is sync: yield every item, pause every batch.
      await new Promise((resolve) => ((i + 1) % batchSize === 0 ? setTimeout(resolve, batchPauseMs) : setImmediate(resolve)));
    }
    if (status.state === 'running') {
      for (const fix of plan.channelFixes) {
        if (applyChannelFix(deps.db, fix, plannerFs)) status.channelsFixed++;
      }
      status.state = 'done';
    }
  } catch (err: any) {
    status.state = 'failed';
    status.lastError = err?.message || String(err);
  } finally {
    _g[G_TIDY_CANCEL] = false;
  }
  return getTidyStatus();
}

/** Starts a background run (one at a time, never during a library wipe). */
export function startTidyRun(deps: TidyRunDeps): { started: true } | { started: false; error: string } {
  if (isTidyRunning()) return { started: false, error: 'Tidying is already running.' };
  if (isWipeInProgress()) return { started: false, error: 'A library wipe is in progress. Try again when it has finished.' };
  _g[G_TIDY_STATUS] = { ...idleStatus(), state: 'running' };
  runTidy(deps).catch((err) => {
    _g[G_TIDY_STATUS] = { ...(_g[G_TIDY_STATUS] as TidyStatus), state: 'failed', lastError: err?.message || String(err) };
  });
  return { started: true };
}
