# Admin Error-Message Leakage — Design

## Context

Ninth sub-project of the ongoing "bug fixes" initiative — the first of 4 items reopened after the user explicitly asked to reconsider previously-declined audit findings ("corrige tout"). This finding was originally declined ("admin-only endpoints, not a real exposure, and the raw yt-dlp stderr/path detail is often genuinely useful for debugging"); the user now wants it fixed for real.

Explored `server/api/admin/**` (55 endpoints): 7 forward `err.message` (or an interpolation of it) directly into the client-facing `statusMessage` of a thrown `createError`. Of those 7, 3 (`downloader/test-binary.post.ts`, `downloader/test-download.post.ts`, `downloader/update-ytdl.post.ts`) are the yt-dlp diagnostics feature in Settings' System tab — their entire purpose is to run a real command and surface its raw stdout/stderr/exit status to the admin, so genericizing them would break the feature rather than fix a leak. The remaining 4 are genuine "unexpected error → raw detail forwarded to client" sites, confirmed by reading each:

- `server/api/admin/music/ingest.post.ts:30`
- `server/api/admin/downloader/ingest.post.ts:52`
- `server/api/admin/downloader/search-channels.get.ts:62`
- `server/api/admin/downloader/default-dir.post.ts:29`

## Scope

- Fix the 4 confirmed leak sites: replace the raw `err.message` forwarded in the client-facing `statusMessage` with a fixed, generic, actionable message, and log the full error server-side via `console.error` so debugging value is preserved (relocated, not deleted).

## Non-Goals

- No change to the 3 yt-dlp diagnostics endpoints — their raw-output display is the intended feature.
- No change to `result.message` forwarding at `music/ingest.post.ts:25` / `downloader/ingest.post.ts:39` — that's an internal, controlled message from application code, not an external exception's raw detail; not the same leak category.
- No new logging infrastructure (log aggregation, structured logging library, error codes) — plain `console.error` matches this codebase's existing error-handling convention everywhere else.
- No change to HTTP status codes — only the `statusMessage` text changes.

## Design

In each of the 4 files' `catch (err: any)` block:
1. Add `console.error('[<context>]', err);` before the `throw createError(...)`, so the full error (message, stack) lands in server logs.
2. Replace the `statusMessage` value from `err.message || '<fallback>'` (or a template-string interpolation of `err.message`) to a fixed string that both states what failed and tells the admin where to look:

| File | New `statusMessage` |
|---|---|
| `server/api/admin/music/ingest.post.ts:30` | `'An error occurred during music ingestion. Check the server logs for details.'` |
| `server/api/admin/downloader/ingest.post.ts:52` | `'An error occurred during ingestion. Check the server logs for details.'` |
| `server/api/admin/downloader/search-channels.get.ts:62` | `'Failed to search YouTube channels. Check the server logs for details.'` |
| `server/api/admin/downloader/default-dir.post.ts:29` | `'Unable to create or access the folder. Check the server logs for details.'` |

No other line in any of these 4 files changes. The `console.error` context tag in each should identify the endpoint (e.g. `'[admin/music/ingest]'`) so a server operator can grep logs by source.

## Error Handling

This sub-project *is* an error-handling change — no further error paths are introduced. The `statusCode` in each `createError` call is unchanged; only the message text and the addition of server-side logging change.

## Verification

These are plain server-route changes with existing test coverage patterns in this codebase (Vitest + `tests/helpers/testDb.ts`-style integration tests where they exist for these endpoints, or manual verification via the dev-login fixture where they don't — check each file for an existing test before deciding). Verify: each of the 4 endpoints still returns the correct HTTP status code on failure, the new generic `statusMessage` is what the client receives (confirm via a forced-failure test or manual trigger), and the full error detail appears in server console output. No UI changes are needed — the existing `toast.error(err.data?.statusMessage || ...)` call sites in the frontend already just display whatever `statusMessage` the server sends.
