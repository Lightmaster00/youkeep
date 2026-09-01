# Podcast RSS Ingestion Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the podcast RSS ingestion pipeline: parsing an RSS feed URL into `podcast_shows`/`podcast_episodes` rows, downloading each episode's `<enclosure>` audio file over plain HTTP, and exposing admin API routes + a cron scheduler to control it — all independent of the existing yt-dlp-based video/music pipelines.

**Architecture:** A new `server/utils/podcastDownloader.ts` mirrors the structure of `server/utils/musicDownloader.ts` (global-state-backed persistent queue worker, wakeable-sleep polling loop, retry-count-based failure handling, a shared `runSyncAllEntities()`/`resetStaleDownloadsForTable()` orchestration layer already built to be pipeline-agnostic). The one structural departure: there is no child process to manage, so an `AbortController` map replaces the `ChildProcess` map, and a `fetch()`-based streaming download replaces the yt-dlp spawn. New admin API routes under `server/api/admin/podcasts/` mirror `server/api/admin/music/`'s route set file-for-file. `initPodcastScheduler()` is registered in `server/plugins/scheduler.ts` alongside `initScheduler()`/`initMusicScheduler()`.

**Tech Stack:** Nuxt 4, Nitro, better-sqlite3, TypeScript, rss-parser, Vitest

## Global Constraints

- No library/browsing UI, no space-switcher entry, no catalog pages — later sub-project.
- No per-episode manual metadata editing endpoint — later sub-project (library UI).
- No playback UI, no resume-position/playback-speed tracking.
- No combined-concurrency-cap participation with the existing video+music COMBINED_MAX_CONCURRENT_DOWNLOADS — podcasts gets its own independent per-pipeline cap only (`podcast_max_concurrent_downloads`). Do not wire `startPodcastQueueWorker` to check `hasCapacityForCombinedDownloads`.
- No YouTube-based podcast ingestion path — RSS only.
- No album/playlist-equivalent grouping, no featured-artist-equivalent relationship.
- `rss-parser` goes in `dependencies`, not `devDependencies` (it runs in the production ingestion pipeline).
- `server/utils/podcastDownloader.ts`'s network-dependent download logic gets NO automated tests (matching the established, accepted convention for `downloader.ts`/`musicDownloader.ts`) — but the PURE functions (`parseItunesDuration`, the GUID-hashing function) DO get real unit tests.

---

## Prerequisite context (read once, applies to every task)

