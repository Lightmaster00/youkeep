# Finished-Live VOD Badge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a "REPLAY" badge on videos that were originally YouTube livestreams and are now finished VODs, for any video downloaded after this feature ships.

**Architecture:** A new `videos.was_live` column is populated once, at download-completion time, from yt-dlp's `live_status` field already present in the info.json file the pipeline writes and reads for every download. Two Vue components read that column to render a small "REPLAY" badge — one on library grid cards, one on the video detail page.

**Tech Stack:** Nuxt 4, Nitro (H3), better-sqlite3, Vue 3 Composition API, yt-dlp (spawned as a child process).

## Global Constraints

- No backfill for already-downloaded videos — they keep `was_live = 0` (the column default) forever unless manually re-downloaded. No migration script, no re-parsing of old info.json files, no new yt-dlp calls for existing videos.
- No handling of `is_live` or `is_upcoming` states — YouKeep only processes completed downloads, so these states are unreachable in this pipeline. Only `live_status === 'was_live'` sets the flag.
- Display only — no filtering, sorting, or search by `was_live`.
- No changes to download/ingestion decision logic — a livestream VOD downloads exactly as before; this only labels it afterward.
- `server/utils/downloader.ts` has zero automated test coverage for its yt-dlp-spawning download-execution logic (confirmed across every prior sub-project touching this file) — the backend task in this plan is verified manually, not with automated tests.
- This codebase has no Vue component test infrastructure (out of scope for this initiative) — the two frontend tasks are verified manually in the running dev server, not with new test files.

---

### Task 1: `was_live` column + population in the download pipeline

**Files:**
- Modify: `server/utils/db.ts:278` (add migration line)
- Modify: `tests/helpers/testDb.ts:51` (keep test schema in sync)
- Modify: `server/utils/downloader.ts:850-939` (info.json parse + UPDATE statement)

**Interfaces:**
- Produces: `videos.was_live INTEGER DEFAULT 0` column, readable by any endpoint that already does `SELECT * FROM videos` or explicitly selects columns including `was_live`. Task 2 and Task 3 read this column via API responses that already forward full video rows to the frontend (verify this holds for the endpoints those pages use — see their Step 1).

- [ ] **Step 1: Add the migration**

In `server/utils/db.ts`, the migration block runs a list of `try { db.exec(...) } catch (e) {}` statements. The current end of the `videos`-related ones reads (lines 276-278):

```ts
  try { db.exec(`ALTER TABLE videos ADD COLUMN is_short INTEGER DEFAULT 0;`); } catch (e) {}
  try { db.exec(`ALTER TABLE videos ADD COLUMN like_count INTEGER DEFAULT 0;`); } catch (e) {}
  try { db.exec(`ALTER TABLE videos ADD COLUMN last_error TEXT;`); } catch (e) {}
```

Add a new line immediately after the `last_error` line:

```ts
  try { db.exec(`ALTER TABLE videos ADD COLUMN is_short INTEGER DEFAULT 0;`); } catch (e) {}
  try { db.exec(`ALTER TABLE videos ADD COLUMN like_count INTEGER DEFAULT 0;`); } catch (e) {}
  try { db.exec(`ALTER TABLE videos ADD COLUMN last_error TEXT;`); } catch (e) {}
  try { db.exec(`ALTER TABLE videos ADD COLUMN was_live INTEGER DEFAULT 0;`); } catch (e) {}
```

- [ ] **Step 2: Keep the test DB schema in sync**

`tests/helpers/testDb.ts` hand-writes its own `CREATE TABLE videos (...)` (it does not run the production migrations). Current schema (lines 40-56):

```ts
    CREATE TABLE videos (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      channel_id TEXT NOT NULL,
      visibility TEXT DEFAULT 'public',
      share_token TEXT,
      download_status TEXT DEFAULT 'completed',
      upload_date TEXT,
      duration INTEGER,
      view_count INTEGER DEFAULT 0,
      is_short INTEGER DEFAULT 0,
      local_video_path TEXT,
      local_thumbnail_path TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE
    );
```

Add `was_live` next to `is_short`:

```ts
    CREATE TABLE videos (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      channel_id TEXT NOT NULL,
      visibility TEXT DEFAULT 'public',
      share_token TEXT,
      download_status TEXT DEFAULT 'completed',
      upload_date TEXT,
      duration INTEGER,
      view_count INTEGER DEFAULT 0,
      is_short INTEGER DEFAULT 0,
      was_live INTEGER DEFAULT 0,
      local_video_path TEXT,
      local_thumbnail_path TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE
    );
```

- [ ] **Step 3: Run the existing test suite to confirm the schema change doesn't break anything**

