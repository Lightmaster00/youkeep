# Admin Settings Reorganisation + Unified Downloads Hub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganise the admin Settings page by task (Overview, Library, Downloads, Users, System), give Videos, Music and Podcasts one identical Follow/Following flow, merge the three download queues into one Downloads view with one polling loop, and write every admin string in plain English (spec: `docs/superpowers/specs/2026-10-06-admin-settings-reorg-design.md`).

**Architecture:** Pure, unit-tested helpers in `app/utils/` (`settingsTabs.ts`, `librarySources.ts`, `allDownloads.ts`, `schedulePresets.ts`) drive new components under `app/components/settings/` (`LibrarySourceSection`, `LibraryTab`, `ChannelOptionsModal`, `DownloadTypeCard`, `DownloadQueueCard`, `DownloadQueueList`, `ScheduleForm`, `DownloadsAdvanced`, `DownloadsTab`, `OverviewActivityCard`). The new pieces are built beside the old tabs, `settings.vue` is switched over in steps (tab shell → Library → Downloads), and the old `SettingsDownloadsTab`/`SettingsMusicTab`/`SettingsPodcastsTab` are deleted only when nothing renders them. Server work is limited to an additive `queueTotal` on the music/podcast queue routes and two thin `sync-all` routes that call existing downloader functions.

**Tech Stack:** Nuxt 4, Nitro, better-sqlite3, Vue 3 (`<script setup>`), Vitest (`server` project for `tests/unit` + `tests/integration`, `component` project with the nuxt environment for `tests/component`).

## Global Constraints

- English only for all admin strings (vocabulary: Follow/Following, Library, Overview, Queued, Downloading, Failed, Sync, Sync now, Sync all, Paused/Active, Simultaneous downloads, Options for new follows, Advanced, Danger zone; empty state "Nothing is downloading").
- Tab keys overview/library/downloads/users/system with legacy `?tab=stats→overview`, `music→library (section music)`, `podcasts→library (section podcasts)`, unknown→overview.
- No change to downloader behaviour or to existing route contracts except additive `queueTotal` on the music/podcast queue routes.
- Visibility editable only for channels (artists/shows read-only).
- Follow = one click, results kept on a failed add and cleared on success.
- Queue view capped at 100 with the line "Showing the first 100 of N".
- One-way-bound controls must be resynced from state after a failed save.
- App code imports shared code via `#shared/…`, server code uses relative paths; `getDb`/`requireAdmin` are ambient Nitro auto-imports (never import them).
- Tests: createTestDb/mockEvent, component tests via mountSuspended with vi.stubGlobal('$fetch').
- Browser pane: resize_window preset desktop for real form interaction.
- Commit trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`; never work on main; never push.

Additional facts every task relies on (verified in the code on 2026-10-06):

- Branch `feature/admin-settings-reorg` is checked out. Run focused tests while iterating; before every commit run the full `npx vitest run` and `npx nuxt build 2>&1 | tail -5` (expect the build to end without errors).
- `app/pages/settings.vue` holds a large **global** (unscoped) `<style>` block from line 173 to 2180, every rule prefixed with `.settings-container`. All new components render inside `.settings-container`, so they can reuse its classes (`glass-panel`, `tab-pane`, `downloads-header-panel`, `header-text`, `ingest-form`, `search-input-wrapper`, `settings-search-input`, `search-results-list`, `search-results-grid`, `search-channel-card`, `channel-avatar-thumb`, `channel-search-info`, `channel-search-meta`, `channel-search-desc`, `results-header`, `section-desc`, `checkbox-container`, `checkmark`, `form-group`, `form-label`, `form-select`, `form-input`, `input-action-row`, `policy-form-block`, `policy-forms-grid`, `schedule-settings-row`, `form-actions`, `queue-box`, `queue-list-premium`, `queue-card-premium`, `queue-card-details`, `queue-card-meta-main`, `queue-card-title`, `queue-card-channel-name`, `status-badge`, `status-downloading|pending|failed`, `queue-progress-container`, `progress-bar-glow-bg`, `progress-bar-glow-fill`, `progress-percent-text`, `queue-diagnostics-row`, `diag-meta-spec`, `queue-error-box`, `queue-card-action-bar`, `btn-action-premium`, `btn-action-danger`, `queue-empty-state`, `badge-active-global`, `badge-paused-global`, `concurrency-control`, `btn-secondary-dark`, `btn-danger-outline`, `btn-clean`, `config-section`, `section-title-row`, `icon-orb`, `bg-pink`, `danger-zone-*`, `logs-*`, `log-*`, `terminal-dot`, `diagnostic-*`, `binary-path-box`, `path-label`, `path-code`, `test-result-box`, `ffmpeg-warning-box`, `warning-title`, `warning-desc`, `mt-2|3|4`, `pt-3`, `border-t`, `flex-1`, `flex-align-center`, `gap-10`, `tab-badge`, `tab-btn`). New layout-only styles go in each new component's `<style scoped>`. Do not delete CSS from `settings.vue` in this plan.
- Nuxt auto-registers `app/components/settings/X.vue` as `SettingsX`. To avoid name clashes during the step-by-step switch-over, **new components are always imported explicitly** (`import X from '~/components/settings/X.vue'`). `DownloadsTab.vue` is created in the same task that deletes `SettingsDownloadsTab.vue` (both would otherwise auto-register as `SettingsDownloadsTab`).
- `useToast()` (`app/composables/useToast.ts`) returns `{ toasts, success, error, info }`; `toasts` is module-global, so component tests reset it with `useToast().toasts.value = []` in `beforeEach`.
- `useState` keys are shared across tests in the component project; tests that read composable state reset those keys in `beforeEach`.
- Memory lessons that apply: never rely on HTML5 `required`/`pattern` (jsdom/happy-dom does not enforce them, real browsers block the submit) — validate in code; a one-way-bound checkbox/select (`:checked`/`:value` + `@change`) does not repaint when the server refuses, so reset `input.checked`/`select.value` by hand after re-reading server state; mutation-test every test that claims to prove a fix.
- Existing per-source routes: channels `POST /api/admin/channels/:id/pause` (sets `sync_status='paused'`), `POST …/sync` (sets `'downloading'` and re-ingests), `PUT …/visibility` (`public|private|ultra_private`), `PUT …/options` (`{ downloadVideos, downloadShorts, downloadLives, dateAfter: 'YYYY-MM-DD'|null, customSavePath }`); artists `POST /api/admin/music/artists/:id/pause|sync`; shows `POST /api/admin/podcasts/shows/:id/pause|sync`. There is no "resume" route: resuming a source = its `sync` route. The download workers only process sources whose `sync_status` is exactly `'downloading'`.
- There is no clear-queue route for music or podcasts, and no per-episode cancel for podcasts; this plan does not add any (Clear queue is shown for Videos only; podcast items offer Retry when failed, as today).

---

### Task 1: Server — `queueTotal` on music/podcast queues and Sync all routes for music/podcasts

**Files:**
- Modify: `server/api/admin/music/queue.get.ts` (lines 60-63: after `failedCount`, before `return`)
- Modify: `server/api/admin/podcasts/queue.get.ts` (lines 60-63, same place)
- Create: `server/api/admin/music/sync-all.post.ts`
- Create: `server/api/admin/podcasts/sync-all.post.ts`
- Test: `tests/integration/music-podcast-queue-total.test.ts` (new), `tests/integration/music-podcast-sync-all.test.ts` (new)

**Interfaces:**
- Consumes: `syncAllMusicArtists(): Promise<void>` from `server/utils/musicDownloader.ts` (line 834, guarded by settings key `music_sync_all_active`); `syncAllPodcastShows(): Promise<void>` from `server/utils/podcastDownloader.ts` (line 796, key `podcast_sync_all_active`).
- Produces: `GET /api/admin/music/queue` and `GET /api/admin/podcasts/queue` responses gain `queueTotal: number` (count of rows with `download_status IN ('downloading','pending','failed')`); all other fields unchanged. `POST /api/admin/music/sync-all` and `POST /api/admin/podcasts/sync-all` return `{ success: boolean, message: string }` (`success: false` when a sync of that type is already running).

- [ ] **Step 1: Write the failing queueTotal test**

Create `tests/integration/music-podcast-queue-total.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import musicQueue from '../../server/api/admin/music/queue.get';
import podcastQueue from '../../server/api/admin/podcasts/queue.get';
import { requireAdmin } from '../../server/utils/auth';
import {
  createTestDb, insertUser, insertSession, mockEvent, sessionCookie,
  insertMusicArtist, insertMusicTrack, insertPodcastShow, insertPodcastEpisode,
} from '../helpers/testDb';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
  (globalThis as any).requireAdmin = requireAdmin;
  insertUser(db, { id: 'admin', role: 'admin' });
  insertSession(db, { id: 'sess-admin', userId: 'admin' });
  insertMusicArtist(db, { id: 'a1' });
  insertPodcastShow(db, { id: 's1' });
});

const cookie = () => sessionCookie('sess-admin');

describe('GET /api/admin/music/queue queueTotal', () => {
  it('counts downloading, pending and failed tracks and keeps the list capped at 100', async () => {
    for (let i = 0; i < 120; i++) insertMusicTrack(db, { id: `p${i}`, artistId: 'a1', downloadStatus: 'pending', createdAt: 1000 + i });
    insertMusicTrack(db, { id: 'd1', artistId: 'a1', downloadStatus: 'downloading', createdAt: 999999 });
    insertMusicTrack(db, { id: 'f1', artistId: 'a1', downloadStatus: 'failed' });
    insertMusicTrack(db, { id: 'done', artistId: 'a1', downloadStatus: 'completed' });

    const res: any = await musicQueue(mockEvent(cookie(), { path: '/api/admin/music/queue' }));
    expect(res.queue).toHaveLength(100);
    expect(res.queue[0].id).toBe('d1');
    expect(res.queueTotal).toBe(122);
    expect(res.failedCount).toBe(1);
    expect(Array.isArray(res.artists)).toBe(true);
    expect(Array.isArray(res.history)).toBe(true);
    expect(res.isPaused).toBe(false);
  });

  it('is 0 on an empty queue', async () => {
    const res: any = await musicQueue(mockEvent(cookie(), { path: '/api/admin/music/queue' }));
    expect(res.queueTotal).toBe(0);
  });
});

describe('GET /api/admin/podcasts/queue queueTotal', () => {
  it('counts downloading, pending and failed episodes and keeps the list capped at 100', async () => {
    for (let i = 0; i < 110; i++) insertPodcastEpisode(db, { id: `p${i}`, showId: 's1', downloadStatus: 'pending', createdAt: 1000 + i });
    insertPodcastEpisode(db, { id: 'd1', showId: 's1', downloadStatus: 'downloading', createdAt: 999999 });
    insertPodcastEpisode(db, { id: 'f1', showId: 's1', downloadStatus: 'failed' });
    insertPodcastEpisode(db, { id: 'f2', showId: 's1', downloadStatus: 'failed' });
    insertPodcastEpisode(db, { id: 'done', showId: 's1', downloadStatus: 'completed' });

    const res: any = await podcastQueue(mockEvent(cookie(), { path: '/api/admin/podcasts/queue' }));
    expect(res.queue).toHaveLength(100);
    expect(res.queue[0].id).toBe('d1');
    expect(res.queueTotal).toBe(113);
    expect(res.failedCount).toBe(2);
    expect(Array.isArray(res.shows)).toBe(true);
  });

  it('is 0 on an empty queue', async () => {
    const res: any = await podcastQueue(mockEvent(cookie(), { path: '/api/admin/podcasts/queue' }));
    expect(res.queueTotal).toBe(0);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/integration/music-podcast-queue-total.test.ts`
Expected: FAIL — `expected undefined to be 122` (and `to be 113`, `to be 0`).

- [ ] **Step 3: Add `queueTotal` to both routes**

In `server/api/admin/music/queue.get.ts`, replace lines 60-63:

```ts
  const failedRow = db.prepare(`SELECT COUNT(*) as count FROM music_tracks WHERE download_status = 'failed'`).get() as { count: number };
  const failedCount = failedRow?.count || 0;

  return { queue, history, artists, isPaused, failedCount };
```

with:

```ts
  const failedRow = db.prepare(`SELECT COUNT(*) as count FROM music_tracks WHERE download_status = 'failed'`).get() as { count: number };
  const failedCount = failedRow?.count || 0;

  // Same semantics as /api/admin/downloader/queue: everything the queue view could show.
  const totalRow = db.prepare(`SELECT COUNT(*) as count FROM music_tracks WHERE download_status IN ('downloading', 'pending', 'failed')`).get() as { count: number };
  const queueTotal = totalRow?.count || 0;

  return { queue, queueTotal, history, artists, isPaused, failedCount };
```

In `server/api/admin/podcasts/queue.get.ts`, replace lines 60-63 the same way with table `podcast_episodes` and `return { queue, queueTotal, history, shows, isPaused, failedCount };`.

- [ ] **Step 4: Run it to pass**

Run: `npx vitest run tests/integration/music-podcast-queue-total.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Mutation-check**

Temporarily change `'failed')` to `'pending')` in the music `totalRow` query (drop `failed` from the list: `IN ('downloading', 'pending')`). Run the test file: expect the music test to fail with `expected 121 to be 122`. Revert.

- [ ] **Step 6: Write the failing sync-all test**

Create `tests/integration/music-podcast-sync-all.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../server/utils/musicDownloader', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../server/utils/musicDownloader')>()),
  syncAllMusicArtists: vi.fn(async () => {}),
}));
vi.mock('../../server/utils/podcastDownloader', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../server/utils/podcastDownloader')>()),
  syncAllPodcastShows: vi.fn(async () => {}),
}));

import Database from 'better-sqlite3';
import musicSyncAll from '../../server/api/admin/music/sync-all.post';
import podcastSyncAll from '../../server/api/admin/podcasts/sync-all.post';
import { syncAllMusicArtists } from '../../server/utils/musicDownloader';
import { syncAllPodcastShows } from '../../server/utils/podcastDownloader';
import { requireAdmin } from '../../server/utils/auth';
import { createTestDb, insertUser, insertSession, insertSetting, mockEvent, sessionCookie } from '../helpers/testDb';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
  (globalThis as any).requireAdmin = requireAdmin;
  vi.mocked(syncAllMusicArtists).mockClear();
  vi.mocked(syncAllPodcastShows).mockClear();
});

function loginAs(id: string, role: 'admin' | 'user') {
  insertUser(db, { id, role });
  insertSession(db, { id: `sess-${id}`, userId: id });
  return sessionCookie(`sess-${id}`);
}

const cases = [
  { name: 'music', handler: musicSyncAll, fn: () => vi.mocked(syncAllMusicArtists), flag: 'music_sync_all_active' },
  { name: 'podcasts', handler: podcastSyncAll, fn: () => vi.mocked(syncAllPodcastShows), flag: 'podcast_sync_all_active' },
];

describe.each(cases)('POST /api/admin/$name/sync-all', ({ handler, fn, flag }) => {
  it('rejects a guest with 401', async () => {
    await expect(handler(mockEvent(undefined, { method: 'POST' }))).rejects.toMatchObject({ statusCode: 401 });
  });

  it('rejects a non-admin with 403', async () => {
    await expect(handler(mockEvent(loginAs('u1', 'user'), { method: 'POST' }))).rejects.toMatchObject({ statusCode: 403 });
  });

  it('starts the sync once when none is running', async () => {
    const res: any = await handler(mockEvent(loginAs('admin', 'admin'), { method: 'POST' }));
    expect(res.success).toBe(true);
    expect(fn()).toHaveBeenCalledTimes(1);
  });

  it('refuses while a sync of that type is already running', async () => {
    insertSetting(db, { key: flag, value: '1' });
    const res: any = await handler(mockEvent(loginAs('admin', 'admin'), { method: 'POST' }));
    expect(res.success).toBe(false);
    expect(fn()).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 7: Run it to see it fail**

Run: `npx vitest run tests/integration/music-podcast-sync-all.test.ts`
Expected: FAIL — `Failed to resolve import "../../server/api/admin/music/sync-all.post"`.

- [ ] **Step 8: Create the two routes**

`server/api/admin/music/sync-all.post.ts`:

```ts
import { defineEventHandler } from 'h3';
import { syncAllMusicArtists } from '../../../utils/musicDownloader';

// Mirrors /api/admin/downloader/sync-all for music: re-checks every followed artist.
export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const db = getDb();

  const flag = db.prepare("SELECT value FROM settings WHERE key = 'music_sync_all_active'").get() as { value: string } | undefined;
  if (flag?.value === '1') {
    return { success: false, message: 'A music sync is already running.' };
  }

  // Fire and forget, like the video route; syncAllMusicArtists logs its own errors.
  syncAllMusicArtists().catch((err) => console.error('[admin/music/sync-all]', err));

  return { success: true, message: 'Sync started for every followed artist.' };
});
```

`server/api/admin/podcasts/sync-all.post.ts`:

```ts
import { defineEventHandler } from 'h3';
import { syncAllPodcastShows } from '../../../utils/podcastDownloader';

// Mirrors /api/admin/downloader/sync-all for podcasts: re-checks every followed show.
export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const db = getDb();

  const flag = db.prepare("SELECT value FROM settings WHERE key = 'podcast_sync_all_active'").get() as { value: string } | undefined;
  if (flag?.value === '1') {
    return { success: false, message: 'A podcast sync is already running.' };
  }

  syncAllPodcastShows().catch((err) => console.error('[admin/podcasts/sync-all]', err));

  return { success: true, message: 'Sync started for every followed podcast.' };
});
```

- [ ] **Step 9: Run it to pass**

Run: `npx vitest run tests/integration/music-podcast-sync-all.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 10: Mutation-check**

Delete the `if (flag?.value === '1') { … }` block in the music route; run the file: expect `music › refuses while a sync of that type is already running` to fail (`expected true to be false`). Revert.

- [ ] **Step 11: Full suite, build, commit**

Run: `npx vitest run` (all PASS) and `npx nuxt build 2>&1 | tail -5` (no error).

```bash
git add server/api/admin/music/queue.get.ts server/api/admin/podcasts/queue.get.ts server/api/admin/music/sync-all.post.ts server/api/admin/podcasts/sync-all.post.ts tests/integration/music-podcast-queue-total.test.ts tests/integration/music-podcast-sync-all.test.ts
git commit -m "feat: music and podcast queues report queueTotal, plus sync-all routes" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Tab shell — new tab keys, legacy `?tab=` normalisation, Downloads badge

**Files:**
- Create: `app/utils/settingsTabs.ts`
- Create: `app/composables/useActiveCounts.ts`
- Modify: `app/pages/settings.vue` lines 1-171 (the whole `<template>` and `<script setup>`; the `<style>` block from line 173 is untouched)
- Test: `tests/unit/settingsTabs.test.ts` (new), `tests/component/useActiveCounts.test.ts` (new)

**Interfaces:**
- Consumes: `GET /api/admin/downloader/active-counts` → `{ video: { downloading, pending }, music: {…}, podcasts: {…}, total, current }` (existing).
- Produces:
  - `app/utils/settingsTabs.ts`: `type SettingsTab = 'overview' | 'library' | 'downloads' | 'users' | 'system'`; `type LibrarySection = 'videos' | 'music' | 'podcasts'`; `const SETTINGS_TABS: readonly SettingsTab[]`; `const LIBRARY_SECTIONS: readonly LibrarySection[]` (order videos, music, podcasts); `normalizeSettingsTab(query: { tab?: unknown; section?: unknown }): { tab: SettingsTab; section: LibrarySection | null }`.
  - `app/composables/useActiveCounts.ts`: `interface ActiveCounts`; `useActiveCounts(): { counts: Ref<ActiveCounts | null>; downloadingTotal: ComputedRef<number>; queuedTotal: ComputedRef<number>; fetchActiveCounts(): Promise<void> }` (state key `admin_active_counts`).
  - `settings.vue` script locals later tasks edit: `activeTab: Ref<SettingsTab>`, `librarySection: Ref<LibrarySection | null>`, `selectTab(tab)`, the three pollers `runPolling`, `runMusicPolling`, `runPodcastPolling`.

- [ ] **Step 1: Write the failing unit test**

Create `tests/unit/settingsTabs.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { normalizeSettingsTab, SETTINGS_TABS, LIBRARY_SECTIONS } from '../../app/utils/settingsTabs';

