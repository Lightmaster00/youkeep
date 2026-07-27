# Music Admin Ingestion UI — Design

## Context

Second of three pieces in Music mode's sub-project 3 ("library UI"). Sub-project 3a (file serving & access control) is done and merged. Sub-project 2 (ingestion pipeline) built the full backend — `ingestMusicUrl`, the concurrent worker, and five admin action endpoints under `server/api/admin/music/` (`ingest`, `pause`, `resume`, `artists/[id]/sync`, `tracks/[id]/cancel`) — but no frontend consumes any of it, and (discovered during this sub-project's scoping) no *read* endpoints exist either: there's no music equivalent of `server/api/admin/downloader/queue.get.ts` or `concurrency.get.ts`/`.post.ts`. Without those, no UI can show anything. This spec covers building both the missing read endpoints and the admin UI that consumes the full set.

## Scope

- Two new GET (one also POST) endpoints under `server/api/admin/music/`: a queue/artists listing, and concurrency setting read/write.
- A new "Music" tab in `app/pages/settings.vue`, mirroring the existing "Downloads" tab's structure and visual style, scoped to: add an artist, global pause/resume + concurrency control, a followed-artists list with a per-artist sync trigger, and a queue list with per-track cancel.

## Non-Goals

- No bulk "retry all failed" / "clear queue" actions for music — no backend support exists for these on the music side, and the plan's Global Constraints don't require them. Out of scope; can be added later if the admin workflow proves to need it.
- No channel-name search (the video pipeline's `search-channels` endpoint) — the add-artist form takes a URL/handle directly. Music ingestion has none of the options (`download_videos`/`shorts`/`lives`, `date_after`, `custom_save_path`) that made the video pipeline's search-then-configure-modal flow worthwhile; a direct URL field is the right-sized equivalent.
- No catalog browsing (artist detail pages, album grouping, genre/language/year filtering, manual metadata editing) — that's sub-project 3c.
- No playback — out of scope for all of sub-project 3 (agreed at the start of this sub-project).
- No changes to the existing "Downloads" (video) tab or any of its endpoints.

## Design

### 1. `GET /api/admin/music/queue`

Mirrors `server/api/admin/downloader/queue.get.ts`, adapted for the music schema (no `priority`/`is_short`/`is_manually_queued` columns on `music_tracks`, so the `ORDER BY` drops those clauses, matching how the sub-project-2 worker's own pick query already had to adapt). Response shape:

```typescript
{
  queue: Array<{ id, title, artist_name, download_status, download_progress, download_speed, download_eta, last_error }>,
  history: Array<{ id, title, artist_name, created_at }>, // last 10 completed, mirrors video's queue.get.ts
  artists: Array<{ id, name, avatar_url, sync_status, visibility, track_count }>,
  isPaused: boolean,
  failedCount: number
}
```

`artists` is a new addition with no video-pipeline equivalent in `queue.get.ts` (the video "Downloads" tab has a separate channels page for that) — included here because the admin needs to see which artists exist to pick one to sync, and this sub-project isn't building a separate music channels/artists page (that's 3c's catalog UI). `track_count` is a `COUNT(*)` over `music_tracks` grouped by `artist_id`.

### 2. `GET`/`POST /api/admin/music/concurrency`

Byte-for-byte mirror of `server/api/admin/downloader/concurrency.get.ts`/`.post.ts`, retargeted at the `music_max_concurrent_downloads` setting key. Reuses `parseMaxConcurrentDownloads`/`isValidMaxConcurrentValue` from `server/utils/concurrency.ts` as-is (already generic, no video-specific logic in that module).

### 3. Settings UI — new "Music" tab

Added to the existing tab bar in `app/pages/settings.vue` (`stats`/`downloads`/`users`/`system`), following the identical `:class="{ active: activeTab === '...' }"` / `@click="activeTab = '...'"` pattern.

**Add-artist form**: one text input (URL or `@handle`), a visibility `<select>` with exactly three hardcoded options (`Public`/`Private`/`Ultra Private` → `public`/`private`/`ultra_private` — never a free-text field, per sub-project 3a's finding that `canAccessMusicTrack` fails closed on an unrecognized value but the ingest endpoint itself still doesn't validate it, so the UI is the only current guardrail), and an "auto-sync" checkbox (maps to `sync_status: 'downloading'` vs `'paused'` when calling `POST /api/admin/music/ingest`).

**Global controls row**: pause/resume button (mirrors `toggleGlobalPause`'s pattern, calling the music pause/resume endpoints and flipping local state) plus a numeric concurrency input + save button (mirrors the video "Max concurrent downloads" control built in the concurrent-downloads sub-project, retargeted at the new music concurrency endpoints).

**Artists list**: one card per followed artist — `<img>` pointing directly at `avatar_url` (the hotlinked YouTube CDN URL; no local serving, per sub-project 3a) with a fallback image on error (same `@error` pattern already used for channel avatars elsewhere in this file), name, a sync-status badge, a visibility badge, track count, and a "Sync" button calling `POST /api/admin/music/artists/[id]/sync`.

**Queue list**: reuses the existing `.queue-list-premium`/`.queue-card-premium` CSS classes and structure (title, artist name in place of channel name, status badge, progress bar, speed/ETA when downloading, error message when failed, a cancel button calling `POST /api/admin/music/tracks/[id]/cancel`) — visually consistent with the Downloads tab's queue, not a new visual language.

## Error Handling

- Add-artist form: empty input blocked client-side (`required`); a 400/500 from the ingest endpoint shows the existing toast-error pattern already used throughout this file.
- Sync button on an artist with no `channel_id` (a feat-only artist — can exist per the sub-project-1 schema) hits the existing 400 guard already built into `artists/[id]/sync.post.ts`; the UI shows that error via toast rather than needing a new client-side check (the button simply isn't expected to appear for feat-only artists in practice, since they're never something an admin directly "follows", but the guard is defense in depth either way).
- Cancel button on an already-completed/already-cancelled track: `cancelMusicDownload` is idempotent (mirrors `cancelDownload`), so a double-click or stale-UI click is harmless.
- Concurrency input: client sends whatever's typed; the existing server-side `isValidMaxConcurrentValue` rejects non-integers/values below 1 with a 400, shown via toast — no new client-side validation logic needed, matching how the video concurrency control already handles this.

## Verification

- `GET /api/admin/music/queue` against the current DB state (GIMS artist + its completed/pending tracks from prior sub-projects' live tests) returns the expected shape with correct counts.
- `GET`/`POST /api/admin/music/concurrency` round-trips a value the same way the already-verified video concurrency endpoints do (default 2, reject invalid, persist valid).
- In the browser: add an artist via URL, confirm it appears in the artists list and its tracks appear in the queue as `pending`/`downloading`.
- Toggle visibility on the add-artist form through all three options, confirm the submitted value is one of exactly `public`/`private`/`ultra_private` (never anything else) by inspecting the request body.
- Click Sync on an existing artist, confirm a toast and that the queue updates.
- Click Cancel on an in-progress track, confirm it stops and reverts to `pending`.
- Pause globally, confirm the button/label state flips and in-flight tracks stop; resume, confirm they continue.
