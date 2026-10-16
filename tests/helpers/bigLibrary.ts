import type Database from 'better-sqlite3';

/**
 * Fills a database that has the real schema (server/utils/db.ts openDatabase)
 * with a synthetic library, for query-plan audits and time-budget regression
 * tests. Deterministic: the same sizes always give the same rows.
 *
 * Users: `admin` (admin), `heavy` (user who did most of the plays / watches),
 * `light` (user with a few plays). Session ids are `sess-<user id>`.
 */
export interface BigLibrarySizes {
  channels: number;
  videos: number;
  artists: number;
  tracks: number;
  shows: number;
  episodes: number;
  plays: number;
  videoHistory: number;
  favorites: number;
  progress: number;
}

export const AUDIT_SIZES: BigLibrarySizes = {
  channels: 500, videos: 100_000,
  artists: 1000, tracks: 90_000,
  shows: 300, episodes: 90_000,
  plays: 300_000, videoHistory: 50_000, favorites: 20_000, progress: 30_000,
};

export const REGRESSION_SIZES: BigLibrarySizes = {
  channels: 100, videos: 10_000,
  artists: 300, tracks: 20_000,
  shows: 60, episodes: 10_000,
  plays: 30_000, videoHistory: 5_000, favorites: 3_000, progress: 3_000,
};

const VIS = ['public', 'public', 'public', 'private', 'ultra_private'] as const;
const GENRES = ['Rock', 'Jazz', 'Pop', 'Electro', 'Folk', 'Metal', 'Classical', 'Hip-hop'];

