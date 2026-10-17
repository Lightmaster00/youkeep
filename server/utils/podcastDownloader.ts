import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import Parser from 'rss-parser';
import { Cron } from 'croner';
import { getDb } from './db';
import { parsePubTs } from './podcastPubDate';
import { getDataDir } from './dataDir';
import { addLog, builtinDownloadsDirs, isDirWritable } from './downloader';
import { parseMaxConcurrentDownloads, hasCapacityForMoreDownloads, hasEnoughDiskSpace, resetStaleDownloadsForTable, runSyncAllEntities, workerErrorBackoffMs } from './concurrency';
import { isShuttingDown } from './processTree';
import { isPrivateNetworkUrl, safeFetch, UnsafeUrlError } from './safeUrl';
import { MIN_FREE_DISK_SPACE_BYTES } from './concurrency';
import { isEffectivelyPaused, isModuleEnabled } from './modules';
import { entityFolderName, isContained, removeEntityFolder } from './videoPaths';
import { startProgressWriter, finishProgressWriter, stopProgressWriter } from './progressWriter';
import { isWipeInProgress } from './libraryWipe';
import { runInBackground } from './background';
import { usableStoredSchedule } from './validation';

// Define global-backed state to survive development HMR module hot reloads,
// same pattern as downloader.ts's and musicDownloader.ts's own worker state.
const _g = globalThis as any;
const G_PODCAST_PROCESSING = Symbol.for('YouKeep.isPodcastProcessing');
const G_PODCAST_SHOULD_RUN = Symbol.for('YouKeep.podcastWorkerShouldRun');
const G_PODCAST_ACTIVE_DOWNLOAD_COUNT = Symbol.for('YouKeep.activePodcastDownloadCount');
// No G_PODCAST_PROCESSES map of child processes — RSS ingestion has no yt-dlp
// child process to track. Downloads are cancelled via AbortController.abort()
// instead of child.kill(), so this tracks controllers instead.
const G_PODCAST_ABORT_CONTROLLERS = Symbol.for('YouKeep.activePodcastAbortControllers');
const G_PODCAST_DOWNLOAD_START_TIMES = Symbol.for('YouKeep.activePodcastDownloadStartTimes');
// Deliberately a SEPARATE symbol from downloader.ts's G_CRON and
// musicDownloader.ts's G_MUSIC_CRON — the video, music, and podcast cron
// jobs must be independently startable/stoppable, never sharing a handle.
const G_PODCAST_CRON = Symbol.for('YouKeep.activePodcastCronJob');
const G_PODCAST_KEEP_FILES = Symbol.for('YouKeep.podcastKeepFilesOnExit');

if (!(G_PODCAST_PROCESSING in _g)) _g[G_PODCAST_PROCESSING] = false;
if (!(G_PODCAST_SHOULD_RUN in _g)) _g[G_PODCAST_SHOULD_RUN] = false;
if (!(G_PODCAST_ACTIVE_DOWNLOAD_COUNT in _g)) _g[G_PODCAST_ACTIVE_DOWNLOAD_COUNT] = 0;
if (!(G_PODCAST_ABORT_CONTROLLERS in _g)) _g[G_PODCAST_ABORT_CONTROLLERS] = new Map<string, AbortController>();
if (!(G_PODCAST_DOWNLOAD_START_TIMES in _g)) _g[G_PODCAST_DOWNLOAD_START_TIMES] = new Map<string, number>();
if (!(G_PODCAST_CRON in _g)) _g[G_PODCAST_CRON] = null;
if (!(G_PODCAST_KEEP_FILES in _g)) _g[G_PODCAST_KEEP_FILES] = new Set<string>();
// Episodes whose download a pause aborted: their partial file survives the abort.
const podcastKeepFilesOnExit: Set<string> = _g[G_PODCAST_KEEP_FILES];

export function getActivePodcastCronJob(): Cron | null { return _g[G_PODCAST_CRON]; }
function setActivePodcastCronJob(val: Cron | null) { _g[G_PODCAST_CRON] = val; }

function getIsPodcastProcessing(): boolean { return _g[G_PODCAST_PROCESSING]; }
function setIsPodcastProcessing(val: boolean) { _g[G_PODCAST_PROCESSING] = val; }
function getPodcastWorkerShouldRun(): boolean { return _g[G_PODCAST_SHOULD_RUN]; }
function setPodcastWorkerShouldRun(val: boolean) { _g[G_PODCAST_SHOULD_RUN] = val; }
export function getActivePodcastDownloadCount(): number { return _g[G_PODCAST_ACTIVE_DOWNLOAD_COUNT]; }
function incrementActivePodcastDownloadCount() { _g[G_PODCAST_ACTIVE_DOWNLOAD_COUNT]++; }
function decrementActivePodcastDownloadCount() { _g[G_PODCAST_ACTIVE_DOWNLOAD_COUNT] = Math.max(0, _g[G_PODCAST_ACTIVE_DOWNLOAD_COUNT] - 1); }

let podcastWorkerWakeResolver: (() => void) | null = null;

function sleepOrWakeablePodcast(ms: number) {
  return new Promise<void>(resolve => {
    let timeoutId: any = null;
    const cleanResolve = () => {
      if (timeoutId) clearTimeout(timeoutId);
      podcastWorkerWakeResolver = null;
      resolve();
    };
    podcastWorkerWakeResolver = cleanResolve;
    timeoutId = setTimeout(cleanResolve, ms);
  });
}

export function wakePodcastWorker() {
  if (podcastWorkerWakeResolver) {
    podcastWorkerWakeResolver();
  }
}

// Maximum time (ms) a single episode download is allowed to run before being
// aborted. Duplicated from downloader.ts's/musicDownloader.ts's own constant
// of the same value (not exported by either) rather than importing it — this
// is a constant, not logic, so the duplication is cheap and avoids coupling
// this file to an unrelated module's internals.
const PODCAST_DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
/** Hard cap of one episode file, whatever its Content-Length says. */
export const PODCAST_EPISODE_MAX_BYTES = 4 * 1024 * 1024 * 1024;
/** Free space in the show folder is checked again after every this many bytes. */
export const PODCAST_SPACE_CHECK_BYTES = 64 * 1024 * 1024;
/** The two limits above, as used; tests lower them (no 4 GiB fixtures). */
export const podcastDownloadLimits = { maxBytes: PODCAST_EPISODE_MAX_BYTES, spaceCheckBytes: PODCAST_SPACE_CHECK_BYTES };

