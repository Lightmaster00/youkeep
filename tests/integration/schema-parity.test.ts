import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type Database from 'better-sqlite3';
import { assertInTmp, createTestDb } from '../helpers/testDb';

// Most tests run on createTestDb(), a hand-written subset of the real schema.
// A column default or NOT NULL that differs from server/utils/db.ts would let
// a test pass on data production can never hold (or the reverse), so:
// - every table and column createTestDb defines must exist in the real schema
//   with the same type, NOT NULL, default and primary-key position;
// - createTestDb defines no table, index or trigger the real schema lacks;
// - everything the real schema has that createTestDb leaves out is listed
//   below, with the reason. A new table, column, index or trigger in db.ts
//   fails this test until it is added to createTestDb or to this list.
const { openDatabase } = await vi.importActual<typeof import('../../server/utils/db')>('../../server/utils/db');

/** Real-only schema objects the test database intentionally lacks. */
const REAL_ONLY: Record<string, { reason: string; names: string[] }> = {
  tables: {
    reason: 'Features whose tests use the real schema (openDatabase in a temp file), plus FTS5 shadow tables.',
    names: [
      'comments', 'playlist_videos', 'playlists', 'reports',
      'search_platforms', 'video_chapters',
      'videos_fts', 'videos_fts_config', 'videos_fts_content', 'videos_fts_data', 'videos_fts_docsize', 'videos_fts_idx',
      'music_tracks_fts', 'music_tracks_fts_config', 'music_tracks_fts_content', 'music_tracks_fts_data', 'music_tracks_fts_docsize', 'music_tracks_fts_idx',
      'podcast_episodes_fts', 'podcast_episodes_fts_config', 'podcast_episodes_fts_content', 'podcast_episodes_fts_data', 'podcast_episodes_fts_docsize', 'podcast_episodes_fts_idx',
    ],
  },
  columns: {
    reason: 'Columns only real-schema tests read (profile fields, channel download options, sizes, likes, episode share links); the list routes that select them are tested on openDatabase.',
    names: [
      'channels.description', 'channels.banner_url', 'channels.download_videos', 'channels.download_shorts', 'channels.download_lives', 'channels.date_after',
      'podcast_episodes.share_token',
      'users.first_name', 'users.last_name', 'users.email', 'users.phone', 'users.dob',
      'videos.size_bytes', 'videos.like_count',
    ],
  },
  triggers: {
    reason: 'FTS sync and rename triggers and the require-id guards: covered by fts-*.test.ts and db-schema-hardening.test.ts on the real schema.',
    names: [
      'channels_fts_rename', 'music_albums_fts_rename', 'music_artists_fts_rename', 'podcast_shows_fts_rename',
      'videos_ai', 'videos_ad', 'videos_au', 'videos_require_id',
      'music_tracks_ai', 'music_tracks_ad', 'music_tracks_au', 'music_tracks_require_id',
      'podcast_episodes_ai', 'podcast_episodes_ad', 'podcast_episodes_au', 'podcast_episodes_require_id',
    ],
  },
  indexes: {
    reason: 'Performance indexes (checked by db-schema-hardening.test.ts) and the case-insensitive username index (checked by the admin-users tests through isUsernameTaken).',
    names: [
      'idx_api_tokens_user_id', 'idx_comments_video_id', 'idx_music_albums_artist_id', 'idx_music_favorites_track_id',
      'idx_music_play_history_track_id', 'idx_music_play_history_user_track', 'idx_music_track_artists_artist_id',
      'idx_music_tracks_album_id', 'idx_music_tracks_artist_id', 'idx_music_tracks_artist_status',
      'idx_music_user_playlist_tracks_track_id', 'idx_music_user_playlists_user_id',
      'idx_personal_playlist_videos_playlist_id', 'idx_personal_playlist_videos_video_id', 'idx_playlist_videos_video_id',
      'idx_podcast_episode_progress_episode_id', 'idx_podcast_episodes_pub_ts', 'idx_podcast_episodes_show_id',
      'idx_podcast_episodes_show_status', 'idx_podcast_show_follows_show_id', 'idx_reports_video_id',
      'idx_sessions_expires_at', 'idx_sessions_user_id', 'idx_user_channel_access_channel_id',
      'idx_user_hidden_videos_video_id', 'idx_user_history_user_id', 'idx_user_history_video_id',
      'idx_user_subscriptions_channel_id', 'idx_users_username_nocase', 'idx_video_chapters_video_id',
      'idx_videos_channel_id', 'idx_videos_channel_upload', 'idx_videos_channel_visibility_status', 'idx_user_seen_videos_video_id', 'idx_videos_download_status',
      'idx_videos_share_token', 'idx_videos_visibility',
    ],
  },
};

