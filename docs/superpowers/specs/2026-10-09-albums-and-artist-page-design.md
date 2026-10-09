# Real albums (iTunes matching) + Spotify-style artist page — Design

**Status:** Approved in chat (2026-10-09). Sub-project B (A = fast search/follow, done). Two phases: **B1 album matching**, **B2 artist page + album page**.

## Problem
Albums only come from yt-dlp metadata (`parsed.album`), which YouTube rarely provides, so most tracks land in the "Tracks without an album" bucket. The artist page is an accordion of albums plus that bucket; there is no "popular", "latest" or per-album page.

## B1 — Album matching

### Data (idempotent ALTERs in `server/utils/db.ts`; mirror in `tests/helpers/testDb.ts`)
- `music_albums`: `external_id TEXT` (iTunes collectionId), `album_type TEXT` ('album' | 'single' | 'ep', NULL = unknown), `matched_by TEXT` ('itunes' | NULL). Unique index on `(artist_id, external_id)` where external_id IS NOT NULL. (The existing `source` CHECK stays untouched; matched albums use `source = 'youtube'`.)
- `music_tracks`: `album_match_status TEXT` (NULL = not checked; 'matched' | 'unmatched' | 'manual'), `album_match_at INTEGER`.
- Admin edits of a track/album (`PATCH /api/admin/music/tracks/:id`, `albums/:id`) set `album_match_status = 'manual'` on the touched track(s); the matcher never changes a track with status 'manual' or one that already has an `album_id` from yt-dlp metadata (set `matched` is not applied; they are marked 'manual' when first seen).

### Matcher (`server/utils/albumMatch.ts`, pure parts unit-tested; HTTP injected)
- `cleanTrackTitle(title, artistName)`: strips "(Official Video/Audio/Music Video/Lyric Video/Visualizer)", "[HD]", "[Lyrics]", "| Official …", "ft./feat./featuring …" tails, "Artist - " prefixes, extra whitespace; Unicode NFC; case/diacritics-insensitive comparison key (`normaliseKey`).
- `searchItunesSong(artistName, title)`: `GET https://itunes.apple.com/search?term=<artist> <title>&entity=song&media=music&limit=8` (8 s timeout, English locale `country=US`; no key). Pick the best candidate: artist key equals or contains/is contained by the track's artist key AND title key equal, else similarity ≥ 0.9 (normalized Levenshtein on keys) — otherwise no match. Prefer candidates whose collection is an album over a "- Single"/"- EP" collection when both match the same title; prefer the earliest `releaseDate` among equal candidates.
- Result mapped to `{ collectionId, collectionName (trailing " - Single"/" - EP" removed, type derived), artworkUrl (swap `100x100bb` → `600x600bb`), releaseYear, trackNumber, genre (primaryGenreName) }`.
- Apply (transaction): upsert album by `(artist_id, external_id)` (cover_url only if the album has none; release_year; album_type; matched_by 'itunes'), set track `album_id`, `track_number` (if null), `genre` (if null), `album_match_status = 'matched'`, `album_match_at`. No match → `unmatched` (+ timestamp; retried only on explicit "retry unmatched").
- Throttle: one iTunes request every 3 s, process-wide; HTTP 429/5xx → exponential backoff, track left unchecked; the job never crashes the process.

