# Chapters & Sponsor Segment Handling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Parse YouTube chapters (and, where enabled, SponsorBlock-marked segments) from each new download's info JSON into a `video_chapters` table; let an admin configure per-category SponsorBlock behavior (ignore/mark/remove) globally; render chapter markers on the video player's scrubber, visually distinguishing native chapters from marked sponsor segments.

**Architecture:** A new pure-logic module (`server/utils/chapters.ts`) holds the two testable transformations (info-JSON → chapter rows, settings → yt-dlp CLI args) so they're unit-tested without touching the download pipeline's I/O. The download pipeline (`server/utils/downloader.ts`) wires that module in at its two existing touchpoints — the info-JSON read (already there for description/views/comments) and the `yt-dlp` argument list. A settings get/set endpoint pair exposes the per-category configuration, consumed by a new panel in `settings.vue`. The video-detail endpoint and player pick up whatever chapters exist and render them — no chapters means no markers, not an error.

**Tech Stack:** Nuxt 4 / Vue 3 `<script setup lang="ts">`, Nitro (h3) server routes, better-sqlite3, Vitest.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-21-chapters-sponsorblock-design.md` — read it before starting any task.
- **New downloads only.** Nothing in this plan touches already-downloaded videos; they simply have zero `video_chapters` rows and the player shows no markers for them.
- The SponsorBlock category settings are a single global configuration (stored in the existing `settings` key-value table), not per-channel or per-user.
- All six categories default to `ignore` — a fresh instance, or one where the admin has changed nothing, downloads exactly as it does today (no `--sponsorblock-*` flags sent at all).
- `--sponsorblock-mark` and `--sponsorblock-remove` both require `ffmpeg` (they're postprocessors) — gate them behind the existing `ffmpegAvailable` check, the same way `--convert-thumbnails`/`--merge-output-format` already are.
- `npm test` must pass after every task (35 passed as of this plan's authoring; each task states its expected new count).

---

### Task 1: Chapter parsing, SponsorBlock args, and the data model

**Files:**
- Create: `server/utils/chapters.ts`
- Test: `tests/unit/chapters.test.ts`
- Modify: `server/utils/db.ts` (add `video_chapters` table, seed 6 settings rows)
- Modify: `server/utils/downloader.ts`

**Interfaces:**
- Produces: `SPONSORBLOCK_CATEGORIES: readonly ['sponsor', 'intro', 'outro', 'selfpromo', 'interaction', 'filler']`, `type SponsorBlockAction = 'ignore' | 'mark' | 'remove'`, `interface ParsedChapter { start_time: number; title: string; source: 'youtube' | 'sponsorblock' }`, `parseChaptersFromInfoData(infoData: any): ParsedChapter[]`, `buildSponsorBlockArgs(settings: Record<string, string>): string[]` — Task 2 imports `SPONSORBLOCK_CATEGORIES` and `SponsorBlockAction`.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/chapters.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseChaptersFromInfoData, buildSponsorBlockArgs, SPONSORBLOCK_CATEGORIES } from '../../server/utils/chapters';

describe('parseChaptersFromInfoData', () => {
  it('returns an empty array when infoData has no chapters', () => {
    expect(parseChaptersFromInfoData({})).toEqual([]);
    expect(parseChaptersFromInfoData(null)).toEqual([]);
    expect(parseChaptersFromInfoData({ chapters: null })).toEqual([]);
  });

  it('parses a native YouTube chapter as source: youtube', () => {
    const result = parseChaptersFromInfoData({
      chapters: [{ start_time: 0, end_time: 30, title: 'Introduction' }]
    });
    expect(result).toEqual([{ start_time: 0, title: 'Introduction', source: 'youtube' }]);
  });

  it('parses a SponsorBlock-marked chapter as source: sponsorblock', () => {
    const result = parseChaptersFromInfoData({
      chapters: [{ start_time: 45.5, end_time: 90, title: '[SponsorBlock]: Sponsor' }]
    });
    expect(result).toEqual([{ start_time: 45.5, title: '[SponsorBlock]: Sponsor', source: 'sponsorblock' }]);
  });

  it('parses a mix of native and SponsorBlock chapters in order', () => {
    const result = parseChaptersFromInfoData({
      chapters: [
        { start_time: 0, title: 'Intro' },
        { start_time: 30, title: '[SponsorBlock]: Intro' },
        { start_time: 60, title: 'Main Content' },
      ]
    });
    expect(result.map(c => c.source)).toEqual(['youtube', 'sponsorblock', 'youtube']);
  });

  it('defaults a missing title to an empty string and missing start_time to 0', () => {
    const result = parseChaptersFromInfoData({ chapters: [{}] });
    expect(result).toEqual([{ start_time: 0, title: '', source: 'youtube' }]);
  });
});

describe('buildSponsorBlockArgs', () => {
  it('returns an empty array when every category is ignore', () => {
    expect(buildSponsorBlockArgs({})).toEqual([]);
    const allIgnore = Object.fromEntries(SPONSORBLOCK_CATEGORIES.map(c => [c, 'ignore']));
    expect(buildSponsorBlockArgs(allIgnore)).toEqual([]);
  });

  it('builds --sponsorblock-mark for categories set to mark', () => {
    const result = buildSponsorBlockArgs({ sponsor: 'mark', intro: 'mark', outro: 'ignore' });
    expect(result).toEqual(['--sponsorblock-mark', 'sponsor,intro']);
  });

  it('builds --sponsorblock-remove for categories set to remove', () => {
    const result = buildSponsorBlockArgs({ filler: 'remove', interaction: 'remove' });
    expect(result).toEqual(['--sponsorblock-remove', 'filler,interaction']);
  });

  it('builds both flags when categories are split between mark and remove', () => {
    const result = buildSponsorBlockArgs({ sponsor: 'remove', selfpromo: 'mark' });
    expect(result).toEqual(['--sponsorblock-mark', 'selfpromo', '--sponsorblock-remove', 'sponsor']);
  });

  it('preserves SPONSORBLOCK_CATEGORIES iteration order within each flag', () => {
    // intro appears before outro in SPONSORBLOCK_CATEGORIES; the joined list must match that order
    // even when the settings object's own key order is reversed.
    const result = buildSponsorBlockArgs({ outro: 'mark', intro: 'mark' });
    expect(result).toEqual(['--sponsorblock-mark', 'intro,outro']);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/chapters.test.ts`
