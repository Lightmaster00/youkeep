# Admin Ingest Search (Music & Podcasts) — Design

**Status:** Approved

## Goal

Give the admin a search-then-pick flow for tracking a music artist or a podcast show, matching the UX YouTube channel tracking already has, instead of requiring the admin to already have the exact channel URL/@handle or RSS feed URL in hand.

## Context

Investigated before this design:

- `server/api/admin/downloader/search-channels.get.ts` already implements this for video: scrapes YouTube search results for `channelRenderer` entries, returns `{ id, title, description, avatarUrl, subscriberCount, videoCount, handle }`. `SettingsDownloadsTab.vue` wires this into a search box + results grid, and clicking "Track" on a candidate opens an ingest modal to add it.
- `SettingsMusicTab.vue`'s "Track a Music Artist" form and `SettingsPodcastsTab.vue`'s add-show form both only accept a raw URL/handle or RSS feed URL typed directly by the admin — no search/discovery step exists for either.
- A music artist is tracked via its YouTube channel exactly like a video channel is — the existing `search-channels` endpoint applies to music unchanged, no new backend needed there.
- Podcasts have no "channel" concept — they're tracked by RSS feed URL. Discovery by show name needs an external podcast directory API.

## Scope

**In scope:**
- A search box + results grid in `SettingsMusicTab.vue`, reusing the existing `GET /api/admin/downloader/search-channels` endpoint unchanged. Clicking "Suivre" on a candidate fills the existing `musicArtistInput` field with the candidate's handle/id — the admin still sets visibility/auto-sync and submits the existing form as today.
- A new `GET /api/admin/podcasts/search-shows` endpoint that queries **iTunes Search** and **PodcastIndex.org** in parallel, normalizes both into a common shape, and merges the results with de-duplication by feed URL — when the same podcast is found on both, **iTunes's metadata wins** (its listing is shown), PodcastIndex only contributes shows absent from iTunes.
- A search box + results grid in `SettingsPodcastsTab.vue`, wired to the new endpoint. Clicking "Suivre" fills the existing `podcastFeedInput` field with the candidate's `feedUrl` — the admin still submits the existing add-show form as today.
- Two new admin settings, `podcastindex_api_key` / `podcastindex_api_secret`, with a small form in the Podcasts settings tab to enter them (PodcastIndex requires this pair to authenticate every request).
- The existing raw-URL/raw-feed-URL manual entry path in both tabs is untouched and stays fully usable — search is an additive shortcut, not a replacement. This is the explicit answer to "what if a podcast isn't on any directory": paste its feed URL directly, exactly as today.