### Queue and triggers
- Background job queue (reuse `server/utils/backgroundImports.ts` pattern or a sibling): at most one matcher running; resumable (status in DB); started (a) after a track finishes downloading (enqueue that track), (b) by the admin tool for the backlog, (c) at startup if there are unchecked completed tracks (small delay), unless disabled by the setting below.
- Setting `album_matching_enabled` (default '1') in `settings`; admin can disable (privacy: it sends artist+title text to Apple's public API — say so in the UI).

### Admin tool — Settings → System → Tools & logs → "Match albums"
- Endpoints (admin, CSRF as usual): `POST /api/admin/music/album-match/preview` → `{ completedTracks, unchecked, matched, unmatched, manual, enabled }`; `POST …/start` `{ scope: 'unchecked' | 'unmatched' }` (one run at a time; refuses while disabled); `GET …/status` → `{ state: idle|running|done|failed|cancelled, processed, total, matched, unmatched, errors, lastError }`; `POST …/cancel`; `POST …/settings` `{ enabled }`.
- Panel `AlbumMatchPanel.vue` (same style as `TidyLibraryPanel.vue`): explanation incl. privacy note, counts, toggle, Start (unchecked) / Retry unmatched, progress, Cancel, final report. English copy.

## B2 — Artist page and album page

### API
- `GET /api/music/artists/:id` keeps its current shape for compatibility but `standaloneTrackCount` is deprecated and unused by the new UI; add new routes (all with `canAccessMusicArtist`):
- `GET /api/music/artists/:id/overview` → `{ artist, popular: Track[≤5], latest: { kind: 'album'|'track', album?|track? } | null, albums: Album[], singles: Album[], counts: { tracks, albums, singles } }`. **popular** = completed tracks ordered by `view_count DESC NULLS LAST`, then the caller's own plays (`music_play_history`, when logged in) DESC, then title. **latest** = newest album by `release_year` then `created_at` (albums & singles), else the newest track by `upload_date`/`created_at`. **albums** = `album_type` NULL or 'album' with ≥1 completed track, newest year first; **singles** = `album_type` 'single'/'ep'.
- `GET /api/music/artists/:id/songs?sort=popular|newest|oldest|title&limit&offset` → `{ items: Track[], total }` (all completed tracks incl. those without an album; `newest` by `upload_date` then `created_at`).
- `GET /api/music/albums/:id` → `{ album: { id, title, year, type, coverUrl, artistId, artistName }, tracks: Track[] (completed, ordered by track_number NULLS LAST then title) }` (404/403 as the artist rules).

### UI
- `/music?artistId=<id>` becomes the new artist page: header (avatar/banner, name, counts, **Play** = popular first then the rest, **Shuffle**), then tabs **Overview | Albums | Songs** (tab in the URL as `&tab=`):
  - Overview: "Popular" (5 rows via `MusicTrackList`, "Show more" jumps to Songs sorted by popular), "Latest release" card, "Albums" horizontal row (cover, title, year), "Singles & EPs" row (only if any).
  - Albums: grid of albums then singles (title, year, track count).
  - Songs: sort select (Popular default, Newest, Oldest, A–Z), `MusicTrackList` with like/add-to-playlist actions, Load more.
- **"Tracks without an album" is removed everywhere.** Tracks without an album simply live in Songs/Popular with their own thumbnail.
- New page `/music/album/[id]`: cover, title, year/type, artist link, Play/Shuffle, numbered tracklist; admin keeps the album/track edit buttons (existing modals) on this page and in Songs.
- Existing album tile links in Discover (`/music?artistId=`) keep working; make album tiles open `/music/album/<id>` instead.
- Phone width: rows wrap actions under titles (≤560px); tabs scroll horizontally if needed. English copy; no French.

## Testing
- B1 unit: `cleanTrackTitle`, `normaliseKey`, candidate selection (artist/title equality, similarity threshold, album-over-single preference, earliest release), type derivation, artwork URL swap; throttle/backoff with fake timers.
- B1 integration: apply transaction (album upsert idempotent per external_id, cover only when missing, track fields only when null), manual/yt-dlp-album tracks untouched, unmatched marking, resume, only-one-run, preview counts, start/cancel/status routes, settings toggle, after-download enqueue (matcher injected, no real HTTP).
- B2 integration: overview ordering (popular by views then own plays, latest album vs track fallback, albums vs singles split, visibility/403), songs sorting + paging, album detail ordering and access.
- Component: tabs and URL sync, Overview sections (singles row hidden when none), Songs sort/paging, album page, no "without an album" text anywhere, Discover album tile target.
- Real check by the controller in Docker + Browser pane: seed an artist with real-looking titles and a mocked/real iTunes match (iTunes reachable → real call for 3–4 well-known tracks), run the admin tool from the UI, verify albums/covers appear and the artist page tabs/album page at desktop and phone width; UI clicks must succeed (CSRF).