Expected: FAIL — `Cannot find module '../../server/utils/chapters'`.

- [ ] **Step 3: Implement the pure logic module**

Create `server/utils/chapters.ts`:

```ts
export const SPONSORBLOCK_CATEGORIES = ['sponsor', 'intro', 'outro', 'selfpromo', 'interaction', 'filler'] as const;
export type SponsorBlockCategory = typeof SPONSORBLOCK_CATEGORIES[number];
export type SponsorBlockAction = 'ignore' | 'mark' | 'remove';

export interface ParsedChapter {
  start_time: number;
  title: string;
  source: 'youtube' | 'sponsorblock';
}

const SPONSORBLOCK_TITLE_PREFIX = '[SponsorBlock]:';

export function parseChaptersFromInfoData(infoData: any): ParsedChapter[] {
  if (!infoData || !Array.isArray(infoData.chapters)) {
    return [];
  }
  return infoData.chapters.map((chapter: any): ParsedChapter => {
    const title = typeof chapter.title === 'string' ? chapter.title : '';
    return {
      start_time: typeof chapter.start_time === 'number' ? chapter.start_time : 0,
      title,
      source: title.startsWith(SPONSORBLOCK_TITLE_PREFIX) ? 'sponsorblock' : 'youtube',
    };
  });
}

export function buildSponsorBlockArgs(settings: Record<string, string>): string[] {
  const markCategories: string[] = [];
  const removeCategories: string[] = [];

  for (const category of SPONSORBLOCK_CATEGORIES) {
    const action = settings[category] || 'ignore';
    if (action === 'mark') {
      markCategories.push(category);
    } else if (action === 'remove') {
      removeCategories.push(category);
    }
  }

  const args: string[] = [];
  if (markCategories.length > 0) {
    args.push('--sponsorblock-mark', markCategories.join(','));
  }
  if (removeCategories.length > 0) {
    args.push('--sponsorblock-remove', removeCategories.join(','));
  }
  return args;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/chapters.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Add the `video_chapters` table and seed the six settings rows**

In `server/utils/db.ts`, add the new table alongside the other `CREATE TABLE IF NOT EXISTS` statements (near `comments`, which it closely resembles):

```sql
    CREATE TABLE IF NOT EXISTS video_chapters (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      start_time REAL NOT NULL,
      title TEXT NOT NULL,
      source TEXT NOT NULL CHECK(source IN ('youtube', 'sponsorblock')),
      FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE
    );
