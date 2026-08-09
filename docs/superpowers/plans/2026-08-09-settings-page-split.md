# Settings Page Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the 4133-line `app/pages/settings.vue` (which mixes 5 distinct admin concerns — Dashboard/Stats, Downloads, Music, System, Users — in one file) into 5 focused tab components plus 3 shared composables, with the parent page reduced to page structure, tab-switching, and the two cross-tab polling loops. This is a pure structural refactor: every existing feature, button, form, and polling/refresh cadence must work identically afterward.

**Architecture:** `app/pages/settings.vue` becomes a thin shell: page title, tab sidebar (with live badge counts), `activeTab` state synced to `route.query.tab`, admin/redirect gating, and the two setInterval-style polling loops (`runPolling` for the video download queue, `runMusicPolling` for the music queue) that run continuously for as long as Settings is open, independent of which tab is active. Each tab's UI (template + local script state) moves verbatim into its own component under `app/components/settings/`. Three new `useState`-backed composables hold the state that is genuinely shared across tabs or needed by the parent's polling loops: `useDownloadsQueue()` (video queue, smoothed progress bars, and — per a cross-tab dependency found only by reading the full script, see Task 1 — the yt-dlp diagnostics log used by the System tab but populated by the Downloads-tab polling loop), `useMusicQueue()` (music queue/artists/history), and `useAdminChannels()` (the shared channel list *and*, per another dependency found the same way, the admin dashboard stats used by both the Stats tab and two Downloads-tab handlers).

**Tech Stack:** Nuxt 4, Vue 3 Composition API, TypeScript

## Global Constraints

- No behavior changes anywhere — every button/form/polling cadence must work identically after the split.
- No changes to `app/pages/channels.vue`.
- Do not fix the pre-existing `allowedTabs` omission of `'music'` — leave that bug exactly as-is.
- No new state-management dependency — use the existing `useState`-based composable pattern only.
- Zero Vue component test infrastructure exists in this codebase (project-wide, accepted gap) — every task's verification step is manual only, via the running dev server. Task 9's manual verification must explicitly include: (a) sidebar badges updating live while viewing a different tab, (b) polling loops and the RAF smoothing loop actually stopping when navigating away from Settings entirely (no console errors, no lingering requests).

## Notes on deviations from the original design brief (read during full-file review, applied throughout this plan)

Reading `app/pages/settings.vue` end-to-end (not just the template's clean tab boundaries) surfaced three cross-tab couplings beyond the one the approved design spec already called out (`channels`/`channelsData` also used by the Users tab):

1. **`refreshStats()` is called from the Downloads tab, not just the Stats tab.** `handleSyncAll` (line 1634) and `submitIngestModal` (line 1885) — both Downloads-tab handlers — call `refreshStats()` so the dashboard numbers are fresh the next time the user looks at Stats. Since `stats`/`refreshStats` originate from a `useFetch('/api/admin/stats')` call, and the Downloads tab component can be mounted while the Stats tab component is not, `stats`/`refreshStats` must live in the same shared place as `channels` — so `useAdminChannels()` (Task 3) exposes `stats`/`refreshStats` in addition to `channels`, despite its name.
2. **The System tab's yt-dlp diagnostics log is written by the Downloads-tab's root-level polling loop, not just by a button click.** `runPolling` (line 2169) calls `fetchDiagnostics()` whenever `activeDownloadCount.value > 0`, regardless of which tab is active. `diagnosticLogs`/`diagnosticYtdlPath` are rendered only by the System tab's template, but they must be populated by a function the *parent* can call at any time — including while the System tab component is unmounted. So `diagnosticLogs`, `diagnosticYtdlPath`, and `fetchDiagnostics()` move into `useDownloadsQueue()` (Task 1) instead of staying local to the System tab. The System tab keeps its own local `terminalBody` template ref and a `watch()` on the composable's `diagnosticLogs` to reproduce the original auto-scroll-on-update behavior.
3. **The video-download schedule form's template lives inside the Downloads tab's template block, but its script was filed under a `/* 3. CONFIGURATION TAB */` comment positioned near the System-tab script.** The numbered script comments in the original file do not reliably mirror template boundaries (the design spec already knew this was true for Music; it turns out to also be true here). `scheduleForm`, `presets`, `applyPreset`, `fetchSchedule`, `handleSaveSchedule`, `savingSchedule`, `scheduleMessage` all render inside the Downloads tab's "Archiving Policy & Scheduling" panel (original lines 386–422), so they move to `SettingsDownloadsTab.vue` (Task 5), not `SettingsSystemTab.vue` (Task 7).

Additionally: the original page's `onMounted` eagerly fires several one-time setting fetches (`fetchSchedule`, `fetchDefaultDir`, `fetchSponsorBlockSettings`, `fetchConcurrency`, `fetchMusicConcurrency`, `fetchMusicModuleEnabled`, `fetchMusicDownloadClipsEnabled`, `fetchMusicSchedule`) regardless of which tab is initially active, because everything lived in one component. None of these values are part of the three shared composables (by design — they're purely local to one tab's own form UI), so under the split they naturally belong in each tab component's own `onMounted()` instead. This means: (a) they now fire only once *the user visits that tab* rather than unconditionally on page load, and (b) if the user leaves and returns to a tab, its component remounts (`v-if`) and re-fetches. Both are harmless — the values shown are always correct, no behavior a user can observe differs, and this is standard idiomatic Vue for state that belongs to one component. This is called out again in Tasks 5 and 6.

---

## Task 1: `app/composables/useDownloadsQueue.ts`

**Files:**
- Create: `app/composables/useDownloadsQueue.ts`

**Interfaces:**
- Consumes: nothing (wraps `$fetch` calls directly, same as the original page).
- Produces (consumed by Task 5 `SettingsDownloadsTab.vue`, Task 7 `SettingsSystemTab.vue`, and Task 9 parent `settings.vue`):
  - `queue: Ref<any[]>`
  - `failedCount: Ref<number>`
  - `isPaused: Ref<boolean>`
  - `smoothProgress: Ref<Record<string, number>>`
  - `activeDownloadCount: ComputedRef<number>`
  - `diagnosticLogs: Ref<string[]>`
  - `diagnosticYtdlPath: Ref<string>`
  - `fetchQueue: () => Promise<void>`
  - `fetchDiagnostics: () => Promise<void>`
  - `stopSmoothProgressLoop: () => void`

- [ ] **Step 1: Create the composable file**

Create `app/composables/useDownloadsQueue.ts` with this exact content:

```ts
export function useDownloadsQueue() {
  const queue = useState<any[]>('settings_downloads_queue', () => []);
  const failedCount = useState<number>('settings_downloads_failed_count', () => 0);
  const isPaused = useState<boolean>('settings_downloads_is_paused', () => false);
  const smoothProgress = useState<Record<string, number>>('settings_downloads_smooth_progress', () => ({}));
  const progressRates = useState<Record<string, number>>('settings_downloads_progress_rates', () => ({}));
  const diagnosticLogs = useState<string[]>('settings_downloads_diagnostic_logs', () => []);
  const diagnosticYtdlPath = useState<string>('settings_downloads_diagnostic_ytdl_path', () => '');

  const activeDownloadCount = computed(() => {
    return queue.value.filter((v: any) => v.download_status === 'downloading').length;
  });

  let lastFrameTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
  let animationFrameId: any = null;

  const updateSmoothProgress = (now: number) => {
    const dt = now - lastFrameTime;
    lastFrameTime = now;

    let hasActive = false;
    queue.value.forEach((video: any) => {
      const id = video.id;
      const target = video.download_progress || 0;

      if (video.download_status !== 'downloading') {
        smoothProgress.value[id] = target;
        return;
      }

      if (smoothProgress.value[id] === undefined) {
        smoothProgress.value[id] = target;
      }

      const rate = progressRates.value[id] || 0;
      const currentSmooth = smoothProgress.value[id] ?? target;
      if (rate > 0 && currentSmooth < target) {
        const nextProgress = currentSmooth + rate * dt;
        smoothProgress.value[id] = Math.min(nextProgress, target);
        if (smoothProgress.value[id]! < target) {
          hasActive = true;
        }
      }
    });

    if (hasActive || activeDownloadCount.value > 0) {
      animationFrameId = requestAnimationFrame(updateSmoothProgress);
    } else {
      animationFrameId = null;
    }
  };

  watch(() => queue.value, () => {
    queue.value.forEach((video: any) => {
      const id = video.id;
      const target = video.download_progress || 0;

      if (video.download_status !== 'downloading') {
        smoothProgress.value[id] = target;
        progressRates.value[id] = 0;
        return;
      }

      if (smoothProgress.value[id] === undefined) {
        smoothProgress.value[id] = target;
      }

      const currentSmooth = smoothProgress.value[id] ?? target;
      const diff = target - currentSmooth;

      if (diff < -2 || Math.abs(diff) > 40 || target === 0 || target === 100) {
        smoothProgress.value[id] = target;
        progressRates.value[id] = 0;
      } else if (diff > 0) {
        progressRates.value[id] = diff / 1000;
      } else {
        progressRates.value[id] = 0;
      }
    });

    if (!animationFrameId && activeDownloadCount.value > 0) {
      lastFrameTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
      updateSmoothProgress(lastFrameTime);
    }
  }, { deep: true });

  function stopSmoothProgressLoop() {
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
  }

  const fetchQueue = async () => {
    try {
      const data = await $fetch<any>('/api/admin/downloader/queue');
      queue.value = data.queue || [];
      failedCount.value = data.failedCount || 0;
      isPaused.value = data.isPaused || false;
    } catch (err) {
      console.error('Failed to fetch downloader queue:', err);
    }
  };

  const fetchDiagnostics = async () => {
    try {
      const data = await $fetch<any>('/api/admin/downloader/logs');
      diagnosticLogs.value = data.logs || [];
      diagnosticYtdlPath.value = data.ytdlPath || '';
    } catch (err) {
      console.error('Failed to fetch logs:', err);
    }
  };

  return {
    queue, failedCount, isPaused, smoothProgress, activeDownloadCount,
    diagnosticLogs, diagnosticYtdlPath,
    fetchQueue, fetchDiagnostics, stopSmoothProgressLoop,
  };
}
```

Note: `useState`, `computed`, `watch`, and `$fetch` are all Nuxt/Vue auto-imports — no explicit `import` statements are needed, matching the existing convention in `app/composables/useMusicPlayer.ts` (which has zero imports at the top of the file).

The `progressRates` internal ref and the `updateSmoothProgress`/`lastFrameTime`/`animationFrameId` RAF-loop internals are **not** returned — they are private implementation details of the smoothing behavior, exactly as they were module/closure-local in the original page (just closure-scoped inside this function instead). Only `stopSmoothProgressLoop()` is exposed, for the parent's `onUnmounted` safety net (Task 9).

- [ ] **Step 2: Typecheck**

This repo has no `typecheck` npm script (confirmed by reading `package.json`) and `npx nuxi typecheck` currently fails in this environment with a pre-existing, unrelated error (`vue-tsc`/`typescript` version mismatch inside the npx cache — not caused by this change). Use `npm run build` as the verification command for every step in this plan instead; it exercises the full Nuxt/Vite compilation pipeline (including `<script setup lang="ts">` type stripping) and will fail loudly on a syntax or import error.

Run:
```bash
cd /Users/light/Git/youkeep && npm run build
```
Confirm it ends with `✨ Build complete!` and no errors mentioning `useDownloadsQueue`.

- [ ] **Step 3: Commit**

```bash
cd /Users/light/Git/youkeep && git add app/composables/useDownloadsQueue.ts && git commit -m "$(cat <<'EOF'
feat: extract useDownloadsQueue composable from settings.vue

First step of the settings.vue split (5 tab components + 3 shared
composables). Wraps the video download queue, progress-bar smoothing
RAF loop, and yt-dlp diagnostics log fetch (the latter is read only by
the System tab but written by the Downloads-tab polling loop, so it
must live in shared state rather than local component state).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `app/composables/useMusicQueue.ts`

**Files:**
- Create: `app/composables/useMusicQueue.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (consumed by Task 6 `SettingsMusicTab.vue` and Task 9 parent `settings.vue`):
  - `musicQueue: Ref<any[]>`
  - `musicHistory: Ref<any[]>`
  - `musicArtists: Ref<any[]>`
  - `musicIsPaused: Ref<boolean>`
  - `musicFailedCount: Ref<number>`
  - `musicActiveDownloadCount: ComputedRef<number>`
  - `fetchMusicQueue: () => Promise<void>`

- [ ] **Step 1: Create the composable file**

Create `app/composables/useMusicQueue.ts` with this exact content:

```ts
export function useMusicQueue() {
  const musicQueue = useState<any[]>('settings_music_queue', () => []);
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
      musicHistory.value = data.history || [];
      musicArtists.value = data.artists || [];
      musicIsPaused.value = data.isPaused || false;
      musicFailedCount.value = data.failedCount || 0;
    } catch (err) {
      console.error('Failed to fetch music queue:', err);
    }
  };

  return {
    musicQueue, musicHistory, musicArtists, musicIsPaused, musicFailedCount, musicActiveDownloadCount,
    fetchMusicQueue,
  };
}
```

Note: `musicHistory` is populated by the API response (`data.history`) but is never read anywhere in the original template or script — it's carried over verbatim for fidelity (this is a pure structural refactor; nothing is deleted just because it looks unused) rather than dropped as dead code.

- [ ] **Step 2: Build check**

```bash
cd /Users/light/Git/youkeep && npm run build
```
Confirm `✨ Build complete!` with no errors mentioning `useMusicQueue`.

- [ ] **Step 3: Commit**

```bash
cd /Users/light/Git/youkeep && git add app/composables/useMusicQueue.ts && git commit -m "$(cat <<'EOF'
feat: extract useMusicQueue composable from settings.vue

Second step of the settings.vue split. Wraps the music download
queue, artist list, and history — mirrors useDownloadsQueue.ts but
has no progress-smoothing RAF logic (the Music tab's template renders
track.download_progress raw, confirmed by reading the full template).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `app/composables/useAdminChannels.ts`

**Files:**
- Create: `app/composables/useAdminChannels.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (consumed by Task 4 `SettingsStatsTab.vue`, Task 5 `SettingsDownloadsTab.vue`, and Task 8 `SettingsUsersTab.vue`):
  - `stats: Ref<any>` (from `useFetch('/api/admin/stats')`)
  - `refreshStats: () => Promise<void>`
  - `channelsData: Ref<{ channels: any[] } | null>`
  - `channels: ComputedRef<any[]>`
  - `refreshChannels: () => Promise<void>`

Despite the name (kept as-is per the task list), this composable ended up covering two pieces of shared admin data, not just channels — see the "Notes on deviations" section above: `handleSyncAll` and `submitIngestModal` (both in the Downloads tab, Task 5) call `refreshStats()` after a sync/ingest completes, so `stats`/`refreshStats` must be reachable from the Downloads tab even though only the Stats tab renders `stats` itself.

- [ ] **Step 1: Create the composable file**

Create `app/composables/useAdminChannels.ts` with this exact content:

```ts
export async function useAdminChannels() {
  const { data: stats, refresh: refreshStats } = await useFetch<any>('/api/admin/stats');
  const { data: channelsData, refresh: refreshChannels } = await useFetch<{ channels: any[] }>('/api/channels');
  const channels = computed(() => channelsData.value?.channels || []);

  return {
    stats, refreshStats,
    channelsData, channels, refreshChannels,
  };
}
```

This is declared `async` and awaits both `useFetch` calls internally (matching the original page's top-level `await useFetch(...)` blocking behavior) so that whichever tab component calls it — via `const { ... } = await useAdminChannels();` in its own `<script setup>` — doesn't render until the data has resolved, exactly as today. Every consumer calls this same composable function body (same file, same call sites), so Nuxt's default auto-generated `useFetch` key (derived from source location) is identical across all callers, meaning `/api/admin/stats` and `/api/channels` are fetched once and the resulting reactive refs are shared — not re-fetched per tab. This satisfies the design's "Stats and Users share one fetch instead of each doing its own" goal without needing an explicit `key` option (there's no existing precedent for explicit `useFetch` keys in this codebase — `app/pages/channels.vue` doesn't use one either).

One consequence worth calling out: because `useAdminChannels()` is now only invoked by whichever of Stats/Downloads/Users tab components actually mounts, `/api/admin/stats` and `/api/channels` are fetched lazily on first need (first time the user visits one of those three tabs) rather than unconditionally on page load (as the single-file original did). If the user's initial tab is System, for example, neither fetch fires until they switch to Stats, Downloads, or Users. This is invisible to the user — by the time any of those tabs' templates render, the `await` has already resolved — and is an accepted, documented side effect of the composable-per-consumer pattern (see "Notes on deviations" above).

- [ ] **Step 2: Build check**

```bash
cd /Users/light/Git/youkeep && npm run build
```
Confirm `✨ Build complete!` with no errors mentioning `useAdminChannels`.

- [ ] **Step 3: Commit**

```bash
cd /Users/light/Git/youkeep && git add app/composables/useAdminChannels.ts && git commit -m "$(cat <<'EOF'
feat: extract useAdminChannels composable from settings.vue

Third and final shared composable for the settings.vue split. Wraps
the channel list (shared by the Stats and Users tabs) and, per a
second cross-tab dependency found while reading the full script, the
admin dashboard stats fetch/refresh (refreshStats is called from two
Downloads-tab handlers after a sync/ingest completes).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `app/components/settings/SettingsStatsTab.vue`

**Files:**
- Create: `app/components/settings/SettingsStatsTab.vue`

**Interfaces:**
- Consumes: `useAdminChannels()` (Task 3) for `stats` and `channels`.
- Produces: nothing consumed by other tasks (this is a leaf tab component).

This is the Dashboard/Stats tab's template (original lines 66–229) and script (original lines 1195–1222, the `/* 1. STATS TAB */` region, minus the `channelsData`/`channels` `useFetch` call which now comes from `useAdminChannels()`, and plus `formatBytes` — originally filed at the bottom of the script under "Helper formats" but used only by this tab, per grep confirmation that `formatBytes` appears nowhere outside the Stats tab template).

- [ ] **Step 1: Create the component file**

Create `app/components/settings/SettingsStatsTab.vue` with this exact content:

```vue
<template>
  <div class="tab-pane">
    <!-- Premium Welcome & Summary Banner -->
    <div class="dashboard-banner glass-panel">
      <div class="banner-content">
        <span class="system-status-badge">
          <span class="pulse-dot"></span>
          System Online & Syncing
        </span>
        <h2>Library Diagnostic Dashboard</h2>
        <p>Comprehensive overview of local storage consumption, catalog data, and channel archiving metrics.</p>
      </div>
      <div class="banner-quick-stats">
        <div class="quick-stat-item">
          <span class="stat-number text-gradient">{{ formatViews(stats?.totalViews || 0) }}</span>
          <span class="stat-label">Catalog Views</span>
        </div>
        <div class="quick-stat-divider"></div>
        <div class="quick-stat-item">
          <span class="stat-number">{{ stats?.totalComments?.toLocaleString() || 0 }}</span>
          <span class="stat-label">Indexed Comments</span>
        </div>
        <div class="quick-stat-divider"></div>
        <div class="quick-stat-item">
          <span class="stat-number" :class="{ 'text-accent': (stats?.totalQueue || 0) > 0 }">{{ stats?.totalQueue || 0 }}</span>
          <span class="stat-label">Queue Tasks</span>
        </div>
      </div>
    </div>

    <!-- Quick Metrics Grid -->
    <div class="metrics-grid">
      <!-- Archived Videos Card -->
      <div class="metric-card glass-panel glow-purple">
        <div class="metric-card-header">
          <span class="metric-label">Archived Videos</span>
          <div class="metric-icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 7l-7 5 7 5V7z"></path><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect></svg>
          </div>
        </div>
        <span class="metric-value">{{ stats?.totalVideos?.toLocaleString() || 0 }}</span>
        <div class="metric-sub">Videos locally cataloged & verified</div>
      </div>

      <!-- Media Disk Space Card -->
      <div class="metric-card glass-panel glow-blue">
        <div class="metric-card-header">
          <span class="metric-label">Media Disk Space</span>
          <div class="metric-icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect><rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect><line x1="6" y1="6" x2="6.01" y2="6"></line><line x1="6" y1="18" x2="6.01" y2="18"></line></svg>
          </div>
        </div>
        <span class="metric-value text-gradient">{{ formatBytes(stats?.mediaSize || 0) }}</span>
        <div class="metric-sub">Total space used by MP4/JPG files</div>
      </div>

      <!-- Archived Duration Card -->
      <div class="metric-card glass-panel glow-green">
        <div class="metric-card-header">
          <span class="metric-label">Archived Duration</span>
          <div class="metric-icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
          </div>
        </div>
        <span class="metric-value">{{ formatSecondsToHours(stats?.totalDuration || 0) }}</span>
        <div class="metric-sub">Cumulative playback playtime</div>
      </div>

      <!-- SQLite Database Card -->
      <div class="metric-card glass-panel glow-pink">
        <div class="metric-card-header">
          <span class="metric-label">SQLite Database</span>
          <div class="metric-icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"></ellipse><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path><path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3"></path></svg>
          </div>
        </div>
        <span class="metric-value">{{ formatBytes(stats?.dbSize || 0) }}</span>
        <div class="metric-sub">Metadata & search indexing database</div>
      </div>
    </div>

    <!-- Graphs & Storage Breakdown Row -->
    <div class="stats-row">
      <!-- Channels breakdown (Left Column) -->
      <div class="stats-col glass-panel">
        <div class="col-header">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--accent-primary);"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
          <h3>Top Channels (by videos)</h3>
        </div>
        <div v-if="channels.length === 0" class="stats-empty">
          No channels found. Start tracking channels to view archiving metrics.
        </div>
        <div v-else class="stats-list">
          <div 
            v-for="ch in sortedChannels" 
            :key="ch.id" 
            class="stats-list-item"
          >
            <div class="stats-item-info">
              <div class="stats-item-title-col">
                <span class="item-title" :title="ch.title">{{ ch.title }}</span>
                <span v-if="ch.visibility" :class="['visibility-tag mini-tag', ch.visibility]">{{ ch.visibility }}</span>
              </div>
              <span class="item-count">{{ ch.completed_count }} / {{ ch.total_count }} videos</span>
            </div>
            <!-- Progress Bar -->
            <div class="stats-item-bar-bg">
              <div 
                class="stats-item-bar" 
                :style="{ width: getPercentage(ch.completed_count, ch.total_count) + '%' }"
              ></div>
            </div>
          </div>
        </div>
      </div>

      <!-- Diagnostics & Storage Breakdown (Right Column) -->
      <div class="stats-col glass-panel diagnostic-panel">
        <div class="col-header">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--accent-secondary);"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
          <h3>Infrastructure & Analytics</h3>
        </div>
        
        <div class="diagnostic-list">
          <div class="diag-item">
            <div class="diag-label">Active tracked channels</div>
            <div class="diag-value font-highlight">{{ stats?.totalChannels || 0 }} channels</div>
          </div>
          
          <div class="diag-item">
            <div class="diag-label">Total YouTube catalog views</div>
            <div class="diag-value">{{ formatViews(stats?.totalViews || 0) }} views</div>
          </div>

          <div class="diag-item">
            <div class="diag-label">Comments database load</div>
            <div class="diag-value">{{ stats?.totalComments?.toLocaleString() || 0 }} rows</div>
          </div>

          <div class="diag-item">
            <div class="diag-label">Pending sync downloads</div>
            <div class="diag-value" :class="{ 'warning-highlight': (stats?.totalQueue || 0) > 0 }">
              {{ stats?.totalQueue || 0 }} in queue
            </div>
          </div>

          <div class="diag-item">
            <div class="diag-label">Database indexing engine</div>
            <div class="diag-value">better-sqlite3 v9.x</div>
          </div>
        </div>

        <div class="diagnostic-check">
          <div class="check-radar">
            <span class="radar-dot"></span>
            <span class="radar-ring"></span>
          </div>
          <div class="check-text">
            <h4>All Services Operational</h4>
            <p>Archiver engine listening for sync triggers.</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useAdminChannels } from '~/composables/useAdminChannels';

