# Content Search (Music/Podcasts FTS + Global/Per-Space Toggle) — Design

**Status:** Approved

## Goal

Give music and podcasts real full-text search that finds tracks/episodes directly (not just artist/show names), matching the video side's existing FTS5 search — and let an admin choose whether the header search bar searches within the active space only, or across all content types via a dedicated results page.

## Context

Today, video has real FTS5 full-text search (`videos_fts` virtual table, indexing `title`/`description`/`channel_title`, with a `LIKE` fallback) returning matching videos directly, regardless of channel. Music (`server/api/music/artists/index.get.ts`) and podcasts (`server/api/podcasts/shows/index.get.ts`) both only do a single-field `name`/`title LIKE ?` substring filter on the artist/show list — there is no way to find a track or episode directly by its own title; the admin/user must browse into an artist or show first. Podcast episodes have no search at all today.

The header's global search bar (`app/layouts/default.vue`) always redirects to `/` with a video-only query, regardless of which space (Video/Music/Podcasts) is currently active.

This sub-project is independent of, and unrelated to, the recently-shipped Admin Ingest Search / Search Platforms features — those search *external* sources (YouTube, iTunes, PodcastIndex, Listen Notes) to find new content to download. This sub-project searches the *already-archived* library.

## Scope

**In scope:**
- New `music_tracks_fts` and `podcast_episodes_fts` FTS5 virtual tables, mirroring `videos_fts`'s existing trigger-maintained pattern, with `LIKE` fallback on any FTS query failure.
- Two new search endpoints returning matching tracks/episodes directly (not just artist/show names): `GET /api/music/tracks/search` and `GET /api/podcasts/episodes/search`.
- On `/music` and `/podcasts`, an active search query replaces the artist/show grid with a flat, clickable list of matching tracks/episodes (artist/show name shown alongside each result) — mirrors how the video home page already replaces its grid with search results.
- A new admin setting, `content_search_mode` (`'per_space'` default, or `'global'`), toggled in Settings → System, controlling ONLY the header search bar's behavior:
  - **`per_space`** (default, today's approved behavior): the header bar searches within the active space — video search on `/`, music search on `/music`, podcast search on `/podcasts`.
  - **`global`**: the header bar always navigates to a new `/search` page showing results from all 3 content types, grouped into 3 sections (capped at 10 results each, with a "Voir plus" link per section jumping to that space's own full search).
- The toggle affects only the header bar — the existing local search inputs already on `/music` and `/podcasts` (which filter their own artist/show grid) are unaffected by the mode and always search their own space.

**Out of scope:**
- Any change to the existing video search (`videos_fts`, the video home page's search behavior) beyond being one of the 3 sources `/search` reads from.
- A per-user preference for search mode — this is a single admin-controlled setting, matching the rest of Settings → System.
- Advanced genre/tag/faceted search.
- Pagination beyond the existing per-page conventions on `/music`/`/podcasts`, and beyond the "Voir plus" links on `/search` (no infinite scroll or page 2 on the `/search` page itself).

## Architecture

### FTS5 tables

In `server/utils/db.ts`, mirroring `videos_fts`'s exact virtual-table + trigger pattern:

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS music_tracks_fts USING fts5(
  id UNINDEXED,
  title,
  artist_name,
  album_title,
  genre,
  tokenize='porter'
);
```
with `music_tracks_ai`/`_ad`/`_au` triggers populating `artist_name` from `music_artists.name` and `album_title` from `music_albums.title` at write time (joined once, at trigger time — same denormalization `videos_fts` already accepts for `channel_title`; an artist/album rename doesn't retroactively re-index already-written tracks, a pre-existing accepted limitation carried over, not introduced here).

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS podcast_episodes_fts USING fts5(
  id UNINDEXED,
  title,
  description,
  show_title,
  tokenize='porter'
);
```
with the equivalent `podcast_episodes_ai`/`_ad`/`_au` triggers joining `podcast_shows.title`.

Both get a backfill `INSERT ... WHERE rowid NOT IN (...)` statement at init, exactly matching `videos_fts`'s existing backfill block.

### Search endpoints

- `GET /api/music/tracks/search?q=<term>` → matches against `music_tracks_fts` (same quoted-and-`*`-suffixed query-building and try/MATCH/catch-fallback-to-LIKE pattern as `server/api/videos/index.get.ts`), joins `music_artists.name`/`music_albums.title`, applies the existing music visibility clause, returns `{ tracks: [...] }` with each track carrying `artist_name`/`album_title` alongside its existing fields.
- `GET /api/podcasts/episodes/search?q=<term>` → same shape against `podcast_episodes_fts`, joining `podcast_shows.title`, applying podcast visibility, returns `{ episodes: [...] }` with `show_title` alongside each episode.
- Only `download_status='completed'` tracks/episodes are returned (matches the existing catalog-browsing convention).

### Per-space page behavior

`app/pages/music/index.vue` and `app/pages/podcasts/index.vue`: when their existing local search input has a non-empty query, call the new search endpoint instead of the artist/show list endpoint, and render a flat list (title, artist/show name, click-to-play) in place of the grid — matches the video home page's existing search-replaces-grid pattern (`app/pages/index.vue`). No new route; this is the existing local search box's behavior, unaffected by the new global/per-space setting.

### Setting + header bar

New setting `content_search_mode` (`'per_space'` | `'global'`, default `'per_space'`): `GET /api/settings/content-search-mode` is public (unauthenticated, fail-open to `'per_space'` on any error) since it affects the header bar for every user, not just admins — mirrors the existing `music_module_enabled` public-read pattern. `POST /api/admin/settings/content-search-mode` is admin-only, with a toggle added to `SettingsSystemTab.vue`.

`app/layouts/default.vue`'s `handleSearch()` reads this setting (fetched once on mount, matching this app's existing single-row-settings-read convention). In `per_space` mode, behavior is unchanged from today (push to `/`, `/music`, or `/podcasts` based on `activeSpace`). In `global` mode, always pushes to `/search?q=<term>` regardless of active space.

### `/search` page

New `app/pages/search.vue`: reads `route.query.q`, fires 3 parallel fetches — `GET /api/videos?q=` (existing), `GET /api/music/tracks/search?q=` (new), `GET /api/podcasts/episodes/search?q=` (new) — each independently loading/erroring. Renders 3 sections (Vidéos / Musique / Podcasts), each capped at the first 10 results, with a "Voir plus" link per section navigating to `/?q=`, `/music?q=`, `/podcasts?q=` respectively for the full, unpaginated result set.

## Error Handling

- FTS5 query failures (malformed query, missing table) fall back to a plain `LIKE` scan, exactly matching `videos_fts`'s existing try/catch pattern — never surfaced as an error.
- On `/search`, each of the 3 source fetches is independent: one failing (network error, timeout) shows an inline error state in that section only, without blocking the other 2 sections from rendering their results.
- If reading `content_search_mode` fails for any reason, the header bar falls back to `per_space` (today's behavior) — never blocks or breaks the search bar.

## Testing

- Unit/integration tests for the two new endpoints: FTS match returns correct tracks/episodes with joined artist/show names, LIKE fallback still works, visibility rules respected (a private/ultra_private artist's tracks don't leak to an unauthorized search), `download_status != 'completed'` items excluded.
- No dedicated test for the FTS5 triggers/virtual-table SQL itself (matches `videos_fts`'s own established convention — untested, verified via manual `.schema` inspection instead).
- Manual browser verification: toggling `content_search_mode` in Settings, header bar behavior in both modes, `/search` page's 3 sections and "Voir plus" links, grid-to-list replacement on `/music` and `/podcasts` when searching.