- **Existing schema** (`server/utils/db.ts`, already shipped): `podcast_shows(id, feed_url UNIQUE NOT NULL, title, description, author, cover_url, language, sync_status DEFAULT 'paused', visibility DEFAULT 'public', last_checked_at, created_at)` and `podcast_episodes(id, show_id NOT NULL REFERENCES podcast_shows(id) ON DELETE CASCADE, title, description, audio_url NOT NULL, local_file_path, local_thumbnail_path, duration, episode_number, season_number, pub_date, download_status DEFAULT 'pending', download_progress DEFAULT 0, download_speed, download_eta, last_error, share_token UNIQUE, created_at)`. **There is no `size_bytes` column on `podcast_episodes`** (unlike `videos`/`music_tracks`) and no `retry_count` column yet (Task 1 adds it). Do not write to a `size_bytes` column anywhere in this plan — it does not exist and the design sketch's file-size bookkeeping is intentionally dropped for that reason.
- **`requireAdmin`** (`server/utils/auth.ts`) and **`getDb`** (`server/utils/db.ts`) are Nitro server-utils auto-imports — every file under `server/api/` and `server/utils/` can call them with zero import line, and the existing music route files are inconsistent about importing them explicitly anyway (some do, some don't). Each task below matches its direct music-route precedent's import style file-for-file, not a unified style.
- **`resetStaleDownloadsForTable`**'s `table` parameter is currently typed `'videos' | 'music_tracks'` in `server/utils/concurrency.ts` — Task 6 widens this union to include `'podcast_episodes'`.
- Every new/modified TypeScript file must type-check under the project's existing `tsconfig.json` (Nuxt-generated references); every task's commit step assumes `npm test` passes first.

---

### Task 1: Migration, dependency, and settings seeds

**Files:**
- Modify: `package.json`
- Modify: `server/utils/db.ts`

**Interfaces:**
- Produces: `podcast_episodes.retry_count` column; settings rows `podcast_downloader_paused`, `podcast_max_concurrent_downloads`, `podcast_sync_all_active`, `podcast_sync_cron_enabled`, `podcast_sync_cron_schedule`.
- Consumes: nothing from later tasks.

- [ ] **Step 1: Add the `rss-parser` dependency**

  Run:
  ```bash
  npm install rss-parser@^3.13.0
  ```

  This adds `rss-parser` to `dependencies` in `package.json` (not `devDependencies` — confirm after running that it landed under `"dependencies"`, since it is required by the production ingestion pipeline, not by tests).

- [ ] **Step 2: Add the `podcast_episodes.retry_count` migration**

  Open `server/utils/db.ts`. Find these two existing lines (around line 321-322):
  ```ts
  try { db.exec(`ALTER TABLE videos ADD COLUMN retry_count INTEGER DEFAULT 0;`); } catch (e) {}
  try { db.exec(`ALTER TABLE music_tracks ADD COLUMN retry_count INTEGER DEFAULT 0;`); } catch (e) {}
  ```
  Add a third line immediately after them, in the same style:
  ```ts
  try { db.exec(`ALTER TABLE podcast_episodes ADD COLUMN retry_count INTEGER DEFAULT 0;`); } catch (e) {}
  ```

- [ ] **Step 3: Seed the podcast settings rows**

  In the same file, find the block seeding `music_sync_all_active`/`music_sync_cron_enabled`/`music_sync_cron_schedule` (around line 420-436) and the block seeding `music_downloader_paused`/`music_max_concurrent_downloads` (around line 460-470). Immediately after the `music_sync_cron_schedule` seed block, insert:
  ```ts
  const podcastSyncAllCheck = db.prepare("SELECT COUNT(*) as count FROM settings WHERE key = 'podcast_sync_all_active'").get() as { count: number };
  if (podcastSyncAllCheck.count === 0) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('podcast_sync_all_active', '0')").run();
    console.log('Seeded setting podcast_sync_all_active: 0');
  }

  const podcastCronEnabledCheck = db.prepare("SELECT COUNT(*) as count FROM settings WHERE key = 'podcast_sync_cron_enabled'").get() as { count: number };
  if (podcastCronEnabledCheck.count === 0) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('podcast_sync_cron_enabled', '0')").run();
    console.log('Seeded setting podcast_sync_cron_enabled: 0');
  }

  const podcastCronScheduleCheck = db.prepare("SELECT COUNT(*) as count FROM settings WHERE key = 'podcast_sync_cron_schedule'").get() as { count: number };
  if (podcastCronScheduleCheck.count === 0) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('podcast_sync_cron_schedule', '0 4 * * *')").run();
    console.log('Seeded setting podcast_sync_cron_schedule: 0 4 * * *');
  }
  ```
  Immediately after the `music_max_concurrent_downloads` seed block, insert:
  ```ts
  const podcastPausedCheck = db.prepare("SELECT COUNT(*) as count FROM settings WHERE key = 'podcast_downloader_paused'").get() as { count: number };
  if (podcastPausedCheck.count === 0) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('podcast_downloader_paused', '0')").run();
    console.log('Seeded setting podcast_downloader_paused: 0');
  }

  const podcastMaxConcurrentCheck = db.prepare("SELECT COUNT(*) as count FROM settings WHERE key = 'podcast_max_concurrent_downloads'").get() as { count: number };
  if (podcastMaxConcurrentCheck.count === 0) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('podcast_max_concurrent_downloads', '2')").run();
    console.log('Seeded setting podcast_max_concurrent_downloads: 2');
  }
  ```
  (`0 4 * * *` is deliberately a different hour than video's `0 3 * * *` and music's `30 3 * * *`, so all three auto-syncs don't fire in the same minute.)

- [ ] **Step 4: Verify and commit**

  Run:
  ```bash
  npm test
  ```
  Expect the existing suite to still pass (this task adds no new tests — it's pure schema/dependency setup, verified indirectly by every later task's tests exercising the new column/settings).

  Commit:
  ```bash
  git add package.json package-lock.json server/utils/db.ts
  git commit -m "$(cat <<'EOF'
  feat: add podcast_episodes.retry_count migration and rss-parser dependency

  Prepares the schema and dependency for the podcast RSS ingestion pipeline
  (server/utils/podcastDownloader.ts, added in the following tasks).

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 2: `podcastDownloader.ts` skeleton — global state, dirs, cleanup

**Files:**
- Create: `server/utils/podcastDownloader.ts`

**Interfaces:**
- Consumes: `getDb()` (`./db`), `addLog`, `sanitizeFolderName`, `isDirWritable` (`./downloader`).
- Produces: `getActivePodcastDownloadCount(): number`, `wakePodcastWorker(): void`, `getPodcastDownloadsDir(): string`, `cleanupPartialPodcastFiles(episodeId: string, showId: string, opts?: { newerThan?: number }): void`, exported `activePodcastAbortControllers: Map<string, AbortController>`, `activePodcastDownloadStartTimes: Map<string, number>`. Module-private: `sleepOrWakeablePodcast(ms: number): Promise<void>`, `getIsPodcastProcessing`/`setIsPodcastProcessing`, `getPodcastWorkerShouldRun`/`setPodcastWorkerShouldRun`, `incrementActivePodcastDownloadCount`/`decrementActivePodcastDownloadCount`, `getActivePodcastCronJob`/`setActivePodcastCronJob`, constant `PODCAST_DOWNLOAD_TIMEOUT_MS`. These exact names are relied on by Tasks 3-8 — do not rename.

- [ ] **Step 1: Create the file with imports and global state**

  Create `server/utils/podcastDownloader.ts`:
  ```ts
  import fs from 'fs';
  import path from 'path';
  import crypto from 'crypto';
  import Parser from 'rss-parser';
  import { Cron } from 'croner';
  import { getDb } from './db';
  import { addLog, sanitizeFolderName, isDirWritable } from './downloader';
  import { parseMaxConcurrentDownloads, hasCapacityForMoreDownloads, hasEnoughDiskSpace, resetStaleDownloadsForTable, runSyncAllEntities } from './concurrency';

  // Define global-backed state to survive development HMR module hot reloads,
  // same pattern as downloader.ts's and musicDownloader.ts's own worker state.
  const _g = globalThis as any;
  const G_PODCAST_PROCESSING = Symbol.for('YouKeep.isPodcastProcessing');
  const G_PODCAST_SHOULD_RUN = Symbol.for('YouKeep.podcastWorkerShouldRun');
  const G_PODCAST_ACTIVE_DOWNLOAD_COUNT = Symbol.for('YouKeep.activePodcastDownloadCount');
  // No G_PODCAST_PROCESSES map of child processes — RSS ingestion has no yt-dlp
  // child process to track. Downloads are cancelled via AbortController.abort()
  // instead of child.kill(), so this tracks controllers instead.
  const G_PODCAST_ABORT_CONTROLLERS = Symbol.for('YouKeep.activePodcastAbortControllers');
  const G_PODCAST_DOWNLOAD_START_TIMES = Symbol.for('YouKeep.activePodcastDownloadStartTimes');
  // Deliberately a SEPARATE symbol from downloader.ts's G_CRON and
  // musicDownloader.ts's G_MUSIC_CRON — the video, music, and podcast cron
  // jobs must be independently startable/stoppable, never sharing a handle.
  const G_PODCAST_CRON = Symbol.for('YouKeep.activePodcastCronJob');

  if (!(G_PODCAST_PROCESSING in _g)) _g[G_PODCAST_PROCESSING] = false;
  if (!(G_PODCAST_SHOULD_RUN in _g)) _g[G_PODCAST_SHOULD_RUN] = false;
  if (!(G_PODCAST_ACTIVE_DOWNLOAD_COUNT in _g)) _g[G_PODCAST_ACTIVE_DOWNLOAD_COUNT] = 0;
  if (!(G_PODCAST_ABORT_CONTROLLERS in _g)) _g[G_PODCAST_ABORT_CONTROLLERS] = new Map<string, AbortController>();
  if (!(G_PODCAST_DOWNLOAD_START_TIMES in _g)) _g[G_PODCAST_DOWNLOAD_START_TIMES] = new Map<string, number>();
  if (!(G_PODCAST_CRON in _g)) _g[G_PODCAST_CRON] = null;

  function getActivePodcastCronJob(): Cron | null { return _g[G_PODCAST_CRON]; }
  function setActivePodcastCronJob(val: Cron | null) { _g[G_PODCAST_CRON] = val; }

  function getIsPodcastProcessing(): boolean { return _g[G_PODCAST_PROCESSING]; }
  function setIsPodcastProcessing(val: boolean) { _g[G_PODCAST_PROCESSING] = val; }
  function getPodcastWorkerShouldRun(): boolean { return _g[G_PODCAST_SHOULD_RUN]; }
  function setPodcastWorkerShouldRun(val: boolean) { _g[G_PODCAST_SHOULD_RUN] = val; }
  export function getActivePodcastDownloadCount(): number { return _g[G_PODCAST_ACTIVE_DOWNLOAD_COUNT]; }
  function incrementActivePodcastDownloadCount() { _g[G_PODCAST_ACTIVE_DOWNLOAD_COUNT]++; }
  function decrementActivePodcastDownloadCount() { _g[G_PODCAST_ACTIVE_DOWNLOAD_COUNT] = Math.max(0, _g[G_PODCAST_ACTIVE_DOWNLOAD_COUNT] - 1); }

  let podcastWorkerWakeResolver: (() => void) | null = null;

  function sleepOrWakeablePodcast(ms: number) {
    return new Promise<void>(resolve => {
      let timeoutId: any = null;
      const cleanResolve = () => {
        if (timeoutId) clearTimeout(timeoutId);
        podcastWorkerWakeResolver = null;
        resolve();
      };
      podcastWorkerWakeResolver = cleanResolve;
      timeoutId = setTimeout(cleanResolve, ms);
    });
  }

  export function wakePodcastWorker() {
    if (podcastWorkerWakeResolver) {
      podcastWorkerWakeResolver();
    }
  }

  // Maximum time (ms) a single episode download is allowed to run before being
  // aborted. Duplicated from downloader.ts's/musicDownloader.ts's own constant
  // of the same value (not exported by either) rather than importing it — this
  // is a constant, not logic, so the duplication is cheap and avoids coupling
  // this file to an unrelated module's internals.
  const PODCAST_DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

  export const activePodcastAbortControllers: Map<string, AbortController> = _g[G_PODCAST_ABORT_CONTROLLERS];
  export const activePodcastDownloadStartTimes: Map<string, number> = _g[G_PODCAST_DOWNLOAD_START_TIMES];
  ```

- [ ] **Step 2: Add `getPodcastDownloadsDir` and `cleanupPartialPodcastFiles`**

  Append to the same file:
  ```ts
  export function getPodcastDownloadsDir(): string {
    const defaultPath = '/downloads/podcasts';
    if (isDirWritable(defaultPath)) {
      return defaultPath;
    }

    const localFallback = path.resolve(process.cwd(), 'data/downloads-podcasts');
    try { fs.mkdirSync(localFallback, { recursive: true }); } catch (err) {}
    return localFallback;
  }

  export function cleanupPartialPodcastFiles(episodeId: string, showId: string, opts: { newerThan?: number } = {}): void {
    const db = getDb();
    const show = db.prepare('SELECT title FROM podcast_shows WHERE id = ?').get(showId) as { title: string } | undefined;
    const basePath = getPodcastDownloadsDir();
    const showDir = path.join(basePath, sanitizeFolderName(show?.title || showId));

    if (!fs.existsSync(showDir)) return;

    const prefix = `${episodeId}.`;
    let entries: string[];
    try {
      entries = fs.readdirSync(showDir);
    } catch (e) {
      return;
    }

    for (const entry of entries) {
      if (!entry.startsWith(prefix)) continue;
      const fullPath = path.join(showDir, entry);
      if (opts.newerThan !== undefined) {
        // A file that predates this download attempt is a previously-completed
        // file, not a partial artifact of the attempt being aborted — leave it alone.
        try {
          if (fs.statSync(fullPath).mtimeMs < opts.newerThan) continue;
        } catch (e) {
          continue;
        }
      }
      try { fs.unlinkSync(fullPath); } catch (e) {}
    }
  }
  ```

- [ ] **Step 3: Type-check and commit**

  Run:
  ```bash
  npx tsc --noEmit -p .nuxt/tsconfig.server.json 2>&1 | grep podcastDownloader || echo "no podcastDownloader errors"
  ```
  (If `.nuxt/tsconfig.server.json` doesn't exist yet in this checkout, run `npx nuxt prepare` once first — `postinstall` normally generates it.) Fix any reported errors before proceeding — at this point the file has unused-import warnings for `crypto`, `Parser`, `Cron`, `parseMaxConcurrentDownloads`, `hasCapacityForMoreDownloads`, `hasEnoughDiskSpace`, `resetStaleDownloadsForTable`, `runSyncAllEntities`, `getActivePodcastCronJob`, `setActivePodcastCronJob`, `PODCAST_DOWNLOAD_TIMEOUT_MS` — these are all consumed by Tasks 3-6 and are expected to be unused until then; do not delete them, and don't worry if the linter flags them (this codebase has no unused-import lint gate blocking commits — confirm by checking `npm test` still passes, since it doesn't run a separate lint step).

  Run:
  ```bash
  npm test
  ```

  Commit:
  ```bash
  git add server/utils/podcastDownloader.ts
  git commit -m "$(cat <<'EOF'
  feat: add podcastDownloader.ts skeleton (global state, dirs, cleanup)

  Structural precedent is musicDownloader.ts, with the child-process-tracking
  map replaced by an AbortController map (RSS ingestion has no yt-dlp process
  to spawn or kill).

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 3: `ingestPodcastFeed` + pure helpers + unit tests

**Files:**
- Modify: `server/utils/podcastDownloader.ts`
- Create: `tests/unit/podcastDownloader.test.ts`

**Interfaces:**
- Consumes: `getDb()`, `addLog`, `sanitizeFolderName` (already imported in Task 2); `Parser` from `rss-parser`; `crypto` (already imported).
- Produces: `export function parseItunesDuration(raw: string | null | undefined): number | null`, `export function hashPodcastEpisodeId(feedUrl: string, guidOrUrl: string): string`, `export async function ingestPodcastFeed(feedUrl: string, options?: { sync_status?: string; visibility?: string }): Promise<{ success: boolean; message: string; count: number }>`. `ingestPodcastFeed` calls `startPodcastQueueWorker()` (defined in Task 5, hoisted function declaration — safe to call here since it's the same module).

- [ ] **Step 1: Add `parseItunesDuration`**

  Append to `server/utils/podcastDownloader.ts`:
  ```ts
  /**
   * Parses an itunes:duration value, which RSS feeds represent inconsistently:
   * HH:MM:SS, MM:SS, or a bare integer number of seconds. Returns null for
   * anything that doesn't match one of those three shapes (missing, empty,
   * non-numeric, wrong segment count).
   */
  export function parseItunesDuration(raw: string | null | undefined): number | null {
    if (raw === null || raw === undefined) return null;
    const trimmed = String(raw).trim();
    if (trimmed.length === 0) return null;

    if (/^\d+$/.test(trimmed)) {
      return parseInt(trimmed, 10);
    }

    const parts = trimmed.split(':');
    if (parts.length < 2 || parts.length > 3 || parts.some(p => !/^\d+$/.test(p))) {
      return null;
    }
    const nums = parts.map(p => parseInt(p, 10));
    if (nums.length === 3) {
      return nums[0]! * 3600 + nums[1]! * 60 + nums[2]!;
    }
    return nums[0]! * 60 + nums[1]!;
  }
  ```

- [ ] **Step 2: Add `hashPodcastEpisodeId`**

  Append:
  ```ts
  /**
   * Derives a stable episode primary key from the feed URL and the item's
   * GUID (or, when no GUID is present, its enclosure URL — the caller passes
   * whichever it has). Hashing the feed URL together with the raw guid means
   * two different feeds that happen to reuse the same raw guid value never
   * collide, since feedUrl is part of the hash input. sha256 hex digest is
   * always a valid SQLite TEXT primary key with no character-set concerns.
   */
  export function hashPodcastEpisodeId(feedUrl: string, guidOrUrl: string): string {
    return crypto.createHash('sha256').update(`${feedUrl}::${guidOrUrl}`).digest('hex');
  }
  ```

- [ ] **Step 3: Add `ingestPodcastFeed`**

  Append:
  ```ts
  /**
   * Metadata ingestion for podcasts. Fetches and parses an RSS feed and
   * writes it to the podcast_shows/podcast_episodes tables. Mirrors
   * ingestMusicUrl in musicDownloader.ts, adapted for RSS: podcast_shows.id
   * is a generated id (not the feed URL itself), so show lookup/upsert is
   * always by feed_url. There is no channel/single-item split like YouTube
   * ingestion — a feed always describes exactly one show plus its episode list.
   */
  export async function ingestPodcastFeed(
    feedUrl: string,
    options: {
      sync_status?: string;
      visibility?: string;
    } = {}
  ): Promise<{ success: boolean; message: string; count: number }> {
    const db = getDb();
    const trimmedFeedUrl = feedUrl.trim();

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

    let feed: any;
    try {
      feed = await parser.parseURL(trimmedFeedUrl);
    } catch (err: any) {
      return { success: false, message: `Failed to fetch/parse RSS feed: ${err.message || err}`, count: 0 };
    }

    const showTitle = feed.title || 'Untitled Podcast';
    const showDescription = feed.description || null;
    const showAuthor = feed.itunesAuthor || feed.author || null;
    const showCoverUrl = feed.itunesImage?.href || feed.image?.url || null;
    const showLanguage = feed.language || null;

    const existingShow = db.prepare('SELECT id FROM podcast_shows WHERE feed_url = ?').get(trimmedFeedUrl) as { id: string } | undefined;
    const showId = existingShow?.id || crypto.randomUUID();
    const initialSyncStatus = options.sync_status || 'paused';
    const initialVisibility = options.visibility || 'public';

    if (existingShow) {
      db.prepare(`
        UPDATE podcast_shows
        SET title = ?, description = ?, author = ?, cover_url = COALESCE(?, cover_url), language = ?,
            sync_status = COALESCE(?, sync_status), visibility = COALESCE(?, visibility), last_checked_at = ?
        WHERE id = ?
      `).run(showTitle, showDescription, showAuthor, showCoverUrl, showLanguage, options.sync_status ?? null, options.visibility ?? null, Date.now(), showId);
    } else {
      db.prepare(`
        INSERT INTO podcast_shows (id, feed_url, title, description, author, cover_url, language, sync_status, visibility, last_checked_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(showId, trimmedFeedUrl, showTitle, showDescription, showAuthor, showCoverUrl, showLanguage, initialSyncStatus, initialVisibility, Date.now(), Date.now());
    }

    const items: any[] = Array.isArray(feed.items) ? feed.items : [];
    const upsertEpisode = db.prepare(`
      INSERT INTO podcast_episodes (id, show_id, title, description, audio_url, duration, episode_number, season_number, pub_date, download_status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        description = excluded.description,
        audio_url = excluded.audio_url,
        duration = COALESCE(excluded.duration, duration),
        episode_number = COALESCE(excluded.episode_number, episode_number),
        season_number = COALESCE(excluded.season_number, season_number),
        pub_date = COALESCE(excluded.pub_date, pub_date)
    `);
    const checkExists = db.prepare('SELECT 1 FROM podcast_episodes WHERE id = ?');

    let episodesAdded = 0;
    let skippedNoEnclosure = 0;
    for (const item of items) {
      // Episodes with no enclosure URL are a normal, common feed shape (show
      // notes, trailers) — skip silently, don't insert a broken row.
      const audioUrl: string | undefined = item.enclosure?.url;
      if (!audioUrl) {
        skippedNoEnclosure++;
        continue;
      }

      const rawGuid = item.guid || audioUrl;
      const episodeId = hashPodcastEpisodeId(trimmedFeedUrl, rawGuid);
      const exists = checkExists.get(episodeId);

      const parsedEpisodeNumber = item.itunesEpisode ? parseInt(item.itunesEpisode, 10) : null;
      const parsedSeasonNumber = item.itunesSeason ? parseInt(item.itunesSeason, 10) : null;
      const episodeNumber = Number.isFinite(parsedEpisodeNumber) ? parsedEpisodeNumber : null;
      const seasonNumber = Number.isFinite(parsedSeasonNumber) ? parsedSeasonNumber : null;
      const duration = parseItunesDuration(item.itunesDuration);

      upsertEpisode.run(
        episodeId,
        showId,
        item.title || `Episode ${episodeId}`,
        item.contentSnippet || item.content || null,
        audioUrl,
        duration,
        episodeNumber,
        seasonNumber,
        item.pubDate || null,
        Date.now()
      );

      if (!exists) episodesAdded++;
    }

    if (skippedNoEnclosure > 0) {
      addLog(`Ingestion du flux "${showTitle}" : ${skippedNoEnclosure} élément(s) sans enclosure audio ignoré(s).`);
    }

    const showState = db.prepare('SELECT sync_status FROM podcast_shows WHERE id = ?').get(showId) as { sync_status: string } | undefined;
    if (showState?.sync_status === 'downloading') {
      startPodcastQueueWorker();
    }

    return {
      success: true,
      message: `Podcast "${showTitle}" ingested. ${episodesAdded} new episode(s) added.`,
      count: episodesAdded
    };
  }
  ```
  Note: `startPodcastQueueWorker` is defined in Task 5, further down the same file. This is safe — `function`-declared (not `const =`) exports are hoisted within a module, exactly matching how `ingestMusicUrl` (defined earlier in `musicDownloader.ts`) already calls `startMusicQueueWorker` (defined later in the same file).

- [ ] **Step 4: Write the unit tests (RED first)**

  Create `tests/unit/podcastDownloader.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest';
  import { parseItunesDuration, hashPodcastEpisodeId } from '../../server/utils/podcastDownloader';

  describe('parseItunesDuration', () => {
    it('parses HH:MM:SS', () => {
      expect(parseItunesDuration('01:02:03')).toBe(3723);
    });

    it('parses MM:SS', () => {
      expect(parseItunesDuration('05:30')).toBe(330);
    });

    it('parses a bare integer number of seconds', () => {
      expect(parseItunesDuration('125')).toBe(125);
    });

    it('parses "0" as zero, not null', () => {
      expect(parseItunesDuration('0')).toBe(0);
    });

    it('returns null for missing input', () => {
      expect(parseItunesDuration(undefined)).toBeNull();
      expect(parseItunesDuration(null)).toBeNull();
    });

    it('returns null for an empty string', () => {
      expect(parseItunesDuration('')).toBeNull();
      expect(parseItunesDuration('   ')).toBeNull();
    });

    it('returns null for non-numeric junk', () => {
      expect(parseItunesDuration('abc')).toBeNull();
      expect(parseItunesDuration('aa:bb')).toBeNull();
    });

    it('returns null for a malformed segment count', () => {
      expect(parseItunesDuration('1:2:3:4')).toBeNull();
      expect(parseItunesDuration(':30')).toBeNull();
    });

    it('tolerates unpadded single-digit segments', () => {
      expect(parseItunesDuration('1:2:3')).toBe(3723);
    });
  });

  describe('hashPodcastEpisodeId', () => {
    it('produces the same hash for the same feed URL and guid every time (deterministic)', () => {
      const id1 = hashPodcastEpisodeId('https://example.com/feed.xml', 'episode-42');
      const id2 = hashPodcastEpisodeId('https://example.com/feed.xml', 'episode-42');
      expect(id1).toBe(id2);
    });

    it('produces a different hash for different feeds reusing the same raw guid', () => {
      const idA = hashPodcastEpisodeId('https://feed-a.example.com/rss.xml', 'ep-1');
      const idB = hashPodcastEpisodeId('https://feed-b.example.com/rss.xml', 'ep-1');
      expect(idA).not.toBe(idB);
    });

    it('produces a different hash for a different guid within the same feed', () => {
      const idA = hashPodcastEpisodeId('https://example.com/feed.xml', 'ep-1');
      const idB = hashPodcastEpisodeId('https://example.com/feed.xml', 'ep-2');
      expect(idA).not.toBe(idB);
    });

    it('produces a stable id computed the same way ingestPodcastFeed falls back from a missing guid to the audio_url', () => {
      const feedUrl = 'https://example.com/feed.xml';
      const itemWithoutGuid = { guid: undefined as string | undefined, audioUrl: 'https://cdn.example.com/ep1.mp3' };
      // ingestPodcastFeed computes: item.guid || item.enclosure.url
      const rawGuid = itemWithoutGuid.guid || itemWithoutGuid.audioUrl;
      const idFromFallback = hashPodcastEpisodeId(feedUrl, rawGuid);
      const idFromDirectAudioUrl = hashPodcastEpisodeId(feedUrl, itemWithoutGuid.audioUrl);
      expect(idFromFallback).toBe(idFromDirectAudioUrl);
    });

    it('returns a 64-character lowercase hex sha256 digest', () => {
      const id = hashPodcastEpisodeId('https://example.com/feed.xml', 'ep-1');
      expect(id).toMatch(/^[0-9a-f]{64}$/);
    });
  });
  ```

- [ ] **Step 5: Run the tests (should be GREEN — this is a plan, not live TDD pairing, but confirm they pass as written)**

  Run:
  ```bash
  npx vitest run tests/unit/podcastDownloader.test.ts
  ```
  Expected: all tests pass. If `parseItunesDuration('1:2:3')` fails, re-check the regex `^\d+$` per segment — it should accept unpadded digits (`\d+`, not `\d{2}`) since real feeds are inconsistent about zero-padding.

- [ ] **Step 6: Full suite and commit**

  Run:
  ```bash
  npm test
  ```

  Commit:
  ```bash
  git add server/utils/podcastDownloader.ts tests/unit/podcastDownloader.test.ts
  git commit -m "$(cat <<'EOF'
  feat: add ingestPodcastFeed, parseItunesDuration, hashPodcastEpisodeId

  parseItunesDuration and hashPodcastEpisodeId are pure and network-free, so
  they get real unit tests, unlike the download logic later in this file
  (matching the established no-tests-for-network-download convention).

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 4: `downloadEpisodeFile` — HTTP stream download

**Files:**
- Modify: `server/utils/podcastDownloader.ts`

**Interfaces:**
- Consumes: `getDb()`, `addLog`, `sanitizeFolderName`, `getPodcastDownloadsDir()`, `cleanupPartialPodcastFiles()`, `activePodcastAbortControllers`, `activePodcastDownloadStartTimes`, `PODCAST_DOWNLOAD_TIMEOUT_MS` (all from Task 2).
- Produces: module-private `function downloadEpisodeFile(episodeId: string, showId: string): Promise<void>` (not exported — mirrors `downloadMusicTrackFile` and `downloadVideoFile`, both module-private, invoked only by the queue worker's per-download runner in Task 5). Also module-private helpers `extensionFromContentType`, `extensionFromUrl`, `formatBytesPerSec`, `formatEta`.

- [ ] **Step 1: Add the format/extension helper functions**

  Append to `server/utils/podcastDownloader.ts`:
  ```ts
  // Maps common podcast enclosure content-types to a file extension. Falls back
  // to sniffing the URL's own extension, then to 'mp3', in downloadEpisodeFile.
  function extensionFromContentType(contentType: string | null): string | null {
    if (!contentType) return null;
    const type = contentType.split(';')[0]!.trim().toLowerCase();
    const map: Record<string, string> = {
      'audio/mpeg': 'mp3',
      'audio/mp3': 'mp3',
      'audio/mp4': 'm4a',
      'audio/x-m4a': 'm4a',
      'audio/aac': 'aac',
      'audio/ogg': 'ogg',
      'audio/opus': 'opus',
      'audio/wav': 'wav',
      'audio/x-wav': 'wav',
      'audio/flac': 'flac',
      'audio/webm': 'weba',
    };
    return map[type] || null;
  }

  function extensionFromUrl(url: string): string | null {
    try {
      const parsed = new URL(url);
      const match = parsed.pathname.match(/\.([a-zA-Z0-9]{2,5})$/);
      return match ? match[1]!.toLowerCase() : null;
    } catch (e) {
      return null;
    }
  }

  // Local duplicates of downloader.ts's private formatBytesToSpeed/
  // formatSecondsToETA (neither is exported there) — same cheap-duplication
  // reasoning as PODCAST_DOWNLOAD_TIMEOUT_MS above, adapted to the
  // byte-count-based progress this pipeline computes (yt-dlp's stdout already
  // gives a formatted speed/ETA string; a raw fetch() stream does not).
  function formatBytesPerSec(bytesPerSec: number): string {
    if (!Number.isFinite(bytesPerSec) || bytesPerSec <= 0) return '0KB/s';
    if (bytesPerSec >= 1024 * 1024 * 1024) return (bytesPerSec / (1024 * 1024 * 1024)).toFixed(1) + ' GB/s';
    if (bytesPerSec >= 1024 * 1024) return (bytesPerSec / (1024 * 1024)).toFixed(1) + ' MB/s';
    if (bytesPerSec >= 1024) return (bytesPerSec / 1024).toFixed(0) + ' KB/s';
    return bytesPerSec.toFixed(0) + ' B/s';
  }

  function formatEta(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) return '--:--';
    if (seconds > 3600) {
      const hrs = Math.floor(seconds / 3600);
      const mins = Math.floor((seconds % 3600) / 60);
      const secs = Math.floor(seconds % 60);
      return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  ```

- [ ] **Step 2: Add `downloadEpisodeFile`**

  Append:
  ```ts
  /**
   * Downloads an episode's enclosure audio file over plain HTTP, replacing
   * downloadMusicTrackFile's yt-dlp spawn (there is no yt-dlp involvement in
   * RSS ingestion at all). Progress is computed from received/total byte
   * counts (Content-Length) instead of parsed from yt-dlp stdout, and
   * cancellation/timeout goes through AbortController.abort() instead of
   * child.kill('SIGKILL'). NOTE: podcast_episodes has no size_bytes column
   * (unlike videos/music_tracks) — this deliberately does not write a file
   * size anywhere; only local_file_path is recorded on success.
   */
  function downloadEpisodeFile(episodeId: string, showId: string): Promise<void> {
    const attemptStartedAt = Date.now();
    return new Promise<void>(async (resolve, reject) => {
      const db = getDb();
      let settled = false;
      const settle = (fn: () => void) => { if (!settled) { settled = true; fn(); } };

      const controller = new AbortController();
      activePodcastAbortControllers.set(episodeId, controller);
      activePodcastDownloadStartTimes.set(episodeId, attemptStartedAt);

      const watchdog = setTimeout(() => {
        if (!settled) {
          addLog(`Téléchargement podcast [${episodeId}] timeout après ${PODCAST_DOWNLOAD_TIMEOUT_MS / 60000} minutes. Annulation.`);
          try { controller.abort(); } catch (e) {}
          activePodcastAbortControllers.delete(episodeId);
          activePodcastDownloadStartTimes.delete(episodeId);
          cleanupPartialPodcastFiles(episodeId, showId, { newerThan: attemptStartedAt });
          settle(() => reject(new Error(`Timeout: le téléchargement a dépassé ${PODCAST_DOWNLOAD_TIMEOUT_MS / 60000} minutes`)));
        }
      }, PODCAST_DOWNLOAD_TIMEOUT_MS);

      try {
        const episode = db.prepare('SELECT audio_url FROM podcast_episodes WHERE id = ?').get(episodeId) as { audio_url: string } | undefined;
        if (!episode || !episode.audio_url) {
          throw new Error("L'épisode n'a pas d'audio_url à télécharger.");
        }

        const show = db.prepare('SELECT title FROM podcast_shows WHERE id = ?').get(showId) as { title: string } | undefined;
        const folderName = sanitizeFolderName(show?.title || showId);
        const baseDir = getPodcastDownloadsDir();
        const showDir = path.join(baseDir, folderName);
        if (!fs.existsSync(showDir)) {
          fs.mkdirSync(showDir, { recursive: true });
        }

        addLog(`Lancement du téléchargement de l'épisode ${episodeId} : ${episode.audio_url}`);
        const response = await fetch(episode.audio_url, { signal: controller.signal });
        if (!response.ok || !response.body) {
          throw new Error(`HTTP ${response.status}`);
        }

        const ext = extensionFromContentType(response.headers.get('content-type')) || extensionFromUrl(episode.audio_url) || 'mp3';
        const outputPath = path.join(showDir, `${episodeId}.${ext}`);
        const localFilePath = `/downloads-podcasts/${folderName}/${episodeId}.${ext}`;

        const totalBytes = parseInt(response.headers.get('content-length') || '0', 10);
        let receivedBytes = 0;
        let lastDbWrite = 0;
        const fileStream = fs.createWriteStream(outputPath);

        for await (const chunk of response.body as any) {
          fileStream.write(chunk);
          receivedBytes += chunk.length;
          const now = Date.now();
          // Throttled — matches the ~yt-dlp-progress-line cadence, not on every chunk.
          if (now - lastDbWrite > 500 && totalBytes > 0) {
            const progress = Math.round((receivedBytes / totalBytes) * 100);
            const elapsedSec = (now - attemptStartedAt) / 1000;
            const rate = elapsedSec > 0 ? receivedBytes / elapsedSec : 0;
            const speed = rate > 0 ? formatBytesPerSec(rate) : '0KB/s';
            const remainingBytes = totalBytes - receivedBytes;
            const eta = rate > 0 ? formatEta(remainingBytes / rate) : '--:--';
            db.prepare(`
              UPDATE podcast_episodes
              SET download_progress = ?, download_speed = ?, download_eta = ?
              WHERE id = ?
            `).run(progress, speed, eta, episodeId);
            lastDbWrite = now;
          }
        }

        await new Promise<void>((res, rej) => {
          fileStream.end((err?: Error | null) => {
            if (err) rej(err); else res();
          });
        });

        clearTimeout(watchdog);
        activePodcastAbortControllers.delete(episodeId);
        activePodcastDownloadStartTimes.delete(episodeId);

        try {
          db.prepare(`
            UPDATE podcast_episodes
            SET local_file_path = ?
            WHERE id = ?
          `).run(localFilePath, episodeId);
          settle(() => resolve());
        } catch (dbErr: any) {
          // The file downloaded successfully, but the DB write that records it
          // failed. Treat this identically to an ordinary download failure —
          // same rejection, no file cleanup here (the download itself was
          // fine) — so the promise always settles instead of hanging forever.
          settle(() => reject(dbErr));
        }
      } catch (err: any) {
        clearTimeout(watchdog);
        activePodcastAbortControllers.delete(episodeId);
        activePodcastDownloadStartTimes.delete(episodeId);
        if (!settled) {
          addLog(`Échec du téléchargement de l'épisode ${episodeId} : ${err.message || err}`);
          cleanupPartialPodcastFiles(episodeId, showId, { newerThan: attemptStartedAt });
        }
        settle(() => reject(err));
      }
    });
  }
  ```

- [ ] **Step 3: Type-check and commit**

  Run:
  ```bash
  npm test
  ```
  (No new tests in this task — per Global Constraints, `downloadEpisodeFile`'s network-dependent logic gets no automated tests, matching the accepted convention for `downloader.ts`/`musicDownloader.ts`'s equivalent functions. `npm test` here is a safety net confirming nothing else broke.)

  Commit:
  ```bash
  git add server/utils/podcastDownloader.ts
  git commit -m "$(cat <<'EOF'
  feat: add downloadEpisodeFile HTTP stream download

  Replaces musicDownloader.ts's yt-dlp child-process spawn with a fetch()
  stream and AbortController-based cancellation/timeout — RSS episode audio
  is a plain HTTP GET of the feed's <enclosure> URL, no external binary
  involved. No size_bytes bookkeeping: podcast_episodes has no such column.

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 5: Queue worker, per-download runner, cancellation