const { stats, channels } = await useAdminChannels();

const sortedChannels = computed(() => {
  return [...channels.value]
    .sort((a, b) => (b.completed_count || 0) - (a.completed_count || 0))
    .slice(0, 5);
});

const getPercentage = (count: number, total: number) => {
  if (!total) return 0;
  return Math.min(Math.round((count / total) * 100), 100);
};

const formatSecondsToHours = (secs: number) => {
  if (!secs) return '0h';
  const hours = Math.round(secs / 3600);
  return `${hours.toLocaleString()} h`;
};

const formatViews = (views: number) => {
  if (!views) return '0';
  if (views >= 1000000) return (views / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (views >= 1000) return (views / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return views.toLocaleString();
};

const formatBytes = (bytes: number) => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};
</script>
```

Note: the outer `<div>`'s original `v-if="activeTab === 'stats' && isAdmin"` is dropped — the parent (`settings.vue`, Task 9) now controls both conditions by only rendering `<SettingsStatsTab v-if="activeTab === 'stats'" />` at all, and the page-level `isAdmin` gate already redirects non-admins to `/account` before any tab can render (original line 1179-1181), so the per-tab `&& isAdmin` check was always redundant once that redirect fires.

No `<style>` block is added here — all CSS for every tab stays in the parent `settings.vue` as a single unscoped stylesheet (see Task 9's note on why scoped CSS can't be split across component boundaries this way).

- [ ] **Step 2: Build check**

```bash
cd /Users/light/Git/youkeep && npm run build
```
Confirm `✨ Build complete!`. Note: this component alone is not yet wired into `settings.vue` (that happens in Task 9), so the build succeeding just confirms the `.vue` file itself compiles — Nuxt auto-imports it but nothing references `<SettingsStatsTab>` yet.

- [ ] **Step 3: Commit**

```bash
cd /Users/light/Git/youkeep && git add app/components/settings/SettingsStatsTab.vue && git commit -m "$(cat <<'EOF'
feat: extract SettingsStatsTab component from settings.vue

Fourth step of the settings.vue split. Moves the Dashboard/Stats tab's
template and script verbatim into its own component, consuming the
shared channel list and admin stats from useAdminChannels() instead of
a local useFetch call. Not yet wired into settings.vue (Task 9).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `app/components/settings/SettingsDownloadsTab.vue`

**Files:**
- Create: `app/components/settings/SettingsDownloadsTab.vue`

**Interfaces:**
- Consumes: `useDownloadsQueue()` (Task 1) for `queue`/`failedCount`/`isPaused`/`smoothProgress`/`fetchQueue`; `useAdminChannels()` (Task 3) for `refreshStats` only (not `channels` — the Downloads tab never renders the channel list).
- Produces: nothing consumed by other tasks (leaf tab component).

This is the Downloads tab's template (original lines 232–531, everything not gated behind `v-if="activeTab === 'music'"`) plus the Ingest Options Modal (original lines 799–871, a sibling of the tab-pane div, shown whenever `showIngestModal` is true regardless of `activeTab` — matching its original behavior since it's only ever opened by this tab's own `openIngestModal()`). The script combines: the non-music-prefixed state/functions from the original `/* 2. DOWNLOADS TAB */` region, plus `scheduleForm`/`presets`/`applyPreset`/`fetchSchedule`/`handleSaveSchedule`/`savingSchedule`/`scheduleMessage` (filed under the `/* 3. CONFIGURATION TAB */` comment in the original but whose template lives entirely inside this tab — see "Notes on deviations" above), plus `parseETAToSeconds` (declared but never called anywhere in the original file — kept verbatim as dead code since this is a pure structural refactor, not a cleanup pass), plus a local copy of `formatStatus` (also needed by `SettingsMusicTab.vue`, Task 6 — it's a tiny pure function, not shared state, so it's duplicated rather than routed through a composable neither tab otherwise needs).

- [ ] **Step 1: Create the component file**

Create `app/components/settings/SettingsDownloadsTab.vue` with this exact content:

```vue
<template>
  <div class="tab-pane">
    <!-- Downloads Header & Controls Row -->
    <div class="downloads-header-panel glass-panel">
      <div class="header-text">
        <h2>Downloads Manager & Queue</h2>
        <p>Add new channels, update background worker sync schedules, or control the download pipeline.</p>
      </div>
      
      <div class="queue-actions-row">
        <!-- Global Pause/Resume Button -->
        <button
          @click="toggleGlobalPause"
          class="btn"
          :class="isPaused ? 'btn-primary-glow' : 'btn-secondary-dark'"
          :disabled="pausingOrResuming"
        >
          <svg v-if="isPaused" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
          <svg v-else xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-2"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>
          <span>{{ isPaused ? 'Resume Sync' : 'Pause Sync' }}</span>
        </button>

        <div class="concurrency-control" style="display: inline-flex; align-items: center; gap: 8px;">
          <label for="max-concurrent-downloads" style="font-size: 13px; color: var(--text-secondary);">Max concurrent downloads</label>
          <input
            id="max-concurrent-downloads"
            type="number"
            min="1"
            v-model.number="maxConcurrentDownloads"
            class="form-input"
            style="width: 64px;"
          />
          <button @click="handleSaveConcurrency" class="btn btn-secondary-dark btn-sm" :disabled="savingConcurrency">
            {{ savingConcurrency ? 'Saving...' : 'Save' }}
          </button>
        </div>

        <button @click="handleSyncAll" class="btn btn-secondary-dark" :disabled="syncingAll">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-2" :class="{ 'spin-anim': syncingAll }"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
          <span>{{ syncingAll ? 'Syncing...' : 'Sync All Channels' }}</span>
        </button>

        <button v-if="failedCount > 0" @click="handleRetryAllFailed" class="btn btn-secondary-dark" :disabled="retryingFailed">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"></path></svg>
          <span>Retry {{ failedCount }} Failed</span>
        </button>

        <button v-if="queue.length > 0" @click="handleClearQueue" class="btn btn-danger-outline btn-clean">
          Clear Queue
        </button>
      </div>
    </div>

    <div class="downloads-dashboard-layout">
      <!-- Left Side: Config & Ingest (60% width on desktop) -->
      <div class="downloads-main-col">
        <!-- Add Ingest / Channel Search Box -->
        <div class="ingest-box glass-panel">
          <div class="section-title-row">
            <div class="icon-orb bg-purple">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.33z"></path><polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02"></polygon></svg>
            </div>
            <div>
              <h3>Track YouTube Channel</h3>
              <p class="section-desc">Search for a channel to add it to your local offline library.</p>
            </div>
          </div>

          <form @submit.prevent="handleSearchOrIngest" class="ingest-form mt-3">
            <div class="search-input-wrapper">
              <input 
                type="text" 
                v-model="channelSearchInput" 
                placeholder="Channel name (e.g. Marques Brownlee, Veritasium...)" 
                class="form-input search-input" 
                required
                :disabled="searching || ingesting"
              />
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="search-icon"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
            </div>
            <button type="submit" class="btn btn-primary" :disabled="searching || ingesting">
              <span v-if="searching">Searching...</span>
              <span v-else>Search Channel</span>
            </button>
          </form>
          
          <div v-if="ingestMessage" class="form-msg mt-3" :class="ingestSuccess ? 'success-msg' : 'error-msg'">
            {{ ingestMessage }}
          </div>

          <!-- Search Results -->
          <div v-if="searchResults.length > 0" class="search-results-list mt-4">
            <h4 class="results-header">Matching Channels :</h4>
            <div class="search-results-grid">
              <div v-for="ch in searchResults" :key="ch.id" class="search-channel-card">
                <img 
                  :src="ch.avatarUrl || '/img/default-avatar.png'" 
                  class="channel-avatar-thumb" 
                  referrerpolicy="no-referrer"
                  @error="($event) => { const target = $event.target as HTMLImageElement; if (target) { target.src = '/img/default-avatar.png'; } }"
                />
                <div class="channel-search-info">
                  <h5>{{ ch.title }}</h5>
                  <p class="channel-search-meta">
                    <span class="subscribers">{{ ch.subscriberCount }} subs</span>
                    <span class="meta-dot">•</span>
                    <span class="videos-count">{{ ch.videoCount }} videos</span>
                  </p>
                  <p class="channel-search-desc" v-if="ch.description">{{ ch.description }}</p>
                </div>
                <button @click="openIngestModal(ch)" class="btn btn-primary btn-xs">
                  Track
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Archiver System Policy Panel -->
        <div class="ingest-box glass-panel mt-4">
          <div class="section-title-row">
            <div class="icon-orb bg-blue">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.1a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path><circle cx="12" cy="12" r="3"></circle></svg>
            </div>
            <div>
              <h3>Archiving Policy & Scheduling</h3>
              <p class="section-desc">Manage your downloads path and synchronize automation scheduling triggers.</p>
            </div>
          </div>

          <div class="policy-forms-grid mt-3">
            <!-- Storage Path Form -->
            <form @submit.prevent="handleSaveDefaultDir" class="policy-form-block">
              <div class="form-group">
                <label class="form-label" for="default_dir">Default Server Downloads Folder</label>
                <div class="input-action-row">
                  <input 
                    type="text" 
                    id="default_dir" 
                    v-model="defaultDownloadsDir" 
                    placeholder="e.g. /downloads/videos" 
                    class="form-input" 
                    required
                    :disabled="savingDir"
                  />
                  <button type="submit" class="btn btn-secondary-dark" :disabled="savingDir">
                    <span>{{ savingDir ? 'Saving...' : 'Apply Path' }}</span>
                  </button>
                </div>
              </div>
              <div v-if="saveDirMessage" class="form-msg mt-2" :class="saveDirSuccess ? 'success-msg' : 'error-msg'">
                {{ saveDirMessage }}
              </div>
            </form>

            <!-- Scheduling Form -->
            <form @submit.prevent="handleSaveSchedule" class="policy-form-block mt-3 pt-3 border-t">
              <div class="form-group">
                <label class="checkbox-container">
                  <input type="checkbox" v-model="scheduleForm.enabled" />
                  <span class="checkmark"></span>
                  Enable background sync worker automation
                </label>
              </div>

              <div v-if="scheduleForm.enabled" class="schedule-settings-row mt-2">
                <div class="form-group flex-1">
                  <label class="form-label" for="preset">Preset Interval</label>
                  <select id="preset" v-model="scheduleForm.preset" @change="applyPreset" class="form-select">
                    <option value="hourly">Hourly (Every hour)</option>
                    <option value="twelve_hours">Every 12 hours</option>
                    <option value="daily">Daily (archiving at 3 AM)</option>
                    <option value="weekly">Weekly (Sunday at 3 AM)</option>
                    <option value="custom">Custom Cron Expression</option>
                  </select>
                </div>

                <div class="form-group flex-1" v-if="scheduleForm.preset === 'custom'">
                  <label class="form-label" for="cron">Cron Expression</label>
                  <input type="text" id="cron" v-model="scheduleForm.schedule" class="form-input" placeholder="*/30 * * * *" required />
                </div>
              </div>

              <div class="form-actions mt-3">
                <button type="submit" class="btn btn-secondary-dark" :disabled="savingSchedule">
                  {{ savingSchedule ? 'Saving...' : 'Save Sync Trigger' }}
                </button>
              </div>
            </form>
            <div v-if="scheduleMessage" class="form-msg mt-3 success-msg">
              {{ scheduleMessage }}
            </div>
          </div>
        </div>

        <div class="ingest-box glass-panel mt-4">
          <div class="section-title-row">
            <div class="icon-orb bg-blue">
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
      </div>

      <!-- Right Side: Processing Queue (40% width on desktop) -->
      <div class="downloads-side-col">
        <div class="queue-box glass-panel">
          <div class="queue-header-row">
            <div class="flex-align-center gap-10">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--accent-secondary);"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>
              <h3 style="margin: 0; font-size: 15px; font-weight: 700;">Worker Queue</h3>
            </div>
            <span :class="isPaused ? 'badge-paused-global' : 'badge-active-global'">
              {{ isPaused ? 'Suspended' : 'Active' }}
            </span>
          </div>

          <div v-if="queue.length === 0" class="queue-empty-state">
            <div class="empty-icon-cloud">
              <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 19A3.5 3.5 0 0 0 21 15.5a3.42 3.42 0 0 0-.22-1.2A3.5 3.5 0 0 0 17.5 11h-1a7 7 0 0 0-14 0h-1a3.5 3.5 0 0 0 0 7h16.5z"></path><polyline points="12 18 12 12 15 15"></polyline></svg>
            </div>
            <h4>Archive Pipeline Idle</h4>
            <p>Queue is empty. Active channels are queried automatically.</p>
          </div>
          <div v-else class="queue-list-premium">
            <div v-for="video in queue" :key="video.id" class="queue-card-premium">
              <div class="queue-card-details">
                <div class="queue-card-meta-main">
                  <h4 class="queue-card-title" :title="video.title">{{ video.title }}</h4>
                  <span class="queue-card-channel-name">{{ video.channel_title }}</span>
                </div>
                <span class="status-badge" :class="`status-${video.download_status}`">
                  {{ formatStatus(video.download_status) }}
                </span>
              </div>

              <!-- Progress Bar Component -->
              <div class="queue-progress-container">
                <div class="progress-bar-glow-bg">
                  <div 
                    class="progress-bar-glow-fill" 
                    :style="{ width: (smoothProgress[video.id] !== undefined ? smoothProgress[video.id] : (video.download_progress || 0)) + '%' }"
                  ></div>
                </div>
                <span class="progress-percent-text">{{ Math.round(smoothProgress[video.id] !== undefined ? smoothProgress[video.id] : (video.download_progress || 0)) }}%</span>
              </div>

              <div class="queue-diagnostics-row" v-if="video.download_status === 'downloading'">
                <span v-if="video.download_speed" class="diag-meta-spec">Speed: {{ video.download_speed }}</span>
                <span v-if="video.download_eta" class="diag-meta-spec">ETA: {{ video.download_eta }}</span>
              </div>

              <div class="queue-error-box" v-if="video.download_status === 'failed' && video.last_error">
                <strong>Log:</strong> {{ video.last_error }}
              </div>

              <div class="queue-card-action-bar">
                <button 
                  v-if="video.download_status === 'pending'"
                  @click="handlePrioritizeTask(video.id)" 
                  class="btn-action-premium"
                >
                  Prioritize
                </button>
                <button 
                  @click="handleCancelDownload(video.id)" 
                  class="btn-action-premium btn-action-danger"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Ingest Options Modal -->
  <div v-if="showIngestModal" class="modal-overlay" @click.self="closeIngestModal">
    <div class="modal-content glass-panel">
      <div class="modal-header">
        <h3>Archiving options: {{ selectedSearchChannel?.title }}</h3>
        <button @click="closeIngestModal" class="btn-close">&times;</button>
      </div>

      <form @submit.prevent="submitIngestModal" class="modal-body mt-3">
        <div class="form-group">
          <label class="form-label" for="custom_path">Storage Folder (full path on the server)</label>
          <input 
            type="text" 
            id="custom_path" 
            v-model="modalForm.custom_save_path" 
            class="form-input" 
            placeholder="e.g. /downloads/videos/channel_name" 
            required
          />
        </div>

        <div class="form-group">
          <label class="form-label" for="visibility">Default Visibility</label>
          <select id="visibility" v-model="modalForm.visibility" class="form-select">
            <option value="public">Public (Everyone can view)</option>
            <option value="private">Private (Logged-in users only)</option>
            <option value="unlisted">Unlisted (Restricted to explicit permissions)</option>
          </select>
        </div>

        <div class="form-group">
          <label class="form-label">Content to archive</label>
          <div class="checkbox-row mt-1" style="display: flex; gap: 16px;">
            <label class="checkbox-container">
              <input type="checkbox" v-model="modalForm.download_videos" />
              <span class="checkmark"></span>
              Videos
            </label>
            <label class="checkbox-container">
              <input type="checkbox" v-model="modalForm.download_shorts" />
              <span class="checkmark"></span>
              Shorts
            </label>
          </div>
        </div>



        <div class="form-group mt-3">
          <label class="checkbox-container">
            <input type="checkbox" v-model="modalForm.sync_automatically" />
            <span class="checkmark"></span>
            Automatically synchronize this channel (Scheduling)
          </label>
        </div>

        <div class="form-group">
          <label class="checkbox-container">
            <input type="checkbox" v-model="modalForm.start_sync" />
            <span class="checkmark"></span>
            Start synchronization and download immediately
          </label>
        </div>

        <div class="modal-footer mt-4" style="display: flex; justify-content: flex-end; gap: 10px;">
          <button type="button" @click="closeIngestModal" class="btn btn-secondary">Cancel</button>
          <button type="submit" class="btn btn-primary" :disabled="ingesting">
            {{ ingesting ? 'Adding...' : 'Confirm' }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { useToast } from '~/composables/useToast';
import { useDownloadsQueue } from '~/composables/useDownloadsQueue';
import { useAdminChannels } from '~/composables/useAdminChannels';

const toast = useToast();
const { queue, failedCount, isPaused, smoothProgress, fetchQueue } = useDownloadsQueue();
const { refreshStats } = await useAdminChannels();

const syncingAll = ref(false);
const retryingFailed = ref(false);
const pausingOrResuming = ref(false);
const maxConcurrentDownloads = ref(2);
const savingConcurrency = ref(false);

const parseETAToSeconds = (etaStr: string | null | undefined): number => {
  if (!etaStr) return 0;
  const cleaned = etaStr.trim();
  if (cleaned === '--:--' || cleaned.toLowerCase().includes('waiting')) return 0;
  const parts = cleaned.split(':').map(Number);
  if (parts.some(isNaN)) return 0;
  if (parts.length === 2) {
    return (parts[0] || 0) * 60 + (parts[1] || 0);
  } else if (parts.length === 3) {
    return (parts[0] || 0) * 3600 + (parts[1] || 0) * 60 + (parts[2] || 0);
  }
  return 0;
};

const toggleGlobalPause = async () => {
  pausingOrResuming.value = true;
  try {
    const endpoint = isPaused.value ? '/api/admin/downloader/resume' : '/api/admin/downloader/pause';
    await $fetch(endpoint, { method: 'POST' });
    isPaused.value = !isPaused.value;
    toast.success(isPaused.value ? 'Downloads paused.' : 'Downloads resumed.');
    fetchQueue();
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'An error occurred.');
  } finally {
    pausingOrResuming.value = false;
  }
};

const fetchConcurrency = async () => {
  try {
    const data = await $fetch<any>('/api/admin/downloader/concurrency');
    maxConcurrentDownloads.value = data.maxConcurrentDownloads ?? 2;
  } catch (err) {
    console.error('Failed to fetch concurrency setting:', err);
  }
};

const handleSaveConcurrency = async () => {
  savingConcurrency.value = true;
  try {
    await $fetch('/api/admin/downloader/concurrency', {
      method: 'POST',
      body: { maxConcurrentDownloads: maxConcurrentDownloads.value }
    });
    toast.success('Concurrency setting saved.');
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Failed to save concurrency setting.');
  } finally {
    savingConcurrency.value = false;
  }
};

const handleSyncAll = async () => {
  syncingAll.value = true;
  try {
    const res = await $fetch<any>('/api/admin/downloader/sync-all', { method: 'POST' });
    toast.success(res.message || 'Sync started.');
    fetchQueue();
    refreshStats();
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Launch failed.');
  } finally {
    syncingAll.value = false;
  }
};

const handleRetryAllFailed = async () => {
  retryingFailed.value = true;
  try {
    await $fetch('/api/admin/downloader/retry-failed', { method: 'POST' });
    fetchQueue();
    toast.success('Failed downloads retried.');
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Retry failed.');
  } finally {
    retryingFailed.value = false;
  }
};

const handleClearQueue = async () => {
  if (!confirm('Do you want to clear the entire queue (unstarted videos will be removed)?')) return;
  try {
    await $fetch('/api/admin/downloader/clear-queue', { method: 'POST' });
    fetchQueue();
    toast.success('Queue cleared.');
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Action failed.');
  }
};

const handlePrioritizeTask = async (videoId: string) => {
  try {
    await $fetch('/api/admin/downloader/prioritize', {
      method: 'POST',
      body: { videoId }
    });
    fetchQueue();
    toast.success('Download set as priority.');
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Failed.');
  }
};

const handleCancelDownload = async (videoId: string) => {
  try {
    await $fetch('/api/admin/downloader/cancel', {
      method: 'POST',
      body: { videoId }
    });
    fetchQueue();
    toast.success('Download cancelled.');
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Cancellation failed.');
  }
};

const channelSearchInput = ref('');
const searching = ref(false);
const searchResults = ref<any[]>([]);
const ingesting = ref(false);
const ingestMessage = ref('');
const ingestSuccess = ref(false);

const defaultDownloadsDir = ref('');
const savingDir = ref(false);
const saveDirMessage = ref('');
const saveDirSuccess = ref(false);

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

const fetchDefaultDir = async () => {
  try {
    const data = await $fetch<any>('/api/admin/downloader/default-dir');
    defaultDownloadsDir.value = data.path || '/downloads/videos';
  } catch (err) {
    console.error('Failed to fetch default downloads directory:', err);
  }
};

const handleSaveDefaultDir = async () => {
  savingDir.value = true;
  saveDirMessage.value = '';
  saveDirSuccess.value = false;
  try {
    await $fetch('/api/admin/downloader/default-dir', {
      method: 'POST',
      body: {
        path: defaultDownloadsDir.value
      }
    });
    saveDirSuccess.value = true;
    saveDirMessage.value = 'Default downloads folder saved successfully.';
    toast.success('Default folder updated.');
  } catch (err: any) {
    saveDirSuccess.value = false;
    saveDirMessage.value = err.data?.statusMessage || 'Save failed.';
    toast.error(saveDirMessage.value);
  } finally {
    savingDir.value = false;
  }
};

const handleSearchOrIngest = async () => {
  const query = channelSearchInput.value.trim();
  if (!query) return;

  if (query.startsWith('http://') || query.startsWith('https://') || query.includes('youtube.com/')) {
    openIngestModal({
      id: null,
      title: 'Channel via URL',
      avatarUrl: '',
      handle: query,
      isDirectUrl: true
    });
  } else {
    searching.value = true;
    ingestMessage.value = '';
    searchResults.value = [];
    try {
      const data = await $fetch<any>('/api/admin/downloader/search-channels', {
        params: { q: query }
      });
      searchResults.value = data.channels || [];
      if (searchResults.value.length === 0) {
        toast.info('No channels found for this search.');
      }
    } catch (err: any) {
      toast.error(err.data?.statusMessage || 'Search failed.');
    } finally {
      searching.value = false;
    }
  }
};

const showIngestModal = ref(false);
const selectedSearchChannel = ref<any>(null);
const modalForm = reactive({
  custom_save_path: '',
  visibility: 'public',
  download_videos: true,
  download_shorts: false,
  date_after: '',
  sync_automatically: true,
  start_sync: true
});

const openIngestModal = (channel: any) => {
  selectedSearchChannel.value = channel;
  const baseDir = defaultDownloadsDir.value || '/downloads/videos';
  const cleanTitle = channel.title ? channel.title.replace(/[\\/:*?"<>|]/g, '_').trim() : (channel.id || '');
  modalForm.custom_save_path = `${baseDir}/${cleanTitle}`.replace(/\/+/g, '/');
  modalForm.visibility = 'public';
  modalForm.download_videos = true;
  modalForm.download_shorts = false;
  modalForm.date_after = '';
  modalForm.sync_automatically = true;
  modalForm.start_sync = true;
  showIngestModal.value = true;
};

const closeIngestModal = () => {
  showIngestModal.value = false;
  selectedSearchChannel.value = null;
};

const submitIngestModal = async () => {
  if (!selectedSearchChannel.value) return;

  ingesting.value = true;
  ingestMessage.value = '';
  showIngestModal.value = false;

  const targetUrl = selectedSearchChannel.value.isDirectUrl
    ? selectedSearchChannel.value.handle
    : `https://www.youtube.com/channel/${selectedSearchChannel.value.id}`;

  try {
    const res = await $fetch<any>('/api/admin/downloader/ingest', {
      method: 'POST',
      body: {
        url: targetUrl,
        download_videos: modalForm.download_videos,
        download_shorts: modalForm.download_shorts,
        date_after: modalForm.date_after ? modalForm.date_after.replace(/-/g, '') : undefined,
        sync_status: modalForm.sync_automatically ? 'active' : 'paused',
        visibility: modalForm.visibility,
        custom_save_path: modalForm.custom_save_path || undefined,
        start_sync: modalForm.start_sync
      }
    });

    ingestSuccess.value = res.success;
    ingestMessage.value = res.message;
    channelSearchInput.value = '';
    searchResults.value = [];
    fetchQueue();
    refreshStats();
    toast.success('Channel imported successfully!');
  } catch (err: any) {
    ingestSuccess.value = false;
    ingestMessage.value = err.data?.statusMessage || 'Import failed.';
    toast.error('Error importing channel.');
  } finally {
    ingesting.value = false;
  }
};

