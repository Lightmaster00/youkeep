# Search Platforms (Admin Ingest Search Generalization) — Design

**Status:** Approved

## Goal

Generalize the admin ingest-search feature's platform/API-key configuration from a single hardcoded PodcastIndex credentials form into an extensible "search platforms" system, and use it to add two new, concrete search sources: Listen Notes (a 3rd podcast directory) and the official YouTube Data API (an optional, more reliable alternative to the current HTML-scraping search for video/music channels).

## Context

Built on top of the just-shipped Admin Ingest Search feature (`docs/superpowers/specs/2026-09-08-admin-ingest-search-design.md`, `docs/superpowers/plans/2026-09-08-admin-ingest-search.md`, merged 2026-09-08). That feature added:
- `server/api/admin/downloader/search-channels.get.ts`: YouTube channel search via HTML scraping (fragile, no API key, unlimited but unofficial).
- `server/utils/podcastSearch.ts` + `server/api/admin/podcasts/search-shows.get.ts`: podcast show search merging iTunes Search (no key) + PodcastIndex.org (optional key pair, stored as two named settings rows `podcastindex_api_key`/`podcastindex_api_secret`, with a dedicated small credentials form in `SettingsPodcastsTab.vue`).

The PodcastIndex credentials storage (two ad hoc settings rows + a bespoke route pair + a bespoke form) does not generalize — adding a 3rd platform the same way means repeating that whole pattern again, and video/music search has no key-based path at all today.

## Scope

**In scope:**
- A new generic `search_platforms` table (one row per platform, holding an API key and optional secret), replacing the two ad hoc PodcastIndex settings rows. Adding a future platform means one new seeded row, not a schema change.
- A one-time migration copying any existing `podcastindex_api_key`/`podcastindex_api_secret` values into the new table.
- Generic `GET`/`POST /api/admin/system/search-platforms` routes (list all 3 rows / update one), replacing the PodcastIndex-specific credentials routes.
- **Listen Notes** as a 3rd podcast search source, merged into `search-shows.get.ts` alongside iTunes and PodcastIndex: priority on a feed-URL duplicate is **iTunes > PodcastIndex > Listen Notes**.
- **YouTube Data API** as an optional replacement for the current HTML-scraping in `search-channels.get.ts` (used by both the video and music search UIs, since music search reuses that same endpoint unchanged) — when a key is configured, it's used instead of scraping (not merged, since a channel has one stable ID either way); when absent or the API call fails, falls back to the existing scraping path.
- A single "Search Platforms" panel in Settings → System (`SettingsSystemTab.vue`), listing all 3 platforms with a key/secret form each, replacing the PodcastIndex-only form removed from `SettingsPodcastsTab.vue`.

**Out of scope:**
- Any platform beyond these 3 (the table/route design is extensible to more later, but none are built now).
- Quota/rate-limit tracking or warnings for YouTube Data API or Listen Notes — a failure (including a quota error) is just treated as an ordinary failure and falls back silently, same as every other failure mode in this feature.
- Using YouTube Data API's richer data (subscriber count, video count, channel description via a follow-up `channels.list` call) — the search endpoint's `search.list` response is enough to populate the existing UI fields that matter (id, title, avatar); the fields the scraper currently fills that the API's basic search response doesn't provide (subscriber/video counts) are simply left blank when the API path is used.
- Any change to the content-search-for-already-archived-media feature (a separate, independent sub-project).

## Architecture

### Data model

New table in `server/utils/db.ts`:
```sql
CREATE TABLE IF NOT EXISTS search_platforms (
  id TEXT PRIMARY KEY,
  api_key TEXT NOT NULL DEFAULT '',
  api_secret TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);
```
Seeded on init with 3 rows: `podcastindex`, `listennotes`, `youtube_data_api` (empty `api_key`/`api_secret`). `api_secret` is unused by `listennotes` and `youtube_data_api` (both are single-key APIs) but the column stays uniform across all 3 rows rather than being nullable/optional per-platform, keeping the table's shape simple and the route generic.

