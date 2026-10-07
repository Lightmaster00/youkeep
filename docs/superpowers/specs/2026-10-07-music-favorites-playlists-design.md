# Music Favorites + Personal Playlists — Design

**Status:** Approved in chat (2026-10-07). Sub-project 1 of 4 of "make Music and Podcasts feel like Spotify / YT Music" (next: podcasts follow + resume, Discover pages, listening history — each its own spec).

## Goal
Per-user liked songs and personal music playlists, reachable from every place a track is shown.

## Decisions
- Private per user. No playlist sharing in this version. Guests have no favorites or playlists (UI hidden, API 401).
- Existing generated mixes (radio, rediscover, most played, genre/artist mix, recently added) stay in the Music Library.
- Reordering uses up/down buttons (no drag and drop yet). English copy only.

## Data (idempotent migrations in `server/utils/db.ts`, FKs with ON DELETE CASCADE)
- `music_favorites(user_id, track_id, created_at, PRIMARY KEY(user_id, track_id))` + index on `(user_id, created_at DESC)`.
- `music_user_playlists(id TEXT PK, user_id, title NOT NULL, description, created_at, updated_at)` + index on `user_id`.
- `music_user_playlist_tracks(playlist_id, track_id, position INTEGER NOT NULL, added_at, PRIMARY KEY(playlist_id, track_id))`. Positions stay dense 0..n-1 after add/remove/reorder.
- Limits: title 1–100 chars (trimmed), description ≤ 500, ≤ 200 playlists per user, ≤ 2000 tracks per playlist.

## API (all require a logged-in user; mutations go through the existing CSRF/session middleware; ids validated; a track must be visible to the caller — reuse `musicVisibilityClause` — to be added/returned)
- `GET /api/music/favorites?limit&offset` → `{ items: Track[], total }` newest first (track shape identical to `recently-added`).
- `PUT /api/music/favorites/:trackId` / `DELETE /api/music/favorites/:trackId` (idempotent).
- `POST /api/music/favorites/status` body `{ ids: string[] }` (≤ 200) → `{ liked: string[] }`.
- `GET /api/music/user-playlists` → `[{ id, title, description, trackCount, coverTrackIds (first 4), updatedAt }]`.
- `POST /api/music/user-playlists` `{ title, description? }`; `PUT /api/music/user-playlists/:id` `{ title?, description? }`; `DELETE /api/music/user-playlists/:id`.
- `GET /api/music/user-playlists/:id` → `{ playlist, tracks: Track[] }` (tracks the caller can't see are omitted from the list but keep their rows).
- `POST /api/music/user-playlists/:id/tracks` `{ trackId }` (appends; no duplicate; returns new count); `DELETE /api/music/user-playlists/:id/tracks/:trackId`; `PUT /api/music/user-playlists/:id/order` `{ trackIds: string[] }` (must be a permutation of the current ids).
- A playlist is only ever readable/changeable by its owner (404 for others, no existence oracle). Admin has no special access.

## UI
- Heart toggle component `TrackLikeButton.vue` (optimistic with rollback + toast on failure; initial states loaded in one `favorites/status` call per rendered list via a small composable `useMusicLikes`, cached per session) on track rows/cards in the Music Library, Recent page, artist/album views and the Music mini-player.
- `AddToPlaylistMenu.vue`: popover listing the user's playlists with a check on those already containing the track and a "New playlist" inline field; used from the same places.
- Pages: `/music/liked` (Play, Shuffle, list with unlike), `/music/playlists` (grid of playlists + "New playlist"), `/music/playlists/[id]` (title edit, description, Play, Shuffle, per-track remove, move up/down, delete playlist with confirmation). Empty states "No liked songs yet" / "No playlists yet". Play uses the existing music player composable with the list as the queue.
- Sidebar (`app/spaces/index.ts`): Music = Library, Liked songs, Playlists, Recent (new links not hideable; `moduleForPagePath` already covers `/music/*`). Guests don't see Liked songs/Playlists.
- Responsive like the other Music pages; English copy; no French (guard test).

## Testing
- Server integration: each endpoint (auth required, validation, limits, idempotency, ownership 404, visibility filtering, order permutation check, cascade on track/user/playlist delete, dense positions).
- Unit: positions helper, limits.
- Component: like button (optimistic + rollback), add-to-playlist menu (toggle, create), playlist page (reorder, remove), sidebar links hidden for guests.
- Real check in Docker + Browser pane: seed tracks, like, create playlist, add, reorder, play (UI), delete; desktop + mobile; a UI click that mutates must succeed (CSRF).
