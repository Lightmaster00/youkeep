# Podcast Playback UI — Design Spec

Sub-project 4 (final) of YouKeep's Podcasts content-type module (data model → RSS ingestion → library UI → **playback UI**). Sub-projects 1–3 are done and merged to `main`: `podcast_shows`/`podcast_episodes` tables exist, RSS ingestion works, a stream-based downloader with queue/retry/scheduler exists, 11 admin API routes exist, and the library UI ships (space-switcher entry, `/podcasts` catalog page with shows grid ⇄ episode-list detail, `Settings > Podcasts` admin tab, a file-serving route with HTTP Range support at `server/routes/downloads-podcasts/[...path].ts`, episode metadata editing). There is currently no way to actually play an episode — episode rows just show a download-status badge.

This sub-project adds the missing playback layer, mirroring Music mode's own playback architecture (`useMusicPlayer.ts` + `MusicMiniPlayer.vue`) wherever it fits, and deliberately simplifying where podcasts' actual differences (episode length, no queue concept, speed control) justify it.

## Goals

- A persistent mini-player, mirroring `MusicMiniPlayer.vue`, mounted once in `app/layouts/default.vue` so it survives navigation across the whole app (not just within `/podcasts`).
- Play/pause, seek (clickable progress bar), skip ±15s/30s, and a playback-speed selector (0.75x–2x).
- Client-side-only resume: the last-played episode's position and chosen playback rate are restored from `localStorage` on page load (mini-player shows "resume" state; playback does not auto-start).
- A play button on each completed episode row in `/podcasts`'s detail view.

## Non-Goals

- **No episode queue/playlist concept.** No prev/next-episode, no shuffle, no repeat. Skipping within an episode (±15s/30s) covers the actual everyday use case; jumping to a different episode goes back through the catalog page.
- **No server-side resume position.** No new DB column/table. Resume is `localStorage`-only, per browser — consistent with how Music's own "resume" already works today (a restored queue/position, not a played-once flag).
- **No play-count / "recently played" / "most played" tracking.** No new endpoint, no new column. Nothing in the current podcast UI consumes such a signal, and building it now would be speculative — matches this project's established YAGNI discipline.
- **No video/clip mode** (Music's mini-player has an optional hidden `<video>` for clips; podcasts have no equivalent concept — plain `<audio>` only).
- **No changes to any of the podcast admin API routes, `podcastDownloader.ts`, or the file-serving route** — playback consumes the already-shipped `local_file_path` URLs (served by `downloads-podcasts/[...path].ts`, which already supports HTTP Range for scrubbing) as-is.

## Architecture

Three pieces:

1. **`app/composables/usePodcastPlayer.ts`** — global state via `useState` (mirroring `useMusicPlayer.ts`'s pattern): `currentEpisode`, `isPlaying`, `currentTime`, `duration`, `playbackRate`, `audioEl`. No `queue`/`currentIndex`/`shuffleOn`/`repeatMode`. Actions: `play(episode)`, `togglePlay()`, `seek(seconds)`, `skipBack()` (-15s), `skipForward()` (+30s), `setPlaybackRate(rate)`, `saveToLocalStorage()`/`restoreFromLocalStorage()`.
2. **`app/components/PodcastMiniPlayer.vue`** — mirroring `MusicMiniPlayer.vue`'s structure and CSS conventions, using a native `<audio>` element (no hidden `<video>`), mounted once in `app/layouts/default.vue` alongside `<MusicMiniPlayer />`.
3. **`app/pages/podcasts/index.vue` (modified)** — a play button on each completed episode row, calling `play(episode)`.

## `usePodcastPlayer.ts`

```ts
export interface PlayableEpisode {
  id: string;
  title: string;
  show_title?: string;
  show_cover_url?: string | null;
  duration?: number | null;
  local_file_path: string;
}
```

- `play(episode)`: replaces whatever was playing (no queue append). Loads `local_file_path` into `audioEl`, resets `currentTime` to 0 unless restoring a saved position for that same episode ID, then plays.
- `playbackRate`: `useState<number>('podcast_player_rate', () => 1)`. Persisted to `localStorage` alongside position — the chosen speed carries forward to the next episode played, matching standard podcast-app behavior.
- Resume: `localStorage` key `podcast_player_state`, storing `{ episodeId, currentTime, playbackRate }` — deliberately lighter than Music's full-queue snapshot. `restoreFromLocalStorage()` on layout mount restores `currentEpisode`/`currentTime`/`playbackRate` into state (so the mini-player shows the episode ready to resume) but does **not** auto-play — consistent with Music's own restore behavior, which also requires a user click to resume.
- No `recordPlayIfThresholdReached` equivalent — no server calls during playback at all (per Non-Goals).
- `skipBack()`/`skipForward()` clamp the resulting time to `[0, duration]`.

## `PodcastMiniPlayer.vue`

Mirrors `MusicMiniPlayer.vue`'s markup/CSS conventions, with these differences:

- Native `<audio>` (visually hidden, drives playback), no `<video>`/clip-mode toggle.
- Cover art + episode title + show name (in place of Music's artist name).
- Controls: skip -15s / play-pause / skip +30s (replaces Music's prev/next-track).
- Progress bar: clickable to seek, time labels formatted `H:MM:SS` when the episode exceeds one hour, `MM:SS` otherwise (vs. Music's always-`MM:SS`, appropriate for its much shorter tracks).
- A playback-speed `<select>` (0.75x/1x/1.25x/1.5x/1.75x/2x), always visible (unlike Music's conditionally-shown clip toggle).
- No shuffle/repeat controls (no queue).
- On `@ended`: stop playback (`isPlaying = false`); no auto-advance (no next episode to advance to).
- On `@error`: show an error toast, set `isPlaying = false`, leave the mini-player visible but static (no crash, no silent failure).

## Catalog Integration

- In `app/pages/podcasts/index.vue`'s episode-list detail view, each row with `download_status === 'completed'` gains a play button (▶ icon) beside the existing status badge, calling `play(episode)` with `local_file_path`, `title`, the current show's `title`/`cover_url`, and `duration`.
- Rows with any other `download_status` keep no play affordance (nothing to play yet) — unchanged from today.

## Error Handling

- Playback errors (missing file, 403 from the serving route, unsupported codec) surface via the `<audio>` element's native `error` event → toast + `isPlaying = false`, mini-player stays visible but inert. No crash.
- A malformed/corrupted `localStorage` resume entry is handled the same defensive way Music's `restoreFromLocalStorage()` already does: `JSON.parse` failure clears the key and no-ops; a restored episode that 404s on play surfaces the same playback-error toast as any other failure.

## Testing

Per this project's established convention: a live playback component with no meaningful automated-test surface gets no automated tests (matching `MusicMiniPlayer.vue`, which has none) — verified manually in the plan's final task, as with every prior podcast sub-project. If pure, extractable logic emerges during implementation (a duration formatter, a skip-time clamp function), those specific pure functions should get real unit tests — the implementation plan will decide whether extracting them is worth it.
