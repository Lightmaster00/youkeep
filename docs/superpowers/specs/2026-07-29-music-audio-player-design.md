# Music Audio Player (Sub-project 4) — Design

## Context

Fourth sub-project of Music mode, following sub-project 3 (library UI: file serving, admin ingestion UI, space switcher, catalog browsing, metadata editing — all done and merged). Playback has been explicitly out of scope for all of sub-project 3; this sub-project adds it. `server/routes/downloads-music/[...path].ts` currently serves images only and explicitly rejects audio extensions ("this route serves images only"); `music_tracks.local_file_path` has been populated by ingestion since sub-project 2 but nothing has ever read it for playback.

## Scope

- Extend `server/routes/downloads-music/[...path].ts` to serve audio files with HTTP Range support (206 Partial Content), reusing the access-control and path-containment logic already in that file.
- New global playback composable `app/composables/useMusicPlayer.ts`, following the `useAuth`/`useToast` pattern (Nuxt `useState`, not module-level refs).
- New persistent mini-player component mounted in `app/layouts/default.vue`, visible once a track has been played, surviving navigation across the app.
- Wire track rows on `/music`'s artist detail view to start playback, with the queue set to the already-loaded tracks of the clicked group.

## Non-Goals

- No playback-state persistence across a full page reload (no `localStorage`) — a reload resets to nothing playing.
- No "queue the whole artist" beyond the currently-displayed group (album or "sans album") — matches the existing per-group lazy-pagination design from sub-project 3c-i; if more tracks exist beyond what's loaded, playback simply stops at the end of what's loaded, same as today's "Charger plus" boundary.
- No shuffle, no repeat, no user-created playlists of tracks.
- No changes to `canAccessMusicTrack` or any other access-control logic — audio streaming reuses the exact same check already enforced for thumbnails on this route.
- No admin-specific playback controls or behavior — playback works identically for any user who can already see the track (same visibility tiers as everything else in Music mode).

## Design

### 1. `server/routes/downloads-music/[...path].ts` — audio support

Currently `IMAGE_CONTENT_TYPES` maps image extensions to content types and rejects everything else with a 404 that "reveals nothing about whether a non-image file exists." Add a parallel `AUDIO_CONTENT_TYPES` map:

```ts
const AUDIO_CONTENT_TYPES: Record<string, string> = {
  '.m4a': 'audio/mp4',
  '.opus': 'audio/opus',
  '.webm': 'audio/webm',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
};
```

The route's flow (path validation, track lookup, `canAccessMusicTrack` check, artist-directory resolution, containment checks) stays identical for both content types — only the final "read and return the file" step branches:

- **Image path** (unchanged): `fs.createReadStream(resolvedPath)`, no Range support, `Content-Length` set to full file size.
- **Audio path** (new): mirrors `server/routes/downloads/[...path].ts`'s existing Range-request handling verbatim — reads the `Range` request header, responds `206` with `Content-Range`/`Content-Length` for the requested byte range via `fs.createReadStream(path, { start, end })` when present, or a plain `200` full-file stream when absent. Sets `Accept-Ranges: bytes` on both. This is a direct reuse of proven, already-shipped logic, not new design.

### 2. `app/composables/useMusicPlayer.ts`

```ts
export interface PlayableTrack {
  id: string;
  title: string;
  artist_name?: string;
  local_file_path: string;
  local_thumbnail_path: string | null;
  duration: number | null;
}
```

State via `useState` (SSR-safe, shared across every component that calls the composable, matching `useAuth`'s pattern exactly):
- `currentTrack: PlayableTrack | null`
- `queue: PlayableTrack[]`
- `currentIndex: number`
- `isPlaying: boolean`
- `currentTime: number`, `duration: number`
- `audioEl: HTMLAudioElement | null` — set once by the mini-player component on mount (`useState` again, so any caller can reach the same element)

Functions: `play(track, queue)` (sets `queue`/`currentIndex` to the clicked track's position, sets `currentTrack`, sets `audioEl.src` and calls `.play()`), `togglePlay()`, `seek(seconds)`, `next()`/`prev()` (advance/retreat `currentIndex`, no-op silently at the queue's ends), and an internal `onEnded` handler wired to the `<audio>` element's `ended` event that calls `next()` only if not already at the last index (matches "stops at the end of the group").

### 3. Mini-player component — `app/components/MusicMiniPlayer.vue`

Mounted once in `app/layouts/default.vue`, alongside the existing toast container. Renders nothing (`v-if="currentTrack"`) until a track has been played. Fixed to the bottom of the viewport: thumbnail (`local_thumbnail_path` with the existing music-note fallback SVG), title + artist, a clickable/seekable progress bar (mirrors the interaction pattern already built in `VideoPlayer.vue`'s `progress-bar-container`, without needing that component's full feature set — hover-scrub preview, fullscreen, keyboard shortcuts, subtitles, etc. are all video-specific and out of scope here), play/pause, previous/next (disabled at queue boundaries), and a volume slider bound directly to the `<audio>` element's `.volume`.

`app/layouts/default.vue`'s `.content-area` gets a `padding-bottom` applied via a class bound to `!!currentTrack`, so the bar never overlaps page content.

### 4. Wiring playback into `/music`

Each track row in `app/pages/music/index.vue`'s expanded album/standalone sections becomes clickable (a new `@click="playTrack(track, groupKey)"` on the row, with the existing admin pencil button's `@click.stop` already isolating it from this). `playTrack` calls `useMusicPlayer().play(track, trackGroups[groupKey].tracks)` — the queue is exactly the array already held in that group's reactive state, so no new fetch is needed. The row for `currentTrack?.id === track.id` gets a visual "now playing" indicator (an accent-colored left border or equivalent, reusing the same accent treatment already established for the space-switcher's active-item indicator).

## Error Handling

- A track whose `local_file_path` is `null` (shouldn't happen for a `completed` track, but defensively) is simply not clickable — `playTrack` no-ops if `local_file_path` is falsy.
- An audio load/network failure surfaces via the `<audio>` element's native `error` event, mapped to a toast error (existing `useToast` pattern) and playback stops (mini-player stays visible showing the failed track, paused, rather than disappearing).
- The streaming route's existing 403/404 behavior (wrong visibility tier, missing file, path traversal attempt) is unchanged and already covered by sub-project 3a's tests — no new access-control tests needed, only new tests for the audio-extension/Range-request branch added here.

## Verification

- Route tests: audio extension → correct `Content-Type`, `Accept-Ranges: bytes`; a `Range` header produces a `206` with correct `Content-Range`/`Content-Length`; no `Range` header produces a full `200` stream; access-denied and path-traversal cases behave identically to the existing image tests (parameterized reuse of that test suite's structure where practical).
- Browser: click a track on `/music`, confirm the mini-player appears and audio plays; click a second track in the same group, confirm it plays next immediately and the queue reflects it; let a track finish, confirm auto-advance to the next queued track; reach the end of the queue, confirm playback stops cleanly; navigate away from `/music` to another page, confirm the mini-player and audio keep playing; use the progress bar to seek; use previous/next buttons at both queue boundaries (no-op, no crash).
- `npx vue-tsc -b --noEmit` clean.
