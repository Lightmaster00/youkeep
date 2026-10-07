# Podcasts: Follow + Resume — Design

**Status:** Approved in chat (2026-10-08). Sub-project 2 of 4 (after music favorites/playlists; next: Discover pages, listening history).

## Goal
Per-user followed shows, a "new episodes" view, and server-side playback progress so listening resumes on any device.

## Decisions
- Everything is private per user; guests get none of it (UI hidden, API 401). "Follow" is unrelated to the admin adding a show to the library.
- "New" = a completed episode of a followed show, published after the follow date (COALESCE(pub_ts, created_at) > follow.created_at), and not started/played by the user.
- Out of scope: notifications, Home row (Continue listening on Home was declined), History page (sub-project 4).
- English copy only.

## Data (idempotent migrations in `server/utils/db.ts`, cascade FKs; mirror in `tests/helpers/testDb.ts`)
- `podcast_show_follows(user_id, show_id, created_at, PRIMARY KEY(user_id, show_id))` + index `(user_id, created_at DESC)`.
- `podcast_episode_progress(user_id, episode_id, position_seconds INTEGER NOT NULL, duration_seconds INTEGER, completed INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL, PRIMARY KEY(user_id, episode_id))` + index `(user_id, updated_at DESC)`.
- Limit: ≤ 500 followed shows per user.

## API (logged-in only; visibility via `podcastVisibilityClause`; ids validated; invalid ids → 404 where the id addresses a resource)
- `PUT /api/podcasts/shows/:id/follow`, `DELETE …/follow` (idempotent; the show must be visible to the caller).
- `GET /api/podcasts/follows` → `[{ show fields (same as shows index), followedAt, newCount }]`, newest follow first; only visible shows.
- `POST /api/podcasts/follows/status` body `{ ids: string[] }` (≤ 200) → `{ followed: string[] }`.
- `GET /api/podcasts/subscribed-episodes?limit&offset` → `{ items, total }` latest completed episodes of followed shows (same ordering as recent: COALESCE(pub_ts, created_at) DESC, id DESC), each with the user's progress.
- `PUT /api/podcasts/episodes/:id/progress` body `{ positionSeconds, durationSeconds? , completed? }` (clamped, integers; completed also set server-side when position ≥ duration − 10s; a later lower position on a completed episode is accepted and resets completed to 0 only if `completed:false` is sent).
- `POST /api/podcasts/episodes/progress/status` body `{ ids: string[] }` (≤ 200) → `{ progress: { [id]: { positionSeconds, durationSeconds, completed } } }`.
- `GET /api/podcasts/continue?limit=` → in-progress (not completed, position > 5s) episodes of visible shows, most recently updated first, with progress.
- `PUT /api/podcasts/episodes/:id/played` body `{ played: boolean }` (mark played = completed 1; unplayed = row deleted).
- Episode/show endpoints already used by Library/Recent/show detail additionally return progress when the caller is logged in only through the batch `status` call (no change to existing responses).

## UI
- `ShowFollowButton.vue` (optimistic with rollback + toast) on show cards and the show detail view; state via `usePodcastFollows` composable (batched `follows/status`, per-session cache reset on user change).
- Player: `usePodcastPlayer` syncs progress to the server (throttled ~15 s while playing, on pause, on ended, on page hide via `fetch keepalive`/sendBeacon-safe path using the patched fetch) for logged-in users; on play/restore the server position is used when it is newer than the localStorage one (localStorage stays the fallback for guests/offline). Existing end-of-episode tolerance logic is kept.
- Episode rows (Library, Recent, show detail, Subscribed) show a thin progress bar and a "Played" mark via `usePodcastProgress` (batched `progress/status`); a row menu "Mark as played / unplayed".
- Pages: `/podcasts/subscribed` (grid of followed shows with "N new" badge, "Continue listening" row on top, then "Latest from your shows" list with Load more) and a "Continue listening" row at the top of `/podcasts` (Library) for logged-in users with something in progress. Empty states: "You are not following any show yet" / "Nothing in progress".
- Sidebar (`app/spaces/index.ts`): Podcasts = Library, Subscribed, Recent; Subscribed carries `requiresUser`; module gating unchanged.

## Testing
- Server integration: follow/unfollow idempotency + visibility + limit, `follows` newCount semantics (published before follow date not counted, played excluded), progress upsert/clamp/completed rules, continue list filtering/order/visibility, played toggle, status batches, ownership/auth, cascades.
- Unit: progress helpers (clamp, completed threshold, merge server vs local position).
- Component: follow button (optimistic + rollback), subscribed page, continue row, episode progress bar + mark played, sidebar guest hiding; player sync throttle with fake timers.
- Real check by the controller in Docker + Browser pane: follow, play (fake file ok for state), progress persisted via API, subscribed page, mark played; desktop + phone width; UI clicks must succeed (CSRF).