const savingSchedule = ref(false);
const scheduleMessage = ref('');

const scheduleForm = reactive({
  enabled: false,
  preset: 'daily',
  schedule: '0 3 * * *'
});

const presets: Record<string, string> = {
  hourly: '0 * * * *',
  twelve_hours: '0 */12 * * *',
  daily: '0 3 * * *',
  weekly: '0 3 * * 0'
};

const applyPreset = () => {
  if (scheduleForm.preset !== 'custom') {
    scheduleForm.schedule = presets[scheduleForm.preset] || '0 3 * * *';
  }
};

const fetchSchedule = async () => {
  try {
    const data = await $fetch<any>('/api/admin/downloader/schedule');
    scheduleForm.enabled = data.enabled;
    scheduleForm.schedule = data.schedule || '0 3 * * *';

    // Find preset matching schedule
    const foundPreset = Object.keys(presets).find(k => presets[k] === scheduleForm.schedule);
    scheduleForm.preset = foundPreset || 'custom';
  } catch (err) {
    console.error('Failed to fetch schedule:', err);
  }
};

const handleSaveSchedule = async () => {
  savingSchedule.value = true;
  scheduleMessage.value = '';
  try {
    await $fetch('/api/admin/downloader/schedule', {
      method: 'POST',
      body: {
        enabled: scheduleForm.enabled,
        schedule: scheduleForm.schedule
      }
    });
    scheduleMessage.value = 'Synchronization frequency saved successfully.';
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Save failed.');
  } finally {
    savingSchedule.value = false;
  }
};

const formatStatus = (status: string) => {
  const s: Record<string, string> = {
    pending: 'Pending',
    downloading: 'Downloading',
    failed: 'Failed',
    completed: 'Completed'
  };
  return s[status] || status;
};

onMounted(() => {
  fetchSchedule();
  fetchDefaultDir();
  fetchSponsorBlockSettings();
  fetchConcurrency();
});
</script>
```

Note the template now has two root nodes (the `.tab-pane` div and the modal `.modal-overlay` div) — Vue 3 SFCs support multi-root templates (fragments), so this is valid and matches the original where these two blocks were both direct children of `.settings-content` in the parent.

- [ ] **Step 2: Build check**

```bash
cd /Users/light/Git/youkeep && npm run build
```
Confirm `✨ Build complete!` with no errors mentioning `SettingsDownloadsTab`.

- [ ] **Step 3: Commit**

```bash
cd /Users/light/Git/youkeep && git add app/components/settings/SettingsDownloadsTab.vue && git commit -m "$(cat <<'EOF'
feat: extract SettingsDownloadsTab component from settings.vue

