import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Cron } from 'croner';
import { getDb } from './db';
import { getYtdlPath, buildSpawnEnv, runProcessAsync, addLog, sanitizeFolderName, isDirWritable, isFfmpegAvailable } from './downloader';
import { parseMusicMetadataFromInfoData } from './musicMetadata';
import { parseMaxConcurrentDownloads, hasCapacityForMoreDownloads } from './concurrency';

// Define global-backed state to survive development HMR module hot reloads,
// same pattern as downloader.ts's own worker state.
const _g = globalThis as any;
const G_MUSIC_PROCESSING = Symbol.for('YouKeep.isMusicProcessing');
const G_MUSIC_SHOULD_RUN = Symbol.for('YouKeep.musicWorkerShouldRun');
const G_MUSIC_ACTIVE_DOWNLOAD_COUNT = Symbol.for('YouKeep.activeMusicDownloadCount');
const G_MUSIC_PROCESSES = Symbol.for('YouKeep.activeMusicProcesses');
const G_MUSIC_DOWNLOAD_START_TIMES = Symbol.for('YouKeep.activeMusicDownloadStartTimes');
const G_MUSIC_CLIP_BACKFILLS_IN_FLIGHT = Symbol.for('YouKeep.musicClipBackfillsInFlight');
// Deliberately a SEPARATE symbol from downloader.ts's G_CRON — the music and
// video cron jobs must be independently startable/stoppable, never sharing
// a handle (stopping one must never stop the other).
const G_MUSIC_CRON = Symbol.for('YouKeep.activeMusicCronJob');

if (!(G_MUSIC_PROCESSING in _g)) _g[G_MUSIC_PROCESSING] = false;
if (!(G_MUSIC_SHOULD_RUN in _g)) _g[G_MUSIC_SHOULD_RUN] = false;
if (!(G_MUSIC_ACTIVE_DOWNLOAD_COUNT in _g)) _g[G_MUSIC_ACTIVE_DOWNLOAD_COUNT] = 0;
if (!(G_MUSIC_PROCESSES in _g)) _g[G_MUSIC_PROCESSES] = new Map<string, any>();
if (!(G_MUSIC_DOWNLOAD_START_TIMES in _g)) _g[G_MUSIC_DOWNLOAD_START_TIMES] = new Map<string, number>();
if (!(G_MUSIC_CLIP_BACKFILLS_IN_FLIGHT in _g)) _g[G_MUSIC_CLIP_BACKFILLS_IN_FLIGHT] = new Set<string>();
if (!(G_MUSIC_CRON in _g)) _g[G_MUSIC_CRON] = null;

function getActiveMusicCronJob(): Cron | null { return _g[G_MUSIC_CRON]; }
function setActiveMusicCronJob(val: Cron | null) { _g[G_MUSIC_CRON] = val; }

function getIsMusicProcessing(): boolean { return _g[G_MUSIC_PROCESSING]; }
function setIsMusicProcessing(val: boolean) { _g[G_MUSIC_PROCESSING] = val; }
function getMusicWorkerShouldRun(): boolean { return _g[G_MUSIC_SHOULD_RUN]; }
function setMusicWorkerShouldRun(val: boolean) { _g[G_MUSIC_SHOULD_RUN] = val; }
function getActiveMusicDownloadCount(): number { return _g[G_MUSIC_ACTIVE_DOWNLOAD_COUNT]; }
function incrementActiveMusicDownloadCount() { _g[G_MUSIC_ACTIVE_DOWNLOAD_COUNT]++; }
function decrementActiveMusicDownloadCount() { _g[G_MUSIC_ACTIVE_DOWNLOAD_COUNT] = Math.max(0, _g[G_MUSIC_ACTIVE_DOWNLOAD_COUNT] - 1); }

let musicWorkerWakeResolver: (() => void) | null = null;

function sleepOrWakeableMusic(ms: number) {
  return new Promise<void>(resolve => {
    let timeoutId: any = null;
    const cleanResolve = () => {
      if (timeoutId) clearTimeout(timeoutId);
      musicWorkerWakeResolver = null;
      resolve();
    };
    musicWorkerWakeResolver = cleanResolve;
    timeoutId = setTimeout(cleanResolve, ms);
  });
}

export function wakeMusicWorker() {
  if (musicWorkerWakeResolver) {
    musicWorkerWakeResolver();
  }
}

// Maximum time (ms) a single audio download is allowed to run before being killed.
// Duplicated from downloader.ts's DOWNLOAD_TIMEOUT_MS (not exported there) rather
// than exporting it — this is a constant, not logic, so the duplication is cheap
// and avoids coupling this file to an unrelated module's internals.
const MUSIC_DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