```

Then, near the existing settings-seeding block (`db.ts:275-280`, the `downloader_paused` seed), add seeding for the six SponsorBlock category settings, following the exact same idempotent check-then-insert pattern:

```ts
  const sponsorBlockCategorySeeds = ['sponsor', 'intro', 'outro', 'selfpromo', 'interaction', 'filler'];
  for (const category of sponsorBlockCategorySeeds) {
    const key = `sponsorblock_${category}`;
    const check = db.prepare('SELECT COUNT(*) as count FROM settings WHERE key = ?').get(key) as { count: number };
    if (check.count === 0) {
      db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(key, 'ignore');
      console.log(`Seeded setting ${key}: ignore`);
    }
  }
```

- [ ] **Step 6: Wire chapter parsing into the existing info-JSON read**

In `server/utils/downloader.ts`, add the import at the top of the file (alongside the existing imports):

```ts
import { parseChaptersFromInfoData, buildSponsorBlockArgs, SPONSORBLOCK_CATEGORIES } from './chapters';
```

In the existing info-JSON parsing block (`downloader.ts:811-853`, inside `if (fs.existsSync(infoJsonFile)) { try { ... } }`), after the existing comment-ingestion block (right after the `transaction(infoData.comments);` line, still before the `// Remove the info JSON to save disk space` comment and its `fs.unlinkSync(infoJsonFile);` call), add:

```ts
            // Ingest chapters (native YouTube chapters + any SponsorBlock-marked segments)
            const parsedChapters = parseChaptersFromInfoData(infoData);
            db.prepare('DELETE FROM video_chapters WHERE video_id = ?').run(videoId);
            if (parsedChapters.length > 0) {
              const insertChapter = db.prepare(`
                INSERT INTO video_chapters (id, video_id, start_time, title, source)
                VALUES (?, ?, ?, ?, ?)
              `);
              const chapterTransaction = db.transaction((chaptersToInsert: typeof parsedChapters) => {
                for (const chapter of chaptersToInsert) {
                  insertChapter.run(crypto.randomUUID(), videoId, chapter.start_time, chapter.title, chapter.source);
                }
              });
              chapterTransaction(parsedChapters);
            }
```

(`crypto` is already imported in this file — `downloader.ts:5`, `import crypto from 'crypto';` — used the same way for comment IDs a few lines above.)

- [ ] **Step 7: Wire SponsorBlock args into the `yt-dlp` invocation**

In `server/utils/downloader.ts`'s `downloadVideoFile` function, immediately after `const ffmpegAvailable = isFfmpegAvailable();` (`downloader.ts:608`), add:

```ts
    const sponsorBlockSettingRows = db.prepare(
      `SELECT key, value FROM settings WHERE key LIKE 'sponsorblock_%'`
    ).all() as { key: string; value: string }[];
    const sponsorBlockSettings: Record<string, string> = {};
    for (const row of sponsorBlockSettingRows) {
      sponsorBlockSettings[row.key.replace('sponsorblock_', '')] = row.value;
    }
    const sponsorBlockArgs = buildSponsorBlockArgs(sponsorBlockSettings);
```

Then, inside the existing `if (ffmpegAvailable) { ... }` block (`downloader.ts:642-645`, which currently pushes `--convert-thumbnails`/`--merge-output-format`), add the SponsorBlock args too:

```ts
    if (ffmpegAvailable) {
      args.push('--convert-thumbnails', 'jpg');
      args.push('--merge-output-format', 'mp4');
      args.push(...sponsorBlockArgs);
    }
```