Fifth step of the settings.vue split. Moves the Downloads tab's
template (including the Ingest Options Modal, a template sibling
controlled by this tab's own local state) and script into its own
component. Also relocates the video-sync schedule form's script here
even though it was filed under a "3. CONFIGURATION TAB" comment in
the original — its template renders entirely inside this tab's
"Archiving Policy & Scheduling" panel, confirmed by reading the full
template rather than trusting the script's section comments.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `app/components/settings/SettingsMusicTab.vue`

**Files:**
- Create: `app/components/settings/SettingsMusicTab.vue`

**Interfaces:**
- Consumes: `useMusicQueue()` (Task 2) for `musicQueue`/`musicArtists`/`musicIsPaused`/`musicFailedCount`/`fetchMusicQueue`.
- Produces: nothing consumed by other tasks (leaf tab component).

This is the Music tab's template (original lines 534–797) and the music-prefixed state/functions that were interleaved (with no separating comment) inside the original `/* 2. DOWNLOADS TAB */` script region — identified by their `music`-prefixed names, per the approved design spec's own exploration notes.

- [ ] **Step 1: Create the component file**

Create `app/components/settings/SettingsMusicTab.vue` with this exact content:

```vue
<template>
  <div class="tab-pane">
    <div class="downloads-header-panel glass-panel" style="margin-bottom: 16px;">
      <div class="header-text">
        <h2>Module Musique</h2>
        <p>Active ou désactive tout l'espace Musique pour les utilisateurs non-admin (navigation, lecture, API). Les administrateurs gardent toujours accès.</p>
      </div>
      <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
        <input type="checkbox" v-model="musicModuleEnabled" @change="toggleMusicModule" :disabled="togglingMusicModule" />
        <span>{{ musicModuleEnabled ? 'Activé' : 'Désactivé' }}</span>
      </label>
    </div>

    <div class="downloads-header-panel glass-panel" style="margin-bottom: 16px;">
      <div class="header-text">
        <h2>Clips vidéo</h2>
        <p>Télécharge aussi la vidéo (clip officiel) pour chaque nouvelle piste ingérée, en plus de l'audio. Les pistes déjà téléchargées ne sont pas affectées automatiquement — utilise le bouton « Télécharger le clip » sur une piste existante pour la rattraper manuellement.</p>
      </div>
      <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
        <input type="checkbox" v-model="musicDownloadClipsEnabled" @change="toggleMusicDownloadClips" :disabled="togglingMusicDownloadClips" />
        <span>{{ musicDownloadClipsEnabled ? 'Activé' : 'Désactivé' }}</span>
      </label>
    </div>

    <div class="downloads-header-panel glass-panel">
      <div class="header-text">
        <h2>Music Ingestion</h2>
        <p>Follow YouTube channels as music artists. Audio is extracted, no re-encoding.</p>
      </div>

      <div class="queue-actions-row">
        <button
          @click="toggleMusicPause"
          class="btn"
          :class="musicIsPaused ? 'btn-primary-glow' : 'btn-secondary-dark'"
          :disabled="pausingOrResumingMusic"
        >
          <svg v-if="musicIsPaused" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
          <svg v-else xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-2"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>
          <span>{{ musicIsPaused ? 'Resume Music Sync' : 'Pause Music Sync' }}</span>
        </button>

        <div class="concurrency-control" style="display: inline-flex; align-items: center; gap: 8px;">
          <label for="max-concurrent-music-downloads" style="font-size: 13px; color: var(--text-secondary);">Max concurrent downloads</label>
          <input
            id="max-concurrent-music-downloads"
            type="number"
            min="1"
            v-model.number="maxConcurrentMusicDownloads"
            class="form-input"
            style="width: 64px;"
          />
          <button @click="handleSaveMusicConcurrency" class="btn btn-secondary-dark btn-sm" :disabled="savingMusicConcurrency">
            {{ savingMusicConcurrency ? 'Saving...' : 'Save' }}
          </button>
        </div>

        <button v-if="musicFailedCount > 0" @click="handleRetryAllMusicFailed" class="btn btn-secondary-dark" :disabled="retryingMusicFailed">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"></path></svg>
          <span>Retry {{ musicFailedCount }} Failed</span>
        </button>
      </div>

      <form @submit.prevent="handleSaveMusicSchedule" class="policy-form-block mt-3 pt-3 border-t">
        <div class="form-group">
          <label class="checkbox-container">
            <input type="checkbox" v-model="musicScheduleForm.enabled" />
            <span class="checkmark"></span>
            Enable background artist resync automation
          </label>
        </div>

        <div v-if="musicScheduleForm.enabled" class="schedule-settings-row mt-2">
          <div class="form-group flex-1">
            <label class="form-label" for="music-preset">Preset Interval</label>
            <select id="music-preset" v-model="musicScheduleForm.preset" @change="applyMusicPreset" class="form-select">
              <option value="hourly">Hourly (Every hour)</option>
              <option value="twelve_hours">Every 12 hours</option>
              <option value="daily">Daily (resync at 3:30 AM)</option>
              <option value="weekly">Weekly (Sunday at 3:30 AM)</option>
              <option value="custom">Custom Cron Expression</option>
            </select>
          </div>

          <div class="form-group flex-1" v-if="musicScheduleForm.preset === 'custom'">
            <label class="form-label" for="music-cron">Cron Expression</label>
            <input type="text" id="music-cron" v-model="musicScheduleForm.schedule" class="form-input" placeholder="*/30 * * * *" required />
          </div>
        </div>

        <div class="form-actions mt-3">
          <button type="submit" class="btn btn-secondary-dark" :disabled="savingMusicSchedule">
            {{ savingMusicSchedule ? 'Saving...' : 'Save Sync Trigger' }}
          </button>
        </div>
      </form>
      <div v-if="musicScheduleMessage" class="form-msg mt-3 success-msg">
        {{ musicScheduleMessage }}
      </div>
    </div>

    <div class="downloads-dashboard-layout">
      <!-- Left Side: Add artist + followed artists -->
      <div class="downloads-main-col">
        <div class="ingest-box glass-panel">
          <div class="section-title-row">
            <div class="icon-orb bg-purple">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>
            </div>
            <div>
              <h3>Track a Music Artist</h3>
              <p class="section-desc">Paste a YouTube channel URL or @handle.</p>
            </div>
          </div>

          <form @submit.prevent="handleAddMusicArtist" class="ingest-form mt-3">
            <div class="search-input-wrapper">
              <input
                type="text"
                v-model="musicArtistInput"
                placeholder="YouTube channel URL or @handle"
                class="form-input search-input"
                required
                :disabled="addingMusicArtist"
              />
            </div>
            <select v-model="musicArtistVisibility" class="form-select" :disabled="addingMusicArtist">
              <option value="">Keep current (Public if new)</option>
              <option value="public">Public</option>
              <option value="private">Private</option>
              <option value="ultra_private">Ultra Private</option>
            </select>
            <button type="submit" class="btn btn-primary" :disabled="addingMusicArtist">
              <span v-if="addingMusicArtist">Adding...</span>
              <span v-else>Add Artist</span>
            </button>
          </form>

          <div class="form-group mt-2">
            <label class="checkbox-container">
              <input type="checkbox" v-model="musicAutoSync" :disabled="addingMusicArtist" />
              <span class="checkmark"></span>
              Sync automatically (start downloading right away)
            </label>
          </div>

          <div v-if="musicIngestMessage" class="form-msg mt-3" :class="musicIngestSuccess ? 'success-msg' : 'error-msg'">
            {{ musicIngestMessage }}
          </div>
        </div>

        <div class="ingest-box glass-panel mt-4">
          <div class="section-title-row">
            <div class="icon-orb bg-blue">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle></svg>
            </div>
            <div>
              <h3>Followed Artists</h3>
              <p class="section-desc">{{ musicArtists.length }} artist(s) tracked.</p>
            </div>
          </div>

          <div v-if="musicArtists.length === 0" class="mt-3">
            <p class="section-desc">No artists followed yet.</p>
          </div>
          <div v-else class="search-results-grid mt-3">
            <div v-for="artist in musicArtists" :key="artist.id" class="search-channel-card">
              <img
                :src="artist.avatar_url || '/img/default-avatar.png'"
                class="channel-avatar-thumb"
                referrerpolicy="no-referrer"
                @error="($event) => { const target = $event.target as HTMLImageElement; if (target) { target.src = '/img/default-avatar.png'; } }"
              />
              <div class="channel-search-info">
                <h5>{{ artist.name }}</h5>
                <p class="channel-search-meta">
                  <span>{{ formatStatus(artist.sync_status) }}</span>
                  <span class="meta-dot">•</span>
                  <span>{{ artist.visibility }}</span>
                  <span class="meta-dot">•</span>
                  <span>{{ artist.track_count }} track(s)</span>
                </p>
              </div>
              <button
                @click="handleSyncMusicArtist(artist.id)"
                class="btn btn-primary btn-xs"
                :disabled="syncingArtistId === artist.id"
              >
                {{ syncingArtistId === artist.id ? 'Syncing...' : 'Sync' }}
              </button>
              <button
                v-if="artist.sync_status === 'downloading'"
                @click="handlePauseMusicArtist(artist.id)"
                class="btn btn-secondary btn-xs"
                :disabled="pausingArtistId === artist.id"
              >
                {{ pausingArtistId === artist.id ? 'Pausing...' : 'Pause' }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Right Side: Queue -->
      <div class="downloads-side-col">
        <div class="queue-box glass-panel">
          <div class="queue-header-row">
            <div class="flex-align-center gap-10">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--accent-secondary);"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>
              <h3 style="margin: 0; font-size: 15px; font-weight: 700;">Music Queue</h3>
            </div>
            <span :class="musicIsPaused ? 'badge-paused-global' : 'badge-active-global'">
              {{ musicIsPaused ? 'Suspended' : 'Active' }}
            </span>
          </div>

          <div v-if="musicQueue.length === 0" class="queue-empty-state">
            <h4>Music Pipeline Idle</h4>
            <p>Queue is empty.</p>
          </div>
          <div v-else class="queue-list-premium">
            <div v-for="track in musicQueue" :key="track.id" class="queue-card-premium">
              <div class="queue-card-details">
                <div class="queue-card-meta-main">
                  <h4 class="queue-card-title" :title="track.title">{{ track.title }}</h4>
                  <span class="queue-card-channel-name">{{ track.artist_name }}</span>
                </div>
                <span class="status-badge" :class="`status-${track.download_status}`">
                  {{ formatStatus(track.download_status) }}
                </span>
              </div>

              <div class="queue-progress-container">
                <div class="progress-bar-glow-bg">
                  <div
                    class="progress-bar-glow-fill"
                    :style="{ width: (track.download_progress || 0) + '%' }"
                  ></div>
                </div>
                <span class="progress-percent-text">{{ Math.round(track.download_progress || 0) }}%</span>
              </div>

              <div class="queue-diagnostics-row" v-if="track.download_status === 'downloading'">
                <span v-if="track.download_speed" class="diag-meta-spec">Speed: {{ track.download_speed }}</span>
                <span v-if="track.download_eta" class="diag-meta-spec">ETA: {{ track.download_eta }}</span>
              </div>

              <div class="queue-error-box" v-if="track.download_status === 'failed' && track.last_error">
                <strong>Log:</strong> {{ track.last_error }}
              </div>

              <div class="queue-card-action-bar">
                <button
                  @click="handleCancelMusicTrack(track.id)"
                  class="btn-action-premium btn-action-danger"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { useToast } from '~/composables/useToast';
import { useMusicQueue } from '~/composables/useMusicQueue';

const toast = useToast();
const { musicQueue, musicArtists, musicIsPaused, musicFailedCount, fetchMusicQueue } = useMusicQueue();

const musicModuleEnabled = ref(true);
const togglingMusicModule = ref(false);

async function fetchMusicModuleEnabled() {
  try {
    const data = await $fetch<{ enabled: boolean }>('/api/settings/music-module');
    musicModuleEnabled.value = data.enabled;
  } catch (e) {
    // leave the default
  }
}

async function toggleMusicModule() {
  togglingMusicModule.value = true;
  const desired = musicModuleEnabled.value;
  try {
    await $fetch('/api/admin/settings/music-module', { method: 'POST', body: { enabled: desired } });
    toast.success(desired ? 'Module Musique activé.' : 'Module Musique désactivé.');
  } catch (e: any) {
    musicModuleEnabled.value = !desired;
    toast.error(e?.data?.statusMessage || 'Erreur lors de la mise à jour du module Musique.');
  } finally {
    togglingMusicModule.value = false;
  }
}

const musicDownloadClipsEnabled = ref(false);
const togglingMusicDownloadClips = ref(false);

async function fetchMusicDownloadClipsEnabled() {
  try {
    const data = await $fetch<{ enabled: boolean }>('/api/settings/music-clips');
    musicDownloadClipsEnabled.value = data.enabled;
  } catch (e) {
    // leave the default
  }
}

async function toggleMusicDownloadClips() {
  togglingMusicDownloadClips.value = true;
  const desired = musicDownloadClipsEnabled.value;
  try {
    await $fetch('/api/admin/settings/music-clips', { method: 'POST', body: { enabled: desired } });
    toast.success(desired ? 'Téléchargement des clips activé.' : 'Téléchargement des clips désactivé.');
  } catch (e: any) {
    musicDownloadClipsEnabled.value = !desired;
    toast.error(e?.data?.statusMessage || 'Erreur lors de la mise à jour du réglage des clips.');
  } finally {
    togglingMusicDownloadClips.value = false;
  }
}

const retryingMusicFailed = ref(false);
const pausingOrResumingMusic = ref(false);
const maxConcurrentMusicDownloads = ref(2);
const savingMusicConcurrency = ref(false);
const musicArtistInput = ref('');
const musicArtistVisibility = ref('');
const musicAutoSync = ref(true);
const addingMusicArtist = ref(false);
const musicIngestMessage = ref('');
const musicIngestSuccess = ref(false);
const syncingArtistId = ref<string | null>(null);
const pausingArtistId = ref<string | null>(null);

const toggleMusicPause = async () => {
  pausingOrResumingMusic.value = true;
  try {
    const endpoint = musicIsPaused.value ? '/api/admin/music/resume' : '/api/admin/music/pause';
    await $fetch(endpoint, { method: 'POST' });
    musicIsPaused.value = !musicIsPaused.value;
    toast.success(musicIsPaused.value ? 'Music downloads paused.' : 'Music downloads resumed.');
    fetchMusicQueue();
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'An error occurred.');
  } finally {
    pausingOrResumingMusic.value = false;
  }
};

const fetchMusicConcurrency = async () => {
  try {
    const data = await $fetch<any>('/api/admin/music/concurrency');
    maxConcurrentMusicDownloads.value = data.maxConcurrentDownloads ?? 2;
  } catch (err) {
    console.error('Failed to fetch music concurrency setting:', err);
  }
};

const handleSaveMusicConcurrency = async () => {
  savingMusicConcurrency.value = true;
  try {
    await $fetch('/api/admin/music/concurrency', {
      method: 'POST',
      body: { maxConcurrentDownloads: maxConcurrentMusicDownloads.value }
    });
    toast.success('Music concurrency setting saved.');
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Failed to save music concurrency setting.');
  } finally {
    savingMusicConcurrency.value = false;
  }
};

const savingMusicSchedule = ref(false);
const musicScheduleMessage = ref('');

const musicScheduleForm = reactive({
  enabled: false,
  preset: 'daily',
  schedule: '30 3 * * *'
});

const musicPresets: Record<string, string> = {
  hourly: '0 * * * *',
  twelve_hours: '0 */12 * * *',
  daily: '30 3 * * *',
  weekly: '30 3 * * 0'
};

const applyMusicPreset = () => {
  if (musicScheduleForm.preset !== 'custom') {
    musicScheduleForm.schedule = musicPresets[musicScheduleForm.preset] || '30 3 * * *';
  }
};

const fetchMusicSchedule = async () => {
  try {
    const data = await $fetch<any>('/api/admin/music/schedule');
    musicScheduleForm.enabled = data.enabled;
    musicScheduleForm.schedule = data.schedule || '30 3 * * *';

    const foundPreset = Object.keys(musicPresets).find(k => musicPresets[k] === musicScheduleForm.schedule);
    musicScheduleForm.preset = foundPreset || 'custom';
  } catch (err) {
    console.error('Failed to fetch music schedule:', err);
  }
};

const handleSaveMusicSchedule = async () => {
  savingMusicSchedule.value = true;
  musicScheduleMessage.value = '';
  try {
    await $fetch('/api/admin/music/schedule', {
      method: 'POST',
      body: {
        enabled: musicScheduleForm.enabled,
        schedule: musicScheduleForm.schedule
      }
    });
    musicScheduleMessage.value = 'Music synchronization frequency saved successfully.';
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Save failed.');
  } finally {
    savingMusicSchedule.value = false;
  }
};

const handleAddMusicArtist = async () => {
  const url = musicArtistInput.value.trim();
  if (!url) return;

  addingMusicArtist.value = true;
  musicIngestMessage.value = '';
  try {
    const res = await $fetch<any>('/api/admin/music/ingest', {
      method: 'POST',
      body: {
        url,
        sync_status: musicAutoSync.value ? 'downloading' : 'paused',
        ...(musicArtistVisibility.value ? { visibility: musicArtistVisibility.value } : {})
      }
    });
    musicIngestSuccess.value = res.success;
    musicIngestMessage.value = res.message;
    musicArtistInput.value = '';
    toast.success('Artist added.');
    fetchMusicQueue();
  } catch (err: any) {
    musicIngestSuccess.value = false;
    musicIngestMessage.value = err.data?.statusMessage || 'Failed to add artist.';
    toast.error('Error adding artist.');
  } finally {
    addingMusicArtist.value = false;
  }
};

const handleSyncMusicArtist = async (artistId: string) => {
  syncingArtistId.value = artistId;
  try {
    await $fetch(`/api/admin/music/artists/${artistId}/sync`, { method: 'POST' });
    toast.success('Artist sync started.');
    setTimeout(() => fetchMusicQueue(), 3000);
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Failed to sync artist.');
  } finally {
    syncingArtistId.value = null;
  }
};

const handlePauseMusicArtist = async (artistId: string) => {
  pausingArtistId.value = artistId;
  try {
    await $fetch(`/api/admin/music/artists/${artistId}/pause`, { method: 'POST' });
    toast.success('Artist sync paused.');
    fetchMusicQueue();
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Failed to pause artist.');
  } finally {
    pausingArtistId.value = null;
  }
};

const handleCancelMusicTrack = async (trackId: string) => {
  try {
    await $fetch(`/api/admin/music/tracks/${trackId}/cancel`, { method: 'POST' });
    toast.success('Download cancelled.');
    fetchMusicQueue();
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Cancellation failed.');
  }
};

const handleRetryAllMusicFailed = async () => {
  retryingMusicFailed.value = true;
  try {
    await $fetch('/api/admin/music/retry-failed', { method: 'POST' });
    fetchMusicQueue();
    toast.success('Failed downloads retried.');
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Retry failed.');
  } finally {
    retryingMusicFailed.value = false;
  }
};

const formatStatus = (status: string) => {
  const s: Record<string, string> = {
    pending: 'Pending',
    downloading: 'Downloading',
    failed: 'Failed',
    completed: 'Completed'
  };
  return s[status] || status;
};

onMounted(() => {
  fetchMusicConcurrency();
  fetchMusicModuleEnabled();
  fetchMusicDownloadClipsEnabled();
  fetchMusicSchedule();
});
</script>
```

- [ ] **Step 2: Build check**

```bash
cd /Users/light/Git/youkeep && npm run build
```
Confirm `✨ Build complete!` with no errors mentioning `SettingsMusicTab`.

- [ ] **Step 3: Commit**

```bash
cd /Users/light/Git/youkeep && git add app/components/settings/SettingsMusicTab.vue && git commit -m "$(cat <<'EOF'
feat: extract SettingsMusicTab component from settings.vue

Sixth step of the settings.vue split. Moves the Music tab's template
and the music-prefixed state/functions that were interleaved (with no
separating comment) inside the original script's Downloads-tab region.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: `app/components/settings/SettingsSystemTab.vue`

**Files:**
- Create: `app/components/settings/SettingsSystemTab.vue`

**Interfaces:**
- Consumes: `useDownloadsQueue()` (Task 1) for `diagnosticLogs`/`diagnosticYtdlPath`/`fetchDiagnostics` — **not** for `queue`/`isPaused`/etc. (System tab never renders those). See "Notes on deviations" above for why these three come from the composable rather than being local to this component.
- Produces: nothing consumed by other tasks (leaf tab component).

This is the System/Configuration tab's template (original lines 876–971) and script (`diagnosticBinaryTesting`, `diagnosticBinaryResult`, `updatingYtdl`, `updateConsoleOutput`, `handleTestBinary`, `handleUpdateYtdl`, `getLogLineClass` — all confirmed by grep to appear only in this tab's template). `terminalBody` stays a local template ref, with a `watch()` replacing the auto-scroll side effect that the original `fetchDiagnostics()` performed inline (now impossible since `fetchDiagnostics` lives in the composable and has no access to any one component's template refs).

- [ ] **Step 1: Create the component file**

Create `app/components/settings/SettingsSystemTab.vue` with this exact content:

```vue
<template>
  <div class="tab-pane">
    <div class="system-dashboard-layout">
      <!-- Left Column: Diagnostic & Tools (40% width) -->
      <div class="system-diagnostic-col">
        <div class="config-section glass-panel">
          <div class="section-title-row">
            <div class="icon-orb bg-pink">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>
            </div>
            <div>
              <h3>Engine Binaries</h3>
              <p class="section-desc">Verify background yt-dlp/ffmpeg local processes operational status.</p>
            </div>
          </div>

          <div class="binary-path-box mt-3">
            <span class="path-label">Server yt-dlp path :</span>
            <code class="path-code">{{ diagnosticYtdlPath || 'resolving path...' }}</code>
          </div>

          <div class="btn-group mt-3" style="width: 100%; display: flex; gap: 10px;">
            <button @click="handleTestBinary" class="btn btn-secondary-dark flex-1" :disabled="diagnosticBinaryTesting">
              {{ diagnosticBinaryTesting ? 'Testing...' : 'Diagnostic Check' }}
            </button>
            
            <button @click="handleUpdateYtdl" class="btn btn-secondary-dark flex-1" :disabled="updatingYtdl">
              {{ updatingYtdl ? 'Updating...' : 'Update yt-dlp' }}
            </button>
          </div>

          <!-- Diagnostics results panel -->
          <div v-if="diagnosticBinaryResult" class="test-result-box mt-3 border-t pt-3">
            <div class="diagnostic-status-item">
              <span class="diagnostic-label">yt-dlp Engine Status:</span>
              <span :class="diagnosticBinaryResult.success ? 'badge-status badge-success' : 'badge-status badge-danger'">
                {{ diagnosticBinaryResult.success ? 'Operational' : 'Error' }}
              </span>
              <div v-if="diagnosticBinaryResult.success" class="diagnostic-version-sub mt-1">
                Version: <code>{{ diagnosticBinaryResult.version }}</code>
              </div>
            </div>
            
            <div class="diagnostic-status-item mt-3">
              <span class="diagnostic-label">FFmpeg Merging status:</span>
              <span :class="diagnosticBinaryResult.ffmpegAvailable ? 'badge-status badge-success' : 'badge-status badge-warning'">
                {{ diagnosticBinaryResult.ffmpegAvailable ? 'AV Merge active' : 'Not detected' }}
              </span>
            </div>

            <div v-if="!diagnosticBinaryResult.ffmpegAvailable" class="ffmpeg-warning-box mt-3">
              <strong class="warning-title">💡 Standard Formats only (720p max):</strong>
              <p class="warning-desc">FFmpeg was not detected in system execution paths. Thumbnails cannot be converted to JPG, and downloads will be capped at combined formats. Install <code>ffmpeg</code> on the host system to enable high-quality (1080p, 4K) downloads.</p>
            </div>

            <div v-if="diagnosticBinaryResult.stderr" class="diagnostic-stderr-box mt-3">
              <h5>stderr capture:</h5>
              <pre class="diagnostic-pre mt-1">{{ diagnosticBinaryResult.stderr }}</pre>
            </div>
          </div>

          <div v-if="updatingYtdl || updateConsoleOutput" class="test-result-box mt-3 border-t pt-3">
            <h4>Worker output log:</h4>
            <pre class="diagnostic-pre mt-2">{{ updateConsoleOutput || 'Executing path binaries update...' }}</pre>
          </div>
        </div>
      </div>

      <!-- Right Column: Interactive terminal logs (60% width) -->
      <div class="system-logs-col">
        <div class="logs-container glass-panel">
          <div class="logs-header">
            <div class="flex-align-center gap-10">
              <span class="terminal-dot green"></span>
              <h3 style="margin: 0; font-size: 15px; font-weight: 700; color: white;">System Ingestion Logs</h3>
            </div>
            <button @click="fetchDiagnostics" class="btn btn-secondary-dark btn-icon-sm" title="Refresh logs">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"></path></svg>
            </button>
          </div>
          <div class="logs-terminal" ref="terminalBody">
            <div v-if="diagnosticLogs.length === 0" class="log-line text-muted">
              No log buffer entries captured.
            </div>
            <div 
              v-for="(log, idx) in diagnosticLogs" 
              :key="idx" 
              class="log-line"
              :class="getLogLineClass(log)"
            >
              {{ log }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { useToast } from '~/composables/useToast';
import { useDownloadsQueue } from '~/composables/useDownloadsQueue';

const toast = useToast();
const { diagnosticLogs, diagnosticYtdlPath, fetchDiagnostics } = useDownloadsQueue();

const terminalBody = ref<HTMLElement | null>(null);

watch(diagnosticLogs, () => {
  setTimeout(() => {
    if (terminalBody.value) {
      terminalBody.value.scrollTop = terminalBody.value.scrollHeight;
    }
  }, 50);
});

const getLogLineClass = (log: string) => {
  const l = log.toLowerCase();
  if (l.includes('[error]') || l.includes('error') || l.includes('failed')) return 'log-error';
  if (l.includes('[warning]') || l.includes('warning')) return 'log-warning';
  if (l.includes('success') || l.includes('completed') || l.includes('finished')) return 'log-success';
  if (l.includes('starting') || l.includes('started') || l.includes('info')) return 'log-info';
  return 'log-default';
};

const diagnosticBinaryTesting = ref(false);
const diagnosticBinaryResult = ref<any>(null);
const updatingYtdl = ref(false);
const updateConsoleOutput = ref('');

const handleTestBinary = async () => {
  diagnosticBinaryTesting.value = true;
  diagnosticBinaryResult.value = null;
  try {
    const res = await $fetch<any>('/api/admin/downloader/test-binary', { method: 'POST' });
    diagnosticBinaryResult.value = res;
    toast.success('Binary test completed.');
  } catch (err: any) {
    diagnosticBinaryResult.value = {
      success: false,
      stderr: err.data?.statusMessage || err.message || 'Unknown error'
    };
    toast.error('Binary test failed.');
  } finally {
    diagnosticBinaryTesting.value = false;
  }
};

const handleUpdateYtdl = async () => {
  updatingYtdl.value = true;
  updateConsoleOutput.value = 'Launching update...';
  try {
    const res = await $fetch<any>('/api/admin/downloader/update-ytdl', { method: 'POST' });
    updateConsoleOutput.value = res.output || 'Update completed successfully.';
    toast.success('yt-dlp updated.');
  } catch (err: any) {
    updateConsoleOutput.value = err.data?.statusMessage || err.message || 'Update failed.';
    toast.error('Update failed.');
  } finally {
    updatingYtdl.value = false;
  }
};
</script>
```

Note: `diagnosticLogs`/`diagnosticYtdlPath` are never populated on this component's own mount — matching the original, where `fetchDiagnostics()` only ever ran via the "Refresh logs" button click or via the parent's `runPolling` loop when a download is active (Task 9). If the user visits System before either of those has happened, it still shows "resolving path..." and "No log buffer entries captured.", exactly as before.

- [ ] **Step 2: Build check**

```bash
cd /Users/light/Git/youkeep && npm run build
```
Confirm `✨ Build complete!` with no errors mentioning `SettingsSystemTab`.

- [ ] **Step 3: Commit**

```bash
cd /Users/light/Git/youkeep && git add app/components/settings/SettingsSystemTab.vue && git commit -m "$(cat <<'EOF'
feat: extract SettingsSystemTab component from settings.vue

Seventh step of the settings.vue split. Moves the System tab's
diagnostics/yt-dlp-update template and script. diagnosticLogs and
diagnosticYtdlPath are consumed from useDownloadsQueue() rather than
owned locally, since the parent's downloads polling loop (Task 9)
must be able to populate them even while this tab isn't mounted; the
original auto-scroll-on-update side effect is reproduced here with a
watch() on the composable's diagnosticLogs.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: `app/components/settings/SettingsUsersTab.vue`

**Files:**
- Create: `app/components/settings/SettingsUsersTab.vue`

**Interfaces:**
- Consumes: `useAdminChannels()` (Task 3) for `channels` only (not `stats`/`refreshStats` — the Users tab never touches those).
- Produces: nothing consumed by other tasks (leaf tab component).

This is the Users tab's template (original lines 974–1158) and script (the `/* 4. USERS TAB */` region, original lines 2021–2141), plus `generatedPassword` (original line 1193, declared just above the numbered sections but used only by this tab's template/handlers) and `formatDate` (from the "Helper formats" block, used only here per the earlier grep).

- [ ] **Step 1: Create the component file**

Create `app/components/settings/SettingsUsersTab.vue` with this exact content:

```vue
<template>
  <div class="tab-pane">
    <div class="users-dashboard-layout">
      <!-- Left Side: User profile config (40% width) -->
      <div class="user-config-col">
        <div class="user-form-panel glass-panel">
          <div class="section-title-row">
            <div class="icon-orb bg-purple">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><polyline points="16 11 18 13 22 9"></polyline></svg>
            </div>
            <div>
              <h3>{{ editingUserId ? 'Modify User Profile' : 'Register Account' }}</h3>
              <p class="section-desc">Create profiles, define access roles, and assign channel track lists permissions.</p>
            </div>
          </div>
          
          <form @submit.prevent="handleSaveUser" class="user-form mt-4">
            <div class="form-group">
              <label class="form-label" for="u_username">Username</label>
              <input 
                type="text" 
                id="u_username" 
                v-model="userForm.username" 
                class="form-input" 
                placeholder="e.g. Paul" 
                required
                :disabled="!!editingUserId"
              />
            </div>

            <div class="form-group">
              <label class="form-label" for="u_password">
                {{ editingUserId ? 'New password (leave empty to keep unchanged)' : 'Password (leave empty to auto-generate)' }}
              </label>
              <input 
                type="password" 
                id="u_password" 
                v-model="userForm.password" 
                class="form-input" 
                placeholder="•••••••• (Optional)" 
              />
            </div>

            <div class="form-group">
              <label class="form-label">Authorization Role</label>
              <div class="role-selector-premium">
                <label class="role-card" :class="{ active: userForm.role === 'user' }">
                  <input type="radio" v-model="userForm.role" value="user" style="display: none;" />
                  <div class="role-card-inner">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                    <span>Standard User</span>
                  </div>
                </label>
                <label class="role-card" :class="{ active: userForm.role === 'admin' }">
                  <input type="radio" v-model="userForm.role" value="admin" style="display: none;" />
                  <div class="role-card-inner">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"></path></svg>
                    <span>Administrator</span>
                  </div>
                </label>
              </div>
            </div>

            <!-- Access checklist for user role -->
            <div v-if="userForm.role === 'user'" class="permissions-section-premium mt-3">
              <h4>Channel Scope Permissions</h4>
              
              <div class="form-group mt-2">
                <label class="checkbox-container">
                  <input type="checkbox" v-model="fullChannelAccess" />
                  <span class="checkmark"></span>
                  Full visibility on all channels
                </label>
              </div>

              <!-- Channels list (only if NOT full access) -->
              <div v-if="!fullChannelAccess" class="perm-col mt-2">
                <span class="perm-label">Restrict access to specific channels :</span>
                <div class="checklist-container-premium mt-2">
                  <label v-for="ch in channels" :key="ch.id" class="check-item-premium">
                    <input type="checkbox" v-model="userForm.channelAccess" :value="ch.id" />
                    <span class="checkmark-mini"></span>
                    <span>{{ ch.title }}</span>
                  </label>
                </div>
              </div>
            </div>

             <div v-if="generatedPassword" class="credentials-alert-box mt-3">
              <strong class="alert-title">Account configured successfully!</strong>
              <div class="credentials-display mt-2">
                <div>Username: <code>{{ oldUsername || userForm.username }}</code></div>
                <div class="mt-1">Temporary password: <code class="pass-code">{{ generatedPassword }}</code></div>
              </div>
              
              <div class="mt-3">
                <button type="button" @click="copyCredentials" class="btn btn-secondary-dark btn-xs">
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect></svg>
                  Copy credentials
                </button>
              </div>
            </div>

            <div v-if="userFormMessage" class="form-msg mt-3" :class="userFormSuccess ? 'success-msg' : 'error-msg'">
              {{ userFormMessage }}
            </div>

            <div class="form-actions mt-3">
              <button type="submit" class="btn btn-primary">
                {{ editingUserId ? 'Update Profile' : 'Create Account' }}
              </button>
              <button v-if="editingUserId" type="button" @click="cancelEditUser" class="btn btn-secondary-dark ml-2">
                Cancel
              </button>
            </div>
          </form>
        </div>
      </div>

      <!-- Right Side: Accounts List (60% width) -->
      <div class="users-list-col">
        <div class="users-list-panel glass-panel">
          <div class="col-header-row">
            <div class="flex-align-center gap-10">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--accent-primary);"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
              <h3 style="margin: 0; font-size: 15px; font-weight: 700; color: white;">Saved User Accounts</h3>
            </div>
          </div>

          <div v-if="usersPending" class="users-loading-state mt-4">
            <div class="spinner"></div>
          </div>
          <div v-else-if="users.length === 0" class="users-empty-state mt-4">
            No registered profiles. Add a profile using the config panel.
          </div>
          <div v-else class="users-list-grid mt-3">
            <div v-for="u in users" :key="u.id" class="user-card-premium">
              <div class="user-card-header">
                <div class="user-avatar-circle">
                  {{ u.username.slice(0, 2).toUpperCase() }}
                </div>
                <div class="user-headline-col">
                  <h4>{{ u.username }}</h4>
                  <UiBadge :tone="u.role === 'admin' ? 'completed' : 'neutral'">
                    {{ u.role === 'admin' ? 'Administrator' : 'Standard User' }}
                  </UiBadge>
                </div>
              </div>

              <div class="user-card-meta mt-2">
                <span class="user-date">Registered: {{ formatDate(u.created_at) }}</span>
                <span class="user-scope" v-if="u.role === 'user'">
                  {{ u.channelAccess?.length ? `Ultra-private access: ${u.channelAccess.length} channel(s)` : 'No ultra-private access' }}
                </span>
              </div>

              <div class="user-card-action-bar border-t mt-3 pt-2">
                <button 
                  @click="handleResetPassword(u.id, u.username)" 
                  class="btn-action-premium-icon" 
                  title="Reset password"
                  :disabled="u.id === currentUser?.id"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                  <span>Reset Password</span>
                </button>
                <button @click="loadUserForEdit(u)" class="btn-action-premium-icon" title="Edit Profile">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                  <span>Edit</span>
                </button>
                <button 
                  @click="handleDeleteUser(u.id, u.username)" 
                  class="btn-action-premium-icon danger-icon" 
                  title="Delete Profile"
                  :disabled="u.id === currentUser?.id || u.username === 'admin'"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                  <span>Delete</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed } from 'vue';
import { useAuth } from '~/composables/useAuth';
import { useAdminChannels } from '~/composables/useAdminChannels';
import { useToast } from '~/composables/useToast';

const toast = useToast();
const { user: currentUser } = useAuth();
const { channels } = await useAdminChannels();

const { data: usersData, pending: usersPending, refresh: refreshUsers } = await useFetch<{ users: any[] }>('/api/admin/users');
const users = computed(() => usersData.value?.users || []);

const generatedPassword = ref('');
const editingUserId = ref<string | null>(null);
const fullChannelAccess = ref(true);

const userForm = reactive({
  username: '',
  password: '',
  role: 'user' as 'user' | 'admin',
  channelAccess: [] as string[]
});
const userFormMessage = ref('');
const userFormSuccess = ref(false);
const oldUsername = ref('');

const copyCredentials = () => {
  const text = `YouKeep Credentials:\nUsername: ${oldUsername.value || userForm.username}\nTemporary password: ${generatedPassword.value}`;
  navigator.clipboard.writeText(text).then(() => {
    toast.success('Credentials copied to clipboard!');
  }).catch(() => {
    toast.error('Copy failed.');
  });
};

const loadUserForEdit = (user: any) => {
  generatedPassword.value = '';
  oldUsername.value = '';
  editingUserId.value = user.id;
  userForm.username = user.username;
  userForm.password = '';
  userForm.role = user.role;
  userForm.channelAccess = [...(user.channelAccess || [])];
  
  // Set toggle if user channel access matches all available channels
  const allIds = channels.value.map((c: any) => c.id);
  fullChannelAccess.value = allIds.length > 0 && allIds.every((id: string) => userForm.channelAccess.includes(id));
  
  userFormMessage.value = '';
};

const cancelEditUser = () => {
  editingUserId.value = null;
  userForm.username = '';
  userForm.password = '';
  userForm.role = 'user';
  userForm.channelAccess = [];
  fullChannelAccess.value = true;
  userFormMessage.value = '';
};

const handleSaveUser = async () => {
  userFormMessage.value = '';
  const submitChannelAccess = fullChannelAccess.value && userForm.role === 'user'
    ? channels.value.map((c: any) => c.id)
    : userForm.channelAccess;

  try {
    if (editingUserId.value) {
      await $fetch(`/api/admin/users/${editingUserId.value}`, {
        method: 'PUT',
        body: {
          password: userForm.password || undefined,
          role: userForm.role,
          channelAccess: submitChannelAccess
        }
      });
      userFormSuccess.value = true;
      userFormMessage.value = 'User updated successfully.';
    } else {
      const res = await $fetch<any>('/api/admin/users', {
        method: 'POST',
        body: {
          username: userForm.username,
          password: userForm.password,
          role: userForm.role,
          channelAccess: submitChannelAccess
        }
      });
      userFormSuccess.value = true;
      userFormMessage.value = 'User created successfully.';
      if (res && res.password) {
        generatedPassword.value = res.password;
      }
    }
    oldUsername.value = userForm.username;
    cancelEditUser();
    refreshUsers();
  } catch (err: any) {
    userFormSuccess.value = false;
    userFormMessage.value = err.data?.statusMessage || 'An error occurred.';
  }
};

const handleDeleteUser = async (id: string, name: string) => {
  if (!confirm(`Permanently delete the user "${name}"?`)) return;
  try {
    await $fetch(`/api/admin/users/${id}`, { method: 'DELETE' });
    refreshUsers();
    toast.success('User deleted.');
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Delete failed.');
  }
};

const handleResetPassword = async (userId: string, username: string) => {
  if (!confirm(`Do you want to reset the password for "${username}"? A new temporary password will be generated.`)) return;
  try {
    const res = await $fetch<any>(`/api/admin/users/${userId}/reset-password`, {
      method: 'POST'
    });
    if (res && res.password) {
      generatedPassword.value = res.password;
      oldUsername.value = res.username;
      toast.success('Password reset.');
    }
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Reset failed.');
  }
};

const formatDate = (ts: number) => {
  return new Date(ts).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
};
</script>
```

- [ ] **Step 2: Build check**

```bash
cd /Users/light/Git/youkeep && npm run build
```
Confirm `✨ Build complete!` with no errors mentioning `SettingsUsersTab`.

- [ ] **Step 3: Commit**

```bash
cd /Users/light/Git/youkeep && git add app/components/settings/SettingsUsersTab.vue && git commit -m "$(cat <<'EOF'
feat: extract SettingsUsersTab component from settings.vue

Eighth step of the settings.vue split. Moves the Users tab's template
and script, consuming the shared channel list from useAdminChannels()
for the per-user "full channel access" checkboxes.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Rewrite `app/pages/settings.vue`

**This task MUST come last** — it depends on the final shape of every composable and component from Tasks 1–8.

**Files:**
- Modify: `app/pages/settings.vue` (full rewrite)

**Interfaces:**
- Consumes: `useDownloadsQueue()` (Task 1) for `activeDownloadCount`/`fetchQueue`/`fetchDiagnostics`/`stopSmoothProgressLoop`; `useMusicQueue()` (Task 2) for `musicQueue`/`musicActiveDownloadCount`/`fetchMusicQueue`; renders `<SettingsStatsTab>`, `<SettingsDownloadsTab>`, `<SettingsMusicTab>`, `<SettingsSystemTab>`, `<SettingsUsersTab>` (Tasks 4–8) via Nuxt component auto-import.
- Produces: nothing (this is the page itself).

**On component auto-import naming:** `app/nuxt.config.ts` has no `components:` key at all (confirmed by reading it in full — it only sets `compatibilityDate`, `devtools`, `css`, `nitro.externals`, and `app.head`), so Nuxt uses its default component-scanning behavior for every directory under `app/components/`, including nested ones, with directory-based prefixing enabled by default. The existing `app/components/ui/UiBadge.vue` proves how that default resolves in practice in this exact codebase: it registers as `<UiBadge>`, not `<UiUiBadge>` — Nuxt does not double a prefix that the filename already starts with. The same rule applies here: `app/components/settings/SettingsStatsTab.vue` (filename already starting with "Settings", matching the `settings/` directory) auto-registers as `<SettingsStatsTab>`, not `<SettingsSettingsStatsTab>`. This plan relies on that default auto-import rather than adding explicit local imports/registrations, since it's directly evidenced by an existing, working component in this codebase rather than assumed from documentation alone.

**On why the entire `<style>` block moves to the parent unscoped, unmodified:** Vue's `<style scoped>` works by compiling a unique `data-v-xxxxxx` attribute onto every element in *that specific SFC's own template* and rewriting that SFC's CSS selectors to require the same attribute. It does not propagate into child components' templates. The original `settings.vue`'s scoped CSS (1918 lines) was written against a single template containing all 5 tabs' markup — reading through it (Tasks 1–8 above) shows extensive class-name reuse across tabs (`.form-msg`, `.checkbox-container`, `.queue-card-premium`, `.section-title-row`, `.badge-active-global`, and dozens more all appear in 2+ tabs' templates). If this plan left `<style scoped>` in the parent and moved only the templates into child components, none of that CSS would apply anymore — every tab would render unstyled. The design spec approved for this split didn't address CSS at all (it scoped the split to "template + script"), so this is a necessary addition made during planning, not called out in the original spec: the fix is to move the entire style block into the parent verbatim, with the `scoped` attribute removed. An unscoped `<style>` block in a Nuxt/Vue SFC compiles to plain global CSS with no attribute-selector rewriting, so it applies to any element with a matching class anywhere in the DOM — including elements rendered by the child tab components. This preserves every visual style exactly as-is (same selectors, same rules, same specificity) while satisfying the split; it is a zero-behavior-change requirement, not a style rewrite.

- [ ] **Step 1: Replace the entire contents of `app/pages/settings.vue`**

Replace the entire file with this exact content. The `<template>` and `<script setup>` sections are new (thin shell); the `<style>` section is the original file's complete 1918-line style block with only the word `scoped` removed from the opening tag — copied verbatim, not rewritten, per the note above.

```vue
<template>
  <div class="settings-container">
    <h1 class="page-title text-gradient">Application Settings</h1>

    <div class="settings-layout">
      <!-- Tabs Sidebar -->
      <div v-if="isAdmin" class="settings-tabs glass-panel">
        <button 
          v-if="isAdmin && !currentUser?.mustChangePassword" 
          class="tab-btn" 
          :class="{ active: activeTab === 'stats' }" 
          @click="activeTab = 'stats'"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>
          <span>Dashboard</span>
        </button>

        <button 
          v-if="isAdmin && !currentUser?.mustChangePassword" 
          class="tab-btn" 
          :class="{ active: activeTab === 'downloads' }" 
          @click="activeTab = 'downloads'"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
          <span>Downloads</span>
          <span v-if="activeDownloadCount > 0" class="tab-badge">{{ activeDownloadCount }}</span>
        </button>

        <button
          v-if="isAdmin && !currentUser?.mustChangePassword"
          class="tab-btn"
          :class="{ active: activeTab === 'music' }"
          @click="activeTab = 'music'"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>
          <span>Music</span>
          <span v-if="musicActiveDownloadCount > 0" class="tab-badge">{{ musicActiveDownloadCount }}</span>
        </button>

        <button
          v-if="isAdmin && !currentUser?.mustChangePassword"
          class="tab-btn"
          :class="{ active: activeTab === 'users' }"
          @click="activeTab = 'users'"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
          <span>Users</span>
        </button>

        <button 
          v-if="isAdmin && !currentUser?.mustChangePassword" 
          class="tab-btn" 
          :class="{ active: activeTab === 'system' }" 
          @click="activeTab = 'system'"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"></path></svg>
          <span>System</span>
        </button>

      </div>

      <!-- Tab Content Area -->
      <div class="settings-content">
        <SettingsStatsTab v-if="activeTab === 'stats' && isAdmin" />
        <SettingsDownloadsTab v-if="activeTab === 'downloads' && isAdmin" />
        <SettingsMusicTab v-if="activeTab === 'music' && isAdmin" />
        <SettingsSystemTab v-if="activeTab === 'system' && isAdmin" />
        <SettingsUsersTab v-if="activeTab === 'users' && isAdmin" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';
import { useAuth } from '~/composables/useAuth';
import { useDownloadsQueue } from '~/composables/useDownloadsQueue';
import { useMusicQueue } from '~/composables/useMusicQueue';

const { user: currentUser, isAdmin } = useAuth();
const route = useRoute();

const allowedTabs = ['stats', 'downloads', 'users', 'system'];
const queryTab = route.query.tab ? String(route.query.tab) : '';
const initialTab = allowedTabs.includes(queryTab) ? queryTab : 'stats';
if (!isAdmin.value) {
  navigateTo('/account');
}

const activeTab = ref(initialTab);

watch(() => route.query.tab, (newTab) => {
  if (newTab && allowedTabs.includes(String(newTab))) {
    activeTab.value = String(newTab);
  }
});

const { activeDownloadCount, fetchQueue, fetchDiagnostics, stopSmoothProgressLoop } = useDownloadsQueue();
const { musicQueue, musicActiveDownloadCount, fetchMusicQueue } = useMusicQueue();

// Dynamic polling for queue and progress
let pollingTimeout: any = null;

const runPolling = async () => {
  if (!isAdmin.value) return;
  await fetchQueue();
  // Only poll diagnostics when downloads are active
  if (activeDownloadCount.value > 0) {
    await fetchDiagnostics();
  }

  // If we have active downloads, poll faster (500ms) for high reactivity, otherwise poll every 3000ms
  const nextPollDelay = activeDownloadCount.value > 0 ? 500 : 3000;
  pollingTimeout = setTimeout(runPolling, nextPollDelay);
};

let musicPollingTimeout: any = null;

const runMusicPolling = async () => {
  if (!isAdmin.value || activeTab.value !== 'music') {
    musicPollingTimeout = setTimeout(runMusicPolling, 3000);
    return;
  }
  await fetchMusicQueue();
  const hasActiveMusicDownload = musicQueue.value.some(t => t.download_status === 'downloading');
  const nextPollDelay = hasActiveMusicDownload ? 500 : 3000;
  musicPollingTimeout = setTimeout(runMusicPolling, nextPollDelay);
};

onMounted(() => {
  if (isAdmin.value) {
    runPolling();
    runMusicPolling();
  }
});

onUnmounted(() => {
  if (pollingTimeout) clearTimeout(pollingTimeout);
  if (musicPollingTimeout) clearTimeout(musicPollingTimeout);
  stopSmoothProgressLoop();
});
</script>

<style>

.settings-container {
  display: flex;
  flex-direction: column;
  gap: 20px;
  max-width: 1200px;
  margin: 0 auto;
  width: 100%;
}

.settings-layout {
  display: grid;
  grid-template-columns: var(--sidebar-width) 1fr;
  gap: 24px;
  align-items: start;
}

@media (max-width: 900px) {
  .settings-layout {
    grid-template-columns: 1fr;
  }
}

.settings-tabs {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
  border-radius: var(--border-radius-md);
}

@media (max-width: 900px) {
  .settings-tabs {
    flex-direction: row;
    overflow-x: auto;
    white-space: nowrap;
    padding: 8px;
  }
}

.tab-btn {
  width: 100%;
  text-align: left;
  justify-content: flex-start;
}

.tab-badge {
  background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
  color: white;
  font-size: 9px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 8px;
  margin-left: auto;
}

.settings-content {
  flex: 1;
  min-width: 0;
}

.tab-pane {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.pane-header h2 {
  font-size: 24px;
  font-weight: 700;
  margin-bottom: 4px;
}

.pane-header p {
  color: var(--text-secondary);
  font-size: 14px;
}

/* Metrics Dashboard */
.metrics-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 16px;
}

.metric-card {
  display: flex;
  flex-direction: column;
  padding: 20px;
  border-radius: var(--border-radius-md);
}

.metric-label {
  font-size: 12px;
  text-transform: uppercase;
  color: var(--text-muted);
  font-weight: 700;
  letter-spacing: 0.05em;
  margin-bottom: 8px;
}

.metric-value {
  font-size: 28px;
  font-weight: 800;
  font-family: var(--font-title);
  line-height: 1.2;
}

.metric-sub {
  font-size: 11px;
  color: var(--text-secondary);
  margin-top: 4px;
}

.stats-row {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.stats-col {
  padding: 20px;
  border-radius: var(--border-radius-md);
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.stats-col h3 {
  font-size: 16px;
  font-weight: 600;
}

.stats-empty {
  color: var(--text-muted);
  font-size: 13px;
  padding: 12px 0;
}

.stats-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.stats-list-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.stats-item-info {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
}

.item-title {
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 250px;
}

.item-count {
  color: var(--text-secondary);
}

.stats-item-bar-bg {
  height: 6px;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 3px;
  overflow: hidden;
}

.stats-item-bar {
  height: 100%;
  background: linear-gradient(90deg, var(--accent-primary), var(--accent-primary-hover));
  border-radius: 3px;
}

.secondary-gradient {
  background: linear-gradient(90deg, var(--accent-secondary), var(--accent-secondary-hover)) !important;
}

/* Ingestion Form */
.ingest-box, .config-section, .profile-box {
  padding: 24px;
  border-radius: var(--border-radius-md);
}

.ingest-box h3, .config-section h3, .profile-box h4 {
  font-size: 16px;
  margin-bottom: 8px;
}

.section-desc {
  font-size: 13px;
  color: var(--text-secondary);
}

.ingest-form {
  display: flex;
  gap: 12px;
  margin-top: 16px;
}

@media (max-width: 600px) {
  .ingest-form {
    flex-direction: column;
  }
}





.queue-actions-row {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

/* Queue List */
.queue-box {
  padding: 24px;
  border-radius: var(--border-radius-md);
}

.queue-box h3 {
  font-size: 16px;
  margin-bottom: 16px;
}

.queue-empty {
  color: var(--text-muted);
  font-size: 13px;
  text-align: center;
  padding: 24px 0;
}

.queue-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.queue-card {
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.04);
  border-radius: var(--border-radius-sm);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.queue-details {
  display: flex;
  justify-content: space-between;
  align-items: start;
  gap: 16px;
}

.queue-text {
  flex: 1;
  min-width: 0;
}

.queue-title {
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.queue-channel {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 2px;
}

.queue-error {
  font-size: 11px;
  color: #f87171;
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.15);
  border-radius: 4px;
  padding: 8px 12px;
  font-family: var(--font-mono, monospace);
  line-height: 1.4;
  word-break: break-word;
  white-space: pre-wrap;
}

.badge {
  padding: 3px 8px;
  font-size: 11px;
  border-radius: 4px;
  font-weight: 600;
}

.badge-pending {
  background: rgba(234, 179, 8, 0.15);
  color: #fbbf24;
}

.badge-downloading {
  background: rgba(139, 92, 246, 0.15);
  color: #a78bfa;
}

.badge-completed {
  background: rgba(34, 197, 94, 0.15);
  color: #4ade80;
}

.badge-failed {
  background: rgba(239, 68, 68, 0.15);
  color: #f87171;
}

.queue-progress-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.progress-bar-bg {
  flex: 1;
  height: 6px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 3px;
  overflow: hidden;
}

.progress-bar-fill {
  height: 100%;
  background: linear-gradient(
    90deg,
    var(--accent-primary) 0%,
    var(--accent-secondary) 50%,
    var(--accent-primary) 100%
  );
  background-size: 200% 100%;
  box-shadow: 0 0 8px var(--accent-primary-glow), 0 0 3px var(--accent-primary);
  border-radius: 3px;
  animation: progress-shimmer 2.5s infinite linear;
  transition: width 0.4s cubic-bezier(0.25, 0.8, 0.25, 1);
}

@keyframes progress-shimmer {
  0% {
    background-position: 100% 0;
  }
  100% {
    background-position: -100% 0;
  }
}

.progress-percent {
  font-size: 12px;
  font-weight: 600;
  width: 35px;
  text-align: right;
}

.queue-meta {
  display: flex;
  gap: 16px;
  font-size: 12px;
  color: var(--text-secondary);
}

.queue-card-actions {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}



/* Logs Terminal */
.logs-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.logs-header h3 {
  font-size: 15px;
}

.logs-terminal {
  background: #030307;
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 6px;
  padding: 16px;
  font-family: monospace;
  font-size: 12px;
  max-height: 250px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.log-line {
  white-space: pre-wrap;
  word-break: break-all;
}

.log-default { color: #d1d5db; }
.log-info { color: #3b82f6; }
.log-success { color: #10b981; }
.log-warning { color: #f59e0b; }
.log-error { color: #ef4444; }

/* Configuration Elements */
.checkbox-container {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
  cursor: pointer;
  user-select: none;
}

.checkbox-container input {
  display: none;
}

.checkmark {
  width: 18px;
  height: 18px;
  border: 2px solid rgba(255, 255, 255, 0.2);
  border-radius: 4px;
  display: inline-block;
  position: relative;
  transition: all 0.2s;
}

.checkbox-container input:checked ~ .checkmark {
  background: var(--accent-primary);
  border-color: var(--accent-primary);
}

.checkbox-container input:checked ~ .checkmark::after {
  content: '';
  position: absolute;
  left: 5px;
  top: 1px;
  width: 4px;
  height: 8px;
  border: solid white;
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}

.schedule-settings-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-top: 16px;
}

@media (max-width: 600px) {
  .schedule-settings-row {
    grid-template-columns: 1fr;
  }
}



.diagnostic-pre {
  background: #030307;
  padding: 12px;
  border-radius: 6px;
  font-family: monospace;
  font-size: 11px;
  max-height: 180px;
  overflow-y: auto;
  border: 1px solid rgba(255, 255, 255, 0.05);
}

.diagnostic-status-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
}

.diagnostic-label {
  font-weight: 600;
  color: var(--text-secondary);
  width: 70px;
}

.badge-status {
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
}

.badge-success {
  background: rgba(16, 185, 129, 0.15);
  color: #10b981;
  border: 1px solid rgba(16, 185, 129, 0.2);
}

.badge-warning {
  background: rgba(245, 158, 11, 0.15);
  color: #f59e0b;
  border: 1px solid rgba(245, 158, 11, 0.2);
}

.badge-danger {
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
  border: 1px solid rgba(239, 68, 68, 0.2);
}

.diagnostic-version-text {
  font-size: 12px;
  color: var(--text-secondary);
}

.ffmpeg-warning-box {
  background: rgba(245, 158, 11, 0.08);
  border: 1px solid rgba(245, 158, 11, 0.15);
  padding: 12px 16px;
  border-radius: 8px;
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.5;
}

.warning-title {
  color: #f59e0b;
  display: block;
  margin-bottom: 4px;
}

.warning-desc {
  margin: 0;
}

.btn-group {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}



/* Users Admin Layout */
.users-layout {
  display: grid;
  grid-template-columns: 350px 1fr;
  gap: 24px;
  align-items: start;
}

@media (max-width: 900px) {
  .users-layout {
    grid-template-columns: 1fr;
  }
}

.user-form-panel, .users-list-panel {
  padding: 24px;
  border-radius: var(--border-radius-md);
}

.role-selector {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.role-option {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
  background: rgba(0, 0, 0, 0.2);
  text-align: center;
}

.role-option input {
  display: none;
}

.role-option span {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
}

.role-option.selected {
  border-color: var(--accent-primary);
  background: rgba(139, 92, 246, 0.08);
}

.role-option.selected span {
  color: white;
}

.permissions-grids {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.perm-col {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.perm-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--text-muted);
}

.checklist-container {
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 6px;
  padding: 8px;
  max-height: 150px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.check-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  cursor: pointer;
}

.check-item input {
  cursor: pointer;
}

.check-item span {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.form-msg {
  padding: 10px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
}

.success-msg {
  background: rgba(34, 197, 94, 0.1);
  border: 1px solid rgba(34, 197, 94, 0.2);
  color: #4ade80;
}

.error-msg {
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.2);
  color: #f87171;
}

.users-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.user-card {
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.04);
  border-radius: var(--border-radius-sm);
  padding: 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
}

.user-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.user-headline {
  display: flex;
  align-items: center;
  gap: 8px;
}

.user-created {
  font-size: 11px;
}

.user-access-summary {
  display: flex;
  gap: 12px;
  font-size: 11px;
  margin-top: 4px;
}

.user-actions {
  display: flex;
  gap: 8px;
}

.btn-icon-sm {
  padding: 8px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* Account Profile Pane */
.profile-details-row {
  display: flex;
  align-items: center;
  gap: 20px;
}

.profile-avatar-large {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28px;
  font-weight: 800;
  font-family: var(--font-title);
  box-shadow: 0 4px 16px var(--accent-primary-glow);
}

.profile-meta-info {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.profile-meta-info h3 {
  font-size: 20px;
}

.password-change-form {
  border-top: 1px solid rgba(255, 255, 255, 0.05);
  padding-top: 20px;
}

.password-change-form h4 {
  font-size: 14px;
  margin-bottom: 12px;
}

.ml-2 { margin-left: 8px; }
.mr-2 { margin-right: 8px; }
.mt-2 { margin-top: 8px; }
.mt-3 { margin-top: 12px; }
.mt-4 { margin-top: 24px; }
.text-success { color: #4ade80; }
.text-danger { color: #f87171; }
.text-muted { color: var(--text-muted); }

@keyframes spin {
  to { transform: rotate(360deg); }
}

.spin-anim {
  animation: spin 1.2s linear infinite;
}

/* Modals */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  animation: fadeIn 0.2s ease-out;
}

.modal-content {
  width: 90%;
  max-width: 550px;
  background: rgba(18, 18, 29, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: var(--border-radius-md);
  padding: 24px;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5);
  animation: slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  padding-bottom: 12px;
}

.modal-header h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
}

.btn-close {
  background: transparent;
  border: none;
  color: var(--text-secondary);
  font-size: 24px;
  cursor: pointer;
  padding: 0;
  line-height: 1;
}

.btn-close:hover {
  color: white;
}

/* Search results styles */
.search-results-list {
  border-top: 1px solid rgba(255, 255, 255, 0.05);
  padding-top: 16px;
}

.search-results-grid {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: 300px;
  overflow-y: auto;
  padding-right: 4px;
}

.search-channel-card {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.04);
  border-radius: 8px;
  transition: all 0.2s;
}

.search-channel-card:hover {
  background: rgba(255, 255, 255, 0.04);
  border-color: rgba(255, 255, 255, 0.08);
}

.channel-avatar-thumb {
  width: 50px;
  height: 50px;
  border-radius: 50%;
  object-fit: cover;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(0, 0, 0, 0.2);
}

.channel-search-info {
  flex: 1;
  min-width: 0;
}

.channel-search-info h5 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: white;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.channel-search-meta {
  margin: 2px 0 0;
  font-size: 11px;
  color: var(--text-secondary);
}

.channel-search-desc {
  margin: 4px 0 0;
  font-size: 11px;
  color: var(--text-muted);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* Global status badges */
.badge-active-global {
  background: rgba(16, 185, 129, 0.15);
  color: #10b981;
  border: 1px solid rgba(16, 185, 129, 0.2);
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 600;
}

.badge-paused-global {
  background: rgba(245, 158, 11, 0.15);
  color: #f59e0b;
  border: 1px solid rgba(245, 158, 11, 0.2);
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 600;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes slideUp {
  from { transform: translateY(20px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

/* Diagnostic Dashboard Enhancements */
.dashboard-banner {
  margin-bottom: 16px;
  padding: 24px;
  border-radius: var(--border-radius-lg);
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 24px;
  background: linear-gradient(135deg, rgba(30, 30, 50, 0.4) 0%, rgba(15, 15, 25, 0.5) 100%);
}

.banner-content h2 {
  font-size: 22px;
  font-weight: 800;
  color: white;
  margin: 0 0 6px 0;
  letter-spacing: -0.01em;
}

.banner-content p {
  color: var(--text-secondary);
  font-size: 13.5px;
  margin: 0;
  max-width: 600px;
  line-height: 1.5;
}

.system-status-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: rgba(16, 185, 129, 0.1);
  color: #34d399;
  border: 1px solid rgba(16, 185, 129, 0.2);
  padding: 4px 10px;
  border-radius: 20px;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 12px;
}

.pulse-dot {
  width: 6px;
  height: 6px;
  background: #10b981;
  border-radius: 50%;
  display: inline-block;
  animation: pulse-badge 2s infinite ease-in-out;
}

@keyframes pulse-badge {
  0% { transform: scale(0.85); opacity: 1; }
  50% { transform: scale(1.2); opacity: 0.6; }
  100% { transform: scale(0.85); opacity: 1; }
}

.banner-quick-stats {
  display: flex;
  align-items: center;
  gap: 28px;
  background: rgba(255, 255, 255, 0.02);
  padding: 14px 24px;
  border-radius: var(--border-radius-md);
  border: 1px solid rgba(255, 255, 255, 0.04);
}

.quick-stat-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.stat-number {
  font-size: 20px;
  font-weight: 800;
  color: white;
  font-family: var(--font-title);
}

.text-accent {
  color: var(--accent-secondary) !important;
}

.stat-label {
  font-size: 10px;
  color: var(--text-secondary);
  text-transform: uppercase;
  font-weight: 700;
  letter-spacing: 0.03em;
}

.quick-stat-divider {
  width: 1px;
  height: 32px;
  background: rgba(255, 255, 255, 0.08);
}

.metric-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  margin-bottom: 6px;
}

.metric-icon {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.03);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
  border: 1px solid rgba(255, 255, 255, 0.05);
  transition: all 0.3s ease;
}

.metric-card:hover .metric-icon {
  color: white;
  background: rgba(255, 255, 255, 0.08);
  transform: translateY(-2px);
}

.metric-card.glow-purple:hover {
  border-color: rgba(139, 92, 246, 0.3);
  box-shadow: 0 8px 30px rgba(139, 92, 246, 0.1);
}

.metric-card.glow-blue:hover {
  border-color: rgba(59, 130, 246, 0.3);
  box-shadow: 0 8px 30px rgba(59, 130, 246, 0.1);
}

.metric-card.glow-green:hover {
  border-color: rgba(16, 185, 129, 0.3);
  box-shadow: 0 8px 30px rgba(16, 185, 129, 0.1);
}

.metric-card.glow-pink:hover {
  border-color: rgba(236, 72, 153, 0.3);
  box-shadow: 0 8px 30px rgba(236, 72, 153, 0.1);
}

.col-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  padding-bottom: 12px;
}

.col-header h3 {
  font-size: 15px;
  font-weight: 700;
  margin: 0;
  letter-spacing: -0.01em;
  color: white;
}

.stats-item-title-col {
  display: flex;
  align-items: center;
  gap: 8px;
}

.mini-tag {
  font-size: 8px !important;
  padding: 1px 4px !important;
  border-radius: 4px !important;
  line-height: 1 !important;
}

.diagnostic-panel {
  display: flex;
  flex-direction: column;
}

.diagnostic-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 16px;
}

.diag-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
  padding-bottom: 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.03);
}

.diag-label {
  color: var(--text-secondary);
}

.diag-value {
  font-weight: 600;
  color: var(--text-primary);
}

.font-highlight {
  color: var(--accent-primary) !important;
}

.warning-highlight {
  color: #fbbf24 !important;
}

.diagnostic-check {
  margin-top: auto;
  background: rgba(16, 185, 129, 0.02);
  border: 1px solid rgba(16, 185, 129, 0.1);
  border-radius: var(--border-radius-md);
  padding: 14px 18px;
  display: flex;
  align-items: center;
  gap: 14px;
}

.check-radar {
  position: relative;
  width: 24px;
  height: 24px;
  flex-shrink: 0;
}

.radar-dot {
  position: absolute;
  top: 9px;
  left: 9px;
  width: 6px;
  height: 6px;
  background: #10b981;
  border-radius: 50%;
}

.radar-ring {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 18px;
  height: 18px;
  border: 2px solid #10b981;
  border-radius: 50%;
  animation: radar-ripple 1.8s infinite ease-out;
  opacity: 0;
}

@keyframes radar-ripple {
  0% { transform: scale(0.4); opacity: 1; }
  100% { transform: scale(1.4); opacity: 0; }
}

.check-text h4 {
  font-size: 13px;
  font-weight: 700;
  color: #34d399;
  margin: 0;
}

.check-text p {
  font-size: 11px;
  color: var(--text-secondary);
  margin: 2px 0 0 0;
}

/* Premium Settings Layout System */
.downloads-dashboard-layout, .system-dashboard-layout, .users-dashboard-layout {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

@media (max-width: 1024px) {
  .downloads-dashboard-layout, .system-dashboard-layout, .users-dashboard-layout {
    grid-template-columns: 1fr;
  }
}

.downloads-header-panel {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 20px;
  padding: 24px;
  border-radius: var(--border-radius-lg);
  margin-bottom: 16px;
}

.downloads-header-panel h2 {
  font-size: 18px;
  font-weight: 700;
  color: white;
  margin: 0 0 4px 0;
}

.downloads-header-panel p {
  font-size: 12.5px;
  color: var(--text-secondary);
  margin: 0;
}

/* Button & Card Styles */
.btn-primary-glow {
  background: linear-gradient(135deg, var(--accent-primary) 0%, var(--accent-secondary) 100%);
  color: white;
  border: none;
  box-shadow: 0 0 16px rgba(139, 92, 246, 0.2);
}

.btn-primary-glow:hover {
  transform: translateY(-2px);
  box-shadow: 0 0 24px rgba(139, 92, 246, 0.45);
}

.btn-secondary-dark {
  background: rgba(255, 255, 255, 0.04);
  color: var(--text-primary);
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.btn-secondary-dark:hover {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.12);
  color: white;
}

.btn-clean {
  border-radius: var(--border-radius-md) !important;
  font-size: 13px !important;
}

/* Form items icons */
.section-title-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  padding-bottom: 16px;
}

.section-title-row h3 {
  font-size: 15px;
  font-weight: 700;
  color: white;
  margin: 0 0 2px 0;
}

.section-title-row .section-desc {
  font-size: 12px;
  color: var(--text-secondary);
  margin: 0;
}

.icon-orb {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.icon-orb.bg-purple {
  background: rgba(139, 92, 246, 0.15);
  color: #a78bfa;
  border: 1px solid rgba(139, 92, 246, 0.25);
}

.icon-orb.bg-blue {
  background: rgba(59, 130, 246, 0.15);
  color: #60a5fa;
  border: 1px solid rgba(59, 130, 246, 0.25);
}

.icon-orb.bg-pink {
  background: rgba(236, 72, 153, 0.15);
  color: #f472b6;
  border: 1px solid rgba(236, 72, 153, 0.25);
}

/* Custom search elements */
.search-input-wrapper {
  position: relative;
  flex: 1;
}

.search-input {
  padding-left: 40px !important;
}

.search-icon {
  position: absolute;
  left: 14px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-secondary);
  pointer-events: none;
}

.results-header {
  font-size: 13px;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--text-secondary);
  letter-spacing: 0.05em;
  margin-bottom: 12px;
}

.search-results-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 12px;
  max-height: 400px;
  overflow-y: auto;
  padding-right: 6px;
}

/* Custom forms integration */
.policy-form-block {
  width: 100%;
}

.border-t {
  border-top: 1px solid rgba(255, 255, 255, 0.04);
}

.input-action-row {
  display: flex;
  gap: 10px;
  margin-top: 6px;
}

.input-action-row .form-input {
  flex: 1;
}

.flex-1 {
  flex: 1;
}

.flex-align-center {
  display: flex;
  align-items: center;
}

.gap-10 {
  gap: 10px;
}

/* Queue Premium list */
.queue-header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  padding-bottom: 16px;
  margin-bottom: 16px;
}

.queue-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 48px 24px;
  color: var(--text-secondary);
  height: calc(100% - 80px);
  min-height: 250px;
}

.empty-icon-cloud {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.04);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 16px;
  color: var(--text-muted);
}

.queue-empty-state h4 {
  margin: 0 0 6px 0;
  font-size: 14px;
  font-weight: 700;
  color: white;
}

.queue-empty-state p {
  margin: 0;
  font-size: 12px;
  max-width: 200px;
  line-height: 1.4;
}

.queue-list-premium {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: 600px;
  overflow-y: auto;
  padding-right: 6px;
}

.queue-card-premium {
  padding: 16px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.04);
  border-radius: var(--border-radius-md);
  display: flex;
  flex-direction: column;
  gap: 12px;
  transition: all 0.3s ease;
}

.queue-card-premium:hover {
  background: rgba(255, 255, 255, 0.03);
  border-color: rgba(255, 255, 255, 0.08);
  transform: translateY(-2px);
}

.queue-card-details {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}

.queue-card-meta-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.queue-card-title {
  font-size: 13px;
  font-weight: 600;
  color: white;
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.queue-card-channel-name {
  font-size: 11.5px;
  color: var(--text-secondary);
}

.status-badge {
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  padding: 2px 6px;
  border-radius: 12px;
  letter-spacing: 0.05em;
  flex-shrink: 0;
}

.status-pending { background: rgba(255, 255, 255, 0.05); color: var(--text-secondary); }
.status-downloading { background: rgba(139, 92, 246, 0.15); color: #a78bfa; border: 1px solid rgba(139, 92, 246, 0.25); }
.status-completed { background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.25); }
.status-failed { background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.25); }

.queue-progress-container {
  display: flex;
  align-items: center;
  gap: 12px;
}

.progress-bar-glow-bg {
  height: 5px;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 3px;
  overflow: hidden;
  flex: 1;
}

.progress-bar-glow-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--accent-primary) 0%, var(--accent-secondary) 100%);
  border-radius: 3px;
  box-shadow: 0 0 10px rgba(139, 92, 246, 0.5);
  transition: width 0.3s ease;
}

