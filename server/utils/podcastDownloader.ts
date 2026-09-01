import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import Parser from 'rss-parser';
import { Cron } from 'croner';
import { getDb } from './db';
import { addLog, sanitizeFolderName, isDirWritable } from './downloader';
import { parseMaxConcurrentDownloads, hasCapacityForMoreDownloads, hasEnoughDiskSpace, resetStaleDownloadsForTable, runSyncAllEntities } from './concurrency';

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

if (!(G_PODCAST_PROCESSING in _g)) _g[G_PODCAST_PROCESSING] = false;
if (!(G_PODCAST_SHOULD_RUN in _g)) _g[G_PODCAST_SHOULD_RUN] = false;
if (!(G_PODCAST_ACTIVE_DOWNLOAD_COUNT in _g)) _g[G_PODCAST_ACTIVE_DOWNLOAD_COUNT] = 0;
if (!(G_PODCAST_ABORT_CONTROLLERS in _g)) _g[G_PODCAST_ABORT_CONTROLLERS] = new Map<string, AbortController>();
if (!(G_PODCAST_DOWNLOAD_START_TIMES in _g)) _g[G_PODCAST_DOWNLOAD_START_TIMES] = new Map<string, number>();
if (!(G_PODCAST_CRON in _g)) _g[G_PODCAST_CRON] = null;

function getActivePodcastCronJob(): Cron | null { return _g[G_PODCAST_CRON]; }
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

export const activePodcastAbortControllers: Map<string, AbortController> = _g[G_PODCAST_ABORT_CONTROLLERS];
export const activePodcastDownloadStartTimes: Map<string, number> = _g[G_PODCAST_DOWNLOAD_START_TIMES];

export function getPodcastDownloadsDir(): string {
  const defaultPath = '/downloads/podcasts';
  if (isDirWritable(defaultPath)) {
    return defaultPath;
  }

  const localFallback = path.resolve(process.cwd(), 'data/downloads-podcasts');
  try { fs.mkdirSync(localFallback, { recursive: true }); } catch (err) {}
  return localFallback;
}

export function cleanupPartialPodcastFiles(episodeId: string, showId: string, opts: { newerThan?: number } = {}): void {
  const db = getDb();
  const show = db.prepare('SELECT title FROM podcast_shows WHERE id = ?').get(showId) as { title: string } | undefined;
  const basePath = getPodcastDownloadsDir();
  const showDir = path.join(basePath, sanitizeFolderName(show?.title || showId));

  if (!fs.existsSync(showDir)) return;

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
 * Metadata ingestion for podcasts. Fetches and parses an RSS feed and
 * writes it to the podcast_shows/podcast_episodes tables. Mirrors
 * ingestMusicUrl in musicDownloader.ts, adapted for RSS: podcast_shows.id
 * is a generated id (not the feed URL itself), so show lookup/upsert is
 * always by feed_url. There is no channel/single-item split like YouTube
 * ingestion — a feed always describes exactly one show plus its episode list.
 */
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
    feed = await parser.parseURL(trimmedFeedUrl);
  } catch (err: any) {
    return { success: false, message: `Failed to fetch/parse RSS feed: ${err.message || err}`, count: 0 };
  }

  const showTitle = feed.title || 'Untitled Podcast';
  const showDescription = feed.description || null;
  const showAuthor = feed.itunesAuthor || feed.author || null;
  const showCoverUrl = feed.itunesImage?.href || feed.image?.url || null;
  const showLanguage = feed.language || null;

  const existingShow = db.prepare('SELECT id FROM podcast_shows WHERE feed_url = ?').get(trimmedFeedUrl) as { id: string } | undefined;
  const showId = existingShow?.id || crypto.randomUUID();
  const initialSyncStatus = options.sync_status || 'paused';
  const initialVisibility = options.visibility || 'public';

  if (existingShow) {
    db.prepare(`
      UPDATE podcast_shows
      SET title = ?, description = ?, author = ?, cover_url = COALESCE(?, cover_url), language = ?,
          sync_status = COALESCE(?, sync_status), visibility = COALESCE(?, visibility), last_checked_at = ?
      WHERE id = ?
    `).run(showTitle, showDescription, showAuthor, showCoverUrl, showLanguage, options.sync_status ?? null, options.visibility ?? null, Date.now(), showId);
  } else {
    db.prepare(`
      INSERT INTO podcast_shows (id, feed_url, title, description, author, cover_url, language, sync_status, visibility, last_checked_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(showId, trimmedFeedUrl, showTitle, showDescription, showAuthor, showCoverUrl, showLanguage, initialSyncStatus, initialVisibility, Date.now(), Date.now());
  }

  const items: any[] = Array.isArray(feed.items) ? feed.items : [];
  const upsertEpisode = db.prepare(`
    INSERT INTO podcast_episodes (id, show_id, title, description, audio_url, duration, episode_number, season_number, pub_date, download_status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      description = excluded.description,
      audio_url = excluded.audio_url,
      duration = COALESCE(excluded.duration, duration),
      episode_number = COALESCE(excluded.episode_number, episode_number),
      season_number = COALESCE(excluded.season_number, season_number),
      pub_date = COALESCE(excluded.pub_date, pub_date)
  `);
  const checkExists = db.prepare('SELECT 1 FROM podcast_episodes WHERE id = ?');

  let episodesAdded = 0;
  let skippedNoEnclosure = 0;
  for (const item of items) {
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

    upsertEpisode.run(
      episodeId,
      showId,
      item.title || `Episode ${episodeId}`,
      item.contentSnippet || item.content || null,
      audioUrl,
      duration,
      episodeNumber,
      seasonNumber,
      item.pubDate || null,
      Date.now()
    );

    if (!exists) episodesAdded++;
  }

  if (skippedNoEnclosure > 0) {
    addLog(`Ingestion du flux "${showTitle}" : ${skippedNoEnclosure} élément(s) sans enclosure audio ignoré(s).`);
  }

  const showState = db.prepare('SELECT sync_status FROM podcast_shows WHERE id = ?').get(showId) as { sync_status: string } | undefined;
  if (showState?.sync_status === 'downloading') {
    startPodcastQueueWorker();
  }

  return {
    success: true,
    message: `Podcast "${showTitle}" ingested. ${episodesAdded} new episode(s) added.`,
    count: episodesAdded
  };
}