export const activeMusicProcesses: Map<string, any> = _g[G_MUSIC_PROCESSES];
export const activeMusicDownloadStartTimes: Map<string, number> = _g[G_MUSIC_DOWNLOAD_START_TIMES];
export const musicClipBackfillsInFlight: Set<string> = _g[G_MUSIC_CLIP_BACKFILLS_IN_FLIGHT];

export function getMusicDownloadsDir(): string {
  const defaultPath = '/downloads/music';
  if (isDirWritable(defaultPath)) {
    return defaultPath;
  }

  const localFallback = path.resolve(process.cwd(), 'data/downloads-music');
  try { fs.mkdirSync(localFallback, { recursive: true }); } catch (err) {}
  return localFallback;
}

export function cleanupPartialMusicFiles(trackId: string, artistId: string, opts: { newerThan?: number } = {}): void {
  const db = getDb();
  const artist = db.prepare('SELECT name FROM music_artists WHERE id = ?').get(artistId) as { name: string } | undefined;
  const basePath = getMusicDownloadsDir();
  const artistDir = path.join(basePath, sanitizeFolderName(artist?.name || artistId));

  if (!fs.existsSync(artistDir)) return;

  const prefix = `${trackId}.`;
  let entries: string[];
  try {
    entries = fs.readdirSync(artistDir);
  } catch (e) {
    return;
  }

  for (const entry of entries) {
    if (!entry.startsWith(prefix)) continue;
    const fullPath = path.join(artistDir, entry);
    if (opts.newerThan !== undefined) {
      // A file that predates this download attempt is a previously-completed
      // file (e.g. the audio a manual clip backfill is trying to supplement),
      // not a partial artifact of the attempt being aborted — leave it alone.
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
 * Metadata Ingestion for music.
 * Fetches channel/video JSON from yt-dlp and writes it to the music_* tables.
 * Mirrors ingestUrl in downloader.ts, adapted for the music schema: music_artists.id
 * is a generated id (not the YouTube channel id), so artist lookup/upsert is always
 * by channel_id. No videos/shorts tab split — music channels don't need it.
 */
export async function ingestMusicUrl(
  url: string,
  options: {
    sync_status?: string;
    visibility?: string;
  } = {}
): Promise<{ success: boolean; message: string; count: number }> {
  const db = getDb();

  const channelPattern = /youtube\.com\/(channel\/[a-zA-Z0-9_-]+|@[a-zA-Z0-9._-]+|c\/[a-zA-Z0-9_-]+|user\/[a-zA-Z0-9_-]+)\/?$/;
  const trimmedUrl = url.trim();
  const isChannelUrl = channelPattern.test(trimmedUrl);
  const fetchUrl = isChannelUrl ? `${trimmedUrl.replace(/\/$/, '')}/videos` : trimmedUrl;

  const ytdlPath = await getYtdlPath();
  const env = buildSpawnEnv();
  const args = ['--dump-single-json', '--flat-playlist', fetchUrl];

  let stdout = '';
  let stderr = '';
  let status: number | null = null;
  try {
    const child = await runProcessAsync(ytdlPath, args, env);
    stdout = child.stdout;
    stderr = child.stderr;
    status = child.status;
  } catch (err: any) {
    return { success: false, message: `yt-dlp execution error: ${err.message || err}`, count: 0 };
  }

  if (status !== 0) {
    return { success: false, message: `yt-dlp metadata fetch failed: ${stderr || 'Unknown error'}`, count: 0 };
  }

  let data: any;
  try {
    data = JSON.parse(stdout);
  } catch (err) {
    return { success: false, message: 'Failed to parse JSON output from yt-dlp', count: 0 };
  }

  // Case A: channel/playlist listing
  if (data._type === 'playlist' || Array.isArray(data.entries)) {
    const channelId = data.channel_id || data.uploader_id || 'unknown-channel';
    const channelTitle = data.channel || data.uploader || data.title || 'Unknown Artist';
    const channelDesc = data.description || '';

    let avatarUrl: string | null = null;
    let bannerUrl: string | null = null;
    if (data.thumbnails && Array.isArray(data.thumbnails)) {
      const avatarObj = data.thumbnails.find((t: any) => t.id === 'avatar_uncropped' || (t.id && String(t.id).includes('avatar')));
      const bannerObj = data.thumbnails.find((t: any) => t.id === 'banner_uncropped' || (t.id && String(t.id).includes('banner')));
      if (avatarObj) avatarUrl = avatarObj.url;
      if (bannerObj) bannerUrl = bannerObj.url;
      if (!avatarUrl && data.thumbnails.length > 0) {
        avatarUrl = data.thumbnails[data.thumbnails.length - 1].url;
      }
    }

    const existingArtist = db.prepare('SELECT id FROM music_artists WHERE channel_id = ?').get(channelId) as { id: string } | undefined;
    const artistId = existingArtist?.id || crypto.randomUUID();
    const initialSyncStatus = options.sync_status || 'paused';
    const initialVisibility = options.visibility || 'public';

    if (existingArtist) {
      db.prepare(`
        UPDATE music_artists
        SET name = ?, description = ?, avatar_url = COALESCE(?, avatar_url), banner_url = COALESCE(?, banner_url),
            sync_status = COALESCE(?, sync_status), visibility = COALESCE(?, visibility)
        WHERE id = ?
      `).run(channelTitle, channelDesc, avatarUrl, bannerUrl, options.sync_status ?? null, options.visibility ?? null, artistId);
    } else {
      db.prepare(`
        INSERT INTO music_artists (id, channel_id, name, description, avatar_url, banner_url, sync_status, visibility, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(artistId, channelId, channelTitle, channelDesc, avatarUrl, bannerUrl, initialSyncStatus, initialVisibility, Date.now());
    }

    const trackEntries: any[] = [];
    function collectEntries(item: any) {
      if (!item) return;
      if (item._type === 'playlist' || Array.isArray(item.entries)) {
        for (const entry of item.entries) collectEntries(entry);
      } else if (item.id && (item._type === 'url' || item._type === 'url_transparent' || !item._type)) {
        if (!trackEntries.some((t: any) => t.id === item.id)) trackEntries.push(item);
      }
    }
    collectEntries(data);

    const upsertTrack = db.prepare(`
      INSERT INTO music_tracks (id, artist_id, title, duration, view_count, upload_date, download_status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        view_count = COALESCE(excluded.view_count, view_count),
        duration = COALESCE(excluded.duration, duration),
        upload_date = COALESCE(excluded.upload_date, upload_date)
    `);
    const checkExists = db.prepare('SELECT 1 FROM music_tracks WHERE id = ?');

    let tracksAdded = 0;
    for (const entry of trackEntries) {
      if (!entry.id || entry.id === channelId) continue;
      const exists = checkExists.get(entry.id);
      upsertTrack.run(entry.id, artistId, entry.title || `Track ${entry.id}`, entry.duration || null, entry.view_count || null, entry.upload_date || null, Date.now());
      if (!exists) tracksAdded++;
    }

    const artistState = db.prepare('SELECT sync_status FROM music_artists WHERE id = ?').get(artistId) as { sync_status: string } | undefined;
    if (artistState?.sync_status === 'downloading') {
      startMusicQueueWorker();
    }

    return {
      success: true,
      message: `Artist "${channelTitle}" ingested. ${tracksAdded} new track(s) added.`,
      count: tracksAdded
    };
  }

  // Case B: single track
  const trackId = data.id;
  const channelId = data.channel_id || data.uploader_id || 'unknown-channel';
  const channelTitle = data.channel || data.uploader || 'Unknown Artist';

  const existingArtist = db.prepare('SELECT id FROM music_artists WHERE channel_id = ?').get(channelId) as { id: string } | undefined;
  let artistId: string;
  if (existingArtist) {
    artistId = existingArtist.id;
    if (options.sync_status !== undefined || options.visibility !== undefined) {
      db.prepare(`
        UPDATE music_artists
        SET sync_status = COALESCE(?, sync_status), visibility = COALESCE(?, visibility)
        WHERE id = ?
      `).run(options.sync_status ?? null, options.visibility ?? null, artistId);
    }
  } else {
    artistId = crypto.randomUUID();
    const initialSyncStatus = options.sync_status || 'paused';
    const initialVisibility = options.visibility || 'public';
    db.prepare(`
      INSERT INTO music_artists (id, channel_id, name, sync_status, visibility, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(artistId, channelId, channelTitle, initialSyncStatus, initialVisibility, Date.now());
  }

  const exists = db.prepare('SELECT 1 FROM music_tracks WHERE id = ?').get(trackId);
  db.prepare(`
    INSERT INTO music_tracks (id, artist_id, title, duration, view_count, upload_date, download_status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
    ON CONFLICT(id) DO UPDATE SET title = excluded.title
  `).run(trackId, artistId, data.title || `Track ${trackId}`, data.duration || null, data.view_count || null, data.upload_date || null, Date.now());

  const artistState = db.prepare('SELECT sync_status FROM music_artists WHERE id = ?').get(artistId) as { sync_status: string } | undefined;
  if (artistState?.sync_status === 'downloading') {
    startMusicQueueWorker();
  }

  return {
    success: true,
    message: `Track "${data.title || trackId}" ingested.`,
    count: exists ? 0 : 1
  };
}

/**
 * Downloads a track's file using the spawned yt-dlp process. Depending on the
 * `wantClip` option, this either does audio-only extraction or downloads a
 * merged video+audio clip. Mirrors downloadVideoFile in downloader.ts.
 */
function downloadMusicTrackFile(trackId: string, artistId: string, opts: { wantClip?: boolean } = {}): Promise<{ hasClip: boolean }> {
  const wantClip = opts.wantClip === true;
  const attemptStartedAt = Date.now();
  return new Promise<{ hasClip: boolean }>(async (resolve, reject) => {
    try {
      const ytdlPath = await getYtdlPath();
      const db = getDb();

      if (!isFfmpegAvailable()) {
        reject(new Error('ffmpeg est requis pour l\'extraction audio et n\'a pas été trouvé sur le système.'));
        return;
      }

      const artist = db.prepare('SELECT name FROM music_artists WHERE id = ?').get(artistId) as { name: string } | undefined;
      const folderName = sanitizeFolderName(artist?.name || artistId);
      const baseDir = getMusicDownloadsDir();
      const artistDir = path.join(baseDir, folderName);

      if (!fs.existsSync(artistDir)) {
        fs.mkdirSync(artistDir, { recursive: true });
      }

      const outputTemplate = path.join(artistDir, `${trackId}.%(ext)s`);
      const targetUrl = `https://www.youtube.com/watch?v=${trackId}`;

      const args = wantClip
        ? [
            '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
            '--merge-output-format', 'mp4',
            '-o', outputTemplate,
            '--write-thumbnail',
            '--write-info-json',
            '--no-playlist',
            targetUrl
          ]
        : [
            '-x',
            '-f', 'bestaudio/best',
            '-o', outputTemplate,
            '--write-thumbnail',
            '--write-info-json',
            '--no-playlist',
            targetUrl
          ];

      const env = buildSpawnEnv();
      addLog(`Lancement du téléchargement ${wantClip ? 'du clip' : 'audio'} : ${ytdlPath} ${args.join(' ')}`);
      const child = spawn(ytdlPath, args, { env });
      activeMusicProcesses.set(trackId, child);
      activeMusicDownloadStartTimes.set(trackId, attemptStartedAt);

      let settled = false;
      const settle = (fn: () => void) => { if (!settled) { settled = true; fn(); } };

      const watchdog = setTimeout(() => {
        if (!settled) {
          addLog(`yt-dlp [${trackId}] timeout après ${MUSIC_DOWNLOAD_TIMEOUT_MS / 60000} minutes. Annulation.`);
          try { child.kill('SIGKILL'); } catch (e) {}
          activeMusicProcesses.delete(trackId);
          activeMusicDownloadStartTimes.delete(trackId);
          cleanupPartialMusicFiles(trackId, artistId, { newerThan: attemptStartedAt });
          settle(() => reject(new Error(`Timeout: le téléchargement a dépassé ${MUSIC_DOWNLOAD_TIMEOUT_MS / 60000} minutes`)));
        }
      }, MUSIC_DOWNLOAD_TIMEOUT_MS);

      child.on('error', (err) => {
        clearTimeout(watchdog);
        addLog(`yt-dlp [${trackId}] process error : ${err.message || err}`);
        activeMusicProcesses.delete(trackId);
        activeMusicDownloadStartTimes.delete(trackId);
        settle(() => reject(err));
      });

      child.stdout.on('data', (data) => {
        const lines = data.toString().split(/[\r\n]+/);
        for (let i = lines.length - 1; i >= 0; i--) {
          const line = lines[i];
          if (!line) continue;
          // Match progress like: [download]  12.5% of  4.32MiB at  1.10MiB/s ETA 00:03
          const progressMatch = line.match(/\[download\]\s+([0-9.]+)%\s+of\s+~?\s*([0-9.]+)([a-zA-Z]+)\s+at\s+(\S+)\s+ETA\s+(\S+)/);
          if (progressMatch) {
            const progress = Math.round(parseFloat(progressMatch[1]));
            const speed = progressMatch[4];
            const eta = progressMatch[5];
            db.prepare(`
              UPDATE music_tracks
              SET download_progress = ?, download_speed = ?, download_eta = ?
              WHERE id = ?
            `).run(progress, speed, eta, trackId);
            break;
          }
        }
      });

      let lastStderr = '';
      child.stderr.on('data', (data) => {
        const msg = data.toString().trim();
        addLog(`yt-dlp [${trackId}] stderr : ${msg}`);
        if (msg) lastStderr = msg;
      });

      child.on('close', (code) => {
        clearTimeout(watchdog);
        activeMusicProcesses.delete(trackId);
        activeMusicDownloadStartTimes.delete(trackId);
        if (settled) return;

        if (code === 0) {
          const scanExtensions = wantClip ? ['mp4'] : ['m4a', 'opus', 'webm', 'mp3', 'ogg', 'wav'];
          let audioFile: string | null = null;
          let localFilePath: string | null = null;
          for (const ext of scanExtensions) {
            const testPath = path.join(artistDir, `${trackId}.${ext}`);
            if (fs.existsSync(testPath)) {
              audioFile = testPath;
              localFilePath = `/downloads-music/${folderName}/${trackId}.${ext}`;
              break;
            }
          }

          if (!localFilePath) {
            const errorMsg = lastStderr ? `yt-dlp a terminé mais aucun fichier audio n'a été trouvé : ${lastStderr}` : `yt-dlp a terminé mais aucun fichier audio n'a été trouvé`;
            settle(() => reject(new Error(errorMsg)));
            return;
          }

          let thumbnailUrlPath: string | null = null;
          const thumbExtensions = ['jpg', 'jpeg', 'webp', 'png'];
          for (const ext of thumbExtensions) {
            const testPath = path.join(artistDir, `${trackId}.${ext}`);
            if (fs.existsSync(testPath)) {
              thumbnailUrlPath = `/downloads-music/${folderName}/${trackId}.${ext}`;
              break;
            }
          }

          const infoJsonFile = path.join(artistDir, `${trackId}.info.json`);
          let albumId: string | null = null;
          let genre: string | null = null;
          let trackNumber: number | null = null;

          if (fs.existsSync(infoJsonFile)) {
            try {
              const infoData = JSON.parse(fs.readFileSync(infoJsonFile, 'utf8'));
              const parsed = parseMusicMetadataFromInfoData(infoData);
              genre = parsed.genre;
              trackNumber = parsed.trackNumber;

              if (parsed.album) {
                const existingAlbum = db.prepare('SELECT id FROM music_albums WHERE artist_id = ? AND title = ?').get(artistId, parsed.album) as { id: string } | undefined;
                if (existingAlbum) {
                  albumId = existingAlbum.id;
                } else {
                  albumId = crypto.randomUUID();
                  db.prepare(`
                    INSERT INTO music_albums (id, artist_id, title, release_year, source, created_at)
                    VALUES (?, ?, ?, ?, 'youtube', ?)
                  `).run(albumId, artistId, parsed.album, parsed.releaseYear, Date.now());
                }
              }

              fs.unlinkSync(infoJsonFile);
            } catch (err) {
              console.error(`Failed to parse info JSON for track ${trackId}:`, err);
            }
          }

          const fileSize = audioFile && fs.existsSync(audioFile) ? fs.statSync(audioFile).size : null;

          db.prepare(`
            UPDATE music_tracks
            SET local_file_path = ?, local_thumbnail_path = ?, album_id = COALESCE(?, album_id),
                genre = COALESCE(?, genre), track_number = COALESCE(?, track_number), size_bytes = ?, has_clip = ?
            WHERE id = ?
          `).run(localFilePath, thumbnailUrlPath, albumId, genre, trackNumber, fileSize, wantClip ? 1 : 0, trackId);

          db.prepare(`
            INSERT INTO music_track_artists (track_id, artist_id, role)
            VALUES (?, ?, 'primary')
            ON CONFLICT(track_id, artist_id) DO NOTHING
          `).run(trackId, artistId);

          settle(() => resolve({ hasClip: wantClip }));
        } else {
          const errorMsg = lastStderr ? `yt-dlp a échoué (code ${code}) : ${lastStderr}` : `yt-dlp a échoué avec le code ${code}`;
          settle(() => reject(new Error(errorMsg)));
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Manually back-fills a clip for a track that was already ingested audio-only.
 * Unlike the automatic queue path, there is no audio-only fallback here — the
 * track already has working audio, so a failed clip attempt just leaves it
 * untouched. The pre-existing audio file (a different extension than the new
 * .mp4, so yt-dlp cannot clobber it) is only deleted after the new clip file
 * is confirmed on disk and the DB row is updated.
 */
export async function downloadTrackClip(trackId: string): Promise<void> {
  const db = getDb();
  const track = db.prepare('SELECT id, artist_id, local_file_path, has_clip FROM music_tracks WHERE id = ?').get(trackId) as
    { id: string; artist_id: string; local_file_path: string | null; has_clip: number } | undefined;
  if (!track) {
    throw new Error('Track not found');
  }
  if (track.has_clip === 1) {
    throw new Error('Track already has a clip');
  }

  const concurrencySetting = db.prepare("SELECT value FROM settings WHERE key = 'music_max_concurrent_downloads'").get() as { value: string } | undefined;
  const maxConcurrent = parseMaxConcurrentDownloads(concurrencySetting?.value);
  while (!hasCapacityForMoreDownloads(getActiveMusicDownloadCount(), maxConcurrent)) {
    await sleepOrWakeableMusic(1000);
  }

  incrementActiveMusicDownloadCount();
  const previousFilePath = track.local_file_path;
  const attemptStartedForCleanup = Date.now();
  try {
    await downloadMusicTrackFile(trackId, track.artist_id, { wantClip: true });

    if (previousFilePath) {
      const artist = db.prepare('SELECT name FROM music_artists WHERE id = ?').get(track.artist_id) as { name: string } | undefined;
      const folderName = sanitizeFolderName(artist?.name || track.artist_id);
      const artistDir = path.join(getMusicDownloadsDir(), folderName);
      const previousAudioExtensions = ['m4a', 'opus', 'webm', 'mp3', 'ogg', 'wav'];
      for (const ext of previousAudioExtensions) {
        const oldFile = path.join(artistDir, `${trackId}.${ext}`);
        if (fs.existsSync(oldFile)) {
          try { fs.unlinkSync(oldFile); } catch (e) {}
        }
      }
    }
    addLog(`Clip téléchargé avec succès pour la track ${trackId}.`);
  } catch (err: any) {
    const errMsg = err.message || String(err);
    addLog(`Échec du téléchargement du clip pour la track ${trackId} : ${errMsg}`);
    try {
      db.prepare('UPDATE music_tracks SET last_error = ? WHERE id = ?').run(errMsg, trackId);
    } catch (dbErr) {
      // best-effort — don't let a failure to record the error mask the original error
    }
    cleanupPartialMusicFiles(trackId, track.artist_id, { newerThan: attemptStartedForCleanup });
    throw err;
  } finally {
    decrementActiveMusicDownloadCount();
    musicClipBackfillsInFlight.delete(trackId);
    wakeMusicWorker();
  }
}

export async function startMusicQueueWorker() {
  if (getIsMusicProcessing()) {
    addLog('Worker musique déjà en cours d\'exécution. Réveil du worker...');
    wakeMusicWorker();
    return;
  }
  setIsMusicProcessing(true);
  setMusicWorkerShouldRun(true);
  addLog('Démarrage du worker de musique (mode persistant)...');

  try {
    const db = getDb();
    let consecutiveSystemErrors = 0;

    while (getMusicWorkerShouldRun()) {
      try {
        const pausedSetting = db.prepare("SELECT value FROM settings WHERE key = 'music_downloader_paused'").get() as { value: string } | undefined;
        if (pausedSetting?.value === '1') {
          await sleepOrWakeableMusic(5000);
          continue;
        }

        const concurrencySetting = db.prepare("SELECT value FROM settings WHERE key = 'music_max_concurrent_downloads'").get() as { value: string } | undefined;
        const maxConcurrent = parseMaxConcurrentDownloads(concurrencySetting?.value);
        if (!hasCapacityForMoreDownloads(getActiveMusicDownloadCount(), maxConcurrent)) {
          await sleepOrWakeableMusic(1000);
          continue;
        }

        const track = db.prepare(`
          SELECT t.id, t.title, t.artist_id
          FROM music_tracks t
          JOIN music_artists a ON t.artist_id = a.id
          WHERE t.download_status = 'pending' AND a.sync_status = 'downloading'
          ORDER BY
            CASE WHEN t.download_progress > 0 THEN 0 ELSE 1 END,
            t.created_at ASC
          LIMIT 1
        `).get() as { id: string; title: string; artist_id: string } | undefined;

        if (!track) {
          await sleepOrWakeableMusic(3000);
          continue;
        }

        consecutiveSystemErrors = 0;
        addLog(`Lancement du téléchargement audio : "${track.title}" (ID: ${track.id})`);

        db.prepare(`
          UPDATE music_tracks
          SET download_status = 'downloading',
              download_progress = COALESCE(download_progress, 0),
              download_speed = '0KB/s',
              download_eta = '--:--',
              last_error = null
          WHERE id = ?
        `).run(track.id);

        incrementActiveMusicDownloadCount();
        runSingleMusicDownload(track.id, track.title, track.artist_id);
      } catch (loopErr: any) {
        consecutiveSystemErrors++;
        addLog(`Erreur système dans la boucle du worker musique (${consecutiveSystemErrors}/5) : ${loopErr.message || loopErr}`);
        if (consecutiveSystemErrors >= 5) {
          addLog('Trop d\'erreurs système consécutives. Arrêt du worker musique.');
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  } catch (err: any) {
    addLog(`Erreur générale fatale du worker musique : ${err.message || err}`);
  } finally {
    setIsMusicProcessing(false);
    setMusicWorkerShouldRun(false);
    addLog('Worker de musique arrêté.');
  }
}

/**
 * Runs a single track download to completion and updates its DB status accordingly.
 * Not awaited by the orchestrator loop above — mirrors runSingleDownload in downloader.ts.
 */
async function runSingleMusicDownload(trackId: string, trackTitle: string, artistId: string): Promise<void> {
  const db = getDb();
  try {
    const clipsSetting = db.prepare("SELECT value FROM settings WHERE key = 'music_download_clips'").get() as { value: string } | undefined;
    const wantClip = clipsSetting?.value === '1';

    let result: { hasClip: boolean };
    let clipFallbackError: string | null = null;
    if (wantClip) {
      try {
        result = await downloadMusicTrackFile(trackId, artistId, { wantClip: true });
      } catch (clipErr: any) {
        clipFallbackError = clipErr.message || String(clipErr);
        addLog(`Échec du téléchargement du clip pour "${trackTitle}" (${trackId}), repli sur l'audio seul : ${clipFallbackError}`);

        const pausedSetting = db.prepare("SELECT value FROM settings WHERE key = 'music_downloader_paused'").get() as { value: string } | undefined;
        const currentTrackState = db.prepare('SELECT download_status FROM music_tracks WHERE id = ?').get(trackId) as { download_status: string } | undefined;
        if (pausedSetting?.value === '1' || currentTrackState?.download_status !== 'downloading') {
          // A pause deliberately preserves partial files for resume (see pause.post.ts's
          // keepProgressAndFiles=true) — a cancel already cleans up via cancelMusicDownload.
          // Only clean up here when we're actually about to retry below.
          throw clipErr;
        }

        // No newerThan guard here (unlike other cleanup call sites in this file): this is the
        // automatic ingestion queue path, which only ever downloads fresh tracks — there is no
        // pre-existing file this attempt could clobber, so a start-time guard has nothing to protect.
        cleanupPartialMusicFiles(trackId, artistId);
        result = await downloadMusicTrackFile(trackId, artistId, { wantClip: false });
      }
    } else {
      result = await downloadMusicTrackFile(trackId, artistId, { wantClip: false });
    }

    db.prepare(`
      UPDATE music_tracks
      SET download_status = 'completed', download_progress = 100, download_speed = null, download_eta = null, last_error = ?
      WHERE id = ?
    `).run(clipFallbackError ? `Clip indisponible, repli sur l'audio seul : ${clipFallbackError}` : null, trackId);
    addLog(`Téléchargement ${result.hasClip ? 'du clip' : 'audio'} RÉUSSI : "${trackTitle}"`);
  } catch (err: any) {
    const errMsg = err.message || String(err);
    addLog(`ÉCHEC du téléchargement pour la track "${trackTitle}" (${trackId}) : ${errMsg}`);

    const currentTrack = db.prepare('SELECT download_status FROM music_tracks WHERE id = ?').get(trackId) as { download_status: string } | undefined;
    const pausedSetting = db.prepare("SELECT value FROM settings WHERE key = 'music_downloader_paused'").get() as { value: string } | undefined;
    const isPausedGlobal = pausedSetting?.value === '1';

    if (isPausedGlobal || currentTrack?.download_status === 'pending') {
      addLog(`Téléchargement de la track "${trackTitle}" (${trackId}) interrompu ou mis en pause intentionnellement.`);
      db.prepare(`
        UPDATE music_tracks
        SET download_status = 'pending', download_speed = null, download_eta = null
        WHERE id = ?
      `).run(trackId);
    } else {
      db.prepare(`
        UPDATE music_tracks
        SET download_status = 'pending', download_progress = 0, download_speed = null, download_eta = null, last_error = ?, created_at = ?
        WHERE id = ?
      `).run(errMsg, Date.now(), trackId);
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  } finally {
    decrementActiveMusicDownloadCount();
    wakeMusicWorker();
  }
}

/**
 * Terminates an active music download process and deletes temporary files.
 * Mirrors cancelDownload in downloader.ts.
 */
export function cancelMusicDownload(trackId: string, targetStatus: 'failed' | 'pending' = 'pending', keepProgressAndFiles = false): boolean {
  const child = activeMusicProcesses.get(trackId);
  const startedAt = activeMusicDownloadStartTimes.get(trackId);
  const db = getDb();

  if (child) {
    try {
      child.kill('SIGKILL');
    } catch (e) {}
    activeMusicProcesses.delete(trackId);
    activeMusicDownloadStartTimes.delete(trackId);
  }

  if (keepProgressAndFiles) {
    db.prepare(`
      UPDATE music_tracks
      SET download_status = ?, download_speed = null, download_eta = null
      WHERE id = ?
    `).run(targetStatus, trackId);
  } else {
    db.prepare(`
      UPDATE music_tracks
      SET download_status = ?, download_progress = 0, download_speed = null, download_eta = null
      WHERE id = ?
    `).run(targetStatus, trackId);
  }

  if (!keepProgressAndFiles) {
    const track = db.prepare('SELECT artist_id FROM music_tracks WHERE id = ?').get(trackId) as { artist_id: string } | undefined;
    if (track) {
      cleanupPartialMusicFiles(trackId, track.artist_id, startedAt !== undefined ? { newerThan: startedAt } : {});
    }
  }

  return true;
}

/**
 * Resets any stale music downloads stuck in 'downloading' status back to 'pending'.
 * Mirrors resetStaleDownloads in downloader.ts.
 */
export function resetStaleMusicDownloads() {
  try {
    const db = getDb();
    const result = db.prepare(`
      UPDATE music_tracks
      SET download_status = 'pending', download_progress = 0, download_speed = null, download_eta = null
      WHERE download_status = 'downloading'
    `).run();
    if (result.changes > 0) {
      addLog(`Réinitialisation de ${result.changes} téléchargements musicaux interrompus.`);
    }
  } catch (err: any) {
    console.error('Failed to reset stale music downloads:', err);
  }
}

/**
 * Re-fetches every followed music artist's channel feed to discover new
 * tracks, then starts the download queue for anything newly pending.
 * Mirrors syncAllChannels in downloader.ts.
 */
export async function syncAllMusicArtists(): Promise<void> {
  const db = getDb();

  db.prepare("UPDATE settings SET value = '1' WHERE key = 'music_sync_all_active'").run();

  try {
    const artists = db.prepare("SELECT id, name, channel_id FROM music_artists WHERE channel_id IS NOT NULL").all() as { id: string; name: string; channel_id: string }[];
    addLog(`Démarrage de la resynchronisation automatique de ${artists.length} artiste(s) musicaux...`);

    for (const artist of artists) {
      const pausedSetting = db.prepare("SELECT value FROM settings WHERE key = 'music_downloader_paused'").get() as { value: string } | undefined;
      if (pausedSetting?.value === '1') {
        addLog('Resynchronisation automatique musicale interrompue : téléchargements en pause.');
        break;
      }

      addLog(`Resynchronisation de l'artiste : ${artist.name} (${artist.id})`);
      db.prepare("UPDATE music_artists SET sync_status = 'downloading' WHERE id = ?").run(artist.id);

      const url = `https://www.youtube.com/channel/${artist.channel_id}`;
      try {
        await ingestMusicUrl(url);
      } catch (err) {
        console.error(`Erreur lors de la resynchronisation de l'artiste ${artist.name} (${artist.id}):`, err);
      }
    }

    startMusicQueueWorker();
    addLog('Resynchronisation automatique musicale terminée.');
  } catch (err) {
    console.error('Fatal error during syncAllMusicArtists:', err);
  } finally {
    db.prepare("UPDATE settings SET value = '0' WHERE key = 'music_sync_all_active'").run();
  }
}

/**
 * Registers (or re-registers, on settings change) the music resync cron
 * job. Mirrors initScheduler in downloader.ts, using a separate settings
 * namespace and active-job handle so it never interacts with the video
 * cron.
 */
export function initMusicScheduler(): void {
  const db = getDb();

  const enabledSetting = db.prepare("SELECT value FROM settings WHERE key = 'music_sync_cron_enabled'").get() as { value: string } | undefined;
  const scheduleSetting = db.prepare("SELECT value FROM settings WHERE key = 'music_sync_cron_schedule'").get() as { value: string } | undefined;

  const enabled = enabledSetting ? enabledSetting.value === '1' : false;
  const cronExpression = scheduleSetting?.value || '30 3 * * *';

  if (getActiveMusicCronJob()) {
    getActiveMusicCronJob()!.stop();
    setActiveMusicCronJob(null);
  }

  if (enabled) {
    console.log(`Scheduling music auto-sync cron job with expression: "${cronExpression}"`);
    try {
      const job = new Cron(cronExpression, async () => {
        console.log('Automated music cron trigger: starting artist synchronization...');
        const syncSetting = db.prepare("SELECT value FROM settings WHERE key = 'music_sync_all_active'").get() as { value: string } | undefined;
        if (syncSetting?.value === '1') {
          console.log('Automated music cron: sync all is already active. Skipping.');
          return;
        }
        await syncAllMusicArtists();
      });
      setActiveMusicCronJob(job);
    } catch (err) {
      console.error(`Failed to register music cron expression "${cronExpression}":`, err);
    }
  } else {
    console.log('Automated music sync cron job is disabled.');
  }
}