.progress-percent-text {
  font-size: 11px;
  font-weight: 700;
  color: white;
  min-width: 32px;
  text-align: right;
}

.queue-diagnostics-row {
  display: flex;
  gap: 12px;
  font-size: 11px;
  color: var(--text-secondary);
}

.queue-error-box {
  background: rgba(239, 68, 68, 0.05);
  border: 1px solid rgba(239, 68, 68, 0.15);
  padding: 8px 12px;
  border-radius: var(--border-radius-sm);
  color: #f87171;
  font-size: 11px;
  line-height: 1.4;
  word-break: break-all;
}

.queue-card-action-bar {
  display: flex;
  gap: 8px;
}

.btn-action-premium {
  padding: 4px 10px;
  font-size: 10.5px;
  font-weight: 600;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.05);
  background: rgba(255, 255, 255, 0.03);
  color: var(--text-primary);
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-action-premium:hover {
  background: rgba(255, 255, 255, 0.08);
  color: white;
}

.btn-action-danger {
  color: #ef4444;
  border-color: rgba(239, 68, 68, 0.15);
  background: rgba(239, 68, 68, 0.03);
}

.btn-action-danger:hover {
  background: rgba(239, 68, 68, 0.1);
  border-color: rgba(239, 68, 68, 0.3);
  color: #f87171;
}

