# Fast search and follow — Design

**Status:** Approved in chat (2026-10-09). Sub-project A of 2 (next: Spotify-style artist page + real album matching).

## Problem (measured)
- Following (music artist / video channel) awaits `yt-dlp --dump-single-json --flat-playlist <channel>/videos` over the WHOLE channel before answering (3–4 s for 300 videos on a Mac; far more on a NAS and for big channels), inside the HTTP request.
- Channel search scrapes a ~1 MB YouTube results page (0.4 s here) with no timeout, no cache, and no timing in the logs.

## Goal
Follow answers in under a second; the track/video listing is imported in the background with a visible "Importing…" state. Search gets a timeout, a short cache and timing logs.

## Follow — music artists (`ingestMusicUrl`, `POST /api/admin/music/ingest`)
- Request body gains optional hints from the search result: `channelId`, `name`, `avatarUrl`. The client (music source config in `app/utils/librarySources.ts`) sends them when it follows a search result.
- With hints (channelId + name): upsert the artist row immediately (same visibility / sync_status semantics as today), set `import_status = 'importing'`, start the import in the background (not awaited) and return at once `{ success: true, message, count: 0, importing: true, artistId }`.
- Without hints (pasted URL/handle): resolve minimal channel metadata quickly (`yt-dlp --dump-single-json --flat-playlist --playlist-end 1 <url>`, 20 s timeout) to get channel id/name/avatar, upsert, then background import as above. Non-channel URLs (a single video or a playlist) keep today's synchronous behaviour (they are small).
- Background import = today's full `--flat-playlist` listing + track upserts (reuse the existing code path, extracted into a function `importArtistTracks(artistId, fetchUrl)`), then `import_status = 'done'` (or `'failed'` with `import_error`), then start the queue worker if the artist is `downloading`. At most 2 imports run at once (simple in-process queue); a failure never crashes the process. Imports interrupted by a restart are resumed at startup for artists left in `importing`.
- Schema (idempotent ALTERs in `server/utils/db.ts`): `music_artists.import_status TEXT` (NULL = done/legacy), `music_artists.import_error TEXT`.
- Admin lists that show artists (`app/utils/librarySources.ts` music followed list, the Following rows) show an "Importing…" badge while `import_status = 'importing'` and "Import failed — Retry" on failure; the section polls its list every 3 s while any row is importing. A retry route `POST /api/admin/music/artists/:id/reimport`.

## Follow — video channels
- Inspect the channel follow path (`server/api/admin/downloader/*` / channel ingest / `ingestChannel`-like util). If it also awaits a whole-channel flat listing, apply the same pattern (hints from the search result, immediate upsert, background listing, `channels.import_status/import_error`, "Importing…" badge, retry). If it is already fast or already async, leave it and say so in the report.

## Follow — podcasts
- Feed fetch is a single HTTP request; keep synchronous but make sure it has a timeout (15 s) and a clear error. No background import unless the code awaits something heavy per episode.

## Search
- `search-channels.get.ts`, `search-shows.get.ts` (and the iTunes/Listen Notes paths): add a request timeout (8 s), an in-memory LRU cache keyed by `provider+query` (10 min TTL, max 100 entries; never caches errors or empty results), and `console.log('[search] provider=… q=… ms=… results=…')` timing. The scrape's JSON extraction uses a bounded brace-matching parse instead of the lazy `({.*?});` regex over 1 MB (same output).
- The search UI shows its existing "Searching…" state; a timed-out search shows "The search took too long. Try again." (English).

## Testing
- Unit/integration: follow with hints returns immediately without invoking the listing (listing injected/mocked) and creates the artist with `import_status='importing'`; the background import fills tracks, flips to `done`, starts the worker only when `downloading`; failure → `failed` + error and the retry route re-runs; restart resume; concurrency cap of 2; pasted URL path resolves metadata then imports in the background; single-video/playlist URLs stay synchronous; search cache hit/miss/TTL/no-error-caching/timeout; scrape parser equivalence on a saved fixture.
- Component: Follow click returns quickly and the row shows "Importing…" then updates after polling; Retry on failure.
- Real check by the controller (Docker + Browser pane, real YouTube if reachable): time a follow of a big channel before/after (< 1 s), watch tracks appear, reload mid-import.