type Column = { name: string; type: string; notnull: number; dflt_value: string | null; pk: number };
type Obj = { name: string; type: 'table' | 'index' | 'trigger' | 'view' };

let dir: string;
let real: Database.Database;
let test: Database.Database;

beforeAll(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yk-schema-parity-'));
  assertInTmp(dir);
  real = openDatabase(path.join(dir, 'youkeep.db'));
  test = createTestDb();
});
afterAll(() => {
  real.close();
  test.close();
  fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const objects = (db: Database.Database): Obj[] =>
  db.prepare("SELECT name, type FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all() as Obj[];
const columns = (db: Database.Database, table: string): Map<string, Column> =>
  new Map((db.prepare(`PRAGMA table_info("${table}")`).all() as Column[]).map((c) => [c.name, c]));
const describeColumn = (c: Column) => `${c.type || '(no type)'}${c.notnull ? ' NOT NULL' : ''}${c.dflt_value !== null ? ` DEFAULT ${c.dflt_value}` : ''}${c.pk ? ` PK#${c.pk}` : ''}`;

describe('createTestDb mirrors the real schema', () => {
  it('every test table and column exists in the real schema with the same type, NOT NULL, default and key', () => {
    const realTables = new Set(objects(real).filter((o) => o.type === 'table').map((o) => o.name));
    const diffs: string[] = [];
    for (const { name: table } of objects(test).filter((o) => o.type === 'table')) {
      if (!realTables.has(table)) {
        diffs.push(`table ${table}: only in createTestDb`);
        continue;
      }
      const realCols = columns(real, table);
      for (const [name, col] of columns(test, table)) {
        const r = realCols.get(name);
        if (!r) diffs.push(`${table}.${name}: only in createTestDb (${describeColumn(col)})`);
        else if (describeColumn(r) !== describeColumn(col)) diffs.push(`${table}.${name}: real ${describeColumn(r)} | createTestDb ${describeColumn(col)}`);
      }
    }
    expect(diffs, `Schema drift between createTestDb and openDatabase:\n${diffs.join('\n')}`).toEqual([]);
  });

  it('createTestDb defines no index or trigger the real schema lacks', () => {
    const realNames = new Set(objects(real).map((o) => `${o.type} ${o.name}`));
    const extra = objects(test).map((o) => `${o.type} ${o.name}`).filter((n) => !realNames.has(n));
    expect(extra).toEqual([]);
  });

  it('everything only the real schema has is on the documented list (and the list has no stale entry)', () => {
    const testNames = new Set(objects(test).map((o) => o.name));
    const testTables = new Set(objects(test).filter((o) => o.type === 'table').map((o) => o.name));
    const realObjects = objects(real);
    const missing: Record<string, string[]> = { tables: [], columns: [], triggers: [], indexes: [] };
    for (const o of realObjects) {
      if (testNames.has(o.name)) continue;
      if (o.type === 'table') missing.tables!.push(o.name);
      if (o.type === 'trigger') missing.triggers!.push(o.name);
      if (o.type === 'index') missing.indexes!.push(o.name);
    }
    for (const table of testTables) {
      const testCols = columns(test, table);
      for (const name of columns(real, table).keys()) if (!testCols.has(name)) missing.columns!.push(`${table}.${name}`);
    }
    const problems: string[] = [];
    for (const [kind, { names }] of Object.entries(REAL_ONLY)) {
      const listed = new Set(names);
      const actual = new Set(missing[kind]);
      for (const n of actual) if (!listed.has(n)) problems.push(`${kind}: ${n} is in the real schema only — add it to createTestDb or to REAL_ONLY.${kind} with a reason`);
      for (const n of listed) if (!actual.has(n)) problems.push(`${kind}: ${n} is listed in REAL_ONLY but is not real-only any more — remove it from the list`);
    }
    expect(problems, problems.join('\n')).toEqual([]);
  });
});