Run: `npm test -- --run`
Expected: all existing tests still pass (this is an additive column with a default, no existing test asserts an exact column list). Note the exact pass count and exit code.

- [ ] **Step 4: Extract `live_status` in the info.json parse block**

In `server/utils/downloader.ts`, the info.json parse block inside `downloadVideoFile()` currently reads (lines 852-863):

```ts
        let desc = null;
        let views = null;
        let uploadDate = null;
        let likeCount = null;
        
        if (fs.existsSync(infoJsonFile)) {
          try {
            const infoData = JSON.parse(fs.readFileSync(infoJsonFile, 'utf8'));
            desc = infoData.description || null;
            views = infoData.view_count || null;
            uploadDate = infoData.upload_date || null;
            likeCount = infoData.like_count || null;
```

Change it to also capture `was_live`:

```ts
        let desc = null;
        let views = null;
        let uploadDate = null;
        let likeCount = null;
        let wasLive = 0;
        
        if (fs.existsSync(infoJsonFile)) {
          try {
            const infoData = JSON.parse(fs.readFileSync(infoJsonFile, 'utf8'));
            desc = infoData.description || null;
            views = infoData.view_count || null;
            uploadDate = infoData.upload_date || null;
            likeCount = infoData.like_count || null;
            wasLive = infoData.live_status === 'was_live' ? 1 : 0;
```

`wasLive` is declared with a `let ... = 0` default (not `null`, unlike the other fields) because the column itself defaults to `0` and there is no meaningful "unknown" state to preserve on conflict — a video whose info.json fails to parse, or is missing, should be treated as "not detected as a former livestream", which is exactly `0`.

- [ ] **Step 5: Persist `was_live` in the post-download UPDATE**

The UPDATE statement that persists the info.json-derived fields after a successful download currently reads (lines 920-939):

```ts
        db.prepare(`
          UPDATE videos 
          SET local_video_path = ?, 
              local_thumbnail_path = ?,
              description = COALESCE(?, description),
              view_count = COALESCE(?, view_count),
              upload_date = COALESCE(?, upload_date),
              like_count = COALESCE(?, like_count),
              size_bytes = ?
          WHERE id = ?
        `).run(
          videoUrlPath,
          thumbnailUrlPath,
          desc,
          views,
          uploadDate,
          likeCount,
          fileSize,
          videoId
        );
```

Add `was_live = ?` and pass `wasLive` in the matching position. Unlike the `COALESCE(?, ...)` fields, `was_live` is set unconditionally to `wasLive` (which is always `0` or `1`, never `null`) — there's no "preserve existing value" case to guard, since this UPDATE only runs once per successful download and `wasLive` is always a definite value:

```ts
        db.prepare(`
          UPDATE videos 
          SET local_video_path = ?, 
              local_thumbnail_path = ?,
              description = COALESCE(?, description),
              view_count = COALESCE(?, view_count),
              upload_date = COALESCE(?, upload_date),
              like_count = COALESCE(?, like_count),
              size_bytes = ?,
              was_live = ?
          WHERE id = ?
        `).run(
          videoUrlPath,
          thumbnailUrlPath,
          desc,
          views,
          uploadDate,
          likeCount,
          fileSize,
          wasLive,
          videoId
        );
```

- [ ] **Step 6: Run the test suite again**

Run: `npm test -- --run`
Expected: same pass count as Step 3, exit code 0. Note the exact output.

- [ ] **Step 7: Manual verification (real yt-dlp, real network)**

This step has no automated test — `downloadVideoFile()`'s download-execution path has zero coverage across this entire codebase, consistent with every prior sub-project touching this file.

Using the running dev server (`npm run dev`) and the admin UI (or `curl` against `/api/admin/downloader/ingest` with an admin session cookie):

