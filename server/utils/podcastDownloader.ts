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

function extensionFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const match = parsed.pathname.match(/\.([a-zA-Z0-9]{2,5})$/);
    return match ? match[1]!.toLowerCase() : null;
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
function downloadEpisodeFile(episodeId: string, showId: string): Promise<void> {
  const attemptStartedAt = Date.now();
  return new Promise<void>(async (resolve, reject) => {
    const db = getDb();
    let settled = false;
    const settle = (fn: () => void) => { if (!settled) { settled = true; fn(); } };

    const controller = new AbortController();
    activePodcastAbortControllers.set(episodeId, controller);
    activePodcastDownloadStartTimes.set(episodeId, attemptStartedAt);
    // Hoisted out of the try block so the catch block below can still reach
    // it to close the fd on every error/abort/timeout path — a write stream
    // opened but never destroyed leaks a file descriptor, and
    // cleanupPartialPodcastFiles() would then be unlinking the file out from
    // under a still-open handle.
    let fileStream: fs.WriteStream | undefined;

    const watchdog = setTimeout(() => {
      if (!settled) {
        addLog(`Téléchargement podcast [${episodeId}] timeout après ${PODCAST_DOWNLOAD_TIMEOUT_MS / 60000} minutes. Annulation.`);
        try { controller.abort(); } catch (e) {}
        activePodcastAbortControllers.delete(episodeId);
        activePodcastDownloadStartTimes.delete(episodeId);
        cleanupPartialPodcastFiles(episodeId, showId, { newerThan: attemptStartedAt });
        settle(() => reject(new Error(`Timeout: le téléchargement a dépassé ${PODCAST_DOWNLOAD_TIMEOUT_MS / 60000} minutes`)));
      }
    }, PODCAST_DOWNLOAD_TIMEOUT_MS);

    try {
      const episode = db.prepare('SELECT audio_url FROM podcast_episodes WHERE id = ?').get(episodeId) as { audio_url: string } | undefined;
      if (!episode || !episode.audio_url) {
        throw new Error("L'épisode n'a pas d'audio_url à télécharger.");
      }

      const show = db.prepare('SELECT title FROM podcast_shows WHERE id = ?').get(showId) as { title: string } | undefined;
      const folderName = sanitizeFolderName(show?.title || showId);
      const baseDir = getPodcastDownloadsDir();
      const showDir = path.join(baseDir, folderName);
      if (!fs.existsSync(showDir)) {
        fs.mkdirSync(showDir, { recursive: true });
      }

      addLog(`Lancement du téléchargement de l'épisode ${episodeId} : ${episode.audio_url}`);
      const response = await fetch(episode.audio_url, { signal: controller.signal });
      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`);
      }

      const ext = extensionFromContentType(response.headers.get('content-type')) || extensionFromUrl(episode.audio_url) || 'mp3';
      const outputPath = path.join(showDir, `${episodeId}.${ext}`);
      const localFilePath = `/downloads-podcasts/${folderName}/${episodeId}.${ext}`;

      const totalBytes = parseInt(response.headers.get('content-length') || '0', 10);
      let receivedBytes = 0;
      let lastDbWrite = 0;
      fileStream = fs.createWriteStream(outputPath);

      for await (const chunk of response.body as any) {
        fileStream.write(chunk);
        receivedBytes += chunk.length;
        const now = Date.now();
        // Throttled — matches the ~yt-dlp-progress-line cadence, not on every chunk.
        if (now - lastDbWrite > 500) {
          const elapsedSec = (now - attemptStartedAt) / 1000;
          const rate = elapsedSec > 0 ? receivedBytes / elapsedSec : 0;
          const speed = rate > 0 ? formatBytesPerSec(rate) : '0KB/s';
          if (totalBytes > 0) {
            const progress = Math.round((receivedBytes / totalBytes) * 100);
            const remainingBytes = totalBytes - receivedBytes;
            const eta = rate > 0 ? formatEta(remainingBytes / rate) : '--:--';
            db.prepare(`
              UPDATE podcast_episodes
              SET download_progress = ?, download_speed = ?, download_eta = ?
              WHERE id = ?
            `).run(progress, speed, eta, episodeId);
          } else {
            // Content-Length wasn't sent (e.g. chunked transfer encoding), so
            // there's no total to compute a percentage or ETA against.
            // podcast_episodes has no bytes-downloaded column to fall back on,
            // so per this codebase's convention of not fabricating a fake
            // percentage, we still surface *some* liveness signal (speed) and
            // leave download_progress/download_eta untouched rather than lying.
            db.prepare(`
              UPDATE podcast_episodes
              SET download_speed = ?
              WHERE id = ?
            `).run(speed, episodeId);
          }
          lastDbWrite = now;
        }
      }

      await new Promise<void>((res, rej) => {
        fileStream!.end((err?: Error | null) => {
          if (err) rej(err); else res();
        });
      });

      clearTimeout(watchdog);
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
      activePodcastAbortControllers.delete(episodeId);
      activePodcastDownloadStartTimes.delete(episodeId);
      // Release the fd before cleanup unlinks the partial file — otherwise
      // this path (network failure, watchdog abort, future external cancel)
      // leaves the write stream's file descriptor open indefinitely.
      fileStream?.destroy();
      if (!settled) {
        addLog(`Échec du téléchargement de l'épisode ${episodeId} : ${err.message || err}`);
        cleanupPartialPodcastFiles(episodeId, showId, { newerThan: attemptStartedAt });
      }
      settle(() => reject(err));
    }
  });
}

