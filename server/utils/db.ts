import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';

let dbInstance: Database.Database | null = null;

export function getDb(): Database.Database {
  if (dbInstance) return dbInstance;

  const dataDir = path.resolve(process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const dbPath = path.join(dataDir, 'myteub.db');
  const db = new Database(dbPath);
  
  // Enable foreign keys
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'user')),
      must_change_password INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS channels (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      avatar_url TEXT,
      banner_url TEXT,
      download_videos INTEGER DEFAULT 1,
      download_shorts INTEGER DEFAULT 0,
      download_lives INTEGER DEFAULT 0,
      date_after TEXT,
      sync_status TEXT DEFAULT 'paused',
      visibility TEXT DEFAULT 'public',
      custom_save_path TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS personal_playlists (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      user_id TEXT NOT NULL,
      visibility TEXT DEFAULT 'private' CHECK(visibility IN ('public', 'unlisted', 'private')),
      share_token TEXT UNIQUE,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS personal_playlist_videos (
      playlist_id TEXT NOT NULL,
      video_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      PRIMARY KEY (playlist_id, video_id),
      FOREIGN KEY (playlist_id) REFERENCES personal_playlists(id) ON DELETE CASCADE,
      FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS videos (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      channel_id TEXT NOT NULL,
      upload_date TEXT,
      duration INTEGER,
      view_count INTEGER,
      local_video_path TEXT,
      local_thumbnail_path TEXT,
      download_status TEXT NOT NULL CHECK(download_status IN ('pending', 'downloading', 'completed', 'failed')),
      download_progress INTEGER DEFAULT 0,
      download_speed TEXT,
      download_eta TEXT,
      size_bytes INTEGER,
      priority INTEGER DEFAULT 0,
      visibility TEXT DEFAULT 'public',
      share_token TEXT UNIQUE,
      is_manually_queued INTEGER DEFAULT 0,
      is_short INTEGER DEFAULT 0,
      like_count INTEGER DEFAULT 0,
      last_error TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS user_channel_access (
      user_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      PRIMARY KEY (user_id, channel_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_subscriptions (
      user_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, channel_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      author TEXT NOT NULL,
      author_thumbnail TEXT,
      text TEXT NOT NULL,
      time_text TEXT,
      like_count INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS user_history (
      user_id TEXT NOT NULL,
      video_id TEXT NOT NULL,
      watched_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, video_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS user_hidden_videos (
      user_id TEXT NOT NULL,
      video_id TEXT NOT NULL,
      hidden_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, video_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      user_id TEXT,
      reason TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS playlists (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      channel_id TEXT NOT NULL,
      thumbnail_url TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS playlist_videos (
      playlist_id TEXT NOT NULL,
      video_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      PRIMARY KEY (playlist_id, video_id),
      FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
      FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE
    );
  `);

  // Run schema updates if columns are missing (database migration)
  try { db.exec(`ALTER TABLE channels ADD COLUMN download_videos INTEGER DEFAULT 1;`); } catch (e) {}
  try { db.exec(`ALTER TABLE channels ADD COLUMN download_shorts INTEGER DEFAULT 0;`); } catch (e) {}
  try { db.exec(`ALTER TABLE channels ADD COLUMN download_lives INTEGER DEFAULT 0;`); } catch (e) {}
  try { db.exec(`ALTER TABLE channels ADD COLUMN date_after TEXT;`); } catch (e) {}
  try { db.exec(`ALTER TABLE channels ADD COLUMN sync_status TEXT DEFAULT 'paused';`); } catch (e) {}
  try { db.exec(`ALTER TABLE videos ADD COLUMN priority INTEGER DEFAULT 0;`); } catch (e) {}
  try { db.exec(`ALTER TABLE channels ADD COLUMN visibility TEXT DEFAULT 'public';`); } catch (e) {}
  try { db.exec(`ALTER TABLE videos ADD COLUMN visibility TEXT DEFAULT 'public';`); } catch (e) {}
  try { db.exec(`ALTER TABLE videos ADD COLUMN share_token TEXT;`); } catch (e) {}
  try { db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_videos_share_token ON videos(share_token);`); } catch (e) {}
  try { db.exec(`ALTER TABLE videos ADD COLUMN is_manually_queued INTEGER DEFAULT 0;`); } catch (e) {}
  try { db.exec(`ALTER TABLE users ADD COLUMN must_change_password INTEGER DEFAULT 0;`); } catch (e) {}
  try { db.exec(`ALTER TABLE channels ADD COLUMN custom_save_path TEXT;`); } catch (e) {}
  try { db.exec(`ALTER TABLE videos ADD COLUMN is_short INTEGER DEFAULT 0;`); } catch (e) {}
  try { db.exec(`ALTER TABLE videos ADD COLUMN like_count INTEGER DEFAULT 0;`); } catch (e) {}
  try { db.exec(`ALTER TABLE videos ADD COLUMN last_error TEXT;`); } catch (e) {}
  try { db.exec(`ALTER TABLE user_history ADD COLUMN watch_time_seconds INTEGER DEFAULT 0;`); } catch (e) {}


  // Setup FTS5 Virtual Table for Search (if not exists)
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS videos_fts USING fts5(
        id UNINDEXED,
        title,
        description,
        channel_title,
        tokenize='porter'
      );
    `);

    // Create triggers to keep FTS table in sync with videos table
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS videos_ai AFTER INSERT ON videos BEGIN
        INSERT INTO videos_fts(rowid, id, title, description, channel_title)
        VALUES (
          new.rowid, 
          new.id, 
          new.title, 
          new.description, 
          (SELECT title FROM channels WHERE id = new.channel_id)
        );
      END;

      CREATE TRIGGER IF NOT EXISTS videos_ad AFTER DELETE ON videos BEGIN
        DELETE FROM videos_fts WHERE rowid = old.rowid;
      END;

      CREATE TRIGGER IF NOT EXISTS videos_au AFTER UPDATE ON videos BEGIN
        DELETE FROM videos_fts WHERE rowid = old.rowid;
        
        INSERT INTO videos_fts(rowid, id, title, description, channel_title)
        VALUES (
          new.rowid, 
          new.id, 
          new.title, 
          new.description, 
          (SELECT title FROM channels WHERE id = new.channel_id)
        );
      END;
    `);
  } catch (err) {
    console.error('FTS5 virtual table initialization warning (ensure your SQLite build supports FTS5):', err);
  }

  // Seed settings if missing
  const settingsCheck = db.prepare("SELECT COUNT(*) as count FROM settings WHERE key = 'downloader_paused'").get() as { count: number };
  if (settingsCheck.count === 0) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('downloader_paused', '0')").run();
    console.log('Seeded setting downloader_paused: 0');
  }

  const syncAllCheck = db.prepare("SELECT COUNT(*) as count FROM settings WHERE key = 'sync_all_active'").get() as { count: number };
  if (syncAllCheck.count === 0) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('sync_all_active', '0')").run();
    console.log('Seeded setting sync_all_active: 0');
  }

  const cronEnabledCheck = db.prepare("SELECT COUNT(*) as count FROM settings WHERE key = 'sync_cron_enabled'").get() as { count: number };
  if (cronEnabledCheck.count === 0) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('sync_cron_enabled', '0')").run();
    console.log('Seeded setting sync_cron_enabled: 0');
  }

  const cronScheduleCheck = db.prepare("SELECT COUNT(*) as count FROM settings WHERE key = 'sync_cron_schedule'").get() as { count: number };
  if (cronScheduleCheck.count === 0) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('sync_cron_schedule', '0 3 * * *')").run();
    console.log('Seeded setting sync_cron_schedule: 0 3 * * *');
  }

  const defaultDirCheck = db.prepare("SELECT COUNT(*) as count FROM settings WHERE key = 'default_downloads_dir'").get() as { count: number };
  if (defaultDirCheck.count === 0) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('default_downloads_dir', '')").run();
    console.log('Seeded setting default_downloads_dir: empty');
  }

  // Backfill size_bytes for completed videos if null
  try {
    const completedVideos = db.prepare("SELECT id, channel_id FROM videos WHERE download_status = 'completed' AND size_bytes IS NULL").all() as any[];
    if (completedVideos.length > 0) {
      const updateSize = db.prepare("UPDATE videos SET size_bytes = ? WHERE id = ?");
      db.transaction((videos) => {
        for (const v of videos) {
          const mp4Path = path.resolve(process.cwd(), 'data/downloads', v.channel_id, `${v.id}.mp4`);
          if (fs.existsSync(mp4Path)) {
            const size = fs.statSync(mp4Path).size;
            updateSize.run(size, v.id);
          }
        }
      })(completedVideos);
      console.log(`[Database] Backfilled size_bytes for ${completedVideos.length} completed videos.`);
    }
  } catch (err) {
    console.error('[Database] Failed to backfill video sizes:', err);
  }

  dbInstance = db;
  return db;
}
