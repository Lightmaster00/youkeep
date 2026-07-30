# Music Audio Player & Smart Playlists (Sub-project 4) — Design

## Context

Fourth sub-project of Music mode, following sub-project 3 (library UI — done and merged). Playback has been explicitly out of scope for all of sub-project 3; this sub-project adds it, plus persistence, shuffle/repeat, and heuristic-based automatic playlists/recommendations. `server/routes/downloads-music/[...path].ts` currently serves images only and explicitly rejects audio extensions; `music_tracks.local_file_path` has been populated since sub-project 2 but nothing has ever read it for playback. No listening-history table exists for music today (video has its own `user_history`, unrelated).

Scope was expanded mid-brainstorm from a plain player to include localStorage resume, shuffle/repeat, and automatic playlists — decided together in this session rather than split into a later sub-project, since the user wants the full picture designed now.

## Scope

- Audio streaming with HTTP Range support on the existing image-serving route.
- Global playback composable + persistent mini-player, surviving navigation.
- Playback resume via `localStorage` (track + position + full queue).
- Shuffle and repeat modes.
- A new `music_play_history` table + an endpoint to record plays.
- Four heuristic "automatic playlists": most played, recently added, rediscover (never/rarely played), and per-genre mixes — surfaced as clickable cards on `/music`'s grid view that immediately start playback.

## Non-Goals

- No audio content analysis, embeddings, or ML-based similarity — everything here is SQL over metadata + play counts, matching YouKeep's self-hosted, small-scale nature.
- No cross-session/cross-device sync of playback state — `localStorage` is per-browser, not accessible server-side.
- No admin-specific playback behavior — identical for any user who can already see the track.
- No user-created manual playlists (a "my playlist" builder) — only the four algorithmic ones listed above.
- Play-history recording requires being logged in (matches the existing per-user `user_history` pattern on the video side); guests can still listen, but their plays aren't recorded, and the "most played"/"rediscover" playlists are empty/hidden for guests since they're inherently per-user.

## Design

### 1. `server/routes/downloads-music/[...path].ts` — audio support

Add an `AUDIO_CONTENT_TYPES` map alongside the existing `IMAGE_CONTENT_TYPES`:

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

Path validation, track lookup, `canAccessMusicTrack` check, artist-directory resolution, and containment checks stay identical for both content types. Only the final "read and return" step branches: images keep their current full-stream response; audio reuses `server/routes/downloads/[...path].ts`'s already-shipped Range-request handling verbatim (`Range` header → `206` + `Content-Range` via `fs.createReadStream(path, {start, end})`; no header → full `200` stream; `Accept-Ranges: bytes` on both).

### 2. `music_play_history` table

