# Cache-Control Headers on Served Files — Design

## Context

First of five independent improvement items identified for YouKeep's video/music sides (Cache-Control headers, music resync cron, YouTube playlist download, finished-live-VOD badge, automatic-playlist refinement — see `project_music_mode` memory for the full list and ordering). This item: neither of the two file-serving routes (`server/routes/downloads/[...path].ts` for video, `server/routes/downloads-music/[...path].ts` for music) sends a `Cache-Control` header today, so every page load re-fetches media/thumbnails from the local server with no browser caching at all.

## Scope

- Add `Cache-Control` (and, for mutable files, `Last-Modified`/conditional-request handling) to both existing file-serving routes.
- No new routes, no new endpoints, no change to access control or Range-request behavior — headers are added to the existing 200/206 response paths, after the existing visibility check.

## Non-Goals

- No CDN/reverse-proxy configuration — this is app-level HTTP headers only.
- No cache invalidation/busting scheme (e.g. versioned URLs) — conditional revalidation (`Last-Modified`/`If-Modified-Since`) covers the mutable-file case without needing one.
- No change to which files exist at which paths, or to the existing content-type detection in either route.

## Design

### 1. Two caching strategies, chosen per file type

Both routes already classify served files by extension (video route: mp4 = video, jpg/png/webp = image, vtt = subtitle; music route: `AUDIO_CONTENT_TYPES` map vs `IMAGE_CONTENT_TYPES` map). This existing classification determines which strategy applies — no new classification logic needed:

- **Media files** (video route: `.mp4`; music route: everything in `AUDIO_CONTENT_TYPES`, which now includes the `.mp4` clip format) — these never change after `download_status = 'completed'`; the file at a given path is written once and never overwritten in place. Header: `Cache-Control: private, max-age=31536000, immutable`.
- **Images and subtitles** (jpg/jpeg/png/webp, `.vtt`) — these CAN change: a thumbnail can be re-downloaded on channel/artist resync, and sub-project 3c-ii lets an admin manually override a track/album cover. Header: `Cache-Control: private, must-revalidate`, plus a `Last-Modified` header set from `fs.statSync(absolutePath).mtime`. If the request carries `If-Modified-Since` and the file's mtime is not newer than that value, respond `304 Not Modified` with no body (and no `Content-Type`/`Content-Length`, per HTTP semantics for 304). Otherwise serve normally with `Last-Modified` set.

`private` (not `public`) in both cases: every served file is gated by the existing per-track/per-video/per-channel/per-artist visibility check, so a response must never be cacheable by a shared proxy that could hand it to a different, unauthorized requester.

### 2. Where in each route this applies

In both files, the new logic sits **after** the existing access-control check (`canAccessVideo`/`canAccessMusicTrack` — unchanged) and **before** the existing Range-handling branch. The 304 short-circuit (image/subtitle path only) returns before any `fs.createReadStream` call — no need to open the file at all if we're about to send an empty 304 body. The immutable-media path and the "not modified" check for images are both header-only additions; the existing 200/206/416 Range logic is untouched.

### 3. Testing

Both routes currently have zero test coverage. Add integration tests for each covering:
- A media file request gets `Cache-Control: private, max-age=31536000, immutable` and no `Last-Modified`.
- An image/subtitle file request gets `Cache-Control: private, must-revalidate` and a `Last-Modified` header.
- A request for an image/subtitle with `If-Modified-Since` set to the file's actual mtime (or later) gets a `304` with no body.
- A request for an image/subtitle with `If-Modified-Since` set to a time before the file's mtime gets a normal `200` with the file content.
- Existing behavior (403 on denied access, 404 on missing file, 206 on Range requests, correct `Content-Type`) is unaffected — each route's new test file adds a regression test per case alongside the new cache-header tests, since neither route has any test today.