Immediately after seeding, a one-time migration: if the old `podcastindex_api_key`/`podcastindex_api_secret` settings rows have non-empty values AND the new `podcastindex` row in `search_platforms` still has empty values, copy the old values into the new row. Idempotent — safe to run on every init. The old settings rows are left in place afterward (never deleted, matching this codebase's established convention for retired settings) but nothing reads them anymore once this ships.

### Generic settings routes

- `GET /api/admin/system/search-platforms` → `{ platforms: [{ id, apiKey, apiSecret }, ...] }` (all 3 rows).
- `POST /api/admin/system/search-platforms` with body `{ id, apiKey, apiSecret }` → validates `id` is one of the 3 known values (400 otherwise), updates that row's `api_key`/`api_secret`/`updated_at`, returns `{ success: true }`.

### Podcast search (3-way merge)

`server/utils/podcastSearch.ts` gains `normalizeListenNotesResult(raw): ShowCandidate | null`, mapping Listen Notes' `GET https://listen-api.listennotes.com/api/v2/search?type=podcast&q=<q>` response (`title`, `publisher`, `description`, `image`, `rss` for feed URL; auth via a `X-ListenAPI-Key` header) into the same `ShowCandidate` shape, skipping any result missing `rss`. `mergeShowCandidates()` extends to accept a 3rd optional candidate array (Listen Notes), building its priority map in the order iTunes → PodcastIndex → Listen Notes (each source only fills feed-URL keys not already claimed by an earlier one) — the same case/trailing-slash-insensitive key normalization already in place.

`search-shows.get.ts` reads all 3 platforms' credentials from `search_platforms` (replacing the old two named-settings reads), fetches iTunes + PodcastIndex + Listen Notes in parallel via `Promise.allSettled` (extended from 2 to 3), and merges via the updated `mergeShowCandidates()`. Listen Notes is skipped silently (empty result list, no error) when its `api_key` row is empty, exactly like PodcastIndex's existing behavior.

### Video/music channel search (replace, not merge)

`search-channels.get.ts` reads the `youtube_data_api` row. If `api_key` is non-empty: call `GET https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&q=<q>&key=<apiKey>&maxResults=25`, map each `items[]` entry (`snippet.channelId`, `snippet.title`, `snippet.description`, `snippet.thumbnails.default.url`) into the existing `{ id, title, description, avatarUrl, subscriberCount, videoCount, handle }` shape (`subscriberCount`/`videoCount`/`handle` left as empty strings — not available from this endpoint, and the frontend already renders them conditionally/tolerates empty strings). If the key is empty, or the API call throws/fails for any reason, fall back to the existing scraping code path unchanged — this is a replace-on-success, not merge, and never removes the scraping fallback.

### Settings UI

`SettingsSystemTab.vue` gains a new "Search Platforms" panel: fetches `GET /api/admin/system/search-platforms` on mount, renders 3 rows (labeled "PodcastIndex", "Listen Notes", "YouTube Data API"), each with its own key (+ secret for PodcastIndex only, the input hidden/omitted for the other two since they don't use it) input and its own Save button posting just that row. `SettingsPodcastsTab.vue` loses its PodcastIndex-specific credentials form (moved to System) but keeps its search box unchanged (still calls `search-shows.get.ts`, whose behavior is otherwise unaffected by this migration).

## Error Handling

- Every new/changed external call follows the already-established convention: missing key → skip silently (empty list contribution, no error); call failure (network, timeout, non-2xx, malformed response) → caught by the existing `Promise.allSettled` + outer try/catch pattern, logged server-side only, contributes an empty list, never surfaces as an error to the admin.
- YouTube Data API quota exhaustion (`403 quotaExceeded`) is not special-cased — it's just another failure, falling back to scraping.
- The migration is safe to run on every server start (idempotent, guarded by "only copy if destination is still empty").

## Testing

- New unit tests: `normalizeListenNotesResult` (valid mapping, missing `rss` → null, missing optional fields), `mergeShowCandidates` extended to 3 sources (all pairwise duplicate combinations, and the 3-way priority order), the YouTube Data API response → `{channels:[...]}` mapping function (extracted as a small pure function for testability, mirroring how `podcastSearch.ts`'s normalizers are pure and tested).
- No test coverage for the actual outbound HTTP calls (YouTube Data API, Listen Notes) or for the pre-existing scraping fallback path — matches this codebase's established convention for this class of external-API-calling code.
- Manual browser verification for the new Settings → System "Search Platforms" panel and for confirming the YouTube Data API path (when a real key is configured) and Listen Notes path (when a real key is configured) both return real results, following the same live-verification convention the prior sub-project used (and which found 2 real bugs there — this sub-project's manual verification step should specifically re-confirm both new external response shapes against real API calls, not just code review, given that history).