This means SponsorBlock marking/removal is silently skipped (not attempted) when `ffmpeg` isn't available — consistent with this file's existing pattern of degrading gracefully without `ffmpeg`, and avoiding a failed postprocessor call.

- [ ] **Step 8: Verify the `yt-dlp` argument shape empirically**

The exact title format `yt-dlp` uses for SponsorBlock-marked chapters (`[SponsorBlock]: Sponsor` etc., assumed in Step 3's `SPONSORBLOCK_TITLE_PREFIX`) has not been confirmed against a real download in this project. If you have the ability to run a real download in this environment (network access, a real YouTube video ID from a channel with known SponsorBlock coverage, `ffmpeg` installed): set `sponsorblock_sponsor` to `mark` directly in the database (`UPDATE settings SET value = 'mark' WHERE key = 'sponsorblock_sponsor';`), trigger a real download of a video known to have sponsor segments logged in SponsorBlock, and inspect the resulting `video_chapters` rows — confirm at least one row has `source = 'sponsorblock'`. If the title format differs from `[SponsorBlock]:`, update `SPONSORBLOCK_TITLE_PREFIX` in `server/utils/chapters.ts` to match what `yt-dlp` actually produces, and add a test case to `tests/unit/chapters.test.ts` using the real observed format. If you cannot run a real download in this environment (no network access, no real video to test against), say so explicitly in your report — this is a known, called-out gap in the spec, not a task failure, but it must be verified before this feature is considered fully done rather than "probably done."

- [ ] **Step 9: Run the full test suite**

Run: `npm test`
Expected: 46 passed (46) — the existing 35 plus the 11 new tests in `chapters.test.ts`.

- [ ] **Step 10: Commit**

```bash
git add server/utils/chapters.ts tests/unit/chapters.test.ts server/utils/db.ts server/utils/downloader.ts
git commit -m "feat: parse video chapters and apply SponsorBlock settings at download time"
```

---

### Task 2: SponsorBlock settings API and admin UI

**Files:**
- Create: `server/api/admin/downloader/sponsorblock.get.ts`
- Create: `server/api/admin/downloader/sponsorblock.post.ts`
- Modify: `app/pages/settings.vue`

**Interfaces:**
- Consumes: `SPONSORBLOCK_CATEGORIES`, `SponsorBlockAction` from `server/utils/chapters.ts` (Task 1).
- Produces: `GET /api/admin/downloader/sponsorblock` → `{ settings: Record<string, string> }` (one entry per category, each `'ignore' | 'mark' | 'remove'`); `POST /api/admin/downloader/sponsorblock` accepts a body of the same shape (any subset of the six keys) and persists it.

- [ ] **Step 1: Create the GET endpoint**

Create `server/api/admin/downloader/sponsorblock.get.ts`:

```ts
import { defineEventHandler } from 'h3';
import { SPONSORBLOCK_CATEGORIES } from '../../../utils/chapters';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const db = getDb();

  const rows = db.prepare(`SELECT key, value FROM settings WHERE key LIKE 'sponsorblock_%'`).all() as { key: string; value: string }[];

  const settings: Record<string, string> = {};
  for (const category of SPONSORBLOCK_CATEGORIES) {
    settings[category] = 'ignore';
  }
  for (const row of rows) {
    settings[row.key.replace('sponsorblock_', '')] = row.value;
  }

  return { settings };
});
```

- [ ] **Step 2: Create the POST endpoint**

Create `server/api/admin/downloader/sponsorblock.post.ts`:

```ts
import { defineEventHandler, readBody, createError } from 'h3';
import { SPONSORBLOCK_CATEGORIES, type SponsorBlockAction } from '../../../utils/chapters';

const VALID_ACTIONS: SponsorBlockAction[] = ['ignore', 'mark', 'remove'];

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const body = await readBody(event);
  const db = getDb();

  for (const category of SPONSORBLOCK_CATEGORIES) {
    const action = body?.[category];
    if (action === undefined) continue;
    if (!VALID_ACTIONS.includes(action)) {
      throw createError({ statusCode: 400, statusMessage: `Valeur invalide pour la catégorie "${category}": ${action}` });
    }
    db.prepare(`UPDATE settings SET value = ? WHERE key = ?`).run(action, `sponsorblock_${category}`);
  }

  return { success: true };
});
```

- [ ] **Step 3: Add the settings UI panel**

In `app/pages/settings.vue`, find the "Archiving Policy & Scheduling" panel — a `<div class="ingest-box glass-panel mt-4">` inside `.downloads-main-col`, identifiable by its `<h3>Archiving Policy & Scheduling</h3>`. Immediately after that panel's closing `</div>` (and still inside `.downloads-main-col`, before the sibling `.downloads-side-col` starts), add a new panel:

```html
              <div class="ingest-box glass-panel mt-4">
                <div class="section-title-row">
                  <div class="icon-orb bg-orange">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                  </div>
                  <div>
                    <h3>Sponsor Segment Handling</h3>
                    <p class="section-desc">Applies to new downloads only, using the community SponsorBlock database. Each category can be ignored, marked as a chapter, or cut from the file.</p>
                  </div>
                </div>

                <form @submit.prevent="handleSaveSponsorBlock" class="policy-forms-grid mt-3">
                  <div class="form-group" v-for="cat in sponsorBlockCategoryList" :key="cat.key">
                    <label class="form-label" :for="`sb-${cat.key}`">{{ cat.label }}</label>
                    <select :id="`sb-${cat.key}`" v-model="sponsorBlockSettings[cat.key]" class="form-select">
                      <option value="ignore">Ignore</option>
                      <option value="mark">Mark as chapter</option>
                      <option value="remove">Remove from file</option>
                    </select>
                  </div>

                  <div class="form-actions mt-3">
                    <button type="submit" class="btn btn-secondary-dark" :disabled="savingSponsorBlock">
                      {{ savingSponsorBlock ? 'Saving...' : 'Save SponsorBlock Settings' }}
                    </button>
                  </div>
                </form>
                <div v-if="sponsorBlockMessage" class="form-msg mt-3" :class="sponsorBlockSuccess ? 'success-msg' : 'error-msg'">
                  {{ sponsorBlockMessage }}
                </div>
              </div>
```

If `.bg-orange` isn't an existing icon-orb color class in this file's CSS (check the other `icon-orb bg-*` usages — `bg-purple`, `bg-pink`, `bg-blue` are used elsewhere), reuse `bg-blue` instead of inventing a new color class.

- [ ] **Step 4: Add the script logic**

In `app/pages/settings.vue`'s `<script setup>`, add (near the other downloader-settings state, e.g. alongside `defaultDownloadsDir`):

```ts
const sponsorBlockCategoryList = [
  { key: 'sponsor', label: 'Sponsor' },
  { key: 'intro', label: 'Intro' },
  { key: 'outro', label: 'Outro' },
  { key: 'selfpromo', label: 'Self-Promo' },
  { key: 'interaction', label: 'Like/Subscribe Reminders' },
  { key: 'filler', label: 'Filler / Tangents' },
];
const sponsorBlockSettings = ref<Record<string, string>>({
  sponsor: 'ignore', intro: 'ignore', outro: 'ignore', selfpromo: 'ignore', interaction: 'ignore', filler: 'ignore'
});
const savingSponsorBlock = ref(false);
const sponsorBlockMessage = ref('');
const sponsorBlockSuccess = ref(false);

const fetchSponsorBlockSettings = async () => {
  try {
    const data = await $fetch<any>('/api/admin/downloader/sponsorblock');
    sponsorBlockSettings.value = data.settings;
  } catch (e) {
    console.error('Failed to fetch SponsorBlock settings:', e);
  }
};

const handleSaveSponsorBlock = async () => {
  savingSponsorBlock.value = true;
  sponsorBlockMessage.value = '';
  try {
    await $fetch('/api/admin/downloader/sponsorblock', {
      method: 'POST',
      body: sponsorBlockSettings.value
    });
    sponsorBlockSuccess.value = true;
    sponsorBlockMessage.value = 'SponsorBlock settings saved.';
  } catch (e: any) {
    sponsorBlockSuccess.value = false;
    sponsorBlockMessage.value = e?.data?.statusMessage || 'Failed to save settings.';
  } finally {
    savingSponsorBlock.value = false;
  }
};
```

Find where `fetchDefaultDir()` is called on mount (`settings.vue:1535`) and add `fetchSponsorBlockSettings();` alongside it.

- [ ] **Step 5: Verify in the browser**

Run `npm run dev`, log in as admin, go to Settings → Downloads. Confirm the new "Sponsor Segment Handling" panel renders with 6 dropdowns, each defaulting to "Ignore". Change one to "Mark as chapter", save, reload the page, confirm it persisted. Change it back to "Ignore" before finishing (so the instance's downloads remain unaffected unless a real decision is made later).

- [ ] **Step 6: Run the test suite**

Run: `npm test`
Expected: 46 passed (46) — this task adds no new tests (no logic beyond thin endpoint/UI wiring around Task 1's already-tested functions), so this is a regression check.

- [ ] **Step 7: Commit**

```bash
git add server/api/admin/downloader/sponsorblock.get.ts server/api/admin/downloader/sponsorblock.post.ts app/pages/settings.vue
git commit -m "feat: add admin settings panel for per-category SponsorBlock behavior"
```

---

### Task 3: Chapter markers in the video player

**Files:**
- Modify: `server/api/videos/[id].get.ts`
- Modify: `app/pages/watch/[id].vue`
- Modify: `app/components/VideoPlayer.vue`

**Interfaces:**
- Consumes: `video_chapters` table (Task 1).
- Produces: `GET /api/videos/:id`'s response gains a `chapters: { start_time: number; title: string; source: 'youtube' | 'sponsorblock' }[]` field, ordered by `start_time` ascending. `VideoPlayer.vue` gains a `chapters?: any[]` prop.

- [ ] **Step 1: Return chapters from the video-detail endpoint**

In `server/api/videos/[id].get.ts`, after the existing comments query (`:64-68`), add:

```ts
  const chapters = db.prepare(`
    SELECT start_time, title, source FROM video_chapters
    WHERE video_id = ?
    ORDER BY start_time ASC
  `).all(videoId);
```

Change the final `return` statement (`:116`) from `return { video, comments, subtitles };` to `return { video, comments, subtitles, chapters };`.

- [ ] **Step 2: Pass chapters through `watch/[id].vue` to the player**

In `app/pages/watch/[id].vue`, find the `useFetch` call that types the video-detail response (`:417`, `useFetch<{ video: any; comments?: any[]; categories?: any[]; subtitles?: any[] }>`) and add `chapters?: any[];` to that type.

Add, alongside the existing `const subtitles = computed(...)` (`:422`):

```ts
const chapters = computed(() => videoResponse.value?.chapters || []);
```

In the `<VideoPlayer>` usage (`:22-33`), add `:chapters="chapters"` alongside the existing `:subtitles="subtitles"` prop.

- [ ] **Step 3: Accept the prop and compute marker positions in `VideoPlayer.vue`**

In `app/components/VideoPlayer.vue`, change the Vue import (`:205`, `import { ref, onMounted, onUnmounted, watch, nextTick } from 'vue';`) to also import `computed`:

```ts
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue';
```

Add `chapters?: { start_time: number; title: string; source: 'youtube' | 'sponsorblock' }[];` to the `defineProps` type (`:207-213`, alongside `subtitles`).

Add, near the other computed/reactive player state (after `videoDuration`/`playedPercent` are declared, wherever that is in the script):

```ts
const chapterMarkers = computed(() => {
  if (!videoDuration.value) return [];
  return (props.chapters || []).map((chapter) => ({
    start_time: chapter.start_time,
    title: chapter.title,
    source: chapter.source,
    percent: (chapter.start_time / videoDuration.value) * 100,
  }));
});

const hoveredChapterTitle = computed(() => {
  if (progressHoverPercent.value < 0 || !videoDuration.value) return null;
  const hoveredTime = (progressHoverPercent.value / 100) * videoDuration.value;
  const chaptersBeforeHover = (props.chapters || [])
    .filter((chapter) => chapter.start_time <= hoveredTime)
    .sort((a, b) => b.start_time - a.start_time);
  return chaptersBeforeHover.length > 0 ? chaptersBeforeHover[0].title : null;
});
```

(`videoDuration` — declared as `const videoDuration = ref(0);` at `:238` — and `progressHoverPercent` — declared as `const progressHoverPercent = ref(-1);` at `:244` — are existing refs already used by the current tooltip logic at `:73`; the code above uses their real names.)

- [ ] **Step 4: Add chapter markers and the chapter title to the template**

In `app/components/VideoPlayer.vue`, inside `.progress-bar-container` (`:57-75`), add the markers after `.progress-scrubber` (`:66`) and before the existing tooltip `<div>` (`:68-74`):

```html
        <div
          v-for="chapter in chapterMarkers"
          :key="chapter.start_time"
          class="progress-chapter-marker"
          :class="{ 'progress-chapter-marker--sponsorblock': chapter.source === 'sponsorblock' }"
          :style="{ left: chapter.percent + '%' }"
          :title="chapter.title"
        ></div>
```

Update the existing tooltip content (`:73`, `{{ formatTime((progressHoverPercent / 100) * videoDuration) }}`) to also show the chapter title when one is active:

```html
        <div
          v-if="progressHoverPercent >= 0"
          class="progress-tooltip"
          :style="{ left: Math.min(Math.max(progressHoverPercent, 5), 95) + '%' }"
        >
          <span v-if="hoveredChapterTitle" class="progress-tooltip-chapter">{{ hoveredChapterTitle }}</span>
          {{ formatTime((progressHoverPercent / 100) * videoDuration) }}
        </div>
```

- [ ] **Step 5: Add the marker CSS**

Near the existing `.progress-bar-container`/`.progress-played`/`.progress-tooltip` rules (`:749` onward), add:

```css
.progress-chapter-marker {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: rgba(255, 255, 255, 0.5);
  pointer-events: none;
  z-index: 2;
}

.progress-chapter-marker--sponsorblock {
  background: rgba(239, 68, 68, 0.6);
}

.progress-tooltip-chapter {
  display: block;
  font-weight: 600;
  margin-bottom: 2px;
}
```

- [ ] **Step 6: Verify in the browser**

This needs a video with real `video_chapters` rows — either from Task 1's Step 8 real-download verification (if that produced any), or by inserting test rows directly for a video you can watch in this environment (`INSERT INTO video_chapters (id, video_id, start_time, title, source) VALUES (...)`, using a real `video_id` already in the archive, then delete the test rows afterward). Confirm: markers appear at the correct horizontal position along the scrubber relative to the video's duration; a `source: 'sponsorblock'` marker renders in the red/orange tint while a `source: 'youtube'` marker renders in the default tint; hovering near a marker's position shows its title above the time in the tooltip; a video with zero chapters renders the player exactly as before (no markers, no console errors).

- [ ] **Step 7: Run the test suite**

Run: `npm test`
Expected: 46 passed (46) — this task adds no new automated tests (no unit-testable logic beyond simple template/computed wiring already covered by Task 1's tests for the underlying data shape), so this is a regression check.

- [ ] **Step 8: Commit**

```bash
git add server/api/videos/[id].get.ts app/pages/watch/[id].vue app/components/VideoPlayer.vue
git commit -m "feat: render chapter markers on the video player scrubber"
```

## Final Check Across the Whole Plan

After all 3 tasks are complete and reviewed, before merging:
- Confirm Task 1's Step 8 (empirical SponsorBlock title-format verification) was actually attempted, and if it couldn't be run in this environment, flag that clearly as an open item for whoever next has real download access — this is the one piece of the plan resting on an assumption rather than a verified fact.
- Confirm a video with zero chapters (the common case for every video downloaded before this feature shipped) renders and plays with no console errors anywhere in the app — homepage cards, channel pages, and the watch page all still show these videos normally.
- Run `npm test` one final time (expected: 46 passed).