export const activePodcastAbortControllers: Map<string, AbortController> = _g[G_PODCAST_ABORT_CONTROLLERS];
export const activePodcastDownloadStartTimes: Map<string, number> = _g[G_PODCAST_DOWNLOAD_START_TIMES];

export function getPodcastDownloadsDir(): string {
  const defaultPath = builtinDownloadsDirs.podcasts;
  if (isDirWritable(defaultPath)) {
    return defaultPath;
  }

  const localFallback = path.join(getDataDir(), 'downloads-podcasts');
  try { fs.mkdirSync(localFallback, { recursive: true }); } catch (err) {}
  return localFallback;
}

export function cleanupPartialPodcastFiles(episodeId: string, showId: string, opts: { newerThan?: number } = {}): void {
  // Episode ids are sha256 hex digests (hashPodcastEpisodeId): nothing else names a file.
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(episodeId)) return;
  const db = getDb();
  const show = db.prepare('SELECT title FROM podcast_shows WHERE id = ?').get(showId) as { title: string } | undefined;
  const basePath = getPodcastDownloadsDir();
  const showDir = path.join(basePath, entityFolderName(show?.title, showId));

  // A name like '..', '.' or blank must never point at the base folder or above.
  if (!isContained(basePath, showDir) || !fs.existsSync(showDir)) return;

  const prefix = `${episodeId}.`;
  let entries: string[];
  try {
    entries = fs.readdirSync(showDir);
  } catch (e) {
    return;
  }

  for (const entry of entries) {
    if (!entry.startsWith(prefix)) continue;
    const fullPath = path.join(showDir, entry);
    if (!isContained(showDir, fullPath)) continue;
    if (opts.newerThan !== undefined) {
      // A file that predates this download attempt is a previously-completed
      // file, not a partial artifact of the attempt being aborted — leave it alone.
      try {
        if (fs.statSync(fullPath).mtimeMs < opts.newerThan) continue;
      } catch (e) {
        continue;
      }
    }
    try { fs.unlinkSync(fullPath); } catch (e) {}
  }
}

export function deletePodcastShow(showId: string, opts: { baseDir?: string } = {}): { success: true } | { success: false; error: string } {
  const db = getDb();

  const show = db.prepare('SELECT title FROM podcast_shows WHERE id = ?').get(showId) as { title: string } | undefined;
  if (!show) {
    return { success: false, error: 'Show not found.' };
  }

  // 1. Find all episodes for this show and kill any active downloads.
  // Only running downloads need aborting; their partial files go with the
  // show's own files below (one readdir, not one per episode).
  const episodes = db.prepare('SELECT id, local_file_path, local_thumbnail_path FROM podcast_episodes WHERE show_id = ?').all(showId) as
    { id: string; local_file_path: string | null; local_thumbnail_path: string | null }[];
  for (const e of episodes) {
    const controller = activePodcastAbortControllers.get(e.id);
    if (!controller) continue;
    stopProgressWriter('podcast_episodes', e.id);
    try { controller.abort(); } catch {}
    activePodcastAbortControllers.delete(e.id);
    activePodcastDownloadStartTimes.delete(e.id);
  }

  // 2. Delete the show row (cascades to podcast_episodes via ON DELETE CASCADE).
  const res = db.prepare('DELETE FROM podcast_shows WHERE id = ?').run(showId);
  if (res.changes === 0) {
    return { success: false, error: 'Show not found.' };
  }

  // 3. Delete the show's own files, then its folder when empty. Podcasts have no
  // custom_save_path equivalent, so this is always relative to
  // getPodcastDownloadsDir(). A removal failure here is logged but does NOT
  // make this function report failure — the DB row (the real "this content
  // is gone" signal) is already deleted at this point, matching the
  // established convention in channels/[id].delete.ts (confirmed during
  // Task 1's review: reporting failure here would misleadingly tell the
  // wipe-all report that already-deleted content needs retrying).
  // Never the base folder or above (a title like '..'), and only this show's
  // own files when another show shares the folder.
  const others = db.prepare('SELECT id, title FROM podcast_shows').all() as { id: string; title: string }[];
  removeEntityFolder({
    baseDir: opts.baseDir ?? getPodcastDownloadsDir(),
    folder: entityFolderName(show.title, showId),
    ownIds: episodes.map((e) => e.id),
    otherFolders: others.map((o) => entityFolderName(o.title, o.id)),
    label: `Show "${show.title}"`,
    storedFiles: episodes.flatMap((e) => [e.local_file_path, e.local_thumbnail_path]),
  });

  return { success: true };
}

/**
 * Parses an itunes:duration value, which RSS feeds represent inconsistently:
 * HH:MM:SS, MM:SS, or a bare integer number of seconds. Returns null for
 * anything that doesn't match one of those three shapes (missing, empty,
 * non-numeric, wrong segment count).
 */
export function parseItunesDuration(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = String(raw).trim();
  if (trimmed.length === 0) return null;

  if (/^\d+$/.test(trimmed)) {
    return parseInt(trimmed, 10);
  }

  const parts = trimmed.split(':');
  if (parts.length < 2 || parts.length > 3 || parts.some(p => !/^\d+$/.test(p))) {
    return null;
  }
  const nums = parts.map(p => parseInt(p, 10));
  if (nums.length === 3) {
    return nums[0]! * 3600 + nums[1]! * 60 + nums[2]!;
  }
  return nums[0]! * 60 + nums[1]!;
}

/**
 * Derives a stable episode primary key from the feed URL and the item's
 * GUID (or, when no GUID is present, its enclosure URL — the caller passes
 * whichever it has). Hashing the feed URL together with the raw guid means
 * two different feeds that happen to reuse the same raw guid value never
 * collide, since feedUrl is part of the hash input. sha256 hex digest is
 * always a valid SQLite TEXT primary key with no character-set concerns.
 */
export function hashPodcastEpisodeId(feedUrl: string, guidOrUrl: string): string {
  return crypto.createHash('sha256').update(`${feedUrl}::${guidOrUrl}`).digest('hex');
}

