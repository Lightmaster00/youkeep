# Finished-Live VOD Badge — Design

## Context

Fourth of five independent YouKeep improvement items (Cache-Control headers, music resync cron, and playlist ingestion shipped first). YouTube keeps a livestream's recording available as a regular VOD once the stream ends. YouKeep's library currently has no way to tell, at a glance, that a given video was originally a livestream — it looks identical to a normal upload.

Confirmed by codebase search: there is no existing `is_live`/`was_live`/`live_status` handling anywhere in YouKeep today (no DB column, no yt-dlp field extraction, no UI treatment). This is a greenfield addition, not an extension of existing live-stream logic.

The download pipeline already writes and parses a yt-dlp `--write-info-json` file per video in `downloadVideoFile()` (`server/utils/downloader.ts`, info.json read around line 857), extracting `description`, `view_count`, `upload_date`, and `like_count` into the `videos` row on download completion. yt-dlp's info.json includes a `live_status` field (`not_live` | `is_live` | `is_upcoming` | `was_live` | `post_live`) for every video, at no extra cost — this is the natural extension point, requiring no new yt-dlp invocation.

## Scope

- A new `videos.was_live` column, populated from `live_status === 'was_live'` at download-completion time, for videos downloaded after this feature ships.
- A "REPLAY" badge on video thumbnails in grid views (`VideoCard.vue`) and a matching label on the video detail/player page (`watch/[id].vue`), shown when `was_live = 1`.

## Non-Goals

- **No backfill for already-downloaded videos.** Their info.json was parsed without extracting `live_status` (or may no longer exist on disk), so existing library entries default to `was_live = 0` — indistinguishable from a video that was never a livestream. This is an explicit, accepted limitation: no migration script, no re-parse of on-disk info.json files, no fresh yt-dlp metadata calls for existing videos.
- **No handling for currently-live or upcoming streams.** YouKeep only ever processes completed downloads (`downloadVideoFile` runs after a video is queued and yt-dlp fetches it), so `is_live` and `is_upcoming` states are not reachable in this pipeline. Only `was_live` (a stream that has since ended and is now a VOD) is meaningful here.
- No filtering, sorting, or search by this flag — display only, matching the scope of this item as originally proposed.
- No changes to the download/ingestion decision logic — a livestream VOD is downloaded exactly like any other video today; this only adds a label after the fact.

## Design

### 1. Data model

```sql
ALTER TABLE videos ADD COLUMN was_live INTEGER DEFAULT 0;
```

Added via the existing `try { db.exec(...) } catch (e) {}` migration pattern already used for `is_short`, `like_count`, etc. in `server/utils/db.ts`.

### 2. Populating the flag

In `downloadVideoFile()`'s existing info.json parse block (`server/utils/downloader.ts`, where `desc`/`views`/`uploadDate`/`likeCount` are currently read from `infoData`), add:

```ts
const wasLive = infoData.live_status === 'was_live' ? 1 : 0;
```

and include it in the same `UPDATE videos SET ...` statement that already persists `description`/`view_count`/`upload_date`/`like_count` after a successful download (the statement around line 1589, `server/utils/downloader.ts`). If `infoData.live_status` is missing or the info.json failed to parse, `wasLive` stays `0` — same "unknown defaults to 0" behavior as the rest of that block.

### 3. UI — grid cards (`app/components/VideoCard.vue`)

A "REPLAY" text badge, visually matching the existing `.duration-badge` (same pill shape/sizing/font), placed in the opposite corner of the thumbnail so the two badges never collide. Shown via `v-if="video.was_live === 1"` inside `.thumbnail-wrapper`, alongside the existing `duration-badge` span (around line 32).

### 4. UI — detail/player page (`app/pages/watch/[id].vue`)

A small "REPLAY" pill, same visual treatment as the card badge, placed next to `<h1 class="video-title">` (around line 53), shown under the same `was_live === 1` condition.

### 5. Video type/interface updates

Any TypeScript interfaces describing a video row for these two components (e.g. `VideoCard.vue`'s `video` prop type) gain a `was_live?: number` field, matching how `is_short` is already typed there.

## Error Handling

- Missing or unparseable info.json: `wasLive` defaults to `0`, exactly like the existing `desc`/`views`/`uploadDate`/`likeCount` fallbacks in the same block — no special-casing.
- Videos downloaded before this feature ships: `was_live` is `0` by column default, never backfilled, never re-evaluated.

## Verification

- Unit/integration tests are not feasible for the info.json-parsing addition itself (this is a small extension of `downloadVideoFile()`, which has zero existing automated test coverage for its download-execution logic, consistent with every prior sub-project touching this class of code).
- Manual verification: download a real, known-finished YouTube livestream VOD and confirm `was_live` is set to `1` in the DB and the "REPLAY" badge appears on both the grid card and the detail page; download a regular (never-live) video and confirm no badge appears; confirm an existing, already-downloaded video in the library shows no badge (expected, per Non-Goals) without erroring.
