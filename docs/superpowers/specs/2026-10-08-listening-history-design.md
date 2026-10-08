# Listening history (Music + Podcasts) — Design

**Status:** Approved in chat (2026-10-08). Sub-project 4 of 4 (last).

## Goal
Per-user history pages for music plays and podcast episodes, with removal and clear-all.

## Decisions
- Private per user; logged-in only (API 401, links hidden for guests). Invisible tracks/episodes (module off or visibility) are never returned; the rows stay stored.
- Music source: `music_play_history` (already written by `server/api/music/tracks/[id]/play.post.ts`). Podcast source: `podcast_episode_progress` (rows exist once an episode was started or marked played).
- Music history is deduplicated per track: one entry per track with its latest `played_at` (and `playCount` of plays), newest first. Days are grouped client-side (Today / Yesterday / date).
- Removing a podcast episode from history deletes its progress row (resume position is lost) — the UI says so. Out of scope: stats, video history (already exists).
- English copy only; phone-width friendly (actions wrap under the title at ≤560px).

## API (logged-in; all items filtered by `musicVisibilityClause` / `podcastVisibilityClause`)
- `GET /api/music/history?limit&offset` → `{ items: Track[] & { playedAt, playCount }, total }`; `limit` default 30, max 100; `total` = distinct visible tracks in history. Track shape = `musicTrackRows` shape.
- `DELETE /api/music/history/:trackId` → deletes all of the user's plays of that track (idempotent, `{ removed: n }`). `DELETE /api/music/history` → clears the user's whole music history.
- `GET /api/podcasts/history?limit&offset` → `{ items: Episode & { progress: {positionSeconds,durationSeconds,completed,updatedAt} }, total }` ordered by `updated_at DESC, episode_id DESC`.
- `DELETE /api/podcasts/history/:episodeId` (deletes that progress row; idempotent), `DELETE /api/podcasts/history` (clears all of the user's progress rows).
- All mutations are scoped to the caller's `user_id` (no way to touch other users' rows).

## UI
- `/music/history`: day headings, `MusicTrackList` rows (like, add-to-playlist, play on click, per-row "Remove from history" button via the `actions` slot), "Clear history" button with a confirmation dialog, Load more, empty state "No listening history yet". Optimistic removal with rollback + toast.
- `/podcasts/history`: `PodcastEpisodeRow` list with progress bar / Played mark, per-row "Remove from history" (tooltip: "Also resets the resume position"), "Clear history" with confirmation, Load more, empty state.
- Sidebar (`app/spaces/index.ts`): Music = Library, Discover, Liked songs, Playlists, Recent, History; Podcasts = Library, Discover, Subscribed, Recent, History; History links carry `requiresUser`, not hideable.

## Testing
- Server integration: ordering, dedupe + playCount, visibility filtering, paging/total, per-user isolation, delete one / clear all idempotency and scoping, auth 401.
- Component: both pages (day grouping, remove with rollback, clear confirmation flow, empty state, load more), sidebar guest hiding.
- Real check by the controller in Docker + Browser pane: seed plays/progress with sqlite3, click remove and clear (CSRF), phone width.