/**
 * Converts a raw (possibly HTML-bearing) RSS description into clean plain
 * text. Many real-world feeds embed inline HTML in <description> (e.g. NPR's
 * Planet Money feed uses <em>, <br>, and <a href="...">) — Vue's text
 * interpolation escapes that HTML rather than rendering it, so it must be
 * stripped to plain text at ingest time instead of rendered as HTML
 * (RSS feed content is untrusted external input; v-html on it would be an
 * XSS risk). This is presentational cleanup of our own ingested data, not a
 * security boundary against untrusted rendering — a simple regex-based tag
 * strip is fine here.
 */
export function stripHtmlToPlainText(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  if (raw.trim().length === 0) return null;

  let text = raw
    // Block-ish/line-break tags become a space so words on either side of a
    // removed tag don't glue together (e.g. "...lives<br><br><em> Support...").
    .replace(/<\s*(br|p|div|li|\/p|\/div|\/li)[^>]*>/gi, ' ')
    // Strip all remaining tags outright.
    .replace(/<[^>]+>/g, '');

  // Decode common entities feeds frequently (and sometimes doubly) encode.
  text = text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");

  // Collapse whitespace left behind by removed tags/entities.
  text = text.replace(/\s+/g, ' ').trim();

  return text.length > 0 ? text : null;
}

/**
 * Metadata ingestion for podcasts. Fetches and parses an RSS feed and
 * writes it to the podcast_shows/podcast_episodes tables. Mirrors
 * ingestMusicUrl in musicDownloader.ts, adapted for RSS: podcast_shows.id
 * is a generated id (not the feed URL itself), so show lookup/upsert is
 * always by feed_url. There is no channel/single-item split like YouTube
 * ingestion — a feed always describes exactly one show plus its episode list.
 */
/** A feed that has not answered after this long fails with a clear message. */
export const PODCAST_FEED_TIMEOUT_MS = 15_000;
/** Items kept per feed (the newest by pubDate). */
export const PODCAST_FEED_MAX_ITEMS = 5000;
/** Episodes written per transaction while ingesting a feed. */
export const PODCAST_INSERT_CHUNK = 500;

/** A feed larger than this is refused (the whole body is held in memory to parse it). */
export const PODCAST_FEED_MAX_BYTES = 10 * 1024 * 1024;

class FeedTimeoutError extends Error {}

/**
 * Fetches a feed's text: one deadline for the whole exchange (connection,
 * redirects and body), a byte cap, at most 5 redirects, http(s) only. The
 * admin types the feed address, so LAN feeds are allowed; link-local and
 * cloud metadata addresses never are.
 */
