# Podcast Data Model — Design

## Context

First sub-project of a new feature initiative: building a "Podcasts" content-type space, the third of the originally-envisioned "video/music/podcast/audiobook" independent togglable spaces (flagged as future direction on 2026-07-21, "prepare the ground, not build yet"; Music mode — the second space — was built out fully as of 2026-07-31, following an ordered sub-project sequence: data model → ingestion → library UI → playback UI).

Unlike Music mode (which sources content from YouTube channels via `yt-dlp`, mirroring the video pipeline), Podcasts will source content from **RSS feeds** — the standard podcast distribution model (Apple Podcasts, Spotify, etc.) — per explicit user decision. A YouTube-channel-based source may be added later as a second ingestion path into the same data model, but is out of scope for now.

Explored the existing `music_artists`/`music_tracks` schema (`server/utils/db.ts`) as the established convention to mirror: `id TEXT PRIMARY KEY`, a top-level entity holding `sync_status`/`visibility`/`created_at`, a child entity holding `download_status`/`download_progress`/`download_speed`/`download_eta`/`last_error`/`local_file_path`/`local_thumbnail_path`/`share_token`, foreign keys with `ON DELETE CASCADE`. No existing RSS/XML parsing library in `package.json` — will need one added in the ingestion sub-project (not this one).

## Scope

- Two new, fully independent tables: `podcast_shows` and `podcast_episodes`.
- No album-equivalent or multi-show-per-episode relationship — a podcast episode belongs to exactly one show; there is no album/playlist-style grouping layer for podcasts the way `music_albums` exists for music.

## Non-Goals

- No ingestion pipeline (RSS parsing, episode download) — that's the next sub-project.
- No library/browsing UI, no space-switcher entry, no admin feed-management UI — later sub-projects.
- No playback UI or resume-position/playback-speed tracking columns — those are player-state concerns, not catalog data, and will be scoped when the playback UI sub-project is designed (likely as a separate `podcast_playback_state` table or similar, analogous to how video/music history/progress is tracked elsewhere — not decided yet, deliberately deferred).
- No YouTube-based podcast ingestion path (the "both eventually" source model) — this data model is designed to accommodate it later without a breaking migration (episodes are identified by their own `id`, not tied to any RSS-specific field being mandatory in a way that would block a YouTube-sourced episode from also using this table), but no YouTube-specific columns are added now.
- No changes to any existing table (`videos`, `music_*`, etc.) — fully independent, matching the established pipeline-independence convention.

## Design

### `podcast_shows`

```sql
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
```

- `id`: generated (`crypto.randomUUID()`, matching how `music_artists.id` is generated at ingestion time — the RSS feed itself has no equivalent of a stable "channel ID" the way a YouTube channel does, so this cannot be derived from the feed itself the way `music_artists.channel_id` is a real external identifier).
- `feed_url`: the RSS feed URL, unique — this IS the stable external identifier for a show (equivalent role to `music_artists.channel_id`), used to detect "already following this show" and to re-fetch on sync.
- `sync_status`/`visibility`: identical semantics and default values to `music_artists`.
- `last_checked_at`: epoch ms of the last successful feed fetch — new column not present on `music_artists` (music's `syncAllMusicArtists` re-ingests unconditionally on every sync-all run; a future podcast sync strategy may want to skip feeds checked very recently, but that policy is not designed here — the column is added now since it's cheap to have and expensive to backfill later, but no behavior depends on it yet).

### `podcast_episodes`

```sql
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
  last_error TEXT,
  share_token TEXT UNIQUE,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (show_id) REFERENCES podcast_shows(id) ON DELETE CASCADE
);
```

- `id`: derived from the RSS `<guid>` element (per the RSS/podcast spec, `<guid>` is meant to be a stable, unique-per-episode identifier — the direct equivalent of a YouTube video ID for `music_tracks.id`/`videos.id`). The ingestion sub-project will need to decide exact normalization (e.g. hashing if a feed's GUIDs aren't URL-safe as a primary key) — noted here as a known detail for that sub-project, not resolved now.
- `audio_url`: the enclosure URL from the feed — the remote source to download from, analogous to constructing a YouTube URL from a video ID, except here the full URL must be stored since it's not reconstructable from `id` alone.
- `download_status`/`download_progress`/`download_speed`/`download_eta`/`last_error`/`local_file_path`/`local_thumbnail_path`/`share_token`: identical semantics to the equivalent `music_tracks` columns.
- `episode_number`/`season_number`: from the optional `<itunes:episode>`/`<itunes:season>` feed tags; nullable since not all feeds set them.
- No `visibility` column on episodes — inherits from the parent show, matching the established music convention (`music_tracks` has no per-track visibility either).

### Indexes

Matching the existing convention of indexing foreign keys used in hot lookups (e.g. `idx_music_tracks_artist_id` from an earlier sub-project):

```sql
CREATE INDEX IF NOT EXISTS idx_podcast_episodes_show_id ON podcast_episodes(show_id);
```

## Error Handling

Not applicable — this sub-project is schema-only (`CREATE TABLE IF NOT EXISTS` + one index, matching the existing migration style in `server/utils/db.ts`, which runs all `CREATE TABLE IF NOT EXISTS` statements unconditionally at startup and uses `try { ALTER TABLE ... } catch (e) {}` for incremental additive migrations to already-shipped tables). No application code reads or writes these tables yet.

## Verification

Schema-only change: verify by starting the app against a fresh (or existing) dev database and confirming both tables and the index are created without error, then inspect the schema directly (`sqlite3 data/youkeep.db ".schema podcast_shows"` / `".schema podcast_episodes"`) to confirm the exact column set and constraints match this spec. No automated test is meaningful for a bare `CREATE TABLE` statement with no application logic yet — this matches the established pattern (the original `music_artists`/`music_tracks` tables also shipped without a dedicated schema test, verified manually).
