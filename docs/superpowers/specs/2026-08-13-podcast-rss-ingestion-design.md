# Podcast RSS Ingestion Pipeline — Design

## Context

Second sub-project of the Podcasts content-type initiative. Sub-project 1 (data model — `podcast_shows`/`podcast_episodes`) is done and merged. This sub-project builds the actual ingestion pipeline: parsing an RSS feed URL, extracting show/episode metadata, and downloading each episode's audio file.

This is genuinely new architecture for this codebase. Every other download pipeline (`server/utils/downloader.ts` for video, `server/utils/musicDownloader.ts` for music) is built around spawning `yt-dlp` as a child process and parsing its stdout for JSON metadata and progress lines. RSS ingestion has no `yt-dlp` involvement at all: metadata comes from parsing XML, and each episode's audio is a plain HTTP download of the `<enclosure>` URL the feed lists.

Read `server/utils/musicDownloader.ts` in full (869 lines) as the structural precedent to mirror wherever it applies: global-state symbol pattern (`_g[Symbol.for(...)]`, surviving dev HMR reloads), the wakeable-sleep polling loop (`sleepOrWakeableMusic`/`wakeMusicWorker`), settings-key naming (`{pipeline}_downloader_paused`, `{pipeline}_max_concurrent_downloads`), `retry_count`/`last_error` retry logic (max 3 attempts, matching `runSingleMusicDownload`), the shared `runSyncAllEntities()` orchestrator (already generic, added in an earlier sub-project specifically to be reused by future pipelines), `resetStaleDownloadsForTable()` (same — already generic). Confirmed no `yt-dlp`-specific code needs mirroring (process spawning, stdout progress-line regex parsing) — those are replaced entirely by an HTTP stream download with byte-count-based progress.

Researched RSS parsing libraries (via WebSearch, not stale pretrained assumptions): **`rss-parser`** (`rbren/rss-parser`) is the chosen library — async/await API (`parser.parseURL(feedUrl)`) consistent with this codebase's style throughout `downloader.ts`/`musicDownloader.ts`, 510+ dependents, native `<enclosure>` support (standard RSS 2.0, not itunes-specific), and a `customFields` config option purpose-built for mapping namespaced tags (`itunes:episode`, `itunes:season`, `itunes:author`, `itunes:image`, `itunes:duration`) into named fields.

**Data model gap found during this sub-project's design**: `podcast_episodes` has no `retry_count` column — the data-model sub-project predates the retry-count pattern being applied to this table (confirmed: `videos.retry_count` and `music_tracks.retry_count` were both added later via `ALTER TABLE ... ADD COLUMN`, in a sub-project after the original music schema shipped). This sub-project adds the same additive migration to `podcast_episodes`.

## Scope

- `server/utils/podcastDownloader.ts` — new file, the full ingestion + download pipeline.
- `ALTER TABLE podcast_episodes ADD COLUMN retry_count INTEGER DEFAULT 0;` migration.
- Admin API routes under `server/api/admin/podcasts/` for pipeline control (ingest a feed, pause/resume, concurrency setting, queue status, retry failed, cron schedule, per-show pause/sync).
- `initPodcastScheduler()` registered at app startup alongside the existing video/music schedulers.

## Non-Goals