export async function fetchFeedText(feedUrl: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new FeedTimeoutError('timed out')), PODCAST_FEED_TIMEOUT_MS);
  try {
    const response = await safeFetch(feedUrl, {
      allowPrivate: true,
      signal: controller.signal,
      headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.5', 'User-Agent': 'YouKeep' },
    });
    if (!response.ok || !response.body) {
      try { await response.body?.cancel(); } catch {}
      throw new Error(`HTTP ${response.status}`);
    }
    const declared = Number(response.headers.get('content-length') || '0');
    if (declared > PODCAST_FEED_MAX_BYTES) {
      try { await response.body.cancel(); } catch {}
      throw new Error(`The feed is larger than ${PODCAST_FEED_MAX_BYTES / (1024 * 1024)} MB.`);
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > PODCAST_FEED_MAX_BYTES) {
        controller.abort();
        try { await reader.cancel(); } catch {}
        throw new Error(`The feed is larger than ${PODCAST_FEED_MAX_BYTES / (1024 * 1024)} MB.`);
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength))).toString('utf8');
  } catch (err: any) {
    if (controller.signal.aborted && controller.signal.reason instanceof FeedTimeoutError) {
      throw new FeedTimeoutError(`Request timed out after ${PODCAST_FEED_TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function ingestPodcastFeed(
  feedUrl: string,
  options: {
    sync_status?: string;
    visibility?: string;
  } = {}
): Promise<{ success: boolean; message: string; count: number }> {
  const db = getDb();
  const trimmedFeedUrl = feedUrl.trim();

  const parser = new Parser({
    customFields: {
      feed: [['itunes:author', 'itunesAuthor'], ['itunes:image', 'itunesImage']],
      item: [
        ['itunes:episode', 'itunesEpisode'],
        ['itunes:season', 'itunesSeason'],
        ['itunes:duration', 'itunesDuration']
      ]
    }
  });

  let feed: any;
  try {
    feed = await parser.parseString(await fetchFeedText(trimmedFeedUrl));
  } catch (err: any) {
    if (err instanceof UnsafeUrlError) {
      return { success: false, message: `This feed address is not allowed: ${err.message}`, count: 0 };
    }
    if (err instanceof FeedTimeoutError) {
      return { success: false, message: `The feed did not answer within ${PODCAST_FEED_TIMEOUT_MS / 1000} s. Check the address or try again later.`, count: 0 };
    }
    return { success: false, message: `Failed to fetch/parse RSS feed: ${err.message || err}`, count: 0 };
  }

  const showTitle = feed.title || 'Untitled Podcast';
  const showDescription = stripHtmlToPlainText(feed.description);
  const showAuthor = feed.itunesAuthor || feed.author || null;
  const showCoverUrl = feed.itunesImage?.href || feed.image?.url || null;
  const showLanguage = feed.language || null;

  const existingShow = db.prepare('SELECT id FROM podcast_shows WHERE feed_url = ?').get(trimmedFeedUrl) as { id: string } | undefined;
  const showId = existingShow?.id || crypto.randomUUID();
  const initialSyncStatus = options.sync_status || 'paused';
  const initialVisibility = options.visibility || 'public';

  if (existingShow) {
    // A feed that drops a field never erases what is known.
    db.prepare(`
      UPDATE podcast_shows
      SET title = ?, description = COALESCE(?, description), author = COALESCE(?, author), cover_url = COALESCE(?, cover_url), language = COALESCE(?, language),
          sync_status = COALESCE(?, sync_status), visibility = COALESCE(?, visibility), last_checked_at = ?
      WHERE id = ?
    `).run(showTitle, showDescription, showAuthor, showCoverUrl, showLanguage, options.sync_status ?? null, options.visibility ?? null, Date.now(), showId);
  } else {
    db.prepare(`
      INSERT INTO podcast_shows (id, feed_url, title, description, author, cover_url, language, sync_status, visibility, last_checked_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(showId, trimmedFeedUrl, showTitle, showDescription, showAuthor, showCoverUrl, showLanguage, initialSyncStatus, initialVisibility, Date.now(), Date.now());
  }

  const allItems: any[] = Array.isArray(feed.items) ? feed.items : [];
  // A huge (or hostile) feed: only the newest PODCAST_FEED_MAX_ITEMS items
  // (by pubDate; undated ones last, in feed order) are kept.
  const items = allItems.length <= PODCAST_FEED_MAX_ITEMS
    ? allItems
    : allItems
      .map((item, index) => ({ item, index, ts: parsePubTs(item?.pubDate) }))
      .sort((a, b) => (b.ts ?? -Infinity) - (a.ts ?? -Infinity) || a.index - b.index)
      .slice(0, PODCAST_FEED_MAX_ITEMS)
      .map((entry) => entry.item);
  if (items.length < allItems.length) {
    addLog(`Ingesting feed "${showTitle}": kept the newest ${items.length} of ${allItems.length} items.`);
  }
  const upsertEpisode = db.prepare(`
    INSERT INTO podcast_episodes (id, show_id, title, description, audio_url, duration, episode_number, season_number, pub_date, pub_ts, download_status, created_at)
    VALUES (@id, @showId, @title, @description, @audioUrl, @duration, @episodeNumber, @seasonNumber, @pubDate, @pubTs, 'pending', @createdAt)
    ON CONFLICT(id) DO UPDATE SET
      title = COALESCE(@listedTitle, title),
      description = COALESCE(excluded.description, description),
      audio_url = excluded.audio_url,
      duration = COALESCE(excluded.duration, duration),
      episode_number = COALESCE(excluded.episode_number, episode_number),
      season_number = COALESCE(excluded.season_number, season_number),
      pub_date = COALESCE(excluded.pub_date, pub_date),
      pub_ts = CASE WHEN excluded.pub_date IS NULL THEN pub_ts ELSE excluded.pub_ts END
    -- An unchanged episode is not written (no FTS trigger churn on every re-sync).
    WHERE COALESCE(@listedTitle, podcast_episodes.title) IS NOT podcast_episodes.title
      OR COALESCE(excluded.description, podcast_episodes.description) IS NOT podcast_episodes.description
      OR excluded.audio_url IS NOT podcast_episodes.audio_url
      OR COALESCE(excluded.duration, podcast_episodes.duration) IS NOT podcast_episodes.duration
      OR COALESCE(excluded.episode_number, podcast_episodes.episode_number) IS NOT podcast_episodes.episode_number
      OR COALESCE(excluded.season_number, podcast_episodes.season_number) IS NOT podcast_episodes.season_number
      OR COALESCE(excluded.pub_date, podcast_episodes.pub_date) IS NOT podcast_episodes.pub_date
      OR (excluded.pub_date IS NOT NULL AND excluded.pub_ts IS NOT podcast_episodes.pub_ts)
  `);
  const checkExists = db.prepare('SELECT 1 FROM podcast_episodes WHERE id = ?');

  let episodesAdded = 0;
  let skippedNoEnclosure = 0;
  // One transaction per PODCAST_INSERT_CHUNK items (not one commit per
  // episode), yielding to the event loop between chunks so a big feed never
  // blocks the server for long.
  const insertChunk = db.transaction((chunk: any[]) => {
  for (const item of chunk) {
    // Episodes with no enclosure URL are a normal, common feed shape (show
    // notes, trailers) — skip silently, don't insert a broken row.
    const audioUrl: string | undefined = item.enclosure?.url;
    if (!audioUrl) {
      skippedNoEnclosure++;
      continue;
    }

    const rawGuid = item.guid || audioUrl;
    const episodeId = hashPodcastEpisodeId(trimmedFeedUrl, rawGuid);
    const exists = checkExists.get(episodeId);

    const parsedEpisodeNumber = item.itunesEpisode ? parseInt(item.itunesEpisode, 10) : null;
    const parsedSeasonNumber = item.itunesSeason ? parseInt(item.itunesSeason, 10) : null;
    const episodeNumber = Number.isFinite(parsedEpisodeNumber) ? parsedEpisodeNumber : null;
    const seasonNumber = Number.isFinite(parsedSeasonNumber) ? parsedSeasonNumber : null;
    const duration = parseItunesDuration(item.itunesDuration);

    upsertEpisode.run({
      id: episodeId,
      showId,
      title: item.title || `Episode ${episodeId}`,
      description: stripHtmlToPlainText(item.contentSnippet || item.content),
      audioUrl,
      duration,
      episodeNumber,
      seasonNumber,
      pubDate: item.pubDate || null,
      pubTs: parsePubTs(item.pubDate),
      createdAt: Date.now(),
      listedTitle: typeof item.title === 'string' && item.title ? item.title : null,
    });

    if (!exists) episodesAdded++;
  }
  });
  for (let start = 0; start < items.length; start += PODCAST_INSERT_CHUNK) {
    if (start > 0) await new Promise((resolve) => setImmediate(resolve));
    insertChunk(items.slice(start, start + PODCAST_INSERT_CHUNK));
  }

  if (skippedNoEnclosure > 0) {
    addLog(`Ingesting feed "${showTitle}": skipped ${skippedNoEnclosure} item(s) without an audio enclosure.`);
  }

  const showState = db.prepare('SELECT sync_status FROM podcast_shows WHERE id = ?').get(showId) as { sync_status: string } | undefined;
  if (showState?.sync_status === 'downloading') {
    runInBackground('startPodcastQueueWorker', () => startPodcastQueueWorker());
  }

  return {
    success: true,
    message: `Podcast "${showTitle}" ingested. ${episodesAdded} new episode(s) added.`,
    count: episodesAdded
  };
}

// Maps common podcast enclosure content-types to a file extension. Falls back
// to sniffing the URL's own extension, then to 'mp3', in downloadEpisodeFile.
function extensionFromContentType(contentType: string | null): string | null {
  if (!contentType) return null;
  const type = contentType.split(';')[0]!.trim().toLowerCase();
  const map: Record<string, string> = {
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/mp4': 'm4a',
    'audio/x-m4a': 'm4a',
    'audio/aac': 'aac',
    'audio/ogg': 'ogg',
    'audio/opus': 'opus',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/flac': 'flac',
    'audio/webm': 'weba',
  };
  return map[type] || null;
}

// Extensions the podcast file route serves (server/routes/downloads-podcasts):
// a file saved under any other one (".php", ".aspx") could never be played.
export const PODCAST_AUDIO_EXTENSIONS = new Set(['mp3', 'm4a', 'm4b', 'ogg', 'oga', 'wav', 'opus', 'webm', 'weba', 'aac', 'flac', 'mp4']);

/** The audio extension of an enclosure URL, only when it is one the file route serves. */
export function extensionFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const match = parsed.pathname.match(/\.([a-zA-Z0-9]{2,5})$/);
    const ext = match ? match[1]!.toLowerCase() : null;
    return ext && PODCAST_AUDIO_EXTENSIONS.has(ext) ? ext : null;
  } catch (e) {
    return null;
  }
}

