# Podcast Library UI — Design Spec

Sub-project 3 of YouKeep's Podcasts content-type module (data model → RSS ingestion → **library UI** → playback UI). Sub-projects 1 and 2 are done and merged to `main`: `podcast_shows`/`podcast_episodes` tables exist, RSS ingestion (`ingestPodcastFeed`) works, a stream-based downloader with queue/retry/scheduler exists (`server/utils/podcastDownloader.ts`), and 11 admin API routes exist under `server/api/admin/podcasts/`. There is currently no way for anyone — admin or regular user — to reach any of this through the UI.

This sub-project closes that gap, following the exact pattern established by Music mode's own library-UI sub-project (Music mode sub-project 3).

## Goals

- A `/podcasts` space, reachable from the header space-switcher, where users can browse shows and episodes.
- An admin-facing `Settings > Podcasts` tab to add RSS feeds, manage shows, and control the download pipeline (concurrency, schedule, pause/resume) — wiring up the 11 already-existing admin API routes.
- A file-serving route so downloaded episode audio (and show cover art) can actually be played/displayed, closing the gap explicitly flagged as missing in sub-project 2's final review.
- Basic per-episode metadata editing (title, episode/season number, description), mirroring Music mode's per-track editing.

## Non-Goals

- **Playback UI** (an actual audio player, resume-position/speed tracking) — sub-project 4.
- **Module on/off toggle** (`podcastModuleGate.ts`, a `podcast_module_enabled` setting, hide-from-switcher-when-disabled) — deliberately deferred to a later sub-project, matching Music mode's own precedent where the toggle was built well after the library UI shipped. The Podcasts space is always visible once this sub-project ships.
- Any change to the 11 existing admin API routes or the ingestion/download pipeline itself (`server/utils/podcastDownloader.ts`) — this sub-project only adds UI and new read/write routes on top of what already exists.
- Advanced catalog filters (genre/language/year facets) — start with title search only; add facets later if the metadata density justifies it.

## Architecture

Four pieces, each mirroring an existing Music mode equivalent:

1. **Space-switcher entry** (`app/spaces/index.ts`) — a `podcasts` space, always visible, one nav link ("Bibliothèque" → `/podcasts`).
2. **Catalog page** (`app/pages/podcasts/index.vue`) — one route, shows grid ⇄ episode-list detail view via a `showId` query param, exactly mirroring `/music`'s `artistId` pattern.
3. **Admin management UI** (`app/components/settings/SettingsPodcastsTab.vue`) — a new Settings tab mirroring `SettingsMusicTab.vue`: add-feed form, shows list with per-show sync/pause, concurrency setting, cron schedule, global pause/resume, download queue view.
4. **File-serving route** (`server/routes/downloads-podcasts/[...path].ts`) — mirrors `downloads-music`'s route: content-type maps, ownership/visibility check, path-containment guards.

Plus supporting API routes and a metadata-edit modal (see below).

## Data & API Routes

**Public read routes** (new), mirroring `server/api/music/artists/*`:
- `GET /api/podcasts/shows` — list shows (id, title, cover_url, episode_count), respecting `visibility`.
- `GET /api/podcasts/shows/[id]` — one show's metadata.
- `GET /api/podcasts/shows/[id]/episodes` — that show's episodes (id, title, description, episode_number, season_number, duration, pub_date, download_status).

**Admin write route** (new):
- `PATCH /api/admin/podcasts/episodes/[id]` — edit title/description/episode_number/season_number. Mirrors `admin/music/tracks/[id].patch.ts`'s shape, validation, and auth (admin-only).

**New auth helper** — `canAccessPodcastEpisode(episodeId, event)` in `server/utils/auth.ts`, mirroring `canAccessMusicTrack`: checks the parent show's `visibility`, allows admin bypass, fails closed on any error.

No changes to any of the 11 existing admin routes from sub-project 2.

## File-Serving Route

`server/routes/downloads-podcasts/[...path].ts`, mirroring `downloads-music`'s route:

- **Content types**: audio map (`.mp3`→`audio/mpeg`, `.m4a`→`audio/mp4`, `.ogg`→`audio/ogg`, `.wav`→`audio/wav`) + image map (`.jpg`/`.jpeg`, `.webp`, `.png`) for show cover art.
- **Path shape**: flat convention, `{showDir}/{episodeId}.{ext}` — exactly two segments, matching how `downloadEpisodeFile` already writes `local_file_path`.
- **Lookup**: resolve `episodeId` from the filename, join `podcast_episodes` → `podcast_shows`, require `download_status = 'completed'`.
- **Access check**: `canAccessPodcastEpisode()`.
- **Path containment**: double check — resolved path must stay inside both the show directory and the overall podcast downloads directory — matching music's belt-and-braces guards.
- **Caching**: `Last-Modified`/`If-Modified-Since` 304 handling for non-audio (cover images), matching music's non-audio branch.
- **Range requests**: during implementation, confirm whether `downloads-music`'s audio branch supports HTTP `Range` requests for scrubbing; if it does, the podcast route must too, since episodes typically run much longer than music tracks and range support matters more for them.

## Catalog Page & Episode Editing

**`/podcasts` page**: grid view lists shows (cover, title, episode count, visibility badge for admins); clicking a show sets `?showId=` and swaps to a detail view listing that show's episodes (title, duration, pub date, download-status badge) with a back button — mirrors `/music`'s `artistId` grid/detail pattern exactly. v1 filtering is title-search only.

**`PodcastEpisodeEditModal.vue`**: title, episode_number, season_number, description fields, `BaseModal` wrapper, same form/save/toast pattern as `MusicTrackEditModal.vue`, calls `PATCH /api/admin/podcasts/episodes/[id]`. Reachable via an edit affordance on each episode row, admin-only.

## Space-Switcher

New entry in `app/spaces/index.ts`:

```ts
{
  id: 'podcasts',
  label: 'Podcasts',
  icon: '<svg ... mic icon ...>',
  homeRoute: '/podcasts',
  navLinks: [
    { to: '/podcasts', label: 'Bibliothèque', icon: '<same mic icon>', hideWhenMustChangePassword: true },
  ],
}
```

Always visible (no module gate — see Non-Goals). One nav link, matching Music's single "Bibliothèque" entry.

## Error Handling

- **Empty states**: reuse the existing `EmptyState` component ("Aucun podcast archivé" / "Aucun résultat" for filtered search).
- **Failed downloads**: episode rows show a `download_status` badge (failed/downloading/pending/completed), reusing music's badge classes.
- **Broken feed on ingest**: the add-feed form surfaces the generic server-side error message already returned by `POST /api/admin/podcasts/ingest` (per sub-project 2's error-message-leakage fix — no internal detail leaks to the client).
- **File-serving 404/403**: fail-closed, matching music's route exactly — a 404 for a missing/wrong-extension file reveals nothing about whether a differently-extensioned file exists at that path; a 403 on a visibility mismatch.

## Testing

Per this project's established convention:
- Vue component tests (via the `@nuxt/test-utils`/`mountSuspended` infra from the bug-fixes initiative) for `PodcastEpisodeEditModal.vue`'s form logic, and for any pure catalog-filtering helper if one emerges.
- No automated tests for the file-serving route or live API interactions — those get manual live verification during implementation (using the dev-login fixture pattern), matching sub-project 2's treatment of `downloadEpisodeFile`.