/**
 * Background loop that processes the podcast download queue. Persistent:
 * polls every few seconds instead of exiting when empty. Mirrors
 * startMusicQueueWorker exactly, with one deliberate omission: no
 * hasCapacityForCombinedDownloads check against COMBINED_MAX_CONCURRENT_DOWNLOADS.
 * Podcasts run their own independent per-pipeline cap only — extending the
 * video+music combined cap to a third pipeline is a separate decision this
 * plan does not make (see Global Constraints).
 */
export async function startPodcastQueueWorker() {
  if (getIsPodcastProcessing()) {
    addLog('Worker podcast déjà en cours d\'exécution. Réveil du worker...');
    wakePodcastWorker();
    return;
  }
  setIsPodcastProcessing(true);
  setPodcastWorkerShouldRun(true);
  addLog('Démarrage du worker de podcasts (mode persistant)...');

  try {
    const db = getDb();
    let consecutiveSystemErrors = 0;

    while (getPodcastWorkerShouldRun()) {
      try {
        const pausedSetting = db.prepare("SELECT value FROM settings WHERE key = 'podcast_downloader_paused'").get() as { value: string } | undefined;
        if (pausedSetting?.value === '1') {
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
          ORDER BY
            CASE WHEN e.download_progress > 0 THEN 0 ELSE 1 END,
            e.created_at ASC
          LIMIT 1
        `).get() as { id: string; title: string; show_id: string } | undefined;

        if (!episode) {
          await sleepOrWakeablePodcast(3000);
          continue;
        }

        consecutiveSystemErrors = 0;
        addLog(`Lancement du téléchargement d'épisode : "${episode.title}" (ID: ${episode.id})`);

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
        runSinglePodcastDownload(episode.id, episode.title, episode.show_id);
      } catch (loopErr: any) {
        consecutiveSystemErrors++;
        addLog(`Erreur système dans la boucle du worker podcast (${consecutiveSystemErrors}/5) : ${loopErr.message || loopErr}`);
        if (consecutiveSystemErrors >= 5) {
          addLog('Trop d\'erreurs système consécutives. Arrêt du worker podcast.');
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  } catch (err: any) {
    addLog(`Erreur générale fatale du worker podcast : ${err.message || err}`);
  } finally {
    setIsPodcastProcessing(false);
    setPodcastWorkerShouldRun(false);
    addLog('Worker de podcasts arrêté.');
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
    addLog(`Téléchargement RÉUSSI : "${episodeTitle}"`);
  } catch (err: any) {
    const errMsg = err.message || String(err);
    addLog(`ÉCHEC du téléchargement pour l'épisode "${episodeTitle}" (${episodeId}) : ${errMsg}`);

    const currentEpisode = db.prepare('SELECT download_status, retry_count FROM podcast_episodes WHERE id = ?').get(episodeId) as { download_status: string; retry_count: number | null } | undefined;
    const pausedSetting = db.prepare("SELECT value FROM settings WHERE key = 'podcast_downloader_paused'").get() as { value: string } | undefined;
    const isPausedGlobal = pausedSetting?.value === '1';

    if (isPausedGlobal || currentEpisode?.download_status === 'pending') {
      addLog(`Téléchargement de l'épisode "${episodeTitle}" (${episodeId}) interrompu ou mis en pause intentionnellement.`);
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
        addLog(`Épisode "${episodeTitle}" (${episodeId}) marqué comme définitivement échoué après ${nextRetryCount} tentatives.`);
      } else {
        db.prepare(`
          UPDATE podcast_episodes
          SET download_status = 'pending', download_progress = 0, download_speed = null, download_eta = null, last_error = ?, created_at = ?, retry_count = ?
          WHERE id = ?
        `).run(errMsg, Date.now(), nextRetryCount, episodeId);
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

  if (controller) {
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