**Out of scope:**
- Any change to the existing video channel search/ingest flow.
- A unified cross-media-type search UI (each tab keeps its own independent search box, matching this app's established pipeline-independence convention).
- Listen Notes or any other podcast directory beyond iTunes + PodcastIndex.
- Detecting/flagging podcasts or artists already followed among search results (the existing video flow doesn't do this either — no regression, no new capability).
- Pagination of search results.

## Architecture

### Music (no backend change)

`SettingsMusicTab.vue` gains a search block structurally identical to `SettingsDownloadsTab.vue`'s: a text input + "Rechercher" button calling `$fetch('/api/admin/downloader/search-channels', { query: { q } })`, and a results grid (avatar, title, description, subscriber/video counts) with a "Suivre" button per candidate. Clicking "Suivre" sets `musicArtistInput = candidate.handle || candidate.id`; it does not auto-submit — the admin still picks visibility/auto-sync and clicks "Add Artist" as today.

### Podcasts (new endpoint)

`server/api/admin/podcasts/search-shows.get.ts`:
1. `requireAdmin`, validate `q` (400 if missing/empty, matching `search-channels.get.ts`'s convention).
2. Fetch iTunes Search (`https://itunes.apple.com/search?media=podcast&term=<q>`) and PodcastIndex's `/search/byterm?q=<q>` **in parallel** via `Promise.allSettled` — one source failing (network error, PodcastIndex not configured) must not prevent the other from returning results.
3. PodcastIndex (`https://api.podcastindex.org/api/1.0/search/byterm?q=<q>`) requires `X-Auth-Date` (unix timestamp), `X-Auth-Key` (the configured `podcastindex_api_key`), `Authorization` = `sha1(apiKey + apiSecret + unixTimestamp)` hex digest, and a non-empty `User-Agent` header (PodcastIndex rejects requests without one) — use `'YouKeep/1.0'`. If `podcastindex_api_key`/`podcastindex_api_secret` are not both configured (empty/missing setting), skip the PodcastIndex call entirely — return only iTunes results, no error surfaced.
4. Normalize each source's results into `{ title, author, description, artworkUrl, feedUrl }`. iTunes: `collectionName`→title, `artistName`→author, no description field (iTunes Search doesn't return one — leave empty), `artworkUrl600`→artworkUrl, `feedUrl`→feedUrl (skip any iTunes result missing `feedUrl`). PodcastIndex: `title`→title, `author`→author, `description`→description, `image`→artworkUrl, `url`→feedUrl (skip any result missing `url`).
5. Merge: build a map keyed by normalized feed URL (`trim().toLowerCase()`, strip a single trailing `/`). Add all iTunes results first, then add PodcastIndex results only for feed-url keys not already present. Return the merged array as `{ shows: [...] }`.
6. Both source-fetch failures (or empty results) → `{ shows: [] }`, not an error — mirrors `search-channels.get.ts`'s empty-result shape so the frontend's existing "no results" messaging applies unchanged.
7. Any unexpected exception (e.g. malformed JSON) is caught, logged via `console.error('[admin/podcasts/search-shows]', err)`, and still returns `{ shows: [] }` rather than a 500 — searching is a discovery aid, never a hard dependency for adding a podcast (the manual feed-URL path always remains available).

Two new settings rows (`podcastindex_api_key`, `podcastindex_api_secret`, both default empty string), read via the existing `getDb().prepare("SELECT value FROM settings WHERE key = ?")` pattern already used throughout this codebase's settings reads. A new `GET`/`POST /api/admin/podcasts/podcastindex-credentials` pair (mirroring the shape of existing single-setting admin routes, e.g. `default-dir.post.ts`) lets the admin read/save them from a small form added to `SettingsPodcastsTab.vue`, near the search block.

`SettingsPodcastsTab.vue` gains the same search-block structure as Music's, calling `/api/admin/podcasts/search-shows`. Clicking "Suivre" sets `podcastFeedInput = candidate.feedUrl`; the admin still submits the existing add-show form as today.

## Error Handling

- Neither iTunes nor PodcastIndex reachable → `{ shows: [] }`, frontend shows its existing "no results" message, no error toast (fail-open, matches the video search's shape).
- PodcastIndex credentials missing or invalid → that source is silently skipped; iTunes results (if any) still return normally. No error surfaced to the admin — this is a normal, expected configuration state (PodcastIndex is optional).
- The manual feed-URL entry path is completely independent of this endpoint and is never affected by any failure here.

## Testing

- New unit tests for `search-shows.get.ts`'s pure logic: normalizing an iTunes result, normalizing a PodcastIndex result, merge/de-dup behavior (same feed URL on both sources → iTunes wins; feed URL only on PodcastIndex → included; case/trailing-slash-insensitive matching), and the PodcastIndex auth-header signature calculation (a pure function, testable independently of the network call).
- No test coverage for the actual outbound HTTP calls or for the existing YouTube-scraping `search-channels.get.ts` (unchanged, already untested, matches this codebase's established convention for this class of external-scraping code).
- Manual browser verification for both new UI search blocks (search → results → "Suivre" fills the field → existing add flow completes), matching this codebase's established convention for Vue UI changes with no component-test coverage for this specific interaction shape.