**Files:**
- Modify: `server/utils/podcastDownloader.ts`

**Interfaces:**
- Consumes: `getDb()`, `addLog`, `sleepOrWakeablePodcast`, `wakePodcastWorker`, `getIsPodcastProcessing`/`setIsPodcastProcessing`, `getPodcastWorkerShouldRun`/`setPodcastWorkerShouldRun`, `getActivePodcastDownloadCount`, `increment/decrementActivePodcastDownloadCount`, `getPodcastDownloadsDir()`, `downloadEpisodeFile()`, `parseMaxConcurrentDownloads`, `hasCapacityForMoreDownloads`, `hasEnoughDiskSpace` (all already present from Tasks 2-4).
- Produces: `export async function startPodcastQueueWorker(): Promise<void>` (already referenced by `ingestPodcastFeed` in Task 3), module-private `async function runSinglePodcastDownload(episodeId: string, episodeTitle: string, showId: string): Promise<void>`, `export function cancelPodcastDownload(episodeId: string, targetStatus?: 'failed' | 'pending', keepProgressAndFiles?: boolean): boolean` — this exact signature is consumed by Task 7's `pause.post.ts`.

- [ ] **Step 1: Add `startPodcastQueueWorker`**

  Append to `server/utils/podcastDownloader.ts`:
  ```ts
  /**
   * Background loop that processes the podcast download queue. Persistent:
   * polls every few seconds instead of exiting when empty. Mirrors
   * startMusicQueueWorker exactly, with one deliberate omission: no
   * hasCapacityForCombinedDownloads check against COMBINED_MAX_CONCURRENT_DOWNLOADS.
   * Podcasts run their own independent per-pipeline cap only — extending the
   * video+music combined cap to a third pipeline is a separate decision this
   * plan does not make (see Global Constraints).
   */
  export async function startPodcastQueueWorker() {
    if (getIsPodcastProcessing()) {
      addLog('Worker podcast déjà en cours d\'exécution. Réveil du worker...');
      wakePodcastWorker();
      return;
    }
    setIsPodcastProcessing(true);
    setPodcastWorkerShouldRun(true);
    addLog('Démarrage du worker de podcasts (mode persistant)...');

    try {
      const db = getDb();
      let consecutiveSystemErrors = 0;

      while (getPodcastWorkerShouldRun()) {
        try {
          const pausedSetting = db.prepare("SELECT value FROM settings WHERE key = 'podcast_downloader_paused'").get() as { value: string } | undefined;
          if (pausedSetting?.value === '1') {
            await sleepOrWakeablePodcast(5000);
            continue;
          }

          // Check disk space first — it's the only await in this sequence, so
          // running it before the capacity check below ensures nothing yields
          // the event loop between that check passing and the counter increment.
          if (!(await hasEnoughDiskSpace(getPodcastDownloadsDir()))) {
            await sleepOrWakeablePodcast(5000);
            continue;
          }

          const concurrencySetting = db.prepare("SELECT value FROM settings WHERE key = 'podcast_max_concurrent_downloads'").get() as { value: string } | undefined;
          const maxConcurrent = parseMaxConcurrentDownloads(concurrencySetting?.value);
          if (!hasCapacityForMoreDownloads(getActivePodcastDownloadCount(), maxConcurrent)) {
            await sleepOrWakeablePodcast(1000);
            continue;
          }

          const episode = db.prepare(`
            SELECT e.id, e.title, e.show_id
            FROM podcast_episodes e
            JOIN podcast_shows s ON e.show_id = s.id
            WHERE e.download_status = 'pending' AND s.sync_status = 'downloading'
            ORDER BY
              CASE WHEN e.download_progress > 0 THEN 0 ELSE 1 END,
              e.created_at ASC
            LIMIT 1
          `).get() as { id: string; title: string; show_id: string } | undefined;

          if (!episode) {
            await sleepOrWakeablePodcast(3000);
            continue;
          }

          consecutiveSystemErrors = 0;
          addLog(`Lancement du téléchargement d'épisode : "${episode.title}" (ID: ${episode.id})`);

          db.prepare(`
            UPDATE podcast_episodes
            SET download_status = 'downloading',
                download_progress = COALESCE(download_progress, 0),
                download_speed = '0KB/s',
                download_eta = '--:--',
                last_error = null
            WHERE id = ?
          `).run(episode.id);

          incrementActivePodcastDownloadCount();
          runSinglePodcastDownload(episode.id, episode.title, episode.show_id);
        } catch (loopErr: any) {
          consecutiveSystemErrors++;
          addLog(`Erreur système dans la boucle du worker podcast (${consecutiveSystemErrors}/5) : ${loopErr.message || loopErr}`);
          if (consecutiveSystemErrors >= 5) {
            addLog('Trop d\'erreurs système consécutives. Arrêt du worker podcast.');
            break;
          }
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      }
    } catch (err: any) {
      addLog(`Erreur générale fatale du worker podcast : ${err.message || err}`);
    } finally {
      setIsPodcastProcessing(false);
      setPodcastWorkerShouldRun(false);
      addLog('Worker de podcasts arrêté.');
    }
  }
  ```

- [ ] **Step 2: Add `runSinglePodcastDownload`**

  Append:
  ```ts
  /**
   * Runs a single episode download to completion and updates its DB status
   * accordingly. Not awaited by the orchestrator loop above — mirrors
   * runSingleMusicDownload, minus the clip-fallback branch (podcasts have no
   * clip concept).
   */
  async function runSinglePodcastDownload(episodeId: string, episodeTitle: string, showId: string): Promise<void> {
    const db = getDb();
    const MAX_RETRY_COUNT = 3;
    try {
      await downloadEpisodeFile(episodeId, showId);

      db.prepare(`
        UPDATE podcast_episodes
        SET download_status = 'completed', download_progress = 100, download_speed = null, download_eta = null, last_error = null, retry_count = 0
        WHERE id = ?
      `).run(episodeId);
      addLog(`Téléchargement RÉUSSI : "${episodeTitle}"`);
    } catch (err: any) {
      const errMsg = err.message || String(err);
      addLog(`ÉCHEC du téléchargement pour l'épisode "${episodeTitle}" (${episodeId}) : ${errMsg}`);

      const currentEpisode = db.prepare('SELECT download_status, retry_count FROM podcast_episodes WHERE id = ?').get(episodeId) as { download_status: string; retry_count: number | null } | undefined;
      const pausedSetting = db.prepare("SELECT value FROM settings WHERE key = 'podcast_downloader_paused'").get() as { value: string } | undefined;
      const isPausedGlobal = pausedSetting?.value === '1';

      if (isPausedGlobal || currentEpisode?.download_status === 'pending') {
        addLog(`Téléchargement de l'épisode "${episodeTitle}" (${episodeId}) interrompu ou mis en pause intentionnellement.`);
        // Deliberate interruption, not a genuine failure — retry_count is untouched.
        db.prepare(`
          UPDATE podcast_episodes
          SET download_status = 'pending', download_speed = null, download_eta = null
          WHERE id = ?
        `).run(episodeId);
      } else {
        const nextRetryCount = (currentEpisode?.retry_count ?? 0) + 1;
        if (nextRetryCount >= MAX_RETRY_COUNT) {
          db.prepare(`
            UPDATE podcast_episodes
            SET download_status = 'failed', download_progress = 0, download_speed = null, download_eta = null, last_error = ?, retry_count = ?
            WHERE id = ?
          `).run(errMsg, nextRetryCount, episodeId);
          addLog(`Épisode "${episodeTitle}" (${episodeId}) marqué comme définitivement échoué après ${nextRetryCount} tentatives.`);
        } else {
          db.prepare(`
            UPDATE podcast_episodes
            SET download_status = 'pending', download_progress = 0, download_speed = null, download_eta = null, last_error = ?, created_at = ?, retry_count = ?
            WHERE id = ?
          `).run(errMsg, Date.now(), nextRetryCount, episodeId);
        }
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    } finally {
      decrementActivePodcastDownloadCount();
      wakePodcastWorker();
    }
  }
  ```

- [ ] **Step 3: Add `cancelPodcastDownload`**

  Append:
  ```ts
  /**
   * Aborts an active podcast episode download and deletes temporary files.
   * Mirrors cancelMusicDownload, substituting AbortController.abort() for
   * child.kill('SIGKILL').
   */
  export function cancelPodcastDownload(episodeId: string, targetStatus: 'failed' | 'pending' = 'pending', keepProgressAndFiles = false): boolean {
    const controller = activePodcastAbortControllers.get(episodeId);
    const startedAt = activePodcastDownloadStartTimes.get(episodeId);
    const db = getDb();

    if (controller) {
      try {
        controller.abort();
      } catch (e) {}
      activePodcastAbortControllers.delete(episodeId);
      activePodcastDownloadStartTimes.delete(episodeId);
    }

    if (keepProgressAndFiles) {
      db.prepare(`
        UPDATE podcast_episodes
        SET download_status = ?, download_speed = null, download_eta = null
        WHERE id = ?
      `).run(targetStatus, episodeId);
    } else {
      db.prepare(`
        UPDATE podcast_episodes
        SET download_status = ?, download_progress = 0, download_speed = null, download_eta = null
        WHERE id = ?
      `).run(targetStatus, episodeId);
    }

    if (!keepProgressAndFiles) {
      const episode = db.prepare('SELECT show_id FROM podcast_episodes WHERE id = ?').get(episodeId) as { show_id: string } | undefined;
      if (episode) {
        cleanupPartialPodcastFiles(episodeId, episode.show_id, startedAt !== undefined ? { newerThan: startedAt } : {});
      }
    }

    return true;
  }
  ```

- [ ] **Step 4: Full suite and commit**

  Run:
  ```bash
  npm test
  ```

  Commit:
  ```bash
  git add server/utils/podcastDownloader.ts
  git commit -m "$(cat <<'EOF'
  feat: add podcast queue worker, retry logic, and cancellation

  startPodcastQueueWorker/runSinglePodcastDownload mirror the music pipeline's
  polling loop and MAX_RETRY_COUNT=3 retry logic exactly, deliberately
  omitting the combined-cap check against video+music (podcasts get their own
  independent per-pipeline cap only). cancelPodcastDownload aborts via
  AbortController instead of killing a child process.

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 6: `resetStalePodcastDownloads`, `syncAllPodcastShows`, `initPodcastScheduler`

**Files:**
- Modify: `server/utils/concurrency.ts`
- Modify: `server/utils/podcastDownloader.ts`
- Modify: `tests/helpers/testDb.ts`
- Modify: `tests/unit/concurrency.test.ts`

**Interfaces:**
- Consumes: `resetStaleDownloadsForTable()`, `runSyncAllEntities()` (widened/used from `./concurrency`), `ingestPodcastFeed()` (Task 3), `startPodcastQueueWorker()` (Task 5), `getActivePodcastCronJob`/`setActivePodcastCronJob` (Task 2).
- Produces: `export function resetStalePodcastDownloads(): void`, `export async function syncAllPodcastShows(): Promise<void>`, `export function initPodcastScheduler(): void` — all three consumed by Task 8's scheduler plugin wiring.

- [ ] **Step 1: Widen `resetStaleDownloadsForTable`'s table type**

  In `server/utils/concurrency.ts`, find:
  ```ts
  export function resetStaleDownloadsForTable(
    db: Database.Database,
    table: 'videos' | 'music_tracks',
    resetLogLabel: string,
    errorContext: string,
    log: (msg: string) => void
  ): void {
  ```
  Change the `table` parameter's type to:
  ```ts
    table: 'videos' | 'music_tracks' | 'podcast_episodes',
  ```

- [ ] **Step 2: Add podcast table helpers to `tests/helpers/testDb.ts`**

  In `tests/helpers/testDb.ts`, inside `createTestDb()`'s `db.exec(...)` template literal, immediately after the closing of the `music_play_history` table definition and before the closing backtick, add:
  ```sql

      CREATE TABLE podcast_shows (
        id TEXT PRIMARY KEY,
        feed_url TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL,
        sync_status TEXT DEFAULT 'paused',
        visibility TEXT DEFAULT 'public',
        created_at INTEGER NOT NULL
      );

      CREATE TABLE podcast_episodes (
        id TEXT PRIMARY KEY,
        show_id TEXT NOT NULL,
        title TEXT NOT NULL,
        audio_url TEXT NOT NULL,
        local_file_path TEXT,
        duration INTEGER,
        download_status TEXT DEFAULT 'pending',
        download_progress INTEGER DEFAULT 0,
        download_speed TEXT,
        download_eta TEXT,
        retry_count INTEGER DEFAULT 0,
        last_error TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (show_id) REFERENCES podcast_shows(id) ON DELETE CASCADE
      );
  ```
  Then, after the existing `insertMusicPlay` function and before `insertSetting`, add:
  ```ts
  export function insertPodcastShow(db: Database.Database, opts: {
    id: string;
    feedUrl?: string;
    title?: string;
    syncStatus?: string;
    visibility?: string;
  }) {
    db.prepare(`
      INSERT INTO podcast_shows (id, feed_url, title, sync_status, visibility, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      opts.id,
      opts.feedUrl ?? `https://example.com/feeds/${opts.id}.xml`,
      opts.title ?? `Show ${opts.id}`,
      opts.syncStatus ?? 'paused',
      opts.visibility ?? 'public',
      Date.now()
    );
  }

  export function insertPodcastEpisode(db: Database.Database, opts: {
    id: string;
    showId: string;
    title?: string;
    audioUrl?: string;
    downloadStatus?: string;
    localFilePath?: string | null;
    createdAt?: number;
  }) {
    db.prepare(`
      INSERT INTO podcast_episodes (id, show_id, title, audio_url, download_status, local_file_path, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      opts.id,
      opts.showId,
      opts.title ?? `Episode ${opts.id}`,
      opts.audioUrl ?? `https://example.com/audio/${opts.id}.mp3`,
      opts.downloadStatus ?? 'completed',
      opts.localFilePath ?? null,
      opts.createdAt ?? Date.now()
    );
  }
  ```

- [ ] **Step 3: Add a podcast case to the existing `resetStaleDownloadsForTable` test suite (RED first)**

  In `tests/unit/concurrency.test.ts`, update the import block to add the two new helpers:
  ```ts
  import {
    createTestDb,
    insertChannel,
    insertVideo,
    insertMusicArtist,
    insertMusicTrack,
    insertPodcastShow,
    insertPodcastEpisode,
  } from '../helpers/testDb';
  ```
  Then, inside the existing `describe('resetStaleDownloadsForTable', ...)` block, immediately after the `'resets downloading music tracks to pending using the music_tracks table'` test, add:
  ```ts
    it('resets downloading podcast episodes to pending using the podcast_episodes table', () => {
      const db = createTestDb();
      insertPodcastShow(db, { id: 'sh1' });
      insertPodcastEpisode(db, { id: 'e1', showId: 'sh1', downloadStatus: 'downloading' });

      const log = vi.fn();
      resetStaleDownloadsForTable(db, 'podcast_episodes', 'téléchargements de podcasts interrompus', 'podcast downloads', log);

      const row = db.prepare('SELECT download_status FROM podcast_episodes WHERE id = ?').get('e1') as any;
      expect(row.download_status).toBe('pending');
      expect(log).toHaveBeenCalledWith('Réinitialisation de 1 téléchargements de podcasts interrompus.');
    });
  ```

  Run:
  ```bash
  npx vitest run tests/unit/concurrency.test.ts
  ```
  Expected: fails at this point only if Step 1/2 weren't applied first (TS error on the `'podcast_episodes'` literal, or missing table/helpers) — since Step 1 and Step 2 are already done above, this should actually pass immediately. Confirm it does.

- [ ] **Step 4: Add `resetStalePodcastDownloads`, `syncAllPodcastShows`, `initPodcastScheduler`**

  Append to `server/utils/podcastDownloader.ts`:
  ```ts
  /**
   * Resets any stale podcast downloads stuck in 'downloading' status back to
   * 'pending'. Mirrors resetStaleMusicDownloads/resetStaleDownloads.
   */
  export function resetStalePodcastDownloads() {
    resetStaleDownloadsForTable(getDb(), 'podcast_episodes', 'téléchargements de podcasts interrompus', 'podcast downloads', addLog);
  }

  /**
   * Re-fetches every followed podcast show's RSS feed to discover new
   * episodes, then starts the download queue for anything newly pending.
   * Mirrors syncAllMusicArtists/syncAllChannels.
   */
  export async function syncAllPodcastShows(): Promise<void> {
    const db = getDb();

    await runSyncAllEntities<{ id: string; title: string; feed_url: string }>({
      db,
      activeFlagSettingKey: 'podcast_sync_all_active',
      pausedSettingKey: 'podcast_downloader_paused',
      fetchEntities: () => db.prepare('SELECT id, title, feed_url FROM podcast_shows').all() as { id: string; title: string; feed_url: string }[],
      processEntity: async (show) => {
        addLog(`Resynchronisation du podcast : ${show.title} (${show.id})`);
        db.prepare("UPDATE podcast_shows SET sync_status = 'downloading' WHERE id = ?").run(show.id);

        try {
          const result = await ingestPodcastFeed(show.feed_url);
          if (!result.success) {
            addLog(`Échec de la resynchronisation du podcast ${show.title} (${show.id}) : ${result.message}`);
          }
        } catch (err: any) {
          addLog(`Erreur lors de la resynchronisation du podcast ${show.title} (${show.id}) : ${err.message || err}`);
        }
      },
      onStart: (count) => addLog(`Démarrage de la resynchronisation automatique de ${count} podcast(s)...`),
      onPaused: () => addLog('Resynchronisation automatique des podcasts interrompue : téléchargements en pause.'),
      onComplete: () => addLog('Resynchronisation automatique des podcasts terminée.'),
      onFatalError: (err) => console.error('Fatal error during syncAllPodcastShows:', err),
      // No afterLoop — podcasts have no metadata-refresh post-loop hook equivalent.
      startWorker: startPodcastQueueWorker,
    });
  }

  /**
   * Registers (or re-registers, on settings change) the podcast resync cron
   * job. Mirrors initMusicScheduler/initScheduler, using a separate settings
   * namespace and active-job handle so it never interacts with the video or
   * music cron.
   */
  export function initPodcastScheduler(): void {
    const db = getDb();

    const enabledSetting = db.prepare("SELECT value FROM settings WHERE key = 'podcast_sync_cron_enabled'").get() as { value: string } | undefined;
    const scheduleSetting = db.prepare("SELECT value FROM settings WHERE key = 'podcast_sync_cron_schedule'").get() as { value: string } | undefined;

    const enabled = enabledSetting ? enabledSetting.value === '1' : false;
    const cronExpression = scheduleSetting?.value || '0 4 * * *';

    if (getActivePodcastCronJob()) {
      getActivePodcastCronJob()!.stop();
      setActivePodcastCronJob(null);
    }

    if (enabled) {
      console.log(`Scheduling podcast auto-sync cron job with expression: "${cronExpression}"`);
      try {
        const job = new Cron(cronExpression, async () => {
          console.log('Automated podcast cron trigger: starting show synchronization...');
          const syncSetting = db.prepare("SELECT value FROM settings WHERE key = 'podcast_sync_all_active'").get() as { value: string } | undefined;
          if (syncSetting?.value === '1') {
            console.log('Automated podcast cron: sync all is already active. Skipping.');
            return;
          }
          await syncAllPodcastShows();
        });
        setActivePodcastCronJob(job);
      } catch (err) {
        console.error(`Failed to register podcast cron expression "${cronExpression}":`, err);
      }
    } else {
      console.log('Automated podcast sync cron job is disabled.');
    }
  }
  ```

- [ ] **Step 5: Full suite and commit**

  Run:
  ```bash
  npm test
  ```

  Commit:
  ```bash
  git add server/utils/concurrency.ts server/utils/podcastDownloader.ts tests/helpers/testDb.ts tests/unit/concurrency.test.ts
  git commit -m "$(cat <<'EOF'
  feat: add podcast stale-download reset, auto-resync, and cron scheduler

  Widens resetStaleDownloadsForTable's table union to include
  podcast_episodes (already-generic helper, built in an earlier sub-project
  specifically for this reuse) and adds the matching test-helper coverage.
  syncAllPodcastShows/initPodcastScheduler are thin call-throughs to the same
  shared orchestrator the video/music pipelines already use.

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 7: Admin API routes

