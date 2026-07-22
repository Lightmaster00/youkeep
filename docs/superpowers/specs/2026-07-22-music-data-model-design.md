# Music Content Model — Design

## Context

First sub-project of the "Music mode" initiative — the concrete first step toward the long-term product vision (project memory `project_multi_content_vision`) of YouKeep hosting multiple content types (video, music, podcasts, audiobooks) as independent, togglable spaces rather than one video-only archiver. That vision was previously scoped as "prepare the ground, not build now"; the user has now asked to start on it.

The initiative is too large for one spec. Decomposed into ordered sub-projects, agreed with the user:

1. **Data model** (this spec) — the tables music mode is built on.
2. Music ingestion from YouTube (audio-only download pipeline).
3. Music library UI (browsing by artist/album, filtering).
4. Audio player.
5. Settings toggle to activate/deactivate the module.
6. YouTube Clips migration into this module (previously deferred specifically to wait for this — see `project_downloader_feature_wishlist`).

The existing schema (`server/utils/db.ts`) has no content-type concept anywhere — `channels`/`videos`/`playlists` are built exclusively for YouTube video archiving, with no discriminator column and no shared abstraction to hook into.

## Scope

Four new tables for music content — artists, albums, tracks, and track-artist credits — plus the migration to create them. Nothing else.

## Non-Goals

- No ingestion/download pipeline (sub-project 2).
- No UI of any kind (sub-project 3).
- No player (sub-project 4).
- No module activation toggle (sub-project 5) — these tables exist in the schema regardless, unused until later sub-projects populate and expose them.
- No per-user access control equivalent to `user_channel_access` — deferred; a `visibility` column exists on `music_artists` for future use but no enforcement or join table yet.
- No YouTube Clips migration (sub-project 6).
- No additional filter criteria beyond genre, language, and album release year — explicitly deferred (label, release type, etc.) to a later migration if wanted; adding a column later is cheap and doesn't require redesigning this schema.

## Design

### Why separate tables, not a shared `content_type` column

Reusing `channels`/`videos` with a `content_type` discriminator was considered and rejected: it would mix two different data shapes (music needs album/genre/feat-credit concepts videos don't; videos need is_short/download_videos-tab-filtering concepts music doesn't) into the same tables, complicating both over time. Separate tables (`music_artists`, `music_albums`, `music_tracks`, `music_track_artists`) keep the two content types independent, matching the "separate spaces" product vision, at the cost of some duplicated shape (e.g. `sync_status`, `download_status` fields mirroring `channels`/`videos`) — an acceptable, explicit tradeoff given the vision this is building toward.

### What a "track" is

One YouTube video, audio-only extracted (the actual extraction is sub-project 2's concern — this spec only shapes the row that will eventually describe it). An artist is a followed YouTube channel, the same relationship `channels` has to `videos` today.

### Artists can exist without a followed channel

Featured artists on a track need to be real, filterable entities — clicking a feat's name should show everything they're credited on — but the app won't necessarily have their channel added. `music_artists.id` is therefore a generated id (not the YouTube channel id), with a nullable, unique `channel_id` populated only when the artist is an actually-followed/synced channel. An artist created solely because they were tagged as a feat has `channel_id = NULL`.

### Albums

An album belongs to one owning artist (`music_albums.artist_id`), with `release_year` and a `source` flag distinguishing `'youtube'` (auto-detected from yt-dlp's per-track metadata, when present — future ingestion work — and therefore refreshable) from `'manual'` (admin-created, never auto-overwritten). A track's `album_id` is nullable: an unclassified track simply has no album, same as an untagged video isn't in any playlist today.

### Credits vs. technical ownership

`music_tracks.artist_id` and the `music_track_artists` join table represent two different things and are kept deliberately separate:

- `music_tracks.artist_id` is which channel the track was ingested from — technical attribution, used the same way `videos.channel_id` is used today (file/folder organization, download-queue queries). Always set, always exactly one value.
- `music_track_artists` (`track_id`, `artist_id`, `role` — `'primary'` or `'feat'`) is who's musically credited — the actual source of truth for browsing/filtering by artist regardless of role. In the common case the `'primary'` row matches `artist_id`, but they're not constrained to match, since a track's technical source channel and its musical credits are conceptually different facts.

### Filtering criteria

`genre` and `language` live on `music_tracks` (finest-grained unit, and the natural home for yt-dlp's per-video metadata, once ingestion reads it). `release_year` lives on `music_albums`, not per-track, since it describes the release, not the individual audio file.

### Schema

```sql
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
  source TEXT NOT NULL CHECK(source IN ('youtube', 'manual')),
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

CREATE TABLE music_track_artists (
  track_id TEXT NOT NULL,
  artist_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('primary', 'feat')),
  PRIMARY KEY (track_id, artist_id),
  FOREIGN KEY (track_id) REFERENCES music_tracks(id) ON DELETE CASCADE,
  FOREIGN KEY (artist_id) REFERENCES music_artists(id) ON DELETE CASCADE
);
```

Added to `server/utils/db.ts` as four more `CREATE TABLE IF NOT EXISTS` statements, in the same migration block as every other table — no ALTER TABLE needed since these are new tables, not additions to existing ones.

## Error Handling / Edge Cases

- Deleting an album (`music_albums` row removed) sets its tracks' `album_id` to `NULL` (`ON DELETE SET NULL`) rather than deleting the tracks — matches the archive's "never delete on cascade" philosophy applied elsewhere (e.g. playlist deletion never deletes videos).
- Deleting an artist cascades to delete their `music_albums`, `music_tracks`, and `music_track_artists` rows (`ON DELETE CASCADE`) — an artist here represents "everything downloaded from/credited to this entity," so removing the artist is expected to remove their content, consistent with deleting a `channels` row today.
- A track can have zero rows in `music_track_artists` immediately after its base row is created (credits populated later, by ingestion or manually) — this is valid, not an error state, since this spec doesn't build ingestion.
- No two artist rows can share a `channel_id` (`UNIQUE` constraint) — prevents accidentally creating a duplicate followed-channel artist.

## Verification

- Run the migration (via `getDb()`, same as every existing table) against a fresh DB and confirm all four tables exist with the exact columns above.
- Insert one artist, one album under it, one track under that album, and a second "feat-only" artist (`channel_id = NULL`) credited on the track via `music_track_artists` with `role = 'feat'` — confirm all rows insert without constraint errors.
- Delete the album — confirm the track's `album_id` becomes `NULL` and the track row itself still exists.
- Delete the primary artist — confirm their albums and tracks are gone, and confirm the feat-only artist (unrelated to the deleted artist) is untouched.
- Attempt to insert a second artist row with a `channel_id` already in use — confirm it's rejected by the `UNIQUE` constraint.