1. Find a real, known-finished YouTube livestream VOD URL (a video page that shows "Streamed live on <date>" under the title on youtube.com — any such video works, it doesn't need to be from a channel already in YouKeep).
2. Queue it for download (paste into the Add Channel field, or ingest as a single video).
3. Once `download_status = 'completed'`, check the DB: `sqlite3 data/youkeep.db "SELECT id, title, was_live FROM videos WHERE id = '<videoId>';"` — expect `was_live = 1`.
4. Queue and download a regular (never-live) video from the same or another channel. Confirm `was_live = 0` for it.
5. Pick any video that was already in the library before this task's changes (downloaded before this session). Confirm `was_live = 0` (the column default) and that nothing errors when the app reads that row.

Report the exact video IDs used and the exact `was_live` values observed. If yt-dlp or network access is unavailable in the environment at execution time, report that honestly rather than fabricating results — check `data/bin/yt-dlp` exists and try a `--dump-single-json` call first to confirm availability before starting.

- [ ] **Step 8: Commit**

```bash
git add server/utils/db.ts tests/helpers/testDb.ts server/utils/downloader.ts
git commit -m "feat: capture was_live flag from yt-dlp info.json on download completion"
```

---

### Task 2: "REPLAY" badge on library grid cards (`VideoCard.vue`)

**Files:**
- Modify: `app/components/VideoCard.vue`

**Interfaces:**
- Consumes: `videos.was_live` column from Task 1, forwarded to the frontend as a `was_live` field on whatever video objects the pages using `VideoCard` fetch (these pages already `SELECT *`-style forward full video rows from existing endpoints — no endpoint changes are needed or in scope; this task only adds a prop field and template/CSS).

- [ ] **Step 1: Add `was_live` to the component's video prop type**

`VideoCard.vue`'s video prop is a local inline TypeScript type (not a shared interface), currently (lines 70-81):

```ts
const props = withDefaults(defineProps<{
  video: {
    id: string;
    title: string;
    duration: number | null;
    channel_title?: string;
    channel_avatar?: string;
    view_count: number | null;
    upload_date: string | null;
    local_thumbnail_path?: string;
    local_video_path?: string;
  };
  showChannelInfo?: boolean;
  clickable?: boolean;
  to?: string;
}>(), {
  showChannelInfo: true,
  clickable: true
});
```

Add `was_live?: number;`:

```ts
const props = withDefaults(defineProps<{
  video: {
    id: string;
    title: string;
    duration: number | null;
    channel_title?: string;
    channel_avatar?: string;
    view_count: number | null;
    upload_date: string | null;
    local_thumbnail_path?: string;
    local_video_path?: string;
    was_live?: number;
  };
  showChannelInfo?: boolean;
  clickable?: boolean;
  to?: string;
}>(), {
  showChannelInfo: true,
  clickable: true
});
```

It's optional (`?:`) so existing callers that don't pass `was_live` (e.g. any test fixture or page not yet forwarding the column) don't break — `video.was_live === 1` in the template simply evaluates to `false` when the field is `undefined`.

- [ ] **Step 2: Add the badge to the template**

The thumbnail wrapper currently reads (lines 10-35):

```html
    <div class="thumbnail-wrapper">
      <img
        :src="video.local_thumbnail_path || `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`"
        @error="handleThumbnailError"
        class="thumbnail-img"
        alt="Thumbnail"
        loading="lazy"
        referrerpolicy="no-referrer"
      />
      <video
        v-if="isPreviewActive"
        ref="previewVideoEl"
        :src="video.local_video_path"
        class="thumbnail-preview-video"
        muted
        playsinline
        @timeupdate="handlePreviewTimeUpdate"
      ></video>
      <span v-if="isPreviewActive" class="preview-badge">APERÇU</span>
      <div v-if="isPreviewActive" class="preview-progress">
        <div class="preview-progress-fill" :style="{ width: previewProgressPercent + '%' }"></div>
      </div>
      <span class="duration-badge">{{ formattedDuration }}</span>
      <VideoDropdownMenu :video="video" @hidden="$emit('hidden', video.id)" />
      <slot name="thumbnail-overlay" />
    </div>
```

Add a `replay-badge` span right before the `duration-badge` span:

```html
    <div class="thumbnail-wrapper">
      <img
        :src="video.local_thumbnail_path || `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`"
        @error="handleThumbnailError"
        class="thumbnail-img"
        alt="Thumbnail"
        loading="lazy"
        referrerpolicy="no-referrer"
      />
      <video
        v-if="isPreviewActive"
        ref="previewVideoEl"
        :src="video.local_video_path"
        class="thumbnail-preview-video"
        muted
        playsinline
        @timeupdate="handlePreviewTimeUpdate"
      ></video>
      <span v-if="isPreviewActive" class="preview-badge">APERÇU</span>
      <div v-if="isPreviewActive" class="preview-progress">
        <div class="preview-progress-fill" :style="{ width: previewProgressPercent + '%' }"></div>
      </div>
      <span v-if="video.was_live === 1" class="replay-badge">REPLAY</span>
      <span class="duration-badge">{{ formattedDuration }}</span>
      <VideoDropdownMenu :video="video" @hidden="$emit('hidden', video.id)" />
      <slot name="thumbnail-overlay" />
    </div>
```

- [ ] **Step 3: Add the badge's CSS**

The existing `.duration-badge` rule reads (lines 308-320):

```css
.duration-badge {
  position: absolute;
  bottom: 8px;
  right: 8px;
  background: rgba(0, 0, 0, 0.85);
  color: white;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.03em;
  z-index: 2;
}
```

Add a matching `.replay-badge` rule right after it — same shape/sizing/font, positioned bottom-left instead of bottom-right (the opposite corner from duration, and clear of `.preview-badge` which occupies top-left only conditionally during hover preview):

```css
.duration-badge {
  position: absolute;
  bottom: 8px;
  right: 8px;
  background: rgba(0, 0, 0, 0.85);
  color: white;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.03em;
  z-index: 2;
}

.replay-badge {
  position: absolute;
  bottom: 8px;
  left: 8px;
  background: rgba(0, 0, 0, 0.85);
  color: white;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.03em;
  z-index: 2;
}
```

- [ ] **Step 4: Manual verification in the dev server**

No automated test infrastructure exists for Vue components in this codebase (confirmed, out of scope for this initiative). Verify visually instead:

1. Start the dev server: `npm run dev`.
2. Using the DB rows created in Task 1's manual verification (one video with `was_live = 1`, one with `was_live = 0`), navigate to a grid view that renders `VideoCard` for those videos (e.g. the channel page for the channel those test videos belong to, or the home page).
3. Confirm the `was_live = 1` video's card shows a "REPLAY" badge in the bottom-left corner of its thumbnail, and the `was_live = 0` video's card does not.
4. Confirm the existing `duration-badge` (bottom-right) is still visible and unaffected on both cards.
5. Hover over the `was_live = 1` card long enough to trigger the preview (`isPreviewActive`) and confirm the "APERÇU" badge (top-left) and the new "REPLAY" badge (bottom-left) don't visually collide.

Report what you observed, with a screenshot if your environment supports capturing one.

- [ ] **Step 5: Commit**

```bash
git add app/components/VideoCard.vue
git commit -m "feat: show REPLAY badge on finished-livestream video cards"
```

---

### Task 3: "REPLAY" pill on the video detail page (`watch/[id].vue`)

**Files:**
- Modify: `app/pages/watch/[id].vue`

**Interfaces:**
- Consumes: the same `was_live` field as Task 2, here read from `video.value.was_live` where `video` is a `computed(() => videoResponse.value?.video || null)` sourced from an untyped (`video: any`) `useFetch` response (line 418-421) — no TypeScript interface changes are needed on this page, since the video object is already loosely typed as `any`.

- [ ] **Step 1: Confirm the video title markup and CSS**

The relevant markup currently reads (lines 52-54):

```html
        <!-- Video Header Info -->
        <h1 class="video-title">{{ video.title }}</h1>
        

```

(Two blank lines follow before the `<!-- Channel Row -->` comment — leave the surrounding `<!-- Channel Row -->` block and everything after it untouched.)

The current CSS for `.video-title` reads (lines 858-863):

```css
.video-title {
  font-size: 20px;
  font-weight: 700;
  margin-top: 20px;
  line-height: 1.4;
}
```

- [ ] **Step 2: Wrap the title in a flex row with the badge**

Replace the markup from Step 1 with:

```html
        <!-- Video Header Info -->
        <div class="title-row">
          <h1 class="video-title">{{ video.title }}</h1>
          <span v-if="video.was_live === 1" class="replay-pill">REPLAY</span>
        </div>
        

```

- [ ] **Step 3: Move the title's top spacing onto the new row, add the pill's CSS**

Replace the `.video-title` CSS block from Step 1 with:

```css
.title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 20px;
}

.video-title {
  font-size: 20px;
  font-weight: 700;
  line-height: 1.4;
}

.replay-pill {
  background: rgba(0, 0, 0, 0.85);
  color: white;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.03em;
  white-space: nowrap;
}
```

`margin-top: 20px` moves from `.video-title` to `.title-row` so the same visual spacing above the title block is preserved now that the `<h1>` is a flex item inside a wrapping container, instead of the block-level element that previously carried the margin directly.

- [ ] **Step 4: Manual verification in the dev server**

1. With the dev server running, navigate to `/watch/<videoId>` for the `was_live = 1` video from Task 1's manual verification.
2. Confirm a "REPLAY" pill appears immediately to the right of the video title, vertically centered with it.
3. Navigate to `/watch/<videoId>` for the `was_live = 0` video. Confirm no pill appears and the title's spacing/position looks the same as before this change (compare against a video from before this task if possible, e.g. by temporarily checking out `main` in a second terminal — not required, a visual sanity check of spacing is enough).
4. Resize the browser to a narrow width and confirm the title and pill wrap sensibly (the pill drops to its own line via `flex-wrap: wrap` rather than overflowing or being clipped) for a long video title.

Report what you observed, with a screenshot if your environment supports capturing one.

- [ ] **Step 5: Commit**

```bash
git add app/pages/watch/[id].vue
git commit -m "feat: show REPLAY pill on finished-livestream video detail page"
```