**Files:**
- Create: `server/api/admin/podcasts/ingest.post.ts`
- Create: `server/api/admin/podcasts/concurrency.get.ts`
- Create: `server/api/admin/podcasts/concurrency.post.ts`
- Create: `server/api/admin/podcasts/pause.post.ts`
- Create: `server/api/admin/podcasts/resume.post.ts`
- Create: `server/api/admin/podcasts/queue.get.ts`
- Create: `server/api/admin/podcasts/retry-failed.post.ts`
- Create: `server/api/admin/podcasts/schedule.get.ts`
- Create: `server/api/admin/podcasts/schedule.post.ts`
- Create: `server/api/admin/podcasts/shows/[id]/pause.post.ts`
- Create: `server/api/admin/podcasts/shows/[id]/sync.post.ts`

**Interfaces:**
- Consumes: `ingestPodcastFeed`, `cancelPodcastDownload`, `startPodcastQueueWorker`, `initPodcastScheduler` (`../../../utils/podcastDownloader` or `../../../../../utils/podcastDownloader` for the nested `shows/[id]/` routes), `parseMaxConcurrentDownloads`/`isValidMaxConcurrentValue` (`../../../utils/concurrency`), `requireAdmin` (`../../../utils/auth`, ambient auto-import — imported explicitly only where the music precedent does), `getDb` (ambient auto-import, never imported explicitly, matching every music route file).
- Produces: 11 HTTP endpoints under `/api/admin/podcasts/...`, response shapes matching their music counterparts one-for-one.