/* System diagnostics tab improvements */
.system-diagnostic-col .binary-path-box {
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.04);
  padding: 10px 14px;
  border-radius: var(--border-radius-md);
  font-size: 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.path-label {
  color: var(--text-secondary);
}

.path-code {
  color: #a78bfa;
  word-break: break-all;
}

.diagnostic-version-sub {
  font-size: 11px;
  color: var(--text-secondary);
}

.ffmpeg-warning-box {
  background: rgba(245, 158, 11, 0.03);
  border: 1px solid rgba(245, 158, 11, 0.1);
  padding: 12px;
  border-radius: var(--border-radius-md);
}

.warning-title {
  color: #fbbf24;
  font-size: 12px;
  display: block;
}

.warning-desc {
  font-size: 11px;
  line-height: 1.4;
  margin: 4px 0 0 0;
  color: var(--text-secondary);
}

/* Terminal enhancement */
.logs-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-bottom: 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  margin-bottom: 14px;
}

.terminal-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}

.terminal-dot.green {
  background: #10b981;
  box-shadow: 0 0 8px #10b981;
}

.logs-terminal {
  background: #09090f;
  border: 1px solid rgba(255, 255, 255, 0.03);
  box-shadow: inset 0 0 16px rgba(0, 0, 0, 0.6);
  padding: 16px;
  border-radius: 6px;
  max-height: 480px;
  font-size: 11.5px;
  font-family: var(--font-mono);
  overflow-y: auto;
}

