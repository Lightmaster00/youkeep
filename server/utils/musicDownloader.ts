import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getDb } from './db';
import { getYtdlPath, buildSpawnEnv, runProcessAsync, addLog, sanitizeFolderName, isDirWritable } from './downloader';

export function getMusicDownloadsDir(): string {
  const defaultPath = '/downloads/music';
  if (isDirWritable(defaultPath)) {
    return defaultPath;
  }

  const localFallback = path.resolve(process.cwd(), 'data/downloads-music');
  try { fs.mkdirSync(localFallback, { recursive: true }); } catch (err) {}
  return localFallback;
}

export function cleanupPartialMusicFiles(trackId: string, artistId: string): void {
  const db = getDb();
  const artist = db.prepare('SELECT name FROM music_artists WHERE id = ?').get(artistId) as { name: string } | undefined;
  const basePath = getMusicDownloadsDir();
  const artistDir = path.join(basePath, sanitizeFolderName(artist?.name || artistId));

  const audioExtensions = ['m4a', 'opus', 'webm', 'mp3', 'ogg', 'wav'];
  const filesToRemove = [
    ...audioExtensions.map(ext => path.join(artistDir, `${trackId}.${ext}`)),
    path.join(artistDir, `${trackId}.jpg`),
    path.join(artistDir, `${trackId}.mp4.part`),
    path.join(artistDir, `${trackId}.mp4.ytdl`),
  ];

  filesToRemove.forEach(f => {
    if (fs.existsSync(f)) {
      try { fs.unlinkSync(f); } catch (e) {}
    }
  });
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
  } else {
    artistId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO music_artists (id, channel_id, name, sync_status, visibility, created_at)
      VALUES (?, ?, ?, 'paused', 'public', ?)
    `).run(artistId, channelId, channelTitle, Date.now());
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