- [ ] **Step 1: `ingest.post.ts`**

  Create `server/api/admin/podcasts/ingest.post.ts` (mirrors `server/api/admin/music/ingest.post.ts`; field is named `feedUrl` rather than `url` since this endpoint only ever accepts an RSS feed URL, never a channel/video URL):
  ```ts
  import { defineEventHandler, readBody, createError } from 'h3';
  import { ingestPodcastFeed } from '../../../utils/podcastDownloader';

  export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    const body = await readBody(event);
    const { feedUrl, sync_status, visibility } = body;

    if (!feedUrl) {
      throw createError({ statusCode: 400, statusMessage: 'feedUrl is required.' });
    }

    const VALID_VISIBILITIES = ['public', 'private', 'ultra_private'];
    if (visibility !== undefined && !VALID_VISIBILITIES.includes(visibility)) {
      throw createError({ statusCode: 400, statusMessage: `Invalid visibility value: ${visibility}` });
    }

    try {
      const result = await ingestPodcastFeed(feedUrl, {
        sync_status: sync_status !== undefined ? sync_status : undefined,
        visibility: visibility !== undefined ? visibility : undefined,
      });

      if (!result.success) {
        throw createError({ statusCode: 500, statusMessage: result.message });
      }

      return result;
    } catch (err: any) {
      console.error('[admin/podcasts/ingest]', err);
      throw createError({ statusCode: 500, statusMessage: 'An error occurred during podcast ingestion. Check the server logs for details.' });
    }
  });
  ```