.log-line {
  line-height: 1.6;
  padding: 2px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.01);
}

/* User management improvements */
.role-selector-premium {
  display: flex;
  gap: 12px;
  margin-top: 6px;
}

.role-card {
  flex: 1;
  cursor: pointer;
}

.role-card-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 14px;
  border-radius: var(--border-radius-md);
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.04);
  transition: all 0.25s ease;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
}

.role-card:hover .role-card-inner {
  background: rgba(255, 255, 255, 0.04);
  border-color: rgba(255, 255, 255, 0.08);
}

.role-card.active .role-card-inner {
  background: rgba(139, 92, 246, 0.1);
  border-color: rgba(139, 92, 246, 0.4);
  color: white;
  box-shadow: 0 0 16px rgba(139, 92, 246, 0.08);
}

.permissions-section-premium {
  background: rgba(255, 255, 255, 0.01);
  border: 1px solid rgba(255, 255, 255, 0.03);
  padding: 16px;
  border-radius: var(--border-radius-md);
}

.permissions-section-premium h4 {
  font-size: 13px;
  font-weight: 700;
  margin: 0 0 10px 0;
  color: white;
}

.checklist-container-premium {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 180px;
  overflow-y: auto;
  background: rgba(0, 0, 0, 0.15);
  border: 1px solid rgba(255, 255, 255, 0.02);
  padding: 10px;
  border-radius: 6px;
}

