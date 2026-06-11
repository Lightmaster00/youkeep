import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import https from 'https';
import crypto from 'crypto';
import { Cron } from 'croner';

export function sanitizeFolderName(name: string): string {
  return name
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim();
}

let activeCronJob: Cron | null = null;

export const latestLogs: string[] = [];

export function addLog(msg: string) {
  const timestamp = new Date().toISOString().slice(11, 19);
  const logLine = `[${timestamp}] ${msg}`;
  latestLogs.push(logLine);
  console.log(logLine);
  if (latestLogs.length > 250) {
    latestLogs.shift();
  }
}

export interface QueueItem {
  id: string;
  url: string;
  status: 'pending' | 'downloading' | 'completed' | 'failed';
  progress: number;
}

let isProcessing = false;
let workerShouldRun = false; // persistent flag to keep worker alive
export const activeProcesses = new Map<string, any>();

let workerWakeResolver: (() => void) | null = null;

function sleepOrWakeable(ms: number) {
  return new Promise<void>(resolve => {
    let timeoutId: any = null;
    const cleanResolve = () => {
      if (timeoutId) clearTimeout(timeoutId);
      workerWakeResolver = null;
      resolve();
    };
    workerWakeResolver = cleanResolve;
    timeoutId = setTimeout(cleanResolve, ms);
  });
}

export function wakeWorker() {
  if (workerWakeResolver) {
    workerWakeResolver();
  }
}

// Maximum time (ms) a single download is allowed to run before being killed
const DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

// Ensure local directories exist
const dataDir = path.resolve(process.cwd(), 'data');
const binDir = path.join(dataDir, 'bin');