- [ ] **Step 2: `concurrency.get.ts` and `concurrency.post.ts`**

  Create `server/api/admin/podcasts/concurrency.get.ts` (mirrors `server/api/admin/music/concurrency.get.ts`):
  ```ts
  import { defineEventHandler } from 'h3';
  import { parseMaxConcurrentDownloads } from '../../../utils/concurrency';

  export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    const db = getDb();

    const row = db.prepare("SELECT value FROM settings WHERE key = 'podcast_max_concurrent_downloads'").get() as { value: string } | undefined;

    return { maxConcurrentDownloads: parseMaxConcurrentDownloads(row?.value) };
  });
  ```

  Create `server/api/admin/podcasts/concurrency.post.ts` (mirrors `server/api/admin/music/concurrency.post.ts`):
  ```ts
  import { defineEventHandler, readBody, createError } from 'h3';
  import { isValidMaxConcurrentValue } from '../../../utils/concurrency';

  export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    const body = await readBody(event);
    const value = body?.maxConcurrentDownloads;

    if (!isValidMaxConcurrentValue(value)) {
      throw createError({ statusCode: 400, statusMessage: 'maxConcurrentDownloads must be an integer >= 1.' });
    }

    const db = getDb();
    db.prepare(`UPDATE settings SET value = ? WHERE key = 'podcast_max_concurrent_downloads'`).run(String(value));

    return { success: true };
  });
  ```