```sql
CREATE TABLE music_play_history (
  id TEXT PRIMARY KEY,
  track_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  played_at INTEGER NOT NULL,
  FOREIGN KEY (track_id) REFERENCES music_tracks(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

One row per counted play (not per click) — see §3 for what counts.

### 3. `POST /api/music/tracks/[id]/play`

Called by the client once a track has played past a threshold (`currentTime >= min(30, duration * 0.5)`), mirroring the "counted view" convention already implicit in `music_tracks.view_count` from ingestion. Requires login (`getUserFromSession`); silently no-ops (`200`, does nothing) for a guest rather than erroring, so playback itself is never blocked by auth. `canAccessMusicTrack` is still checked — a play can't be recorded for a track the user can't access, even via a crafted direct request. One row inserted per call; the client is responsible for calling this at most once per track-per-listen (a `hasCountedThisPlay` flag reset whenever `useMusicPlayer.play()` loads a new track).

### 4. `app/composables/useMusicPlayer.ts`

Extends the previously-discussed shape with shuffle/repeat/persistence. State via Nuxt `useState` (matching `useAuth`'s SSR-safe shared-state pattern):

- `currentTrack`, `queue`, `currentIndex`, `isPlaying`, `currentTime`, `duration`, `audioEl` — as before.
- `shuffleOn: boolean`, `repeatMode: 'off' | 'all' | 'one'`.
- `shuffledOrder: number[] | null` — a shuffled permutation of queue indices, generated when shuffle is toggled on (Fisher–Yates, starting from the current track so playback doesn't jump); `next()`/`prev()` walk this order instead of `currentIndex` sequentially when shuffle is on. Toggling shuffle off resumes sequential order from whatever's currently playing.
- `repeatMode`: `'off'` stops at the end of the queue (current behavior); `'all'` wraps `next()` back to index 0 after the last track; `'one'` makes `next()` (including the auto-advance on `ended`) replay the same track.
- `next()`/`prev()` and the `ended` handler both route through shuffle/repeat state, so all three playback-advance paths (button click, auto-advance, and the composable's own boundary logic) stay consistent — no separate "shuffle-aware" and "normal" code paths to keep in sync.

**localStorage persistence:** a `watch` on `{currentTrack, currentIndex, queue, currentTime}` (debounced ~1s to avoid writing on every `timeupdate` tick) serializes `{trackId, queueTrackIds, currentIndex, currentTime, shuffleOn, repeatMode}` to `localStorage['music_player_state']`. On app mount (client-only, in the mini-player component's `onMounted`), if that key exists: re-fetch the referenced tracks' current data (via a new lightweight `POST /api/music/tracks/by-ids` taking an array of track ids — needed because `local_file_path`/`title`/etc. must reflect current DB state, not stale cached values, and a track might have been edited or removed since), reconstruct `queue`/`currentIndex`/`shuffleOn`/`repeatMode`, set `audioEl.currentTime` to the saved position, and leave `isPlaying = false` (restored paused, never autoplays on load — browsers block unprompted autoplay with sound anyway, so this is both a UX and a technical necessity).

### 5. `app/components/MusicMiniPlayer.vue`

As previously designed (thumbnail, title/artist, seekable progress bar, play/pause, prev/next, volume), plus two new controls: a shuffle toggle button and a repeat button that cycles `off → all → one → off` on each click, both bound directly to the composable's state.

### 6. Wiring playback into `/music`

Unchanged from the original design: track rows become clickable, `playTrack(track, groupKey)` calls `useMusicPlayer().play(track, trackGroups[groupKey].tracks)`, currently-playing row gets a visual indicator. The `ended`/auto-advance path additionally calls the play-history endpoint per §3 once the threshold is crossed (tracked via `timeupdate`, not `ended`, so a played-then-skipped track still counts if the threshold was reached).

### 7. Automatic playlists

Four new read endpoints under `server/api/music/playlists/`, each returning `{ tracks: PlayableTrack[] }` (same shape the mini-player queue already expects) filtered through the same three-tier visibility logic used everywhere else in Music mode (guest→public, user→public+private, admin→all) and `download_status = 'completed'` only:

- **`GET /api/music/playlists/most-played`** — requires login (empty list for guests); `SELECT track_id, COUNT(*) as play_count FROM music_play_history WHERE user_id = ? GROUP BY track_id ORDER BY play_count DESC LIMIT 30`, joined back to track/artist data.
- **`GET /api/music/playlists/recently-added`** — no login required; `ORDER BY music_tracks.created_at DESC LIMIT 30`. Works for guests since it needs no history.
- **`GET /api/music/playlists/rediscover`** — requires login (empty for guests); tracks with zero rows in `music_play_history` for this user, or whose most recent play is older than 30 days, `ORDER BY RANDOM() LIMIT 30`.
- **`GET /api/music/playlists/genre-mix?genre=X`** — no login required; `WHERE genre = ? ORDER BY RANDOM() LIMIT 30`. The `/music` page fetches the existing `facets.genres` list (already returned by `GET /api/music/artists`, no new endpoint needed for the list itself) to know which genre cards to render — zero or more, purely data-driven.

**UI**: a new "Playlists automatiques" row of cards at the top of `/music`'s grid view (above the artist grid), one card per playlist that has at least one track (most-played/rediscover cards hidden entirely for guests, since those endpoints return empty by design — no point showing an always-empty card). Clicking a card fetches its endpoint and immediately calls `useMusicPlayer().play(tracks[0], tracks)` — starts playing right away, exactly like clicking a track row, no separate "playlist detail" page.

## Error Handling

- Play-history recording failures (network error, etc.) fail silently — never interrupt playback or surface an error toast for a background accounting call.
- `POST /api/music/tracks/by-ids` (localStorage restore) silently drops any id that no longer resolves or is no longer accessible to the current session, reconstructing the queue from whatever remains; if nothing remains, the saved state is discarded and the mini-player stays hidden.
- Audio load/network failures on the `<audio>` element: existing design unchanged (toast + paused state, mini-player stays visible).
- An empty automatic-playlist endpoint response (e.g. `genre-mix` for a genre that had tracks earlier but they were all deleted) simply doesn't render that card — not an error state.

## Verification

- Route tests: audio extension → correct content type + Range support (as originally scoped).
- Endpoint tests: play-history recording (login-gated, access-checked, no-op for guests); each of the four playlist endpoints' filtering/ordering/visibility logic, including the "requires login" empty-for-guest cases.
- Browser: play a track, reload the page, confirm the mini-player restores paused at the right position with the right queue; toggle shuffle mid-queue and confirm `next()` doesn't repeat/skip; toggle repeat through all three states at a queue boundary; click each playlist card and confirm playback starts with the right track set; confirm most-played/rediscover cards are absent when logged out.
- `npx vue-tsc -b --noEmit` clean.