[dataDir, binDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

export function isDirWritable(dirPath: string): boolean {
  try {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    fs.accessSync(dirPath, fs.constants.W_OK);
    return true;
  } catch (err) {
    return false;
  }
}

export function getDownloadsDir(): string {
  try {
    const db = getDb();
    const setting = db.prepare("SELECT value FROM settings WHERE key = 'default_downloads_dir'").get() as { value: string } | undefined;
    if (setting && setting.value.trim().length > 0) {
      const customPath = path.resolve(setting.value.trim());
      if (isDirWritable(customPath)) {
        return customPath;
      }
    }
  } catch (e) {}
  
  const defaultPath = '/downloads/videos';
  if (isDirWritable(defaultPath)) {
    return defaultPath;
  }
  
  const localFallback = path.resolve(process.cwd(), 'data/downloads');
  try { fs.mkdirSync(localFallback, { recursive: true }); } catch (err) {}
  return localFallback;
}

/**
 * Gets the path of the locally managed yt-dlp executable,
 * downloading it if it doesn't exist.
 */
export async function getYtdlPath(): Promise<string> {
  const isWin = process.platform === 'win32';
  const filename = isWin ? 'yt-dlp.exe' : 'yt-dlp';
  const ytdlPath = path.join(binDir, filename);

  if (fs.existsSync(ytdlPath) && fs.statSync(ytdlPath).size > 0) {
    return ytdlPath;
  }

  // Remove incomplete/0-byte files if they exist
  if (fs.existsSync(ytdlPath)) {
    fs.unlinkSync(ytdlPath);
  }

  console.log(`yt-dlp not found or corrupted. Downloading to ${ytdlPath}...`);
  const url = isWin
    ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
    : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';

  const tmpPath = ytdlPath + '.tmp';
  const downloadFile = (currentUrl: string): Promise<void> => {
    return new Promise<void>((resolve, reject) => {
      https.get(currentUrl, { headers: { 'User-Agent': 'MyTeub-Archiver' } }, (response) => {
        if (response.statusCode === 301 || response.statusCode === 302) {
          const redirectUrl = response.headers.location!;
          downloadFile(redirectUrl).then(resolve).catch(reject);
        } else if (response.statusCode === 200) {
          const file = fs.createWriteStream(tmpPath);
          response.pipe(file);
          file.on('finish', () => {
            file.close();
            resolve();
          });
          file.on('error', (err) => {
            file.close();
            if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
            reject(err);
          });
        } else {
          reject(new Error(`Server responded with status code: ${response.statusCode}`));
        }
      }).on('error', reject);
    });
  };

  try {
    await downloadFile(url);
    if (fs.existsSync(tmpPath)) {
      fs.renameSync(tmpPath, ytdlPath);
    }
  } catch (err) {
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    if (fs.existsSync(ytdlPath)) fs.unlinkSync(ytdlPath);
    throw err;
  }

  if (!isWin) {
    fs.chmodSync(ytdlPath, 0o755);
  }

  console.log('yt-dlp downloaded successfully.');
  return ytdlPath;
}

/**
 * Updates the yt-dlp binary to the latest version.
 */
export async function updateYtdl(): Promise<string> {
  const ytdlPath = await getYtdlPath();
  addLog('Vérification des mises à jour de yt-dlp...');
  
  // Make sure ffmpeg is in path
  const env = { ...process.env };
  env.PATH = `/opt/homebrew/bin:/usr/local/bin:${env.PATH || ''}`;

  try {
    const res = await runProcessAsync(ytdlPath, ['-U'], env);
    const output = res.stdout || res.stderr || '';
    addLog(`Résultat de la mise à jour de yt-dlp : ${output.trim()}`);
    return output;
  } catch (err: any) {
    addLog(`Échec de la mise à jour de yt-dlp : ${err.message || err}`);
    throw err;
  }
}

/**
 * Background loop that processes the download queue.
 * Persistent: polls every few seconds instead of exiting when empty.
 */
export async function startQueueWorker() {
  if (isProcessing) {
    // Worker already running — wake it up if it is sleeping so it checks the queue instantly
    addLog('Worker déjà en cours d\'exécution. Réveil du worker...');
    wakeWorker();
    return;
  }
  isProcessing = true;
  workerShouldRun = true;
  addLog('Démarrage du worker de file d\'attente (mode persistant)...');

  try {
    const db = getDb();
    let consecutiveSystemErrors = 0;
    
    while (workerShouldRun) {
      try {
        // Check if global download is paused
        const pausedSetting = db.prepare("SELECT value FROM settings WHERE key = 'downloader_paused'").get() as { value: string } | undefined;
        if (pausedSetting?.value === '1') {
          // Don't exit — just wait and poll again when unpaused
          await sleepOrWakeable(5000);
          continue;
        }

        // Find next pending video from active channels or manually queued, respecting priority and resuming partial downloads first
        const video = db.prepare(`
          SELECT v.id, v.title, v.channel_id 
          FROM videos v
          JOIN channels c ON v.channel_id = c.id
          WHERE v.download_status = 'pending' AND (c.sync_status = 'downloading' OR v.is_manually_queued = 1)
          ORDER BY 
            v.priority DESC,
            v.is_short DESC,
            CASE WHEN v.download_progress > 0 THEN 0 ELSE 1 END,
            v.created_at ASC
          LIMIT 1
        `).get() as { id: string; title: string; channel_id: string } | undefined;

        if (!video) {
          // No pending videos — sleep and poll again (don't exit)
          await sleepOrWakeable(3000);
          continue;
        }

        consecutiveSystemErrors = 0;
        addLog(`Lancement du téléchargement : "${video.title}" (ID: ${video.id})`);
        
        // Update status to downloading, keeping the existing progress if it exists
        db.prepare(`
          UPDATE videos 
          SET download_status = 'downloading', 
              download_progress = COALESCE(download_progress, 0), 
              download_speed = '0KB/s', 
              download_eta = '--:--', 
              last_error = null
          WHERE id = ?
        `).run(video.id);

        try {
          await downloadVideoFile(video.id, video.channel_id);
          
          // Mark as completed
          db.prepare(`
            UPDATE videos 
            SET download_status = 'completed', download_progress = 100, download_speed = null, download_eta = null, is_manually_queued = 0, last_error = null
            WHERE id = ?
          `).run(video.id);
          addLog(`Téléchargement RÉUSSI : "${video.title}"`);
        } catch (err: any) {
          const errMsg = err.message || String(err);
          addLog(`ÉCHEC du téléchargement pour la vidéo "${video.title}" (${video.id}) : ${errMsg}`);
          
          // Check if the download was interrupted intentionally (e.g. paused/cancelled via API or global paused setting)
          const currentVideo = db.prepare('SELECT download_status FROM videos WHERE id = ?').get(video.id) as { download_status: string } | undefined;
          const pausedSetting = db.prepare("SELECT value FROM settings WHERE key = 'downloader_paused'").get() as { value: string } | undefined;
          const isPausedGlobal = pausedSetting?.value === '1';

          if (isPausedGlobal || currentVideo?.download_status === 'pending') {
            addLog(`Téléchargement de la vidéo "${video.title}" (${video.id}) interrompu ou mis en pause intentionnellement.`);
            // Ensure status is pending, speed/eta are null, but preserve progress and files
            db.prepare(`
              UPDATE videos 
              SET download_status = 'pending', download_speed = null, download_eta = null
              WHERE id = ?
            `).run(video.id);
          } else {
            // Put the video back to pending but move it to the end of the queue by updating created_at
            db.prepare(`
              UPDATE videos 
              SET download_status = 'pending', download_progress = 0, download_speed = null, download_eta = null, is_manually_queued = 0, last_error = ?, created_at = ?
              WHERE id = ?
            `).run(errMsg, Date.now(), video.id);
          }
          // Brief pause before trying next video to avoid hammering on repeat errors
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      } catch (loopErr: any) {
        consecutiveSystemErrors++;
        addLog(`Erreur système dans la boucle du worker (${consecutiveSystemErrors}/5) : ${loopErr.message || loopErr}`);
        if (consecutiveSystemErrors >= 5) {
          addLog('Trop d\'erreurs système consécutives. Arrêt du worker.');
          break;
        }
        // Wait before retrying to let the database/system recover
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  } catch (err: any) {
    addLog(`Erreur générale fatale du worker : ${err.message || err}`);
  } finally {
    isProcessing = false;
    workerShouldRun = false;
    addLog('Worker de file d\'attente arrêté.');
  }
}

/**
 * Stops the persistent queue worker gracefully after the current download finishes.
 */
export function stopQueueWorker() {
  workerShouldRun = false;
  addLog('Arrêt du worker de file d\'attente demandé.');
}

/**
 * Resets any stale downloads stuck in 'downloading' status back to 'pending'
 */
export function resetStaleDownloads() {
  try {
    const db = getDb();
    const result = db.prepare(`
      UPDATE videos 
      SET download_status = 'pending', download_progress = 0, download_speed = null, download_eta = null
      WHERE download_status = 'downloading'
    `).run();
    if (result.changes > 0) {
      addLog(`Réinitialisation de ${result.changes} téléchargements interrompus.`);
    }
  } catch (err: any) {
    console.error('Failed to reset stale downloads:', err);
  }
}

/**
 * Downloads a video using the spawned yt-dlp process
 */
/**
 * Checks if ffmpeg is available in the current PATH.
 */
export function isFfmpegAvailable(): boolean {
  const env = { ...process.env };
  env.PATH = `/opt/homebrew/bin:/usr/local/bin:${env.PATH || ''}`;
  try {
    const res = spawnSync('ffmpeg', ['-version'], { env });
    return res.status === 0;
  } catch (e) {
    return false;
  }
}

/**
 * Executes a process asynchronously and returns stdout, stderr, and exit status.
 */
export function runProcessAsync(
  commandPath: string,
  args: string[],
  env: any,
  maxBuffer: number = 1024 * 1024 * 50
): Promise<{ stdout: string; stderr: string; status: number | null }> {
  return new Promise((resolve, reject) => {
    try {
      const child = spawn(commandPath, args, { env });
      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
        if (stdout.length > maxBuffer) {
          child.kill('SIGKILL');
          reject(new Error('Stdout buffer limit exceeded'));
        }
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
        if (stderr.length > maxBuffer) {
          child.kill('SIGKILL');
          reject(new Error('Stderr buffer limit exceeded'));
        }
      });

      child.on('error', (err) => {
        reject(err);
      });

      child.on('close', (code) => {
        resolve({ stdout, stderr, status: code });
      });
    } catch (err) {
      reject(err);
    }
  });
}

function parseSizeStringToBytes(sizeVal: string, sizeUnit: string): number | null {
  const val = parseFloat(sizeVal);
  if (isNaN(val)) return null;
  const unit = sizeUnit.toLowerCase();
  if (unit.includes('g')) return val * 1024 * 1024 * 1024;
  if (unit.includes('m')) return val * 1024 * 1024;
  if (unit.includes('k')) return val * 1024;
  return val;
}

function parseETAToSeconds(etaStr: string): number | null {
  const parts = etaStr.split(':').map(p => parseInt(p, 10));
  if (parts.some(isNaN)) return null;
  if (parts.length === 3) {
    return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!;
  }
  if (parts.length === 2) {
    return parts[0]! * 60 + parts[1]!;
  }
  return null;
}

function parseSpeedStringToBytes(speedStr: string): number | null {
  const match = speedStr.match(/^\s*([0-9.]+)\s*([a-zA-Z/]+)/);
  if (!match) return null;
  const val = parseFloat(match[1]!);
  const unit = match[2]!.toLowerCase();
  if (unit.includes('g')) return val * 1024 * 1024 * 1024;
  if (unit.includes('m')) return val * 1024 * 1024;
  if (unit.includes('k')) return val * 1024;
  return val;
}

function formatBytesToSpeed(bytesPerSec: number): string {
  if (bytesPerSec >= 1024 * 1024 * 1024) {
    return (bytesPerSec / (1024 * 1024 * 1024)).toFixed(1) + ' GB/s';
  }
  if (bytesPerSec >= 1024 * 1024) {
    return (bytesPerSec / (1024 * 1024)).toFixed(1) + ' MB/s';
  }
  if (bytesPerSec >= 1024) {
    return (bytesPerSec / 1024).toFixed(0) + ' KB/s';
  }
  return bytesPerSec.toFixed(0) + ' B/s';
}

function formatSecondsToETA(seconds: number): string {
  if (seconds === Infinity || isNaN(seconds) || seconds < 0) return '--:--';
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

function extractCommentsParallel(videoId: string, targetVideoUrl: string, ytdlPath: string, env: any): Promise<void> {
  return new Promise<void>((resolve) => {
    console.log(`Starting parallel comment extraction for video ${videoId}...`);
    // Run yt-dlp to only fetch comments and dump to stdout
    const args = [
      '--skip-download',
      '--dump-json',
      '--get-comments',
      '--no-playlist',
      targetVideoUrl
    ];

    const child = spawn(ytdlPath, args, { env });
    let stdoutData = '';

    child.stdout.on('data', (data) => {
      stdoutData += data.toString();
    });

    child.stderr.on('data', (data) => {
      // Ignore or log stderr warnings
    });

    child.on('close', (code) => {
      if (code !== 0) {
        console.warn(`Parallel comment extraction failed with code ${code} for video ${videoId}`);
        resolve();
        return;
      }

      try {
        const infoData = JSON.parse(stdoutData);
        if (infoData.comments && Array.isArray(infoData.comments)) {
          const db = getDb();
          const insertComment = db.prepare(`
            INSERT INTO comments (id, video_id, author, author_thumbnail, text, time_text, like_count, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              author = excluded.author,
              author_thumbnail = excluded.author_thumbnail,
              text = excluded.text,
              time_text = excluded.time_text,
              like_count = excluded.like_count
          `);

          const transaction = db.transaction((commentsList: any[]) => {
            for (const comment of commentsList) {
              insertComment.run(
                comment.id || crypto.randomUUID(),
                videoId,
                comment.author || 'Anonymous',
                comment.author_thumbnail || null,
                comment.text || '',
                comment.time_text || null,
                comment.like_count || 0,
                comment.timestamp ? comment.timestamp * 1000 : Date.now()
              );
            }
          });

          transaction(infoData.comments);
          console.log(`Parallel comment extraction succeeded: inserted ${infoData.comments.length} comments for video ${videoId}`);
        }
      } catch (err) {
        console.warn(`Failed to parse comments JSON for video ${videoId}:`, err);
      }
      resolve();
    });
  });
}

function downloadVideoFile(videoId: string, channelId: string): Promise<void> {
  return new Promise<void>(async (resolve, reject) => {
    try {
      const ytdlPath = await getYtdlPath();
    const db = getDb();
    const ffmpegAvailable = isFfmpegAvailable();
    
    const channel = db.prepare('SELECT title, custom_save_path FROM channels WHERE id = ?').get(channelId) as { title: string; custom_save_path: string | null } | undefined;
    const basePath = channel?.custom_save_path && channel.custom_save_path.trim().length > 0 && isDirWritable(channel.custom_save_path)
      ? channel.custom_save_path
      : getDownloadsDir();
    const channelDir = path.join(basePath, sanitizeFolderName(channel?.title || channelId));

    const outputTemplate = path.join(channelDir, `${videoId}.%(ext)s`);

    // Ensure directory exists
    if (!fs.existsSync(channelDir)) {
      fs.mkdirSync(channelDir, { recursive: true });
    }

    const isShortRecord = db.prepare('SELECT is_short FROM videos WHERE id = ?').get(videoId) as { is_short: number } | undefined;
    const isShort = isShortRecord?.is_short === 1;
    const targetVideoUrl = isShort 
      ? `https://www.youtube.com/shorts/${videoId}`
      : `https://www.youtube.com/watch?v=${videoId}`;

    const args = [
      '--ignore-errors',
      '-f', ffmpegAvailable ? 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best' : 'best[ext=mp4]/best',
      '-o', outputTemplate,
      '--write-thumbnail',
      '--concurrent-fragments', '16',
      '--http-chunk-size', '10M',
      '--write-subs',
      '--write-auto-subs',
      '--sub-format', 'vtt',
      '--sub-langs', 'fr,en,es',
    ];

    if (ffmpegAvailable) {
      args.push('--convert-thumbnails', 'jpg');
      args.push('--merge-output-format', 'mp4');
    }

    args.push(
      '--no-playlist',
      '--write-info-json',
      targetVideoUrl
    );

    const env = { ...process.env };
    env.PATH = `/opt/homebrew/bin:/usr/local/bin:${env.PATH || ''}`;

    addLog(`Lancement de la commande de téléchargement (ffmpeg disponible: ${ffmpegAvailable}) : ${ytdlPath} ${args.join(' ')}`);
    const child = spawn(ytdlPath, args, { env });
    activeProcesses.set(videoId, child);

    // Start parallel comment extraction in parallel background thread
    const commentsPromise = extractCommentsParallel(videoId, targetVideoUrl, ytdlPath, env);

    const downloadStartTime = Date.now();
    let totalSpeedSumBytes = 0;
    let speedUpdateCount = 0;

    let settled = false;
    const settle = (fn: () => void) => {
      if (!settled) { settled = true; fn(); }
    };

    // Watchdog: kill and fail if download hangs for too long
    const watchdog = setTimeout(() => {
      if (!settled) {
        addLog(`yt-dlp [${videoId}] timeout après ${DOWNLOAD_TIMEOUT_MS / 60000} minutes. Annulation.`);
        try { child.kill('SIGKILL'); } catch (e) {}
        activeProcesses.delete(videoId);
        settle(() => reject(new Error(`Timeout: le téléchargement a dépassé ${DOWNLOAD_TIMEOUT_MS / 60000} minutes`)));
      }
    }, DOWNLOAD_TIMEOUT_MS);

    child.on('error', (err) => {
      clearTimeout(watchdog);
      addLog(`yt-dlp [${videoId}] process error : ${err.message || err}`);
      activeProcesses.delete(videoId);
      settle(() => reject(err));
    });

    child.stdout.on('data', (data) => {
      const lines = data.toString().split(/[\r\n]+/);
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        if (!line) continue;

        // Match progress like: [download]  12.5% of  45.34MiB at  3.56MiB/s ETA 01:23
        const progressMatch = line.match(/\[download\]\s+([0-9.]+)%\s+of\s+~?\s*([0-9.]+)([a-zA-Z]+)\s+at\s+(\S+)\s+ETA\s+(\S+)/);
        if (progressMatch) {
          const progress = Math.round(parseFloat(progressMatch[1]));
          const rawSizeVal = progressMatch[2];
          const rawSizeUnit = progressMatch[3];
          const rawSpeedStr = progressMatch[4];
          const currentVideoSizeBytes = parseSizeStringToBytes(rawSizeVal, rawSizeUnit);

          const rawSpeedBytes = parseSpeedStringToBytes(rawSpeedStr);
          if (rawSpeedBytes !== null && rawSpeedBytes > 0) {
            totalSpeedSumBytes += rawSpeedBytes;
            speedUpdateCount++;
          }

          // Moyenne de toutes les vitesses depuis le début
          const avgSpeedBytes = speedUpdateCount > 0 
             ? totalSpeedSumBytes / speedUpdateCount 
             : (rawSpeedBytes || 0);

          const displaySpeed = avgSpeedBytes > 0 
             ? formatBytesToSpeed(avgSpeedBytes) 
             : rawSpeedStr;

          let displayEta = '--:--';
          if (currentVideoSizeBytes !== null) {
            const progressPercent = parseFloat(progressMatch[1]);
            const remainingBytes = currentVideoSizeBytes * (1 - progressPercent / 100);
            if (avgSpeedBytes > 0) {
              const etaSeconds = remainingBytes / avgSpeedBytes;
              displayEta = formatSecondsToETA(etaSeconds);
            }
          }

          db.prepare(`
            UPDATE videos 
            SET download_progress = ?, download_speed = ?, download_eta = ?
            WHERE id = ?
          `).run(progress, displaySpeed, displayEta, videoId);
          break;
        }

        // Match comment downloading like: [youtube] Downloading comment API JSON page 1 (0/~6542)
        const commentMatch = line.match(/\[youtube\]\s+(?:Downloading\s+comment\s+API\s+JSON\s+page\s+(\d+)|Downloading\s+(\~?\d+)\s+comments)/i);
        if (commentMatch) {
          let statusText = 'Fetching comments...';
          if (commentMatch[1]) {
            statusText = `Comments page ${commentMatch[1]}`;
          } else if (commentMatch[2]) {
            statusText = `Comments: ${commentMatch[2]}`;
          }
          db.prepare(`
            UPDATE videos 
            SET download_speed = ?, download_eta = 'Waiting...'
            WHERE id = ?
          `).run(statusText, videoId);
          break;
        }
      }
    });

    let lastStderr = '';
    child.stderr.on('data', (data) => {
      const msg = data.toString().trim();
      addLog(`yt-dlp [${videoId}] stderr : ${msg}`);
      if (msg) {
        lastStderr = msg;
      }
    });

    child.on('close', (code) => {
      clearTimeout(watchdog);
      activeProcesses.delete(videoId);
      if (settled) return; // Already resolved/rejected by watchdog or error handler
      if (code === 0) {
        const folderName = sanitizeFolderName(channel?.title || channelId);

        // Locate downloaded video file (can be mp4, webm, mkv, etc.)
        let videoFile = path.join(channelDir, `${videoId}.mp4`);
        let videoUrlPath: string | null = null;
        const videoExtensions = ['mp4', 'webm', 'mkv', '3gp', 'flv'];
        for (const ext of videoExtensions) {
          const testPath = path.join(channelDir, `${videoId}.${ext}`);
          if (fs.existsSync(testPath)) {
            videoFile = testPath;
            videoUrlPath = `/downloads/${folderName}/${videoId}.${ext}`;
            break;
          }
        }

        if (!videoUrlPath) {
          const errorMsg = lastStderr ? `yt-dlp a terminé mais aucun fichier vidéo n'a été trouvé : ${lastStderr}` : `yt-dlp a terminé mais aucun fichier vidéo n'a été trouvé`;
          settle(() => reject(new Error(errorMsg)));
          return;
        }

        // Locate downloaded thumbnail file (can be jpg, png, webp, etc.)
        let thumbnailFile = path.join(channelDir, `${videoId}.jpg`);
        let thumbnailUrlPath: string | null = null;
        const thumbExtensions = ['jpg', 'jpeg', 'webp', 'png'];
        for (const ext of thumbExtensions) {
          const testPath = path.join(channelDir, `${videoId}.${ext}`);
          if (fs.existsSync(testPath)) {
            thumbnailFile = testPath;
            thumbnailUrlPath = `/downloads/${folderName}/${videoId}.${ext}`;
            break;
          }
        }

        const infoJsonFile = path.join(channelDir, `${videoId}.info.json`);
        
        let desc = null;
        let views = null;
        let uploadDate = null;
        let likeCount = null;
        
        if (fs.existsSync(infoJsonFile)) {
          try {
            const infoData = JSON.parse(fs.readFileSync(infoJsonFile, 'utf8'));
            desc = infoData.description || null;
            views = infoData.view_count || null;
            uploadDate = infoData.upload_date || null;
            likeCount = infoData.like_count || null;
            
            // Ingest comments
            if (infoData.comments && Array.isArray(infoData.comments)) {
              const insertComment = db.prepare(`
                INSERT INTO comments (id, video_id, author, author_thumbnail, text, time_text, like_count, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                  author = excluded.author,
                  author_thumbnail = excluded.author_thumbnail,
                  text = excluded.text,
                  time_text = excluded.time_text,
                  like_count = excluded.like_count
              `);
              
              const transaction = db.transaction((commentsList: any[]) => {
                for (const comment of commentsList) {
                  insertComment.run(
                    comment.id || crypto.randomUUID(),
                    videoId,
                    comment.author || 'Anonyme',
                    comment.author_thumbnail || null,
                    comment.text || '',
                    comment.time_text || null,
                    comment.like_count || 0,
                    comment.timestamp ? comment.timestamp * 1000 : Date.now()
                  );
                }
              });
              transaction(infoData.comments);
            }
            
            // Remove the info JSON to save disk space
            fs.unlinkSync(infoJsonFile);
          } catch (err) {
            console.error(`Failed to parse info JSON for video ${videoId}:`, err);
          }
        }
        
        const fileSize = videoUrlPath && fs.existsSync(videoFile) ? fs.statSync(videoFile).size : null;

        db.prepare(`
          UPDATE videos 
          SET local_video_path = ?, 
              local_thumbnail_path = ?,
              description = COALESCE(?, description),
              view_count = COALESCE(?, view_count),
              upload_date = COALESCE(?, upload_date),
              like_count = COALESCE(?, like_count),
              size_bytes = ?
          WHERE id = ?
        `).run(
          videoUrlPath,
          thumbnailUrlPath,
          desc,
          views,
          uploadDate,
          likeCount,
          fileSize,
          videoId
        );
        settle(() => resolve());
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
 * Terminates an active download process and deletes temporary files.
 */
export function cancelDownload(videoId: string, targetStatus: 'failed' | 'pending' = 'pending', keepProgressAndFiles = false): boolean {
  const child = activeProcesses.get(videoId);
  const db = getDb();
  
  if (child) {
    try {
      child.kill('SIGKILL');
    } catch (e) {}
    activeProcesses.delete(videoId);
  }

  // Update status back to targetStatus
  if (keepProgressAndFiles) {
    db.prepare(`
      UPDATE videos 
      SET download_status = ?, download_speed = null, download_eta = null
      WHERE id = ?
    `).run(targetStatus, videoId);
  } else {
    db.prepare(`
      UPDATE videos 
      SET download_status = ?, download_progress = 0, download_speed = null, download_eta = null
      WHERE id = ?
    `).run(targetStatus, videoId);
  }

  // Retrieve channelId to clean up local part files
  if (!keepProgressAndFiles) {
    const video = db.prepare('SELECT channel_id FROM videos WHERE id = ?').get(videoId) as { channel_id: string } | undefined;
    if (video) {
      const channelId = video.channel_id;
      const channel = db.prepare('SELECT title, custom_save_path FROM channels WHERE id = ?').get(channelId) as { title: string; custom_save_path: string | null } | undefined;
      const basePath = channel?.custom_save_path && channel.custom_save_path.trim().length > 0 && isDirWritable(channel.custom_save_path)
        ? channel.custom_save_path
        : getDownloadsDir();
      const channelDir = path.join(basePath, sanitizeFolderName(channel?.title || channelId));
      const mp4File = path.join(channelDir, `${videoId}.mp4`);
      const jpgFile = path.join(channelDir, `${videoId}.jpg`);
      const partFile = path.join(channelDir, `${videoId}.mp4.part`);
      const ytdlPartFile = path.join(channelDir, `${videoId}.mp4.ytdl`);

      [mp4File, jpgFile, partFile, ytdlPartFile].forEach(f => {
        if (fs.existsSync(f)) {
          try { fs.unlinkSync(f); } catch (e) {}
        }
      });
    }
  }

  return true;
}

/**
 * Metadata Ingestion
 * Fetches playlist/video/channel JSON from yt-dlp and writes it to DB.
 */
export async function ingestUrl(
  url: string,
  options: {
    channelMetadataOnly?: boolean;
    download_videos?: number;
    download_shorts?: number;
    download_lives?: number;
    date_after?: string | null;
    sync_status?: string;
    visibility?: string;
    custom_save_path?: string | null;
  } = {}
): Promise<{ success: boolean; message: string; count: number }> {
  const db = getDb();
  
  // If this is a base channel URL, split it into videos and shorts calls to ensure we retrieve everything.
  const channelPattern = /youtube\.com\/(channel\/[a-zA-Z0-9_-]+|@[a-zA-Z0-9._-]+|c\/[a-zA-Z0-9_-]+|user\/[a-zA-Z0-9_-]+)\/?$/;
  if (channelPattern.test(url.trim()) && !options.channelMetadataOnly) {
    const baseUrl = url.trim().replace(/\/$/, '');
    console.log(`Base channel URL detected: ${baseUrl}. Ingesting requested tabs...`);
    
    // First ingest metadata to register/update the channel
    await ingestUrl(baseUrl, { ...options, channelMetadataOnly: true });

    let videosCount = 0;
    let shortsCount = 0;

    // Only ingest videos tab if download_videos is not 0
    if (options.download_videos !== 0) {
      const videosRes = await ingestUrl(`${baseUrl}/videos`, options);
      videosCount = videosRes.count;
    }
    
    // Only ingest shorts tab if download_shorts is not 0
    if (options.download_shorts !== 0) {
      try {
        const shortsRes = await ingestUrl(`${baseUrl}/shorts`, options);
        shortsCount = shortsRes.count;
      } catch (e) {
        console.warn(`Could not ingest shorts for channel ${baseUrl}:`, e);
      }
    }
    
    let msg = '';
    if (options.download_videos !== 0 && options.download_shorts !== 0) {
      msg = 'Channel synchronized (Videos and Shorts).';
    } else if (options.download_videos !== 0) {
      msg = 'Channel synchronized (Regular videos only).';
    } else if (options.download_shorts !== 0) {
      msg = 'Channel synchronized (Shorts only).';
    } else {
      msg = 'Channel registered (no content selected for sync).';
    }

    return {
      success: true,
      message: msg,
      count: videosCount + shortsCount
    };
  }

  const ytdlPath = await getYtdlPath();
  
  console.log(`Ingesting URL: ${url}`);
  
  const env = { ...process.env };
  env.PATH = `/opt/homebrew/bin:/usr/local/bin:${env.PATH || ''}`;

  // Run with dump-json to inspect what we are dealing with.
  // We use --flat-playlist to get entries quickly.
  const args = ['--dump-single-json', '--flat-playlist'];
  if (options.channelMetadataOnly) {
    args.push('--playlist-end', '1');
  }
  args.push(url);
  
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
    const error = stderr || 'Unknown error';
    return { success: false, message: `yt-dlp metadata fetch failed: ${error}`, count: 0 };
  }

  let data: any;
  try {
    data = JSON.parse(stdout);
  } catch (err) {
    return { success: false, message: 'Failed to parse JSON output from yt-dlp', count: 0 };
  }

  let videosAdded = 0;

  // Case A: It's a playlist or channel (contains _type: "playlist" or entries array)
  if (data._type === 'playlist' || Array.isArray(data.entries)) {
    const channelId = data.channel_id || data.id || 'unknown-channel';
    const channelTitle = data.channel || data.title || 'Unknown Channel';
    const channelDesc = data.description || '';
    
    let avatarUrl = null;
    let bannerUrl = null;

    if (data.thumbnails && Array.isArray(data.thumbnails)) {
      const avatarObj = data.thumbnails.find((t: any) => t.id === 'avatar_uncropped' || (t.id && String(t.id).includes('avatar')));
      const bannerObj = data.thumbnails.find((t: any) => t.id === 'banner_uncropped' || (t.id && String(t.id).includes('banner')));
      
      if (avatarObj) {
        avatarUrl = avatarObj.url;
      }
      if (bannerObj) {
        bannerUrl = bannerObj.url;
      }

      if (!avatarUrl) {
        const squareThumb = data.thumbnails.find((t: any) => t.width && t.height && t.width === t.height);
        if (squareThumb) {
          avatarUrl = squareThumb.url;
        }
      }

      if (!avatarUrl && data.thumbnails.length > 0) {
        const nonBannerThumbs = data.thumbnails.filter((t: any) => !(t.id && String(t.id).includes('banner')) && !(t.width && t.width > 500 && t.height && t.height < 300));
        if (nonBannerThumbs.length > 0) {
          avatarUrl = nonBannerThumbs[nonBannerThumbs.length - 1].url;
        } else {
          avatarUrl = data.thumbnails[data.thumbnails.length - 1].url;
        }
      }
    }

    if (!avatarUrl) {
      avatarUrl = data.thumbnail || null;
    }

    // Check if channel already exists
    const existingChannel = db.prepare('SELECT download_videos, download_shorts, download_lives, date_after, custom_save_path FROM channels WHERE id = ?').get(channelId) as {
      download_videos: number;
      download_shorts: number;
      download_lives: number;
      date_after: string | null;
      custom_save_path: string | null;
    } | undefined;

    const initialSyncStatus = options.sync_status || 'paused';
    const initialVisibility = options.visibility || 'public';
    const dlVideos = options.download_videos !== undefined ? options.download_videos : 1;
    const dlShorts = options.download_shorts !== undefined ? options.download_shorts : 0;
    const dlLives = options.download_lives !== undefined ? options.download_lives : 0;
    const dateAfter = options.date_after !== undefined ? options.date_after : null;
    const customSavePath = options.custom_save_path !== undefined ? options.custom_save_path : null;

    db.prepare(`
      INSERT INTO channels (
        id, title, description, avatar_url, banner_url, 
        sync_status, visibility, download_videos, download_shorts, 
        download_lives, date_after, custom_save_path, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        description = excluded.description,
        avatar_url = COALESCE(excluded.avatar_url, avatar_url),
        banner_url = COALESCE(excluded.banner_url, banner_url),
        sync_status = COALESCE(?, sync_status),
        visibility = COALESCE(?, visibility),
        download_videos = COALESCE(?, download_videos),
        download_shorts = COALESCE(?, download_shorts),
        download_lives = COALESCE(?, download_lives),
        date_after = COALESCE(?, date_after),
        custom_save_path = COALESCE(?, custom_save_path)
    `).run(
      channelId, channelTitle, channelDesc, avatarUrl, bannerUrl,
      initialSyncStatus, initialVisibility, dlVideos, dlShorts, dlLives, dateAfter, customSavePath, Date.now(),
      options.sync_status !== undefined ? options.sync_status : null,
      options.visibility !== undefined ? options.visibility : null,
      options.download_videos !== undefined ? options.download_videos : null,
      options.download_shorts !== undefined ? options.download_shorts : null,
      options.download_lives !== undefined ? options.download_lives : null,
      options.date_after !== undefined ? options.date_after : null,
      options.custom_save_path !== undefined ? options.custom_save_path : null
    );

    if (options.channelMetadataOnly) {
      return { 
        success: true, 
        message: `Channel metadata for "${channelTitle}" has been updated.`, 
        count: 0 
      };
    }

    // Resolve channel preferences
    const channelPref = existingChannel || {
      download_videos: 1,
      download_shorts: 0,
      download_lives: 0,
      date_after: null as string | null
    };

    // Collect all nested leaf video entries recursively and tag their type
    const videoEntries: any[] = [];
    function collectEntries(item: any, currentType: 'video' | 'short' | 'live' = 'video') {
      if (!item) return;
      let nextType = currentType;

      if (item.title?.toLowerCase().endsWith('- live') || item.webpage_url?.includes('/streams')) {
        nextType = 'live';
      } else if (item.title?.toLowerCase().endsWith('- shorts') || item.webpage_url?.includes('/shorts')) {
        nextType = 'short';
      } else if (item.title?.toLowerCase().endsWith('- videos') || item.webpage_url?.includes('/videos')) {
        nextType = 'video';
      }

      if (item._type === 'playlist' || Array.isArray(item.entries)) {
        for (const entry of item.entries) {
          collectEntries(entry, nextType);
        }
      } else if (item.id && (item._type === 'url' || item._type === 'url_transparent' || !item._type)) {
        if (!videoEntries.some(v => v.id === item.id)) {
          item.contentType = nextType;
          videoEntries.push(item);
        }
      }
    }
    collectEntries(data);

    // Insert new entries and update metadata for existing ones
    const upsertVideo = db.prepare(`
      INSERT INTO videos (id, title, description, channel_id, upload_date, duration, view_count, download_status, is_short, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        description = COALESCE(excluded.description, description),
        view_count = COALESCE(excluded.view_count, view_count),
        duration = COALESCE(excluded.duration, duration),
        upload_date = COALESCE(excluded.upload_date, upload_date)
    `);

    const checkExists = db.prepare('SELECT 1 FROM videos WHERE id = ?');

    for (const entry of videoEntries) {
      if (!entry.id || entry.id === channelId) continue;

      // Filter by content type
      if (entry.contentType === 'live') continue;
      if (entry.contentType === 'short' && channelPref.download_shorts === 0) continue;
      if (entry.contentType === 'video' && channelPref.download_videos === 0) continue;

      // Filter by upload date
      const uploadDate = entry.upload_date || null;
      if (channelPref.date_after && uploadDate && uploadDate < channelPref.date_after) {
        continue;
      }

      const duration = entry.duration || null;
      const viewCount = entry.view_count || null;
      const isShortFlag = entry.contentType === 'short' ? 1 : 0;
      
      // Check if this is a genuinely new video before upserting
      const exists = checkExists.get(entry.id);
      
      upsertVideo.run(
        entry.id,
        entry.title || `Video ${entry.id}`,
        entry.description || '',
        channelId,
        uploadDate,
        duration,
        viewCount,
        isShortFlag,
        Date.now()
      );

      if (!exists) {
        videosAdded++;
      }
    }

    // Only trigger queue processing if the channel is already set to 'downloading'
    const channelState = db.prepare('SELECT sync_status FROM channels WHERE id = ?').get(channelId) as { sync_status: string } | undefined;
    if (channelState?.sync_status === 'downloading') {
      startQueueWorker();
    }

    // Automatically synchronize playlists for this channel in the background
    syncChannelPlaylists(channelId).catch(err => {
      console.error(`Error during automatic playlists sync for channel ${channelId}:`, err);
    });

    const syncNote = channelState?.sync_status === 'downloading' 
      ? `${videosAdded} new videos added to the download queue.`
      : `${videosAdded} new videos cataloged. Enable channel synchronization to start downloading.`;

    return { 
      success: true, 
      message: `Channel/playlist "${channelTitle}" has been imported. ${syncNote}`, 
      count: videosAdded 
    };
  } 
  
  // Case B: It's a single video
  const videoId = data.id;
  const channelId = data.channel_id || 'unknown-channel';
  const channelTitle = data.channel || 'Unknown Channel';
  const avatarUrl = null;

  // Ensure channel exists (defaulting single video channels to paused as well, so admins can trigger)
  const channelCheck = db.prepare('SELECT 1 FROM channels WHERE id = ?').get(channelId);
  if (!channelCheck) {
    db.prepare(`
      INSERT INTO channels (id, title, description, avatar_url, banner_url, sync_status, created_at)
      VALUES (?, ?, ?, ?, ?, 'paused', ?)
      ON CONFLICT(id) DO NOTHING
    `).run(channelId, channelTitle, '', avatarUrl, null, Date.now());

    // Asynchronously fetch full channel details (avatar, banner, description) in background without inserting other videos
    setTimeout(async () => {
      try {
        console.log(`Background fetching details for new channel: ${channelTitle} (${channelId})`);
        await ingestUrl(`https://www.youtube.com/channel/${channelId}`, { channelMetadataOnly: true });
      } catch (err) {
        console.error(`Failed to background ingest channel ${channelId}:`, err);
      }
    }, 1000);
  }

  // Insert or update video
  const isShortFlag = (
    url.includes('/shorts/') || 
    (data.webpage_url && data.webpage_url.includes('/shorts/')) || 
    (data.original_url && data.original_url.includes('/shorts/'))
  ) ? 1 : 0;

  const res = db.prepare(`
    INSERT INTO videos (id, title, description, channel_id, upload_date, duration, view_count, download_status, is_manually_queued, is_short, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      download_status = CASE WHEN download_status != 'completed' THEN 'pending' ELSE download_status END,
      is_manually_queued = CASE WHEN download_status != 'completed' THEN 1 ELSE is_manually_queued END,
      is_short = excluded.is_short
  `).run(
    videoId,
    data.title || `Video ${videoId}`,
    data.description || '',
    channelId,
    data.upload_date || null,
    data.duration || null,
    data.view_count || null,
    isShortFlag,
    Date.now()
  );

  // Trigger queue processing unconditionally since this is a manual ingest
  startQueueWorker();

  if (res.changes > 0) {
    return { success: true, message: `Video "${data.title}" has been added to the download queue.`, count: 1 };
  } else {
    const videoStatus = db.prepare('SELECT download_status FROM videos WHERE id = ?').get(videoId) as { download_status: string } | undefined;
    if (videoStatus?.download_status === 'completed') {
      return { success: true, message: `Video "${data.title}" is already present in the archive.`, count: 0 };
    } else {
      return { success: true, message: `Video "${data.title}" has been re-added to the download queue.`, count: 1 };
    }
  }
}

/**
 * Iterates through all channels, sets them to 'downloading',
 * runs yt-dlp metadata ingestion for each, and triggers the queue worker.
 */
export async function syncAllChannels(): Promise<void> {
  const db = getDb();
  
  // Set sync_all_active setting to '1'
  db.prepare("UPDATE settings SET value = '1' WHERE key = 'sync_all_active'").run();

  try {
    // 1. Set all channels' sync_status to 'downloading'
    db.prepare("UPDATE channels SET sync_status = 'downloading'").run();

    // 2. Fetch all channels
    const channels = db.prepare("SELECT id, title FROM channels").all() as { id: string; title: string }[];
    console.log(`Starting metadata update for all ${channels.length} channels...`);

    // 3. Re-ingest each channel's feed in sequence
    for (const ch of channels) {
      // Check if global download is paused
      const pausedSetting = db.prepare("SELECT value FROM settings WHERE key = 'downloader_paused'").get() as { value: string } | undefined;
      if (pausedSetting?.value === '1') {
        console.log('Global sync-all task aborted: downloader is paused.');
        break;
      }

      console.log(`Updating channel: ${ch.title} (${ch.id})`);
      const url = `https://www.youtube.com/channel/${ch.id}`;
      try {
        await ingestUrl(url);
      } catch (err) {
        console.error(`Error updating channel ${ch.title} (${ch.id}):`, err);
      }
    }
    
    // 4. Refresh metadata (views, likes, comments) for recently completed videos
    await refreshCompletedVideosMetadata();
    
    // 5. Trigger queue worker to download all new pending videos
    startQueueWorker();
    console.log('Update of all channels completed successfully.');
  } catch (err) {
    console.error('Fatal error during syncAllChannels:', err);
  } finally {
    // Set sync_all_active setting to '0'
    db.prepare("UPDATE settings SET value = '0' WHERE key = 'sync_all_active'").run();
  }
}

/**
 * Refreshes metadata (views, likes, comments) for completed videos.
 * Targets videos downloaded in the last 7 days and recently watched videos 
 * to keep sync fast while ensuring fresh data for active content.
 */
export async function refreshCompletedVideosMetadata(): Promise<void> {
  const db = getDb();

  const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);

  // Get completed videos that were recently downloaded or recently watched
  const videosToRefresh = db.prepare(`
    SELECT DISTINCT v.id, v.title, v.is_short
    FROM videos v
    LEFT JOIN user_history h ON v.id = h.video_id
    WHERE v.download_status = 'completed'
      AND (
        v.created_at > ?
        OR h.watched_at > ?
      )
    ORDER BY v.is_short DESC
    LIMIT 100
  `).all(sevenDaysAgo, sevenDaysAgo) as { id: string; title: string; is_short: number }[];

  if (videosToRefresh.length === 0) {
    addLog('Metadata refresh: no recent videos to update.');
    return;
  }

  addLog(`Metadata refresh: updating ${videosToRefresh.length} recently active videos...`);

  let ytdlPath: string;
  try {
    ytdlPath = await getYtdlPath();
  } catch (err) {
    addLog('Metadata refresh: yt-dlp not available, skipping.');
    return;
  }

  const env = { ...process.env };
  env.PATH = `/opt/homebrew/bin:/usr/local/bin:${env.PATH || ''}`;

  let updated = 0;
  let commentsUpdated = 0;

  for (const video of videosToRefresh) {
    // Check if global download is paused
    const pausedSetting = db.prepare("SELECT value FROM settings WHERE key = 'downloader_paused'").get() as { value: string } | undefined;
    if (pausedSetting?.value === '1') {
      addLog('Metadata refresh aborted: downloader is paused.');
      break;
    }

    const targetUrl = video.is_short
      ? `https://www.youtube.com/shorts/${video.id}`
      : `https://www.youtube.com/watch?v=${video.id}`;

    try {
      const child = await runProcessAsync(ytdlPath, [
        '--skip-download',
        '--dump-json',
        '--get-comments',
        '--no-playlist',
        targetUrl
      ], env);

      if (child.status !== 0) {
        console.warn(`Metadata refresh failed for ${video.id}: ${child.stderr}`);
        continue;
      }

      const infoData = JSON.parse(child.stdout);

      // Update video metadata
      db.prepare(`
        UPDATE videos SET
          title = COALESCE(?, title),
          description = COALESCE(?, description),
          view_count = COALESCE(?, view_count),
          like_count = COALESCE(?, like_count),
          duration = COALESCE(?, duration),
          upload_date = COALESCE(?, upload_date)
        WHERE id = ?
      `).run(
        infoData.title || null,
        infoData.description || null,
        infoData.view_count ?? null,
        infoData.like_count ?? null,
        infoData.duration ?? null,
        infoData.upload_date || null,
        video.id
      );
      updated++;

      // Update comments
      if (infoData.comments && Array.isArray(infoData.comments) && infoData.comments.length > 0) {
        const insertComment = db.prepare(`
          INSERT INTO comments (id, video_id, author, author_thumbnail, text, time_text, like_count, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            author = excluded.author,
            author_thumbnail = excluded.author_thumbnail,
            text = excluded.text,
            time_text = excluded.time_text,
            like_count = excluded.like_count
        `);

        const transaction = db.transaction((commentsList: any[]) => {
          for (const comment of commentsList) {
            insertComment.run(
              comment.id || crypto.randomUUID(),
              video.id,
              comment.author || 'Anonymous',
              comment.author_thumbnail || null,
              comment.text || '',
              comment.time_text || null,
              comment.like_count || 0,
              comment.timestamp ? comment.timestamp * 1000 : Date.now()
            );
          }
        });

        transaction(infoData.comments);
        commentsUpdated += infoData.comments.length;
      }
    } catch (err: any) {
      console.warn(`Metadata refresh error for video ${video.id}:`, err.message || err);
    }
  }

  addLog(`Metadata refresh complete: ${updated} videos updated, ${commentsUpdated} comments refreshed.`);
}

/**
 * Initializes the background scheduler from database settings.
 */
export function initScheduler(): void {
  const db = getDb();
  
  const enabledSetting = db.prepare("SELECT value FROM settings WHERE key = 'sync_cron_enabled'").get() as { value: string } | undefined;
  const scheduleSetting = db.prepare("SELECT value FROM settings WHERE key = 'sync_cron_schedule'").get() as { value: string } | undefined;
  
  const enabled = enabledSetting ? enabledSetting.value === '1' : false;
  const cronExpression = scheduleSetting?.value || '0 3 * * *';

  if (activeCronJob) {
    activeCronJob.stop();
    activeCronJob = null;
  }

  if (enabled) {
    console.log(`Scheduling auto-sync cron job with expression: "${cronExpression}"`);
    try {
      activeCronJob = new Cron(cronExpression, async () => {
        console.log('Automated cron trigger: starting channel synchronization...');
        const syncSetting = db.prepare("SELECT value FROM settings WHERE key = 'sync_all_active'").get() as { value: string } | undefined;
        if (syncSetting?.value === '1') {
          console.log('Automated cron: sync all is already active. Skipping.');
          return;
        }
        await syncAllChannels();
      });
    } catch (err) {
      console.error(`Failed to register cron expression "${cronExpression}":`, err);
    }
  } else {
    console.log('Automated sync cron job is disabled.');
  }
}

/**
 * Synchronizes playlists for a specific channel.
 */
export async function syncChannelPlaylists(channelId: string): Promise<void> {
  const db = getDb();
  const ytdlPath = await getYtdlPath();
  const channel = db.prepare('SELECT title FROM channels WHERE id = ?').get(channelId) as { title: string } | undefined;
  if (!channel) {
    throw new Error(`Channel not found: ${channelId}`);
  }

  addLog(`Synchronisation des playlists pour la chaîne: "${channel.title}" (${channelId})`);

  const env = { ...process.env };
  env.PATH = `/opt/homebrew/bin:/usr/local/bin:${env.PATH || ''}`;

  // Flat playlist scan of the playlists tab
  const playlistsUrl = `https://www.youtube.com/channel/${channelId}/playlists`;
  const args = ['--dump-single-json', '--flat-playlist', playlistsUrl];

  let stdout = '';
  let status: number | null = null;
  try {
    const child = await runProcessAsync(ytdlPath, args, env);
    stdout = child.stdout;
    status = child.status;
  } catch (err: any) {
    addLog(`Échec de récupération des playlists pour ${channelId}: ${err.message || err}`);
    return;
  }

  if (status !== 0) {
    addLog(`Aucune playlist publique trouvée ou échec d'accès aux playlists pour ${channelId}`);
    return;
  }

  let data: any;
  try {
    data = JSON.parse(stdout);
  } catch (err) {
    addLog(`Échec d'analyse du JSON des playlists pour ${channelId}`);
    return;
  }

  if (data._type === 'playlist' || Array.isArray(data.entries)) {
    const playlists = data.entries || [];
    addLog(`${playlists.length} playlists détectées pour la chaîne ${channel.title}. Importation en cours...`);

    const insertPlaylist = db.prepare(`
      INSERT INTO playlists (id, title, description, channel_id, thumbnail_url, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        thumbnail_url = COALESCE(excluded.thumbnail_url, thumbnail_url)
    `);

    const clearPlaylistVideos = db.prepare(`DELETE FROM playlist_videos WHERE playlist_id = ?`);
    const insertPlaylistVideo = db.prepare(`
      INSERT INTO playlist_videos (playlist_id, video_id, position)
      VALUES (?, ?, ?)
      ON CONFLICT DO NOTHING
    `);

    for (const pl of playlists) {
      if (!pl.id) continue;
      const plTitle = pl.title || `Playlist ${pl.id}`;
      const plThumb = pl.thumbnails && pl.thumbnails.length > 0 ? pl.thumbnails[pl.thumbnails.length - 1].url : null;

      // Fetch videos inside the playlist first
      const plUrl = `https://www.youtube.com/playlist?list=${pl.id}`;
      const plArgs = ['--dump-single-json', '--flat-playlist', plUrl];
      
      try {
        const plChild = await runProcessAsync(ytdlPath, plArgs, env);
        if (plChild.status === 0) {
          const plData = JSON.parse(plChild.stdout);
          const entries = plData.entries || [];

          // Collect completed videos to link
          const completedEntries = [];
          for (const entry of entries) {
            if (!entry.id) continue;
            const exists = db.prepare("SELECT 1 FROM videos WHERE id = ? AND download_status = 'completed'").get(entry.id);
            if (exists) {
              completedEntries.push(entry);
            }
          }

          if (completedEntries.length > 0) {
            // ONLY insert the playlist if there is at least one archived video!
            insertPlaylist.run(pl.id, plTitle, pl.description || '', channelId, plThumb, Date.now());

            // Clear existing playlist videos before inserting new list to refresh order/contents
            clearPlaylistVideos.run(pl.id);

            let pos = 1;
            for (const entry of completedEntries) {
              insertPlaylistVideo.run(pl.id, entry.id, pos++);
            }
            addLog(`Playlist "${plTitle}" synchronisée : ${completedEntries.length} vidéos archivées liées.`);
          } else {
            // Delete playlist if it exists from a previous run but is now empty
            db.prepare("DELETE FROM playlists WHERE id = ?").run(pl.id);
          }
        }
      } catch (err: any) {
        addLog(`Erreur lors de la synchronisation de la playlist ${plTitle} (${pl.id}) : ${err.message || err}`);
      }
    }
  }
}