// Local duplicates of downloader.ts's private formatBytesToSpeed/
// formatSecondsToETA (neither is exported there) — same cheap-duplication
// reasoning as PODCAST_DOWNLOAD_TIMEOUT_MS above, adapted to the
// byte-count-based progress this pipeline computes (yt-dlp's stdout already
// gives a formatted speed/ETA string; a raw fetch() stream does not).
function formatBytesPerSec(bytesPerSec: number): string {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec <= 0) return '0KB/s';
  if (bytesPerSec >= 1024 * 1024 * 1024) return (bytesPerSec / (1024 * 1024 * 1024)).toFixed(1) + ' GB/s';
  if (bytesPerSec >= 1024 * 1024) return (bytesPerSec / (1024 * 1024)).toFixed(1) + ' MB/s';
  if (bytesPerSec >= 1024) return (bytesPerSec / 1024).toFixed(0) + ' KB/s';
  return bytesPerSec.toFixed(0) + ' B/s';
}

function formatEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--';
  if (seconds > 3600) {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Downloads an episode's enclosure audio file over plain HTTP, replacing
 * downloadMusicTrackFile's yt-dlp spawn (there is no yt-dlp involvement in
 * RSS ingestion at all). Progress is computed from received/total byte
 * counts (Content-Length) instead of parsed from yt-dlp stdout, and
 * cancellation/timeout goes through AbortController.abort() instead of
 * child.kill('SIGKILL'). NOTE: podcast_episodes has no size_bytes column
 * (unlike videos/music_tracks) — this deliberately does not write a file
 * size anywhere; only local_file_path is recorded on success.
 */