- No library/browsing UI, no space-switcher entry, no catalog browsing pages — a later sub-project.
- No per-episode manual metadata editing endpoint (analogous to `music/tracks/[id].patch.ts`) — that's a library-UI concern, not an ingestion-pipeline concern; deferred.
- No playback UI, no resume-position/playback-speed tracking — deferred, as already noted in the data-model spec.
- No combined-concurrency-cap participation with the existing video+music `COMBINED_MAX_CONCURRENT_DOWNLOADS` — podcasts gets its own independent per-pipeline cap only (`podcast_max_concurrent_downloads`), matching the *default* pipeline-independence principle. The video+music combined cap was a specific, deliberate, later exception between those two pipelines only — extending it to a third pipeline is a separate decision this sub-project does not make.
- No YouTube-based podcast ingestion path (the "both eventually" source model flagged during sub-project 1's brainstorm) — RSS only, for now.
- No album/playlist-equivalent grouping, no featured-artist-equivalent relationship — already decided in sub-project 1, unchanged here.

## Design

### 1. Dependencies

Add `rss-parser` to `dependencies` (not `devDependencies` — this runs in the production ingestion pipeline, unlike the Vue-testing sub-project's dev-only additions).

### 2. Schema migration

In `server/utils/db.ts`, alongside the existing `retry_count` migrations:
```ts
try { db.exec(`ALTER TABLE podcast_episodes ADD COLUMN retry_count INTEGER DEFAULT 0;`); } catch (e) {}
```

### 3. `server/utils/podcastDownloader.ts` — structure

Mirrors `musicDownloader.ts`'s shape function-for-function, with names substituted (`Music`→`Podcast`, `track`→`episode`, `artist`→`show`):

- Global state: `G_PODCAST_PROCESSING`, `G_PODCAST_SHOULD_RUN`, `G_PODCAST_ACTIVE_DOWNLOAD_COUNT`, `G_PODCAST_DOWNLOAD_START_TIMES` (no `G_PODCAST_PROCESSES` map of child processes — there's no child process to track; instead an `AbortController` map, since fetch-based downloads are cancelled via `AbortController.abort()` rather than `child.kill()`), `G_PODCAST_CRON`.
- `getActivePodcastDownloadCount()`, `wakePodcastWorker()`, `sleepOrWakeablePodcast()` — identical pattern to the music equivalents.
- `getPodcastDownloadsDir()` — same fallback logic as `getMusicDownloadsDir()` (`/downloads/podcasts` primary, `data/downloads-podcasts` local fallback).
- `cleanupPartialPodcastFiles(episodeId, showId, opts)` — same shape as `cleanupPartialMusicFiles`, scans the show's directory for `{episodeId}.*` files.

**`ingestPodcastFeed(feedUrl, options: { sync_status?, visibility? })`**:
```ts
const parser = new Parser({
  customFields: {
    feed: [['itunes:author', 'itunesAuthor'], ['itunes:image', 'itunesImage']],
    item: [
      ['itunes:episode', 'itunesEpisode'],
      ['itunes:season', 'itunesSeason'],
      ['itunes:duration', 'itunesDuration']
    ]
  }
});
const feed = await parser.parseURL(feedUrl);
```
Upsert `podcast_shows` keyed on `feed_url` (the stable identifier, per sub-project 1's design — analogous to `music_artists.channel_id`): `title`→`feed.title`, `description`→`feed.description`, `author`→`feed.itunesAuthor || feed.author`, `cover_url`→`feed.itunesImage?.href || feed.image?.url`, `language`→`feed.language`, `last_checked_at`→`Date.now()`.

For each `feed.items` entry: compute `id = sha256(feedUrl + (item.guid || item.enclosure?.url))` (hex digest — always a valid SQLite TEXT primary key, no character-set concerns, and collision-safe across different feeds reusing the same raw guid, since `feedUrl` is part of the hash input). Upsert `podcast_episodes`: `title`, `description`, `audio_url`→`item.enclosure.url`, `duration`→parsed from `item.itunesDuration` (which may be `HH:MM:SS`, `MM:SS`, or a bare integer seconds — needs a small parser function, `parseItunesDuration(raw: string): number | null`), `episode_number`→`item.itunesEpisode ? parseInt(item.itunesEpisode) : null`, `season_number`→ similarly, `pub_date`→`item.pubDate`. Episodes with no `enclosure.url` at all are skipped (nothing to download) and logged, not inserted as broken rows.

Returns `{ success: boolean; message: string; count: number }` matching the existing pipelines' ingest-function contract.

**`downloadEpisodeFile(episodeId, showId): Promise<void>`** — replaces `downloadMusicTrackFile`'s yt-dlp spawn with an HTTP stream download:
```ts
const response = await fetch(audioUrl, { signal: abortController.signal });
if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
const totalBytes = parseInt(response.headers.get('content-length') || '0', 10);
let receivedBytes = 0;
let lastDbWrite = 0;
const fileStream = fs.createWriteStream(outputPath);
for await (const chunk of response.body) {
  fileStream.write(chunk);
  receivedBytes += chunk.length;
  const now = Date.now();
  if (now - lastDbWrite > 500 && totalBytes > 0) { // throttled — matches the ~yt-dlp-progress-line cadence, not on every chunk
    const progress = Math.round((receivedBytes / totalBytes) * 100);
    const elapsedSec = (now - attemptStartedAt) / 1000;
    const speed = formatBytesPerSec(receivedBytes / elapsedSec);
    const eta = formatEta((totalBytes - receivedBytes) / (receivedBytes / elapsedSec));
    db.prepare(`UPDATE podcast_episodes SET download_progress = ?, download_speed = ?, download_eta = ? WHERE id = ?`).run(progress, speed, eta, episodeId);
    lastDbWrite = now;
  }
}
fileStream.end();
```
A `DOWNLOAD_TIMEOUT_MS` watchdog (same 30-minute value as music) aborts via `abortController.abort()` instead of `child.kill('SIGKILL')`. On success, sets `local_file_path`; podcast episodes have no separate thumbnail file to scan for (the show's `cover_url` is remote-hosted and reused for all its episodes in the UI — no per-episode thumbnail download, unlike music's per-track thumbnail from `yt-dlp --write-thumbnail`).

**`startPodcastQueueWorker()`** — identical polling-loop structure to `startMusicQueueWorker()`: paused-setting check, disk-space check (before the capacity checks, same ordering fix already applied to video/music for the same race-window reason), per-pipeline capacity check against `podcast_max_concurrent_downloads`, entity selection (`WHERE download_status='pending' AND show.sync_status='downloading'`), `runSinglePodcastDownload()` dispatch (not awaited by the loop, same fire-and-forget pattern). **No combined-cap check** — see Non-Goals.

**`runSinglePodcastDownload(episodeId, ...)`** — same retry logic as `runSingleMusicDownload`: `MAX_RETRY_COUNT = 3`, distinguishes deliberate pause/cancel (status reset to `pending`, `retry_count` untouched) from genuine failure (`retry_count` incremented, `failed` status at the cap).

**`resetStalePodcastDownloads()`** — one-line delegation to `resetStaleDownloadsForTable(getDb(), 'podcast_episodes', 'téléchargements de podcasts interrompus', 'podcast downloads', addLog)`, exactly like the music/video equivalents.

**`syncAllPodcastShows()`** — uses the existing shared `runSyncAllEntities()` orchestrator: `activeFlagSettingKey: 'podcast_sync_all_active'`, `pausedSettingKey: 'podcast_downloader_paused'`, `fetchEntities` selects all `podcast_shows`, `processEntity` calls `ingestPodcastFeed(show.feed_url)` per show (re-fetching the feed picks up new episodes since the last check), no `afterLoop` (no metadata-refresh equivalent), `startWorker: startPodcastQueueWorker`.

**`initPodcastScheduler()`** — same `Cron` registration pattern as `initMusicScheduler()`, own settings keys (`podcast_sync_cron_enabled`, `podcast_sync_cron_schedule`), own cron job handle (`G_PODCAST_CRON`), registered independently so it can never stop/start alongside the video or music cron.

### 4. Admin API routes (`server/api/admin/podcasts/`)

Mirroring the music ingestion sub-project's original endpoint set (not the later library-UI-driven additions like per-track metadata editing, which don't apply here):
- `ingest.post.ts` — add a feed by URL.
- `concurrency.get.ts` / `concurrency.post.ts`.
- `pause.post.ts` / `resume.post.ts` — global pipeline pause.
- `queue.get.ts` — current queue status.
- `retry-failed.post.ts`.
- `schedule.get.ts` / `schedule.post.ts` — cron config.
- `shows/[id]/pause.post.ts` / `shows/[id]/sync.post.ts` — per-show controls.

### 5. Startup wiring

`initPodcastScheduler()` called from wherever `initScheduler()`/`initMusicScheduler()` are currently called (the scheduler plugin) — confirm the exact call site when implementing, not assumed here.

## Error Handling

Every error path mirrors the music pipeline's exact behavior, substituting the HTTP-fetch failure mode for the yt-dlp-exit-code failure mode: a non-OK HTTP response or a thrown fetch error is treated identically to a non-zero yt-dlp exit code (same retry/failed-after-3-attempts logic, same `cleanupPartialPodcastFiles` cleanup, same `last_error` recording). A missing `<enclosure>` on a feed item is not an error — it's a normal, common feed shape (some feed items are show notes/trailers with no audio) and is silently skipped during ingestion, not treated as a partial failure.

## Verification

`server/utils/podcastDownloader.ts` will have the same status as `downloader.ts`/`musicDownloader.ts`: no dedicated automated tests for the network-dependent download logic (project-wide accepted convention). However, unlike those two files, the RSS *parsing* logic (feed → show/episode field extraction, GUID hashing, itunes-duration parsing) is pure, network-free, and testable — write real unit tests for `parseItunesDuration()` and the GUID-hashing function at minimum, following the established `tests/unit/*.test.ts` pattern (e.g. `tests/unit/concurrency.test.ts`'s conventions). Manual verification via the dev-login fixture: ingest a real public podcast RSS feed, confirm show + episode metadata populates correctly, confirm an episode downloads with live progress visible in the existing queue UI (which already renders `download_progress`/`download_speed`/`download_eta` generically — should work for podcasts with zero UI changes, though this isn't verified until the library-UI sub-project actually surfaces a podcast queue view), and confirm pause/resume/retry-failed behave identically to the music pipeline's already-verified behavior.