describe('normalizeSettingsTab', () => {
  it.each([
    [{ tab: 'overview' }, { tab: 'overview', section: null }],
    [{ tab: 'downloads' }, { tab: 'downloads', section: null }],
    [{ tab: 'users' }, { tab: 'users', section: null }],
    [{ tab: 'system' }, { tab: 'system', section: null }],
    [{ tab: 'library' }, { tab: 'library', section: null }],
    [{ tab: 'library', section: 'videos' }, { tab: 'library', section: 'videos' }],
    [{ tab: 'library', section: 'podcasts' }, { tab: 'library', section: 'podcasts' }],
    [{ tab: 'library', section: 'nope' }, { tab: 'library', section: null }],
    [{ tab: 'downloads', section: 'music' }, { tab: 'downloads', section: null }],
  ])('keeps a current key: %o', (query, expected) => {
    expect(normalizeSettingsTab(query)).toEqual(expected);
  });

  it.each([
    [{ tab: 'stats' }, { tab: 'overview', section: null }],
    [{ tab: 'music' }, { tab: 'library', section: 'music' }],
    [{ tab: 'podcasts' }, { tab: 'library', section: 'podcasts' }],
    [{ tab: 'music', section: 'videos' }, { tab: 'library', section: 'music' }],
  ])('maps a legacy key: %o', (query, expected) => {
    expect(normalizeSettingsTab(query)).toEqual(expected);
  });

  it.each([
    [{}],
    [{ tab: '' }],
    [{ tab: 'unknown' }],
    [{ tab: 'constructor' }],
    [{ tab: '__proto__' }],
    [{ tab: 42 }],
    [{ tab: null }],
  ])('falls back to overview: %o', (query) => {
    expect(normalizeSettingsTab(query)).toEqual({ tab: 'overview', section: null });
  });

  it('reads the first value of a repeated query parameter', () => {
    expect(normalizeSettingsTab({ tab: ['library', 'users'], section: ['music'] })).toEqual({ tab: 'library', section: 'music' });
  });

  it('exposes the tab and section orders', () => {
    expect(SETTINGS_TABS).toEqual(['overview', 'library', 'downloads', 'users', 'system']);
    expect(LIBRARY_SECTIONS).toEqual(['videos', 'music', 'podcasts']);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/unit/settingsTabs.test.ts`
Expected: FAIL — `Failed to resolve import "../../app/utils/settingsTabs"`.

- [ ] **Step 3: Implement `app/utils/settingsTabs.ts`**

```ts
export type SettingsTab = 'overview' | 'library' | 'downloads' | 'users' | 'system';
export type LibrarySection = 'videos' | 'music' | 'podcasts';

export const SETTINGS_TABS: readonly SettingsTab[] = ['overview', 'library', 'downloads', 'users', 'system'];
export const LIBRARY_SECTIONS: readonly LibrarySection[] = ['videos', 'music', 'podcasts'];

// Old ?tab= values still used by bookmarks and in-app links.
const LEGACY_TABS: Record<string, { tab: SettingsTab; section: LibrarySection | null }> = {
  stats: { tab: 'overview', section: null },
  music: { tab: 'library', section: 'music' },
  podcasts: { tab: 'library', section: 'podcasts' },
};

function firstString(value: unknown): string {
  const v = Array.isArray(value) ? value[0] : value;
  return typeof v === 'string' ? v : '';
}

export function normalizeSettingsTab(query: { tab?: unknown; section?: unknown }): { tab: SettingsTab; section: LibrarySection | null } {
  const rawTab = firstString(query.tab);
  // hasOwnProperty, not `in`/indexing: '__proto__' or 'constructor' must not match.
  if (Object.prototype.hasOwnProperty.call(LEGACY_TABS, rawTab)) {
    return { ...LEGACY_TABS[rawTab]! };
  }
  if (!(SETTINGS_TABS as readonly string[]).includes(rawTab)) {
    return { tab: 'overview', section: null };
  }
  const tab = rawTab as SettingsTab;
  if (tab !== 'library') return { tab, section: null };
  const rawSection = firstString(query.section);
  const section = (LIBRARY_SECTIONS as readonly string[]).includes(rawSection) ? (rawSection as LibrarySection) : null;
  return { tab, section };
}
```

- [ ] **Step 4: Run it to pass**

Run: `npx vitest run tests/unit/settingsTabs.test.ts` — Expected: PASS.

- [ ] **Step 5: Mutation-check**

Replace `Object.prototype.hasOwnProperty.call(LEGACY_TABS, rawTab)` with `LEGACY_TABS[rawTab]`; run: expect the `constructor`/`__proto__` cases to fail. Revert.

- [ ] **Step 6: Write the failing composable test**

Create `tests/component/useActiveCounts.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useActiveCounts } from '../../app/composables/useActiveCounts';

const payload = {
  video: { downloading: 1, pending: 4 },
  music: { downloading: 2, pending: 0 },
  podcasts: { downloading: 0, pending: 3 },
  total: 10,
  current: { kind: 'video', progress: 12, speed: '1MiB/s' },
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  useState('admin_active_counts').value = null;
  fetchMock = vi.fn(async () => payload);
  vi.stubGlobal('$fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('useActiveCounts', () => {
  it('starts empty with zero totals', () => {
    const { counts, downloadingTotal, queuedTotal } = useActiveCounts();
    expect(counts.value).toBeNull();
    expect(downloadingTotal.value).toBe(0);
    expect(queuedTotal.value).toBe(0);
  });

  it('loads the counts and sums downloading and queued across types', async () => {
    const { counts, downloadingTotal, queuedTotal, fetchActiveCounts } = useActiveCounts();
    await fetchActiveCounts();
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/downloader/active-counts');
    expect(counts.value).toEqual(payload);
    expect(downloadingTotal.value).toBe(3);
    expect(queuedTotal.value).toBe(7);
  });

  it('keeps the last value when a refresh fails', async () => {
    const { counts, fetchActiveCounts } = useActiveCounts();
    await fetchActiveCounts();
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    await fetchActiveCounts();
    expect(counts.value).toEqual(payload);
  });
});
```

- [ ] **Step 7: Run it to see it fail**

Run: `npx vitest run tests/component/useActiveCounts.test.ts`
Expected: FAIL — cannot resolve `../../app/composables/useActiveCounts`.

- [ ] **Step 8: Implement `app/composables/useActiveCounts.ts`**

```ts
import { computed } from 'vue';

export interface ActiveCounts {
  video: { downloading: number; pending: number };
  music: { downloading: number; pending: number };
  podcasts: { downloading: number; pending: number };
  total: number;
  current: { kind: 'video' | 'music' | 'podcasts' | null; progress: number | null; speed: string | null };
}

// Lightweight "what is downloading" counters shared by the Settings tab badge
// and the Overview Activity card. Reads the same endpoint as the sidebar badge.
export function useActiveCounts() {
  const counts = useState<ActiveCounts | null>('admin_active_counts', () => null);

  const downloadingTotal = computed(() => {
    const c = counts.value;
    return c ? c.video.downloading + c.music.downloading + c.podcasts.downloading : 0;
  });

  const queuedTotal = computed(() => {
    const c = counts.value;
    return c ? c.video.pending + c.music.pending + c.podcasts.pending : 0;
  });

  async function fetchActiveCounts() {
    try {
      counts.value = await $fetch<ActiveCounts>('/api/admin/downloader/active-counts');
    } catch {
      // Not critical: keep the last known value.
    }
  }

  return { counts, downloadingTotal, queuedTotal, fetchActiveCounts };
}
```

- [ ] **Step 9: Run it to pass**

Run: `npx vitest run tests/component/useActiveCounts.test.ts` — Expected: PASS (3 tests).

- [ ] **Step 10: Replace the template and script of `app/pages/settings.vue` (lines 1-171)**

Keep line 172 (blank) and the `<style>` block from line 173 unchanged. The five tab buttons reuse the SVGs of the current buttons: Overview = current Dashboard SVG (line 14), Downloads = current Downloads SVG (line 24), Users = line 57, System = line 67. Library uses the book icon shown below. Interim wiring (until Tasks 5 and 9): Library renders the old Music and Podcasts tabs; Downloads renders the old video tab; the music/podcast pollers run while Library is open.

```vue
<template>
  <div class="settings-container">
    <h1 class="page-title text-gradient">Settings</h1>

    <div class="settings-layout">
      <!-- Tabs Sidebar -->
      <div v-if="isAdmin" class="settings-tabs glass-panel">
        <template v-if="showTabs">
          <button class="tab-btn" :class="{ active: activeTab === 'overview' }" data-testid="settings-tab-overview" @click="selectTab('overview')">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>
            <span>Overview</span>
          </button>

          <button class="tab-btn" :class="{ active: activeTab === 'library' }" data-testid="settings-tab-library" @click="selectTab('library')">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>
            <span>Library</span>
          </button>

          <button class="tab-btn" :class="{ active: activeTab === 'downloads' }" data-testid="settings-tab-downloads" @click="selectTab('downloads')">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            <span>Downloads</span>
            <span v-if="downloadingTotal > 0" class="tab-badge" data-testid="downloads-tab-badge">{{ downloadingTotal }}</span>
          </button>

          <button class="tab-btn" :class="{ active: activeTab === 'users' }" data-testid="settings-tab-users" @click="selectTab('users')">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
            <span>Users</span>
          </button>

          <button class="tab-btn" :class="{ active: activeTab === 'system' }" data-testid="settings-tab-system" @click="selectTab('system')">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"></path></svg>
            <span>System</span>
          </button>
        </template>
      </div>

      <!-- Tab Content Area -->
      <div class="settings-content">
        <SettingsStatsTab v-if="activeTab === 'overview' && isAdmin" />
        <div v-if="activeTab === 'library' && isAdmin" class="tab-pane">
          <SettingsMusicTab id="library-music" />
          <SettingsPodcastsTab id="library-podcasts" />
        </div>
        <SettingsDownloadsTab v-if="activeTab === 'downloads' && isAdmin" />
        <SettingsSystemTab v-if="activeTab === 'system' && isAdmin" />
        <SettingsUsersTab v-if="activeTab === 'users' && isAdmin" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useAuth } from '~/composables/useAuth';
import { useDownloadsQueue } from '~/composables/useDownloadsQueue';
import { useMusicQueue } from '~/composables/useMusicQueue';
import { usePodcastQueue } from '~/composables/usePodcastQueue';
import { useActiveCounts } from '~/composables/useActiveCounts';
import { normalizeSettingsTab, type SettingsTab, type LibrarySection } from '~/utils/settingsTabs';

const { user: currentUser, isAdmin } = useAuth();
const route = useRoute();
const router = useRouter();

if (!isAdmin.value) {
  navigateTo('/account');
}

const showTabs = computed(() => isAdmin.value && !currentUser.value?.mustChangePassword);

const initial = normalizeSettingsTab(route.query);
const activeTab = ref<SettingsTab>(initial.tab);
const librarySection = ref<LibrarySection | null>(initial.section);

// Legacy links (?tab=stats|music|podcasts) and unknown values are normalised
// on load and on every query change.
watch(() => [route.query.tab, route.query.section], () => {
  const next = normalizeSettingsTab(route.query);
  activeTab.value = next.tab;
  librarySection.value = next.section;
});

function selectTab(tab: SettingsTab) {
  activeTab.value = tab;
  librarySection.value = null;
  router.replace({ query: { ...route.query, tab, section: undefined } });
}

const { downloadingTotal, fetchActiveCounts } = useActiveCounts();
let activeCountsTimer: ReturnType<typeof setInterval> | null = null;

const { activeDownloadCount, fetchQueue, fetchDiagnostics, stopSmoothProgressLoop } = useDownloadsQueue();
const { musicQueue, fetchMusicQueue } = useMusicQueue();
const { podcastQueue, fetchPodcastQueue } = usePodcastQueue();

// Dynamic polling for queue and progress (replaced by one loop in the Downloads tab in a later task)
let pollingTimeout: any = null;

const runPolling = async () => {
  if (!isAdmin.value) return;
  await fetchQueue();
  // Only poll diagnostics when downloads are active
  if (activeDownloadCount.value > 0) {
    await fetchDiagnostics();
  }
  const nextPollDelay = activeDownloadCount.value > 0 ? 500 : 3000;
  pollingTimeout = setTimeout(runPolling, nextPollDelay);
};

let musicPollingTimeout: any = null;

const runMusicPolling = async () => {
  if (!isAdmin.value || activeTab.value !== 'library') {
    musicPollingTimeout = setTimeout(runMusicPolling, 3000);
    return;
  }
  await fetchMusicQueue();
  const hasActiveMusicDownload = musicQueue.value.some(t => t.download_status === 'downloading');
  musicPollingTimeout = setTimeout(runMusicPolling, hasActiveMusicDownload ? 500 : 3000);
};

let podcastPollingTimeout: any = null;

const runPodcastPolling = async () => {
  if (!isAdmin.value || activeTab.value !== 'library') {
    podcastPollingTimeout = setTimeout(runPodcastPolling, 3000);
    return;
  }
  await fetchPodcastQueue();
  const hasActivePodcastDownload = podcastQueue.value.some(e => e.download_status === 'downloading');
  podcastPollingTimeout = setTimeout(runPodcastPolling, hasActivePodcastDownload ? 500 : 3000);
};

onMounted(() => {
  if (isAdmin.value) {
    fetchActiveCounts();
    activeCountsTimer = setInterval(fetchActiveCounts, 5000);
    runPolling();
    runMusicPolling();
    runPodcastPolling();
  }
});

onUnmounted(() => {
  if (activeCountsTimer) clearInterval(activeCountsTimer);
  if (pollingTimeout) clearTimeout(pollingTimeout);
  if (musicPollingTimeout) clearTimeout(musicPollingTimeout);
  if (podcastPollingTimeout) clearTimeout(podcastPollingTimeout);
  stopSmoothProgressLoop();
});
</script>
```

- [ ] **Step 11: Check the callers that link to settings tabs**

Run: `grep -rn "settings?tab=" app/` — expect exactly `app/components/channels/ChannelDirectoryView.vue:25`, `app/pages/index.vue:27`, `app/pages/admin/downloader.vue:5`, all `?tab=downloads`, which stays a valid key. Change nothing in them.

- [ ] **Step 12: Full suite, build, commit**

Run: `npx vitest run` (all PASS) and `npx nuxt build 2>&1 | tail -5`.

```bash
git add app/utils/settingsTabs.ts app/composables/useActiveCounts.ts app/pages/settings.vue tests/unit/settingsTabs.test.ts tests/component/useActiveCounts.test.ts
git commit -m "feat: settings tabs become Overview, Library, Downloads, Users, System with legacy links kept" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Source configuration + `LibrarySourceSection.vue` for Music and Podcasts

**Files:**
- Create: `app/utils/librarySources.ts`
- Create: `app/components/settings/LibrarySourceSection.vue`
- Test: `tests/unit/librarySources.test.ts` (new), `tests/component/LibrarySourceSection.test.ts` (new)
- Port source (read, do not modify): `app/components/settings/SettingsMusicTab.vue` lines 106-236 and 351-387, 482-537 (search, Suivre, add, followed artists); `app/components/settings/SettingsPodcastsTab.vue` the same blocks for shows.

**Interfaces:**
- Consumes: `LibrarySection` from `app/utils/settingsTabs.ts` (Task 2). Routes: `GET /api/admin/downloader/search-channels?q=` → `{ channels: [{ id, handle, title, avatarUrl, subscriberCount, videoCount, description }] }` (`handle` is a path like `/@name`); `GET /api/admin/podcasts/search-shows?q=` → `{ shows: [{ feedUrl, title, author, artworkUrl, description }] }`; `POST /api/admin/music/ingest` `{ url, sync_status, visibility? }`; `POST /api/admin/podcasts/ingest` `{ feedUrl, sync_status, visibility? }`; `GET /api/admin/music/queue` (`artists: [{ id, name, avatar_url, sync_status, visibility, track_count }]`); `GET /api/admin/podcasts/queue` (`shows: [{ id, title, cover_url, sync_status, visibility, episode_count }]`); pause/sync routes per artist/show; `POST /api/admin/music/sync-all`, `POST /api/admin/podcasts/sync-all` (Task 1).
- Produces (`app/utils/librarySources.ts`):
  - `type SourceKind = LibrarySection`; `type SourceVisibility = 'public' | 'private' | 'ultra_private'`
  - `interface SearchResultView { title: string; meta: string; description: string; imageUrl: string }`
  - `interface FollowedSource { id: string; name: string; imageUrl: string; countLabel: string; syncActive: boolean; visibility: string; href: string }`
  - `interface FollowOptions { autoSync: boolean; visibility: '' | SourceVisibility; downloadVideos: boolean; downloadShorts: boolean; downloadLives: boolean; dateAfter: string; saveFolder: string }`
  - `interface LibrarySourceConfig { kind; title; description; searchPlaceholder; searchEndpoint; readSearchResults(data): any[]; toResultView(raw): SearchResultView; followTarget(raw): string | null; directTarget(query): string | null; noTargetMessage; noResultsMessage; ingestEndpoint; buildIngestBody(target, options, raw | null): Record<string, unknown>; listEndpoint; readFollowing(data): FollowedSource[]; emptyFollowingMessage; pauseUrl(id): string; syncUrl(id): string; syncAllEndpoint; syncAllStartedMessage; visibilityUrl: ((id) => string) | null; hasVideoOptions: boolean }`
  - `DEFAULT_SAVE_FOLDER = '/downloads/videos'`, `defaultFollowOptions(kind)`, `visibilityLabel(v)`, `plural(n, word)`, `youtubeChannelUrl(raw, prefer: 'handle' | 'id')`, `youtubeDirectTarget(q)`, `feedDirectTarget(q)`, `channelResultView(raw)`, `musicSource`, `podcastsSource`.
- Produces (`LibrarySourceSection.vue`): props `{ config: LibrarySourceConfig; open?: boolean }` (default `open: true`); root `<details id="library-{kind}" data-testid="library-section-{kind}">`; test ids `follow-search-form`, `follow-search-input`, `follow-search-submit`, `follow-result-{index}`, `follow-options`, `option-auto-sync`, `option-visibility`, `sync-all`, `following-{id}`, `sync-switch-{id}`, `sync-now-{id}`, `visibility-{id}`; exposes `loadFollowing()`. Script locals Task 4 extends: `options`, `rows`, `busyRowId`, `loadFollowing`, `toast`, `onMounted(...)`.

- [ ] **Step 1: Write the failing unit test**

Create `tests/unit/librarySources.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  musicSource, podcastsSource, defaultFollowOptions, youtubeChannelUrl, youtubeDirectTarget,
  feedDirectTarget, visibilityLabel, plural,
} from '../../app/utils/librarySources';

describe('youtubeChannelUrl', () => {
  it('prefers the handle when asked', () => {
    expect(youtubeChannelUrl({ handle: '/@artist', id: 'UC1' }, 'handle')).toBe('https://www.youtube.com/@artist');
    expect(youtubeChannelUrl({ handle: '@artist' }, 'handle')).toBe('https://www.youtube.com/@artist');
  });
  it('prefers the id when asked', () => {
    expect(youtubeChannelUrl({ handle: '/@artist', id: 'UC1' }, 'id')).toBe('https://www.youtube.com/channel/UC1');
  });
  it('falls back to the other field, then to null', () => {
    expect(youtubeChannelUrl({ id: 'UC123' }, 'handle')).toBe('https://www.youtube.com/channel/UC123');
    expect(youtubeChannelUrl({ handle: '/@x' }, 'id')).toBe('https://www.youtube.com/@x');
    expect(youtubeChannelUrl({ id: '', handle: '' }, 'handle')).toBeNull();
  });
});

describe('direct targets', () => {
  it.each([
    ['https://www.youtube.com/@abc', 'https://www.youtube.com/@abc'],
    ['youtube.com/@abc', 'https://youtube.com/@abc'],
    ['www.youtube.com/channel/UC1', 'https://www.youtube.com/channel/UC1'],
    ['@abc', 'https://www.youtube.com/@abc'],
    ['  @abc  ', 'https://www.youtube.com/@abc'],
    ['Daft Punk', null],
    ['@two words', null],
    ['', null],
  ])('youtubeDirectTarget(%j) = %j', (q, expected) => {
    expect(youtubeDirectTarget(q)).toBe(expected);
  });

  it.each([
    ['https://feeds.example/show.xml', 'https://feeds.example/show.xml'],
    ['http://feeds.example/show.xml', 'http://feeds.example/show.xml'],
    ['Planet Money', null],
  ])('feedDirectTarget(%j) = %j', (q, expected) => {
    expect(feedDirectTarget(q)).toBe(expected);
  });
});

describe('musicSource', () => {
  it('builds the ingest body without visibility when it is left on "keep current"', () => {
    const o = defaultFollowOptions('music');
    expect(musicSource.buildIngestBody('https://www.youtube.com/@a', o, null)).toEqual({ url: 'https://www.youtube.com/@a', sync_status: 'downloading' });
  });
  it('sends paused and the visibility when chosen', () => {
    const o = { ...defaultFollowOptions('music'), autoSync: false, visibility: 'private' as const };
    expect(musicSource.buildIngestBody('u', o, null)).toEqual({ url: 'u', sync_status: 'paused', visibility: 'private' });
  });
  it('maps followed artists; only "downloading" counts as active', () => {
    const rows = musicSource.readFollowing({ artists: [
      { id: 'a1', name: 'One', avatar_url: 'x.jpg', sync_status: 'downloading', visibility: 'private', track_count: 3 },
      { id: 'a2', name: 'Two', avatar_url: null, sync_status: 'paused', visibility: null, track_count: 1 },
      { id: 'a3', name: 'Three', sync_status: 'active', visibility: 'public', track_count: 0 },
    ] });
    expect(rows).toEqual([
      { id: 'a1', name: 'One', imageUrl: 'x.jpg', countLabel: '3 tracks', syncActive: true, visibility: 'private', href: '/music?artistId=a1' },
      { id: 'a2', name: 'Two', imageUrl: '', countLabel: '1 track', syncActive: false, visibility: 'public', href: '/music?artistId=a2' },
      { id: 'a3', name: 'Three', imageUrl: '', countLabel: '0 tracks', syncActive: false, visibility: 'public', href: '/music?artistId=a3' },
    ]);
    expect(musicSource.readFollowing({})).toEqual([]);
  });
  it('uses the per-artist routes', () => {
    expect(musicSource.pauseUrl('a 1')).toBe('/api/admin/music/artists/a%201/pause');
    expect(musicSource.syncUrl('a1')).toBe('/api/admin/music/artists/a1/sync');
    expect(musicSource.syncAllEndpoint).toBe('/api/admin/music/sync-all');
    expect(musicSource.visibilityUrl).toBeNull();
  });
});

describe('podcastsSource', () => {
  it('follows by feed URL', () => {
    expect(podcastsSource.followTarget({ feedUrl: ' https://f/x.xml ' })).toBe('https://f/x.xml');
    expect(podcastsSource.followTarget({ feedUrl: '' })).toBeNull();
    expect(podcastsSource.buildIngestBody('https://f/x.xml', defaultFollowOptions('podcasts'), null)).toEqual({ feedUrl: 'https://f/x.xml', sync_status: 'downloading' });
  });
  it('maps followed shows', () => {
    expect(podcastsSource.readFollowing({ shows: [{ id: 's1', title: 'Show', cover_url: 'c.jpg', sync_status: 'downloading', visibility: 'public', episode_count: 2 }] })).toEqual([
      { id: 's1', name: 'Show', imageUrl: 'c.jpg', countLabel: '2 episodes', syncActive: true, visibility: 'public', href: '/podcasts?showId=s1' },
    ]);
  });
});

describe('helpers', () => {
  it('labels visibility and pluralises', () => {
    expect(visibilityLabel('ultra_private')).toBe('Ultra private');
    expect(visibilityLabel('weird')).toBe('weird');
    expect(plural(1, 'track')).toBe('1 track');
    expect(plural(2, 'track')).toBe('2 tracks');
  });
  it('defaults match the old forms', () => {
    expect(defaultFollowOptions('music')).toMatchObject({ autoSync: true, visibility: '' });
    expect(defaultFollowOptions('videos')).toMatchObject({ autoSync: true, visibility: 'public', downloadVideos: true, downloadShorts: false, downloadLives: false, dateAfter: '', saveFolder: '/downloads/videos' });
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/unit/librarySources.test.ts`
Expected: FAIL — cannot resolve `../../app/utils/librarySources`.

- [ ] **Step 3: Implement `app/utils/librarySources.ts`**

```ts
import type { LibrarySection } from './settingsTabs';

export type SourceKind = LibrarySection;
export type SourceVisibility = 'public' | 'private' | 'ultra_private';

export interface SearchResultView {
  title: string;
  meta: string;
  description: string;
  imageUrl: string;
}

export interface FollowedSource {
  id: string;
  name: string;
  imageUrl: string;
  countLabel: string;
  /** True only when the server will download new items (sync_status === 'downloading'). */
  syncActive: boolean;
  visibility: string;
  href: string;
}

export interface FollowOptions {
  autoSync: boolean;
  /** '' = keep the current value (Public if new) — music and podcasts only. */
  visibility: '' | SourceVisibility;
  downloadVideos: boolean;
  downloadShorts: boolean;
  downloadLives: boolean;
  /** YYYY-MM-DD from <input type="date">, or ''. */
  dateAfter: string;
  saveFolder: string;
}

export interface LibrarySourceConfig {
  kind: SourceKind;
  title: string;
  description: string;
  searchPlaceholder: string;
  searchEndpoint: string;
  readSearchResults: (data: any) => any[];
  toResultView: (raw: any) => SearchResultView;
  /** URL or feed to follow for a search result, or null when it can't be followed. */
  followTarget: (raw: any) => string | null;
  /** When the search box holds a pasted URL/handle/feed, the target to follow directly. */
  directTarget: (query: string) => string | null;
  noTargetMessage: string;
  noResultsMessage: string;
  ingestEndpoint: string;
  buildIngestBody: (target: string, options: FollowOptions, raw: any | null) => Record<string, unknown>;
  listEndpoint: string;
  readFollowing: (data: any) => FollowedSource[];
  emptyFollowingMessage: string;
  pauseUrl: (id: string) => string;
  /** Also used to resume: the sync route sets the source back to 'downloading'. */
  syncUrl: (id: string) => string;
  syncAllEndpoint: string;
  syncAllStartedMessage: string;
  /** Only channels have a visibility route. */
  visibilityUrl: ((id: string) => string) | null;
  hasVideoOptions: boolean;
}

export const DEFAULT_SAVE_FOLDER = '/downloads/videos';

export function defaultFollowOptions(kind: SourceKind): FollowOptions {
  return {
    autoSync: true,
    visibility: kind === 'videos' ? 'public' : '',
    downloadVideos: true,
    downloadShorts: false,
    downloadLives: false,
    dateAfter: '',
    saveFolder: DEFAULT_SAVE_FOLDER,
  };
}

const VISIBILITY_LABELS: Record<string, string> = { public: 'Public', private: 'Private', ultra_private: 'Ultra private' };

export function visibilityLabel(visibility: string): string {
  return VISIBILITY_LABELS[visibility] ?? visibility;
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function handleUrl(handle: unknown): string | null {
  if (typeof handle !== 'string' || !handle.trim()) return null;
  const h = handle.trim();
  return `https://www.youtube.com${h.startsWith('/') ? '' : '/'}${h}`;
}

function idUrl(id: unknown): string | null {
  return typeof id === 'string' && id.trim() ? `https://www.youtube.com/channel/${id.trim()}` : null;
}

export function youtubeChannelUrl(raw: any, prefer: 'handle' | 'id'): string | null {
  return prefer === 'handle'
    ? handleUrl(raw?.handle) ?? idUrl(raw?.id)
    : idUrl(raw?.id) ?? handleUrl(raw?.handle);
}

export function youtubeDirectTarget(query: string): string | null {
  const q = query.trim();
  if (!q) return null;
  if (/^https?:\/\//i.test(q)) return q;
  if (/^(www\.|m\.)?youtube\.com\//i.test(q)) return `https://${q}`;
  if (/^@[\w.-]+$/.test(q)) return `https://www.youtube.com/${q}`;
  return null;
}

export function feedDirectTarget(query: string): string | null {
  const q = query.trim();
  return /^https?:\/\//i.test(q) ? q : null;
}

export function channelResultView(raw: any): SearchResultView {
  const meta = [
    raw?.subscriberCount ? `${raw.subscriberCount} subscribers` : '',
    raw?.videoCount ? `${raw.videoCount} videos` : '',
  ].filter(Boolean).join(' · ');
  return {
    title: raw?.title || 'Untitled channel',
    meta,
    description: raw?.description || '',
    imageUrl: raw?.avatarUrl || '',
  };
}

function syncBody(options: FollowOptions) {
  return {
    sync_status: options.autoSync ? 'downloading' : 'paused',
    ...(options.visibility ? { visibility: options.visibility } : {}),
  };
}

const enc = encodeURIComponent;

export const musicSource: LibrarySourceConfig = {
  kind: 'music',
  title: 'Music',
  description: 'Follow artists on YouTube. New tracks are downloaded as audio automatically.',
  searchPlaceholder: 'Artist name, YouTube channel URL or @handle',
  searchEndpoint: '/api/admin/downloader/search-channels',
  readSearchResults: (data) => (Array.isArray(data?.channels) ? data.channels : []),
  toResultView: channelResultView,
  followTarget: (raw) => youtubeChannelUrl(raw, 'handle'),
  directTarget: youtubeDirectTarget,
  noTargetMessage: "This result has no channel address, so it can't be followed.",
  noResultsMessage: 'No artists found for this search.',
  ingestEndpoint: '/api/admin/music/ingest',
  buildIngestBody: (target, options) => ({ url: target, ...syncBody(options) }),
  listEndpoint: '/api/admin/music/queue',
  readFollowing: (data) => (Array.isArray(data?.artists) ? data.artists : []).map((a: any) => ({
    id: String(a.id),
    name: String(a.name ?? ''),
    imageUrl: a.avatar_url || '',
    countLabel: plural(Number(a.track_count) || 0, 'track'),
    syncActive: a.sync_status === 'downloading',
    visibility: String(a.visibility || 'public'),
    href: `/music?artistId=${enc(String(a.id))}`,
  })),
  emptyFollowingMessage: "You're not following any artist yet.",
  pauseUrl: (id) => `/api/admin/music/artists/${enc(id)}/pause`,
  syncUrl: (id) => `/api/admin/music/artists/${enc(id)}/sync`,
  syncAllEndpoint: '/api/admin/music/sync-all',
  syncAllStartedMessage: 'Sync started for every followed artist.',
  visibilityUrl: null,
  hasVideoOptions: false,
};

export const podcastsSource: LibrarySourceConfig = {
  kind: 'podcasts',
  title: 'Podcasts',
  description: 'Follow podcasts by name or RSS feed. New episodes are downloaded automatically.',
  searchPlaceholder: 'Podcast name or RSS feed URL',
  searchEndpoint: '/api/admin/podcasts/search-shows',
  readSearchResults: (data) => (Array.isArray(data?.shows) ? data.shows : []),
  toResultView: (raw) => ({
    title: raw?.title || 'Untitled podcast',
    meta: raw?.author || '',
    description: raw?.description || '',
    imageUrl: raw?.artworkUrl || '',
  }),
  followTarget: (raw) => (typeof raw?.feedUrl === 'string' && raw.feedUrl.trim() ? raw.feedUrl.trim() : null),
  directTarget: feedDirectTarget,
  noTargetMessage: "This podcast has no usable RSS feed, so it can't be followed.",
  noResultsMessage: 'No podcasts found for this search.',
  ingestEndpoint: '/api/admin/podcasts/ingest',
  buildIngestBody: (target, options) => ({ feedUrl: target, ...syncBody(options) }),
  listEndpoint: '/api/admin/podcasts/queue',
  readFollowing: (data) => (Array.isArray(data?.shows) ? data.shows : []).map((s: any) => ({
    id: String(s.id),
    name: String(s.title ?? ''),
    imageUrl: s.cover_url || '',
    countLabel: plural(Number(s.episode_count) || 0, 'episode'),
    syncActive: s.sync_status === 'downloading',
    visibility: String(s.visibility || 'public'),
    href: `/podcasts?showId=${enc(String(s.id))}`,
  })),
  emptyFollowingMessage: "You're not following any podcast yet.",
  pauseUrl: (id) => `/api/admin/podcasts/shows/${enc(id)}/pause`,
  syncUrl: (id) => `/api/admin/podcasts/shows/${enc(id)}/sync`,
  syncAllEndpoint: '/api/admin/podcasts/sync-all',
  syncAllStartedMessage: 'Sync started for every followed podcast.',
  visibilityUrl: null,
  hasVideoOptions: false,
};
```

- [ ] **Step 4: Run it to pass**

Run: `npx vitest run tests/unit/librarySources.test.ts` — Expected: PASS.

- [ ] **Step 5: Write the failing component test**

Create `tests/component/LibrarySourceSection.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import LibrarySourceSection from '../../app/components/settings/LibrarySourceSection.vue';
import { musicSource, podcastsSource } from '../../app/utils/librarySources';
import { useToast } from '../../app/composables/useToast';

let fetchMock: ReturnType<typeof vi.fn>;
let searchPayload: any;
let listPayload: any;
let holdIngest: boolean;
let failIngest: boolean;
let ingestResolvers: Array<(v: any) => void>;
let failRowAction: boolean;
let syncAllPayload: any;

const posts = (url: string) => fetchMock.mock.calls.filter(([u, o]) => u === url && o?.method === 'POST');
const gets = (url: string) => fetchMock.mock.calls.filter(([u, o]) => u === url && !o?.method);
const toastMessages = () => useToast().toasts.value.map((t) => t.message);

beforeEach(() => {
  searchPayload = {};
  listPayload = {};
  holdIngest = false;
  failIngest = false;
  ingestResolvers = [];
  failRowAction = false;
  syncAllPayload = { success: true };
  useToast().toasts.value = [];
  fetchMock = vi.fn(async (url: string, opts?: any) => {
    if (url === '/api/admin/downloader/search-channels' || url === '/api/admin/podcasts/search-shows') return searchPayload;
    if (url === '/api/admin/music/queue' || url === '/api/admin/podcasts/queue') return listPayload;
    if (opts?.method === 'POST' && (url === '/api/admin/music/ingest' || url === '/api/admin/podcasts/ingest')) {
      if (failIngest) throw Object.assign(new Error('boom'), { data: { statusMessage: 'nope' } });
      if (holdIngest) return new Promise((resolve) => ingestResolvers.push(resolve));
      return { success: true, message: 'ok' };
    }
    if (opts?.method === 'POST' && url.endsWith('/sync-all')) return syncAllPayload;
    if (opts?.method === 'POST' && /\/(pause|sync)$/.test(url)) {
      if (failRowAction) throw Object.assign(new Error('down'), { data: { statusMessage: 'Server unreachable' } });
      return { success: true };
    }
    return {};
  });
  vi.stubGlobal('$fetch', fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

async function search(wrapper: any, text = 'query') {
  await wrapper.find('[data-testid="follow-search-input"]').setValue(text);
  await wrapper.find('[data-testid="follow-search-form"]').trigger('submit');
  await flushPromises();
}

const followButtons = (w: any) => w.findAll('[data-testid^="follow-result-"]');

describe('LibrarySourceSection — Music', () => {
  const mountMusic = () => mountSuspended(LibrarySourceSection, { props: { config: musicSource } });

  it('follows in one click with the handle URL, clears the results and reloads Following', async () => {
    searchPayload = { channels: [{ id: 'UC1', handle: '/@artist', title: 'Artist' }] };
    const w = await mountMusic();
    await flushPromises();
    const listCallsBefore = gets('/api/admin/music/queue').length;
    await search(w);
    expect(followButtons(w)).toHaveLength(1);
    expect(followButtons(w)[0].text()).toBe('Follow');

    await followButtons(w)[0].trigger('click');
    await flushPromises();

    const calls = posts('/api/admin/music/ingest');
    expect(calls).toHaveLength(1);
    expect(calls[0][1].body).toEqual({ url: 'https://www.youtube.com/@artist', sync_status: 'downloading' });
    expect(followButtons(w)).toHaveLength(0);
    expect(gets('/api/admin/music/queue').length).toBe(listCallsBefore + 1);
    expect(toastMessages()).toContain('Now following Artist.');
  });

  it('falls back to the channel id URL when there is no handle', async () => {
    searchPayload = { channels: [{ id: 'UC123', title: 'Artist' }] };
    const w = await mountMusic();
    await search(w);
    await followButtons(w)[0].trigger('click');
    await flushPromises();
    expect(posts('/api/admin/music/ingest')[0][1].body.url).toBe('https://www.youtube.com/channel/UC123');
  });

  it('calls no ingest endpoint when the result has no address', async () => {
    searchPayload = { channels: [{ id: '', title: 'Ghost' }] };
    const w = await mountMusic();
    await search(w);
    await followButtons(w)[0].trigger('click');
    await flushPromises();
    expect(posts('/api/admin/music/ingest')).toHaveLength(0);
    expect(toastMessages()).toContain("This result has no channel address, so it can't be followed.");
  });

  it('cannot be triggered a second time while the add is pending', async () => {
    searchPayload = { channels: [{ id: 'UC1', handle: '/@artist', title: 'Artist' }] };
    holdIngest = true;
    const w = await mountMusic();
    await search(w);
    const btn = followButtons(w)[0];
    await btn.trigger('click');
    await flushPromises();
    expect(posts('/api/admin/music/ingest')).toHaveLength(1);
    expect(followButtons(w)).toHaveLength(1);
    expect((btn.element as HTMLButtonElement).disabled).toBe(true);
    await btn.trigger('click');
    await flushPromises();
    expect(posts('/api/admin/music/ingest')).toHaveLength(1);
    ingestResolvers.forEach((r) => r({ success: true, message: 'ok' }));
    await flushPromises();
  });

  it('keeps the results after a failed add so Follow can be retried, then clears them', async () => {
    searchPayload = { channels: [{ id: 'UC1', handle: '/@a', title: 'A' }, { id: 'UC2', handle: '/@b', title: 'B' }] };
    failIngest = true;
    const w = await mountMusic();
    await search(w);
    await followButtons(w)[0].trigger('click');
    await flushPromises();
    expect(posts('/api/admin/music/ingest')).toHaveLength(1);
    expect(followButtons(w)).toHaveLength(2);
    expect((followButtons(w)[0].element as HTMLButtonElement).disabled).toBe(false);
    expect(toastMessages()).toContain('nope');

    failIngest = false;
    await followButtons(w)[0].trigger('click');
    await flushPromises();
    expect(posts('/api/admin/music/ingest')).toHaveLength(2);
    expect(followButtons(w)).toHaveLength(0);
  });

  it('a quick double click on two different results starts only one add', async () => {
    searchPayload = { channels: [{ id: 'UC1', handle: '/@a', title: 'A' }, { id: 'UC2', handle: '/@b', title: 'B' }] };
    holdIngest = true;
    const w = await mountMusic();
    await search(w);
    const [a, b] = followButtons(w);
    a.trigger('click');
    b.trigger('click');
    await flushPromises();
    expect(posts('/api/admin/music/ingest')).toHaveLength(1);
    expect(posts('/api/admin/music/ingest')[0][1].body.url).toBe('https://www.youtube.com/@a');
    ingestResolvers.forEach((r) => r({ success: true, message: 'ok' }));
    await flushPromises();
  });

  it('uses the "Options for new follows" (auto-sync off, visibility private)', async () => {
    searchPayload = { channels: [{ id: 'UC1', handle: '/@a', title: 'A' }] };
    const w = await mountMusic();
    await search(w);
    await w.find('[data-testid="option-auto-sync"]').setValue(false);
    await w.find('[data-testid="option-visibility"]').setValue('private');
    await followButtons(w)[0].trigger('click');
    await flushPromises();
    expect(posts('/api/admin/music/ingest')[0][1].body).toEqual({ url: 'https://www.youtube.com/@a', sync_status: 'paused', visibility: 'private' });
  });

  it('follows a pasted @handle directly without searching', async () => {
    const w = await mountMusic();
    await w.find('[data-testid="follow-search-input"]').setValue('@someone');
    expect(w.find('[data-testid="follow-search-submit"]').text()).toBe('Follow');
    await w.find('[data-testid="follow-search-form"]').trigger('submit');
    await flushPromises();
    expect(gets('/api/admin/downloader/search-channels')).toHaveLength(0);
    expect(posts('/api/admin/music/ingest')[0][1].body).toEqual({ url: 'https://www.youtube.com/@someone', sync_status: 'downloading' });
    expect((w.find('[data-testid="follow-search-input"]').element as HTMLInputElement).value).toBe('');
  });

  it('does nothing on an empty search box (no HTML5 required attribute is relied on)', async () => {
    const w = await mountMusic();
    await w.find('[data-testid="follow-search-form"]').trigger('submit');
    await flushPromises();
    expect(gets('/api/admin/downloader/search-channels')).toHaveLength(0);
    expect(w.find('[data-testid="follow-search-input"]').attributes('required')).toBeUndefined();
  });
});

describe('LibrarySourceSection — Podcasts', () => {
  const mountPodcasts = () => mountSuspended(LibrarySourceSection, { props: { config: podcastsSource } });

  it('follows a search result by its feed URL in one click', async () => {
    searchPayload = { shows: [{ feedUrl: 'https://feeds.example/show.xml', title: 'Show', author: 'A' }] };
    const w = await mountPodcasts();
    await search(w);
    await followButtons(w)[0].trigger('click');
    await flushPromises();
    expect(posts('/api/admin/podcasts/ingest')[0][1].body).toEqual({ feedUrl: 'https://feeds.example/show.xml', sync_status: 'downloading' });
    expect(followButtons(w)).toHaveLength(0);
  });

  it('refuses a result without a feed', async () => {
    searchPayload = { shows: [{ feedUrl: '', title: 'No feed', author: 'A' }] };
    const w = await mountPodcasts();
    await search(w);
    await followButtons(w)[0].trigger('click');
    await flushPromises();
    expect(posts('/api/admin/podcasts/ingest')).toHaveLength(0);
    expect(toastMessages()).toContain("This podcast has no usable RSS feed, so it can't be followed.");
  });

  it('follows a pasted feed URL directly', async () => {
    const w = await mountPodcasts();
    await w.find('[data-testid="follow-search-input"]').setValue('https://feeds.example/x.xml');
    await w.find('[data-testid="follow-search-form"]').trigger('submit');
    await flushPromises();
    expect(gets('/api/admin/podcasts/search-shows')).toHaveLength(0);
    expect(posts('/api/admin/podcasts/ingest')[0][1].body.feedUrl).toBe('https://feeds.example/x.xml');
  });
});

describe('LibrarySourceSection — Following list', () => {
  beforeEach(() => {
    listPayload = { artists: [
      { id: 'a1', name: 'Artist One', avatar_url: '', sync_status: 'downloading', visibility: 'private', track_count: 3 },
      { id: 'a2', name: 'Artist Two', avatar_url: '', sync_status: 'paused', visibility: 'public', track_count: 1 },
    ] };
  });
  const mountMusic = async () => {
    const w = await mountSuspended(LibrarySourceSection, { props: { config: musicSource } });
    await flushPromises();
    return w;
  };

  it('renders one row per artist with count, state and a read-only visibility badge', async () => {
    const w = await mountMusic();
    const row = w.find('[data-testid="following-a1"]');
    expect(row.text()).toContain('Artist One');
    expect(row.text()).toContain('3 tracks');
    expect(row.text()).toContain('Active');
    expect(w.find('[data-testid="following-a2"]').text()).toContain('Paused');
    const badge = w.find('[data-testid="visibility-a1"]');
    expect(badge.element.tagName).toBe('SPAN');
    expect(badge.text()).toBe('Private');
    expect(w.text()).toContain('Following (2)');
  });

  it('turning the switch off pauses, turning it on syncs', async () => {
    const w = await mountMusic();
    await w.find('[data-testid="sync-switch-a1"]').setValue(false);
    await flushPromises();
    expect(posts('/api/admin/music/artists/a1/pause')).toHaveLength(1);
    await w.find('[data-testid="sync-switch-a2"]').setValue(true);
    await flushPromises();
    expect(posts('/api/admin/music/artists/a2/sync')).toHaveLength(1);
  });

  it('a failed pause shows an error and puts the switch back to the server state', async () => {
    failRowAction = true;
    const w = await mountMusic();
    const sw = w.find('[data-testid="sync-switch-a1"]');
    await sw.setValue(false);
    await flushPromises();
    expect(posts('/api/admin/music/artists/a1/pause')).toHaveLength(1);
    expect(toastMessages()).toContain('Server unreachable');
    expect((sw.element as HTMLInputElement).checked).toBe(true);
  });

  it('Sync now calls the sync route', async () => {
    const w = await mountMusic();
    await w.find('[data-testid="sync-now-a2"]').trigger('click');
    await flushPromises();
    expect(posts('/api/admin/music/artists/a2/sync')).toHaveLength(1);
    expect(toastMessages()).toContain('Sync started for Artist Two.');
  });

  it('Sync all calls the section route and reports a sync already running', async () => {
    const w = await mountMusic();
    await w.find('[data-testid="sync-all"]').trigger('click');
    await flushPromises();
    expect(posts('/api/admin/music/sync-all')).toHaveLength(1);
    expect(toastMessages()).toContain('Sync started for every followed artist.');

    syncAllPayload = { success: false };
    await w.find('[data-testid="sync-all"]').trigger('click');
    await flushPromises();
    expect(toastMessages()).toContain('A sync is already running.');
  });

  it('is collapsed when open is false', async () => {
    const w = await mountSuspended(LibrarySourceSection, { props: { config: musicSource, open: false } });
    expect(w.find('[data-testid="library-section-music"]').attributes('open')).toBeUndefined();
    const w2 = await mountSuspended(LibrarySourceSection, { props: { config: musicSource } });
    expect(w2.find('[data-testid="library-section-music"]').attributes('open')).toBeDefined();
  });
});
```

- [ ] **Step 6: Run it to see it fail**

Run: `npx vitest run tests/component/LibrarySourceSection.test.ts`
Expected: FAIL — cannot resolve `../../app/components/settings/LibrarySourceSection.vue`.

- [ ] **Step 7: Implement `app/components/settings/LibrarySourceSection.vue`**

```vue
<template>
  <details
    :id="`library-${config.kind}`"
    class="library-section glass-panel"
    :data-testid="`library-section-${config.kind}`"
    :open="open"
  >
    <summary class="library-section-summary">
      <span class="library-section-title">{{ config.title }}</span>
      <span class="section-desc">{{ config.description }}</span>
    </summary>

    <form class="ingest-form mt-3" data-testid="follow-search-form" @submit.prevent="onSubmit">
      <div class="search-input-wrapper">
        <input
          v-model="query"
          type="text"
          class="form-input settings-search-input"
          :placeholder="config.searchPlaceholder"
          :disabled="searching || adding"
          data-testid="follow-search-input"
        />
      </div>
      <button type="submit" class="btn btn-primary" :disabled="searching || adding" data-testid="follow-search-submit">
        {{ submitLabel }}
      </button>
    </form>

    <div v-if="results.length > 0" class="search-results-list mt-4">
      <h4 class="results-header">Results</h4>
      <div class="search-results-grid">
        <div v-for="(view, index) in resultViews" :key="index" class="search-channel-card">
          <img
            :src="view.imageUrl || '/img/default-avatar.png'"
            class="channel-avatar-thumb"
            referrerpolicy="no-referrer"
            alt=""
            @error="onImageError"
          />
          <div class="channel-search-info">
            <h5>{{ view.title }}</h5>
            <p v-if="view.meta" class="channel-search-meta">{{ view.meta }}</p>
            <p v-if="view.description" class="channel-search-desc">{{ view.description }}</p>
          </div>
          <button
            type="button"
            class="btn btn-primary btn-xs"
            :disabled="adding"
            :data-testid="`follow-result-${index}`"
            @click="followResult(results[index])"
          >Follow</button>
        </div>
      </div>
    </div>

    <details class="follow-options mt-3" data-testid="follow-options">
      <summary>Options for new follows</summary>
      <div class="follow-options-body">
        <label class="checkbox-container">
          <input v-model="options.autoSync" type="checkbox" data-testid="option-auto-sync" />
          <span class="checkmark"></span>
          Sync automatically (start downloading right away)
        </label>
        <div class="form-group">
          <label class="form-label" :for="`follow-visibility-${config.kind}`">Visibility</label>
          <select :id="`follow-visibility-${config.kind}`" v-model="options.visibility" class="form-select" data-testid="option-visibility">
            <option v-if="!config.hasVideoOptions" value="">Keep current (Public if new)</option>
            <option value="public">Public (everyone)</option>
            <option value="private">Private (signed-in users)</option>
            <option value="ultra_private">Ultra private (admins and chosen users)</option>
          </select>
        </div>
      </div>
    </details>

    <div class="following-block mt-4">
      <div class="following-head">
        <h4 class="results-header">Following ({{ rows.length }})</h4>
        <button
          type="button"
          class="btn btn-secondary-dark btn-sm"
          :disabled="syncingAll || rows.length === 0"
          data-testid="sync-all"
          @click="onSyncAll"
        >{{ syncingAll ? 'Starting...' : 'Sync all' }}</button>
      </div>

      <p v-if="listError" class="settings-error-msg mt-2">Couldn't load the list. Reload the page to try again.</p>
      <p v-else-if="rows.length === 0" class="section-desc mt-2">{{ config.emptyFollowingMessage }}</p>
      <ul v-else class="following-list">
        <li v-for="row in rows" :key="row.id" class="following-row" :data-testid="`following-${row.id}`">
          <img
            :src="row.imageUrl || '/img/default-avatar.png'"
            class="channel-avatar-thumb"
            referrerpolicy="no-referrer"
            alt=""
            @error="onImageError"
          />
          <div class="following-info">
            <NuxtLink :to="row.href" class="following-name">{{ row.name }}</NuxtLink>
            <span class="section-desc">{{ row.countLabel }}</span>
          </div>
          <label class="following-sync" :title="row.syncActive ? 'New items download automatically' : 'Nothing new is downloaded'">
            <input
              type="checkbox"
              :checked="row.syncActive"
              :disabled="busyRowId === row.id"
              :data-testid="`sync-switch-${row.id}`"
              @change="onToggleSync(row, $event)"
            />
            <span>{{ row.syncActive ? 'Active' : 'Paused' }}</span>
          </label>
          <button
            type="button"
            class="btn btn-secondary-dark btn-xs"
            :disabled="busyRowId === row.id"
            :data-testid="`sync-now-${row.id}`"
            @click="onSyncNow(row)"
          >Sync now</button>
          <span class="badge visibility-badge" :data-testid="`visibility-${row.id}`">{{ visibilityLabel(row.visibility) }}</span>
        </li>
      </ul>
    </div>
  </details>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import { useToast } from '~/composables/useToast';
import {
  defaultFollowOptions, visibilityLabel,
  type FollowedSource, type FollowOptions, type LibrarySourceConfig,
} from '~/utils/librarySources';

const props = withDefaults(defineProps<{ config: LibrarySourceConfig; open?: boolean }>(), { open: true });

const toast = useToast();

const query = ref('');
const searching = ref(false);
const results = ref<any[]>([]);
const adding = ref(false);
const options = reactive<FollowOptions>(defaultFollowOptions(props.config.kind));
const rows = ref<FollowedSource[]>([]);
const listError = ref(false);
const busyRowId = ref<string | null>(null);
const syncingAll = ref(false);

const resultViews = computed(() => results.value.map((raw) => props.config.toResultView(raw)));
const submitLabel = computed(() => {
  if (searching.value) return 'Searching...';
  if (adding.value) return 'Following...';
  return props.config.directTarget(query.value) ? 'Follow' : 'Search';
});

function onImageError(event: Event) {
  const target = event.target as HTMLImageElement | null;
  if (target) target.src = '/img/default-avatar.png';
}

async function loadFollowing() {
  try {
    const data = await $fetch<any>(props.config.listEndpoint);
    rows.value = props.config.readFollowing(data);
    listError.value = false;
  } catch {
    listError.value = true;
  }
}

async function onSubmit() {
  const q = query.value.trim();
  if (!q) return;

  const direct = props.config.directTarget(q);
  if (direct) {
    if (await follow(direct, null)) query.value = '';
    return;
  }

  searching.value = true;
  results.value = [];
  try {
    const data = await $fetch<any>(props.config.searchEndpoint, { params: { q } });
    results.value = props.config.readSearchResults(data);
    if (results.value.length === 0) toast.info(props.config.noResultsMessage);
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Search failed.');
  } finally {
    searching.value = false;
  }
}

async function followResult(raw: any) {
  if (adding.value) return;
  const target = props.config.followTarget(raw);
  if (!target) {
    toast.error(props.config.noTargetMessage);
    return;
  }
  // Results stay on screen when the add fails, so Follow can be retried.
  if (await follow(target, raw)) results.value = [];
}

// Re-entrancy guard: `adding` is set synchronously, before the first await,
// so a second click in the same tick is ignored.
async function follow(target: string, raw: any | null): Promise<boolean> {
  if (adding.value) return false;
  adding.value = true;
  try {
    await $fetch(props.config.ingestEndpoint, {
      method: 'POST',
      body: props.config.buildIngestBody(target, options, raw),
    });
    toast.success(`Now following ${raw ? props.config.toResultView(raw).title : target}.`);
    await loadFollowing();
    return true;
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Could not follow. Check the address and try again.');
    return false;
  } finally {
    adding.value = false;
  }
}

function rowAfterReload(row: FollowedSource): FollowedSource {
  return rows.value.find((r) => r.id === row.id) ?? row;
}

async function onToggleSync(row: FollowedSource, event: Event) {
  const input = event.target as HTMLInputElement;
  const wantActive = input.checked;
  busyRowId.value = row.id;
  try {
    await $fetch(wantActive ? props.config.syncUrl(row.id) : props.config.pauseUrl(row.id), { method: 'POST' });
    toast.success(wantActive ? `${row.name} is active.` : `${row.name} is paused.`);
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Could not change the sync state.');
  } finally {
    await loadFollowing();
    // One-way binding: the browser already flipped the box, force it back to server truth.
    input.checked = rowAfterReload(row).syncActive;
    busyRowId.value = null;
  }
}

async function onSyncNow(row: FollowedSource) {
  busyRowId.value = row.id;
  try {
    await $fetch(props.config.syncUrl(row.id), { method: 'POST' });
    toast.success(`Sync started for ${row.name}.`);
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || `Could not sync ${row.name}.`);
  } finally {
    busyRowId.value = null;
    await loadFollowing();
  }
}

async function onSyncAll() {
  syncingAll.value = true;
  try {
    const res = await $fetch<{ success?: boolean }>(props.config.syncAllEndpoint, { method: 'POST' });
    if (res?.success === false) toast.info('A sync is already running.');
    else toast.success(props.config.syncAllStartedMessage);
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Could not start the sync.');
  } finally {
    syncingAll.value = false;
    await loadFollowing();
  }
}

onMounted(() => {
  loadFollowing();
});

defineExpose({ loadFollowing });
</script>

<style scoped>
.library-section { padding: 20px; display: flex; flex-direction: column; }
.library-section-summary { cursor: pointer; display: flex; flex-direction: column; gap: 4px; list-style-position: outside; }
.library-section-title { font-size: 18px; font-weight: 700; }
.follow-options { border-top: 1px solid rgba(255, 255, 255, 0.06); padding-top: 12px; }
.follow-options > summary { cursor: pointer; font-weight: 600; font-size: 14px; }
.follow-options-body { display: flex; flex-direction: column; gap: 12px; margin-top: 12px; }
.following-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.following-list { list-style: none; margin: 12px 0 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.following-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 8px 0; border-bottom: 1px solid rgba(255, 255, 255, 0.05); }
.following-info { display: flex; flex-direction: column; flex: 1 1 160px; min-width: 0; }
.following-name { font-weight: 600; color: inherit; text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.following-name:hover { text-decoration: underline; }
.following-sync { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; font-size: 13px; }
.visibility-badge { font-size: 12px; }
</style>
```

- [ ] **Step 8: Run it to pass**

Run: `npx vitest run tests/component/LibrarySourceSection.test.ts tests/unit/librarySources.test.ts` — Expected: PASS.

- [ ] **Step 9: Mutation-checks**

1. In `followResult`, change `if (await follow(target, raw)) results.value = [];` to `await follow(target, raw); results.value = [];` → `keeps the results after a failed add` must fail. Revert.
2. In `onToggleSync`, delete the line `input.checked = rowAfterReload(row).syncActive;` → `a failed pause … puts the switch back` must fail. Revert.
3. In `follow`, move `adding.value = true;` to after the `$fetch` call → `a quick double click … starts only one add` must fail. Revert.

- [ ] **Step 10: Full suite, build, commit**

Run: `npx vitest run` (all PASS; the old `tests/component/SettingsIngestSuivre.test.ts` still passes, the old tabs are untouched) and `npx nuxt build 2>&1 | tail -5`.

```bash
git add app/utils/librarySources.ts app/components/settings/LibrarySourceSection.vue tests/unit/librarySources.test.ts tests/component/LibrarySourceSection.test.ts
git commit -m "feat: shared Library source section with one-click Follow for music and podcasts" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Videos section — channel Follow with new-follow defaults, editable visibility, Edit options

**Files:**
- Modify: `app/utils/librarySources.ts` (append the videos config and `LIBRARY_SOURCES`)
- Modify: `app/components/settings/LibrarySourceSection.vue` (insertions listed below)
- Create: `app/components/settings/ChannelOptionsModal.vue`
- Test: `tests/unit/librarySources.test.ts` (append), `tests/component/LibraryVideosSection.test.ts` (new), `tests/component/ChannelOptionsModal.test.ts` (new)
- Port source (read only): `app/components/settings/SettingsDownloadsTab.vue` lines 58-118 (search), 307-379 and 633-704 (Track modal: options and ingest body), 522-599 (default folder); `app/components/channels/ChannelSettingsDrawer.vue` lines 22-75 and 128-166 (visibility select, options form).

**Interfaces:**
- Consumes (Task 3): `LibrarySourceConfig`, `FollowOptions`, `FollowedSource`, `channelResultView`, `youtubeChannelUrl`, `youtubeDirectTarget`, `plural`, `visibilityLabel`, `DEFAULT_SAVE_FOLDER`, `musicSource`, `podcastsSource`; `LibrarySourceSection` locals `options`, `rows`, `busyRowId`, `loadFollowing`, `toast`, `rowAfterReload`. Routes: `POST /api/admin/downloader/ingest` (`{ url, download_videos, download_shorts, download_lives, date_after?, sync_status, visibility, custom_save_path? }`), `GET /api/channels` (`channels: [{ id, title, avatar_url, sync_status, visibility, completed_count, total_count }]`), `GET /api/channels/:id` (`{ channel: { download_videos, download_shorts, download_lives, date_after: 'YYYYMMDD'|null, custom_save_path } }`), `PUT /api/admin/channels/:id/visibility`, `PUT /api/admin/channels/:id/options`, `GET|POST /api/admin/downloader/default-dir` (`{ path }`), `POST /api/admin/channels/:id/pause|sync`, `POST /api/admin/downloader/sync-all`.
- Produces: `channelSavePath(folder: string, title: string): string | null`; `videosSource: LibrarySourceConfig`; `LIBRARY_SOURCES: Record<SourceKind, LibrarySourceConfig>`; `ChannelOptionsModal.vue` props `{ channelId: string | null; channelName: string }`, emits `close`, `saved`; extra test ids in the section: `option-videos`, `option-shorts`, `option-lives`, `option-date-after`, `option-save-folder`, `save-default-folder`, `edit-options-{id}`; `visibility-{id}` becomes a `<select>` when `config.visibilityUrl` is set; modal test ids `channel-options-form`, `opt-videos`, `opt-shorts`, `opt-lives`, `opt-date`, `opt-folder`, `opt-save`.

Behaviour decisions (resolving the spec against the code): a video Follow sends `sync_status: 'downloading'` (the old modal sent `'active'`, a value the worker ignores, and compensated with `start_sync`, which re-synced **every** channel); `start_sync` is no longer sent because `ingestUrl` starts the worker itself for a `'downloading'` channel. The per-channel folder is `<save folder>/<channel title with \/:*?"<>| replaced by _>` exactly as the old modal; for a pasted URL (no title yet) `custom_save_path` is omitted so the server default applies. The old "Default Server Downloads Folder" form moves into Videos → Options for new follows as "Save folder" + "Save as default".

- [ ] **Step 1: Append failing unit tests**

Append to `tests/unit/librarySources.test.ts`:

```ts
import { videosSource, channelSavePath, LIBRARY_SOURCES } from '../../app/utils/librarySources';

describe('channelSavePath', () => {
  it('joins the folder and a cleaned channel title', () => {
    expect(channelSavePath('/data/videos', 'My Channel')).toBe('/data/videos/My Channel');
    expect(channelSavePath('/data/videos/', 'A/B: C?')).toBe('/data/videos/A_B_ C_');
    expect(channelSavePath('', 'X')).toBeNull();
    expect(channelSavePath('/d', '  ')).toBeNull();
  });
});

describe('videosSource', () => {
  const raw = { id: 'UC1', handle: '/@chan', title: 'My Channel' };

  it('follows by channel id first', () => {
    expect(videosSource.followTarget(raw)).toBe('https://www.youtube.com/channel/UC1');
  });

  it('builds the ingest body with today\'s defaults', () => {
    const o = { ...defaultFollowOptions('videos'), saveFolder: '/data/videos' };
    expect(videosSource.buildIngestBody('https://www.youtube.com/channel/UC1', o, raw)).toEqual({
      url: 'https://www.youtube.com/channel/UC1',
      download_videos: true,
      download_shorts: false,
      download_lives: false,
      sync_status: 'downloading',
      visibility: 'public',
      custom_save_path: '/data/videos/My Channel',
    });
  });

  it('passes every option and omits the folder for a pasted URL', () => {
    const o = { ...defaultFollowOptions('videos'), autoSync: false, visibility: 'ultra_private' as const, downloadShorts: true, downloadLives: true, dateAfter: '2024-01-31' };
    expect(videosSource.buildIngestBody('https://www.youtube.com/@x', o, null)).toEqual({
      url: 'https://www.youtube.com/@x',
      download_videos: true,
      download_shorts: true,
      download_lives: true,
      date_after: '20240131',
      sync_status: 'paused',
      visibility: 'ultra_private',
    });
  });

  it('maps channels from /api/channels', () => {
    expect(videosSource.readFollowing({ channels: [
      { id: 'UC1', title: 'Chan', avatar_url: 'a.jpg', sync_status: 'downloading', visibility: 'private', completed_count: 12, total_count: 20 },
      { id: 'UC2', title: 'Old', avatar_url: null, sync_status: 'active', visibility: 'public', completed_count: 1, total_count: 1 },
    ] })).toEqual([
      { id: 'UC1', name: 'Chan', imageUrl: 'a.jpg', countLabel: '12 videos', syncActive: true, visibility: 'private', href: '/channels?id=UC1' },
      { id: 'UC2', name: 'Old', imageUrl: '', countLabel: '1 video', syncActive: false, visibility: 'public', href: '/channels?id=UC2' },
    ]);
  });

  it('uses the channel routes, including visibility', () => {
    expect(videosSource.pauseUrl('UC1')).toBe('/api/admin/channels/UC1/pause');
    expect(videosSource.syncUrl('UC1')).toBe('/api/admin/channels/UC1/sync');
    expect(videosSource.visibilityUrl?.('UC1')).toBe('/api/admin/channels/UC1/visibility');
    expect(videosSource.syncAllEndpoint).toBe('/api/admin/downloader/sync-all');
    expect(videosSource.hasVideoOptions).toBe(true);
  });

  it('LIBRARY_SOURCES maps each section to its config', () => {
    expect(LIBRARY_SOURCES.videos).toBe(videosSource);
    expect(LIBRARY_SOURCES.music).toBe(musicSource);
    expect(LIBRARY_SOURCES.podcasts).toBe(podcastsSource);
  });
});
```

(Move the new `import` line to the top of the file next to the existing import.)

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/unit/librarySources.test.ts`
Expected: FAIL — `videosSource`/`channelSavePath`/`LIBRARY_SOURCES` are not exported (`undefined`).

- [ ] **Step 3: Append to `app/utils/librarySources.ts`**

```ts
export function channelSavePath(folder: string, title: string): string | null {
  const base = folder.trim();
  const name = title.replace(/[\\/:*?"<>|]/g, '_').trim();
  if (!base || !name) return null;
  return `${base}/${name}`.replace(/\/+/g, '/');
}

export const videosSource: LibrarySourceConfig = {
  kind: 'videos',
  title: 'Videos',
  description: 'Follow YouTube channels. New videos are downloaded automatically.',
  searchPlaceholder: 'Channel name, YouTube URL or @handle',
  searchEndpoint: '/api/admin/downloader/search-channels',
  readSearchResults: (data) => (Array.isArray(data?.channels) ? data.channels : []),
  toResultView: channelResultView,
  followTarget: (raw) => youtubeChannelUrl(raw, 'id'),
  directTarget: youtubeDirectTarget,
  noTargetMessage: "This result has no channel address, so it can't be followed.",
  noResultsMessage: 'No channels found for this search.',
  ingestEndpoint: '/api/admin/downloader/ingest',
  buildIngestBody: (target, options, raw) => {
    const savePath = raw?.title ? channelSavePath(options.saveFolder, String(raw.title)) : null;
    return {
      url: target,
      download_videos: options.downloadVideos,
      download_shorts: options.downloadShorts,
      download_lives: options.downloadLives,
      ...(options.dateAfter ? { date_after: options.dateAfter.replace(/-/g, '') } : {}),
      sync_status: options.autoSync ? 'downloading' : 'paused',
      visibility: options.visibility || 'public',
      ...(savePath ? { custom_save_path: savePath } : {}),
    };
  },
  listEndpoint: '/api/channels',
  readFollowing: (data) => (Array.isArray(data?.channels) ? data.channels : []).map((c: any) => ({
    id: String(c.id),
    name: String(c.title ?? ''),
    imageUrl: c.avatar_url || '',
    countLabel: plural(Number(c.completed_count) || 0, 'video'),
    syncActive: c.sync_status === 'downloading',
    visibility: String(c.visibility || 'public'),
    href: `/channels?id=${enc(String(c.id))}`,
  })),
  emptyFollowingMessage: "You're not following any channel yet.",
  pauseUrl: (id) => `/api/admin/channels/${enc(id)}/pause`,
  syncUrl: (id) => `/api/admin/channels/${enc(id)}/sync`,
  syncAllEndpoint: '/api/admin/downloader/sync-all',
  syncAllStartedMessage: 'Sync started for every followed channel.',
  visibilityUrl: (id) => `/api/admin/channels/${enc(id)}/visibility`,
  hasVideoOptions: true,
};

export const LIBRARY_SOURCES: Record<SourceKind, LibrarySourceConfig> = {
  videos: videosSource,
  music: musicSource,
  podcasts: podcastsSource,
};
```

- [ ] **Step 4: Run the unit tests to pass**

Run: `npx vitest run tests/unit/librarySources.test.ts` — Expected: PASS.

- [ ] **Step 5: Write the failing modal test**

Create `tests/component/ChannelOptionsModal.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import ChannelOptionsModal from '../../app/components/settings/ChannelOptionsModal.vue';
import { useToast } from '../../app/composables/useToast';

let fetchMock: ReturnType<typeof vi.fn>;
let channel: any;
let failSave: boolean;

beforeEach(() => {
  channel = { id: 'UC1', download_videos: 1, download_shorts: 0, download_lives: 1, date_after: '20240131', custom_save_path: '/data/videos/Chan' };
  failSave = false;
  useToast().toasts.value = [];
  fetchMock = vi.fn(async (url: string, opts?: any) => {
    if (url === '/api/channels/UC1') return { channel: { ...channel } };
    if (url === '/api/admin/channels/UC1/options' && opts?.method === 'PUT') {
      if (failSave) throw Object.assign(new Error('x'), { data: { statusMessage: 'Disk full' } });
      return { success: true };
    }
    return {};
  });
  vi.stubGlobal('$fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const mountModal = async () => {
  const w = await mountSuspended(ChannelOptionsModal, { props: { channelId: 'UC1', channelName: 'Chan' } });
  await flushPromises();
  return w;
};
const val = (w: any, id: string) => w.find(`[data-testid="${id}"]`).element as HTMLInputElement;

describe('ChannelOptionsModal', () => {
  it('loads the channel options into the form', async () => {
    const w = await mountModal();
    expect(w.text()).toContain('Options for Chan');
    expect(val(w, 'opt-videos').checked).toBe(true);
    expect(val(w, 'opt-shorts').checked).toBe(false);
    expect(val(w, 'opt-lives').checked).toBe(true);
    expect(val(w, 'opt-date').value).toBe('2024-01-31');
    expect(val(w, 'opt-folder').value).toBe('/data/videos/Chan');
  });

  it('saves with PUT options and emits saved then close', async () => {
    const w = await mountModal();
    await w.find('[data-testid="opt-shorts"]').setValue(true);
    await w.find('[data-testid="opt-date"]').setValue('');
    await w.find('[data-testid="opt-folder"]').setValue('  ');
    await w.find('[data-testid="channel-options-form"]').trigger('submit');
    await flushPromises();
    const put = fetchMock.mock.calls.find(([u, o]) => u === '/api/admin/channels/UC1/options' && o?.method === 'PUT');
    expect(put![1].body).toEqual({ downloadVideos: true, downloadShorts: true, downloadLives: true, dateAfter: null, customSavePath: null });
    expect(w.emitted('saved')).toHaveLength(1);
    expect(w.emitted('close')).toHaveLength(1);
  });

  it('after a failed save, shows the error and reloads the form from the server', async () => {
    failSave = true;
    const w = await mountModal();
    await w.find('[data-testid="opt-shorts"]').setValue(true);
    await w.find('[data-testid="channel-options-form"]').trigger('submit');
    await flushPromises();
    expect(useToast().toasts.value.map((t) => t.message)).toContain('Disk full');
    expect(val(w, 'opt-shorts').checked).toBe(false);
    expect(w.emitted('saved')).toBeUndefined();
  });
});
```

- [ ] **Step 6: Run it to see it fail**

Run: `npx vitest run tests/component/ChannelOptionsModal.test.ts`
Expected: FAIL — cannot resolve `ChannelOptionsModal.vue`.

- [ ] **Step 7: Implement `app/components/settings/ChannelOptionsModal.vue`**

```vue
<template>
  <BaseModal :show="!!channelId" :title="`Options for ${channelName}`" @close="$emit('close')">
    <p v-if="loading" class="section-desc">Loading...</p>
    <p v-else-if="loadError" class="settings-error-msg">Couldn't load this channel's options.</p>
    <form v-else class="channel-options-form" data-testid="channel-options-form" @submit.prevent="save">
      <span class="form-label">Download</span>
      <div class="channel-options-checks">
        <label class="checkbox-container"><input v-model="form.downloadVideos" type="checkbox" data-testid="opt-videos" /><span class="checkmark"></span>Videos</label>
        <label class="checkbox-container"><input v-model="form.downloadShorts" type="checkbox" data-testid="opt-shorts" /><span class="checkmark"></span>Shorts</label>
        <label class="checkbox-container"><input v-model="form.downloadLives" type="checkbox" data-testid="opt-lives" /><span class="checkmark"></span>Live recordings</label>
      </div>
      <p class="section-desc">Turning a type off also removes its videos that are still queued.</p>

      <div class="form-group">
        <label class="form-label" for="channel-opt-date">Only videos published after (optional)</label>
        <input id="channel-opt-date" v-model="form.dateAfter" type="date" class="form-input" data-testid="opt-date" />
      </div>

      <div class="form-group">
        <label class="form-label" for="channel-opt-folder">Save folder (leave empty for the default)</label>
        <input id="channel-opt-folder" v-model="form.customSavePath" type="text" class="form-input" data-testid="opt-folder" />
      </div>

      <div class="channel-options-actions">
        <button type="button" class="btn btn-secondary" @click="$emit('close')">Cancel</button>
        <button type="submit" class="btn btn-primary" :disabled="saving" data-testid="opt-save">{{ saving ? 'Saving...' : 'Save' }}</button>
      </div>
    </form>
  </BaseModal>
</template>

<script setup lang="ts">
import { ref, reactive, watch } from 'vue';
import BaseModal from '~/components/BaseModal.vue';
import { useToast } from '~/composables/useToast';

const props = defineProps<{ channelId: string | null; channelName: string }>();
const emit = defineEmits<{ close: []; saved: [] }>();

const toast = useToast();
const loading = ref(false);
const loadError = ref(false);
const saving = ref(false);
const form = reactive({ downloadVideos: true, downloadShorts: false, downloadLives: false, dateAfter: '', customSavePath: '' });

function toInputDate(value: unknown): string {
  return typeof value === 'string' && /^\d{8}$/.test(value)
    ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
    : '';
}

async function load(id: string) {
  loading.value = true;
  loadError.value = false;
  try {
    const data = await $fetch<any>(`/api/channels/${encodeURIComponent(id)}`);
    const c = data?.channel ?? {};
    form.downloadVideos = Number(c.download_videos) === 1;
    form.downloadShorts = Number(c.download_shorts) === 1;
    form.downloadLives = Number(c.download_lives) === 1;
    form.dateAfter = toInputDate(c.date_after);
    form.customSavePath = c.custom_save_path || '';
  } catch {
    loadError.value = true;
  } finally {
    loading.value = false;
  }
}

watch(() => props.channelId, (id) => { if (id) load(id); }, { immediate: true });

async function save() {
  const id = props.channelId;
  if (!id) return;
  saving.value = true;
  try {
    await $fetch(`/api/admin/channels/${encodeURIComponent(id)}/options`, {
      method: 'PUT',
      body: {
        downloadVideos: form.downloadVideos,
        downloadShorts: form.downloadShorts,
        downloadLives: form.downloadLives,
        dateAfter: form.dateAfter || null,
        customSavePath: form.customSavePath.trim() || null,
      },
    });
    toast.success('Channel options saved.');
    emit('saved');
    emit('close');
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Could not save the channel options.');
    // Show what the server actually kept.
    await load(id);
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
.channel-options-form { display: flex; flex-direction: column; gap: 12px; }
.channel-options-checks { display: flex; gap: 16px; flex-wrap: wrap; }
.channel-options-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 8px; }
</style>
```

- [ ] **Step 8: Run it to pass**

Run: `npx vitest run tests/component/ChannelOptionsModal.test.ts` — Expected: PASS.

- [ ] **Step 9: Write the failing Videos section test**

Create `tests/component/LibraryVideosSection.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import LibrarySourceSection from '../../app/components/settings/LibrarySourceSection.vue';
import { videosSource } from '../../app/utils/librarySources';
import { useToast } from '../../app/composables/useToast';

let fetchMock: ReturnType<typeof vi.fn>;
let searchPayload: any;
let channels: any[];
let failVisibility: boolean;
let failDefaultDir: boolean;
let serverDefaultDir: string;

const calls = (url: string, method?: string) => fetchMock.mock.calls.filter(([u, o]) => u === url && (method ? o?.method === method : !o?.method));
const toastMessages = () => useToast().toasts.value.map((t) => t.message);

beforeEach(() => {
  searchPayload = {};
  channels = [{ id: 'UC9', title: 'Followed', avatar_url: '', sync_status: 'downloading', visibility: 'public', completed_count: 4, total_count: 9 }];
  failVisibility = false;
  failDefaultDir = false;
  serverDefaultDir = '/data/videos';
  useToast().toasts.value = [];
  fetchMock = vi.fn(async (url: string, opts?: any) => {
    if (url === '/api/admin/downloader/search-channels') return searchPayload;
    if (url === '/api/channels') return { channels };
    if (url === '/api/channels/UC9') return { channel: { id: 'UC9', download_videos: 1, download_shorts: 0, download_lives: 0, date_after: null, custom_save_path: null } };
    if (url === '/api/admin/downloader/default-dir' && !opts?.method) return { path: serverDefaultDir };
    if (url === '/api/admin/downloader/default-dir' && opts?.method === 'POST') {
      if (failDefaultDir) throw Object.assign(new Error('x'), { data: { statusMessage: 'Folder is not writable' } });
      serverDefaultDir = opts.body.path;
      return { success: true };
    }
    if (url === '/api/admin/channels/UC9/visibility' && opts?.method === 'PUT') {
      if (failVisibility) throw Object.assign(new Error('x'), { data: { statusMessage: 'Denied' } });
      channels = channels.map((c) => ({ ...c, visibility: opts.body.visibility }));
      return { success: true };
    }
    if (url === '/api/admin/downloader/ingest' && opts?.method === 'POST') return { success: true, message: 'ok' };
    return {};
  });
  vi.stubGlobal('$fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const mountVideos = async () => {
  const w = await mountSuspended(LibrarySourceSection, { props: { config: videosSource } });
  await flushPromises();
  return w;
};

async function search(w: any) {
  await w.find('[data-testid="follow-search-input"]').setValue('chan');
  await w.find('[data-testid="follow-search-form"]').trigger('submit');
  await flushPromises();
}

describe('LibrarySourceSection — Videos', () => {
  it('pre-fills the save folder from the server default', async () => {
    const w = await mountVideos();
    expect((w.find('[data-testid="option-save-folder"]').element as HTMLInputElement).value).toBe('/data/videos');
  });

  it('follows a channel in one click with today\'s defaults (no Track modal)', async () => {
    searchPayload = { channels: [{ id: 'UC1', handle: '/@my', title: 'My Channel' }] };
    const w = await mountVideos();
    await search(w);
    await w.find('[data-testid="follow-result-0"]').trigger('click');
    await flushPromises();
    const post = calls('/api/admin/downloader/ingest', 'POST');
    expect(post).toHaveLength(1);
    expect(post[0][1].body).toEqual({
      url: 'https://www.youtube.com/channel/UC1',
      download_videos: true,
      download_shorts: false,
      download_lives: false,
      sync_status: 'downloading',
      visibility: 'public',
      custom_save_path: '/data/videos/My Channel',
    });
    expect(w.find('[data-testid="follow-result-0"]').exists()).toBe(false);
  });

  it('applies every option for new follows', async () => {
    searchPayload = { channels: [{ id: 'UC1', title: 'My Channel' }] };
    const w = await mountVideos();
    await search(w);
    await w.find('[data-testid="option-auto-sync"]').setValue(false);
    await w.find('[data-testid="option-visibility"]').setValue('private');
    await w.find('[data-testid="option-shorts"]').setValue(true);
    await w.find('[data-testid="option-lives"]').setValue(true);
    await w.find('[data-testid="option-videos"]').setValue(false);
    await w.find('[data-testid="option-date-after"]').setValue('2024-01-31');
    await w.find('[data-testid="option-save-folder"]').setValue('/mnt/yt');
    await w.find('[data-testid="follow-result-0"]').trigger('click');
    await flushPromises();
    expect(calls('/api/admin/downloader/ingest', 'POST')[0][1].body).toEqual({
      url: 'https://www.youtube.com/channel/UC1',
      download_videos: false,
      download_shorts: true,
      download_lives: true,
      date_after: '20240131',
      sync_status: 'paused',
      visibility: 'private',
      custom_save_path: '/mnt/yt/My Channel',
    });
  });

  it('lists followed channels with an editable visibility select', async () => {
    const w = await mountVideos();
    const select = w.find('[data-testid="visibility-UC9"]');
    expect(select.element.tagName).toBe('SELECT');
    expect((select.element as HTMLSelectElement).value).toBe('public');
    expect(w.find('[data-testid="following-UC9"]').text()).toContain('4 videos');
    await select.setValue('private');
    await flushPromises();
    const put = calls('/api/admin/channels/UC9/visibility', 'PUT');
    expect(put).toHaveLength(1);
    expect(put[0][1].body).toEqual({ visibility: 'private' });
    expect((w.find('[data-testid="visibility-UC9"]').element as HTMLSelectElement).value).toBe('private');
  });

  it('a failed visibility change toasts and puts the select back to the server value', async () => {
    failVisibility = true;
    const w = await mountVideos();
    const select = w.find('[data-testid="visibility-UC9"]');
    await select.setValue('ultra_private');
    await flushPromises();
    expect(toastMessages()).toContain('Denied');
    expect((select.element as HTMLSelectElement).value).toBe('public');
  });

  it('Edit options opens the channel options editor', async () => {
    const w = await mountVideos();
    expect(w.find('[data-testid="channel-options-form"]').exists()).toBe(false);
    await w.find('[data-testid="edit-options-UC9"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="channel-options-form"]').exists()).toBe(true);
    expect(calls('/api/channels/UC9')).toHaveLength(1);
  });

  it('Save as default posts the folder; a failure puts the server value back', async () => {
    const w = await mountVideos();
    await w.find('[data-testid="option-save-folder"]').setValue('/new/place');
    await w.find('[data-testid="save-default-folder"]').trigger('click');
    await flushPromises();
    expect(calls('/api/admin/downloader/default-dir', 'POST')[0][1].body).toEqual({ path: '/new/place' });

    failDefaultDir = true;
    await w.find('[data-testid="option-save-folder"]').setValue('/readonly');
    await w.find('[data-testid="save-default-folder"]').trigger('click');
    await flushPromises();
    expect(toastMessages()).toContain('Folder is not writable');
    expect((w.find('[data-testid="option-save-folder"]').element as HTMLInputElement).value).toBe('/new/place');
  });

  it('music and podcast sections keep a read-only badge and no video options', async () => {
    const { musicSource } = await import('../../app/utils/librarySources');
    const w = await mountSuspended(LibrarySourceSection, { props: { config: musicSource } });
    expect(w.find('[data-testid="option-videos"]').exists()).toBe(false);
    expect(w.find('[data-testid="save-default-folder"]').exists()).toBe(false);
  });
});
```

- [ ] **Step 10: Run it to see it fail**

Run: `npx vitest run tests/component/LibraryVideosSection.test.ts`
Expected: FAIL — e.g. `option-save-folder` not found / `visibility-UC9` is a `SPAN`.

- [ ] **Step 11: Extend `LibrarySourceSection.vue`**

(a) In the "Options for new follows" body, immediately after the visibility `<div class="form-group">…</div>`, insert:

```html
        <template v-if="config.hasVideoOptions">
          <div class="form-group">
            <span class="form-label">Download</span>
            <div class="follow-options-checks">
              <label class="checkbox-container"><input v-model="options.downloadVideos" type="checkbox" data-testid="option-videos" /><span class="checkmark"></span>Videos</label>
              <label class="checkbox-container"><input v-model="options.downloadShorts" type="checkbox" data-testid="option-shorts" /><span class="checkmark"></span>Shorts</label>
              <label class="checkbox-container"><input v-model="options.downloadLives" type="checkbox" data-testid="option-lives" /><span class="checkmark"></span>Live recordings</label>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label" for="follow-date-after">Only videos published after (optional)</label>
            <input id="follow-date-after" v-model="options.dateAfter" type="date" class="form-input" data-testid="option-date-after" />
          </div>
          <div class="form-group">
            <label class="form-label" for="follow-save-folder">Save folder</label>
            <div class="input-action-row">
              <input id="follow-save-folder" v-model="options.saveFolder" type="text" class="form-input" data-testid="option-save-folder" />
              <button type="button" class="btn btn-secondary-dark btn-sm" :disabled="savingDefaultFolder" data-testid="save-default-folder" @click="saveDefaultFolder">
                {{ savingDefaultFolder ? 'Saving...' : 'Save as default' }}
              </button>
            </div>
            <p class="section-desc">Each new channel gets its own folder inside this one.</p>
          </div>
        </template>
```

(b) In each Following row, replace the line `<span class="badge visibility-badge" :data-testid="`visibility-${row.id}`">{{ visibilityLabel(row.visibility) }}</span>` with:

```html
          <select
            v-if="config.visibilityUrl"
            class="form-select following-visibility"
            :value="row.visibility"
            :disabled="busyRowId === row.id"
            :data-testid="`visibility-${row.id}`"
            @change="onVisibilityChange(row, $event)"
          >
            <option value="public">Public</option>
            <option value="private">Private</option>
            <option value="ultra_private">Ultra private</option>
          </select>
          <span v-else class="badge visibility-badge" :data-testid="`visibility-${row.id}`">{{ visibilityLabel(row.visibility) }}</span>
          <button
            v-if="config.hasVideoOptions"
            type="button"
            class="btn btn-secondary-dark btn-xs"
            :data-testid="`edit-options-${row.id}`"
            @click="editingRow = row"
          >Edit options</button>
```

(c) Just before the closing `</details>` of the root, insert:

```html
    <ChannelOptionsModal
      v-if="config.hasVideoOptions"
      :channel-id="editingRow?.id ?? null"
      :channel-name="editingRow?.name ?? ''"
      @close="editingRow = null"
      @saved="loadFollowing"
    />
```

(d) Script: add the imports `import ChannelOptionsModal from '~/components/settings/ChannelOptionsModal.vue';` and add `DEFAULT_SAVE_FOLDER` to the existing `~/utils/librarySources` import. Add after `const syncingAll = ref(false);`:

```ts
const editingRow = ref<FollowedSource | null>(null);
const savingDefaultFolder = ref(false);

async function loadDefaultFolder() {
  try {
    const data = await $fetch<{ path?: string }>('/api/admin/downloader/default-dir');
    options.saveFolder = data?.path || DEFAULT_SAVE_FOLDER;
  } catch {
    options.saveFolder = DEFAULT_SAVE_FOLDER;
  }
}

async function saveDefaultFolder() {
  const path = options.saveFolder.trim();
  if (!path) {
    toast.error('Enter a folder first.');
    return;
  }
  savingDefaultFolder.value = true;
  try {
    await $fetch('/api/admin/downloader/default-dir', { method: 'POST', body: { path } });
    toast.success('Default save folder updated.');
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Could not save the default folder.');
    await loadDefaultFolder();
  } finally {
    savingDefaultFolder.value = false;
  }
}

async function onVisibilityChange(row: FollowedSource, event: Event) {
  const select = event.target as HTMLSelectElement;
  const visibility = select.value;
  const url = props.config.visibilityUrl;
  if (!url) return;
  busyRowId.value = row.id;
  try {
    await $fetch(url(row.id), { method: 'PUT', body: { visibility } });
    toast.success(`${row.name} is now ${visibilityLabel(visibility).toLowerCase()}.`);
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Could not change the visibility.');
  } finally {
    await loadFollowing();
    // One-way binding: put the select back to what the server kept.
    select.value = rowAfterReload(row).visibility;
    busyRowId.value = null;
  }
}
```

Replace the `onMounted` block with:

```ts
onMounted(() => {
  loadFollowing();
  if (props.config.hasVideoOptions) loadDefaultFolder();
});
```

Add to `<style scoped>`: `.follow-options-checks { display: flex; gap: 16px; flex-wrap: wrap; }` and `.following-visibility { width: auto; min-width: 120px; }`.

- [ ] **Step 12: Run the tests to pass**

Run: `npx vitest run tests/component/LibraryVideosSection.test.ts tests/component/LibrarySourceSection.test.ts tests/component/ChannelOptionsModal.test.ts tests/unit/librarySources.test.ts` — Expected: PASS.

- [ ] **Step 13: Mutation-checks**

1. Delete `select.value = rowAfterReload(row).visibility;` → `a failed visibility change … puts the select back` must fail. Revert.
2. In `ChannelOptionsModal.save`, delete `await load(id);` → `after a failed save … reloads the form` must fail. Revert.
3. In `videosSource.buildIngestBody`, change `'downloading'` to `'active'` → `follows a channel in one click with today's defaults` must fail. Revert.

- [ ] **Step 14: Full suite, build, commit**

Run: `npx vitest run` and `npx nuxt build 2>&1 | tail -5`.

```bash
git add app/utils/librarySources.ts app/components/settings/LibrarySourceSection.vue app/components/settings/ChannelOptionsModal.vue tests/unit/librarySources.test.ts tests/component/LibraryVideosSection.test.ts tests/component/ChannelOptionsModal.test.ts
git commit -m "feat: Videos library section with one-click Follow, channel visibility and options" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `LibraryTab.vue` with `?section=` deep link; switch Library over

**Files:**
- Create: `app/components/settings/LibraryTab.vue`
- Modify: `app/pages/settings.vue` — the content block written in Task 2 (the `<div class="settings-content">` children) and the two `activeTab.value !== 'library'` checks in `runMusicPolling`/`runPodcastPolling`; add one import
- Test: `tests/component/LibraryTab.test.ts` (new)

**Interfaces:**
- Consumes: `LIBRARY_SOURCES` (Task 4), `LIBRARY_SECTIONS`, `LibrarySection` (Task 2), `LibrarySourceSection` props `{ config, open }` (Task 3); `settings.vue` refs `activeTab`, `librarySection` (Task 2).
- Produces: `LibraryTab.vue` props `{ section: LibrarySection | null }`; renders three `LibrarySourceSection` in the order videos, music, podcasts; with a section only that one is open and it is scrolled into view; with `null` all three are open. Interim: the Downloads tab renders the three old tabs stacked (`SettingsDownloadsTab`, `SettingsMusicTab`, `SettingsPodcastsTab`) so concurrency, schedules, clips and the music/podcast queues stay reachable until Task 9.

- [ ] **Step 1: Write the failing test**

Create `tests/component/LibraryTab.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import LibraryTab from '../../app/components/settings/LibraryTab.vue';

let scrolled: string[];

beforeEach(() => {
  vi.stubGlobal('$fetch', vi.fn(async () => ({})));
  scrolled = [];
  Element.prototype.scrollIntoView = vi.fn(function (this: Element) { scrolled.push(this.id); });
});
afterEach(() => vi.unstubAllGlobals());

const order = (w: any) => w.findAll('[data-testid^="library-section-"]').map((s: any) => s.attributes('data-testid'));
const isOpen = (w: any, kind: string) => w.find(`[data-testid="library-section-${kind}"]`).attributes('open') !== undefined;

describe('LibraryTab', () => {
  it('shows Videos, Music and Podcasts in that order, all open', async () => {
    const w = await mountSuspended(LibraryTab, { props: { section: null } });
    expect(order(w)).toEqual(['library-section-videos', 'library-section-music', 'library-section-podcasts']);
    expect(['videos', 'music', 'podcasts'].map((k) => isOpen(w, k))).toEqual([true, true, true]);
    expect(w.text()).toContain('Library');
  });

  it('opens and scrolls to the requested section only', async () => {
    const w = await mountSuspended(LibraryTab, { props: { section: 'music' }, attachTo: document.body });
    await flushPromises();
    expect(['videos', 'music', 'podcasts'].map((k) => isOpen(w, k))).toEqual([false, true, false]);
    expect(scrolled).toContain('library-music');
    w.unmount();
  });

  it('follows a section change', async () => {
    const w = await mountSuspended(LibraryTab, { props: { section: 'music' }, attachTo: document.body });
    await w.setProps({ section: 'podcasts' });
    await flushPromises();
    expect(['videos', 'music', 'podcasts'].map((k) => isOpen(w, k))).toEqual([false, false, true]);
    expect(scrolled).toContain('library-podcasts');
    w.unmount();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/component/LibraryTab.test.ts`
Expected: FAIL — cannot resolve `LibraryTab.vue`.

- [ ] **Step 3: Implement `app/components/settings/LibraryTab.vue`**

```vue
<template>
  <div class="tab-pane library-tab">
    <div class="downloads-header-panel glass-panel">
      <div class="header-text">
        <h2>Library</h2>
        <p>Choose what YouKeep follows. New videos, tracks and episodes from everything you follow are downloaded automatically.</p>
      </div>
    </div>

    <LibrarySourceSection
      v-for="kind in LIBRARY_SECTIONS"
      :key="kind"
      :config="LIBRARY_SOURCES[kind]"
      :open="openSection === null || openSection === kind"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, onMounted } from 'vue';
import LibrarySourceSection from '~/components/settings/LibrarySourceSection.vue';
import { LIBRARY_SOURCES } from '~/utils/librarySources';
import { LIBRARY_SECTIONS, type LibrarySection } from '~/utils/settingsTabs';

const props = defineProps<{ section: LibrarySection | null }>();

const openSection = ref<LibrarySection | null>(props.section);

function scrollToSection(section: LibrarySection | null) {
  if (!section) return;
  nextTick(() => {
    document.getElementById(`library-${section}`)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  });
}

watch(() => props.section, (section) => {
  openSection.value = section;
  scrollToSection(section);
});

onMounted(() => scrollToSection(props.section));
</script>
```

- [ ] **Step 4: Run it to pass**

Run: `npx vitest run tests/component/LibraryTab.test.ts` — Expected: PASS.

- [ ] **Step 5: Mutation-check**

Change `:open="openSection === null || openSection === kind"` to `:open="true"` → `opens and scrolls to the requested section only` must fail. Revert.

- [ ] **Step 6: Switch `settings.vue` to `LibraryTab`**

In `app/pages/settings.vue` replace the content children written in Task 2:

```html
        <div v-if="activeTab === 'library' && isAdmin" class="tab-pane">
          <SettingsMusicTab id="library-music" />
          <SettingsPodcastsTab id="library-podcasts" />
        </div>
        <SettingsDownloadsTab v-if="activeTab === 'downloads' && isAdmin" />
```

with:

```html
        <LibraryTab v-if="activeTab === 'library' && isAdmin" :section="librarySection" />
        <!-- Interim until the unified Downloads tab lands: the old per-type tabs, stacked. -->
        <div v-if="activeTab === 'downloads' && isAdmin" class="tab-pane">
          <SettingsDownloadsTab />
          <SettingsMusicTab />
          <SettingsPodcastsTab />
        </div>
```

Add `import LibraryTab from '~/components/settings/LibraryTab.vue';` to the script imports, and in `runMusicPolling` and `runPodcastPolling` change `activeTab.value !== 'library'` to `activeTab.value !== 'downloads'` (the music/podcast queues now live on the Downloads tab).

- [ ] **Step 7: Full suite, build, commit**

Run: `npx vitest run` and `npx nuxt build 2>&1 | tail -5`.

```bash
git add app/components/settings/LibraryTab.vue app/pages/settings.vue tests/component/LibraryTab.test.ts
git commit -m "feat: Library tab with Videos, Music and Podcasts sections and section deep links" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Downloads aggregator — `allDownloads.ts` helpers and `useAllDownloads`

**Files:**
- Create: `app/utils/allDownloads.ts`
- Create: `app/composables/useAllDownloads.ts`
- Modify: `app/composables/useDownloadsQueue.ts` (add `queueError`: lines 5-8 state block, 98-108 `fetchQueue`, 120 return)
- Modify: `app/composables/useMusicQueue.ts` (add `musicQueueTotal`, `musicQueueError`: lines 2-6, 12-24, 26-28)
- Modify: `app/composables/usePodcastQueue.ts` (add `podcastQueueTotal`, `podcastQueueError`: same lines)
- Test: `tests/unit/allDownloads.test.ts` (new), `tests/component/useAllDownloads.test.ts` (new)

**Interfaces:**
- Consumes: queue routes (`/api/admin/downloader/queue` items have `channel_title`, music items `artist_name`, podcast items `show_title`; all have `id, title, download_status, download_progress, download_speed, download_eta, last_error`; each response has `queueTotal`, `failedCount`, `isPaused`) — music/podcast `queueTotal` from Task 1.
- Produces (`app/utils/allDownloads.ts`):
  - `type DownloadKind = 'video' | 'music' | 'podcast'`; `type DownloadFilter = 'all' | DownloadKind`; `type QueueStatus = 'downloading' | 'pending' | 'failed'`; `type QueueAction = 'prioritize' | 'cancel' | 'retry'`
  - `interface QueueItem { kind; id; title; source; status; progress: number; speed: string | null; eta: string | null; lastError: string | null }`
  - `interface TypeQueueState { items: QueueItem[]; total: number; failedCount: number; isPaused: boolean; error: boolean }`
  - constants `QUEUE_CAP = 100`, `DOWNLOAD_KINDS`, `KIND_LABELS` (Videos/Music/Podcasts), `KIND_PILL` (Video/Music/Podcast), `KIND_API_BASE`, `STATUS_LABELS` (Downloading/Queued/Failed), `ACTION_LABELS`, `FILTERS`
  - functions `toQueueItem(kind, raw)`, `emptyTypeState()`, `mergeQueues(byKind)`, `filterCounts(states)`, `visibleQueue(states, filter)`, `capNotice(shown, total)`, `typeSummary(state)`, `nextPollDelay(states)`, `queueActionsFor(item)`, `queueActionRequest(item, action)`
- Produces (`useAllDownloads()`): `{ filter: Ref<DownloadFilter>, states: ComputedRef<Record<DownloadKind, TypeQueueState>>, counts: ComputedRef<Record<DownloadFilter, number>>, visible: ComputedRef<{ items: QueueItem[]; total: number }>, notice: ComputedRef<string | null>, progressFor(item): number, refreshAll(): Promise<void>, startPolling(): void, stopPolling(): void }`.
- Produces (composables): `useDownloadsQueue().queueError: Ref<boolean>` (key `settings_downloads_queue_error`); `useMusicQueue().musicQueueTotal` (`settings_music_queue_total`), `.musicQueueError` (`settings_music_queue_error`); `usePodcastQueue().podcastQueueTotal` (`settings_podcast_queue_total`), `.podcastQueueError` (`settings_podcast_queue_error`).

- [ ] **Step 1: Write the failing unit test**

Create `tests/unit/allDownloads.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  toQueueItem, mergeQueues, filterCounts, visibleQueue, capNotice, typeSummary, nextPollDelay,
  queueActionsFor, queueActionRequest, emptyTypeState, QUEUE_CAP,
  type QueueItem, type DownloadKind, type TypeQueueState,
} from '../../app/utils/allDownloads';

const item = (kind: DownloadKind, id: string, status: QueueItem['status']): QueueItem =>
  ({ kind, id, title: id, source: 's', status, progress: 0, speed: null, eta: null, lastError: null });

const state = (items: QueueItem[], extra: Partial<TypeQueueState> = {}): TypeQueueState =>
  ({ ...emptyTypeState(), items, total: items.length, ...extra });

describe('toQueueItem', () => {
  it('reads the source field of each type and normalises the status', () => {
    expect(toQueueItem('video', { id: 'v1', title: 'V', download_status: 'downloading', download_progress: 42.5, download_speed: '1MiB/s', download_eta: '00:10', channel_title: 'Chan' }))
      .toEqual({ kind: 'video', id: 'v1', title: 'V', source: 'Chan', status: 'downloading', progress: 42.5, speed: '1MiB/s', eta: '00:10', lastError: null });
    expect(toQueueItem('music', { id: 'm1', title: 'M', download_status: 'failed', last_error: 'x', artist_name: 'Art' }).source).toBe('Art');
    expect(toQueueItem('podcast', { id: 'p1', title: 'P', download_status: 'pending', show_title: 'Show' }).source).toBe('Show');
    expect(toQueueItem('music', { id: 'm2', download_status: 'weird' }).status).toBe('pending');
  });
});

describe('mergeQueues', () => {
  it('puts every downloading item first, then queued items interleaved by type, then failed', () => {
    const merged = mergeQueues({
      video: [item('video', 'v-p1', 'pending'), item('video', 'v-f1', 'failed'), item('video', 'v-p2', 'pending'), item('video', 'v-p3', 'pending')],
      music: [item('music', 'm-d1', 'downloading'), item('music', 'm-p1', 'pending')],
      podcast: [item('podcast', 'p-f1', 'failed'), item('podcast', 'p-p1', 'pending'), item('podcast', 'p-d1', 'downloading')],
    });
    expect(merged.map((i) => i.id)).toEqual([
      'm-d1', 'p-d1',
      'v-p1', 'm-p1', 'p-p1', 'v-p2', 'v-p3',
      'v-f1', 'p-f1',
    ]);
  });
});

describe('filterCounts / visibleQueue / capNotice', () => {
  const states = {
    video: state(Array.from({ length: 100 }, (_, i) => item('video', `v${i}`, 'pending')), { total: 150 }),
    music: state([item('music', 'm1', 'downloading')]),
    podcast: state([], { total: 0 }),
  };

  it('counts per type from the route totals and sums them for All', () => {
    expect(filterCounts(states)).toEqual({ all: 151, video: 150, music: 1, podcast: 0 });
  });

  it('caps the All view at 100 with downloading first and reports the full total', () => {
    const v = visibleQueue(states, 'all');
    expect(v.items).toHaveLength(QUEUE_CAP);
    expect(v.items[0]!.id).toBe('m1');
    expect(v.total).toBe(151);
    expect(capNotice(v.items.length, v.total)).toBe('Showing the first 100 of 151');
  });

  it('filters by type', () => {
    expect(visibleQueue(states, 'music').items.map((i) => i.id)).toEqual(['m1']);
    expect(visibleQueue(states, 'music').total).toBe(1);
    expect(visibleQueue(states, 'podcast').items).toEqual([]);
  });

  it('shows no notice when everything is visible', () => {
    expect(capNotice(3, 3)).toBeNull();
    expect(capNotice(0, 0)).toBeNull();
  });
});

describe('typeSummary / nextPollDelay', () => {
  it('derives downloading, queued and failed counts', () => {
    const s = state([item('video', 'a', 'downloading'), item('video', 'b', 'pending'), item('video', 'c', 'failed')], { total: 40, failedCount: 5 });
    expect(typeSummary(s)).toEqual({ downloading: 1, queued: 34, failed: 5 });
    expect(typeSummary(state([], { total: 0, failedCount: 2 }))).toEqual({ downloading: 0, queued: 0, failed: 2 });
  });

  it('polls every 500 ms while anything downloads, else every 3 s', () => {
    const idle = { video: state([item('video', 'a', 'pending')]), music: state([]), podcast: state([]) };
    expect(nextPollDelay(idle)).toBe(3000);
    expect(nextPollDelay({ ...idle, podcast: state([item('podcast', 'p', 'downloading')]) })).toBe(500);
  });
});

describe('queue actions', () => {
  it('offers Prioritize for queued videos, Cancel for videos and music, Retry for failed podcasts', () => {
    expect(queueActionsFor(item('video', 'v', 'pending'))).toEqual(['prioritize', 'cancel']);
    expect(queueActionsFor(item('video', 'v', 'downloading'))).toEqual(['cancel']);
    expect(queueActionsFor(item('music', 'm', 'failed'))).toEqual(['cancel']);
    expect(queueActionsFor(item('podcast', 'p', 'failed'))).toEqual(['retry']);
    expect(queueActionsFor(item('podcast', 'p', 'pending'))).toEqual([]);
  });

  it('maps each action to the existing route', () => {
    expect(queueActionRequest(item('video', 'v1', 'pending'), 'prioritize')).toEqual({ url: '/api/admin/downloader/prioritize', body: { videoId: 'v1' } });
    expect(queueActionRequest(item('video', 'v1', 'pending'), 'cancel')).toEqual({ url: '/api/admin/downloader/cancel', body: { videoId: 'v1' } });
    expect(queueActionRequest(item('music', 'm1', 'pending'), 'cancel')).toEqual({ url: '/api/admin/music/tracks/m1/cancel' });
    expect(queueActionRequest(item('podcast', 'p1', 'failed'), 'retry')).toEqual({ url: '/api/admin/podcasts/retry-failed', body: { episodeId: 'p1' } });
    expect(() => queueActionRequest(item('podcast', 'p1', 'pending'), 'cancel')).toThrow();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/unit/allDownloads.test.ts`
Expected: FAIL — cannot resolve `../../app/utils/allDownloads`.

- [ ] **Step 3: Implement `app/utils/allDownloads.ts`**

```ts
export type DownloadKind = 'video' | 'music' | 'podcast';
export type DownloadFilter = 'all' | DownloadKind;
export type QueueStatus = 'downloading' | 'pending' | 'failed';
export type QueueAction = 'prioritize' | 'cancel' | 'retry';

export interface QueueItem {
  kind: DownloadKind;
  id: string;
  title: string;
  source: string;
  status: QueueStatus;
  progress: number;
  speed: string | null;
  eta: string | null;
  lastError: string | null;
}

export interface TypeQueueState {
  items: QueueItem[];
  /** Everything downloading + queued + failed for this type (the route's queueTotal). */
  total: number;
  failedCount: number;
  isPaused: boolean;
  /** True when the last refresh of this type's queue failed. */
  error: boolean;
}

export const QUEUE_CAP = 100;
export const DOWNLOAD_KINDS: readonly DownloadKind[] = ['video', 'music', 'podcast'];
export const KIND_LABELS: Record<DownloadKind, string> = { video: 'Videos', music: 'Music', podcast: 'Podcasts' };
export const KIND_PILL: Record<DownloadKind, string> = { video: 'Video', music: 'Music', podcast: 'Podcast' };
export const KIND_API_BASE: Record<DownloadKind, string> = {
  video: '/api/admin/downloader',
  music: '/api/admin/music',
  podcast: '/api/admin/podcasts',
};
export const STATUS_LABELS: Record<QueueStatus, string> = { downloading: 'Downloading', pending: 'Queued', failed: 'Failed' };
export const ACTION_LABELS: Record<QueueAction, string> = { prioritize: 'Prioritize', cancel: 'Cancel', retry: 'Retry' };
export const FILTERS: ReadonlyArray<{ key: DownloadFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'video', label: 'Videos' },
  { key: 'music', label: 'Music' },
  { key: 'podcast', label: 'Podcasts' },
];

const SOURCE_FIELD: Record<DownloadKind, string> = { video: 'channel_title', music: 'artist_name', podcast: 'show_title' };

export function toQueueItem(kind: DownloadKind, raw: any): QueueItem {
  const s = raw?.download_status;
  const status: QueueStatus = s === 'downloading' || s === 'failed' ? s : 'pending';
  return {
    kind,
    id: String(raw?.id ?? ''),
    title: String(raw?.title ?? ''),
    source: String(raw?.[SOURCE_FIELD[kind]] ?? ''),
    status,
    progress: Number(raw?.download_progress) || 0,
    speed: raw?.download_speed || null,
    eta: raw?.download_eta || null,
    lastError: raw?.last_error || null,
  };
}

export function emptyTypeState(): TypeQueueState {
  return { items: [], total: 0, failedCount: 0, isPaused: false, error: false };
}

/** Downloading (any type) first, then queued items round-robin by type, then failed. Each type keeps its route order. */
export function mergeQueues(byKind: Record<DownloadKind, QueueItem[]>): QueueItem[] {
  const pick = (status: QueueStatus) => DOWNLOAD_KINDS.map((k) => byKind[k].filter((i) => i.status === status));
  const downloading = pick('downloading').flat();
  const pendingLists = pick('pending');
  const pending: QueueItem[] = [];
  const longest = Math.max(0, ...pendingLists.map((list) => list.length));
  for (let i = 0; i < longest; i++) {
    for (const list of pendingLists) {
      if (i < list.length) pending.push(list[i]!);
    }
  }
  const failed = pick('failed').flat();
  return [...downloading, ...pending, ...failed];
}

export function filterCounts(states: Record<DownloadKind, TypeQueueState>): Record<DownloadFilter, number> {
  const video = states.video.total;
  const music = states.music.total;
  const podcast = states.podcast.total;
  return { all: video + music + podcast, video, music, podcast };
}

export function visibleQueue(states: Record<DownloadKind, TypeQueueState>, filter: DownloadFilter): { items: QueueItem[]; total: number } {
  const byKind = {} as Record<DownloadKind, QueueItem[]>;
  for (const k of DOWNLOAD_KINDS) byKind[k] = filter === 'all' || filter === k ? states[k].items : [];
  return { items: mergeQueues(byKind).slice(0, QUEUE_CAP), total: filterCounts(states)[filter] };
}

export function capNotice(shown: number, total: number): string | null {
  return total > shown ? `Showing the first ${shown} of ${total}` : null;
}

export function typeSummary(state: TypeQueueState): { downloading: number; queued: number; failed: number } {
  const downloading = state.items.filter((i) => i.status === 'downloading').length;
  return { downloading, queued: Math.max(0, state.total - state.failedCount - downloading), failed: state.failedCount };
}

export function nextPollDelay(states: Record<DownloadKind, TypeQueueState>): number {
  return DOWNLOAD_KINDS.some((k) => states[k].items.some((i) => i.status === 'downloading')) ? 500 : 3000;
}

export function queueActionsFor(item: QueueItem): QueueAction[] {
  if (item.kind === 'video') return item.status === 'pending' ? ['prioritize', 'cancel'] : ['cancel'];
  if (item.kind === 'music') return ['cancel'];
  // Podcasts have no cancel route; failed episodes can be retried one by one.
  return item.status === 'failed' ? ['retry'] : [];
}

export function queueActionRequest(item: QueueItem, action: QueueAction): { url: string; body?: Record<string, string> } {
  if (item.kind === 'video' && action === 'prioritize') return { url: '/api/admin/downloader/prioritize', body: { videoId: item.id } };
  if (item.kind === 'video' && action === 'cancel') return { url: '/api/admin/downloader/cancel', body: { videoId: item.id } };
  if (item.kind === 'music' && action === 'cancel') return { url: `/api/admin/music/tracks/${encodeURIComponent(item.id)}/cancel` };
  if (item.kind === 'podcast' && action === 'retry') return { url: '/api/admin/podcasts/retry-failed', body: { episodeId: item.id } };
  throw new Error(`Unsupported queue action "${action}" for ${item.kind}`);
}
```

- [ ] **Step 4: Run it to pass**

Run: `npx vitest run tests/unit/allDownloads.test.ts` — Expected: PASS.

- [ ] **Step 5: Mutation-check**

In `mergeQueues`, replace the round-robin loop with `const pending = pendingLists.flat();` → the `mergeQueues` test must fail (order becomes `v-p1, v-p2, v-p3, m-p1, p-p1`). Revert.

- [ ] **Step 6: Add error flags and totals to the three composables**

`app/composables/useDownloadsQueue.ts`: after line 8 (`isPaused`) add
`const queueError = useState<boolean>('settings_downloads_queue_error', () => false);`
In `fetchQueue` set `queueError.value = false;` after `isPaused.value = …` (inside `try`) and `queueError.value = true;` as the first line of `catch` (keep the `console.error`). Add `queueError` to the returned object (line 120: `queue, queueTotal, failedCount, isPaused, queueError, smoothProgress, activeDownloadCount,`).

`app/composables/useMusicQueue.ts` — full new content:

```ts
export function useMusicQueue() {
  const musicQueue = useState<any[]>('settings_music_queue', () => []);
  const musicQueueTotal = useState<number>('settings_music_queue_total', () => 0);
  const musicQueueError = useState<boolean>('settings_music_queue_error', () => false);
  const musicHistory = useState<any[]>('settings_music_history', () => []);
  const musicArtists = useState<any[]>('settings_music_artists', () => []);
  const musicIsPaused = useState<boolean>('settings_music_is_paused', () => false);
  const musicFailedCount = useState<number>('settings_music_failed_count', () => 0);

  const musicActiveDownloadCount = computed(() => {
    return musicQueue.value.filter((t: any) => t.download_status === 'downloading').length;
  });

  const fetchMusicQueue = async () => {
    try {
      const data = await $fetch<any>('/api/admin/music/queue');
      musicQueue.value = data.queue || [];
      musicQueueTotal.value = typeof data.queueTotal === 'number' ? data.queueTotal : musicQueue.value.length;
      musicHistory.value = data.history || [];
      musicArtists.value = data.artists || [];
      musicIsPaused.value = data.isPaused || false;
      musicFailedCount.value = data.failedCount || 0;
      musicQueueError.value = false;
    } catch (err) {
      musicQueueError.value = true;
      console.error('Failed to fetch music queue:', err);
    }
  };

  return {
    musicQueue, musicQueueTotal, musicQueueError, musicHistory, musicArtists, musicIsPaused, musicFailedCount, musicActiveDownloadCount,
    fetchMusicQueue,
  };
}
```

`app/composables/usePodcastQueue.ts` — the same shape with `podcastQueue`, `podcastQueueTotal` (`settings_podcast_queue_total`), `podcastQueueError` (`settings_podcast_queue_error`), `podcastHistory`, `podcastShows` (from `data.shows`), `podcastIsPaused`, `podcastFailedCount`, `podcastActiveDownloadCount`, `fetchPodcastQueue` (route `/api/admin/podcasts/queue`, log `'Failed to fetch podcast queue:'`).

- [ ] **Step 7: Write the failing composable test**

Create `tests/component/useAllDownloads.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useAllDownloads } from '../../app/composables/useAllDownloads';

const STATE_DEFAULTS: Record<string, any> = {
  settings_downloads_queue: [], settings_downloads_queue_total: 0, settings_downloads_failed_count: 0,
  settings_downloads_is_paused: false, settings_downloads_queue_error: false, settings_downloads_smooth_progress: {},
  settings_music_queue: [], settings_music_queue_total: 0, settings_music_failed_count: 0,
  settings_music_is_paused: false, settings_music_queue_error: false,
  settings_podcast_queue: [], settings_podcast_queue_total: 0, settings_podcast_failed_count: 0,
  settings_podcast_is_paused: false, settings_podcast_queue_error: false,
  settings_downloads_filter: 'all',
};

let payloads: Record<string, any>;
let failing: Set<string>;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  for (const [key, value] of Object.entries(STATE_DEFAULTS)) useState(key).value = structuredClone(value);
  failing = new Set();
  payloads = {
    '/api/admin/downloader/queue': { queue: [{ id: 'v1', title: 'V1', download_status: 'pending', channel_title: 'Chan' }], queueTotal: 1, failedCount: 0, isPaused: false },
    '/api/admin/music/queue': { queue: [{ id: 'm1', title: 'M1', download_status: 'downloading', download_progress: 50, artist_name: 'Art' }], queueTotal: 1, failedCount: 0, isPaused: true },
    '/api/admin/podcasts/queue': { queue: [{ id: 'p1', title: 'P1', download_status: 'failed', show_title: 'Show' }], queueTotal: 1, failedCount: 1, isPaused: false },
  };
  fetchMock = vi.fn(async (url: string) => {
    if (failing.has(url)) throw new Error('down');
    return payloads[url] ?? {};
  });
  vi.stubGlobal('$fetch', fetchMock);
});

afterEach(() => {
  useAllDownloads().stopPolling();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useAllDownloads', () => {
  it('merges the three queues: downloading first, then queued, then failed', async () => {
    const d = useAllDownloads();
    await d.refreshAll();
    expect(d.visible.value.items.map((i) => `${i.kind}:${i.id}`)).toEqual(['music:m1', 'video:v1', 'podcast:p1']);
    expect(d.counts.value).toEqual({ all: 3, video: 1, music: 1, podcast: 1 });
    expect(d.states.value.music.isPaused).toBe(true);
    expect(d.notice.value).toBeNull();
  });

  it('applies the filter', async () => {
    const d = useAllDownloads();
    await d.refreshAll();
    d.filter.value = 'podcast';
    expect(d.visible.value.items.map((i) => i.id)).toEqual(['p1']);
  });

  it('reports the cap notice from the route totals', async () => {
    payloads['/api/admin/downloader/queue'] = {
      queue: Array.from({ length: 100 }, (_, i) => ({ id: `v${i}`, title: 'x', download_status: 'pending', channel_title: 'c' })),
      queueTotal: 250, failedCount: 0, isPaused: false,
    };
    const d = useAllDownloads();
    await d.refreshAll();
    expect(d.notice.value).toBe('Showing the first 100 of 252');
    d.filter.value = 'video';
    expect(d.notice.value).toBe('Showing the first 100 of 250');
  });

  it('marks only the failing type as in error and keeps the others working', async () => {
    failing.add('/api/admin/music/queue');
    const d = useAllDownloads();
    await d.refreshAll();
    expect(d.states.value.music.error).toBe(true);
    expect(d.states.value.video.error).toBe(false);
    expect(d.states.value.podcast.error).toBe(false);
    expect(d.visible.value.items.map((i) => i.id)).toEqual(['v1', 'p1']);
  });

  it('runs ONE loop: 500 ms while something downloads, 3 s otherwise, and stops cleanly', async () => {
    vi.useFakeTimers();
    const d = useAllDownloads();
    const queueCalls = () => fetchMock.mock.calls.filter(([u]) => u === '/api/admin/downloader/queue').length;

    d.startPolling();
    d.startPolling(); // a second start must not create a second loop
    await vi.advanceTimersByTimeAsync(0);
    expect(queueCalls()).toBe(1);

    await vi.advanceTimersByTimeAsync(500); // music m1 is downloading → fast loop
    expect(queueCalls()).toBe(2);

    payloads['/api/admin/music/queue'] = { queue: [], queueTotal: 0, failedCount: 0, isPaused: false };
    await vi.advanceTimersByTimeAsync(500);
    expect(queueCalls()).toBe(3);
    await vi.advanceTimersByTimeAsync(2999); // now idle → 3 s
    expect(queueCalls()).toBe(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(queueCalls()).toBe(4);

    d.stopPolling();
    await vi.advanceTimersByTimeAsync(10000);
    expect(queueCalls()).toBe(4);
  });
});
```

- [ ] **Step 8: Run it to see it fail**

Run: `npx vitest run tests/component/useAllDownloads.test.ts`
Expected: FAIL — cannot resolve `../../app/composables/useAllDownloads`.

- [ ] **Step 9: Implement `app/composables/useAllDownloads.ts`**

```ts
import { computed } from 'vue';
import { useDownloadsQueue } from '~/composables/useDownloadsQueue';
import { useMusicQueue } from '~/composables/useMusicQueue';
import { usePodcastQueue } from '~/composables/usePodcastQueue';
import {
  toQueueItem, filterCounts, visibleQueue, capNotice, nextPollDelay,
  type DownloadFilter, type DownloadKind, type QueueItem, type TypeQueueState,
} from '~/utils/allDownloads';

// Module-level so that every caller shares the single polling loop.
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let polling = false;

export function useAllDownloads() {
  const video = useDownloadsQueue();
  const music = useMusicQueue();
  const podcast = usePodcastQueue();
  const filter = useState<DownloadFilter>('settings_downloads_filter', () => 'all');

  const states = computed<Record<DownloadKind, TypeQueueState>>(() => ({
    video: {
      items: video.queue.value.map((raw) => toQueueItem('video', raw)),
      total: video.queueTotal.value,
      failedCount: video.failedCount.value,
      isPaused: video.isPaused.value,
      error: video.queueError.value,
    },
    music: {
      items: music.musicQueue.value.map((raw) => toQueueItem('music', raw)),
      total: music.musicQueueTotal.value,
      failedCount: music.musicFailedCount.value,
      isPaused: music.musicIsPaused.value,
      error: music.musicQueueError.value,
    },
    podcast: {
      items: podcast.podcastQueue.value.map((raw) => toQueueItem('podcast', raw)),
      total: podcast.podcastQueueTotal.value,
      failedCount: podcast.podcastFailedCount.value,
      isPaused: podcast.podcastIsPaused.value,
      error: podcast.podcastQueueError.value,
    },
  }));

  const counts = computed(() => filterCounts(states.value));
  const visible = computed(() => visibleQueue(states.value, filter.value));
  const notice = computed(() => capNotice(visible.value.items.length, visible.value.total));

  // Videos keep their smooth (interpolated) progress bar.
  function progressFor(item: QueueItem): number {
    if (item.kind === 'video') {
      const smooth = video.smoothProgress.value[item.id];
      if (smooth !== undefined) return smooth;
    }
    return item.progress;
  }

  async function refreshAll() {
    // Each fetch* catches its own error and flags its type, so one failure never blocks the others.
    await Promise.all([video.fetchQueue(), music.fetchMusicQueue(), podcast.fetchPodcastQueue()]);
  }

  async function tick() {
    if (!polling) return;
    await refreshAll();
    if (!polling) return;
    pollTimer = setTimeout(tick, nextPollDelay(states.value));
  }

  function startPolling() {
    if (polling) return;
    polling = true;
    tick();
  }

  function stopPolling() {
    polling = false;
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
    video.stopSmoothProgressLoop();
  }

  return { filter, states, counts, visible, notice, progressFor, refreshAll, startPolling, stopPolling };
}
```

- [ ] **Step 10: Run the tests to pass**

Run: `npx vitest run tests/component/useAllDownloads.test.ts tests/unit/allDownloads.test.ts` — Expected: PASS.

- [ ] **Step 11: Mutation-checks**

1. Remove `if (polling) return;` from `startPolling` → the ONE-loop test must fail (2 calls after the first flush). Revert.
2. In `useMusicQueue`, delete `musicQueueError.value = true;` → `marks only the failing type as in error` must fail. Revert.

- [ ] **Step 12: Full suite, build, commit**

Run: `npx vitest run` and `npx nuxt build 2>&1 | tail -5`.

```bash
git add app/utils/allDownloads.ts app/composables/useAllDownloads.ts app/composables/useDownloadsQueue.ts app/composables/useMusicQueue.ts app/composables/usePodcastQueue.ts tests/unit/allDownloads.test.ts tests/component/useAllDownloads.test.ts
git commit -m "feat: aggregate the video, music and podcast queues with one polling loop" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Queue card, queue list and per-type card

**Files:**
- Create: `app/components/settings/DownloadQueueCard.vue`, `app/components/settings/DownloadQueueList.vue`, `app/components/settings/DownloadTypeCard.vue`
- Test: `tests/component/DownloadQueue.test.ts` (new), `tests/component/DownloadTypeCard.test.ts` (new)
- Port source (read only): queue card markup `app/components/settings/SettingsDownloadsTab.vue` lines 254-300 (the three copies in the music/podcast tabs are the same markup); header controls lines 10-51 and handlers 412-487 (pause/resume, concurrency, retry, clear queue); the music/podcast equivalents (`SettingsMusicTab.vue` lines 20-52, 389-426, 549-560).

**Interfaces:**
- Consumes (Task 6): `QueueItem`, `QueueAction`, `TypeQueueState`, `DownloadKind`, `KIND_LABELS`, `KIND_PILL`, `KIND_API_BASE`, `STATUS_LABELS`, `ACTION_LABELS`, `queueActionsFor`, `typeSummary`. Routes `GET|POST {base}/concurrency` (`{ maxConcurrentDownloads }`), `POST {base}/pause`, `POST {base}/resume`, `POST {base}/retry-failed`, `POST /api/admin/downloader/clear-queue`.
- Produces:
  - `DownloadQueueCard.vue` props `{ item: QueueItem; progress: number }`, emits `action: [QueueAction]`; test ids `queue-item-{kind}-{id}`, `queue-item-status`, `queue-action-{action}`.
  - `DownloadQueueList.vue` props `{ items: QueueItem[]; progressFor: (item: QueueItem) => number }`, emits `action: [QueueItem, QueueAction]`; empty state test id `queue-empty` with the text "Nothing is downloading".
  - `DownloadTypeCard.vue` props `{ kind: DownloadKind; state: TypeQueueState }`, emits `changed: []` (parent refreshes the queues); test ids `type-card-{kind}`, `type-card-state`, `type-card-error`, `type-card-summary`, `pause-toggle`, `concurrency-input`, `concurrency-save`, `retry-failed`, `clear-queue`.

- [ ] **Step 1: Write the failing queue tests**

Create `tests/component/DownloadQueue.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import DownloadQueueCard from '../../app/components/settings/DownloadQueueCard.vue';
import DownloadQueueList from '../../app/components/settings/DownloadQueueList.vue';
import type { QueueItem } from '../../app/utils/allDownloads';

const item = (over: Partial<QueueItem>): QueueItem => ({
  kind: 'video', id: 'v1', title: 'A video', source: 'Chan', status: 'pending',
  progress: 0, speed: null, eta: null, lastError: null, ...over,
});

describe('DownloadQueueCard', () => {
  it('shows the type pill, title, source and the Queued status', async () => {
    const w = await mountSuspended(DownloadQueueCard, { props: { item: item({}), progress: 0 } });
    expect(w.text()).toContain('Video');
    expect(w.text()).toContain('A video');
    expect(w.text()).toContain('Chan');
    expect(w.find('[data-testid="queue-item-status"]').text()).toBe('Queued');
  });

  it('shows progress, speed and ETA while downloading', async () => {
    const w = await mountSuspended(DownloadQueueCard, {
      props: { item: item({ kind: 'music', status: 'downloading', speed: '2MiB/s', eta: '00:30' }), progress: 41.6 },
    });
    expect(w.text()).toContain('42%');
    expect(w.text()).toContain('Speed: 2MiB/s');
    expect(w.text()).toContain('ETA: 00:30');
    expect(w.find('[data-testid="queue-item-status"]').text()).toBe('Downloading');
  });

  it('shows the error of a failed item', async () => {
    const w = await mountSuspended(DownloadQueueCard, { props: { item: item({ kind: 'podcast', status: 'failed', lastError: 'HTTP 404' }), progress: 0 } });
    expect(w.text()).toContain('Error: HTTP 404');
    expect(w.find('[data-testid="queue-item-status"]').text()).toBe('Failed');
  });

  it('offers the actions of each type and emits them', async () => {
    const v = await mountSuspended(DownloadQueueCard, { props: { item: item({}), progress: 0 } });
    expect(v.findAll('[data-testid^="queue-action-"]').map((b: any) => b.text())).toEqual(['Prioritize', 'Cancel']);
    await v.find('[data-testid="queue-action-prioritize"]').trigger('click');
    expect(v.emitted('action')).toEqual([['prioritize']]);

    const p = await mountSuspended(DownloadQueueCard, { props: { item: item({ kind: 'podcast', status: 'pending' }), progress: 0 } });
    expect(p.findAll('[data-testid^="queue-action-"]')).toHaveLength(0);
  });
});

describe('DownloadQueueList', () => {
  it('shows "Nothing is downloading" when empty', async () => {
    const w = await mountSuspended(DownloadQueueList, { props: { items: [], progressFor: () => 0 } });
    expect(w.find('[data-testid="queue-empty"]').text()).toContain('Nothing is downloading');
  });

  it('renders one card per item, in order, and forwards actions with the item', async () => {
    const items = [item({ kind: 'music', id: 'm1', status: 'downloading' }), item({ id: 'v1' })];
    const w = await mountSuspended(DownloadQueueList, { props: { items, progressFor: (i: QueueItem) => (i.id === 'm1' ? 77 : 0) } });
    expect(w.findAll('[data-testid^="queue-item-"]').filter((c: any) => c.attributes('data-testid') !== 'queue-item-status').map((c: any) => c.attributes('data-testid')))
      .toEqual(['queue-item-music-m1', 'queue-item-video-v1']);
    expect(w.find('[data-testid="queue-item-music-m1"]').text()).toContain('77%');
    await w.find('[data-testid="queue-item-music-m1"] [data-testid="queue-action-cancel"]').trigger('click');
    expect(w.emitted('action')![0]).toEqual([items[0], 'cancel']);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/component/DownloadQueue.test.ts` — Expected: FAIL (components missing).

- [ ] **Step 3: Implement `DownloadQueueCard.vue` and `DownloadQueueList.vue`**

`app/components/settings/DownloadQueueCard.vue`:

```vue
<template>
  <div class="queue-card-premium" :data-testid="`queue-item-${item.kind}-${item.id}`">
    <div class="queue-card-details">
      <div class="queue-card-meta-main">
        <span class="type-pill" :class="`type-pill-${item.kind}`">{{ KIND_PILL[item.kind] }}</span>
        <h4 class="queue-card-title" :title="item.title">{{ item.title }}</h4>
        <span class="queue-card-channel-name">{{ item.source }}</span>
      </div>
      <span class="status-badge" :class="`status-${item.status}`" data-testid="queue-item-status">{{ STATUS_LABELS[item.status] }}</span>
    </div>

    <div class="queue-progress-container">
      <div class="progress-bar-glow-bg">
        <div class="progress-bar-glow-fill" :style="{ width: progress + '%' }"></div>
      </div>
      <span class="progress-percent-text">{{ Math.round(progress) }}%</span>
    </div>

    <div v-if="item.status === 'downloading'" class="queue-diagnostics-row">
      <span v-if="item.speed" class="diag-meta-spec">Speed: {{ item.speed }}</span>
      <span v-if="item.eta" class="diag-meta-spec">ETA: {{ item.eta }}</span>
    </div>

    <div v-if="item.status === 'failed' && item.lastError" class="queue-error-box">
      <strong>Error:</strong> {{ item.lastError }}
    </div>

    <div v-if="actions.length > 0" class="queue-card-action-bar">
      <button
        v-for="action in actions"
        :key="action"
        type="button"
        class="btn-action-premium"
        :class="{ 'btn-action-danger': action === 'cancel' }"
        :data-testid="`queue-action-${action}`"
        @click="$emit('action', action)"
      >{{ ACTION_LABELS[action] }}</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { KIND_PILL, STATUS_LABELS, ACTION_LABELS, queueActionsFor, type QueueItem, type QueueAction } from '~/utils/allDownloads';

const props = defineProps<{ item: QueueItem; progress: number }>();
defineEmits<{ action: [QueueAction] }>();

const actions = computed(() => queueActionsFor(props.item));
</script>

<style scoped>
.type-pill { display: inline-block; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; padding: 2px 6px; border-radius: 6px; margin-bottom: 4px; background: rgba(255, 255, 255, 0.08); }
.type-pill-video { color: #c4b5fd; }
.type-pill-music { color: #93c5fd; }
.type-pill-podcast { color: #86efac; }
</style>
```

`app/components/settings/DownloadQueueList.vue`:

```vue
<template>
  <div v-if="items.length === 0" class="queue-empty-state" data-testid="queue-empty">
    <h4>Nothing is downloading</h4>
    <p>New items appear here as soon as something you follow has new content.</p>
  </div>
  <div v-else class="queue-list-premium" data-testid="queue-list">
    <DownloadQueueCard
      v-for="item in items"
      :key="`${item.kind}-${item.id}`"
      :item="item"
      :progress="progressFor(item)"
      @action="(action: QueueAction) => $emit('action', item, action)"
    />
  </div>
</template>

<script setup lang="ts">
import DownloadQueueCard from '~/components/settings/DownloadQueueCard.vue';
import type { QueueItem, QueueAction } from '~/utils/allDownloads';

defineProps<{ items: QueueItem[]; progressFor: (item: QueueItem) => number }>();
defineEmits<{ action: [QueueItem, QueueAction] }>();
</script>
```

- [ ] **Step 4: Run it to pass**

Run: `npx vitest run tests/component/DownloadQueue.test.ts` — Expected: PASS.

- [ ] **Step 5: Write the failing type-card test**

Create `tests/component/DownloadTypeCard.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import DownloadTypeCard from '../../app/components/settings/DownloadTypeCard.vue';
import { emptyTypeState, type TypeQueueState, type QueueItem } from '../../app/utils/allDownloads';
import { useToast } from '../../app/composables/useToast';

let fetchMock: ReturnType<typeof vi.fn>;
let serverConcurrency: number;
let failSave: boolean;

const posts = (url: string) => fetchMock.mock.calls.filter(([u, o]) => u === url && o?.method === 'POST');
const st = (over: Partial<TypeQueueState> = {}): TypeQueueState => ({ ...emptyTypeState(), ...over });
const dl = (id: string): QueueItem => ({ kind: 'music', id, title: id, source: 's', status: 'downloading', progress: 0, speed: null, eta: null, lastError: null });

beforeEach(() => {
  serverConcurrency = 3;
  failSave = false;
  useToast().toasts.value = [];
  fetchMock = vi.fn(async (url: string, opts?: any) => {
    if (url.endsWith('/concurrency') && !opts?.method) return { maxConcurrentDownloads: serverConcurrency };
    if (url.endsWith('/concurrency') && opts?.method === 'POST') {
      if (failSave) throw Object.assign(new Error('x'), { data: { statusMessage: 'Must be between 1 and 10' } });
      serverConcurrency = opts.body.maxConcurrentDownloads;
      return { success: true };
    }
    return { success: true };
  });
  vi.stubGlobal('$fetch', fetchMock);
  vi.stubGlobal('confirm', vi.fn(() => true));
});
afterEach(() => vi.unstubAllGlobals());

const mountCard = async (kind: 'video' | 'music' | 'podcast', state: TypeQueueState) => {
  const w = await mountSuspended(DownloadTypeCard, { props: { kind, state } });
  await flushPromises();
  return w;
};

describe('DownloadTypeCard', () => {
  it('shows the type, its state and a summary', async () => {
    const w = await mountCard('music', st({ items: [dl('a')], total: 12, failedCount: 2 }));
    expect(w.text()).toContain('Music');
    expect(w.find('[data-testid="type-card-state"]').text()).toBe('Active');
    expect(w.find('[data-testid="type-card-summary"]').text()).toBe('1 downloading · 9 queued');
    expect(w.find('[data-testid="pause-toggle"]').text()).toBe('Pause');
  });

  it('Pause and Resume call the type routes and ask for a refresh', async () => {
    const w = await mountCard('music', st());
    await w.find('[data-testid="pause-toggle"]').trigger('click');
    await flushPromises();
    expect(posts('/api/admin/music/pause')).toHaveLength(1);
    expect(w.emitted('changed')).toHaveLength(1);

    const p = await mountCard('podcast', st({ isPaused: true }));
    expect(p.find('[data-testid="type-card-state"]').text()).toBe('Paused');
    await p.find('[data-testid="pause-toggle"]').trigger('click');
    await flushPromises();
    expect(posts('/api/admin/podcasts/resume')).toHaveLength(1);
  });

  it('loads and saves the number of simultaneous downloads', async () => {
    const w = await mountCard('video', st());
    const input = w.find('[data-testid="concurrency-input"]');
    expect((input.element as HTMLInputElement).value).toBe('3');
    expect(w.text()).toContain('Simultaneous downloads');
    await input.setValue('5');
    await w.find('[data-testid="concurrency-save"]').trigger('click');
    await flushPromises();
    expect(posts('/api/admin/downloader/concurrency')[0][1].body).toEqual({ maxConcurrentDownloads: 5 });
  });

  it('after a failed save, puts the server value back', async () => {
    failSave = true;
    const w = await mountCard('music', st());
    const input = w.find('[data-testid="concurrency-input"]');
    await input.setValue('50');
    await w.find('[data-testid="concurrency-save"]').trigger('click');
    await flushPromises();
    expect(useToast().toasts.value.map((t) => t.message)).toContain('Must be between 1 and 10');
    expect((input.element as HTMLInputElement).value).toBe('3');
  });

  it('shows "N failed" with Retry only when there are failures', async () => {
    const none = await mountCard('podcast', st());
    expect(none.find('[data-testid="retry-failed"]').exists()).toBe(false);
    const w = await mountCard('podcast', st({ failedCount: 4, total: 4 }));
    expect(w.text()).toContain('4 failed');
    await w.find('[data-testid="retry-failed"]').trigger('click');
    await flushPromises();
    expect(posts('/api/admin/podcasts/retry-failed')).toHaveLength(1);
    expect(w.emitted('changed')).toHaveLength(1);
  });

  it('shows an error state when its queue could not be loaded', async () => {
    const w = await mountCard('music', st({ error: true }));
    expect(w.find('[data-testid="type-card-error"]').text()).toContain("Couldn't load the music queue");
  });

  it('offers Clear queue for videos only, after confirmation', async () => {
    const m = await mountCard('music', st({ total: 3 }));
    expect(m.find('[data-testid="clear-queue"]').exists()).toBe(false);
    const v = await mountCard('video', st({ total: 3 }));
    await v.find('[data-testid="clear-queue"]').trigger('click');
    await flushPromises();
    expect(posts('/api/admin/downloader/clear-queue')).toHaveLength(1);

    vi.stubGlobal('confirm', vi.fn(() => false));
    await v.find('[data-testid="clear-queue"]').trigger('click');
    await flushPromises();
    expect(posts('/api/admin/downloader/clear-queue')).toHaveLength(1);
  });
});
```

- [ ] **Step 6: Run it to see it fail**

Run: `npx vitest run tests/component/DownloadTypeCard.test.ts` — Expected: FAIL (component missing).

- [ ] **Step 7: Implement `app/components/settings/DownloadTypeCard.vue`**

```vue
<template>
  <div class="download-type-card glass-panel" :data-testid="`type-card-${kind}`">
    <div class="type-card-head">
      <h3>{{ KIND_LABELS[kind] }}</h3>
      <span :class="state.isPaused ? 'badge-paused-global' : 'badge-active-global'" data-testid="type-card-state">
        {{ state.isPaused ? 'Paused' : 'Active' }}
      </span>
    </div>

    <p v-if="state.error" class="settings-error-msg" data-testid="type-card-error">
      Couldn't load the {{ KIND_LABELS[kind].toLowerCase() }} queue. Retrying automatically.
    </p>
    <p class="section-desc" data-testid="type-card-summary">{{ summary.downloading }} downloading · {{ summary.queued }} queued</p>

    <div class="type-card-controls">
      <button type="button" class="btn" :class="state.isPaused ? 'btn-primary-glow' : 'btn-secondary-dark'" :disabled="toggling" data-testid="pause-toggle" @click="togglePause">
        {{ state.isPaused ? 'Resume' : 'Pause' }}
      </button>

      <div class="concurrency-control">
        <label :for="`concurrency-${kind}`" class="type-card-label">Simultaneous downloads</label>
        <input :id="`concurrency-${kind}`" v-model.number="concurrency" type="number" min="1" max="10" class="form-input type-card-number" data-testid="concurrency-input" />
        <button type="button" class="btn btn-secondary-dark btn-sm" :disabled="savingConcurrency" data-testid="concurrency-save" @click="saveConcurrency">
          {{ savingConcurrency ? 'Saving...' : 'Save' }}
        </button>
      </div>
    </div>

    <div v-if="state.failedCount > 0" class="type-card-failed">
      <span>{{ state.failedCount }} failed</span>
      <button type="button" class="btn btn-secondary-dark btn-sm" :disabled="retrying" data-testid="retry-failed" @click="retryFailed">
        {{ retrying ? 'Retrying...' : 'Retry' }}
      </button>
    </div>

    <button v-if="kind === 'video' && state.total > 0" type="button" class="btn btn-danger-outline btn-clean btn-sm" data-testid="clear-queue" @click="clearQueue">
      Clear queue
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useToast } from '~/composables/useToast';
import { KIND_LABELS, KIND_API_BASE, typeSummary, type DownloadKind, type TypeQueueState } from '~/utils/allDownloads';

const props = defineProps<{ kind: DownloadKind; state: TypeQueueState }>();
const emit = defineEmits<{ changed: [] }>();

const toast = useToast();
const base = KIND_API_BASE[props.kind];
const label = KIND_LABELS[props.kind];

const summary = computed(() => typeSummary(props.state));
const toggling = ref(false);
const concurrency = ref(2);
const savingConcurrency = ref(false);
const retrying = ref(false);

async function fetchConcurrency() {
  try {
    const data = await $fetch<{ maxConcurrentDownloads?: number }>(`${base}/concurrency`);
    concurrency.value = data?.maxConcurrentDownloads ?? 2;
  } catch (err) {
    console.error(`Failed to fetch ${props.kind} concurrency:`, err);
  }
}

async function saveConcurrency() {
  savingConcurrency.value = true;
  try {
    await $fetch(`${base}/concurrency`, { method: 'POST', body: { maxConcurrentDownloads: concurrency.value } });
    toast.success(`${label}: simultaneous downloads saved.`);
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Could not save the number of simultaneous downloads.');
    await fetchConcurrency();
  } finally {
    savingConcurrency.value = false;
  }
}

async function togglePause() {
  toggling.value = true;
  const resuming = props.state.isPaused;
  try {
    await $fetch(`${base}/${resuming ? 'resume' : 'pause'}`, { method: 'POST' });
    toast.success(resuming ? `${label} downloads resumed.` : `${label} downloads paused.`);
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Could not change the download state.');
  } finally {
    toggling.value = false;
    emit('changed');
  }
}

async function retryFailed() {
  retrying.value = true;
  try {
    await $fetch(`${base}/retry-failed`, { method: 'POST' });
    toast.success('Failed downloads queued again.');
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Retry failed.');
  } finally {
    retrying.value = false;
    emit('changed');
  }
}

async function clearQueue() {
  if (!confirm('Remove every queued, downloading and failed video from the queue? Videos already downloaded are kept.')) return;
  try {
    await $fetch('/api/admin/downloader/clear-queue', { method: 'POST' });
    toast.success('Video queue cleared.');
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Could not clear the queue.');
  } finally {
    emit('changed');
  }
}

onMounted(fetchConcurrency);
</script>

<style scoped>
.download-type-card { padding: 16px; display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.type-card-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.type-card-head h3 { margin: 0; font-size: 16px; font-weight: 700; }
.type-card-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.concurrency-control { display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.type-card-label { font-size: 13px; color: var(--text-secondary); }
.type-card-number { width: 64px; }
.type-card-failed { display: flex; align-items: center; justify-content: space-between; gap: 8px; color: var(--text-secondary); font-size: 13px; }
</style>
```

- [ ] **Step 8: Run the tests to pass**

Run: `npx vitest run tests/component/DownloadTypeCard.test.ts tests/component/DownloadQueue.test.ts` — Expected: PASS.

- [ ] **Step 9: Mutation-checks**

1. In `saveConcurrency`, delete `await fetchConcurrency();` → `after a failed save, puts the server value back` must fail. Revert.
2. In `DownloadTypeCard.vue`, remove `kind === 'video' && ` from the Clear queue `v-if` → `offers Clear queue for videos only` must fail. Revert.

- [ ] **Step 10: Full suite, build, commit**

Run: `npx vitest run` and `npx nuxt build 2>&1 | tail -5`.

```bash
git add app/components/settings/DownloadQueueCard.vue app/components/settings/DownloadQueueList.vue app/components/settings/DownloadTypeCard.vue tests/component/DownloadQueue.test.ts tests/component/DownloadTypeCard.test.ts
git commit -m "feat: shared queue card, queue list and per-type download card" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Downloads "Advanced" — schedules per type, SponsorBlock, music clips

**Files:**
- Create: `app/utils/schedulePresets.ts`, `app/components/settings/ScheduleForm.vue`, `app/components/settings/DownloadsAdvanced.vue`
- Test: `tests/unit/schedulePresets.test.ts` (new), `tests/component/DownloadsAdvanced.test.ts` (new)
- Port source (read only): `SettingsDownloadsTab.vue` lines 157-193 + 706-759 (video schedule), 197-226 + 527-567 (SponsorBlock); `SettingsMusicTab.vue` lines 3-12 + 312-336 (clips), 54-89 + 428-480 (music schedule); `SettingsPodcastsTab.vue` lines 43-78 + 390-445 (podcast schedule).

**Interfaces:**
- Consumes: `GET|POST /api/admin/downloader/schedule`, `/api/admin/music/schedule`, `/api/admin/podcasts/schedule` (`{ enabled, schedule }`); `GET|POST /api/admin/downloader/sponsorblock` (GET → `{ settings: Record<category, 'ignore'|'mark'|'remove'> }`, POST body = that record); `GET /api/settings/music-clips` (`{ enabled }`), `POST /api/admin/settings/music-clips` (`{ enabled }`).
- Produces: `type ScheduleKey`, `type SchedulePresets`, `VIDEO_SCHEDULE_PRESETS`, `MUSIC_SCHEDULE_PRESETS`, `PODCAST_SCHEDULE_PRESETS`, `presetForSchedule(presets, schedule): ScheduleKey | 'custom'`; `ScheduleForm.vue` props `{ title: string; endpoint: string; presets: SchedulePresets; dailyLabel: string; weeklyLabel: string; idPrefix: string }` (test ids `schedule-{idPrefix}`, `schedule-{idPrefix}-enabled`, select id `{idPrefix}-preset`, input id `{idPrefix}-cron`); `DownloadsAdvanced.vue` (no props; root `<details data-testid="downloads-advanced">`, collapsed; test ids `sponsorblock-form`, `music-clips-toggle`).

- [ ] **Step 1: Write the failing unit test**

Create `tests/unit/schedulePresets.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { VIDEO_SCHEDULE_PRESETS, MUSIC_SCHEDULE_PRESETS, PODCAST_SCHEDULE_PRESETS, presetForSchedule } from '../../app/utils/schedulePresets';

describe('schedule presets', () => {
  it('keep the times used today', () => {
    expect(VIDEO_SCHEDULE_PRESETS).toEqual({ hourly: '0 * * * *', twelve_hours: '0 */12 * * *', daily: '0 3 * * *', weekly: '0 3 * * 0' });
    expect(MUSIC_SCHEDULE_PRESETS.daily).toBe('30 3 * * *');
    expect(MUSIC_SCHEDULE_PRESETS.weekly).toBe('30 3 * * 0');
    expect(PODCAST_SCHEDULE_PRESETS.daily).toBe('0 4 * * *');
    expect(PODCAST_SCHEDULE_PRESETS.weekly).toBe('0 4 * * 0');
  });

  it('finds the preset of a schedule, else custom', () => {
    expect(presetForSchedule(MUSIC_SCHEDULE_PRESETS, '30 3 * * *')).toBe('daily');
    expect(presetForSchedule(MUSIC_SCHEDULE_PRESETS, '0 3 * * *')).toBe('custom');
    expect(presetForSchedule(VIDEO_SCHEDULE_PRESETS, '0 */12 * * *')).toBe('twelve_hours');
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/unit/schedulePresets.test.ts` — Expected: FAIL (module missing).

- [ ] **Step 3: Implement `app/utils/schedulePresets.ts`**

```ts
export type ScheduleKey = 'hourly' | 'twelve_hours' | 'daily' | 'weekly';
export type SchedulePresets = Record<ScheduleKey, string>;

export const VIDEO_SCHEDULE_PRESETS: SchedulePresets = {
  hourly: '0 * * * *', twelve_hours: '0 */12 * * *', daily: '0 3 * * *', weekly: '0 3 * * 0',
};
export const MUSIC_SCHEDULE_PRESETS: SchedulePresets = {
  hourly: '0 * * * *', twelve_hours: '0 */12 * * *', daily: '30 3 * * *', weekly: '30 3 * * 0',
};
// 4:00 AM matches the podcast_sync_cron_schedule default seeded in server/utils/db.ts.
export const PODCAST_SCHEDULE_PRESETS: SchedulePresets = {
  hourly: '0 * * * *', twelve_hours: '0 */12 * * *', daily: '0 4 * * *', weekly: '0 4 * * 0',
};

export function presetForSchedule(presets: SchedulePresets, schedule: string): ScheduleKey | 'custom' {
  const hit = (Object.keys(presets) as ScheduleKey[]).find((key) => presets[key] === schedule);
  return hit ?? 'custom';
}
```

- [ ] **Step 4: Run it to pass**

Run: `npx vitest run tests/unit/schedulePresets.test.ts` — Expected: PASS.

- [ ] **Step 5: Write the failing component test**

Create `tests/component/DownloadsAdvanced.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import DownloadsAdvanced from '../../app/components/settings/DownloadsAdvanced.vue';
import { useToast } from '../../app/composables/useToast';

let fetchMock: ReturnType<typeof vi.fn>;
let schedules: Record<string, { enabled: boolean; schedule: string }>;
let failSchedule: boolean;
let clipsEnabled: boolean;
let failClips: boolean;

const posts = (url: string) => fetchMock.mock.calls.filter(([u, o]) => u === url && o?.method === 'POST');
const toastMessages = () => useToast().toasts.value.map((t) => t.message);

beforeEach(() => {
  schedules = {
    '/api/admin/downloader/schedule': { enabled: true, schedule: '0 3 * * *' },
    '/api/admin/music/schedule': { enabled: true, schedule: '15 2 * * *' },
    '/api/admin/podcasts/schedule': { enabled: false, schedule: '0 4 * * *' },
  };
  failSchedule = false;
  clipsEnabled = false;
  failClips = false;
  useToast().toasts.value = [];
  fetchMock = vi.fn(async (url: string, opts?: any) => {
    if (schedules[url] && !opts?.method) return { ...schedules[url] };
    if (schedules[url] && opts?.method === 'POST') {
      if (failSchedule) throw Object.assign(new Error('x'), { data: { statusMessage: 'Invalid cron' } });
      schedules[url] = { ...opts.body };
      return { success: true };
    }
    if (url === '/api/admin/downloader/sponsorblock' && !opts?.method) return { settings: { sponsor: 'remove', intro: 'ignore', outro: 'ignore', selfpromo: 'mark', interaction: 'ignore', filler: 'ignore' } };
    if (url === '/api/admin/downloader/sponsorblock' && opts?.method === 'POST') return { success: true };
    if (url === '/api/settings/music-clips') return { enabled: clipsEnabled };
    if (url === '/api/admin/settings/music-clips' && opts?.method === 'POST') {
      if (failClips) throw Object.assign(new Error('x'), { data: { statusMessage: 'Not allowed' } });
      clipsEnabled = opts.body.enabled;
      return { success: true };
    }
    return {};
  });
  vi.stubGlobal('$fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const mountAdvanced = async () => {
  const w = await mountSuspended(DownloadsAdvanced);
  await flushPromises();
  return w;
};

describe('DownloadsAdvanced', () => {
  it('is a collapsed "Advanced" disclosure', async () => {
    const w = await mountAdvanced();
    const root = w.find('[data-testid="downloads-advanced"]');
    expect(root.element.tagName).toBe('DETAILS');
    expect(root.attributes('open')).toBeUndefined();
    expect(w.find('summary').text()).toContain('Advanced');
  });

  it('loads each schedule and selects its preset', async () => {
    const w = await mountAdvanced();
    expect((w.find('#video-preset').element as HTMLSelectElement).value).toBe('daily');
    expect((w.find('#music-preset').element as HTMLSelectElement).value).toBe('custom');
    expect((w.find('#music-cron').element as HTMLInputElement).value).toBe('15 2 * * *');
    expect(w.find('#podcast-preset').exists()).toBe(false); // podcast schedule is off
  });

  it('saves a schedule for its own type', async () => {
    const w = await mountAdvanced();
    await w.find('#video-preset').setValue('weekly');
    await w.find('[data-testid="schedule-video"]').trigger('submit');
    await flushPromises();
    expect(posts('/api/admin/downloader/schedule')[0][1].body).toEqual({ enabled: true, schedule: '0 3 * * 0' });
    expect(posts('/api/admin/music/schedule')).toHaveLength(0);
  });

  it('refuses an empty custom cron without calling the server', async () => {
    const w = await mountAdvanced();
    await w.find('#music-cron').setValue('  ');
    await w.find('[data-testid="schedule-music"]').trigger('submit');
    await flushPromises();
    expect(posts('/api/admin/music/schedule')).toHaveLength(0);
    expect(toastMessages()).toContain('Enter a cron expression.');
  });

  it('after a failed save, shows the error and reloads the saved schedule', async () => {
    failSchedule = true;
    const w = await mountAdvanced();
    await w.find('#video-preset').setValue('hourly');
    await w.find('[data-testid="schedule-video"]').trigger('submit');
    await flushPromises();
    expect(toastMessages()).toContain('Invalid cron');
    expect((w.find('#video-preset').element as HTMLSelectElement).value).toBe('daily');
  });

  it('saves the SponsorBlock choices', async () => {
    const w = await mountAdvanced();
    expect((w.find('#sb-sponsor').element as HTMLSelectElement).value).toBe('remove');
    await w.find('#sb-intro').setValue('mark');
    await w.find('[data-testid="sponsorblock-form"]').trigger('submit');
    await flushPromises();
    expect(posts('/api/admin/downloader/sponsorblock')[0][1].body).toMatchObject({ sponsor: 'remove', intro: 'mark', selfpromo: 'mark' });
  });

  it('turns music clips on, and puts the switch back when the server refuses', async () => {
    const w = await mountAdvanced();
    const toggle = w.find('[data-testid="music-clips-toggle"]');
    expect((toggle.element as HTMLInputElement).checked).toBe(false);
    await toggle.setValue(true);
    await flushPromises();
    expect(posts('/api/admin/settings/music-clips')[0][1].body).toEqual({ enabled: true });
    expect((toggle.element as HTMLInputElement).checked).toBe(true);

    failClips = true;
    await toggle.setValue(false);
    await flushPromises();
    expect(toastMessages()).toContain('Not allowed');
    expect((toggle.element as HTMLInputElement).checked).toBe(true);
  });
});
```

- [ ] **Step 6: Run it to see it fail**

Run: `npx vitest run tests/component/DownloadsAdvanced.test.ts` — Expected: FAIL (component missing).

- [ ] **Step 7: Implement `ScheduleForm.vue` and `DownloadsAdvanced.vue`**

`app/components/settings/ScheduleForm.vue`:

```vue
<template>
  <form class="policy-form-block schedule-form" :data-testid="`schedule-${idPrefix}`" @submit.prevent="save">
    <h4 class="results-header">{{ title }}</h4>
    <label class="checkbox-container">
      <input v-model="form.enabled" type="checkbox" :data-testid="`schedule-${idPrefix}-enabled`" />
      <span class="checkmark"></span>
      Sync automatically on a schedule
    </label>

    <div v-if="form.enabled" class="schedule-settings-row mt-2">
      <div class="form-group flex-1">
        <label class="form-label" :for="`${idPrefix}-preset`">How often</label>
        <select :id="`${idPrefix}-preset`" v-model="form.preset" class="form-select" @change="applyPreset">
          <option value="hourly">Every hour</option>
          <option value="twelve_hours">Every 12 hours</option>
          <option value="daily">{{ dailyLabel }}</option>
          <option value="weekly">{{ weeklyLabel }}</option>
          <option value="custom">Custom (cron expression)</option>
        </select>
      </div>
      <div v-if="form.preset === 'custom'" class="form-group flex-1">
        <label class="form-label" :for="`${idPrefix}-cron`">Cron expression</label>
        <input :id="`${idPrefix}-cron`" v-model="form.schedule" type="text" class="form-input" placeholder="*/30 * * * *" />
      </div>
    </div>

    <div class="form-actions mt-3">
      <button type="submit" class="btn btn-secondary-dark" :disabled="saving">{{ saving ? 'Saving...' : 'Save schedule' }}</button>
    </div>
  </form>
</template>

<script setup lang="ts">
import { reactive, ref, onMounted } from 'vue';
import { useToast } from '~/composables/useToast';
import { presetForSchedule, type ScheduleKey, type SchedulePresets } from '~/utils/schedulePresets';

const props = defineProps<{
  title: string;
  endpoint: string;
  presets: SchedulePresets;
  dailyLabel: string;
  weeklyLabel: string;
  idPrefix: string;
}>();

const toast = useToast();
const saving = ref(false);
const form = reactive<{ enabled: boolean; preset: ScheduleKey | 'custom'; schedule: string }>({
  enabled: false,
  preset: 'daily',
  schedule: props.presets.daily,
});

function applyPreset() {
  if (form.preset !== 'custom') form.schedule = props.presets[form.preset];
}

async function load() {
  try {
    const data = await $fetch<{ enabled?: boolean; schedule?: string }>(props.endpoint);
    form.enabled = !!data?.enabled;
    form.schedule = data?.schedule || props.presets.daily;
    form.preset = presetForSchedule(props.presets, form.schedule);
  } catch (err) {
    console.error(`Failed to load ${props.endpoint}:`, err);
  }
}

async function save() {
  // Validated here: the browser's `required` would silently block the submit.
  if (form.enabled && form.preset === 'custom' && !form.schedule.trim()) {
    toast.error('Enter a cron expression.');
    return;
  }
  saving.value = true;
  try {
    await $fetch(props.endpoint, { method: 'POST', body: { enabled: form.enabled, schedule: form.schedule.trim() } });
    toast.success(`${props.title}: schedule saved.`);
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Could not save the schedule.');
    await load();
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>
```

`app/components/settings/DownloadsAdvanced.vue`:

```vue
<template>
  <details class="glass-panel downloads-advanced" data-testid="downloads-advanced">
    <summary class="downloads-advanced-summary">
      <span class="downloads-advanced-title">Advanced</span>
      <span class="section-desc">Automatic sync schedules, sponsor segments in videos, and music video clips.</span>
    </summary>

    <div class="downloads-advanced-body">
      <section>
        <h3>Scheduled sync</h3>
        <p class="section-desc">Check everything you follow for new content at set times.</p>
        <div class="advanced-schedules">
          <ScheduleForm title="Videos" endpoint="/api/admin/downloader/schedule" :presets="VIDEO_SCHEDULE_PRESETS" daily-label="Every day at 3:00 AM" weekly-label="Every Sunday at 3:00 AM" id-prefix="video" />
          <ScheduleForm title="Music" endpoint="/api/admin/music/schedule" :presets="MUSIC_SCHEDULE_PRESETS" daily-label="Every day at 3:30 AM" weekly-label="Every Sunday at 3:30 AM" id-prefix="music" />
          <ScheduleForm title="Podcasts" endpoint="/api/admin/podcasts/schedule" :presets="PODCAST_SCHEDULE_PRESETS" daily-label="Every day at 4:00 AM" weekly-label="Every Sunday at 4:00 AM" id-prefix="podcast" />
        </div>
      </section>

      <section>
        <h3>Sponsor segments (videos)</h3>
        <p class="section-desc">Uses the community SponsorBlock database and applies to new downloads only. Each kind of segment can be kept, marked as a chapter, or cut from the file.</p>
        <form class="policy-forms-grid mt-3" data-testid="sponsorblock-form" @submit.prevent="saveSponsorBlock">
          <div v-for="cat in SPONSORBLOCK_CATEGORIES" :key="cat.key" class="form-group">
            <label class="form-label" :for="`sb-${cat.key}`">{{ cat.label }}</label>
            <select :id="`sb-${cat.key}`" v-model="sponsorBlock[cat.key]" class="form-select">
              <option value="ignore">Keep</option>
              <option value="mark">Mark as chapter</option>
              <option value="remove">Cut from file</option>
            </select>
          </div>
          <div class="form-actions mt-3">
            <button type="submit" class="btn btn-secondary-dark" :disabled="savingSponsorBlock">{{ savingSponsorBlock ? 'Saving...' : 'Save sponsor settings' }}</button>
          </div>
        </form>
      </section>

      <section>
        <h3>Music video clips</h3>
        <p class="section-desc">Also download the official video for each new track, next to the audio. Tracks you already have are not changed; use the clip download action on a track to get its video.</p>
        <label class="advanced-switch">
          <input type="checkbox" :checked="clipsEnabled" :disabled="togglingClips" data-testid="music-clips-toggle" @change="onClipsChange" />
          <span>{{ clipsEnabled ? 'On' : 'Off' }}</span>
        </label>
      </section>
    </div>
  </details>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import ScheduleForm from '~/components/settings/ScheduleForm.vue';
import { useToast } from '~/composables/useToast';
import { VIDEO_SCHEDULE_PRESETS, MUSIC_SCHEDULE_PRESETS, PODCAST_SCHEDULE_PRESETS } from '~/utils/schedulePresets';

const toast = useToast();

const SPONSORBLOCK_CATEGORIES = [
  { key: 'sponsor', label: 'Sponsor' },
  { key: 'intro', label: 'Intro' },
  { key: 'outro', label: 'Outro' },
  { key: 'selfpromo', label: 'Self-promotion' },
  { key: 'interaction', label: 'Like/subscribe reminders' },
  { key: 'filler', label: 'Filler and tangents' },
];

const sponsorBlock = ref<Record<string, string>>({
  sponsor: 'ignore', intro: 'ignore', outro: 'ignore', selfpromo: 'ignore', interaction: 'ignore', filler: 'ignore',
});
const savingSponsorBlock = ref(false);

async function loadSponsorBlock() {
  try {
    const data = await $fetch<{ settings?: Record<string, string> }>('/api/admin/downloader/sponsorblock');
    if (data?.settings) sponsorBlock.value = { ...sponsorBlock.value, ...data.settings };
  } catch (err) {
    console.error('Failed to fetch SponsorBlock settings:', err);
  }
}

async function saveSponsorBlock() {
  savingSponsorBlock.value = true;
  try {
    await $fetch('/api/admin/downloader/sponsorblock', { method: 'POST', body: sponsorBlock.value });
    toast.success('Sponsor settings saved.');
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Could not save the sponsor settings.');
    await loadSponsorBlock();
  } finally {
    savingSponsorBlock.value = false;
  }
}

const clipsEnabled = ref(false);
const togglingClips = ref(false);

async function loadClips() {
  try {
    const data = await $fetch<{ enabled: boolean }>('/api/settings/music-clips');
    clipsEnabled.value = !!data?.enabled;
  } catch {
    // keep the default
  }
}

async function onClipsChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const desired = input.checked;
  togglingClips.value = true;
  try {
    await $fetch('/api/admin/settings/music-clips', { method: 'POST', body: { enabled: desired } });
    clipsEnabled.value = desired;
    toast.success(desired ? 'Music video clips will be downloaded.' : 'Music video clips will no longer be downloaded.');
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Could not change the clips setting.');
  } finally {
    // One-way binding: make the box match the saved value.
    input.checked = clipsEnabled.value;
    togglingClips.value = false;
  }
}

onMounted(() => {
  loadSponsorBlock();
  loadClips();
});
</script>

<style scoped>
.downloads-advanced { padding: 20px; }
.downloads-advanced-summary { cursor: pointer; display: flex; flex-direction: column; gap: 4px; }
.downloads-advanced-title { font-size: 18px; font-weight: 700; }
.downloads-advanced-body { display: flex; flex-direction: column; gap: 24px; margin-top: 16px; }
.downloads-advanced-body h3 { margin: 0 0 4px; font-size: 15px; font-weight: 700; }
.advanced-schedules { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(260px, 100%), 1fr)); gap: 16px; margin-top: 12px; }
.advanced-switch { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; margin-top: 8px; }
</style>
```

- [ ] **Step 8: Run the tests to pass**

Run: `npx vitest run tests/component/DownloadsAdvanced.test.ts tests/unit/schedulePresets.test.ts` — Expected: PASS.

- [ ] **Step 9: Mutation-checks**

1. In `onClipsChange`, delete `input.checked = clipsEnabled.value;` → the clips test must fail on the last assertion. Revert.
2. In `ScheduleForm.save`, delete `await load();` → `after a failed save … reloads the saved schedule` must fail. Revert.

- [ ] **Step 10: Full suite, build, commit**

Run: `npx vitest run` and `npx nuxt build 2>&1 | tail -5`.

```bash
git add app/utils/schedulePresets.ts app/components/settings/ScheduleForm.vue app/components/settings/DownloadsAdvanced.vue tests/unit/schedulePresets.test.ts tests/component/DownloadsAdvanced.test.ts
git commit -m "feat: Advanced downloads settings for schedules, sponsor segments and music clips" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: `DownloadsTab.vue`, switch Downloads over, delete the old tabs

**Files:**
- Create: `app/components/settings/DownloadsTab.vue`
- Modify: `app/pages/settings.vue` (content block and the whole `<script setup>`)
- Modify: `app/components/settings/SettingsSystemTab.vue` (`onMounted` at lines 508-512: also call `fetchDiagnostics()`)
- Delete: `app/components/settings/SettingsDownloadsTab.vue`, `app/components/settings/SettingsMusicTab.vue`, `app/components/settings/SettingsPodcastsTab.vue`, `tests/component/SettingsIngestSuivre.test.ts` (its cases now live in `tests/component/LibrarySourceSection.test.ts`)
- Test: `tests/component/DownloadsTab.test.ts` (new)

**Interfaces:**
- Consumes: `useAllDownloads()` (Task 6); `DownloadTypeCard`, `DownloadQueueList` (Task 7); `DownloadsAdvanced` (Task 8); `DOWNLOAD_KINDS`, `FILTERS`, `queueActionRequest`, `QueueItem`, `QueueAction` (Task 6); `useActiveCounts` (Task 2); `LibraryTab` (Task 5).
- Produces: `DownloadsTab.vue` (no props): starts the single polling loop on mount, stops it on unmount; test ids `filter-{all|video|music|podcast}`, `queue-cap-notice`. After this task `settings.vue` has no queue pollers left; the only timer it owns is the 5 s `active-counts` refresh for the badge.

- [ ] **Step 1: Write the failing test**

Create `tests/component/DownloadsTab.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import DownloadsTab from '../../app/components/settings/DownloadsTab.vue';
import { useToast } from '../../app/composables/useToast';

const STATE_DEFAULTS: Record<string, any> = {
  settings_downloads_queue: [], settings_downloads_queue_total: 0, settings_downloads_failed_count: 0,
  settings_downloads_is_paused: false, settings_downloads_queue_error: false, settings_downloads_smooth_progress: {},
  settings_music_queue: [], settings_music_queue_total: 0, settings_music_failed_count: 0,
  settings_music_is_paused: false, settings_music_queue_error: false,
  settings_podcast_queue: [], settings_podcast_queue_total: 0, settings_podcast_failed_count: 0,
  settings_podcast_is_paused: false, settings_podcast_queue_error: false,
  settings_downloads_filter: 'all',
};

let payloads: Record<string, any>;
let failing: Set<string>;
let fetchMock: ReturnType<typeof vi.fn>;
let wrapper: any;

beforeEach(() => {
  for (const [key, value] of Object.entries(STATE_DEFAULTS)) useState(key).value = structuredClone(value);
  useToast().toasts.value = [];
  failing = new Set();
  payloads = {
    '/api/admin/downloader/queue': {
      queue: [
        { id: 'v1', title: 'Video one', download_status: 'pending', channel_title: 'Chan' },
        { id: 'v2', title: 'Video two', download_status: 'failed', channel_title: 'Chan', last_error: 'boom' },
      ],
      queueTotal: 150, failedCount: 1, isPaused: false,
    },
    '/api/admin/music/queue': { queue: [{ id: 'm1', title: 'Track', download_status: 'downloading', download_progress: 10, artist_name: 'Art' }], queueTotal: 1, failedCount: 0, isPaused: false },
    '/api/admin/podcasts/queue': { queue: [{ id: 'p1', title: 'Episode', download_status: 'pending', show_title: 'Show' }], queueTotal: 1, failedCount: 0, isPaused: true },
  };
  fetchMock = vi.fn(async (url: string, opts?: any) => {
    if (failing.has(url)) throw new Error('down');
    if (payloads[url] && !opts?.method) return payloads[url];
    if (url.endsWith('/concurrency')) return { maxConcurrentDownloads: 2 };
    if (url.endsWith('/schedule')) return { enabled: false, schedule: '' };
    if (url === '/api/admin/downloader/sponsorblock') return { settings: {} };
    if (url === '/api/settings/music-clips') return { enabled: false };
    return { success: true };
  });
  vi.stubGlobal('$fetch', fetchMock);
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  vi.unstubAllGlobals();
});

const mountTab = async () => {
  wrapper = await mountSuspended(DownloadsTab);
  await flushPromises();
  return wrapper;
};
const cardIds = (w: any) => w.findAll('.queue-card-premium').map((c: any) => c.attributes('data-testid'));

describe('DownloadsTab', () => {
  it('shows the three type cards, the filter counts and the Advanced disclosure', async () => {
    const w = await mountTab();
    expect(w.find('[data-testid="type-card-video"]').exists()).toBe(true);
    expect(w.find('[data-testid="type-card-music"]').exists()).toBe(true);
    expect(w.find('[data-testid="type-card-podcast"]').find('[data-testid="type-card-state"]').text()).toBe('Paused');
    expect(w.find('[data-testid="filter-all"]').text()).toBe('All 152');
    expect(w.find('[data-testid="filter-video"]').text()).toBe('Videos 150');
    expect(w.find('[data-testid="filter-music"]').text()).toBe('Music 1');
    expect(w.find('[data-testid="filter-podcast"]').text()).toBe('Podcasts 1');
    expect(w.find('[data-testid="downloads-advanced"]').exists()).toBe(true);
  });

  it('lists downloading items first across types, then queued, then failed', async () => {
    const w = await mountTab();
    expect(cardIds(w)).toEqual(['queue-item-music-m1', 'queue-item-video-v1', 'queue-item-podcast-p1', 'queue-item-video-v2']);
  });

  it('shows "Showing the first N of M" from the route totals', async () => {
    const w = await mountTab();
    expect(w.find('[data-testid="queue-cap-notice"]').text()).toBe('Showing the first 4 of 152');
    await w.find('[data-testid="filter-music"]').trigger('click');
    expect(w.find('[data-testid="queue-cap-notice"]').exists()).toBe(false);
    expect(cardIds(w)).toEqual(['queue-item-music-m1']);
  });

  it('runs a queue action and refreshes', async () => {
    const w = await mountTab();
    const before = fetchMock.mock.calls.filter(([u]) => u === '/api/admin/downloader/queue').length;
    await w.find('[data-testid="queue-item-video-v1"] [data-testid="queue-action-prioritize"]').trigger('click');
    await flushPromises();
    const post = fetchMock.mock.calls.find(([u, o]) => u === '/api/admin/downloader/prioritize' && o?.method === 'POST');
    expect(post![1].body).toEqual({ videoId: 'v1' });
    expect(fetchMock.mock.calls.filter(([u]) => u === '/api/admin/downloader/queue').length).toBeGreaterThan(before);
  });

  it('shows the empty state', async () => {
    for (const url of Object.keys(payloads)) payloads[url] = { queue: [], queueTotal: 0, failedCount: 0, isPaused: false };
    const w = await mountTab();
    expect(w.find('[data-testid="queue-empty"]').text()).toContain('Nothing is downloading');
  });

  it('keeps the other types working when one queue route fails', async () => {
    failing.add('/api/admin/podcasts/queue');
    const w = await mountTab();
    expect(w.find('[data-testid="type-card-podcast"] [data-testid="type-card-error"]').exists()).toBe(true);
    expect(w.find('[data-testid="type-card-video"] [data-testid="type-card-error"]').exists()).toBe(false);
    expect(cardIds(w)).toContain('queue-item-music-m1');
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/component/DownloadsTab.test.ts` — Expected: FAIL (`DownloadsTab.vue` missing).

- [ ] **Step 3: Create `DownloadsTab.vue` and delete the old tab files in the same step**

Delete `app/components/settings/SettingsDownloadsTab.vue` first (both files would auto-register as `SettingsDownloadsTab`):

```bash
git rm app/components/settings/SettingsDownloadsTab.vue app/components/settings/SettingsMusicTab.vue app/components/settings/SettingsPodcastsTab.vue tests/component/SettingsIngestSuivre.test.ts
```

Create `app/components/settings/DownloadsTab.vue`:

```vue
<template>
  <div class="tab-pane downloads-hub">
    <div class="downloads-header-panel glass-panel">
      <div class="header-text">
        <h2>Downloads</h2>
        <p>Everything that is queued, downloading or failed, for videos, music and podcasts.</p>
      </div>
    </div>

    <div class="download-type-cards">
      <DownloadTypeCard v-for="kind in DOWNLOAD_KINDS" :key="kind" :kind="kind" :state="states[kind]" @changed="refreshAll" />
    </div>

    <div class="queue-box glass-panel">
      <div class="queue-filter" role="group" aria-label="Filter the queue">
        <button
          v-for="f in FILTERS"
          :key="f.key"
          type="button"
          class="queue-filter-btn"
          :class="{ active: filter === f.key }"
          :aria-pressed="filter === f.key"
          :data-testid="`filter-${f.key}`"
          @click="filter = f.key"
        >{{ f.label }} <span class="queue-filter-count">{{ counts[f.key] }}</span></button>
      </div>

      <p v-if="notice" class="queue-truncated-notice" data-testid="queue-cap-notice">{{ notice }}</p>

      <DownloadQueueList :items="visible.items" :progress-for="progressFor" @action="onQueueAction" />
    </div>

    <DownloadsAdvanced />
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';
import DownloadTypeCard from '~/components/settings/DownloadTypeCard.vue';
import DownloadQueueList from '~/components/settings/DownloadQueueList.vue';
import DownloadsAdvanced from '~/components/settings/DownloadsAdvanced.vue';
import { useAllDownloads } from '~/composables/useAllDownloads';
import { useToast } from '~/composables/useToast';
import { DOWNLOAD_KINDS, FILTERS, queueActionRequest, type QueueAction, type QueueItem } from '~/utils/allDownloads';

const toast = useToast();
const { filter, states, counts, visible, notice, progressFor, refreshAll, startPolling, stopPolling } = useAllDownloads();

const ACTION_DONE: Record<QueueAction, string> = {
  prioritize: 'Moved to the front of the queue.',
  cancel: 'Download cancelled.',
  retry: 'Queued again.',
};

async function onQueueAction(item: QueueItem, action: QueueAction) {
  try {
    const request = queueActionRequest(item, action);
    await $fetch(request.url, { method: 'POST', ...(request.body ? { body: request.body } : {}) });
    toast.success(ACTION_DONE[action]);
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'That action failed.');
  } finally {
    await refreshAll();
  }
}

onMounted(startPolling);
onUnmounted(stopPolling);
</script>

<style scoped>
.download-type-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(260px, 100%), 1fr)); gap: 16px; }
.queue-box { padding: 16px; }
.queue-filter { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
.queue-filter-btn { border: 1px solid rgba(255, 255, 255, 0.12); background: transparent; color: inherit; border-radius: 999px; padding: 6px 12px; font-size: 13px; cursor: pointer; }
.queue-filter-btn.active { background: rgba(139, 92, 246, 0.25); border-color: rgba(139, 92, 246, 0.6); }
.queue-filter-count { opacity: 0.7; margin-left: 4px; }
.queue-truncated-notice { margin: 0 0 10px; font-size: 12px; color: var(--text-secondary); }
</style>
```

Note on the filter text: the button renders `Videos <span>150</span>`; `text()` of the button is `Videos 150` (the test relies on the single space before the span).

- [ ] **Step 4: Switch `settings.vue` over**

Replace the content children (from Task 5):

```html
        <LibraryTab v-if="activeTab === 'library' && isAdmin" :section="librarySection" />
        <!-- Interim until the unified Downloads tab lands: the old per-type tabs, stacked. -->
        <div v-if="activeTab === 'downloads' && isAdmin" class="tab-pane">
          <SettingsDownloadsTab />
          <SettingsMusicTab />
          <SettingsPodcastsTab />
        </div>
```

with:

```html
        <LibraryTab v-if="activeTab === 'library' && isAdmin" :section="librarySection" />
        <DownloadsTab v-if="activeTab === 'downloads' && isAdmin" />
```

Replace the whole `<script setup lang="ts">…</script>` with:

```ts
<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useAuth } from '~/composables/useAuth';
import { useActiveCounts } from '~/composables/useActiveCounts';
import { normalizeSettingsTab, type SettingsTab, type LibrarySection } from '~/utils/settingsTabs';
import LibraryTab from '~/components/settings/LibraryTab.vue';
import DownloadsTab from '~/components/settings/DownloadsTab.vue';

const { user: currentUser, isAdmin } = useAuth();
const route = useRoute();
const router = useRouter();

if (!isAdmin.value) {
  navigateTo('/account');
}

const showTabs = computed(() => isAdmin.value && !currentUser.value?.mustChangePassword);

const initial = normalizeSettingsTab(route.query);
const activeTab = ref<SettingsTab>(initial.tab);
const librarySection = ref<LibrarySection | null>(initial.section);

// Legacy links (?tab=stats|music|podcasts) and unknown values are normalised
// on load and on every query change.
watch(() => [route.query.tab, route.query.section], () => {
  const next = normalizeSettingsTab(route.query);
  activeTab.value = next.tab;
  librarySection.value = next.section;
});

function selectTab(tab: SettingsTab) {
  activeTab.value = tab;
  librarySection.value = null;
  router.replace({ query: { ...route.query, tab, section: undefined } });
}

// Badge on the Downloads tab and the Overview Activity card. The queue itself
// is polled only by the Downloads tab (one loop, see useAllDownloads).
const { downloadingTotal, fetchActiveCounts } = useActiveCounts();
let activeCountsTimer: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
  if (isAdmin.value) {
    fetchActiveCounts();
    activeCountsTimer = setInterval(fetchActiveCounts, 5000);
  }
});

onUnmounted(() => {
  if (activeCountsTimer) clearInterval(activeCountsTimer);
});
</script>
```

- [ ] **Step 5: Keep the System logs fed**

The removed video poller used to refresh the System tab's log buffer while videos downloaded. In `app/components/settings/SettingsSystemTab.vue` change the `onMounted` block (lines 508-512) to:

```ts
onMounted(() => {
  refreshModules();
  fetchSearchPlatforms();
  fetchContentSearchMode();
  fetchDiagnostics();
});
```

- [ ] **Step 6: Check nothing references the deleted files**

Run: `grep -rn "SettingsDownloadsTab\|SettingsMusicTab\|SettingsPodcastsTab\|runMusicPolling\|runPodcastPolling" app tests` — Expected: no output.

- [ ] **Step 7: Run the tests to pass**

Run: `npx vitest run tests/component/DownloadsTab.test.ts` — Expected: PASS.

- [ ] **Step 8: Mutation-check**

In `DownloadsTab.vue`, change `onMounted(startPolling);` to `onMounted(() => {});` → every DownloadsTab test that expects cards must fail (no queue loaded). Revert.

- [ ] **Step 9: Full suite, build, commit**

Run: `npx vitest run` and `npx nuxt build 2>&1 | tail -5`.

```bash
git add app/components/settings/DownloadsTab.vue app/pages/settings.vue app/components/settings/SettingsSystemTab.vue tests/component/DownloadsTab.test.ts
git commit -m "feat: unified Downloads tab replaces the per-type tabs and their three pollers" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

(The `git rm` from Step 3 is already staged.)

---

### Task 10: Overview — Activity card and plain-English dashboard

**Files:**
- Create: `app/components/settings/OverviewActivityCard.vue`
- Modify: `app/components/settings/SettingsStatsTab.vue` (insert the card after line 2; copy changes on lines 8-160 listed below; add one import in the script at line 169-170)
- Test: `tests/component/OverviewActivityCard.test.ts` (new)

**Interfaces:**
- Consumes: `useActiveCounts()` (Task 2) → `counts`, `downloadingTotal`, `queuedTotal`, `fetchActiveCounts`. The settings page refreshes the same state every 5 s (Task 2/9).
- Produces: `OverviewActivityCard.vue` (no props); test ids `overview-activity`, `activity-summary`, `activity-video`, `activity-music`, `activity-podcasts`, `activity-open-downloads` (a `NuxtLink` to `/settings?tab=downloads`).

- [ ] **Step 1: Write the failing test**

Create `tests/component/OverviewActivityCard.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import OverviewActivityCard from '../../app/components/settings/OverviewActivityCard.vue';

let payload: any;

beforeEach(() => {
  useState('admin_active_counts').value = null;
  payload = {
    video: { downloading: 1, pending: 20 },
    music: { downloading: 2, pending: 0 },
    podcasts: { downloading: 0, pending: 5 },
    total: 28,
    current: { kind: 'video', progress: 10, speed: null },
  };
  vi.stubGlobal('$fetch', vi.fn(async () => payload));
});
afterEach(() => vi.unstubAllGlobals());

describe('OverviewActivityCard', () => {
  it('shows what is downloading per type, the total queued and a link to Downloads', async () => {
    const w = await mountSuspended(OverviewActivityCard);
    await flushPromises();
    expect(w.find('[data-testid="overview-activity"]').text()).toContain('Activity');
    expect(w.find('[data-testid="activity-summary"]').text()).toBe('3 downloading now, 25 queued');
    expect(w.find('[data-testid="activity-video"]').text()).toContain('Videos');
    expect(w.find('[data-testid="activity-video"]').text()).toContain('1 downloading · 20 queued');
    expect(w.find('[data-testid="activity-music"]').text()).toContain('2 downloading · 0 queued');
    expect(w.find('[data-testid="activity-podcasts"]').text()).toContain('0 downloading · 5 queued');
    expect(w.find('[data-testid="activity-open-downloads"]').attributes('href')).toBe('/settings?tab=downloads');
  });

  it('says "Nothing is downloading" when idle', async () => {
    payload = { video: { downloading: 0, pending: 0 }, music: { downloading: 0, pending: 0 }, podcasts: { downloading: 0, pending: 0 }, total: 0, current: { kind: null, progress: null, speed: null } };
    const w = await mountSuspended(OverviewActivityCard);
    await flushPromises();
    expect(w.find('[data-testid="activity-summary"]').text()).toBe('Nothing is downloading');
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/component/OverviewActivityCard.test.ts` — Expected: FAIL (component missing).

- [ ] **Step 3: Implement `app/components/settings/OverviewActivityCard.vue`**

```vue
<template>
  <div class="activity-card glass-panel" data-testid="overview-activity">
    <div class="activity-head">
      <h3>Activity</h3>
      <NuxtLink to="/settings?tab=downloads" class="btn btn-secondary-dark btn-sm" data-testid="activity-open-downloads">Open Downloads</NuxtLink>
    </div>
    <p v-if="!counts" class="section-desc">Loading...</p>
    <template v-else>
      <p class="activity-summary" data-testid="activity-summary">{{ summary }}</p>
      <ul class="activity-list">
        <li v-for="row in rows" :key="row.key" :data-testid="`activity-${row.key}`">
          <span class="activity-label">{{ row.label }}</span>
          <span>{{ row.downloading }} downloading · {{ row.pending }} queued</span>
        </li>
      </ul>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useActiveCounts } from '~/composables/useActiveCounts';

const { counts, downloadingTotal, queuedTotal, fetchActiveCounts } = useActiveCounts();

const rows = computed(() => {
  const c = counts.value;
  if (!c) return [];
  return [
    { key: 'video', label: 'Videos', ...c.video },
    { key: 'music', label: 'Music', ...c.music },
    { key: 'podcasts', label: 'Podcasts', ...c.podcasts },
  ];
});

const summary = computed(() =>
  downloadingTotal.value === 0 && queuedTotal.value === 0
    ? 'Nothing is downloading'
    : `${downloadingTotal.value} downloading now, ${queuedTotal.value} queued`,
);

onMounted(fetchActiveCounts);
</script>

<style scoped>
.activity-card { padding: 20px; display: flex; flex-direction: column; gap: 10px; }
.activity-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.activity-head h3 { margin: 0; font-size: 18px; font-weight: 700; }
.activity-summary { margin: 0; font-size: 15px; font-weight: 600; }
.activity-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: var(--text-secondary); }
.activity-list li { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.activity-label { font-weight: 600; color: var(--text-primary, inherit); }
</style>
```

- [ ] **Step 4: Run it to pass**

Run: `npx vitest run tests/component/OverviewActivityCard.test.ts` — Expected: PASS.

- [ ] **Step 5: Mutation-check**

Change the summary condition to `downloadingTotal.value === 0` only → the first test still passes but change the idle payload's `podcasts.pending` to `5` mentally: instead, mutate `queuedTotal` in `useActiveCounts` to sum only `video.pending` → `3 downloading now, 25 queued` must fail (`20 queued`). Revert.

- [ ] **Step 6: Put the card on the Overview and rewrite its copy**

In `app/components/settings/SettingsStatsTab.vue`: insert `<OverviewActivityCard />` as the first child of `<div class="tab-pane">` (new line after line 2), and add `import OverviewActivityCard from '~/components/settings/OverviewActivityCard.vue';` after line 169 (`import { computed } from 'vue';`). Replace these strings exactly (match by text; line numbers verified):

| Line | Old | New |
|---|---|---|
| 8 | `System Online & Syncing` | `Running` |
| 10 | `Library Diagnostic Dashboard` | `Overview` |
| 11 | `Comprehensive overview of local storage consumption, catalog data, and channel archiving metrics.` | `What your library holds and how much space it uses.` |
| 16 | `Catalog Views` | `YouTube views` |
| 21 | `Indexed Comments` | `Comments saved` |
| 26 | `Queue Tasks` | `Videos queued` |
| 36 | `Archived Videos` | `Videos` |
| 42 | `Videos locally cataloged & verified` | `Downloaded and ready to watch` |
| 48 | `Media Disk Space` | `Disk space` |
| 54 | `Total space used by MP4/JPG files` | `Used by video files and thumbnails` |
| 60 | `Archived Duration` | `Total duration` |
| 66 | `Cumulative playback playtime` | `Of all downloaded videos` |
| 72 | `SQLite Database` | `Database` |
| 78 | `Metadata & search indexing database` | `Titles, descriptions and search index` |
| 88 | `Top Channels (by videos)` | `Top channels` |
| 91 | `No channels found. Start tracking channels to view archiving metrics.` | `No channels yet. Follow a channel in Library to see it here.` |
| 104 | `{{ ch.completed_count }} / {{ ch.total_count }} videos` | `{{ ch.completed_count }} of {{ ch.total_count }} videos downloaded` |
| 121 | `Infrastructure & Analytics` | `Details` |
| 126 | `Active tracked channels` | `Channels followed` |
| 131 | `Total YouTube catalog views` | `YouTube views of your videos` |
| 136 | `Comments database load` | `Comments saved` |
| 137 | `{{ stats?.totalComments?.toLocaleString() \|\| 0 }} rows` | `{{ stats?.totalComments?.toLocaleString() \|\| 0 }} comments` |
| 141 | `Pending sync downloads` | `Videos waiting to download` |
| 143 | `{{ stats?.totalQueue \|\| 0 }} in queue` | `{{ stats?.totalQueue \|\| 0 }} queued` |
| 148 | `Database indexing engine` | `Database engine` |
| 159 | `All Services Operational` | `Everything is running` |
| 160 | `Archiver engine listening for sync triggers.` | `Followed sources are checked on their schedule.` |

(In the table `\|\|` stands for the literal `||`.)

- [ ] **Step 7: Full suite, build, commit**

Run: `npx vitest run` and `npx nuxt build 2>&1 | tail -5`.

```bash
git add app/components/settings/OverviewActivityCard.vue app/components/settings/SettingsStatsTab.vue tests/component/OverviewActivityCard.test.ts
git commit -m "feat: Overview tab with an Activity card and plain-English dashboard copy" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 11: System regrouped (Modules, Default display, Search providers, Tools & logs, Danger zone) + Users copy

**Files:**
- Modify: `app/components/settings/SettingsSystemTab.vue` — template lines 1-268 rewritten (blocks moved verbatim, copy changed as listed); script strings at lines 308, 314, 361, 467, 469, 480-484, 495, 497; one new function
- Modify: `app/components/settings/SettingsUsersTab.vue` — copy only (lines 12-219, strings listed below)
- Test: `tests/component/SettingsSystemTab.test.ts` (new)

**Interfaces:**
- Consumes: existing System script (`modules`, `moduleOptions`, `isLastEnabledModule`, `onModuleChange`, `savingModuleId`, `diagnosticYtdlPath`, `diagnosticLogs`, `fetchDiagnostics`, `handleTestBinary`, `handleUpdateYtdl`, `diagnosticBinaryTesting`, `diagnosticBinaryResult`, `updatingYtdl`, `updateConsoleOutput`, `terminalBody`, `getLogLineClass`, `wipe*`, `loadWipePreview`, `handleStartWipe`, `resetDangerZone`, `formatBytes`, `searchPlatforms`, `platformLabels`, `savingPlatformId`, `handleSaveSearchPlatform`, `contentSearchMode`, `savingContentSearchMode`, `handleSaveContentSearchMode`); `DisplayPrefsForm` (auto-imported component).
- Produces: System sections in this order with test ids `system-modules`, `system-default-display`, `system-search`, `system-tools` (`<details>`, collapsed), `system-danger` (`<details>`, collapsed); confirmation word `DELETE` (constant `WIPE_CONFIRM_WORD`); new function `onToolsToggle(event)` that loads diagnostics when Tools & logs opens.

- [ ] **Step 1: Write the failing test**

Create `tests/component/SettingsSystemTab.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import SettingsSystemTab from '../../app/components/settings/SettingsSystemTab.vue';

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async (url: string, opts?: any) => {
    if (url === '/api/admin/system/wipe-preview') return { channelCount: 1, videoCount: 2, artistCount: 0, trackCount: 0, showCount: 0, episodeCount: 0, estimatedBytes: 1024 };
    if (url === '/api/admin/system/search-platforms') return { platforms: [] };
    if (url === '/api/settings/content-search-mode') return { mode: 'per_space' };
    if (url === '/api/admin/downloader/logs') return { logs: ['[info] started'], ytdlPath: '/usr/bin/yt-dlp' };
    if (url === '/api/admin/system/wipe-all' && opts?.method === 'POST') return { success: true };
    return {};
  });
  vi.stubGlobal('$fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const mountTab = async () => {
  const w = await mountSuspended(SettingsSystemTab);
  await flushPromises();
  return w;
};

describe('SettingsSystemTab', () => {
  it('groups the page under five sections in order', async () => {
    const w = await mountTab();
    const ids = w.findAll('[data-testid^="system-"]').map((s: any) => s.attributes('data-testid'));
    expect(ids).toEqual(['system-modules', 'system-default-display', 'system-search', 'system-tools', 'system-danger']);
    expect(w.find('[data-testid="system-default-display"]').text()).toContain('Default display');
    expect(w.find('[data-testid="system-search"]').text()).toContain('Search providers');
    expect(w.find('[data-testid="system-search"]').text()).toContain('Current space only');
  });

  it('keeps Tools & logs and Danger zone collapsed', async () => {
    const w = await mountTab();
    for (const id of ['system-tools', 'system-danger']) {
      const el = w.find(`[data-testid="${id}"]`);
      expect(el.element.tagName).toBe('DETAILS');
      expect(el.attributes('open')).toBeUndefined();
    }
    expect(w.find('[data-testid="system-tools"] summary').text()).toContain('Tools & logs');
    expect(w.find('[data-testid="system-danger"] summary').text()).toContain('Danger zone');
  });

  it('loads the log on mount', async () => {
    await mountTab();
    expect(fetchMock.mock.calls.some(([u]) => u === '/api/admin/downloader/logs')).toBe(true);
  });

  it('asks for the word DELETE before wiping', async () => {
    const w = await mountTab();
    const danger = w.find('[data-testid="system-danger"]');
    await danger.findAll('button').find((b: any) => b.text() === 'Show what will be deleted')!.trigger('click');
    await flushPromises();
    const wipe = () => danger.findAll('button').find((b: any) => b.text() === 'Delete everything')!;
    expect((wipe().element as HTMLButtonElement).disabled).toBe(true);
    await danger.find('input').setValue('SUPPRIMER');
    expect((wipe().element as HTMLButtonElement).disabled).toBe(true);
    await danger.find('input').setValue('DELETE');
    expect((wipe().element as HTMLButtonElement).disabled).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/component/SettingsSystemTab.test.ts` — Expected: FAIL (`system-modules` not found; button `Delete everything` missing).

- [ ] **Step 3: Rewrite the System template**

Replace lines 1-268 of `SettingsSystemTab.vue` with the structure below. Where it says "move lines X-Y verbatim", copy those lines from the current file unchanged except for the string replacements listed after the template.

```vue
<template>
  <div class="tab-pane system-tab">
    <section class="config-section glass-panel" data-testid="system-modules">
      <div class="section-title-row">
        <!-- move lines 8-10 verbatim (icon-orb) -->
        <div>
          <h3>Modules</h3>
          <p class="section-desc">Turn each space on or off for everyone except admins. A space that is off disappears from the menus and stops downloading and syncing in the background; its files and data are kept. Admins can still open it.</p>
        </div>
      </div>
      <!-- move lines 17-38 verbatim (the module switches) -->
    </section>

    <section class="config-section glass-panel" data-testid="system-default-display">
      <div class="section-title-row">
        <!-- move lines 43-45 verbatim (icon-orb) -->
        <div>
          <h3>Default display</h3>
          <p class="section-desc">Starting display settings for the whole server, for guests and users. Each user can change them from their account.</p>
        </div>
      </div>
      <!-- move lines 52-54 verbatim (<DisplayPrefsForm mode="admin" />) -->
    </section>

    <section class="config-section glass-panel" data-testid="system-search">
      <div class="section-title-row">
        <!-- move lines 211-213 verbatim (search icon-orb) -->
        <div>
          <h3>Search providers</h3>
          <p class="section-desc">Optional API keys that give better results when you search for podcasts and YouTube channels to follow, and how the search bar at the top of the page works.</p>
        </div>
      </div>
      <!-- move lines 220-245 verbatim (one form per platform) -->
      <div class="mt-3 pt-3 border-t">
        <h4 class="results-header">Header search bar</h4>
        <p class="section-desc">Search inside the current space only, or search videos, music and podcasts together on one results page.</p>
        <div class="mt-2">
          <select v-model="contentSearchMode" class="form-select" :disabled="savingContentSearchMode" @change="handleSaveContentSearchMode">
            <option value="per_space">Current space only</option>
            <option value="global">All spaces together</option>
          </select>
        </div>
      </div>
    </section>

    <details class="config-section glass-panel" data-testid="system-tools" @toggle="onToolsToggle">
      <summary class="system-summary">
        <span class="system-summary-title">Tools &amp; logs</span>
        <span class="section-desc">Check and update the download engine (yt-dlp and FFmpeg) and read the server's recent log.</span>
      </summary>
      <div class="system-tools-body">
        <h4 class="results-header">Download engine</h4>
        <p class="section-desc">Check that yt-dlp and FFmpeg work on this server.</p>
        <!-- move lines 68-116 verbatim (path box, buttons, test results, update output) -->
        <!-- move lines 122-145 verbatim (the logs-container panel with header and terminal) -->
      </div>
    </details>

    <details class="config-section glass-panel danger-zone-panel" data-testid="system-danger">
      <summary class="system-summary">
        <span class="system-summary-title">Danger zone</span>
        <span class="section-desc">Permanently delete every video, music track and podcast episode — files and database records. This cannot be undone.</span>
      </summary>
      <!-- move lines 159-206 verbatim (progress, report, preview and confirmation) -->
    </details>
  </div>
</template>
```

String replacements inside the moved blocks (match by text):

| Old | New |
|---|---|
| `Au moins un module doit rester actif.` (line 26) | `At least one space must stay on.` |
| `{{ modules[m.id] ? 'Activé' : 'Désactivé' }}` (line 35) | `{{ modules[m.id] ? 'On' : 'Off' }}` |
| `Server yt-dlp path :` (line 69) | `yt-dlp path:` |
| `'resolving path...'` (line 70) | `'Looking up...'` |
| `'Diagnostic Check'` (line 75) | `'Run check'` |
| `yt-dlp Engine Status:` (line 86) | `yt-dlp:` |
| `'Operational'` (line 88) | `'Working'` |
| `FFmpeg Merging status:` (line 96) | `FFmpeg:` |
| `'AV Merge active'` (line 98) | `'Found'` |
| `💡 Standard Formats only (720p max):` (line 103) | `Without FFmpeg, downloads are limited to 720p:` |
| `stderr capture:` (line 108) | `Error output:` |
| `Worker output log:` (line 114) | `Update output:` |
| `'Executing path binaries update...'` (line 115) | `'Updating yt-dlp...'` |
| `System Ingestion Logs` (line 126) | `Server log` |
| `title="Refresh logs"` (line 128) | `title="Refresh log"` |
| `No log buffer entries captured.` (line 134) | `The log is empty.` |
| `Type <code>SUPPRIMER</code> below to enable the button.` (line 191) | `Type <code>{{ WIPE_CONFIRM_WORD }}</code> below to enable the button.` |
| `placeholder="SUPPRIMER"` (line 196) | `:placeholder="WIPE_CONFIRM_WORD"` |
| `wipeConfirmText !== 'SUPPRIMER'` (line 202) | `wipeConfirmText !== WIPE_CONFIRM_WORD` |
| `'Wipe everything'` (line 204) | `'Delete everything'` |

The old wrappers that disappear: `.system-dashboard-layout`, `.system-diagnostic-col`, `.system-logs-col` (lines 3-5, 118-121, 146-147, 266) and the old "Recherche" panel (lines 248-265, replaced by the "Header search bar" block above). Keep `ref="terminalBody"` on `.logs-terminal`.

- [ ] **Step 4: Update the System script**

In the script:
- Add after `const toast = useToast();` (line 275): `const WIPE_CONFIRM_WORD = 'DELETE';`
- Line 361: `if (wipeConfirmText.value !== 'SUPPRIMER') return;` → `if (wipeConfirmText.value !== WIPE_CONFIRM_WORD) return;`
- Line 308: `toast.success('Binary test completed.');` → `toast.success('Check finished.');`; line 314: `toast.error('Binary test failed.');` → `toast.error('Check failed.');`
- Line 467: `'Mode de recherche mis à jour.'` → `'Search mode updated.'`; line 469: `'Échec de la mise à jour du mode de recherche.'` → `'Could not update the search mode.'`
- Lines 480-484 `moduleOptions` → 

```ts
const moduleOptions: { id: ModuleKey; label: string; description: string }[] = [
  { id: 'video', label: 'Videos', description: 'Home, Shorts, Channels, Subscriptions, Playlists and the video player.' },
  { id: 'music', label: 'Music', description: 'Music library, artists and the audio player.' },
  { id: 'podcasts', label: 'Podcasts', description: 'Podcast library and player.' },
];
```

- Line 495: `enabled ? 'Module activé.' : 'Module désactivé.'` → `enabled ? 'Space turned on.' : 'Space turned off.'`; line 497: `'Échec de la mise à jour du module.'` → `'Could not update this space.'`
- Add before `onMounted`:

```ts
function onToolsToggle(event: Event) {
  if ((event.target as HTMLDetailsElement).open) fetchDiagnostics();
}
```

Add a `<style scoped>` block at the end of the file:

```css
<style scoped>
.system-tab { display: flex; flex-direction: column; gap: 16px; }
.system-summary { cursor: pointer; display: flex; flex-direction: column; gap: 4px; }
.system-summary-title { font-size: 16px; font-weight: 700; }
.system-tools-body { display: flex; flex-direction: column; gap: 12px; margin-top: 16px; }
</style>
```

- [ ] **Step 5: Users copy (no behaviour change)**

In `app/components/settings/SettingsUsersTab.vue` replace (match by text):

| Line | Old | New |
|---|---|---|
| 12 | `'Modify User Profile'` / `'Register Account'` | `'Edit user'` / `'Add a user'` |
| 13 | `Create profiles, define access roles, and assign channel track lists permissions.` | `Create accounts, choose each person's role, and decide which ultra-private channels they can see.` |
| 33 | `'New password (leave empty to keep unchanged)'` / `'Password (leave empty to auto-generate)'` | `'New password (leave empty to keep the current one)'` / `'Password (leave empty to generate one)'` |
| 45 | `Authorization Role` | `Role` |
| 51 | `Standard User` | `User` |
| 58 | `Administrator` | `Admin` |
| 66 | `Channel Scope Permissions` | `Channel access` |
| 72 | `Full visibility on all channels` | `Can see every channel` |
| 78 | `Restrict access to specific channels :` | `Ultra-private channels this user can see:` |
| 90 | `Account configured successfully!` | `Account saved.` |
| 110 | `'Update Profile'` / `'Create Account'` | `'Save changes'` / `'Create user'` |
| 126 | `Saved User Accounts` | `Users` |
| 145 | `'Administrator' : 'Standard User'` | `'Admin' : 'User'` |
| 165 | `Reset Password` | `Reset password` |
| 219 | `'Credentials copied to clipboard!'` | `'Sign-in details copied.'` |

- [ ] **Step 6: Run the tests to pass**

Run: `npx vitest run tests/component/SettingsSystemTab.test.ts` — Expected: PASS.

- [ ] **Step 7: Mutation-check**

Set `const WIPE_CONFIRM_WORD = 'SUPPRIMER';` → `asks for the word DELETE before wiping` must fail. Revert.

- [ ] **Step 8: Full suite, build, commit**

Run: `npx vitest run` and `npx nuxt build 2>&1 | tail -5`.

```bash
git add app/components/settings/SettingsSystemTab.vue app/components/settings/SettingsUsersTab.vue tests/component/SettingsSystemTab.test.ts
git commit -m "feat: System tab regrouped into clear sections, Users copy clarified" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 12: English glossary pass + guard against French in the admin screens

**Files:**
- Modify: `app/components/DisplayPrefsForm.vue` (rendered in System → Default display; strings on lines 6-99 and 134-190 listed below)
- Modify: `tests/component/DisplayPrefsForm.test.ts` (lines 169-172: the ranking-labels test)
- Modify: any file under `app/components/settings/` or `app/pages/settings.vue` the guard still flags
- Create: `tests/unit/adminEnglishOnly.test.ts`

**Interfaces:**
- Consumes: every component created or edited in Tasks 2-11.
- Produces: a guard test that fails when an accented French character or a known French word appears in `app/components/settings/**/*.vue`, `app/pages/settings.vue` or `app/components/DisplayPrefsForm.vue`; exported nothing.

- [ ] **Step 1: Write the failing guard**

Create `tests/unit/adminEnglishOnly.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// The admin screens are English only (spec 2026-10-06-admin-settings-reorg).
const ROOT = fileURLToPath(new URL('../..', import.meta.url));

function vueFilesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return vueFilesUnder(full);
    return name.endsWith('.vue') ? [full] : [];
  });
}

const FILES = [
  ...vueFilesUnder(join(ROOT, 'app/components/settings')),
  join(ROOT, 'app/pages/settings.vue'),
  join(ROOT, 'app/components/DisplayPrefsForm.vue'),
];

const ACCENTED = /[àâäçéèêëîïôöùûüÿœæÀÂÄÇÉÈÊËÎÏÔÖÙÛÜŸŒÆ«»]/;
const FRENCH_WORDS = [
  'Suivre', 'Recherche', 'Affichage', 'Musique', 'Vidéo', 'SUPPRIMER', 'Globale', 'Par espace',
  'Activé', 'Désactivé', 'Échec', 'Impossible de', 'Télécharg', 'Chaînes', 'Abonnements', 'Rétablir',
  'Populaires', 'Bloc vedette', 'Monter', 'Descendre', 'Sections de', 'Erreur lors', 'Valeurs de',
];

// Text allowed to match despite the rules above. Keep this list short and give
// a reason for every entry, e.g. { file: 'app/components/settings/X.vue', text: 'Beyoncé', reason: 'artist name in a placeholder' }.
const ALLOWLIST: Array<{ file: string; text: string; reason: string }> = [];

function frenchHits(source: string, file: string): string[] {
  const allowed = ALLOWLIST.filter((a) => a.file === file).map((a) => a.text);
  const hits: string[] = [];
  source.split('\n').forEach((line, index) => {
    const cleaned = allowed.reduce((acc, text) => acc.split(text).join(''), line);
    const word = FRENCH_WORDS.find((w) => cleaned.includes(w));
    if (ACCENTED.test(cleaned) || word) hits.push(`${file}:${index + 1}: ${line.trim()}`);
  });
  return hits;
}

describe('admin screens are English only', () => {
  it('the guard itself detects French (self-test)', () => {
    expect(frenchHits('<h3>Recherche</h3>', 'x.vue')).toHaveLength(1);
    expect(frenchHits("toast.error('Échec')", 'x.vue')).toHaveLength(1);
    expect(frenchHits('<span>{{ on ? "Active" : "Paused" }}</span>', 'x.vue')).toHaveLength(0);
  });

  it('covers the settings components', () => {
    expect(FILES.length).toBeGreaterThan(10);
  });

  it.each(FILES.map((f) => [relative(ROOT, f), f]))('%s has no French text', (rel, full) => {
    expect(frenchHits(readFileSync(full, 'utf8'), rel)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/unit/adminEnglishOnly.test.ts`
Expected: FAIL — `app/components/DisplayPrefsForm.vue has no French text` lists its lines (e.g. `Densité des grilles`, `Rétablir le défaut`, `Chaînes`, `Vidéo`, `Échec de l'enregistrement`). If any settings file is also listed, fix it in Step 3.

- [ ] **Step 3: Translate `DisplayPrefsForm.vue`**

Replace (match by text):

| Old | New |
|---|---|
| `Densité des grilles` | `Grid density` |
| `Rétablir le défaut{{ mode === 'user' ? " de l'instance" : '' }}` (7 occurrences, lines 7, 20, 38, 50, 68, 79, 89, 99) | `{{ mode === 'user' ? 'Use the server default' : 'Reset to default' }}` |
| `Compacte (plus de colonnes)` | `Compact (more columns)` |
| `>Normale<` | `>Normal<` |
| `Large (moins de colonnes)` | `Spacious (fewer columns)` |
| `Liens de navigation à masquer` | `Navigation links to hide` |
| `L'accueil et les bibliothèques ne peuvent pas être masqués. Une page masquée reste accessible par son adresse.` | `Home and the libraries can't be hidden. A hidden page can still be opened from its address.` |
| `Espace affiché au démarrage` | `Space shown at start` |
| `Automatique (premier espace actif)` | `Automatic (first space that is on)` |
| `Sections de l'accueil` | `Home sections` |
| `` `Monter ${SECTION_LABELS[row.id]}` `` | `` `Move ${SECTION_LABELS[row.id]} up` `` |
| `` `Descendre ${SECTION_LABELS[row.id]}` `` | `` `Move ${SECTION_LABELS[row.id]} down` `` |
| `« Suggéré pour toi » et « Par chaîne suivie » ne s'affichent que pour les comptes connectés.` | `"Suggested for you" and "From channels you follow" only appear for signed-in accounts.` |
| `Bloc vedette` | `Featured block` |
| `Afficher le grand bloc en haut de l'accueil` | `Show the large block at the top of Home` |
| `Classement de « Populaires »` | `How "Popular" is ranked` |
| `Vidéos par rangée` | `Videos per row` |
| `Chaînes suivies affichées` | `Followed channels shown` |
| `{ to: '/channels', label: 'Chaînes' }` | `{ to: '/channels', label: 'Channels' }` |
| `{ to: '/subscriptions', label: 'Abonnements' }` | `{ to: '/subscriptions', label: 'Subscriptions' }` |
| `{ video: 'Vidéo', music: 'Musique', podcasts: 'Podcasts' }` | `{ video: 'Videos', music: 'Music', podcasts: 'Podcasts' }` |
| `"Échec de l'enregistrement de l'affichage."` | `'Could not save the display settings.'` |
| `recent: 'Ajoutés récemment'` | `recent: 'Recently added'` |
| `popular: 'Populaires'` | `popular: 'Popular'` |
| `suggested: 'Suggéré pour toi'` | `suggested: 'Suggested for you'` |
| `subscriptions: 'Par chaîne suivie'` | `subscriptions: 'From channels you follow'` |
| `label: 'Spectateurs locaux'` | `label: 'Local viewers'` |
| `label: 'Vues YouTube'` | `label: 'YouTube views'` |
| `label: 'Tendance 7 jours'` | `label: 'Trending (7 days)'` |
| `label: 'Temps de visionnage'` | `label: 'Watch time'` |

Then translate any remaining line the guard reports in that file (including French code comments) with the same plain style.

In `tests/component/DisplayPrefsForm.test.ts` lines 169-172, rename the test to `'lists the ranking options in order'` and change the expectation to `['Local viewers', 'YouTube views', 'Trending (7 days)', 'Watch time']`.

- [ ] **Step 4: Vocabulary sweep of the admin screens**

Run each grep; every match must be fixed with the glossary word on the right (expected after Tasks 3-11: no output):

```bash
grep -rnw "Track\|Tracking\|Suspended\|Pending\|Suivre" app/components/settings app/pages/settings.vue
grep -rn "Sync All Channels\|Max concurrent\|Worker Queue\|Pipeline Idle\|Danger Zone\|Search Platforms" app/components/settings app/pages/settings.vue
```

Glossary: Track/Tracking → Follow/Following; Suspended → Paused; Pending → Queued; Sync All Channels → Sync all; Max concurrent downloads → Simultaneous downloads; Danger Zone → Danger zone; Search Platforms → Search providers. Words inside identifiers (`track_count`, `trackId`, `pending` status values) are not user text — leave them.

- [ ] **Step 5: Run the guard and the touched tests to pass**

Run: `npx vitest run tests/unit/adminEnglishOnly.test.ts tests/component/DisplayPrefsForm.test.ts` — Expected: PASS.

- [ ] **Step 6: Mutation-check**

Temporarily add `<!-- Recherche -->` to `app/components/settings/LibraryTab.vue`; the guard must fail on that file. Remove it.

- [ ] **Step 7: Full suite, build, commit**

Run: `npx vitest run` and `npx nuxt build 2>&1 | tail -5`.

```bash
git add app/components/DisplayPrefsForm.vue tests/component/DisplayPrefsForm.test.ts tests/unit/adminEnglishOnly.test.ts app/components/settings app/pages/settings.vue
git commit -m "feat: admin screens in plain English with a guard test against French strings" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Real verification in Docker + Browser pane (controller-run)

**Files:** none (no commit). Record the outcome in `.superpowers/sdd/progress.md` if that file is used by the controller.

**Interfaces:**
- Consumes: everything above; Docker (`Dockerfile`, default port 3000 inside the container), the setup/login routes `POST /api/auth/setup`, `POST /api/auth/login`, CSRF header `x-csrf-token` from the `csrf_token` cookie.
- Produces: a pass/fail report per scenario; any real bug → stop and report BLOCKED with expected vs actual, commands and output.

Notes: zsh does not word-split unquoted variables — write commands without relying on `$VAR` splitting. Use the Browser pane with `resize_window` preset `desktop` before any real form interaction (typing/clicking). Logging in by `fetch` from the page is acceptable.

- [ ] **Step 1: Build and start a clean container**

```bash
cd /Users/light/Git/youkeep
docker build -t youkeep-test .
docker volume create ykd6 >/dev/null; docker volume create ykv6 >/dev/null; docker volume create ykm6 >/dev/null; docker volume create ykp6 >/dev/null
docker run --rm -v ykv6:/v -v ykm6:/m -v ykp6:/p alpine chown 99:100 /v /m /p
docker run -d --name ykt -p 3999:3000 -e PUID=99 -e PGID=100 -v ykd6:/app/data -v ykv6:/downloads/videos -v ykm6:/downloads/music -v ykp6:/downloads/podcasts youkeep-test
sleep 8
curl -s -X POST http://localhost:3999/api/auth/setup -H 'Content-Type: application/json' -d '{"username":"admin","password":"testtest123"}' >/dev/null
curl -s -c /tmp/a.txt -X POST http://localhost:3999/api/auth/login -H 'Content-Type: application/json' -d '{"username":"admin","password":"testtest123"}' >/dev/null
grep csrf_token /tmp/a.txt | awk '{print $NF}'
```

Expected: a CSRF token is printed.

- [ ] **Step 2: Server contract checks (curl)**

```bash
A=$(grep csrf_token /tmp/a.txt | awk '{print $NF}')
curl -s -b /tmp/a.txt http://localhost:3999/api/admin/music/queue | python3 -c "import sys,json; d=json.load(sys.stdin); print('music queueTotal' , d.get('queueTotal'))"
curl -s -b /tmp/a.txt http://localhost:3999/api/admin/podcasts/queue | python3 -c "import sys,json; d=json.load(sys.stdin); print('podcast queueTotal', d.get('queueTotal'))"
curl -s -b /tmp/a.txt -H "x-csrf-token: $A" -X POST http://localhost:3999/api/admin/music/sync-all; echo
curl -s -b /tmp/a.txt -H "x-csrf-token: $A" -X POST http://localhost:3999/api/admin/podcasts/sync-all; echo
```

Expected: both `queueTotal` are integers (`0` on a fresh DB); both sync-all calls return `{"success":true,…}`.

- [ ] **Step 3: Library — follow a channel, an artist and a podcast (Browser pane, real UI)**

Open `http://localhost:3999/login` in the Browser pane, `resize_window` preset `desktop`, log in as `admin`/`testtest123`, go to Settings.
1. Tabs read Overview, Library, Downloads, Users, System; no French on any tab.
2. Library → Videos: type `jawed` in the search box, press Search, click **Follow** on the "jawed" channel once. Expect a success toast, the results disappear, and "jawed" appears under **Following** with "Active". Open **Options for new follows** first and confirm the defaults: Sync automatically on, Visibility Public, Videos on, Shorts off, Live recordings off, Save folder `/downloads/videos`.
3. Library → Music: search an artist (e.g. `Daft Punk`), click **Follow** once → it appears under Following with a track count; its visibility is a read-only badge (no select).
4. Library → Podcasts: search `Planet Money`, click **Follow** once → it appears under Following.
5. On the jawed row, change visibility to Private (select) → toast, value stays Private after reload; click **Edit options** → the modal shows the channel's current options; close it.
6. Take a screenshot of the Library tab with the three Following lists.

- [ ] **Step 4: Downloads — mixed queue, filters, one loop**

1. Go to Downloads. Expect three type cards (Videos, Music, Podcasts) with Active/Paused, Pause, "Simultaneous downloads" + Save.
2. With the follows from Step 3 the queue contains items of several types: confirm downloading items are listed first whatever their type, each card has a type pill, statuses read Queued/Downloading/Failed, and the filter buttons show counts for All/Videos/Music/Podcasts that add up.
3. Click each filter and confirm only that type is listed. If a type has more than 100 items, confirm the line "Showing the first 100 of N"; otherwise seed one: `docker exec ykt sh -c "sqlite3 /app/data/youkeep.db \"WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<150) INSERT INTO podcast_episodes (id, show_id, title, audio_url, download_status, created_at) SELECT 'seed'||i, (SELECT id FROM podcast_shows LIMIT 1), 'Seed '||i, 'https://example.invalid/'||i||'.mp3', 'pending', 0 FROM n;\""` (if `sqlite3` is missing in the image, skip and note it) then reload Downloads → Podcasts filter shows "Showing the first 100 of N" with N ≥ 150.
4. Pause the Podcasts card → state "Paused", toast; Resume → "Active".
5. In the page run `performance.getEntriesByType('resource').map(e => e.name).filter(n => /\/api\/admin\/(downloader|music|podcasts)\/queue/.test(n)).length` twice 6 s apart while idle: the growth must be about 2 per type per 6 s (one loop at 3 s), not more.
6. Open **Advanced**: three schedules (Videos/Music/Podcasts), sponsor segments, music video clips toggle. Open the Overview tab: the Activity card shows downloading/queued per type and a working "Open Downloads" link; the Downloads tab button shows a badge while something downloads.

- [ ] **Step 5: Legacy links**

Navigate to each URL and check the tab/section shown:
- `/settings?tab=stats` → Overview
- `/settings?tab=music` → Library, Music section open and scrolled into view, Videos/Podcasts collapsed
- `/settings?tab=podcasts` → Library, Podcasts section open
- `/settings?tab=downloads` → Downloads (filter All)
- `/settings?tab=library&section=videos` → Library, Videos open
- `/settings?tab=nonsense` → Overview
- `/admin/downloader` → redirects to Downloads

- [ ] **Step 6: Failed-save resync (server stopped)**

With the Downloads tab open, run `docker stop ykt`. Then in the UI: change Videos "Simultaneous downloads" to 5 and press Save → error toast; the input must show the last saved value again (or stay as typed only if the reload also failed — note which). Go to Library (page already loaded): turn off a Following switch → error toast and the switch goes back to its previous state; change the jawed visibility select → error toast and the select goes back. Toggle "Music video clips" in Advanced → error toast and the box goes back. The Downloads type cards show "Couldn't load the … queue. Retrying automatically." while the server is down. `docker start ykt`, wait 10 s: the error messages disappear on their own.

- [ ] **Step 7: English check**

Run in the page on each of the five tabs: `document.querySelector('.settings-content').innerText.match(/[àâçéèêëîïôùûüœ]|Suivre|Recherche|Affichage|Musique/g)` → expect `null` (user-entered data such as channel or artist names may contain accents; ignore those and note them).

- [ ] **Step 8: Clean up and run the full suite**

```bash
docker rm -f ykt >/dev/null 2>&1; docker rmi youkeep-test >/dev/null 2>&1
docker volume rm ykd6 ykv6 ykm6 ykp6 >/dev/null 2>&1; rm -f /tmp/a.txt
npx vitest run
```

Expected: all tests PASS. No commit for this task. Reset the Browser pane with `resize_window` preset `desktop` if a different size was set.

---

## Plan self-review

**Spec coverage**

- Tabs overview/library/downloads/users/system + legacy `?tab=` (stats, music, podcasts, unknown) normalised on load and on change → Task 2 (`normalizeSettingsTab`, `settings.vue` watch), verified live in Task 13 Step 5.
- Existing callers (`?tab=downloads` in `ChannelDirectoryView.vue`, `index.vue`, `admin/downloader.vue`) unchanged → Task 2 Step 11.
- Overview = dashboard + Activity card (per-type downloading from `active-counts`, total queued, link to Downloads), English copy → Task 10.
- Library: three sections in fixed order, one generic component driven by per-type config → Tasks 3, 4, 5. Title + one sentence; search or pasted URL/handle/feed; one-click Follow; re-entrancy guard; results kept on failure and cleared on success → Task 3 (tests + mutation-checks), Task 4 for Videos. "Options for new follows" collapsed (auto-sync + visibility for all; content types, start date, save folder for Videos; defaults as today) replacing the Track modal → Tasks 3-4. Following list with count, pause/resume switch (`pause`/`sync` routes), Sync now, visibility editable for channels / read-only badge for artists and shows, link to the source page, "Edit options" for channels (`options.put`) → Tasks 3-4. Videos list from the channels API → Task 4. Sync all per section → Task 3 (+ Task 1 routes for music/podcasts). Deep link `?tab=library&section=` scrolls and expands → Task 5.
- Downloads: three identical type cards (state, Pause/Resume, Simultaneous downloads + Save, N failed + Retry) → Task 7; filter with counts, single list ordered downloading → queued interleaved → failed, type pill, title, source, progress, speed, ETA, Prioritize/Cancel → Tasks 6-7, 9; cap 100 + "Showing the first 100 of N" from route totals, `queueTotal` on music/podcast routes → Tasks 1, 6, 9; per-type Clear queue (Videos only, the only route that exists) and "Nothing is downloading" → Task 7; Advanced (schedules per type, SponsorBlock, music clips) → Task 8; one polling loop (500 ms / 3 s) replacing the three loops, badge on the Downloads tab, sidebar unchanged → Tasks 2, 6, 9; one shared queue-card component → Task 7.
- Users unchanged behaviour, English copy → Task 11. System regrouped (Modules, Default display, Search providers incl. the old "Recherche" block, Tools & logs collapsed, Danger zone collapsed with confirmations kept) → Task 11.
- Vocabulary and "all French strings translated" for admin screens + guard test with allowlist → Task 12 (plus copy written in English in every earlier task).
- Error handling: failed Follow keeps results (Task 3); per-row pause/sync/visibility toast + resync (Tasks 3-4); one failing queue route = that card in error, others keep working (Tasks 6, 7, 9); unknown tab → overview (Task 2).
- Testing section: component tests per type (Tasks 3-4), Downloads tab (Task 9) incl. filter counts, ordering, cap line, type-card pause/concurrency, retry (Task 7), tab normalisation (Task 2); server `queueTotal` tests (Task 1); French guard (Task 12); real verification scenarios (Task 13: follow channel/artist/podcast, Following lists, mixed queue with filters, legacy links, failed-save resync with `docker stop`).
- Old `SettingsDownloadsTab`/`SettingsMusicTab`/`SettingsPodcastsTab` removed once replaced → Task 9.

**Placeholder scan:** no "TBD"/"similar to"/"add error handling" left. The only "move lines X-Y verbatim" instructions are in Task 11 (System template), each with the exact new wrapper, the identifiers that must keep working and every copy change listed.

**Type/name consistency (checked across tasks):**
- `SettingsTab`, `LibrarySection`, `LIBRARY_SECTIONS`, `normalizeSettingsTab` — defined Task 2, used Tasks 3 (`SourceKind = LibrarySection`), 5, 9.
- `useActiveCounts` → `counts`, `downloadingTotal`, `queuedTotal`, `fetchActiveCounts` — Task 2, used Tasks 9 and 10.
- `LibrarySourceConfig` fields (`followTarget`, `directTarget`, `buildIngestBody`, `readFollowing`, `pauseUrl`, `syncUrl`, `syncAllEndpoint`, `syncAllStartedMessage`, `visibilityUrl`, `hasVideoOptions`) — Task 3, consumed by the component in Tasks 3-4 and by `videosSource` in Task 4; `LIBRARY_SOURCES` — Task 4, used Task 5.
- `LibrarySourceSection` locals extended in Task 4 (`options`, `rows`, `busyRowId`, `loadFollowing`, `toast`, `rowAfterReload`, `onMounted`) — all defined in Task 3's code.
- `DownloadKind` is `'video' | 'music' | 'podcast'` (queue side) while `SourceKind` is `'videos' | 'music' | 'podcasts'` (library side) and `active-counts` keys are `video`/`music`/`podcasts`; each is used only inside its own area, and filter test ids use `DownloadKind` (`filter-podcast`, `type-card-podcast`).
- Composable state additions (`queueError`, `musicQueueTotal`, `musicQueueError`, `podcastQueueTotal`, `podcastQueueError`) — Task 6; their `useState` keys match the test reset lists in Tasks 6 and 9.
- `useAllDownloads` return names (`filter`, `states`, `counts`, `visible`, `notice`, `progressFor`, `refreshAll`, `startPolling`, `stopPolling`) — Task 6, destructured identically in Task 9.
- Component props/emits: `DownloadQueueCard {item, progress} → action`, `DownloadQueueList {items, progressFor} → action(item, action)`, `DownloadTypeCard {kind, state} → changed`, `ScheduleForm {title, endpoint, presets, dailyLabel, weeklyLabel, idPrefix}`, `ChannelOptionsModal {channelId, channelName} → close, saved`, `LibraryTab {section}` — consistent between definition and use.