export function downloadEpisodeFile(episodeId: string, showId: string): Promise<void> {
  const attemptStartedAt = Date.now();
  return new Promise<void>(async (resolve, reject) => {
    const db = getDb();
    let settled = false;
    const settle = (fn: () => void) => { if (!settled) { settled = true; fn(); } };

    const controller = new AbortController();
    activePodcastAbortControllers.set(episodeId, controller);
    podcastKeepFilesOnExit.delete(episodeId); // a fresh attempt: no pause pending for it
    activePodcastDownloadStartTimes.set(episodeId, attemptStartedAt);
    // Hoisted out of the try block so the catch block below can still reach
    // it to close the fd on every error/abort/timeout path — a write stream
    // opened but never destroyed leaks a file descriptor, and
    // cleanupPartialPodcastFiles() would then be unlinking the file out from
    // under a still-open handle.
    let fileStream: fs.WriteStream | undefined;
    // Progress is persisted at most once per second (see progressWriter.ts).
    const progressWriter = startProgressWriter(db, 'podcast_episodes', episodeId);
    const endProgress = () => finishProgressWriter('podcast_episodes', episodeId, progressWriter);

    const watchdog = setTimeout(() => {
      if (!settled) {
        endProgress();
        addLog(`Podcast download [${episodeId}] timed out after ${PODCAST_DOWNLOAD_TIMEOUT_MS / 60000} minutes. Cancelling.`);
        try { controller.abort(); } catch (e) {}
        activePodcastAbortControllers.delete(episodeId);
        activePodcastDownloadStartTimes.delete(episodeId);
        cleanupPartialPodcastFiles(episodeId, showId, { newerThan: attemptStartedAt });
        settle(() => reject(new Error(`Timeout: the download exceeded ${PODCAST_DOWNLOAD_TIMEOUT_MS / 60000} minutes`)));
      }
    }, PODCAST_DOWNLOAD_TIMEOUT_MS);

    try {
      const episode = db.prepare('SELECT audio_url FROM podcast_episodes WHERE id = ?').get(episodeId) as { audio_url: string } | undefined;
      if (!episode || !episode.audio_url) {
        throw new Error("The episode has no audio_url to download.");
      }

      const show = db.prepare('SELECT title, feed_url FROM podcast_shows WHERE id = ?').get(showId) as { title: string; feed_url: string | null } | undefined;
      const folderName = entityFolderName(show?.title, showId);
      const baseDir = getPodcastDownloadsDir();
      const showDir = path.join(baseDir, folderName);
      if (!fs.existsSync(showDir)) {
        fs.mkdirSync(showDir, { recursive: true });
      }

      addLog(`Starting download of episode ${episodeId}: ${episode.audio_url}`);
      // Enclosure addresses (and their redirects) come from a third-party feed:
      // public addresses only, unless the show's own feed is on the LAN right
      // now (a self-hosted podcast server): then its LAN addresses are fine
      // too. Link-local and cloud metadata addresses are never allowed.
      const allowPrivate = !!show?.feed_url && await isPrivateNetworkUrl(show.feed_url);
      const response = await safeFetch(episode.audio_url, { allowPrivate, signal: controller.signal });
      if (!response.ok || !response.body) {
        try { await response.body?.cancel(); } catch {}
        throw new Error(`HTTP ${response.status}`);
      }

      const ext = extensionFromContentType(response.headers.get('content-type')) || extensionFromUrl(episode.audio_url) || 'mp3';
      const outputPath = path.join(showDir, `${episodeId}.${ext}`);
      const localFilePath = `/downloads-podcasts/${folderName}/${episodeId}.${ext}`;

      // With a Content-Encoding, fetch() hands over decoded bytes while
      // Content-Length is the encoded size: only the hard cap applies then.
      const encoded = !!response.headers.get('content-encoding') && response.headers.get('content-encoding')!.trim().toLowerCase() !== 'identity';
      const totalBytes = encoded ? 0 : parseInt(response.headers.get('content-length') || '0', 10);
      // Never more than announced, and never more than the hard cap.
      const byteLimit = totalBytes > 0 ? Math.min(totalBytes, podcastDownloadLimits.maxBytes) : podcastDownloadLimits.maxBytes;
      let receivedBytes = 0;
      let nextSpaceCheck = podcastDownloadLimits.spaceCheckBytes;
      fileStream = fs.createWriteStream(outputPath);

      // Passes bytes through unchanged while reporting progress. Using
      // stream.promises.pipeline (instead of a manual for-await +
      // fileStream.write loop) gives us backpressure for free — pipeline()
      // pauses the readable when the writable's internal buffer is full
      // instead of buffering the whole remainder of the episode in memory —
      // and it also attaches the error handling we need: a write-stream error
      // (ENOSPC/EACCES/EIO) rejects the pipeline promise into the catch block
      // below instead of throwing uncaught and killing the process.
      //
      // A throw inside this callback would NOT be routed into pipeline()'s
      // rejection (only callback(err) is), so nothing here may throw: the
      // progress writer throttles database writes to once per second and
      // swallows a failed write itself (progress is cosmetic).
      const reportProgress = () => {
        const elapsedSec = (Date.now() - attemptStartedAt) / 1000;
        const rate = elapsedSec > 0 ? receivedBytes / elapsedSec : 0;
        const speed = rate > 0 ? formatBytesPerSec(rate) : '0KB/s';
        if (totalBytes > 0) {
          const progress = Math.round((receivedBytes / totalBytes) * 100);
          const remainingBytes = totalBytes - receivedBytes;
          const eta = rate > 0 ? formatEta(remainingBytes / rate) : '--:--';
          progressWriter.update({ progress, speed, eta });
        } else {
          // Content-Length wasn't sent (e.g. chunked transfer encoding), so
          // there's no total to compute a percentage or ETA against. Per this
          // codebase's convention of not fabricating a fake percentage, only
          // the speed is surfaced as a liveness signal; null keeps the stored
          // download_progress/download_eta untouched.
          progressWriter.update({ progress: null, speed, eta: null });
        }
      };
      const progressTransform = new Transform({
        transform(chunk, _encoding, callback) {
          receivedBytes += chunk.length;
          if (receivedBytes > byteLimit) {
            callback(new Error(totalBytes > 0 && totalBytes <= podcastDownloadLimits.maxBytes
              ? `The server sent more than the ${totalBytes} bytes it announced.`
              : `The episode is larger than ${podcastDownloadLimits.maxBytes / (1024 * 1024 * 1024)} GiB.`));
            return;
          }
          if (receivedBytes < nextSpaceCheck) {
            reportProgress();
            callback(null, chunk);
            return;
          }
          // Every podcastDownloadLimits.spaceCheckBytes: is there still room on the disk written to?
          nextSpaceCheck += podcastDownloadLimits.spaceCheckBytes;
          fs.promises.statfs(showDir).then(
            (st) => st.bavail * st.bsize < MIN_FREE_DISK_SPACE_BYTES ? Promise.reject(new Error('Not enough free disk space to continue the download.')) : undefined,
            () => undefined, // cannot check: carry on
          ).then(
            () => { reportProgress(); callback(null, chunk); },
            (err) => callback(err),
          );
        },
      });

      await pipeline(Readable.fromWeb(response.body as any), progressTransform, fileStream);

      clearTimeout(watchdog);
      endProgress();
      activePodcastAbortControllers.delete(episodeId);
      activePodcastDownloadStartTimes.delete(episodeId);

      try {
        db.prepare(`
          UPDATE podcast_episodes
          SET local_file_path = ?${totalBytes > 0 ? ', download_progress = 100' : ''}
          WHERE id = ?
        `).run(localFilePath, episodeId);
        settle(() => resolve());
      } catch (dbErr: any) {
        // The file downloaded successfully, but the DB write that records it
        // failed. Treat this identically to an ordinary download failure —
        // same rejection, no file cleanup here (the download itself was
        // fine) — so the promise always settles instead of hanging forever.
        settle(() => reject(dbErr));
      }
    } catch (err: any) {
      clearTimeout(watchdog);
      endProgress();
      activePodcastAbortControllers.delete(episodeId);
      activePodcastDownloadStartTimes.delete(episodeId);
      // Release the fd before cleanup unlinks the partial file — otherwise
      // this path (network failure, watchdog abort, future external cancel)
      // leaves the write stream's file descriptor open indefinitely.
      fileStream?.destroy();
      if (!settled) {
        addLog(`Download failed for episode ${episodeId}: ${err.message || err}`);
        // A pause (or a shutdown) keeps the partial file.
        if (!podcastKeepFilesOnExit.delete(episodeId) && !isShuttingDown()) cleanupPartialPodcastFiles(episodeId, showId, { newerThan: attemptStartedAt });
      }
      settle(() => reject(err));
    }
  });
}

/**
 * Background loop that processes the podcast download queue. Persistent:
 * polls every few seconds instead of exiting when empty. Mirrors
 * startMusicQueueWorker exactly, with its own independent per-pipeline
 * concurrency cap (podcast_max_concurrent_downloads); no pipeline shares a cap with another.
 */
