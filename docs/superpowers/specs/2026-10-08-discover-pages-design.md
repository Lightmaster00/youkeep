# Discover pages (Music + Podcasts) — Design

**Status:** Approved in chat (2026-10-08). Sub-project 3 of 4 (after music favorites/playlists and podcast follow/resume; next: listening history).

## Goal
Give Music and Podcasts a Discover page built from existing data (plus favorites/follows/progress), with working destinations for every tile.

## Decisions
- Library pages do NOT read genre/language from the URL, so tiles get their own destination (a new genre page; podcast language is an in-page filter).
- Personal rows need a logged-in user; guests see only the non-personal rows. Empty rows are omitted. Module gating and visibility rules (`musicVisibilityClause`, `podcastVisibilityClause`) apply everywhere.
- Aggregates never reveal who follows/listens (counts only).
- English copy only; layouts must work at phone width (actions wrap, see MusicTrackList).

## Music — `/music/discover`
Rows, top to bottom (each omitted when empty):
1. **Made for you** (logged in): reuse the existing playlists endpoints as rows or mixes — Most played, Rediscover, Radio from the last played track, Mix from the top artist — plus a NEW **Mix from your liked songs**: `GET /api/music/playlists/liked-mix` returns up to 30 visible completed tracks: the user's liked tracks (shuffled sample) topped up with tracks by the same artists / same genres that are not liked, no duplicates, ordered deterministically per call input (seed query param for tests). Empty when the user has no favorites.
2. **Browse by genre**: `GET /api/music/genres` → `[{ genre, trackCount }]` (visible completed tracks, non-empty genres, grouped case-insensitively with the most common spelling as label, top 40 by count). Tiles link to `/music/genre/<encoded name>`.
3. **New albums**: `GET /api/music/albums/recent?limit` → latest albums having ≥1 visible completed track (cover, title, artist, year, trackCount); tiles link to `/music?artistId=<id>` (the Library already reads artistId).
4. **Artists to explore** (logged in): `GET /api/music/artists/explore?limit` → visible artists with completed tracks that the user has played ≤ 2 times in `music_play_history`, ordered by track count then name; tiles link to `/music?artistId=`.
- NEW page `/music/genre/[name]`: `GET /api/music/genres/:name/tracks?limit&offset` (case-insensitive exact match, visible completed, newest first, `total`), Play / Shuffle via `usePlayTrackList`, `MusicTrackList` with like/add actions, Load more, empty state "No tracks in this genre". Unknown genre → empty list (not an error).

## Podcasts — `/podcasts/discover`
1. **Popular with listeners**: `GET /api/podcasts/discover/popular?limit` → visible shows ordered by number of distinct followers (COUNT of `podcast_show_follows`), then by episode count; only shows with ≥1 follower; response has `followerCount` but no user data.
2. **Recently updated**: latest visible shows ordered by their newest completed episode (COALESCE(pub_ts, created_at)), with the latest episode title/date.
3. **Trending episodes**: `GET /api/podcasts/discover/trending?limit` → completed visible episodes ranked by distinct users with progress `updated_at` in the last 14 days (ties: newest), with `listenerCount`; episodes with 0 listeners are excluded.
4. **Because you follow …** (logged in, ≥1 follow): visible shows in the same language(s) as the user's followed shows that the user does not follow, ordered by follower count then recency; label "Because you follow <most recently followed show title>". Omitted if no candidates.
5. **Browse by language**: `GET /api/podcasts/discover/languages` → `[{ language, showCount }]`; chips filter rows 1–2 in place (client re-queries with `?language=`; endpoints above accept an optional `language` query, case-insensitive exact). "All" clears.
- Show tiles reuse `PodcastShowCard` with `ShowFollowButton`; episode rows reuse `PodcastEpisodeRow` (progress + menu).

## Navigation
- `app/spaces/index.ts`: Music = Library, Discover, Liked songs, Playlists, Recent; Podcasts = Library, Discover, Subscribed, Recent. Discover links are not hideable and visible to guests. `moduleForPagePath` already covers the prefixes; `/music/genre/*` is under `/music/`.

## Testing
- Server integration per endpoint: visibility + module-independent filtering, guest vs user behaviour, aggregation correctness (genre grouping/case, follower and listener counts incl. window boundary, no user data leaked), exclusion rules (own follows, ≤2 plays, no-favorite empty mix), limits/paging/total, language filter, determinism with seed.
- Component: both pages render rows, omit empty rows, guests don't see personal rows, genre tile navigation target, language chip filtering, genre page paging/empty state; sidebar links.
- Real check by the controller in Docker + Browser pane: seed varied genres/albums/shows/follows/progress with sqlite3 on the mounted volume, click through every tile destination, phone width, UI clicks must succeed (CSRF).