- [ ] **Step 3: `pause.post.ts` and `resume.post.ts`**

  Create `server/api/admin/podcasts/pause.post.ts` (mirrors `server/api/admin/music/pause.post.ts`, substituting `cancelPodcastDownload` for `cancelMusicDownload`):
  ```ts
  import { defineEventHandler } from 'h3';
  import { cancelPodcastDownload } from '../../../utils/podcastDownloader';

  export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    const db = getDb();

    db.prepare(`
      UPDATE settings
      SET value = '1'
      WHERE key = 'podcast_downloader_paused'
    `).run();

    const activeDownloads = db.prepare(`
      SELECT id FROM podcast_episodes
      WHERE download_status = 'downloading'
    `).all() as { id: string }[];

    for (const e of activeDownloads) {
      cancelPodcastDownload(e.id, 'pending', true);
    }

    return { success: true };
  });
  ```

  Create `server/api/admin/podcasts/resume.post.ts` (mirrors `server/api/admin/music/resume.post.ts`):
  ```ts
  import { defineEventHandler } from 'h3';
  import { startPodcastQueueWorker } from '../../../utils/podcastDownloader';

  export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    const db = getDb();

    db.prepare(`
      UPDATE settings
      SET value = '0'
      WHERE key = 'podcast_downloader_paused'
    `).run();

    startPodcastQueueWorker();

    return { success: true };
  });
  ```

- [ ] **Step 4: `queue.get.ts`**

  Create `server/api/admin/podcasts/queue.get.ts` (mirrors `server/api/admin/music/queue.get.ts`, `music_tracks`/`music_artists` → `podcast_episodes`/`podcast_shows`, `artist_name`/`artist.name` → `show_title`/`shows`):
  ```ts
  import { defineEventHandler } from 'h3';

  export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    const db = getDb();

    const queue = db.prepare(`
      SELECT
        e.id,
        e.title,
        e.download_status,
        e.download_progress,
        e.download_speed,
        e.download_eta,
        e.last_error,
        s.title as show_title
      FROM podcast_episodes e
      JOIN podcast_shows s ON e.show_id = s.id
      WHERE e.download_status IN ('downloading', 'pending', 'failed')
      ORDER BY
        CASE e.download_status
          WHEN 'downloading' THEN 1
          ELSE 2
        END,
        CASE WHEN e.download_progress > 0 THEN 0 ELSE 1 END,
        e.created_at ASC
      LIMIT 100
    `).all();

    const history = db.prepare(`
      SELECT
        e.id,
        e.title,
        e.created_at,
        s.title as show_title
      FROM podcast_episodes e
      JOIN podcast_shows s ON e.show_id = s.id
      WHERE e.download_status = 'completed'
      ORDER BY e.created_at DESC
      LIMIT 10
    `).all();

    const shows = db.prepare(`
      SELECT
        s.id,
        s.title,
        s.cover_url,
        s.sync_status,
        s.visibility,
        COUNT(e.id) as episode_count
      FROM podcast_shows s
      LEFT JOIN podcast_episodes e ON e.show_id = s.id
      GROUP BY s.id
      ORDER BY s.title ASC
    `).all();

    const pausedSetting = db.prepare("SELECT value FROM settings WHERE key = 'podcast_downloader_paused'").get() as { value: string } | undefined;
    const isPaused = pausedSetting ? pausedSetting.value === '1' : false;

    const failedRow = db.prepare(`SELECT COUNT(*) as count FROM podcast_episodes WHERE download_status = 'failed'`).get() as { count: number };
    const failedCount = failedRow?.count || 0;

    return { queue, history, shows, isPaused, failedCount };
  });
  ```

- [ ] **Step 5: `retry-failed.post.ts`**

  Create `server/api/admin/podcasts/retry-failed.post.ts` (mirrors `server/api/admin/music/retry-failed.post.ts`; note the music precedent calls `startMusicQueueWorker()` with no import line — it relies on the same server-utils auto-import as `getDb()`, so this file matches that exactly):
  ```ts
  import { defineEventHandler, readBody } from 'h3';

  export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    const db = getDb();
    const body = await readBody(event);

    if (body?.episodeId) {
      db.prepare(`
        UPDATE podcast_episodes
        SET download_status = 'pending', download_progress = 0, download_speed = NULL, download_eta = NULL, last_error = NULL, retry_count = 0
        WHERE id = ? AND download_status = 'failed'
      `).run(body.episodeId);
    } else {
      db.prepare(`
        UPDATE podcast_episodes
        SET download_status = 'pending', download_progress = 0, download_speed = NULL, download_eta = NULL, last_error = NULL, retry_count = 0
        WHERE download_status = 'failed'
      `).run();
    }

    startPodcastQueueWorker();

    return { success: true };
  });
  ```

- [ ] **Step 6: `schedule.get.ts` and `schedule.post.ts`**

  Create `server/api/admin/podcasts/schedule.get.ts` (mirrors `server/api/admin/music/schedule.get.ts`):
  ```ts
  import { defineEventHandler } from 'h3';
  import { requireAdmin } from '../../../utils/auth';

  export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    const db = getDb();

    const enabledSetting = db.prepare("SELECT value FROM settings WHERE key = 'podcast_sync_cron_enabled'").get() as { value: string } | undefined;
    const scheduleSetting = db.prepare("SELECT value FROM settings WHERE key = 'podcast_sync_cron_schedule'").get() as { value: string } | undefined;

    return {
      enabled: enabledSetting ? enabledSetting.value === '1' : false,
      schedule: scheduleSetting?.value || '0 4 * * *'
    };
  });
  ```

  Create `server/api/admin/podcasts/schedule.post.ts` (mirrors `server/api/admin/music/schedule.post.ts`):
  ```ts
  import { defineEventHandler, readBody, createError } from 'h3';
  import { Cron } from 'croner';
  import { requireAdmin } from '../../../utils/auth';
  import { initPodcastScheduler } from '../../../utils/podcastDownloader';

  export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    const body = await readBody(event);
    const { enabled, schedule } = body;

    if (enabled && !schedule) {
      throw createError({ statusCode: 400, statusMessage: 'Cron schedule expression is required when enabled.' });
    }

    if (enabled) {
      try {
        new Cron(schedule);
      } catch (err) {
        throw createError({ statusCode: 400, statusMessage: `Expression cron invalide : ${err}` });
      }
    }

    const db = getDb();
    db.prepare("INSERT INTO settings (key, value) VALUES ('podcast_sync_cron_enabled', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(enabled ? '1' : '0');
    db.prepare("INSERT INTO settings (key, value) VALUES ('podcast_sync_cron_schedule', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(schedule || '0 4 * * *');

    initPodcastScheduler();

    return { success: true };
  });
  ```