export async function startPodcastQueueWorker() {
  if (getIsPodcastProcessing()) {
    addLog('Podcast worker already running. Waking the worker...');
    wakePodcastWorker();
    return;
  }
  setIsPodcastProcessing(true);
  setPodcastWorkerShouldRun(true);
  addLog('Starting the podcast worker (persistent mode)...');

  try {
    const db = getDb();
    let consecutiveSystemErrors = 0;

    while (getPodcastWorkerShouldRun()) {
      try {
        if (isEffectivelyPaused(db, 'podcast_downloader_paused', 'podcasts')) {
          await sleepOrWakeablePodcast(5000);
          continue;
        }

        // A library wipe is deleting shows/episodes right now — don't start
        // any new download while that's happening.
        if (isWipeInProgress()) {
          await sleepOrWakeablePodcast(5000);
          continue;
        }

        // Check disk space first — it's the only await in this sequence, so
        // running it before the capacity check below ensures nothing yields
        // the event loop between that check passing and the counter increment.
        if (!(await hasEnoughDiskSpace(getPodcastDownloadsDir()))) {
          await sleepOrWakeablePodcast(5000);
          continue;
        }

        const concurrencySetting = db.prepare("SELECT value FROM settings WHERE key = 'podcast_max_concurrent_downloads'").get() as { value: string } | undefined;
        const maxConcurrent = parseMaxConcurrentDownloads(concurrencySetting?.value);
        if (!hasCapacityForMoreDownloads(getActivePodcastDownloadCount(), maxConcurrent)) {
          await sleepOrWakeablePodcast(1000);
          continue;
        }

        const episode = db.prepare(`
          SELECT e.id, e.title, e.show_id
          FROM podcast_episodes e
          JOIN podcast_shows s ON e.show_id = s.id
          WHERE e.download_status = 'pending' AND s.sync_status = 'downloading'
            AND e.id NOT IN (SELECT value FROM json_each(?))
          ORDER BY
            CASE WHEN e.download_progress > 0 THEN 0 ELSE 1 END,
            COALESCE(e.retry_count, 0) ASC,
            e.created_at ASC
          LIMIT 1
        `).get(JSON.stringify([...activePodcastAbortControllers.keys()])) as { id: string; title: string; show_id: string } | undefined;

        consecutiveSystemErrors = 0;
        if (!episode) {
          await sleepOrWakeablePodcast(3000);
          continue;
        }

        consecutiveSystemErrors = 0;
        addLog(`Starting episode download: "${episode.title}" (ID: ${episode.id})`);

        db.prepare(`
          UPDATE podcast_episodes
          SET download_status = 'downloading',
              download_progress = COALESCE(download_progress, 0),
              download_speed = '0KB/s',
              download_eta = '--:--',
              last_error = null
          WHERE id = ?
        `).run(episode.id);

        incrementActivePodcastDownloadCount();
        runInBackground('runSinglePodcastDownload', () => runSinglePodcastDownload(episode.id, episode.title, episode.show_id));
      } catch (loopErr: any) {
        consecutiveSystemErrors++;
        // Never stops for good: waits longer after each error in a row (at most 60 s).
        const delay = workerErrorBackoffMs(consecutiveSystemErrors);
        addLog(`System error in the podcast worker loop (${consecutiveSystemErrors} in a row, retrying in ${delay / 1000} s): ${loopErr.message || loopErr}`);
        await sleepOrWakeablePodcast(delay);
      }
    }
  } catch (err: any) {
    addLog(`Fatal podcast worker error: ${err.message || err}`);
  } finally {
    setIsPodcastProcessing(false);
    setPodcastWorkerShouldRun(false);
    addLog('Podcast worker stopped.');
  }
}

/**
 * Runs a single episode download to completion and updates its DB status
 * accordingly. Not awaited by the orchestrator loop above — mirrors
 * runSingleMusicDownload, minus the clip-fallback branch (podcasts have no
 * clip concept).
 */