.check-item-premium {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  cursor: pointer;
  color: var(--text-secondary);
}

.check-item-premium:hover {
  color: var(--text-primary);
}

.credentials-alert-box {
  background: rgba(16, 185, 129, 0.04);
  border: 1px solid rgba(16, 185, 129, 0.15);
  padding: 16px;
  border-radius: var(--border-radius-md);
}

.alert-title {
  color: #34d399;
  font-size: 13.5px;
  display: block;
}

.credentials-display {
  font-size: 12px;
  color: var(--text-secondary);
}

.pass-code {
  font-size: 13px !important;
  color: #34d399 !important;
  background: rgba(0, 0, 0, 0.3) !important;
  padding: 3px 8px !important;
  border-radius: 4px;
  font-weight: 700;
}

.user-card-premium {
  padding: 18px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.04);
  border-radius: var(--border-radius-lg);
  display: flex;
  flex-direction: column;
  transition: all 0.3s ease;
}

.user-card-premium:hover {
  background: rgba(255, 255, 255, 0.03);
  border-color: rgba(255, 255, 255, 0.08);
  transform: translateY(-2px);
}

.user-card-header {
  display: flex;
  align-items: center;
  gap: 14px;
}

.user-avatar-circle {
  width: 42px;
  height: 42px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--accent-primary) 0%, var(--accent-secondary) 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 14px;
  font-weight: 800;
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 4px 10px rgba(139, 92, 246, 0.15);
}

.user-headline-col {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.user-headline-col h4 {
  font-size: 14.5px;
  font-weight: 700;
  color: white;
  margin: 0;
}


.user-card-meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11.5px;
  color: var(--text-secondary);
  padding-left: 56px;
}

.user-card-action-bar {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding-left: 56px;
}

.btn-action-premium-icon {
  background: transparent;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11.5px;
  color: var(--text-secondary);
  transition: all 0.2s ease;
  padding: 4px 8px;
  border-radius: 4px;
}

.btn-action-premium-icon:hover {
  background: rgba(255, 255, 255, 0.04);
  color: white;
}

.btn-action-premium-icon.danger-icon:hover {
  background: rgba(239, 68, 68, 0.08);
  color: #f87171;
}

.btn-action-premium-icon:disabled {
  opacity: 0.4;
  cursor: not-allowed;
  background: transparent !important;
  color: var(--text-secondary) !important;
}

/* Redesigned grid results for fluid layout */
.users-list-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 16px;
}

.ingest-form .btn {
  white-space: nowrap;
  flex-shrink: 0;
}
</style>
```

- [ ] **Step 2: Delete the now-unused route-query guard duplication check**

No action needed — this step is a no-op verification only. Confirm the new `settings.vue` no longer references any of the removed local state (`stats`, `channels`, `queue`, `musicQueue`, `users`, `diagnosticLogs`, etc.) by searching the file:

```bash
grep -nE "\b(stats|channels|queue\.value|musicQueue\.value|usersData|diagnosticLogs)\b" app/pages/settings.vue
```

Expect this to print only the two lines that legitimately still reference composable state pulled into this file: `const { activeDownloadCount, fetchQueue, fetchDiagnostics, stopSmoothProgressLoop } = useDownloadsQueue();` and `const { musicQueue, musicActiveDownloadCount, fetchMusicQueue } = useMusicQueue();`, plus their downstream uses inside `runPolling`/`runMusicPolling`. If anything else matches, the rewrite in Step 1 was incomplete — go back and remove it.

- [ ] **Step 3: Build check**

```bash
cd /Users/light/Git/youkeep && npm run build
```
Confirm `✨ Build complete!` with no errors. This is the first build that actually wires all 5 child components and 3 composables together, so it's the most likely place for a missed import or a typo'd prop/state name to surface.

- [ ] **Step 4: Manual verification against the running dev server**

This codebase has zero Vue component test infrastructure (confirmed by reading `package.json` — `test`/`test:watch` run Vitest, but no `.spec`/`.test` files exist under `app/`), so this step is manual only. Start the dev server and exercise every tab's every action, confirming identical behavior to before the split:

```bash
cd /Users/light/Git/youkeep && npm run dev
```

Then, logged in as an admin, in the browser:

1. **Stats tab** (default tab): confirm the dashboard banner, metric cards, top-channels list, and diagnostics panel all render with real numbers (not stuck on 0/loading).
2. **Downloads tab**: search for a channel, open the ingest modal, cancel it, then track a channel for real; toggle global pause/resume; edit max concurrent downloads and save; edit the SponsorBlock settings and save; edit the default downloads folder and save; enable the sync schedule, pick a preset, save; if anything is queued, prioritize/cancel a queue item and confirm the progress bar animates smoothly (the RAF-smoothing behavior from `useDownloadsQueue`).
3. **Music tab**: toggle the "Module Musique" and "Clips vidéo" switches; add a music artist; toggle music pause/resume; edit music concurrency and save; enable the music sync schedule and save; sync and pause an existing artist; cancel a queued track.
4. **System tab**: click "Diagnostic Check" and confirm the yt-dlp/ffmpeg status renders; click "Refresh logs" and confirm the terminal populates and auto-scrolls to the bottom.
5. **Users tab**: create a user, confirm the generated-password panel and "Copy credentials" button work; edit a user's role and channel access (including toggling "Full visibility on all channels"); reset a password; delete a non-admin user.
6. **Sidebar badges while switching tabs** (specifically required by the Global Constraints above): start a video download and a music download (or wait for existing ones), then switch to the System tab and confirm the "Downloads" and "Music" sidebar buttons still show live, updating numeric badges — this proves `runPolling`/`runMusicPolling` in the parent are running independently of which tab is active, exactly as before the split.
7. **Cleanup on navigating away** (specifically required by the Global Constraints above): with a download active (so the RAF smoothing loop and both polling loops are running), navigate to a different page entirely (e.g. click to `/channels`). Open the browser console and Network tab first — after navigating away, confirm no new `/api/admin/downloader/queue`, `/api/admin/music/queue`, or `/api/admin/downloader/logs` requests keep firing, and no console errors appear. This confirms `onUnmounted`'s `clearTimeout` calls and `stopSmoothProgressLoop()` actually stopped everything.
8. **Suspense check** (specific risk flagged in Task 3): while performing steps 1 and 5 above, watch the browser console for any Vue warning mentioning `Suspense` or `async setup`. `SettingsStatsTab.vue` and `SettingsUsersTab.vue` both use top-level `await` in `<script setup>`, relying on Nuxt's page-level `<Suspense>` boundary (via `<NuxtPage>`) extending to nested non-page components — this is standard Vue `<Suspense>` behavior but has no prior precedent elsewhere in this codebase, so it is worth confirming directly rather than assuming.
9. **`?tab=music` pre-existing bug is unchanged** (per Global Constraints, do not fix this): navigate directly to `/settings?tab=music` and confirm it does *not* restore the Music tab (falls back to Stats) — same as before this refactor, since `allowedTabs` still omits `'music'`.

- [ ] **Step 5: Commit**

```bash
cd /Users/light/Git/youkeep && git add app/pages/settings.vue && git commit -m "$(cat <<'EOF'
refactor: reduce settings.vue to page shell after tab/composable split

Final step of the settings.vue split (4133 lines -> 5 tab components
+ 3 composables + a thin page shell). settings.vue now only owns:
page title, tab sidebar with live badge counts, activeTab state
synced to route.query.tab, admin/redirect gating, and the two
cross-tab polling loops (video queue + music queue) that must keep
running regardless of which tab is active. All CSS moves along
unscoped (see comment in the file) since Vue's scoped-CSS attribute
selectors don't cross component boundaries, and this was a pure
template+script split with zero intended visual changes.

No behavior changes: every button/form/polling cadence verified
manually against the pre-split page (no automated component test
infrastructure exists in this codebase).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-review

**Spec coverage checklist** (against the approved design spec's Design section and the 9-task decomposition):

- [x] 5 new tab components under `app/components/settings/`, one per original tab — Tasks 4–8.
- [x] 3 new composables (`useDownloadsQueue`, `useMusicQueue`, `useAdminChannels`) using the `useState` singleton pattern established by `useMusicPlayer.ts` — Tasks 1–3.
- [x] `useDownloadsQueue` wraps `queue`/`failedCount`/`isPaused`/`activeDownloadCount`/the RAF smoothing loop/`fetchQueue`, plus a cleanup function for the parent's `onUnmounted` — Task 1. (Extended, with reasoning given, to also carry `diagnosticLogs`/`diagnosticYtdlPath`/`fetchDiagnostics`, a real cross-tab dependency the original design spec's exploration missed.)
- [x] `useMusicQueue` mirrors it without RAF logic — Task 2.
- [x] `useAdminChannels` wraps the shared `channelsData`/`channels` fetch — Task 3. (Extended, with reasoning given, to also carry `stats`/`refreshStats`, a second missed cross-tab dependency.)
- [x] Parent retains page title, tab sidebar with badges, `activeTab`/`route.query.tab` sync, `isAdmin`/`currentUser` gating + `/account` redirect, both polling loops in `onMounted`/`onUnmounted` — Task 9.
- [x] Template becomes 5 `<SettingsXTab v-if=...>` blocks — Task 9.
- [x] Task 9 comes last and depends on the final shape of Tasks 1–8 — stated explicitly at the top of Task 9.
- [x] Global Constraints section present verbatim as given, including the explicit "leave the `allowedTabs` bug as-is" instruction, reflected in Task 9's manual verification Step 4.9.
- [x] Zero test infrastructure acknowledged; every task's verification is `npm run build` plus, for Task 9, an explicit manual QA pass covering every button/form and the two specifically-required behaviors (live badges across tabs, cleanup on navigating away).

**Placeholder scan:** every `- [ ] **Step N` in Tasks 1–9 contains either a complete, runnable code block (no `// ...`, no "similar to above", no `TODO`) or an exact shell command. The one self-inflicted violation caught during this review — Task 8 Step 1 originally printed a `<script setup>` block missing the `useToast` import/instantiation, then "corrected" it in a follow-up prose note instead of just being correct the first time — was found and fixed in place; Task 8's code block now includes `import { useToast } from '~/composables/useToast';` and `const toast = useToast();` directly, with no follow-up correction note left behind.

**Type-consistency scan across tasks:**
- `useDownloadsQueue()` return shape used consistently: Task 5 destructures `{ queue, failedCount, isPaused, smoothProgress, fetchQueue }`; Task 7 destructures `{ diagnosticLogs, diagnosticYtdlPath, fetchDiagnostics }`; Task 9 destructures `{ activeDownloadCount, fetchQueue, fetchDiagnostics, stopSmoothProgressLoop }`. All are subsets of the single object literal returned in Task 1 — no name drift.
- `useMusicQueue()` return shape used consistently: Task 6 destructures `{ musicQueue, musicArtists, musicIsPaused, musicFailedCount, fetchMusicQueue }`; Task 9 destructures `{ musicQueue, musicActiveDownloadCount, fetchMusicQueue }`. Both are subsets of Task 2's return object.
- `useAdminChannels()` return shape used consistently: Task 4 destructures `{ stats, channels }`; Task 5 destructures `{ refreshStats }`; Task 8 destructures `{ channels }`. All are subsets of Task 3's return object, and Task 3's async/await signature (`const { ... } = await useAdminChannels();`) is used identically at all three call sites.
- Every `$fetch`/`useFetch` URL, HTTP method, and request body shape in every moved handler was copied character-for-character from the original file (verified by diffing this plan's code blocks against the original line ranges cited in each task's "Files"/prose while writing them) — no endpoint was renamed, no body field was added or dropped.
- CSS class names referenced in Tasks 4–8's templates were all cross-checked against the single verbatim CSS block moved in Task 9 (e.g. `.tab-pane`, `.queue-card-premium`, `.form-msg`, `.role-card`, `.credentials-alert-box`, `.logs-terminal` all exist in the moved stylesheet) — since Task 9 moves the *entire* original stylesheet unmodified, there is no risk of a class being newly orphaned by this split (nothing was deleted from the CSS).

**Gaps found and fixed during self-review (beyond the Task 8 toast fix above):** none outstanding. Three real cross-tab dependencies were found by reading the full file that the original approved design spec's own exploration had missed (`refreshStats` called from Downloads-tab handlers; `fetchDiagnostics`/`diagnosticLogs` populated by the Downloads-tab polling loop but rendered only by System; the video-sync schedule form's script filed under a misleading section comment) — all three are called out explicitly in "Notes on deviations" at the top of this document and resolved consistently in the affected tasks (3, 1, 5 respectively) rather than left as silent surprises for whoever executes this plan.