- [ ] **Step 7: `shows/[id]/pause.post.ts` and `shows/[id]/sync.post.ts`**

  Create `server/api/admin/podcasts/shows/[id]/pause.post.ts` (mirrors `server/api/admin/music/artists/[id]/pause.post.ts`, `music_artists` → `podcast_shows`):
  ```ts
  import { defineEventHandler, createError } from 'h3';

  export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    const showId = event.context.params?.id;

    if (!showId) {
      throw createError({ statusCode: 400, statusMessage: 'Show ID is required.' });
    }

    const db = getDb();
    const res = db.prepare(`
      UPDATE podcast_shows
      SET sync_status = 'paused'
      WHERE id = ?
    `).run(showId);

    if (res.changes === 0) {
      throw createError({ statusCode: 404, statusMessage: 'Show not found.' });
    }

    return { success: true };
  });
  ```

  Create `server/api/admin/podcasts/shows/[id]/sync.post.ts` (mirrors `server/api/admin/music/artists/[id]/sync.post.ts`, `music_artists.channel_id` → `podcast_shows.feed_url`; the nullable-`channel_id` guard in the music precedent doesn't apply here — `podcast_shows.feed_url` is `NOT NULL` in the schema, so every show always has one, and that branch is dropped):
  ```ts
  import { defineEventHandler, createError } from 'h3';
  import { ingestPodcastFeed, startPodcastQueueWorker } from '../../../../../utils/podcastDownloader';

  export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    const showId = event.context.params?.id;

    if (!showId) {
      throw createError({ statusCode: 400, statusMessage: 'Show ID is required.' });
    }

    const db = getDb();
    const show = db.prepare('SELECT feed_url FROM podcast_shows WHERE id = ?').get(showId) as { feed_url: string } | undefined;

    if (!show) {
      throw createError({ statusCode: 404, statusMessage: 'Show not found.' });
    }

    const res = db.prepare(`
      UPDATE podcast_shows
      SET sync_status = 'downloading'
      WHERE id = ?
    `).run(showId);

    if (res.changes === 0) {
      throw createError({ statusCode: 404, statusMessage: 'Show not found.' });
    }

    setTimeout(async () => {
      try {
        console.log(`Starting background podcast ingestion for show ${showId} triggered by manual sync start`);
        await ingestPodcastFeed(show.feed_url);
      } catch (err) {
        console.error(`Failed background podcast ingestion for show ${showId}:`, err);
      }
    }, 100);

    startPodcastQueueWorker();

    return { success: true };
  });
  ```

- [ ] **Step 8: Full suite and commit**

  Run:
  ```bash
  npm test
  ```
  (No new automated tests in this task — these are thin HTTP handlers with no pure logic of their own to unit test, matching how the music admin routes have no dedicated test file either. `npm test` confirms nothing else broke; Task 8's manual verification exercises these routes end-to-end.)

  Commit:
  ```bash
  git add server/api/admin/podcasts
  git commit -m "$(cat <<'EOF'
  feat: add podcast admin API routes

  Mirrors server/api/admin/music/'s route set file-for-file: feed ingestion,
  concurrency setting, global pause/resume, queue status, retry-failed, cron
  schedule config, and per-show pause/sync.

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 8: Scheduler wiring + manual verification

**Files:**
- Modify: `server/plugins/scheduler.ts`

**Interfaces:**
- Consumes: `resetStalePodcastDownloads`, `startPodcastQueueWorker`, `initPodcastScheduler` (all from Tasks 5-6).
- Produces: nothing new — this is pure wiring plus a manual verification pass. This task depends on every earlier task (`podcastDownloader.ts` must exist and export all three functions) and nothing depends on it, so it is correctly last.

- [ ] **Step 1: Wire `initPodcastScheduler()` into the scheduler plugin**

  Open `server/plugins/scheduler.ts`. Replace its full contents:
  ```ts
  import { defineNitroPlugin } from 'nitropack/dist/runtime/plugin';
  import { initScheduler, resetStaleDownloads, startQueueWorker, updateYtdl } from '../utils/downloader';
  import { resetStaleMusicDownloads, startMusicQueueWorker, initMusicScheduler } from '../utils/musicDownloader';
  import { resetStalePodcastDownloads, startPodcastQueueWorker, initPodcastScheduler } from '../utils/podcastDownloader';

  export default defineNitroPlugin((nitroApp) => {
    console.log('YouKeep Scheduler Plugin: Initializing background cron jobs...');
    initScheduler();
    initMusicScheduler();
    initPodcastScheduler();

    // Clean up interrupted downloads and start processing immediately on startup
    console.log('YouKeep Scheduler Plugin: Cleaning up stale downloads...');
    try {
      resetStaleDownloads();
      resetStaleMusicDownloads();
      resetStalePodcastDownloads();

      // Check and update yt-dlp asynchronously, then start all queue workers.
      // Podcasts don't need yt-dlp at all, but starting their queue worker
      // alongside the other two in both branches of this chain keeps startup
      // ordering simple and matches where video/music already start.
      updateYtdl()
        .then(() => {
          console.log('YouKeep Scheduler Plugin: yt-dlp check/update completed. Starting queue worker...');
          startQueueWorker();
          startMusicQueueWorker();
          startPodcastQueueWorker();
        })
        .catch((err) => {
          console.error('YouKeep Scheduler Plugin: yt-dlp auto-update check failed, starting queue anyway:', err);
          startQueueWorker();
          startMusicQueueWorker();
          startPodcastQueueWorker();
        });
    } catch (err) {
      console.error('Failed to run startup tasks:', err);
    }
  });
  ```

- [ ] **Step 2: Automated safety net**

  Run:
  ```bash
  npm test
  ```
  Expect the full suite (existing tests + Task 3's `podcastDownloader.test.ts` + Task 6's new `concurrency.test.ts` case) to pass.

- [ ] **Step 3: Manual verification — start the dev server**

  Run:
  ```bash
  npm run dev
  ```
  Note the port it binds to (e.g. `http://localhost:3000`).

- [ ] **Step 4: Manual verification — authenticate via the dev-login fixture**

  In a separate terminal (per `docs/superpowers/plans/2026-08-08-dev-login-fixture.md`, already shipped in this codebase):
  ```bash
  ALLOW_DEV_LOGIN=1 npm run dev
  ```
  (restart the dev server from Step 3 with this env var set, if it wasn't already), then:
  ```bash
  curl -i -c /tmp/youkeep-podcast-cookies.txt -X POST http://localhost:3000/api/dev/login
  ```
  Confirm a `200` response with a `Set-Cookie: youkeep_session=...` header.

- [ ] **Step 5: Manual verification — ingest a real public podcast feed**

  Pick any real, currently-live public podcast RSS feed URL (e.g. search for one, or use a known-stable one like `https://feeds.npr.org/510289/podcast.xml`). Run:
  ```bash
  curl -b /tmp/youkeep-podcast-cookies.txt -X POST http://localhost:3000/api/admin/podcasts/ingest.post \
    -H 'Content-Type: application/json' \
    -d '{"feedUrl": "<the feed URL you picked>", "sync_status": "downloading"}'
  ```
  Confirm a `200` response with `{"success":true,"message":"Podcast \"...\" ingested. N new episode(s) added.","count":N}` where `N > 0`.

- [ ] **Step 6: Manual verification — confirm show + episode metadata**

  ```bash
  curl -b /tmp/youkeep-podcast-cookies.txt http://localhost:3000/api/admin/podcasts/queue.get
  ```
  Confirm the response's `shows` array contains the ingested show with a non-empty `title`, and `queue` contains episodes with real `title` values (not `Episode <hash>` placeholders) and `download_status` values of `pending` or `downloading`.

- [ ] **Step 7: Manual verification — confirm an episode downloads with live progress**

  Poll the same `queue.get` endpoint every few seconds:
  ```bash
  watch -n 2 "curl -s -b /tmp/youkeep-podcast-cookies.txt http://localhost:3000/api/admin/podcasts/queue.get"
  ```
  Confirm: an episode transitions from `pending` → `downloading` with `download_progress` climbing from 0 toward 100 and a non-null `download_speed`/`download_eta`, then to `completed`. Then check the filesystem:
  ```bash
  ls -la data/downloads-podcasts/*/  # or /downloads/podcasts/*/ if that path was writable
  ```
  Confirm a downloaded audio file exists named `<episodeId>.<ext>` for the completed episode.

- [ ] **Step 8: Manual verification — pause/resume/retry-failed parity with music**

  ```bash
  curl -b /tmp/youkeep-podcast-cookies.txt -X POST http://localhost:3000/api/admin/podcasts/pause.post
  curl -b /tmp/youkeep-podcast-cookies.txt http://localhost:3000/api/admin/podcasts/queue.get   # confirm isPaused: true, no episode progresses further
  curl -b /tmp/youkeep-podcast-cookies.txt -X POST http://localhost:3000/api/admin/podcasts/resume.post
  curl -b /tmp/youkeep-podcast-cookies.txt http://localhost:3000/api/admin/podcasts/queue.get   # confirm isPaused: false, downloads resume
  ```
  If any episode reached `failed` status during testing (e.g. from a deliberately-bad feed URL tried earlier), confirm retry works:
  ```bash
  curl -b /tmp/youkeep-podcast-cookies.txt -X POST http://localhost:3000/api/admin/podcasts/retry-failed.post
  ```

- [ ] **Step 9: Restart without the dev-login gate and stop the dev server**

  Stop the `npm run dev` process (Ctrl-C). Per the dev-login fixture's own design, restarting `npm run dev` without `ALLOW_DEV_LOGIN` set makes `/api/dev/login` return `404` again — no cleanup needed on this pipeline's part.

- [ ] **Step 10: Commit**

  ```bash
  git add server/plugins/scheduler.ts
  git commit -m "$(cat <<'EOF'
  feat: wire initPodcastScheduler into the startup scheduler plugin

  Completes the podcast RSS ingestion pipeline: initPodcastScheduler(),
  resetStalePodcastDownloads(), and startPodcastQueueWorker() now run at
  startup alongside the existing video/music equivalents. Manually verified
  end-to-end against a real public podcast feed: ingestion populates show +
  episode metadata, an episode downloads with live progress visible via
  queue.get, and pause/resume/retry-failed behave identically to music.

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )"
  ```
