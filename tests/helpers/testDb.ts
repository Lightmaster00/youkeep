import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Every test database's default downloads folder: a temporary folder, so code
 * that falls back to the default downloads folder (getDownloadsDir,
 * resolveChannelBaseDir) can never point at the developer's real media.
 */
export const TEST_DOWNLOADS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'yk-test-downloads-'));
process.on('exit', () => {
  try { fs.rmSync(TEST_DOWNLOADS_DIR, { recursive: true, force: true }); } catch {}
});

/** Throws unless `p` is inside the system temporary folder (tests must never touch real files). */
export function assertInTmp(p: string): void {
  const tmp = fs.realpathSync(os.tmpdir());
  let probe = path.resolve(p);
  while (!fs.existsSync(probe) && path.dirname(probe) !== probe) probe = path.dirname(probe);
  const real = fs.realpathSync(probe);
  if (real !== tmp && !real.startsWith(tmp + path.sep)) throw new Error(`Test path outside the temporary folder: ${p}`);
}

// Minimal schema mirroring server/utils/db.ts — only the tables/columns the
// access-control logic under test actually touches.
export function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'user')),
      must_change_password INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE api_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      label TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL,
      last_used_at INTEGER,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE user_preferences (
      user_id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE channels (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      visibility TEXT DEFAULT 'public',
      avatar_url TEXT,
      custom_save_path TEXT,
      sync_status TEXT DEFAULT 'paused',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE videos (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      channel_id TEXT NOT NULL,
      visibility TEXT DEFAULT 'public',
      share_token TEXT,
      download_status TEXT DEFAULT 'completed',
      upload_date TEXT,
      duration INTEGER,
      view_count INTEGER DEFAULT 0,
      is_short INTEGER DEFAULT 0,
      was_live INTEGER DEFAULT 0,
      download_progress INTEGER DEFAULT 0,
      download_speed TEXT,
      download_eta TEXT,
      retry_count INTEGER DEFAULT 0,
      last_error TEXT,
      priority INTEGER DEFAULT 0,
      is_manually_queued INTEGER DEFAULT 0,
      local_video_path TEXT,
      local_thumbnail_path TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE
    );

    CREATE TABLE user_channel_access (
      user_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      PRIMARY KEY (user_id, channel_id)
    );

    CREATE TABLE user_history (
      user_id TEXT NOT NULL,
      video_id TEXT NOT NULL,
      watched_at INTEGER NOT NULL,
      watch_time_seconds INTEGER DEFAULT 0,
      PRIMARY KEY (user_id, video_id)
    );

    CREATE TABLE user_hidden_videos (
      user_id TEXT NOT NULL,
      video_id TEXT NOT NULL,
      hidden_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, video_id)
    );

    CREATE TABLE user_subscriptions (
      user_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, channel_id)
    );

    CREATE TABLE music_artists (
      id TEXT PRIMARY KEY,
      channel_id TEXT UNIQUE,
      name TEXT NOT NULL,
      description TEXT,
      avatar_url TEXT,
      banner_url TEXT,
      sync_status TEXT DEFAULT 'paused',
      visibility TEXT DEFAULT 'public',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE music_albums (
      id TEXT PRIMARY KEY,
      artist_id TEXT NOT NULL,
      title TEXT NOT NULL,
      release_year INTEGER,
      cover_url TEXT,
      source TEXT NOT NULL DEFAULT 'youtube',
      created_at INTEGER NOT NULL,
      FOREIGN KEY (artist_id) REFERENCES music_artists(id) ON DELETE CASCADE
    );

    CREATE TABLE music_tracks (
      id TEXT PRIMARY KEY,
      artist_id TEXT NOT NULL,
      album_id TEXT,
      title TEXT NOT NULL,
      track_number INTEGER,
      genre TEXT,
      language TEXT,
      duration INTEGER,
      download_status TEXT DEFAULT 'completed',
      download_progress INTEGER DEFAULT 0,
      download_speed TEXT,
      download_eta TEXT,
      local_file_path TEXT,
      local_thumbnail_path TEXT,
      has_clip INTEGER DEFAULT 0,
      retry_count INTEGER DEFAULT 0,
      last_error TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (artist_id) REFERENCES music_artists(id) ON DELETE CASCADE,
      FOREIGN KEY (album_id) REFERENCES music_albums(id) ON DELETE SET NULL
    );

    CREATE TABLE music_play_history (
      id TEXT PRIMARY KEY,
      track_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      played_at INTEGER NOT NULL,
      FOREIGN KEY (track_id) REFERENCES music_tracks(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE podcast_shows (
      id TEXT PRIMARY KEY,
      feed_url TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      author TEXT,
      cover_url TEXT,
      language TEXT,
      sync_status TEXT DEFAULT 'paused',
      visibility TEXT DEFAULT 'public',
      last_checked_at INTEGER,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE podcast_episodes (
      id TEXT PRIMARY KEY,
      show_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      audio_url TEXT NOT NULL,
      local_file_path TEXT,
      local_thumbnail_path TEXT,
      duration INTEGER,
      episode_number INTEGER,
      season_number INTEGER,
      pub_date TEXT,
      download_status TEXT DEFAULT 'pending',
      download_progress INTEGER DEFAULT 0,
      download_speed TEXT,
      download_eta TEXT,
      retry_count INTEGER DEFAULT 0,
      last_error TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (show_id) REFERENCES podcast_shows(id) ON DELETE CASCADE
    );
  `);

  db.prepare("INSERT INTO settings (key, value) VALUES ('default_downloads_dir', ?)").run(TEST_DOWNLOADS_DIR);
  return db;
}

export function insertUser(db: Database.Database, opts: { id: string; role: 'admin' | 'user' }) {
  db.prepare(`
    INSERT INTO users (id, username, password_hash, role, created_at)
    VALUES (?, ?, 'x', ?, ?)
  `).run(opts.id, `user_${opts.id}`, opts.role, Date.now());
}

export function insertSession(db: Database.Database, opts: { id: string; userId: string; expiresAt?: number }) {
  db.prepare(`
    INSERT INTO sessions (id, user_id, expires_at)
    VALUES (?, ?, ?)
  `).run(opts.id, opts.userId, opts.expiresAt ?? Date.now() + 1000 * 60 * 60);
}

export function insertApiToken(db: Database.Database, opts: { id: string; userId: string; label?: string; tokenHash: string; createdAt?: number; lastUsedAt?: number | null }) {
  db.prepare(`
    INSERT INTO api_tokens (id, user_id, label, token_hash, created_at, last_used_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(opts.id, opts.userId, opts.label ?? `Token ${opts.id}`, opts.tokenHash, opts.createdAt ?? Date.now(), opts.lastUsedAt ?? null);
}

export function insertUserPreferences(db: Database.Database, opts: { userId: string; data: string; updatedAt?: number }) {
  db.prepare(`
    INSERT INTO user_preferences (user_id, data, updated_at)
    VALUES (?, ?, ?)
  `).run(opts.userId, opts.data, opts.updatedAt ?? Date.now());
}

export function insertChannel(db: Database.Database, opts: { id: string; visibility?: string; title?: string; customSavePath?: string | null }) {
  db.prepare(`
    INSERT INTO channels (id, title, visibility, custom_save_path, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(opts.id, opts.title ?? `Channel ${opts.id}`, opts.visibility ?? 'public', opts.customSavePath ?? null, Date.now());
}

export function insertVideo(db: Database.Database, opts: {
  id: string;
  channelId: string;
  title?: string;
  visibility?: string;
  shareToken?: string | null;
  downloadStatus?: string;
  uploadDate?: string | null;
  duration?: number | null;
  viewCount?: number;
  isShort?: boolean;
  localVideoPath?: string | null;
  localThumbnailPath?: string | null;
  createdAt?: number;
}) {
  db.prepare(`
    INSERT INTO videos (id, title, description, channel_id, visibility, share_token, download_status, upload_date, duration, view_count, is_short, local_video_path, local_thumbnail_path, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    opts.id,
    opts.title ?? `Video ${opts.id}`,
    null,
    opts.channelId,
    opts.visibility ?? 'public',
    opts.shareToken ?? null,
    opts.downloadStatus ?? 'completed',
    opts.uploadDate ?? null,
    opts.duration ?? null,
    opts.viewCount ?? 0,
    opts.isShort ? 1 : 0,
    opts.localVideoPath ?? null,
    opts.localThumbnailPath ?? null,
    opts.createdAt ?? Date.now()
  );
}

export function grantChannelAccess(db: Database.Database, userId: string, channelId: string) {
  db.prepare('INSERT INTO user_channel_access (user_id, channel_id) VALUES (?, ?)').run(userId, channelId);
}

// Minimal H3Event stand-in: covers exactly what getUserFromSession/getCookie/
// setCookie/deleteCookie touch (event.node.req.headers.cookie, event.node.res.*).
export function mockEvent(cookieHeader?: string, opts?: { path?: string; params?: Record<string, string>; body?: any; headers?: Record<string, string>; method?: string }): any {
  const req: any = {
    method: opts?.method ?? 'GET',
    headers: { cookie: cookieHeader || '', ...(opts?.headers ?? {}) }
  };
  if (opts && Object.prototype.hasOwnProperty.call(opts, 'body')) {
    // H3's readBody(event) checks for a value already stored under this
    // well-known symbol before attempting to read/parse a raw request
    // stream — setting it directly lets tests supply a body without
    // simulating an actual HTTP request stream. Symbol.for is a global
    // registry lookup, so this matches h3's own internal ParsedBodySymbol
    // even though it isn't exported from the package.
    req[Symbol.for('h3ParsedBody')] = opts.body;
  }
  const resHeaders: Record<string, any> = {};
  return {
    method: opts?.method ?? 'GET',
    path: opts?.path ?? '/',
    context: { params: opts?.params ?? {} },
    node: {
      req,
      res: {
        statusCode: 200,
        headers: resHeaders,
        getHeader: (name: string) => resHeaders[name.toLowerCase()],
        setHeader: (name: string, value: any) => { resHeaders[name.toLowerCase()] = value; },
        // h3's setCookie() calls these on every SECOND (and later) cookie set
        // in the same request/response cycle — createSession() now sets two
        // cookies (session + csrf_token), so both must be supported here.
        removeHeader: (name: string) => { delete resHeaders[name.toLowerCase()]; },
        appendHeader: (name: string, value: any) => {
          const key = name.toLowerCase();
          const existing = resHeaders[key];
          if (existing === undefined) {
            resHeaders[key] = value;
          } else if (Array.isArray(existing)) {
            existing.push(value);
          } else {
            resHeaders[key] = [existing, value];
          }
        }
      }
    }
  };
}

export function sessionCookie(sessionId: string): string {
  return `youkeep_session=${sessionId}`;
}

export function insertUserHistory(db: Database.Database, opts: { userId: string; videoId: string; watchTimeSeconds?: number; watchedAt?: number }) {
  db.prepare(`
    INSERT INTO user_history (user_id, video_id, watched_at, watch_time_seconds)
    VALUES (?, ?, ?, ?)
  `).run(opts.userId, opts.videoId, opts.watchedAt ?? Date.now(), opts.watchTimeSeconds ?? 0);
}

export function insertHiddenVideo(db: Database.Database, opts: { userId: string; videoId: string }) {
  db.prepare(`
    INSERT INTO user_hidden_videos (user_id, video_id, hidden_at)
    VALUES (?, ?, ?)
  `).run(opts.userId, opts.videoId, Date.now());
}

export function insertSubscription(db: Database.Database, opts: { userId: string; channelId: string }) {
  db.prepare(`
    INSERT INTO user_subscriptions (user_id, channel_id, created_at)
    VALUES (?, ?, ?)
  `).run(opts.userId, opts.channelId, Date.now());
}

export function insertMusicArtist(db: Database.Database, opts: { id: string; name?: string; visibility?: string }) {
  db.prepare(`
    INSERT INTO music_artists (id, name, visibility, created_at)
    VALUES (?, ?, ?, ?)
  `).run(opts.id, opts.name ?? `Artist ${opts.id}`, opts.visibility ?? 'public', Date.now());
}

export function insertMusicAlbum(db: Database.Database, opts: {
  id: string;
  artistId: string;
  title?: string;
  releaseYear?: number | null;
  source?: string;
  createdAt?: number;
}) {
  db.prepare(`
    INSERT INTO music_albums (id, artist_id, title, release_year, source, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    opts.id,
    opts.artistId,
    opts.title ?? `Album ${opts.id}`,
    opts.releaseYear ?? null,
    opts.source ?? 'youtube',
    opts.createdAt ?? Date.now()
  );
}

export function insertMusicTrack(db: Database.Database, opts: {
  id: string;
  artistId: string;
  albumId?: string | null;
  trackNumber?: number | null;
  genre?: string | null;
  language?: string | null;
  duration?: number | null;
  downloadStatus?: string;
  localFilePath?: string | null;
  localThumbnailPath?: string | null;
  hasClip?: boolean;
  createdAt?: number;
}) {
  db.prepare(`
    INSERT INTO music_tracks (id, artist_id, album_id, title, track_number, genre, language, duration, download_status, local_file_path, local_thumbnail_path, has_clip, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    opts.id,
    opts.artistId,
    opts.albumId ?? null,
    `Track ${opts.id}`,
    opts.trackNumber ?? null,
    opts.genre ?? null,
    opts.language ?? null,
    opts.duration ?? null,
    opts.downloadStatus ?? 'completed',
    opts.localFilePath ?? null,
    opts.localThumbnailPath ?? null,
    opts.hasClip ? 1 : 0,
    opts.createdAt ?? Date.now()
  );
}

export function insertMusicPlay(db: Database.Database, opts: { id: string; trackId: string; userId: string; playedAt?: number }) {
  db.prepare(`
    INSERT INTO music_play_history (id, track_id, user_id, played_at)
    VALUES (?, ?, ?, ?)
  `).run(opts.id, opts.trackId, opts.userId, opts.playedAt ?? Date.now());
}

export function insertPodcastShow(db: Database.Database, opts: {
  id: string;
  feedUrl?: string;
  title?: string;
  syncStatus?: string;
  visibility?: string;
}) {
  db.prepare(`
    INSERT INTO podcast_shows (id, feed_url, title, sync_status, visibility, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    opts.id,
    opts.feedUrl ?? `https://example.com/feeds/${opts.id}.xml`,
    opts.title ?? `Show ${opts.id}`,
    opts.syncStatus ?? 'paused',
    opts.visibility ?? 'public',
    Date.now()
  );
}

export function insertPodcastEpisode(db: Database.Database, opts: {
  id: string;
  showId: string;
  title?: string;
  audioUrl?: string;
  downloadStatus?: string;
  localFilePath?: string | null;
  createdAt?: number;
}) {
  db.prepare(`
    INSERT INTO podcast_episodes (id, show_id, title, audio_url, download_status, local_file_path, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    opts.id,
    opts.showId,
    opts.title ?? `Episode ${opts.id}`,
    opts.audioUrl ?? `https://example.com/audio/${opts.id}.mp3`,
    opts.downloadStatus ?? 'completed',
    opts.localFilePath ?? null,
    opts.createdAt ?? Date.now()
  );
}

export function insertSetting(db: Database.Database, opts: { key: string; value: string }) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(opts.key, opts.value);
}