export function seedBigLibrary(db: Database.Database, s: BigLibrarySizes): void {
  const now = Date.now();
  const DAY = 86_400_000;
  db.transaction(() => {
    const user = db.prepare('INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)');
    const session = db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)');
    for (const [id, role] of [['admin', 'admin'], ['heavy', 'user'], ['light', 'user']] as const) {
      user.run(id, id, 'x', role, now);
      session.run(`sess-${id}`, id, now + DAY);
    }

    const channel = db.prepare('INSERT INTO channels (id, title, visibility, created_at) VALUES (?, ?, ?, ?)');
    for (let c = 0; c < s.channels; c++) channel.run(`c${c}`, `Channel ${c}`, VIS[c % VIS.length], now - c * 1000);
    const access = db.prepare('INSERT INTO user_channel_access (user_id, channel_id) VALUES (?, ?)');
    for (let c = 4; c < s.channels; c += 50) access.run('heavy', `c${c}`);
    const sub = db.prepare('INSERT INTO user_subscriptions (user_id, channel_id, created_at) VALUES (?, ?, ?)');
    for (let c = 0; c < Math.min(30, s.channels); c++) sub.run('heavy', `c${c}`, now - c);

    const video = db.prepare(`
      INSERT INTO videos (id, title, description, channel_id, upload_date, duration, view_count, like_count,
        download_status, visibility, is_short, local_video_path, local_thumbnail_path, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (let i = 0; i < s.videos; i++) {
      const d = new Date(now - (i % 3000) * DAY);
      const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
      video.run(
        `v${i}`, `Video ${i} topic ${i % 97}`, `Description ${i}`, `c${i % s.channels}`, ymd,
        60 + (i % 3600), (i * 7919) % 5_000_000, (i * 31) % 100_000,
        i % 20 === 0 ? 'pending' : 'completed', i % 11 === 0 ? 'private' : 'public', i % 9 === 0 ? 1 : 0,
        `/media/v${i}.mp4`, `/media/v${i}.jpg`, now - i * 60_000,
      );
    }
    const history = db.prepare('INSERT OR IGNORE INTO user_history (user_id, video_id, watched_at, watch_time_seconds) VALUES (?, ?, ?, ?)');
    for (let i = 0; i < s.videoHistory; i++) {
      history.run(i % 4 === 0 ? 'light' : 'heavy', `v${(i * 7) % s.videos}`, now - (i % 30) * DAY, i % 900);
    }
    const hidden = db.prepare('INSERT OR IGNORE INTO user_hidden_videos (user_id, video_id, hidden_at) VALUES (?, ?, ?)');
    for (let i = 0; i < 200; i++) hidden.run('heavy', `v${(i * 13) % s.videos}`, now);

    const artist = db.prepare('INSERT INTO music_artists (id, name, visibility, created_at) VALUES (?, ?, ?, ?)');
    for (let a = 0; a < s.artists; a++) artist.run(`a${a}`, `Artist ${a}`, VIS[a % VIS.length], now - a * 1000);
    const albumsPerArtist = 3;
    const album = db.prepare("INSERT INTO music_albums (id, artist_id, title, release_year, source, created_at) VALUES (?, ?, ?, ?, 'youtube', ?)");
    for (let a = 0; a < s.artists; a++) {
      for (let k = 0; k < albumsPerArtist; k++) album.run(`al${a}_${k}`, `a${a}`, `Album ${a}-${k}`, 1990 + k, now - (a * 3 + k) * 1000);
    }
    const track = db.prepare(`
      INSERT INTO music_tracks (id, artist_id, album_id, title, track_number, genre, duration, download_status, local_file_path, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const trackArtist = db.prepare("INSERT INTO music_track_artists (track_id, artist_id, role) VALUES (?, ?, 'primary')");
    for (let t = 0; t < s.tracks; t++) {
      // Skewed catalogues: low artist numbers own many more tracks.
      const a = Math.floor(((t * 2654435761) % 4294967296) / 4294967296 * s.artists * ((t % 3) + 1) / 3) % s.artists;
      track.run(`t${t}`, `a${a}`, `al${a}_${t % albumsPerArtist}`, `Track ${t}`, (t % 12) + 1, GENRES[t % GENRES.length],
        120 + (t % 300), t % 25 === 0 ? 'pending' : 'completed', `/music/t${t}.m4a`, now - t * 30_000);
      trackArtist.run(`t${t}`, `a${a}`);
    }
    const play = db.prepare('INSERT INTO music_play_history (id, track_id, user_id, played_at) VALUES (?, ?, ?, ?)');
    for (let p = 0; p < s.plays; p++) {
      play.run(`p${p}`, `t${(p * 7) % Math.floor(s.tracks / 2)}`, p % 10 === 0 ? 'light' : 'heavy', now - p * 10_000);
    }
    const fav = db.prepare('INSERT OR IGNORE INTO music_favorites (user_id, track_id, created_at) VALUES (?, ?, ?)');
    for (let f = 0; f < s.favorites; f++) fav.run('heavy', `t${(f * 3) % s.tracks}`, now - f * 1000);

    const show = db.prepare('INSERT INTO podcast_shows (id, feed_url, title, visibility, language, created_at) VALUES (?, ?, ?, ?, ?, ?)');
    for (let sh = 0; sh < s.shows; sh++) show.run(`s${sh}`, `https://example.invalid/feed/${sh}`, `Show ${sh}`, VIS[sh % VIS.length], sh % 2 ? 'en' : 'fr', now - sh * 1000);
    const episode = db.prepare(`
      INSERT INTO podcast_episodes (id, show_id, title, description, audio_url, duration, pub_date, pub_ts, download_status, local_file_path, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (let e = 0; e < s.episodes; e++) {
      episode.run(`e${e}`, `s${e % s.shows}`, `Episode ${e}`, `About ${e}`, `https://example.invalid/a/${e}.mp3`, 1800 + (e % 1800),
        new Date(now - e * 3_600_000).toUTCString(), now - e * 3_600_000, e % 30 === 0 ? 'pending' : 'completed', `/podcasts/e${e}.mp3`, now - e * 60_000);
    }
    const follow = db.prepare('INSERT INTO podcast_show_follows (user_id, show_id, created_at) VALUES (?, ?, ?)');
    for (let sh = 0; sh < Math.min(40, s.shows); sh++) follow.run('heavy', `s${sh}`, now - sh);
    const progress = db.prepare(`
      INSERT OR IGNORE INTO podcast_episode_progress (user_id, episode_id, position_seconds, duration_seconds, completed, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)`);
    for (let p = 0; p < s.progress; p++) progress.run('heavy', `e${(p * 3) % s.episodes}`, 60 + (p % 1000), 3600, p % 4 === 0 ? 1 : 0, now - p * 1000);
  })();
}