async function runSinglePodcastDownload(episodeId: string, episodeTitle: string, showId: string): Promise<void> {
  const db = getDb();
  const MAX_RETRY_COUNT = 3;
  try {
    await downloadEpisodeFile(episodeId, showId);

    db.prepare(`
      UPDATE podcast_episodes
      SET download_status = 'completed', download_progress = 100, download_speed = null, download_eta = null, last_error = null, retry_count = 0
      WHERE id = ?
    `).run(episodeId);
    addLog(`Download SUCCEEDED: "${episodeTitle}"`);
  } catch (err: any) {
    const errMsg = err.message || String(err);
    // Aborted by a server shutdown: left as is, reset to pending at the next start.
    if (isShuttingDown()) return;
    addLog(`Download FAILED for episode "${episodeTitle}" (${episodeId}): ${errMsg}`);

    const currentEpisode = db.prepare('SELECT download_status, retry_count FROM podcast_episodes WHERE id = ?').get(episodeId) as { download_status: string; retry_count: number | null } | undefined;
    const pausedSetting = db.prepare("SELECT value FROM settings WHERE key = 'podcast_downloader_paused'").get() as { value: string } | undefined;
    const isPausedGlobal = pausedSetting?.value === '1';

    if (isPausedGlobal || currentEpisode?.download_status === 'pending') {
      addLog(`Download of episode "${episodeTitle}" (${episodeId}) was interrupted or intentionally paused.`);
      // Deliberate interruption, not a genuine failure — retry_count is untouched.
      db.prepare(`
        UPDATE podcast_episodes
        SET download_status = 'pending', download_speed = null, download_eta = null
        WHERE id = ?
      `).run(episodeId);
    } else {
      const nextRetryCount = (currentEpisode?.retry_count ?? 0) + 1;
      if (nextRetryCount >= MAX_RETRY_COUNT) {
        db.prepare(`
          UPDATE podcast_episodes
          SET download_status = 'failed', download_progress = 0, download_speed = null, download_eta = null, last_error = ?, retry_count = ?
          WHERE id = ?
        `).run(errMsg, nextRetryCount, episodeId);
        addLog(`Episode "${episodeTitle}" (${episodeId}) permanently marked as failed after ${nextRetryCount} attempts.`);
      } else {
        db.prepare(`
          UPDATE podcast_episodes
          SET download_status = 'pending', download_progress = 0, download_speed = null, download_eta = null, last_error = ?, retry_count = ?
          WHERE id = ?
        `).run(errMsg, nextRetryCount, episodeId);
      }
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  } finally {
    decrementActivePodcastDownloadCount();
    wakePodcastWorker();
  }
}

/**
 * Aborts an active podcast episode download and deletes temporary files.
 * Mirrors cancelMusicDownload, substituting AbortController.abort() for
 * child.kill('SIGKILL').
 */
export function cancelPodcastDownload(episodeId: string, targetStatus: 'failed' | 'pending' = 'pending', keepProgressAndFiles = false): boolean {
  const controller = activePodcastAbortControllers.get(episodeId);
  const startedAt = activePodcastDownloadStartTimes.get(episodeId);
  const db = getDb();
  // A pause keeps the latest progress: write what the throttle still holds first.
  stopProgressWriter('podcast_episodes', episodeId);

  if (controller) {
    if (keepProgressAndFiles) podcastKeepFilesOnExit.add(episodeId);
    else podcastKeepFilesOnExit.delete(episodeId);
    try {
      controller.abort();
    } catch (e) {}
    activePodcastAbortControllers.delete(episodeId);
    activePodcastDownloadStartTimes.delete(episodeId);
  }

  if (keepProgressAndFiles) {
    db.prepare(`
      UPDATE podcast_episodes
      SET download_status = ?, download_speed = null, download_eta = null
      WHERE id = ?
    `).run(targetStatus, episodeId);
  } else {
    db.prepare(`
      UPDATE podcast_episodes
      SET download_status = ?, download_progress = 0, download_speed = null, download_eta = null
      WHERE id = ?
    `).run(targetStatus, episodeId);
  }

  if (!keepProgressAndFiles) {
    const episode = db.prepare('SELECT show_id FROM podcast_episodes WHERE id = ?').get(episodeId) as { show_id: string } | undefined;
    if (episode) {
      cleanupPartialPodcastFiles(episodeId, episode.show_id, startedAt !== undefined ? { newerThan: startedAt } : {});
    }
  }

  return true;
}

/**
 * Resets any stale podcast downloads stuck in 'downloading' status back to
 * 'pending'. Mirrors resetStaleMusicDownloads/resetStaleDownloads.
 */
export function resetStalePodcastDownloads() {
  resetStaleDownloadsForTable(getDb(), 'podcast_episodes', 'interrupted podcast downloads', 'podcast downloads', addLog);
}

/**
 * Re-fetches every followed podcast show's RSS feed to discover new
 * episodes, then starts the download queue for anything newly pending.
 * Mirrors syncAllMusicArtists/syncAllChannels.
 */
/**
 * Shows a sync-all re-checks: only the followed ones. A show an admin paused
 * is left paused: sync-all never resumes it.
 */
export function listPodcastShowsToSync(db: any): { id: string; title: string; feed_url: string }[] {
  return db.prepare("SELECT id, title, feed_url FROM podcast_shows WHERE sync_status = 'downloading'").all() as { id: string; title: string; feed_url: string }[];
}

export async function syncAllPodcastShows(): Promise<void> {
  const db = getDb();

  await runSyncAllEntities<{ id: string; title: string; feed_url: string }>({
    db,
    activeFlagSettingKey: 'podcast_sync_all_active',
    pausedSettingKey: 'podcast_downloader_paused',
    moduleId: 'podcasts',
    fetchEntities: () => listPodcastShowsToSync(db),
    processEntity: async (show) => {
      // Paused by an admin since the list was read: leave it paused.
      const current = db.prepare('SELECT sync_status FROM podcast_shows WHERE id = ?').get(show.id) as { sync_status: string | null } | undefined;
      if (current?.sync_status !== 'downloading') return;
      addLog(`Resyncing podcast: ${show.title} (${show.id})`);

      try {
        const result = await ingestPodcastFeed(show.feed_url);
        if (!result.success) {
          addLog(`Failed to resync podcast ${show.title} (${show.id}) : ${result.message}`);
        }
      } catch (err: any) {
        addLog(`Error while resyncing podcast ${show.title} (${show.id}) : ${err.message || err}`);
      }
    },
    onStart: (count) => addLog(`Starting automatic resync of ${count} podcast(s)...`),
    onPaused: () => addLog('Automatic podcast resync interrupted: downloads are paused.'),
    onComplete: () => addLog('Automatic podcast resync finished.'),
    onFatalError: (err) => console.error('Fatal error during syncAllPodcastShows:', err),
    // No afterLoop — podcasts have no metadata-refresh post-loop hook equivalent.
    startWorker: startPodcastQueueWorker,
  });
}

/** Stops the podcast sync cron job (shutdown). */
export function stopPodcastScheduler(): void {
  getActivePodcastCronJob()?.stop();
  setActivePodcastCronJob(null);
}

/** Tells the podcast worker to stop and wakes it, so it exits now (shutdown). */
export function stopPodcastWorkerNow(): void {
  setPodcastWorkerShouldRun(false);
  wakePodcastWorker();
}

/** Aborts every running episode download (shutdown); their partial files stay. */
export function abortAllPodcastDownloads(): number {
  let count = 0;
  for (const [id, controller] of [...activePodcastAbortControllers]) {
    try { controller.abort(); } catch {}
    activePodcastAbortControllers.delete(id);
    activePodcastDownloadStartTimes.delete(id);
    count++;
  }
  return count;
}

/**
 * Registers (or re-registers, on settings change) the podcast resync cron
 * job. Mirrors initMusicScheduler/initScheduler, using a separate settings
 * namespace and active-job handle so it never interacts with the video or
 * music cron.
 */
export function initPodcastScheduler(): void {
  const db = getDb();

  const enabledSetting = db.prepare("SELECT value FROM settings WHERE key = 'podcast_sync_cron_enabled'").get() as { value: string } | undefined;
  const scheduleSetting = db.prepare("SELECT value FROM settings WHERE key = 'podcast_sync_cron_schedule'").get() as { value: string } | undefined;

  const enabled = enabledSetting ? enabledSetting.value === '1' : false;
  const cronExpression = scheduleSetting?.value || '0 4 * * *';

  if (getActivePodcastCronJob()) {
    getActivePodcastCronJob()!.stop();
    setActivePodcastCronJob(null);
  }

  const usable = enabled ? usableStoredSchedule(db, 'podcast_sync_cron_enabled', cronExpression, 'podcast') : null;
  if (usable) {
    console.log(`Scheduling podcast auto-sync cron job with expression: "${cronExpression}"`);
    try {
      const job = new Cron(usable, { protect: true, catch: (err: unknown) => console.error('Automated podcast sync failed:', err) }, async () => {
        if (!isModuleEnabled(db, 'podcasts')) {
          console.log('Automated podcast cron: Podcasts module is disabled. Skipping.');
          return;
        }
        console.log('Automated podcast cron trigger: starting show synchronization...');
        const syncSetting = db.prepare("SELECT value FROM settings WHERE key = 'podcast_sync_all_active'").get() as { value: string } | undefined;
        if (syncSetting?.value === '1') {
          console.log('Automated podcast cron: sync all is already active. Skipping.');
          return;
        }
        await syncAllPodcastShows();
      });
      setActivePodcastCronJob(job);
    } catch (err) {
      console.error(`Failed to register podcast cron expression "${cronExpression}":`, err);
    }
  } else {
    console.log('Automated podcast sync cron job is disabled.');
  }
}
