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

  const dbPath = path.join(dataDir, 'youkeep.db');
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

    CREATE TABLE IF NOT EXISTS video_chapters (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      start_time REAL NOT NULL,
      title TEXT NOT NULL,
      source TEXT NOT NULL CHECK(source IN ('youtube', 'sponsorblock')),
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

    CREATE TABLE IF NOT EXISTS music_artists (
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

    CREATE TABLE IF NOT EXISTS music_albums (
      id TEXT PRIMARY KEY,
      artist_id TEXT NOT NULL,
      title TEXT NOT NULL,
      release_year INTEGER,
      cover_url TEXT,
      source TEXT NOT NULL CHECK(source IN ('youtube', 'manual')),
      created_at INTEGER NOT NULL,
      FOREIGN KEY (artist_id) REFERENCES music_artists(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS music_tracks (
      id TEXT PRIMARY KEY,
      artist_id TEXT NOT NULL,
      album_id TEXT,
      title TEXT NOT NULL,
      track_number INTEGER,
      genre TEXT,
      language TEXT,
      duration INTEGER,
      view_count INTEGER,
      upload_date TEXT,
      download_status TEXT DEFAULT 'pending',
      download_progress INTEGER DEFAULT 0,
      download_speed TEXT,
      download_eta TEXT,
      last_error TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (artist_id) REFERENCES music_artists(id) ON DELETE CASCADE,
      FOREIGN KEY (album_id) REFERENCES music_albums(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS music_track_artists (
      track_id TEXT NOT NULL,
      artist_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('primary', 'feat')),
      PRIMARY KEY (track_id, artist_id),
      FOREIGN KEY (track_id) REFERENCES music_tracks(id) ON DELETE CASCADE,
      FOREIGN KEY (artist_id) REFERENCES music_artists(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS music_play_history (
      id TEXT PRIMARY KEY,
      track_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      played_at INTEGER NOT NULL,
      FOREIGN KEY (track_id) REFERENCES music_tracks(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS podcast_shows (
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

    CREATE TABLE IF NOT EXISTS podcast_episodes (
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
      last_error TEXT,
      share_token TEXT UNIQUE,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (show_id) REFERENCES podcast_shows(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS search_platforms (
      id TEXT PRIMARY KEY,
      api_key TEXT NOT NULL DEFAULT '',
      api_secret TEXT NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL
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
  try { db.exec(`ALTER TABLE users ADD COLUMN first_name TEXT;`); } catch (e) {}
  try { db.exec(`ALTER TABLE users ADD COLUMN last_name TEXT;`); } catch (e) {}
  try { db.exec(`ALTER TABLE users ADD COLUMN email TEXT;`); } catch (e) {}
  try { db.exec(`ALTER TABLE users ADD COLUMN phone TEXT;`); } catch (e) {}
  try { db.exec(`ALTER TABLE users ADD COLUMN dob TEXT;`); } catch (e) {}
  try { db.exec(`ALTER TABLE channels ADD COLUMN custom_save_path TEXT;`); } catch (e) {}
  try { db.exec(`ALTER TABLE videos ADD COLUMN is_short INTEGER DEFAULT 0;`); } catch (e) {}
  try { db.exec(`ALTER TABLE videos ADD COLUMN like_count INTEGER DEFAULT 0;`); } catch (e) {}
  try { db.exec(`ALTER TABLE videos ADD COLUMN last_error TEXT;`); } catch (e) {}
  try { db.exec(`ALTER TABLE videos ADD COLUMN was_live INTEGER DEFAULT 0;`); } catch (e) {}
  try { db.exec(`ALTER TABLE user_history ADD COLUMN watch_time_seconds INTEGER DEFAULT 0;`); } catch (e) {}
  try { db.exec(`ALTER TABLE music_tracks ADD COLUMN local_file_path TEXT;`); } catch (e) {}
  try { db.exec(`ALTER TABLE music_tracks ADD COLUMN local_thumbnail_path TEXT;`); } catch (e) {}
  try { db.exec(`ALTER TABLE music_tracks ADD COLUMN size_bytes INTEGER;`); } catch (e) {}
  try { db.exec(`ALTER TABLE music_tracks ADD COLUMN has_clip INTEGER DEFAULT 0;`); } catch (e) {}
  try { db.exec(`ALTER TABLE videos ADD COLUMN retry_count INTEGER DEFAULT 0;`); } catch (e) {}
  try { db.exec(`ALTER TABLE music_tracks ADD COLUMN retry_count INTEGER DEFAULT 0;`); } catch (e) {}
  try { db.exec(`ALTER TABLE podcast_episodes ADD COLUMN retry_count INTEGER DEFAULT 0;`); } catch (e) {}

  // Indexes on frequently filtered/joined columns that lack one (primary keys
  // and the FTS/share_token indexes above already cover the rest).
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_videos_channel_id ON videos(channel_id);
    CREATE INDEX IF NOT EXISTS idx_videos_download_status ON videos(download_status);
    CREATE INDEX IF NOT EXISTS idx_videos_visibility ON videos(visibility);
    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_history_user_id ON user_history(user_id);
    CREATE INDEX IF NOT EXISTS idx_personal_playlist_videos_playlist_id ON personal_playlist_videos(playlist_id);
    CREATE INDEX IF NOT EXISTS idx_music_play_history_user_track ON music_play_history(user_id, track_id);
    CREATE INDEX IF NOT EXISTS idx_music_tracks_artist_id ON music_tracks(artist_id);
    CREATE INDEX IF NOT EXISTS idx_music_tracks_album_id ON music_tracks(album_id);
    CREATE INDEX IF NOT EXISTS idx_comments_video_id ON comments(video_id);
    CREATE INDEX IF NOT EXISTS idx_video_chapters_video_id ON video_chapters(video_id);
    CREATE INDEX IF NOT EXISTS idx_podcast_episodes_show_id ON podcast_episodes(show_id);
  `);

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

    // Backfill any missing entries in FTS index
    db.exec(`
      INSERT INTO videos_fts(rowid, id, title, description, channel_title)
      SELECT rowid, id, title, description, (SELECT title FROM channels WHERE id = channel_id)
      FROM videos
      WHERE rowid NOT IN (SELECT rowid FROM videos_fts);
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

  const musicSyncAllCheck = db.prepare("SELECT COUNT(*) as count FROM settings WHERE key = 'music_sync_all_active'").get() as { count: number };
  if (musicSyncAllCheck.count === 0) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('music_sync_all_active', '0')").run();
    console.log('Seeded setting music_sync_all_active: 0');
  }

  const musicCronEnabledCheck = db.prepare("SELECT COUNT(*) as count FROM settings WHERE key = 'music_sync_cron_enabled'").get() as { count: number };
  if (musicCronEnabledCheck.count === 0) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('music_sync_cron_enabled', '0')").run();
    console.log('Seeded setting music_sync_cron_enabled: 0');
  }

  const musicCronScheduleCheck = db.prepare("SELECT COUNT(*) as count FROM settings WHERE key = 'music_sync_cron_schedule'").get() as { count: number };
  if (musicCronScheduleCheck.count === 0) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('music_sync_cron_schedule', '30 3 * * *')").run();
    console.log('Seeded setting music_sync_cron_schedule: 30 3 * * *');
  }

  const podcastSyncAllCheck = db.prepare("SELECT COUNT(*) as count FROM settings WHERE key = 'podcast_sync_all_active'").get() as { count: number };
  if (podcastSyncAllCheck.count === 0) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('podcast_sync_all_active', '0')").run();
    console.log('Seeded setting podcast_sync_all_active: 0');
  }

  const podcastCronEnabledCheck = db.prepare("SELECT COUNT(*) as count FROM settings WHERE key = 'podcast_sync_cron_enabled'").get() as { count: number };
  if (podcastCronEnabledCheck.count === 0) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('podcast_sync_cron_enabled', '0')").run();
    console.log('Seeded setting podcast_sync_cron_enabled: 0');
  }

  const podcastCronScheduleCheck = db.prepare("SELECT COUNT(*) as count FROM settings WHERE key = 'podcast_sync_cron_schedule'").get() as { count: number };
  if (podcastCronScheduleCheck.count === 0) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('podcast_sync_cron_schedule', '0 4 * * *')").run();
    console.log('Seeded setting podcast_sync_cron_schedule: 0 4 * * *');
  }

  const defaultDirCheck = db.prepare("SELECT COUNT(*) as count FROM settings WHERE key = 'default_downloads_dir'").get() as { count: number };
  if (defaultDirCheck.count === 0) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('default_downloads_dir', '')").run();
    console.log('Seeded setting default_downloads_dir: empty');
  }

  const podcastIndexKeyCheck = db.prepare("SELECT COUNT(*) as count FROM settings WHERE key = 'podcastindex_api_key'").get() as { count: number };
  if (podcastIndexKeyCheck.count === 0) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('podcastindex_api_key', '')").run();
  }

  const podcastIndexSecretCheck = db.prepare("SELECT COUNT(*) as count FROM settings WHERE key = 'podcastindex_api_secret'").get() as { count: number };
  if (podcastIndexSecretCheck.count === 0) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('podcastindex_api_secret', '')").run();
  }

  const searchPlatformIds = ['podcastindex', 'listennotes', 'youtube_data_api'];
  for (const platformId of searchPlatformIds) {
    const platformCheck = db.prepare('SELECT COUNT(*) as count FROM search_platforms WHERE id = ?').get(platformId) as { count: number };
    if (platformCheck.count === 0) {
      db.prepare('INSERT INTO search_platforms (id, api_key, api_secret, updated_at) VALUES (?, ?, ?, ?)').run(platformId, '', '', Date.now());
    }
  }

  // One-time migration: carry forward any previously-saved PodcastIndex
  // credentials from the old named settings rows into the new generic
  // search_platforms table. Gated on a dedicated migration-done flag (not
  // on "destination still empty") so it genuinely runs exactly once ever —
  // otherwise clearing the key via the new Search Platforms panel and
  // restarting the server would silently resurrect the old value forever,
  // since nothing writes the old settings rows anymore.
  const migrationFlagRow = db.prepare("SELECT value FROM settings WHERE key = 'search_platforms_migrated'").get() as { value: string } | undefined;
  if (migrationFlagRow?.value !== '1') {
    const oldPodcastIndexKeyRow = db.prepare("SELECT value FROM settings WHERE key = 'podcastindex_api_key'").get() as { value: string } | undefined;
    const oldPodcastIndexSecretRow = db.prepare("SELECT value FROM settings WHERE key = 'podcastindex_api_secret'").get() as { value: string } | undefined;
    if (oldPodcastIndexKeyRow?.value || oldPodcastIndexSecretRow?.value) {
      db.prepare("UPDATE search_platforms SET api_key = ?, api_secret = ?, updated_at = ? WHERE id = 'podcastindex'")
        .run(oldPodcastIndexKeyRow?.value || '', oldPodcastIndexSecretRow?.value || '', Date.now());
    }
    if (migrationFlagRow === undefined) {
      db.prepare("INSERT INTO settings (key, value) VALUES ('search_platforms_migrated', '1')").run();
    } else {
      db.prepare("UPDATE settings SET value = '1' WHERE key = 'search_platforms_migrated'").run();
    }
  }

  const sponsorBlockCategorySeeds = ['sponsor', 'intro', 'outro', 'selfpromo', 'interaction', 'filler'];
  for (const category of sponsorBlockCategorySeeds) {
    const key = `sponsorblock_${category}`;
    const check = db.prepare('SELECT COUNT(*) as count FROM settings WHERE key = ?').get(key) as { count: number };
    if (check.count === 0) {
      db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(key, 'ignore');
      console.log(`Seeded setting ${key}: ignore`);
    }
  }

  const maxConcurrentCheck = db.prepare("SELECT COUNT(*) as count FROM settings WHERE key = 'max_concurrent_downloads'").get() as { count: number };
  if (maxConcurrentCheck.count === 0) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('max_concurrent_downloads', '2')").run();
    console.log('Seeded setting max_concurrent_downloads: 2');
  }

  const musicPausedCheck = db.prepare("SELECT COUNT(*) as count FROM settings WHERE key = 'music_downloader_paused'").get() as { count: number };
  if (musicPausedCheck.count === 0) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('music_downloader_paused', '0')").run();
    console.log('Seeded setting music_downloader_paused: 0');
  }

  const musicMaxConcurrentCheck = db.prepare("SELECT COUNT(*) as count FROM settings WHERE key = 'music_max_concurrent_downloads'").get() as { count: number };
  if (musicMaxConcurrentCheck.count === 0) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('music_max_concurrent_downloads', '2')").run();
    console.log('Seeded setting music_max_concurrent_downloads: 2');
  }

  const podcastPausedCheck = db.prepare("SELECT COUNT(*) as count FROM settings WHERE key = 'podcast_downloader_paused'").get() as { count: number };
  if (podcastPausedCheck.count === 0) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('podcast_downloader_paused', '0')").run();
    console.log('Seeded setting podcast_downloader_paused: 0');
  }

  const podcastMaxConcurrentCheck = db.prepare("SELECT COUNT(*) as count FROM settings WHERE key = 'podcast_max_concurrent_downloads'").get() as { count: number };
  if (podcastMaxConcurrentCheck.count === 0) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('podcast_max_concurrent_downloads', '2')").run();
    console.log('Seeded setting podcast_max_concurrent_downloads: 2');
  }

  const musicModuleEnabledCheck = db.prepare("SELECT COUNT(*) as count FROM settings WHERE key = 'music_module_enabled'").get() as { count: number };
  if (musicModuleEnabledCheck.count === 0) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('music_module_enabled', '1')").run();
    console.log('Seeded setting music_module_enabled: 1');
  }

  const musicDownloadClipsCheck = db.prepare("SELECT COUNT(*) as count FROM settings WHERE key = 'music_download_clips'").get() as { count: number };
  if (musicDownloadClipsCheck.count === 0) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('music_download_clips', '0')").run();
    console.log('Seeded setting music_download_clips: 0');
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
