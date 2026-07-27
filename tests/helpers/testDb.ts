import Database from 'better-sqlite3';

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

    CREATE TABLE channels (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      visibility TEXT DEFAULT 'public',
      avatar_url TEXT,
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
      name TEXT NOT NULL,
      visibility TEXT DEFAULT 'public',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE music_tracks (
      id TEXT PRIMARY KEY,
      artist_id TEXT NOT NULL,
      title TEXT NOT NULL,
      local_thumbnail_path TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (artist_id) REFERENCES music_artists(id) ON DELETE CASCADE
    );
  `);

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

export function insertChannel(db: Database.Database, opts: { id: string; visibility?: string }) {
  db.prepare(`
    INSERT INTO channels (id, title, visibility, created_at)
    VALUES (?, ?, ?, ?)
  `).run(opts.id, `Channel ${opts.id}`, opts.visibility ?? 'public', Date.now());
}

export function insertVideo(db: Database.Database, opts: {
  id: string;
  channelId: string;
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
    `Video ${opts.id}`,
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
// deleteCookie touch (event.node.req.headers.cookie, event.node.res.*).
export function mockEvent(cookieHeader?: string): any {
  return {
    node: {
      req: { headers: { cookie: cookieHeader || '' } },
      res: {
        getHeader: () => undefined,
        setHeader: () => {}
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

export function insertMusicArtist(db: Database.Database, opts: { id: string; visibility?: string }) {
  db.prepare(`
    INSERT INTO music_artists (id, name, visibility, created_at)
    VALUES (?, ?, ?, ?)
  `).run(opts.id, `Artist ${opts.id}`, opts.visibility ?? 'public', Date.now());
}

export function insertMusicTrack(db: Database.Database, opts: {
  id: string;
  artistId: string;
  localThumbnailPath?: string | null;
  createdAt?: number;
}) {
  db.prepare(`
    INSERT INTO music_tracks (id, artist_id, title, local_thumbnail_path, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    opts.id,
    opts.artistId,
    `Track ${opts.id}`,
    opts.localThumbnailPath ?? null,
    opts.createdAt ?? Date.now()
  );
}
