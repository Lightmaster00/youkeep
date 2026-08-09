# Channels Page Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the 2802-line `app/pages/channels.vue` (684-line template, ~806-line script, ~1308-line style block, mixing a channel-directory view and a much larger single-channel detail view with three sub-tabs) into 6 focused components plus 3 shared composables, with the parent page reduced to routing/view-switching, top-level tab state, and the polling loop. Confirmed dead code (a previously-removed "Download Queue" tab's leftover script AND CSS) is removed as part of this refactor, per explicit prior approval to optimize for the cleanest long-term result rather than a byte-for-byte-preserving move.

**Architecture:** `app/pages/channels.vue` becomes a thin shell: it switches between `<ChannelDirectoryView>` (channel grid) and the assembled detail view (`<ChannelDetailHeader>`, `<ChannelStatsPanel>`, an inline tab bar, `<ChannelVideoGrid variant="videos">`, `<ChannelVideoGrid variant="shorts">`, `<ChannelPlaylistsTab>`, `<ChannelSettingsDrawer>`) based on `route.query.channelId`. It owns `activeTab` (the 3-way sub-tab selector) and `showDrawer` (the settings-drawer open/closed flag) as page-level UI state, plus the polling loop that keeps the selected channel's videos/stats fresh. Three new `useState`/`useFetch`-backed composables under `app/composables/` hold data that's genuinely shared across the split-out components: `useChannelsList()` (the directory's channel list, needed by the directory view AND by detail-view handlers that must refresh it after a mutation), `useChannelDetail()` (the selected channel's own data — id, profile, stats, videos — read by nearly every detail-view component), and `useChannelVideoFilters()` (the search/sort state shared between the Videos and Shorts tabs, exactly matching today's behavior where both tabs read the same two refs).

**Tech Stack:** Nuxt 4, Vue 3 Composition API, TypeScript

## Global Constraints

- No changes to any file outside `app/pages/channels.vue` and its new split-off files.
- No new features — every remaining (non-dead) button/form/polling cadence must work identically after the split.
- Dead code (enumerated below) is REMOVED, not preserved — this is an explicit, approved deviation from a pure byte-for-byte refactor, per the user's explicit "cleanest long-term solution" instruction.
- No new state-management dependency — useState-based composable pattern only.
- Zero Vue component test infrastructure exists in this codebase (project-wide, accepted gap) — every task's verification step is manual only, via the dev-login fixture and the running dev server. Task 10's manual verification must explicitly include: switching directory<->detail view, all 3 sub-tabs, confirming search/sort stays synchronized between Videos and Shorts tabs, the settings drawer (open/edit/save/close/backdrop-click), and confirming via the network tab that the two dead polling requests no longer fire.

## Notes on findings from the full-file review (read during planning, applied throughout this plan)

Reading `app/pages/channels.vue` end-to-end — template (lines 1-684), script (lines 686-1492), and the entire 1308-line style block (lines 1494-2802) — surfaced several things beyond what the approved design spec already called out. These are documented here once so each task below can reference them without re-deriving them.

**1. The approved script-level dead-code list is confirmed complete, and one additional corollary deletion is required.** Every name in the approved dead-code list (`queuedVideos`, `smoothProgress`/`progressRates` + their RAF loop, `selectedVideoIds`/`toggleSelection`/`isAllFilteredSelected`/`toggleSelectAllFiltered`, `handleBatchAction`, `handlePrioritizeTask`, `cancelTask`, `handleDownloadAll`, `isSyncingAll`, `checkSyncAllStatus`, `handleSyncAll`, `isDownloaderPaused`, `checkDownloaderPausedStatus`, `handleToggleDownloaderPause`, `parseETAToSeconds`, `formatDuration`, `formatViews`, `handleThumbnailError`, `playVideo`) was individually grepped against the template (lines 1-684) and confirmed to have zero references there; all of them only reference each other, never the template. One corollary was found during this check: `clearSelection()` (not itself on the approved list) exists solely to reset `selectedVideoIds`, which IS on the approved list. `clearSelection` is called once, from the (non-dead) `watch(channelId, ...)` reset block. Deleting `selectedVideoIds` without also deleting `clearSelection` (and its call site) would leave a reference to an undefined ref and break the build — so `clearSelection` is deleted too, as a direct, mechanical consequence of the approved deletion, not a scope expansion.

**2. The style block requires the same structural fix as `settings.vue`'s split, applied from the start.** `<style scoped>` cannot reach markup that moves into child components. Task 10 moves the entire style block to the parent, unscoped, with every top-level and `@media`-nested selector mechanically prefixed with the page's own root class, `.channels-page` — the exact method used for `settings.vue`'s `.settings-container` fix (verified by reading that file's actual shipped `<style>` block, not just its plan document): track brace depth, skip `@keyframes` bodies verbatim, prefix every selector (including each branch of a comma-separated list), and never double-prefix the root selector itself (`.channels-page { ... }` stays bare, matching `.settings-container { ... }` in the shipped `settings.vue`).

**3. A collision the `settings.vue` split never had to deal with: this page renders `<VideoCard>`, and `<VideoCard>` renders `<VideoDropdownMenu>`.** `settings.vue` never touches `VideoCard.vue` or its class names (confirmed by grep) — the collision-avoidance in that split only had to worry about other *pages*' stylesheets. `channels.vue` is different: it renders `<VideoCard>` throughout its Archived/Shorts/Playlist-detail grids, and `<VideoDropdownMenu>` is rendered *inside* every `<VideoCard>` (for the "add to playlist" popup). Once `channels.vue`'s own style block becomes unscoped, any selector it defines that happens to share a class name with `VideoCard.vue` or `VideoDropdownMenu.vue` will start matching those components' own internal markup wherever they render on this page — something scoped CSS never allowed. Two concrete, verified collisions:
   - `channels.vue`'s own style block defines bare `.video-card`, `.thumbnail-wrapper`, `.thumbnail-img`, `.thumbnail-wrapper::after`, `.video-info`, `.video-title`, and `.premium-card:hover .thumbnail-img` — used today only by the raw (non-`<VideoCard>`) playlist-grid-item markup (template lines 443-471, `class="video-card premium-card"`). `VideoCard.vue`'s own `<style scoped>` (lines 231-357) defines **the same five class names** with different values (different `border-radius`, `background`, `padding`, `font-size`, etc.) for its own root/thumbnail/info elements. Fix: qualify these 7 rules with the compound selector `.video-card.premium-card` (not just `.video-card`) — `.premium-card` is present, in the literal template markup, only on the raw playlist-grid-item's root div, never on a `<VideoCard>` instance's root (which only ever has bare `.video-card`). This exactly and only targets the playlist-grid item, using a class combination already present in the markup — no template changes required.
   - `channels.vue`'s style block also defines `.spinner-sm` (used at template line 661, the settings-drawer's save-button spinner: `class="spinner-sm mr-2"`, 14×14px). `VideoDropdownMenu.vue`'s own `<style scoped>` (line 418) also defines `.spinner-sm` (its own "loading playlists" spinner, 24×24px) — and `VideoDropdownMenu` renders inside every `<VideoCard>` on this page. Fix: qualify as `.drawer-body .spinner-sm` — `.spinner-sm` is used, in `channels.vue`'s own template, only inside `.drawer-body` (the settings drawer), and `VideoDropdownMenu`'s own spinner never renders there.
   - One more, narrower case in the same family: `.shorts-grid .thumbnail-wrapper { aspect-ratio: 9/16 !important; }` (originally intended to force a portrait thumbnail for Shorts) requires a raw `.thumbnail-wrapper` element to be a descendant of `.shorts-grid` — but `.shorts-grid` only ever wraps `<VideoCard>` instances (never a raw `.thumbnail-wrapper` div), and Vue's scoped-CSS root-inheritance rule (a parent's scoped styles only ever reach as far as a child component's *root* element, never its deeper descendants) means this selector cannot have matched anything even before the split — it is provably inert both today and after a naive prefix-only move. Qualifying it (rather than deleting it) would introduce new, never-before-seen behavior (Shorts thumbnails suddenly rendering in 9:16), which violates the "must work identically" constraint. It is deleted rather than qualified — see the CSS dead-code list below.

**4. A large amount of orphaned CSS was found, verified via a systematic per-selector cross-reference against the template, and is deleted alongside the approved script-level dead code.** The style block's ~1308 lines were parsed into every top-level and `@media`-nested rule (170 rule blocks in total), and each one's selector class names were checked against the template for a literal usage. 66 whole blocks and 4 additional selector-branches inside otherwise-mixed comma-separated blocks (72 selector branches total, plus one dead `@keyframes progress-shimmer` — see below) have **zero** template references. Nearly all of them are the styling counterpart of the same already-approved-dead "Download Queue tab" / batch-selection / old admin-preferences-panel feature (`.queue-card`, `.queue-list`, `.select-checkbox*`, `.batch-actions-bar`, `.prioritize-task-btn`, `.cancel-task-btn`, `.admin-preferences-panel`, `.sync-btn`, `.date-input*`, etc. — full list in Task 10). Two more were confirmed dead by cross-referencing the server-side data model rather than the template alone: `.visibility-pill.unlisted` (channel `visibility` is validated server-side, in three separate places, to only ever be `'public' | 'private' | 'ultra_private'` — `'unlisted'` is not a reachable value) and `.channel-card-sync-badge.paused` was checked the same way and found to be **genuinely live** (`sync_status` really does take the value `'paused'`, confirmed via `server/utils/db.ts`'s column default) — a reminder that a purely-template-string-based check needs this kind of cross-check before deleting a modifier-class rule.
   Critically, a subset of this orphaned CSS is *not just inert but actively dangerous to leave in place*: `.modal-overlay`, `.modal-card`, `.modal-header`, `.modal-body`, `.loading-state` (plus the modal's exclusively-owned children: `.modal-desc`, `.modal-empty-state`, `.modal-categories-list`, `.modal-check-item`, `.check-item-text`/`-name`/`-desc`, `.modal-footer`, `.close-modal-btn`) are all zero-referenced in `channels.vue`'s own template — but `VideoDropdownMenu.vue` (rendered inside every `<VideoCard>` on this page, per point 3 above) defines its **own** `.modal-overlay`/`.modal-card`/`.modal-header`/`.modal-body`/`.loading-state` for its "add to playlist" popup. Today, scoped CSS makes this dead-and-harmless (the data-v attribute never matches). Verbatim-moving it into unscoped, `.channels-page`-prefixed CSS would make it dead-but-*not*-harmless: `VideoDropdownMenu`'s popup renders inside `.channels-page` whenever it's opened from this page, so `.channels-page .modal-overlay { ... }` would newly apply to it, corrupting its appearance specifically when opened from the channels page. Since deleting confirmed-dead code is already the explicitly approved approach in this plan, and here it's *required* (not just tidy) to avoid a regression, this cluster is deleted rather than qualified.
   `@keyframes progress-shimmer` (line 2607 originally) is only ever referenced by `animation: progress-shimmer ...` inside `.queue-progress-bar-fill`/`.queue-card .progress-bar` — both confirmed dead and deleted. The keyframe itself is therefore also dead. It happens to be byte-identical to a `@keyframes progress-shimmer` already shipped, still in active use, in `app/pages/settings.vue` (confirmed by reading both) — so deleting `channels.vue`'s copy has no effect on anything (the identical, still-needed definition survives in `settings.vue`'s own now-global stylesheet). It is deleted.
   A small number of now-orphaned section-header comments (e.g. `/* Admin Preferences Panel */`, `/* Queue List styling */`, `/* Modal styling */` — comments that introduced a section whose entire rule cluster was just deleted) are also removed, since leaving them would misleadingly label unrelated surviving rules.

**5. This page's cross-component data-sharing relies on Nuxt's built-in `useFetch` request deduplication — matching an existing, already-shipped precedent in this exact codebase, not a new assumption.** `useChannelDetail()` (Task 2) is called independently, with its own `await useFetch(...)` calls, from up to 6 different places at once (the parent page, `ChannelDetailHeader`, `ChannelStatsPanel`, both `ChannelVideoGrid` instances, `ChannelPlaylistsTab`, `ChannelSettingsDrawer`). None of these calls wrap their state in `useState`. This exactly mirrors `useAdminChannels()` from the `settings.vue` split (also plain `useFetch`, no `useState`), which is independently called three separate times (`SettingsDownloadsTab.vue`, `SettingsStatsTab.vue`, `SettingsUsersTab.vue`) and is already shipped and working. Nuxt's `useFetch`/`useAsyncData` automatically dedupes multiple calls that resolve to the same request key (here, the same literal or computed URL), so all these independent calls end up sharing one underlying reactive payload per URL rather than firing N redundant requests. This is called out explicitly so the pattern isn't "corrected" into an unnecessary `useState` wrapper during implementation.

**6. Component auto-import naming: this split cannot rely on Nuxt's directory-prefix deduplication the way the `settings.vue` split did, so this plan uses explicit imports instead.** The `settings.vue` split's Task 9 relied on Nuxt's default component-scanning: a component whose filename already starts with its containing directory's name (`app/components/settings/SettingsStatsTab.vue`, dir `settings` → prefix `Settings`, filename starts with `Settings`) auto-registers without a doubled prefix (`<SettingsStatsTab>`, not `<SettingsSettingsStatsTab>`), which was directly evidenced by `UiBadge.vue` already working that way in this codebase. This plan's directory is `app/components/channels/` (**plural**), but every new component's filename starts with `Channel` (**singular** — `ChannelDetailHeader.vue`, not `ChannelsDetailHeader.vue`), per the approved file paths. `"Channel"` is not a prefix-match of `"Channels"`, which is exactly the condition under which Nuxt's dedup does *not* collapse the directory prefix — meaning the actual auto-registered tag name would very likely be `<ChannelsChannelDetailHeader>`, not `<ChannelDetailHeader>`. Rather than gamble on the exact auto-import algorithm for a mismatched case with no existing evidence in this codebase either way, Task 10's parent page uses explicit `import ChannelDetailHeader from '~/components/channels/ChannelDetailHeader.vue';` statements for all 6 new components (Vue's `<script setup>` auto-registers explicitly imported components for template use, so this is a drop-in, zero-risk substitute for auto-import). The 6 new components themselves continue to use auto-import for pre-existing, top-level (non-subdirectory) components (`<VideoCard>`, `<EmptyState>`, `<UiCard>`, `<UiSkeleton>`) exactly as `channels.vue` already did — those are unaffected by this directory-prefix issue since they aren't under a mismatched subdirectory.

---

## Task 1: `app/composables/useChannelsList.ts`

**Files:**
- Create: `app/composables/useChannelsList.ts`

**Interfaces:**
- Consumes: nothing (wraps `useFetch('/api/channels')` directly, same request the original page made).
- Produces (consumed by Task 4 `ChannelDirectoryView.vue`, Task 5 `ChannelDetailHeader.vue`, Task 7 `ChannelVideoGrid.vue`, Task 9 `ChannelSettingsDrawer.vue`):
  - `channelsData: Ref<{ channels: any[] } | null>`
  - `channels: ComputedRef<any[]>`
  - `pending: Ref<boolean>`
  - `refreshChannels: () => Promise<void>`

- [ ] **Step 1: Create the composable file**

Create `app/composables/useChannelsList.ts` with this exact content:

```ts
export async function useChannelsList() {
  const { data: channelsData, pending, refresh: refreshChannels } = await useFetch<{ channels: any[] }>('/api/channels');
  const channels = computed(() => channelsData.value?.channels || []);

  return {
    channelsData, channels, pending, refreshChannels,
  };
}
```

Note: `useFetch` and `computed` are Nuxt/Vue auto-imports — no explicit `import` statements are needed, matching `app/composables/useAdminChannels.ts`'s existing zero-imports convention. This composable is called independently from multiple components (see "Notes on findings" point 5 above); its single `useFetch('/api/channels')` call is deduped by Nuxt across all call sites since the request key is always the same literal string.

- [ ] **Step 2: Build check**

This repo has no `typecheck` npm script and `npx nuxi typecheck` fails in this environment on a pre-existing, unrelated `vue-tsc`/`typescript` version mismatch (confirmed identically in the `settings.vue` split's plan). Use `npm run build` as the verification command for every step in this plan; it exercises the full Nuxt/Vite compilation pipeline and fails loudly on a syntax or import error.

Run:
```bash
cd /Users/light/Git/youkeep && npm run build
```
Confirm it ends with `✨ Build complete!` and no errors mentioning `useChannelsList`.

- [ ] **Step 3: Commit**

```bash
cd /Users/light/Git/youkeep && git add app/composables/useChannelsList.ts && git commit -m "$(cat <<'EOF'
feat: extract useChannelsList composable from channels.vue

First step of the channels.vue split (6 components + 3 shared
composables). Wraps the channel-directory list fetch so both the
directory view and detail-view mutation handlers (pause/resume/
delete) can read and refresh the same list.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `app/composables/useChannelDetail.ts`

**Files:**
- Create: `app/composables/useChannelDetail.ts`

**Interfaces:**
- Consumes: nothing (wraps two `useFetch` calls directly, same requests the original page made).
- Produces (consumed by the parent `channels.vue` and Tasks 5-9):
  - `channelId: Ref<string>`
  - `channel: ComputedRef<any | null>`
  - `singleChannelData: Ref<any>`
  - `refreshSingleChannel: () => Promise<void>`
  - `videosData: Ref<any>`
  - `videosPending: Ref<boolean>`
  - `refreshVideos: () => Promise<void>`
  - `channelVideos: ComputedRef<any[]>`

- [ ] **Step 1: Create the composable file**

Create `app/composables/useChannelDetail.ts` with this exact content:

```ts
export async function useChannelDetail() {
  const route = useRoute();
  const channelId = ref(route.query.channelId ? String(route.query.channelId) : '');

  watch(() => route.query.channelId, (newId) => {
    // Only update if we are still on the channels page to prevent transition flash
    if (route.path === '/channels') {
      channelId.value = newId ? String(newId) : '';
    }
  });

  const { data: singleChannelData, refresh: refreshSingleChannel } = await useFetch<any>(computed(() => {
    return channelId.value ? `/api/channels/${channelId.value}` : '/api/channels';
  }));
  const channel = computed(() => {
    if (!channelId.value) return null;
    return singleChannelData.value?.channel || null;
  });

  // The second useFetch call needs runWithContext: Vue's <script setup> compiler only
  // auto-restores the component instance context around await expressions written
  // directly in the calling component's own script setup — it cannot see into this
  // nested async function. Without runWithContext, this call would run after the
  // first await above with no Nuxt instance in scope and throw "composable called
  // outside of a plugin, Nuxt hook, ... or Vue setup function" (same reasoning as
  // app/composables/useAdminChannels.ts's second useFetch call).
  const nuxtApp = useNuxtApp();
  const { data: videosData, pending: videosPending, refresh: refreshVideos } = await nuxtApp.runWithContext(() =>
    useFetch<any>(computed(() => {
      return channelId.value ? `/api/videos?channelId=${channelId.value}&status=all&limit=200` : '/api/videos?limit=1';
    }))
  );
  const channelVideos = computed(() => {
    if (!channelId.value) return [];
    return videosData.value?.videos || [];
  });

  return {
    channelId, channel, singleChannelData, refreshSingleChannel,
    videosData, videosPending, refreshVideos, channelVideos,
  };
}
```

This composable is called independently from up to 6 places at once (see "Notes on findings" point 5). Each call creates its own local `channelId` ref, but all of them stay synchronized to the same `route.query.channelId` value via the identical `watch(...)` guard, so the `useFetch` calls they each make always resolve to the same request key and are deduped by Nuxt into one shared underlying fetch per URL.

- [ ] **Step 2: Build check**

```bash
cd /Users/light/Git/youkeep && npm run build
```
Confirm it ends with `✨ Build complete!` and no errors mentioning `useChannelDetail`.

- [ ] **Step 3: Commit**

```bash
cd /Users/light/Git/youkeep && git add app/composables/useChannelDetail.ts && git commit -m "$(cat <<'EOF'
feat: extract useChannelDetail composable from channels.vue

Second step of the channels.vue split. Wraps the selected channel's
id (synced from route.query.channelId, including the existing guard
against a navigation-transition flash), profile/stats, and video
list — read broadly across the detail view (header, stats panel,
both video grids, playlists tab, settings drawer).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `app/composables/useChannelVideoFilters.ts`

**Files:**
- Create: `app/composables/useChannelVideoFilters.ts`

**Interfaces:**
- Consumes: nothing (wraps `useState` and its own `route.query.channelId` watcher).
- Produces (consumed by Task 7 `ChannelVideoGrid.vue`, both `variant` instances):
  - `videoSearchQuery: Ref<string>`
  - `sortBy: Ref<string>`

- [ ] **Step 1: Create the composable file**

Create `app/composables/useChannelVideoFilters.ts` with this exact content:

```ts
export function useChannelVideoFilters() {
  const route = useRoute();
  const videoSearchQuery = useState<string>('channel_video_search_query', () => '');
  const sortBy = useState<string>('channel_video_sort_by', () => 'date_desc');

  watch(() => route.query.channelId, () => {
    // Only reset while still on the channels page, matching useChannelDetail's guard
    // against a navigation-transition flash.
    if (route.path === '/channels') {
      videoSearchQuery.value = '';
      sortBy.value = 'date_desc';
    }
  });

  return { videoSearchQuery, sortBy };
}
```

Unlike `useChannelsList`/`useChannelDetail`, this composable is not `async` (no top-level `await`) — it follows the same synchronous, `useState`-backed pattern as `app/composables/useDownloadsQueue.ts`/`useMusicQueue.ts` from the `settings.vue` split, since `videoSearchQuery`/`sortBy` need to be the *same* reactive refs across both `ChannelVideoGrid` instances (typing in one tab's search box must filter the other tab's results too, exactly matching today's behavior where both tabs read the same two refs). `useState`'s app-wide key-based sharing is what makes that work across two independent component instances. This composable is called from both `ChannelVideoGrid` instances; both register the same `watch(...)`, which is a harmless, idempotent double-registration (both writes always update the shared refs to the same values).

- [ ] **Step 2: Build check**

```bash
cd /Users/light/Git/youkeep && npm run build
```
Confirm it ends with `✨ Build complete!` and no errors mentioning `useChannelVideoFilters`.

- [ ] **Step 3: Commit**

```bash
cd /Users/light/Git/youkeep && git add app/composables/useChannelVideoFilters.ts && git commit -m "$(cat <<'EOF'
feat: extract useChannelVideoFilters composable from channels.vue

Third step of the channels.vue split. Wraps videoSearchQuery/sortBy
as shared useState so the Archived Videos and Shorts tabs keep
searching/sorting in sync, exactly matching today's behavior where
both tabs read the same two refs.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `app/components/channels/ChannelDirectoryView.vue`

**Files:**
- Create: `app/components/channels/ChannelDirectoryView.vue`

**Interfaces:**
- Consumes: `useChannelsList()` (Task 1) for `channels`/`pending`; `useAuth()` for `isAdmin` (existing composable, unchanged).
- Produces: nothing (leaf component; owns its own `selectChannel` navigation handler and `handleAvatarError` fallback).

**On the root wrapper class:** the original template wraps this whole view in `<div v-else class="channel-directory-view">` (line 521). `.channel-directory-view` is not only a `channels.vue`-local class — `app/assets/css/main.css` (line 541) lists it alongside `.channels-page`/`.watch-container`/etc. in a shared "Page Containers" rule (`flex: 1; display: flex; ...`). This component's own root element must keep that class so the directory view still gets that shared layout treatment.

- [ ] **Step 1: Create the component file**

Create `app/components/channels/ChannelDirectoryView.vue` with this exact content:

```vue
<template>
  <div class="channel-directory-view">
    <div v-if="channels && channels.length > 0" class="directory-header-row">
      <h1 class="page-title">Archived Channels</h1>
    </div>

    <div v-if="pending" class="channel-grid">
      <UiCard v-for="n in 6" :key="n" flat>
        <UiSkeleton height="120px" rounded="lg" />
        <div style="padding: var(--space-3, 12px);">
          <UiSkeleton height="14px" width="70%" />
          <div style="margin-top: var(--space-2, 8px);">
            <UiSkeleton height="12px" width="40%" />
          </div>
        </div>
      </UiCard>
    </div>

    <EmptyState
      v-else-if="!channels || channels.length === 0"
      title="No channels archived"
      description="Start adding YouTube channels in the downloader settings to see them here."
      icon="channels"
      :action-text="isAdmin ? 'Add a channel' : undefined"
      action-route="/settings?tab=downloads"
    />

    <div v-else class="channel-grid">
      <div
        v-for="ch in channels"
        :key="ch.id"
        class="channel-card glass-panel"
        @click="selectChannel(ch.id)"
      >
        <!-- Banner Section -->
        <div
          class="channel-card-banner"
          :style="ch.banner_url ? { backgroundImage: `url(${ch.banner_url}), linear-gradient(135deg, var(--accent-primary) 0%, var(--accent-secondary) 100%)` } : {}"
        >
          <div class="channel-card-banner-overlay"></div>
          <span v-if="isAdmin" class="channel-card-sync-badge" :class="ch.sync_status">
            {{ ch.sync_status === 'downloading' ? 'Active' : 'Pause' }}
          </span>
        </div>

        <!-- Content Section -->
        <div class="channel-card-body">
          <div class="channel-card-avatar-wrapper">
            <img
              :src="ch.avatar_url || 'data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 24 24\' fill=\'%23666\'><circle cx=\'12\' cy=\'12\' r=\'10\'></circle><path d=\'M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-3.33 0-10 1.67-10 5v2h20v-2c0-3.33-6.67-5-10-5z\'></path></svg>'"
              @error="handleAvatarError"
              class="channel-card-avatar"
              alt="Avatar"
            />
          </div>
          <div class="channel-card-info">
            <h3 class="channel-card-title" :title="ch.title">{{ ch.title }}</h3>
            <p class="channel-card-desc">{{ ch.description || 'No description available.' }}</p>

            <!-- Quick Stats row at the bottom of the card -->
            <div class="channel-card-stats">
              <span class="stat-badge">
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.33z"></path><polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02"></polygon></svg>
                {{ ch.completed_count || 0 }} / {{ ch.total_count || 0 }} videos
              </span>
              <span class="visibility-pill" :class="ch.visibility">
                {{ ch.visibility === 'public' ? 'Public' : 'Private' }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useAuth } from '~/composables/useAuth';
import { useChannelsList } from '~/composables/useChannelsList';

const { isAdmin } = useAuth();
const router = useRouter();

const { channels, pending } = await useChannelsList();

const selectChannel = (id: string) => {
  router.push({ path: '/channels', query: { channelId: id } });
};

const handleAvatarError = (event: Event) => {
  const target = event.target as HTMLImageElement;
  const fallback = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%23666"><circle cx="12" cy="12" r="10"></circle><path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-3.33 0-10 1.67-10 5v2h20v-2c0-3.33-6.67-5-10-5z"></path></svg>';
  if (target && target.src !== fallback) {
    target.src = fallback;
  }
};
</script>
```

- [ ] **Step 2: Build check**

```bash
cd /Users/light/Git/youkeep && npm run build
```
Confirm it ends with `✨ Build complete!` and no errors mentioning `ChannelDirectoryView`.

- [ ] **Step 3: Commit**

```bash
cd /Users/light/Git/youkeep && git add app/components/channels/ChannelDirectoryView.vue && git commit -m "$(cat <<'EOF'
feat: extract ChannelDirectoryView component from channels.vue

Fourth step of the channels.vue split. Moves the channel-grid
directory view (loading skeletons, empty state, channel cards) into
its own component, consuming the new useChannelsList composable.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `app/components/channels/ChannelDetailHeader.vue`

**Files:**
- Create: `app/components/channels/ChannelDetailHeader.vue`

**Interfaces:**
- Consumes: `useChannelDetail()` (Task 2) for `channelId`/`channel`/`singleChannelData`/`refreshSingleChannel`; `useChannelsList()` (Task 1) for `refreshChannels`; `useAuth()` for `isAdmin`; `useToast()` (existing).
- Produces: emits `open-drawer` (no payload) when the "Tracking options" button is clicked. The parent (Task 10) listens for this and sets its own `showDrawer` ref to `true`. This is a one-way, fire-and-forget emit rather than a `v-model` because this component only ever needs to *trigger* opening the drawer — it never needs to read the drawer's current open/closed state (unlike `ChannelSettingsDrawer` in Task 9, which both closes itself and reacts to the backdrop, and therefore needs a full two-way binding).

**On scope: why the "Non-synchronized Channel Warning Banner" and its `triggeringSync` state live here, not in `ChannelStatsPanel`.** The approved design spec assigns `ChannelStatsPanel.vue` "the stats row plus the archive-targets-summary panel ... no owned state" — but the warning banner (template lines 73-84) needs `triggeringSync`, which is real local state, so it doesn't fit that description. It's placed in this component instead because it's conceptually and functionally part of this component's existing sync-status ownership (`togglingSyncStatus`/`handleToggleSyncStatus` for the manual Pause/Resume button already live here) — the warning banner's own manual-sync trigger (`handleTriggerManualSync`) is the same category of action, just auto-fired instead of button-triggered. The original single `watch(channel, ...)` handler (lines 1139-1158) did three unrelated things in one callback: populate the settings-drawer's preferences form, fetch the subscription-button state, and conditionally auto-trigger a sync. Since those three concerns now belong to three different components (`ChannelSettingsDrawer`, this component, and this component again), the single watcher is split into two independent `watch(channel, ...)` callbacks — one here (subscription fetch + auto-sync-trigger) and one in `ChannelSettingsDrawer` (Task 9, preferences-form population). Vue supports multiple independent watchers on the same source with no ordering dependency between them, so this split is behavior-preserving.

- [ ] **Step 1: Create the component file**

Create `app/components/channels/ChannelDetailHeader.vue` with this exact content:

```vue
<template>
  <div>
    <!-- Channel Banner -->
    <div
      class="channel-banner-container glass-panel"
      :style="channel.banner_url ? { backgroundImage: `url(${channel.banner_url}), linear-gradient(135deg, var(--accent-primary) 0%, var(--accent-secondary) 100%)`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}"
    >
      <div class="banner-overlay"></div>
    </div>

    <!-- Channel Profile Header -->
    <div class="channel-profile-header">
      <img
        :src="channel.avatar_url || 'data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 24 24\' fill=\'%23666\'><circle cx=\'12\' cy=\'12\' r=\'10\'></circle><path d=\'M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-3.33 0-10 1.67-10 5v2h20v-2c0-3.33-6.67-5-10-5z\'></path></svg>'"
        @error="handleAvatarError"
        class="channel-profile-avatar"
        alt="Avatar"
      />
      <div class="channel-profile-info">
        <div class="title-row" style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
          <h1 class="channel-profile-title">{{ channel.title }}</h1>
          <span v-if="isAdmin" class="badge" :class="channel.sync_status === 'downloading' ? 'badge-completed' : 'badge-pending'">
            {{ channel.sync_status === 'downloading' ? 'Sync Active' : 'Sync Paused' }}
          </span>
          <span class="badge" :class="getVisBadgeClass(channel.visibility)">
            {{ formatVisibility(channel.visibility) }}
          </span>
        </div>
        <p class="channel-profile-meta">
          YouTube Channel • ID : {{ channel.id }} • {{ channelVideos.filter((v: any) => v.download_status === 'completed').length }} / {{ channelVideos.length }} videos archived
        </p>
        <p class="channel-profile-desc">{{ channel.description || 'No description available.' }}</p>

        <div class="channel-actions-row">
          <button
            @click="handleToggleSubscription"
            class="btn subscribe-btn"
            :class="subscribed ? 'btn-secondary' : 'btn-primary'"
          >
            <svg v-if="subscribed" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>
            <svg v-else xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            <span>{{ subscribed ? 'Subscribed' : "Subscribe" }}</span>
          </button>
          <button
            v-if="isAdmin"
            @click="$emit('open-drawer')"
            class="btn btn-secondary settings-trigger-btn"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-2"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l-.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06-.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.5 1z"></path></svg>
            <span>Tracking options</span>
          </button>
          <button
            v-if="isAdmin"
            @click="handleToggleSyncStatus"
            class="btn btn-secondary"
            :disabled="togglingSyncStatus"
          >
            <span>{{ channel.sync_status === 'downloading' ? 'Pause Sync' : 'Resume Sync' }}</span>
          </button>

        </div>
      </div>
    </div>

    <!-- Non-synchronized Channel Warning Banner -->
    <div v-if="singleChannelData?.stats && singleChannelData.stats.totalCount === 0" class="sync-warning-banner glass-panel">
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: #60a5fa; flex-shrink: 0; margin-top: 1px;" :class="{ 'spin-anim': triggeringSync }"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
      <div class="warning-text">
        <h4 style="font-size: 14px; font-weight: 700; color: white; margin: 0;">
          {{ triggeringSync ? 'Initial video search...' : 'Empty or unsynced channel' }}
        </h4>
        <p style="font-size: 13.5px; color: var(--text-secondary); margin: 4px 0 0 0; line-height: 1.45;">
          {{ triggeringSync ? 'YouKeep is querying YouTube to retrieve the list of videos for this channel. Please wait.' : 'No videos have been discovered for this channel yet. YouKeep will automatically launch a search in the background to synchronize the list.' }}
        </p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { useAuth } from '~/composables/useAuth';
import { useToast } from '~/composables/useToast';
import { useChannelDetail } from '~/composables/useChannelDetail';
import { useChannelsList } from '~/composables/useChannelsList';

defineEmits<{ 'open-drawer': [] }>();

const { isAdmin } = useAuth();
const toast = useToast();

const { channelId, channel, singleChannelData, channelVideos, refreshSingleChannel } = await useChannelDetail();
const { refreshChannels } = await useChannelsList();

const subscribed = ref(false);
const togglingSyncStatus = ref(false);
const triggeringSync = ref(false);

const fetchSubscriptionStatus = async () => {
  if (!channelId.value) return;
  try {
    const res = await $fetch<any>(`/api/channels/${channelId.value}/subscription`);
    subscribed.value = res.subscribed;
  } catch (err) {
    console.error('Failed to fetch subscription status:', err);
  }
};

const handleToggleSubscription = async () => {
  if (!channelId.value) return;
  const endpoint = subscribed.value ? 'unsubscribe' : 'subscribe';
  try {
    await $fetch(`/api/channels/${channelId.value}/${endpoint}`, { method: 'POST' });
    subscribed.value = !subscribed.value;
    toast.success(subscribed.value ? 'Subscription saved.' : 'Subscription removed.');
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Action failed.');
  }
};

const handleToggleSyncStatus = async () => {
  if (!channelId.value || !channel.value) return;
  togglingSyncStatus.value = true;
  const isPaused = channel.value.sync_status !== 'downloading';
  const endpoint = isPaused ? 'sync' : 'pause';
  try {
    await $fetch(`/api/admin/channels/${channelId.value}/${endpoint}`, { method: 'POST' });
    toast.success(isPaused ? 'Sync resumed.' : 'Sync paused.');
    await refreshSingleChannel();
    refreshChannels();
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Action failed.');
  } finally {
    togglingSyncStatus.value = false;
  }
};

async function handleTriggerManualSync() {
  if (!channelId.value) return;
  triggeringSync.value = true;
  try {
    const channelUrl = `https://www.youtube.com/channel/${channelId.value}`;
    const res = await $fetch<any>('/api/admin/downloader/ingest', {
      method: 'POST',
      body: { url: channelUrl }
    });
    toast.success(res.message || 'Channel update completed.');
    refreshSingleChannel();
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Failed to search videos.');
  } finally {
    triggeringSync.value = false;
  }
};

watch(channel, (newVal) => {
  if (newVal) {
    fetchSubscriptionStatus();

    // Auto-check YouTube in background if the channel has never been scanned (totalCount === 0)
    if (singleChannelData.value?.stats?.totalCount === 0 && !triggeringSync.value) {
      handleTriggerManualSync();
    }
  }
}, { immediate: true });

const formatVisibility = (vis: string): string => {
  switch (vis) {
    case 'public': return 'Public';
    case 'private': return 'Private';
    case 'ultra_private': return 'Ultra Private';
    default: return vis || 'Public';
  }
};

const getVisBadgeClass = (vis: string): string => {
  switch (vis) {
    case 'public': return 'badge-completed';
    case 'private': return 'badge-downloading';
    case 'ultra_private': return 'badge-failed';
    default: return 'badge-completed';
  }
};

const handleAvatarError = (event: Event) => {
  const target = event.target as HTMLImageElement;
  const fallback = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%23666"><circle cx="12" cy="12" r="10"></circle><path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-3.33 0-10 1.67-10 5v2h20v-2c0-3.33-6.67-5-10-5z"></path></svg>';
  if (target && target.src !== fallback) {
    target.src = fallback;
  }
};
</script>
```

Note: `channel` is `any | null` from `useChannelDetail()`, but this component is only ever mounted by the parent inside `v-if="channelId && channel"` (Task 10), so `channel.title`/`channel.banner_url`/etc. are always safe to access directly here without an optional-chain guard — exactly matching how the original page accessed them directly inside its own `v-if="channelId && channel"` block.

- [ ] **Step 2: Build check**

```bash
cd /Users/light/Git/youkeep && npm run build
```
Confirm it ends with `✨ Build complete!` and no errors mentioning `ChannelDetailHeader`.

- [ ] **Step 3: Commit**

```bash
cd /Users/light/Git/youkeep && git add app/components/channels/ChannelDetailHeader.vue && git commit -m "$(cat <<'EOF'
feat: extract ChannelDetailHeader component from channels.vue

Fifth step of the channels.vue split. Moves the banner, avatar,
title, badges, description, subscribe/tracking-options/sync-toggle
buttons, and the non-synchronized-channel warning banner into their
own component. Emits open-drawer for the parent to react to; never
needs to read the drawer's own open/closed state.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `app/components/channels/ChannelStatsPanel.vue`

**Files:**
- Create: `app/components/channels/ChannelStatsPanel.vue`

**Interfaces:**
- Consumes: `useChannelDetail()` (Task 2) for `channel`/`singleChannelData`. No owned state.
- Produces: nothing (leaf component).

- [ ] **Step 1: Create the component file**

Create `app/components/channels/ChannelStatsPanel.vue` with this exact content:

```vue
<template>
  <div>
    <!-- Stats Dashboard Row -->
    <div v-if="singleChannelData?.stats" class="channel-stats-row">
      <div class="stat-card">
        <div class="stat-icon">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-gradient"><path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.33z"></path><polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02"></polygon></svg>
        </div>
        <div class="stat-info">
          <span class="stat-value">{{ singleChannelData.stats.completedCount }} / {{ singleChannelData.stats.totalCount }}</span>
          <span class="stat-label">Archived Videos</span>
        </div>
      </div>

      <div class="stat-card">
        <div class="stat-icon">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-gradient"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
        </div>
        <div class="stat-info">
          <span class="stat-value">{{ formatDurationHours(singleChannelData.stats.totalDuration) }}</span>
          <span class="stat-label">Archived Duration</span>
        </div>
      </div>

      <div class="stat-card">
        <div class="stat-icon">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-gradient"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
        </div>
        <div class="stat-info">
          <span class="stat-value">{{ formatViewsShort(singleChannelData.stats.totalViews) }}</span>
          <span class="stat-label">Cumulative Views</span>
        </div>
      </div>

      <div class="stat-card">
        <div class="stat-icon">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-gradient"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="16"></line><line x1="8" y1="12" x2="16" y2="12"></line></svg>
        </div>
        <div class="stat-info">
          <span class="stat-value">{{ formatBytes(singleChannelData.stats.totalSize) }}</span>
          <span class="stat-label">Disk Space</span>
        </div>
      </div>
    </div>

    <!-- Target Archiving Status Summary Panel -->
    <div v-if="singleChannelData?.stats && channel" class="archive-targets-summary glass-panel">
      <h3 class="summary-title">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--accent-primary);"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"></path><path d="M12 16v-4"></path><path d="M12 8h.01"></path></svg>
        Channel Archiving Status Summary
      </h3>

      <div class="summary-grid-layout">
        <!-- Column 1: YouTube Content Stats -->
        <div class="summary-card-item">
          <span class="summary-card-label">Channel Content (Indexed)</span>
          <div class="summary-card-content">
            <div class="flex-align-between">
              <span>Regular videos:</span>
              <strong>{{ singleChannelData.stats.completedVideosCount + singleChannelData.stats.pendingVideosCount + singleChannelData.stats.downloadingVideosCount + singleChannelData.stats.failedVideosCount }}</strong>
            </div>
            <div class="flex-align-between">
              <span>Shorts :</span>
              <strong>{{ singleChannelData.stats.completedShortsCount + singleChannelData.stats.pendingShortsCount + singleChannelData.stats.downloadingShortsCount + singleChannelData.stats.failedShortsCount }}</strong>
            </div>
          </div>
        </div>

        <!-- Column 2: Locally Archived Stats -->
        <div class="summary-card-item">
          <span class="summary-card-label">Already Downloaded (Archived)</span>
          <div class="summary-card-content">
            <div class="flex-align-between">
              <span>Regular videos:</span>
              <strong style="color: var(--accent-primary);">{{ singleChannelData.stats.completedVideosCount }}</strong>
            </div>
            <div class="flex-align-between">
              <span>Archived shorts:</span>
              <strong style="color: var(--accent-primary);">{{ singleChannelData.stats.completedShortsCount }}</strong>
            </div>
          </div>
        </div>

        <!-- Column 3: Scheduled / Queue Stats -->
        <div class="summary-card-item">
          <span class="summary-card-label">Remaining to download</span>
          <div class="summary-card-content">
            <div class="flex-align-between">
              <span>Scheduled videos:</span>
              <strong :style="{ color: (singleChannelData.stats.pendingVideosCount + singleChannelData.stats.downloadingVideosCount) > 0 ? '#fbbf24' : 'white' }">
                {{ singleChannelData.stats.pendingVideosCount + singleChannelData.stats.downloadingVideosCount }}
              </strong>
            </div>
            <div class="flex-align-between">
              <span>Scheduled shorts:</span>
              <strong :style="{ color: (singleChannelData.stats.pendingShortsCount + singleChannelData.stats.downloadingShortsCount) > 0 ? '#fbbf24' : 'white' }">
                {{ singleChannelData.stats.pendingShortsCount + singleChannelData.stats.downloadingShortsCount }}
              </strong>
            </div>
          </div>
        </div>

        <!-- Column 4: Exclusions / Preferences Summary -->
        <div class="summary-card-item">
          <span class="summary-card-label">Active Filters & Preferences</span>
          <div class="summary-card-content">
            <div class="flex-align-between">
              <span>Regular videos:</span>
              <span class="badge" :class="channel.download_videos === 1 ? 'badge-completed' : 'badge-failed'" style="font-size: 9px; padding: 1px 4px; font-weight: 700; line-height: 1;">
                {{ channel.download_videos === 1 ? 'ACTIVE' : 'IGNORED' }}
              </span>
            </div>
            <div class="flex-align-between">
              <span>Shorts :</span>
              <span class="badge" :class="channel.download_shorts === 1 ? 'badge-completed' : 'badge-failed'" style="font-size: 9px; padding: 1px 4px; font-weight: 700; line-height: 1;">
                {{ channel.download_shorts === 1 ? 'ACTIVE' : 'IGNORED' }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useChannelDetail } from '~/composables/useChannelDetail';

const { channel, singleChannelData } = await useChannelDetail();

const formatDurationHours = (seconds: number | null): string => {
  if (!seconds) return '0h';
  const hrs = Math.ceil(seconds / 3600);
  return `${hrs}h`;
};

const formatViewsShort = (views: number | null): string => {
  if (!views) return '0';
  if (views >= 1000000) return (views / 1000000).toFixed(1).replace('.0', '') + 'M';
  if (views >= 1000) return (views / 1000).toFixed(1).replace('.0', '') + 'k';
  return views.toString();
};

const formatBytes = (bytes: number | null): string => {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};
</script>
```

- [ ] **Step 2: Build check**

```bash
cd /Users/light/Git/youkeep && npm run build
```
Confirm it ends with `✨ Build complete!` and no errors mentioning `ChannelStatsPanel`.

- [ ] **Step 3: Commit**

```bash
cd /Users/light/Git/youkeep && git add app/components/channels/ChannelStatsPanel.vue && git commit -m "$(cat <<'EOF'
feat: extract ChannelStatsPanel component from channels.vue

Sixth step of the channels.vue split. Moves the stats row and the
archive-targets-summary panel (always shown together, purely derived
from singleChannelData.stats) into their own component with no owned
state.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: `app/components/channels/ChannelVideoGrid.vue`

**Files:**
- Create: `app/components/channels/ChannelVideoGrid.vue`

**Interfaces:**
- Consumes: `useChannelDetail()` (Task 2) for `channelId`/`channelVideos`/`videosData`/`videosPending`/`refreshVideos`/`singleChannelData`; `useChannelVideoFilters()` (Task 3) for `videoSearchQuery`/`sortBy`; `useChannelsList()` (Task 1) for `refreshChannels`; `useAuth()`/`useToast()` (existing).
- Produces: `variant: 'videos' | 'shorts'` prop, consumed by the parent (Task 10), which renders two instances (`variant="videos"` for the Archived Videos tab, `variant="shorts"` for the Shorts tab) and toggles their visibility with `v-show` — replacing both original template blocks (lines 238-325 and 327-412), which were ~95% identical.

**How `variant` drives every difference between the two original tabs (verified by diffing the two blocks directly):**

| Difference | `variant === 'videos'` | `variant === 'shorts'` |
|---|---|---|
| Filter-bar visibility gate | `singleChannelData.stats.completedVideosCount > 0` | `singleChannelData.stats.completedShortsCount > 0` |
| Search placeholder | `"Search archived video..."` | `"Search Short..."` |
| Sort dropdown options | adds `duration_desc`/`duration_asc` | Latest/Oldest/Most viewed/Least viewed only |
| List source | `is_short !== 1` | `is_short === 1` |
| Empty-state title/description | dynamic (channel-not-synced vs no-locally-archived-videos) + `action-text`/`@action` for "Start initial sync" | fixed copy, no action |
| Grid wrapper class | `video-grid stagger-in` | `shorts-grid` |
| "Short" badge overlay | absent | `<span class="short-badge">Short</span>` |
| Empty-state icon | `video` | `shorts` |

- [ ] **Step 1: Create the component file**

Create `app/components/channels/ChannelVideoGrid.vue` with this exact content:

```vue
<template>
  <div class="channel-videos-section">
    <!-- Filter and Sort Bar -->
    <div v-if="completedCount > 0" class="filter-sort-bar glass-panel">
      <div class="search-box">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
        <input
          type="text"
          v-model="videoSearchQuery"
          :placeholder="searchPlaceholder"
          class="filter-input"
        />
      </div>

      <div class="filters-group">
        <div class="filter-item">
          <label>Sort by:</label>
          <select v-model="sortBy" class="filter-select">
            <option value="date_desc">Latest</option>
            <option value="date_asc">Oldest</option>
            <option value="views_desc">Most viewed</option>
            <option value="views_asc">Least viewed</option>
            <option v-if="variant === 'videos'" value="duration_desc">Longest</option>
            <option v-if="variant === 'videos'" value="duration_asc">Shortest</option>
          </select>
        </div>
      </div>
    </div>

    <div v-if="videosPending && isInitialLoad" class="videos-loading">
      <div class="spinner"></div>
    </div>

    <EmptyState
      v-else-if="displayedVideos.length === 0"
      :title="emptyTitle"
      :description="emptyDescription"
      :icon="variant === 'videos' ? 'video' : 'shorts'"
      :action-text="emptyActionText"
      @action="handleToggleSync(true)"
    />

    <div v-else :class="variant === 'videos' ? 'video-grid stagger-in' : 'shorts-grid'">
      <VideoCard
        v-for="video in displayedVideos"
        :key="video.id"
        :video="video"
        :show-channel-info="false"
        @hidden="onVideoHidden"
      >
        <template #thumbnail-overlay>
          <span v-if="variant === 'shorts'" class="short-badge">Short</span>

          <!-- Admin Actions on Thumbnail -->
          <div v-if="isAdmin" class="admin-video-actions" @click.stop>

            <!-- Share button -->
            <button
              class="action-icon-btn"
              @click="copyShareLink(video)"
              title="Copy share link"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>
            </button>

            <!-- Visibility select -->
            <select
              :value="video.visibility || 'public'"
              @change="handleUpdateVideoVisibility(video.id, $event)"
              class="visibility-quick-select"
              title="Edit visibility"
            >
              <option value="public">🌍 Public</option>
              <option value="private">🔒 Private</option>
              <option value="ultra_private">🔑 Ultra</option>
            </select>

            <!-- Delete icon -->
            <button
              class="delete-video-btn-overlay"
              @click="handleDeleteVideo(video.id, video.title)"
              title="Delete video"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>
          </div>
        </template>
      </VideoCard>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useAuth } from '~/composables/useAuth';
import { useToast } from '~/composables/useToast';
import { useChannelDetail } from '~/composables/useChannelDetail';
import { useChannelVideoFilters } from '~/composables/useChannelVideoFilters';
import { useChannelsList } from '~/composables/useChannelsList';

const props = defineProps<{ variant: 'videos' | 'shorts' }>();

const { isAdmin } = useAuth();
const toast = useToast();

const { channelId, channelVideos, videosData, videosPending, refreshVideos, refreshSingleChannel, singleChannelData } = await useChannelDetail();
const { refreshChannels } = await useChannelsList();
const { videoSearchQuery, sortBy } = useChannelVideoFilters();

// No UI control ever sets this away from 'all' — preserved as inert internal state to
// keep filteredVideos' filtering logic byte-for-byte identical to the original page.
const filterStatus = ref('all');
const isInitialLoad = ref(true);

watch(channelId, () => {
  isInitialLoad.value = true;
});

watch(videosPending, (newVal) => {
  if (!newVal) {
    isInitialLoad.value = false;
  }
});

const completedCount = computed(() => {
  if (props.variant === 'videos') {
    return singleChannelData.value?.stats?.completedVideosCount || 0;
  }
  return singleChannelData.value?.stats?.completedShortsCount || 0;
});

const searchPlaceholder = computed(() => props.variant === 'videos' ? 'Search archived video...' : 'Search Short...');

const filteredVideos = computed(() => {
  let vids = [...channelVideos.value];

  // 1. Filter by search query
  if (videoSearchQuery.value.trim()) {
    const query = videoSearchQuery.value.toLowerCase().trim();
    vids = vids.filter(v => v.title && v.title.toLowerCase().includes(query));
  }

  // 2. Filter by status
  if (filterStatus.value !== 'all') {
    if (filterStatus.value === 'completed') {
      vids = vids.filter(v => v.download_status === 'completed');
    } else if (filterStatus.value === 'downloading_pending') {
      vids = vids.filter(v => v.download_status === 'pending' || v.download_status === 'downloading');
    } else if (filterStatus.value === 'failed') {
      vids = vids.filter(v => v.download_status === 'failed');
    }
  }

  // 3. Sort
  vids.sort((a, b) => {
    if (sortBy.value === 'date_desc') {
      return (b.upload_date || '').localeCompare(a.upload_date || '');
    } else if (sortBy.value === 'date_asc') {
      return (a.upload_date || '').localeCompare(b.upload_date || '');
    } else if (sortBy.value === 'views_desc') {
      return (b.view_count || 0) - (a.view_count || 0);
    } else if (sortBy.value === 'views_asc') {
      return (a.view_count || 0) - (b.view_count || 0);
    } else if (sortBy.value === 'duration_desc') {
      return (b.duration || 0) - (a.duration || 0);
    } else if (sortBy.value === 'duration_asc') {
      return (a.duration || 0) - (b.duration || 0);
    }
    return 0;
  });

  return vids;
});

const displayedVideos = computed(() => {
  if (props.variant === 'videos') {
    return filteredVideos.value.filter((v: any) => v.download_status === 'completed' && v.is_short !== 1);
  }
  return filteredVideos.value.filter((v: any) => v.download_status === 'completed' && v.is_short === 1);
});

const emptyTitle = computed(() => {
  if (props.variant === 'videos') {
    return channelVideos.value.length === 0 ? 'Channel not synchronized' : 'No videos archived locally';
  }
  return 'No Shorts archived';
});

const emptyDescription = computed(() => {
  if (props.variant === 'videos') {
    return channelVideos.value.length === 0
      ? 'No videos have been indexed for this channel yet. You need to start a sync to fetch available videos from YouTube.'
      : `There are currently ${channelVideos.value.length} videos indexed in our database, but none have been successfully downloaded yet.`;
  }
  return 'No Shorts have been downloaded for this channel yet. Make sure the Shorts archiving option is enabled in the channel settings.';
});

const emptyActionText = computed(() => {
  if (props.variant === 'videos' && channelVideos.value.length === 0 && isAdmin.value) {
    return 'Start initial sync';
  }
  return undefined;
});

const onVideoHidden = (id: string) => {
  if (videosData.value && videosData.value.videos) {
    videosData.value.videos = videosData.value.videos.filter((v: any) => v.id !== id);
  }
};

const copyShareLink = (video: any) => {
  let shareUrl = window.location.origin + '/watch/' + video.id;
  if (video.visibility !== 'public' && video.share_token) {
    shareUrl += '?token=' + video.share_token;
  }

  navigator.clipboard.writeText(shareUrl);
  toast.success('Share link copied.');
};

const handleUpdateVideoVisibility = async (videoId: string, event: Event) => {
  const select = event.target as HTMLSelectElement;
  const visibility = select.value;
  try {
    await $fetch(`/api/admin/videos/${videoId}/visibility`, {
      method: 'PUT',
      body: { visibility }
    });
    toast.success('Video visibility updated.');
    refreshVideos();
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Update failed.');
  }
};

const handleDeleteVideo = async (videoId: string, title: string) => {
  if (!confirm(`Permanently delete the video "${title}"?\nThe local file will be deleted.`)) {
    return;
  }

  try {
    await $fetch(`/api/admin/videos/${videoId}`, { method: 'DELETE' });
    toast.success('Video deleted.');
    refreshVideos();
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Deletion failed.');
  }
};

const handleToggleSync = async (start: boolean) => {
  const endpoint = start ? 'sync' : 'pause';
  try {
    await $fetch(`/api/admin/channels/${channelId.value}/${endpoint}`, { method: 'POST' });
    toast.success(start ? 'Synchronization started.' : 'Synchronization paused.');
    refreshSingleChannel();
    refreshChannels();
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Action failed.');
  }
};
</script>
```

Note on `handleToggleSync`: the original page has two separate, near-duplicate sync-toggling functions — `handleToggleSyncStatus` (reads the channel's current `sync_status` to decide direction, used by the header's Pause/Resume button) and `handleToggleSync(start: boolean)` (explicit direction, used only by this tab's empty-state "Start initial sync" action, line 277 of the original: `@action="handleToggleSync(true)"`). They are genuinely different functions in the original file, not a refactoring opportunity in scope here — `handleToggleSync` moves here verbatim since this is its only remaining call site (only reachable when `variant === 'videos'`, since `emptyActionText` is `undefined` for `variant === 'shorts'`, so the button never renders there — the `@action` binding itself can stay unconditional, exactly matching the original's unconditional binding).

- [ ] **Step 2: Build check**

```bash
cd /Users/light/Git/youkeep && npm run build
```
Confirm it ends with `✨ Build complete!` and no errors mentioning `ChannelVideoGrid`.

- [ ] **Step 3: Commit**

```bash
cd /Users/light/Git/youkeep && git add app/components/channels/ChannelVideoGrid.vue && git commit -m "$(cat <<'EOF'
feat: extract ChannelVideoGrid component from channels.vue

Seventh step of the channels.vue split. Replaces the ~95% identical
Archived Videos and Shorts tab templates with one component taking a
variant prop, consuming the new useChannelDetail and
useChannelVideoFilters composables.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: `app/components/channels/ChannelPlaylistsTab.vue`

**Files:**
- Create: `app/components/channels/ChannelPlaylistsTab.vue`

**Interfaces:**
- Consumes: `useChannelDetail()` (Task 2) for `channelId`/`videosData`; `useToast()` (existing).
- Produces: `defineExpose({ channelPlaylists })` — the parent (Task 10) needs the playlist count for the tab bar's `<span class="tab-count">` badge, but this component's own playlist-list fetch is deliberately self-contained (not part of any shared composable, per the approved design spec), so it's exposed via a template ref instead of being lifted into shared state.

**On why this tab owns its own `channelPlaylists`/`playlistsData`/`playlistsPending`/`refreshPlaylists` fetch:** the approved design spec describes this component as "already self-contained today (its own `selectedPlaylistId`/`selectedPlaylistData`/`syncingPlaylists`/`loadingPlaylistDetail` state and `openPlaylist`/`closePlaylist`/`handleSyncPlaylists` handlers move here verbatim)". The playlist-*list* fetch (distinct from the playlist-*detail* state already named there) is the same kind of self-contained concern — nothing else in the split needs the list of playlists — so it moves here too, as its own local `useFetch` call using `channelId` from `useChannelDetail()`, mirroring the original page's `computed(() => channelId.value ? ... : ...)` URL pattern.

**On `onVideoHidden`'s scope:** the original combined function defensively updated both `videosData.value.videos` (the general channel video cache) and `selectedPlaylistData.value.videos` (this tab's own local playlist-detail cache) whenever *any* video card fired `@hidden`, regardless of which tab it came from. Since `selectedPlaylistData` is deliberately local/self-contained to this component (per the design spec) and isn't exposed to `ChannelVideoGrid`, the original single function is naturally split: this component's own `onVideoHidden` updates *both* `selectedPlaylistData` (which only this component owns) and `videosData` (shared, from `useChannelDetail()`) — preserving the "hiding a video from an open playlist also updates the general cache" direction. `ChannelVideoGrid`'s `onVideoHidden` (Task 7) only updates `videosData`, since it has no access to this component's local `selectedPlaylistData`. The one narrow behavior difference this split accepts: hiding a video from the Archived/Shorts tab no longer proactively also strips it from an already-loaded (but currently `v-show`-hidden) playlist-detail cache in this tab — visible only in the rare case where the exact same video is both hidden from the general list *and* was already open in a specific playlist's detail view at that moment. `selectedPlaylistData` is always freshly re-fetched from the server on `openPlaylist()` and cleared on `closePlaylist()`, so this narrow gap self-resolves the next time the user opens (or re-opens) that playlist.

- [ ] **Step 1: Create the component file**

Create `app/components/channels/ChannelPlaylistsTab.vue` with this exact content:

```vue
<template>
  <div class="channel-videos-section">
    <!-- Playlist List View -->
    <template v-if="!selectedPlaylistId">
      <div class="videos-section-header" style="display: flex; align-items: center; justify-content: space-between;">
        <h2 class="section-title">Playlists</h2>
        <button
          @click="handleSyncPlaylists"
          class="btn btn-secondary btn-sm"
          :disabled="syncingPlaylists"
        >
          {{ syncingPlaylists ? 'Syncing...' : 'Sync Playlists' }}
        </button>
      </div>

      <div v-if="playlistsPending" class="videos-loading">
        <div class="spinner"></div>
      </div>

      <EmptyState
        v-else-if="channelPlaylists.length === 0"
        title="No playlists found"
        description="No public playlists are listed for this channel. Click 'Sync Playlists' above to scan for public playlists."
        icon="folder"
      />

      <div v-else class="video-grid" style="grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));">
        <div
          v-for="playlist in channelPlaylists"
          :key="playlist.id"
          class="video-card premium-card"
          @click="openPlaylist(playlist.id)"
          style="cursor: pointer;"
        >
          <div class="thumbnail-wrapper" style="position: relative;">
            <!-- Overlay to make it look like a playlist card -->
            <div style="position: absolute; right: 0; top: 0; bottom: 0; width: 40%; background: rgba(0, 0, 0, 0.7); backdrop-filter: blur(2px); z-index: 2; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; border-top-right-radius: inherit; border-bottom-right-radius: inherit;">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: white;"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
              <span style="font-size: 12px; font-weight: 700; color: white;">{{ playlist.video_count }}</span>
            </div>
            <img
              :src="playlist.thumbnail_url || 'data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 16 9\' fill=\'%23111\'><rect width=\'16\' height=\'9\' fill=\'%23111\'/></svg>'"
              class="thumbnail-img"
              alt="Playlist Thumbnail"
              style="aspect-ratio: 16/9; object-fit: cover;"
            />
          </div>
          <div class="video-info" style="padding: 10px; display: flex; flex-direction: column; flex: 1;">
            <h4 class="video-title" style="font-size: 14px; font-weight: 600; line-height: 1.4; color: white; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">
              {{ playlist.title }}
            </h4>
            <p v-if="playlist.description" style="font-size: 12px; color: var(--text-secondary); margin-top: 6px; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">
              {{ playlist.description }}
            </p>
          </div>
        </div>
      </div>
    </template>

    <!-- Playlist Detail View -->
    <template v-else>
      <div class="videos-section-header" style="display: flex; align-items: center; gap: 12px;">
        <button @click="closePlaylist" class="btn btn-secondary btn-sm" style="display: inline-flex; align-items: center; gap: 6px;">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
          Back to playlists
        </button>
        <h2 class="section-title" style="margin-left: 8px;">{{ selectedPlaylistData?.playlist?.title }}</h2>
      </div>

      <div v-if="loadingPlaylistDetail" class="videos-loading">
        <div class="spinner"></div>
      </div>

      <EmptyState
        v-else-if="!selectedPlaylistData?.videos?.length"
        title="Empty playlist"
        description="This playlist does not contain any videos."
        icon="video"
      />

      <div v-else class="video-grid">
        <VideoCard
          v-for="video in selectedPlaylistData.videos"
          :key="video.id"
          :video="video"
          :show-channel-info="false"
          :clickable="video.download_status === 'completed'"
          :to="`/watch/${video.id}?playlistId=${selectedPlaylistId}`"
          @hidden="onVideoHidden"
        >
          <template #thumbnail-overlay>
            <span class="badge queue-status-badge" :class="getBadgeClass(video.download_status)" style="top: 8px; right: 8px;">
              {{ formatStatus(video.download_status) }}
            </span>
            <span class="badge" style="position: absolute; bottom: 8px; left: 8px; background: rgba(0, 0, 0, 0.7); font-size: 11px; padding: 2px 6px; border-radius: 4px; font-weight: 700; z-index: 2;">
              #{{ video.position }}
            </span>
          </template>
        </VideoCard>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue';
import { useToast } from '~/composables/useToast';
import { useChannelDetail } from '~/composables/useChannelDetail';

const toast = useToast();

const { channelId, videosData } = await useChannelDetail();

const { data: playlistsData, pending: playlistsPending, refresh: refreshPlaylists } = await useFetch<any>(computed(() => {
  return channelId.value ? `/api/channels/${channelId.value}/playlists` : '/api/channels';
}));
const channelPlaylists = computed(() => {
  if (!channelId.value) return [];
  return playlistsData.value || [];
});

const selectedPlaylistId = ref('');
const selectedPlaylistData = ref<any>(null);
const loadingPlaylistDetail = ref(false);
const syncingPlaylists = ref(false);

const openPlaylist = async (playlistId: string) => {
  selectedPlaylistId.value = playlistId;
  loadingPlaylistDetail.value = true;
  try {
    selectedPlaylistData.value = await $fetch(`/api/playlists/${playlistId}`);
  } catch (err) {
    toast.error('Failed to load playlist details.');
  } finally {
    loadingPlaylistDetail.value = false;
  }
};

const closePlaylist = () => {
  selectedPlaylistId.value = '';
  selectedPlaylistData.value = null;
};

watch(channelId, () => {
  closePlaylist();
});

let syncPlaylistsRefreshTimer: ReturnType<typeof setTimeout> | null = null;

async function handleSyncPlaylists() {
  if (!channelId.value) return;
  syncingPlaylists.value = true;
  try {
    const res = await $fetch<any>(`/api/admin/channels/${channelId.value}/sync-playlists`, {
      method: 'POST'
    });
    toast.success(res.message || 'Playlist sync started.');
    // The sync runs in the background on the server; give it a moment before refreshing.
    syncPlaylistsRefreshTimer = setTimeout(() => {
      syncPlaylistsRefreshTimer = null;
      refreshPlaylists();
    }, 5000);
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Failed to start playlist sync.');
  } finally {
    syncingPlaylists.value = false;
  }
}

onUnmounted(() => {
  if (syncPlaylistsRefreshTimer) {
    clearTimeout(syncPlaylistsRefreshTimer);
    syncPlaylistsRefreshTimer = null;
  }
});

const onVideoHidden = (id: string) => {
  if (selectedPlaylistData.value && selectedPlaylistData.value.videos) {
    selectedPlaylistData.value.videos = selectedPlaylistData.value.videos.filter((v: any) => v.id !== id);
  }
  if (videosData.value && videosData.value.videos) {
    videosData.value.videos = videosData.value.videos.filter((v: any) => v.id !== id);
  }
};

const formatStatus = (status: string): string => {
  switch (status) {
    case 'pending': return 'Pending';
    case 'downloading': return 'Downloading';
    case 'completed': return 'Completed';
    case 'failed': return 'Failed';
    default: return status;
  }
};

const getBadgeClass = (status: string): string => {
  switch (status) {
    case 'pending': return 'badge-pending';
    case 'downloading': return 'badge-downloading';
    case 'completed': return 'badge-completed';
    case 'failed': return 'badge-failed';
    default: return '';
  }
};

defineExpose({ channelPlaylists });
</script>
```

- [ ] **Step 2: Build check**

```bash
cd /Users/light/Git/youkeep && npm run build
```
Confirm it ends with `✨ Build complete!` and no errors mentioning `ChannelPlaylistsTab`.

- [ ] **Step 3: Commit**

```bash
cd /Users/light/Git/youkeep && git add app/components/channels/ChannelPlaylistsTab.vue && git commit -m "$(cat <<'EOF'
feat: extract ChannelPlaylistsTab component from channels.vue

Eighth step of the channels.vue split. Moves the playlists
list-or-detail block (already self-contained) into its own
component, including its own playlist-list fetch. Exposes
channelPlaylists via defineExpose so the parent's tab bar can show a
live playlist count without lifting the fetch out of this component.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: `app/components/channels/ChannelSettingsDrawer.vue`

**Files:**
- Create: `app/components/channels/ChannelSettingsDrawer.vue`

**Interfaces:**
- Consumes: `useChannelDetail()` (Task 2) for `channelId`/`channel`/`refreshSingleChannel`; `useChannelsList()` (Task 1) for `refreshChannels`; `useAuth()`/`useToast()` (existing).
- Produces: `showDrawer: boolean` prop + `update:showDrawer` emit, used by the parent (Task 10) as `v-model:show-drawer`. Unlike `ChannelDetailHeader` (Task 5, fire-and-forget `open-drawer` emit), this component needs the current value both to drive its own `:class="{ open: showDrawer }"`/backdrop `:class="{ active: showDrawer }"` bindings and to close itself (drawer's own close button, and the backdrop's click-to-close) — a genuine two-way binding.

- [ ] **Step 1: Create the component file**

Create `app/components/channels/ChannelSettingsDrawer.vue` with this exact content:

```vue
<template>
  <div>
    <!-- Backdrop Overlay for Drawer -->
    <div
      v-if="isAdmin"
      class="drawer-backdrop"
      :class="{ active: showDrawer }"
      @click="$emit('update:showDrawer', false)"
    ></div>

    <!-- Admin Settings Drawer -->
    <div
      v-if="isAdmin && channel"
      class="settings-drawer"
      :class="{ open: showDrawer }"
    >
      <div class="drawer-header">
        <h3 class="drawer-title">Tracking options</h3>
        <button class="drawer-close-btn" @click="$emit('update:showDrawer', false)">&times;</button>
      </div>

      <div class="drawer-body">
        <!-- Visibility -->
        <div class="form-group-item">
          <label class="form-label" style="margin-bottom: 8px; font-weight: 600;">Channel visibility:</label>
          <select :value="channel.visibility || 'public'" @change="handleUpdateChannelVisibility" class="form-input">
            <option value="public">🌍 Public (Everyone)</option>
            <option value="private">🔒 Private (Logged-in users)</option>
            <option value="ultra_private">🔑 Ultra Private (Admins only)</option>
          </select>
        </div>

        <hr style="border: 0; border-top: 1px solid rgba(255, 255, 255, 0.08); margin: 8px 0;" />

        <!-- Archiving Preferences -->
        <div style="display: flex; flex-direction: column; gap: 16px;">
          <h4 style="font-size: 14px; font-weight: 600; color: white; margin: 0;">Archiving Preferences</h4>
          <form @submit.prevent="handleSavePreferences" style="display: flex; flex-direction: column; gap: 16px;">
            <div style="display: flex; gap: 24px;">
              <!-- Toggle switch Videos -->
              <label class="toggle-switch">
                <input type="checkbox" v-model="formPref.downloadVideos" class="toggle-input" />
                <div class="toggle-slider"></div>
                <span>Regular videos</span>
              </label>

              <!-- Toggle switch Shorts -->
              <label class="toggle-switch">
                <input type="checkbox" v-model="formPref.downloadShorts" class="toggle-input" />
                <div class="toggle-slider"></div>
                <span>Shorts</span>
              </label>
            </div>

            <!-- Custom save path -->
            <div class="pref-path-picker">
              <label class="form-label" for="drawerCustomSavePath" style="font-size: 12px; color: var(--text-secondary); margin-bottom: 6px;">Custom save folder (leave empty for default):</label>
              <input
                type="text"
                id="drawerCustomSavePath"
                v-model="formPref.customSavePath"
                placeholder="/path/to/folder"
                class="form-input"
              />
            </div>

            <button type="submit" class="btn btn-primary" style="width: 100%; justify-content: center; margin-top: 8px;" :disabled="savingPref">
              <span v-if="savingPref" class="spinner-sm mr-2"></span>
              <span>Save preferences</span>
            </button>
          </form>
          <p v-if="prefMessage" class="pref-msg success-msg" style="text-align: center; color: #4ade80; font-size: 13px;">{{ prefMessage }}</p>
        </div>

        <hr style="border: 0; border-top: 1px solid rgba(255, 255, 255, 0.08); margin: 8px 0;" />

        <!-- Supprimer -->
        <div style="margin-top: 8px; border-top: 1px solid rgba(255, 255, 255, 0.06); padding-top: 16px;">
          <button
            @click="handleDeleteChannel"
            class="btn critical-delete-btn btn-sm"
            style="width: 100%; justify-content: center;"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="mr-1"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            Delete from archive
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, watch } from 'vue';
import { useAuth } from '~/composables/useAuth';
import { useToast } from '~/composables/useToast';
import { useChannelDetail } from '~/composables/useChannelDetail';
import { useChannelsList } from '~/composables/useChannelsList';

defineProps<{ showDrawer: boolean }>();
defineEmits<{ 'update:showDrawer': [value: boolean] }>();

const { isAdmin } = useAuth();
const toast = useToast();
const router = useRouter();

const { channelId, channel, refreshSingleChannel } = await useChannelDetail();
const { refreshChannels } = await useChannelsList();

const formPref = reactive({
  downloadVideos: true,
  downloadShorts: false,
  customSavePath: ''
});
const savingPref = ref(false);
const prefMessage = ref('');

// Populate preferences state when channel details load
let lastLoadedChannelId = '';

watch(channel, (newVal) => {
  if (newVal && newVal.id !== lastLoadedChannelId) {
    // Only populate formPref if the channel ID has changed, preventing polling resets
    lastLoadedChannelId = newVal.id;
    formPref.downloadVideos = newVal.download_videos === 1;
    formPref.downloadShorts = newVal.download_shorts === 1;
    formPref.customSavePath = newVal.custom_save_path || '';

    // date_after is deprecated
  }
}, { immediate: true });

const handleUpdateChannelVisibility = async (event: Event) => {
  const select = event.target as HTMLSelectElement;
  const visibility = select.value;
  try {
    await $fetch(`/api/admin/channels/${channelId.value}/visibility`, {
      method: 'PUT',
      body: { visibility }
    });
    toast.success('Channel visibility updated.');
    refreshSingleChannel();
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Update failed.');
  }
};

const handleSavePreferences = async () => {
  savingPref.value = true;
  prefMessage.value = '';
  try {
    await $fetch(`/api/admin/channels/${channelId.value}/options`, {
      method: 'PUT',
      body: {
        downloadVideos: formPref.downloadVideos,
        downloadShorts: formPref.downloadShorts,
        dateAfter: null,
        customSavePath: formPref.customSavePath || null
      }
    });
    toast.success('Download options saved.');
    lastLoadedChannelId = ''; // Allow the watch handler to re-sync state on successful save refresh
    refreshSingleChannel();
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Save failed.');
  } finally {
    savingPref.value = false;
  }
};

const handleDeleteChannel = async () => {
  if (!confirm(`WARNING: Are you sure you want to permanently delete the channel "${channel.value.title}" from the archive?\nThis will delete all downloaded videos from your disk and the database.`)) {
    return;
  }

  try {
    await $fetch(`/api/admin/channels/${channelId.value}`, { method: 'DELETE' });
    toast.success('Channel deleted.');
    router.push({ path: '/channels' });
    refreshChannels();
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Failed to delete the channel.');
  }
};
</script>
```

Note: `prefMessage` is set to `''` at the start of `handleSavePreferences` and never assigned a non-empty value anywhere in the original script — the `<p v-if="prefMessage" ...>Save confirmation` line is dead UI in the *original* file too (pre-existing, not part of this refactor's approved dead-code list). It is preserved verbatim, exactly as-is, rather than "fixed" — fixing it would be a behavior change outside this plan's scope.

- [ ] **Step 2: Build check**

```bash
cd /Users/light/Git/youkeep && npm run build
```
Confirm it ends with `✨ Build complete!` and no errors mentioning `ChannelSettingsDrawer`.

- [ ] **Step 3: Commit**

```bash
cd /Users/light/Git/youkeep && git add app/components/channels/ChannelSettingsDrawer.vue && git commit -m "$(cat <<'EOF'
feat: extract ChannelSettingsDrawer component from channels.vue

Ninth step of the channels.vue split. Moves the admin preferences
drawer (visibility select, download-preferences form, delete-channel
button) plus its backdrop into its own component, taking showDrawer
as a v-model prop from the parent.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Rewrite `app/pages/channels.vue`

**This task MUST come last** — it depends on the final shape of every composable and component from Tasks 1-9, and it performs the CSS-scoping fix and dead-code deletion described in "Notes on findings" above.

**Files:**
- Modify: `app/pages/channels.vue` (full rewrite)

**Interfaces:**
- Consumes: `useChannelDetail()` (Task 2) for `channelId`/`channel`/`channelVideos`/`refreshSingleChannel`/`refreshVideos`; explicitly imports (see "Notes on findings" point 6) `ChannelDirectoryView` (Task 4), `ChannelDetailHeader` (Task 5), `ChannelStatsPanel` (Task 6), `ChannelVideoGrid` (Task 7, both variants), `ChannelPlaylistsTab` (Task 8), `ChannelSettingsDrawer` (Task 9).
- Produces: nothing (this is the page itself).

**What the parent retains:** the top-level `v-if="channelId && channel"` switch between the detail view and `ChannelDirectoryView`; the "All Channels" back button (page-level navigation chrome, not part of any one child component); `activeTab` (the 3-way sub-tab selector — stays at parent level since it's page-level UI state, not owned by any one child, exactly matching the approved design spec); `showDrawer` (passed down via `v-model:show-drawer` to `ChannelSettingsDrawer`, and set to `true` by `ChannelDetailHeader`'s `open-drawer` emit); the `channelPlaylistsTabRef` template ref used to read the live playlist count for the tab bar's badge (see Task 8); and the polling loop, with the dead `checkSyncAllStatus`/`checkDownloaderPausedStatus` calls removed — it now calls only `refreshVideos()`/`refreshSingleChannel()`, same cadence logic as today.

- [ ] **Step 1: Replace the entire contents of `app/pages/channels.vue`**

Replace the entire file with this exact content. The `<template>` and `<script setup>` sections are new (thin shell); the `<style>` section is the original file's style block, moved verbatim except for the `scoped` attribute removal, the `.channels-page`-ancestor qualification of every selector, the compound-selector fixes for the `VideoCard`/`VideoDropdownMenu` collisions, and the deletion of confirmed-dead CSS — all per "Notes on findings" above.

```vue
<template>
  <div class="channels-page">
    <!-- DETAIL VIEW: Single Channel Profile -->
    <div v-if="channelId && channel" class="channel-detail-view">
      <!-- Back Button -->
      <button @click="goBack" class="btn btn-secondary back-btn">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
        All Channels
      </button>

      <ChannelDetailHeader @open-drawer="showDrawer = true" />
      <ChannelStatsPanel />

      <!-- Tabbed Navigation Bar -->
      <div class="channel-tabs-bar tabs-bar" style="margin-top: 12px;">
        <button
          type="button"
          class="tab-btn"
          :class="{ active: activeTab === 'archived' }"
          @click="activeTab = 'archived'"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="tab-icon"><path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.33z"></path><polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02"></polygon></svg>
          Archived Videos <span class="tab-count">{{ singleChannelData?.stats?.completedVideosCount || 0 }}</span>
        </button>
        <button
          type="button"
          class="tab-btn"
          :class="{ active: activeTab === 'shorts' }"
          @click="activeTab = 'shorts'"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="tab-icon"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect><line x1="12" y1="18" x2="12.01" y2="18"></line></svg>
          Shorts <span class="tab-count">{{ singleChannelData?.stats?.completedShortsCount || 0 }}</span>
        </button>
        <button
          type="button"
          class="tab-btn"
          :class="{ active: activeTab === 'playlists' }"
          @click="activeTab = 'playlists'"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="tab-icon"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
          Playlists <span class="tab-count">{{ channelPlaylistsTabRef?.channelPlaylists?.length || 0 }}</span>
        </button>
      </div>

      <ChannelVideoGrid v-show="activeTab === 'archived'" variant="videos" />
      <ChannelVideoGrid v-show="activeTab === 'shorts'" variant="shorts" />
      <div v-show="activeTab === 'playlists'">
        <ChannelPlaylistsTab ref="channelPlaylistsTabRef" />
      </div>
    </div>

    <!-- DIRECTORY VIEW: List of Channels -->
    <ChannelDirectoryView v-else />

    <ChannelSettingsDrawer v-if="channelId && channel" v-model:show-drawer="showDrawer" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useChannelDetail } from '~/composables/useChannelDetail';
import ChannelDirectoryView from '~/components/channels/ChannelDirectoryView.vue';
import ChannelDetailHeader from '~/components/channels/ChannelDetailHeader.vue';
import ChannelStatsPanel from '~/components/channels/ChannelStatsPanel.vue';
import ChannelVideoGrid from '~/components/channels/ChannelVideoGrid.vue';
import ChannelPlaylistsTab from '~/components/channels/ChannelPlaylistsTab.vue';
import ChannelSettingsDrawer from '~/components/channels/ChannelSettingsDrawer.vue';

const router = useRouter();

const { channelId, channel, singleChannelData, channelVideos, refreshSingleChannel, refreshVideos } = await useChannelDetail();

const activeTab = ref('archived');
const showDrawer = ref(false);
const channelPlaylistsTabRef = ref<InstanceType<typeof ChannelPlaylistsTab> | null>(null);

watch(channelId, () => {
  activeTab.value = 'archived';
  showDrawer.value = false;
});

const goBack = () => {
  router.push({ path: '/channels' });
};

// Dynamic polling for the selected channel's videos/details
let syncStatusTimeout: any = null;

const pollStatus = async () => {
  if (channelId.value) {
    await refreshVideos();
    await refreshSingleChannel();
  }
};

const runPolling = async () => {
  await pollStatus();
  // Poll faster (every 1s) if there is an active downloading video on this channel page, else poll every 3s
  const hasActiveDownloads = channelVideos.value.some((v: any) => v.download_status === 'downloading');
  const nextPollDelay = hasActiveDownloads ? 1000 : 3000;
  syncStatusTimeout = setTimeout(runPolling, nextPollDelay);
};

onMounted(() => {
  runPolling();
});

onUnmounted(() => {
  if (syncStatusTimeout) clearTimeout(syncStatusTimeout);
});
</script>

<style>
.channels-page {
  display: flex;
  flex-direction: column;
}

.channels-page .directory-header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
  flex-wrap: wrap;
  gap: 12px;
}

.channels-page .videos-loading .spinner {
  width: 36px;
  height: 36px;
  border: 3.5px solid rgba(139, 92, 246, 0.1);
  border-radius: 50%;
  border-top-color: var(--accent-primary);
  animation: spin 0.8s linear infinite;
}

.channels-page .channel-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(295px, 1fr));
  gap: 24px;
}

.channels-page .channel-card {
  display: flex;
  flex-direction: column;
  border-radius: var(--border-radius-lg);
  cursor: pointer;
  border: 1px solid var(--border-color);
  background: rgba(17, 17, 34, 0.4);
  overflow: hidden;
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), border-color 0.3s ease, box-shadow 0.3s ease;
}

.channels-page .channel-card:hover {
  transform: translateY(-4px);
  border-color: rgba(139, 92, 246, 0.3);
  box-shadow: 0 12px 32px rgba(139, 92, 246, 0.15);
  background: rgba(17, 17, 34, 0.6);
}

.channels-page .channel-card-banner {
  height: 90px;
  width: 100%;
  background: linear-gradient(135deg, var(--accent-primary) 0%, var(--accent-secondary) 100%);
  background-size: cover;
  background-position: center;
  position: relative;
}

.channels-page .channel-card-banner-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.2);
}

.channels-page .channel-card-sync-badge {
  position: absolute;
  top: 8px;
  right: 8px;
  font-size: 10px;
  font-weight: 700;
  padding: 3px 8px;
  border-radius: 20px;
  text-transform: uppercase;
}

.channels-page .channel-card-sync-badge.downloading {
  background: rgba(16, 185, 129, 0.85);
  color: white;
  box-shadow: 0 2px 6px rgba(16, 185, 129, 0.4);
}

.channels-page .channel-card-sync-badge.paused {
  background: rgba(239, 68, 68, 0.85);
  color: white;
}

.channels-page .channel-card-body {
  display: flex;
  flex-direction: column;
  padding: 16px;
  position: relative;
  flex: 1;
}

.channels-page .channel-card-avatar-wrapper {
  position: absolute;
  top: -36px;
  left: 16px;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  border: 3px solid #06060c;
  overflow: hidden;
  background: var(--bg-surface);
  box-shadow: var(--shadow-sm);
  transition: transform 0.25s ease;
}

.channels-page .channel-card:hover .channel-card-avatar-wrapper {
  transform: scale(1.05);
}

.channels-page .channel-card-avatar {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.channels-page .channel-card-info {
  margin-top: 24px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
}

.channels-page .channel-card-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.channels-page .channel-card-desc {
  font-size: 12.5px;
  color: var(--text-secondary);
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}

.channels-page .channel-card-stats {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--border-color);
}

.channels-page .stat-badge {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
}

.channels-page .visibility-pill {
  font-size: 10px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 4px;
  text-transform: uppercase;
}

.channels-page .visibility-pill.public {
  background: rgba(16, 185, 129, 0.1);
  color: #34d399;
  border: 1px solid rgba(16, 185, 129, 0.2);
}

.channels-page .visibility-pill.private {
  background: rgba(239, 68, 68, 0.1);
  color: #f87171;
  border: 1px solid rgba(239, 68, 68, 0.2);
}

/* Detail View Styles */
.channels-page .channel-detail-view {
  display: flex;
  flex-direction: column;
  gap: 20px;
  max-width: 1200px;
  margin: 0 auto;
  width: 100%;
}

.channels-page .back-btn {
  align-self: flex-start;
}

.channels-page .channel-banner-container {
  height: 180px;
  width: 100%;
  border-radius: var(--border-radius-lg);
  background: linear-gradient(135deg, rgba(139, 92, 246, 0.08) 0%, rgba(18, 18, 34, 0.8) 100%);
  position: relative;
  overflow: hidden;
  box-shadow: var(--shadow-md);
}

.channels-page .banner-overlay {
  position: absolute;
  inset: 0;
  background: radial-gradient(circle at 10% 20%, rgba(0, 0, 0, 0.4) 0%, transparent 90%);
}

.channels-page .channel-profile-header {
  display: flex;
  gap: 24px;
  padding: 0 16px;
  align-items: flex-start;
}

@media (max-width: 600px) {
  .channels-page .channel-profile-header {
    flex-direction: column;
    align-items: center;
    text-align: center;
  }
}

.channels-page .channel-profile-avatar {
  width: 100px;
  height: 100px;
  border-radius: 50%;
  object-fit: cover;
  background: var(--bg-surface);
  border: 3px solid #06060c;
  box-shadow: var(--shadow-md);
}

.channels-page .channel-profile-info {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
}

.channels-page .title-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.channels-page .channel-profile-title {
  font-size: 24px;
  font-weight: 800;
}

.channels-page .channel-profile-meta {
  font-size: 13px;
  color: var(--text-secondary);
  font-weight: 500;
}

.channels-page .channel-profile-desc {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.5;
  max-width: 800px;
}

.channels-page .channel-actions-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 10px;
}

.channels-page .critical-delete-btn {
  background: #dc2626;
  color: white;
  box-shadow: 0 4px 12px rgba(220, 38, 38, 0.2);
  height: 40px;
  font-size: 13.5px;
  font-weight: 600;
  border-radius: var(--border-radius-md);
  transition: all 0.2s ease;
}

.channels-page .critical-delete-btn:hover {
  background: #b91c1c;
  transform: translateY(-1px);
}

.channels-page .pref-msg {
  font-size: 12px;
  padding: 6px 12px;
  border-radius: var(--border-radius-sm);
  align-self: flex-start;
}

/* Videos List Grid */
.channels-page .channel-videos-section {
  border-top: 1px solid var(--border-color);
  padding-top: 24px;
}

.channels-page .videos-loading {
  display: flex;
  justify-content: center;
  padding: 40px 0;
}

.channels-page .video-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  column-gap: 24px;
  row-gap: 40px;
  margin-bottom: 40px;
}

@media (max-width: 1024px) {
  .channels-page .video-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 640px) {
  .channels-page .video-grid {
    grid-template-columns: 1fr;
  }
}

.channels-page .video-card.premium-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  cursor: pointer;
}

.channels-page .video-card.premium-card .thumbnail-wrapper {
  position: relative;
  aspect-ratio: 16/9;
  border-radius: var(--border-radius-md);
  overflow: hidden;
  box-shadow: var(--shadow-sm);
  background: #000;
  border: 1px solid transparent;
  transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
}

.channels-page .video-card.premium-card .thumbnail-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.5s cubic-bezier(0.25, 1, 0.5, 1);
}

.channels-page .video-card.premium-card .thumbnail-wrapper::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 40%;
  background: linear-gradient(to top, rgba(0,0,0,0.8), transparent);
  pointer-events: none;
}

.channels-page .delete-video-btn {
  position: absolute;
  top: 6px;
  right: 6px;
  background: rgba(0, 0, 0, 0.8);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: var(--text-secondary);
  width: 26px;
  height: 26px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s;
  z-index: 3;
}

.channels-page .delete-video-btn:hover {
  background: #dc2626;
  color: white;
  transform: scale(1.1);
  box-shadow: 0 2px 8px rgba(220, 38, 38, 0.5);
}

.channels-page .video-card.premium-card .video-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px;
}

.channels-page .video-card.premium-card .video-title {
  font-family: var(--font-title);
  font-size: 14px;
  font-weight: 600;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
}

.channels-page .video-card.premium-card:hover .thumbnail-img {
  transform: scale(1.06);
}

.channels-page .drawer-body .spinner-sm {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-radius: 50%;
  border-top-color: white;
  animation: spin 0.8s linear infinite;
  display: inline-block;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* Barres de tri / filtrage / batch actions */
.channels-page .videos-section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  flex-wrap: wrap;
  gap: 12px;
}

.channels-page .filter-sort-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-radius: var(--border-radius-md);
  margin-bottom: 24px;
  flex-wrap: wrap;
  gap: 16px;
}

.channels-page .search-box {
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.08);
  padding: 0 12px;
  border-radius: 40px;
  height: 36px;
  width: 260px;
}

.channels-page .search-box svg {
  color: var(--text-secondary);
}

.channels-page .filter-input {
  background: transparent;
  border: none;
  color: var(--text-primary);
  font-size: 13px;
  width: 100%;
}

.channels-page .filter-input:focus {
  outline: none;
}

.channels-page .filters-group {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}

.channels-page .filter-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.channels-page .filter-item label {
  color: var(--text-secondary);
  font-weight: 500;
}

.channels-page .filter-select {
  background: rgba(0, 0, 0, 0.4);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: var(--text-primary);
  border-radius: var(--border-radius-sm);
  padding: 4px 10px;
  font-size: 13px;
  outline: none;
}

.channels-page .filter-select:focus {
  border-color: var(--accent-primary);
}

/* Visibility Quick Actions styling */
.channels-page .admin-video-actions {
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: 4;
  display: flex;
  align-items: center;
  gap: 4px;
  background: rgba(0, 0, 0, 0.85);
  padding: 4px 6px;
  border-radius: 20px;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.channels-page .action-icon-btn,
.channels-page .delete-video-btn-overlay {
  background: transparent;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  transition: all 0.2s;
}

.channels-page .action-icon-btn:hover {
  color: white;
  background: rgba(255, 255, 255, 0.1);
}

.channels-page .delete-video-btn-overlay:hover {
  color: white;
  background: #dc2626;
}

.channels-page .visibility-quick-select {
  background: transparent;
  border: none;
  color: var(--text-secondary);
  font-size: 11px;
  cursor: pointer;
  outline: none;
  font-weight: 600;
  padding-right: 4px;
}

.channels-page .visibility-quick-select option {
  background: #121212;
  color: white;
}

/* Stats Row and Cards */
.channels-page .channel-stats-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  margin-top: 16px;
  margin-bottom: 24px;
}
@media (max-width: 900px) {
  .channels-page .channel-stats-row {
    grid-template-columns: repeat(2, 1fr);
  }
}
@media (max-width: 500px) {
  .channels-page .channel-stats-row {
    grid-template-columns: 1fr;
  }
}
.channels-page .channel-stats-row .stat-card {
  background: rgba(255, 255, 255, 0.02);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.06);
  padding: 18px;
  border-radius: var(--border-radius-lg);
  display: flex;
  align-items: center;
  gap: 16px;
  transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
  box-shadow: var(--shadow-sm);
}

.channels-page .channel-stats-row .stat-card:hover {
  transform: translateY(-3px);
  background: rgba(255, 255, 255, 0.04);
  border-color: rgba(255, 255, 255, 0.12);
}

/* Individual glowing metrics on hover */
.channels-page .channel-stats-row .stat-card:nth-child(1):hover {
  box-shadow: 0 8px 24px rgba(139, 92, 246, 0.18);
  border-color: rgba(139, 92, 246, 0.3);
}
.channels-page .channel-stats-row .stat-card:nth-child(2):hover {
  box-shadow: 0 8px 24px rgba(16, 185, 129, 0.18);
  border-color: rgba(16, 185, 129, 0.3);
}
.channels-page .channel-stats-row .stat-card:nth-child(3):hover {
  box-shadow: 0 8px 24px rgba(59, 130, 246, 0.18);
  border-color: rgba(59, 130, 246, 0.3);
}
.channels-page .channel-stats-row .stat-card:nth-child(4):hover {
  box-shadow: 0 8px 24px rgba(236, 72, 153, 0.18);
  border-color: rgba(236, 72, 153, 0.3);
}

.channels-page .channel-stats-row .stat-icon {
  background: rgba(139, 92, 246, 0.1);
  border-radius: var(--border-radius-sm);
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--accent-primary);
  flex-shrink: 0;
}
.channels-page .channel-stats-row .stat-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.channels-page .channel-stats-row .stat-value {
  font-family: var(--font-title);
  font-size: 16px;
  font-weight: 800;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.channels-page .channel-stats-row .stat-label {
  font-size: 11px;
  color: var(--text-secondary);
  text-transform: uppercase;
  font-weight: 600;
  letter-spacing: 0.05em;
}

/* Redesigned Target Summary layout and micro-animations */
.channels-page .archive-targets-summary {
  margin-top: 16px;
  margin-bottom: 8px;
  padding: 20px;
  border-radius: var(--border-radius-md);
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.channels-page .summary-title {
  margin-top: 0;
  margin-bottom: 14px;
  font-size: 14px;
  font-weight: 700;
  color: white;
  display: flex;
  align-items: center;
  gap: 8px;
}

.channels-page .summary-grid-layout {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
}

.channels-page .summary-card-item {
  background: rgba(255, 255, 255, 0.01);
  padding: 12px 16px;
  border-radius: var(--border-radius-md);
  border: 1px solid rgba(255, 255, 255, 0.04);
  transition: all 0.25s ease;
}

.channels-page .summary-card-item:hover {
  background: rgba(255, 255, 255, 0.02);
  border-color: rgba(139, 92, 246, 0.15);
  transform: translateY(-1px);
}

.channels-page .summary-card-label {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-secondary);
}

.channels-page .summary-card-content {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  color: white;
}

.channels-page .flex-align-between {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

/* Tabs Bar */
.channels-page .channel-tabs-bar {
  display: flex;
  gap: 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  margin-bottom: 24px;
}

.channels-page .channel-tabs-bar .tab-count {
  background: rgba(255, 255, 255, 0.08);
  padding: 1px 6px;
  border-radius: 10px;
  font-size: 10px;
  font-weight: 700;
}

/* Status badge overlay on thumbnail */
.channels-page .queue-status-badge {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 4;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 4px 8px;
  border-radius: 4px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
}

.channels-page .sync-warning-banner {
  display: flex;
  gap: 16px;
  padding: 16px 20px;
  border-radius: var(--border-radius-md);
  border: 1px solid rgba(234, 179, 8, 0.3);
  background: rgba(234, 179, 8, 0.05);
  align-items: flex-start;
  margin-bottom: 8px;
}
.channels-page .warning-text {
  display: flex;
  flex-direction: column;
}
.channels-page .shorts-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 20px;
}
.channels-page .short-badge {
  position: absolute;
  top: 6px;
  left: 6px;
  background: #ff0000;
  color: white;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 700;
  z-index: 2;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
}
</style>
```

**CSS deleted in this rewrite (confirmed dead — see "Notes on findings" points 3-4 above for the full verification method):** `.loading-state` (+ its `.loading-state .spinner` branch of a shared rule — only the still-live `.videos-loading .spinner` branch survives), `.admin-preferences-panel`, `.pref-section-header`, `.panel-subtitle`, `.sync-actions`, `.sync-btn`, `.start-sync-btn`(+`:hover`), `.pause-sync-btn`(+`:hover`), `.pref-form`, `.pref-checkboxes`, `.check-item-btn`(+ its `input`/`:hover`/`.checked` variants), `.pref-date-picker`, `.date-input-row`, `.date-input`, `.save-pref-btn`, `.videos-empty`, `.status-overlay-badge`, `.batch-actions-bar`, `.selected-count`, `.btn-text`(+`:hover`), `.gold-border`(+`:hover`), `.select-checkbox-wrapper`, `.select-checkbox` (both occurrences), `.queue-list`, `.queue-card` (and all its descendant rules: `-header`, `-header .title-col`/`.video-title`/`.channel-title`/`.status-col`, `-progress-wrapper`, `.progress-container`/`.progress-bar`, `.progress-meta`, `.speed-eta`), `.select-checkbox-overlay`(+`:hover`), `.queue-actions-overlay` (+ its `.video-card:hover .queue-actions-overlay` trigger rule), `.video-card-selected` (+ its `.thumbnail-wrapper` descendant rule), `.queue-progress-container`, `.queue-progress-bar-fill`, `@keyframes progress-shimmer` (byte-identical, still-used copy survives in `app/pages/settings.vue`), `.prioritize-task-btn:hover`, `.cancel-task-btn`(+`:hover`), `.modal-overlay`, `.modal-card`, `.modal-header`(+` h3`), `.close-modal-btn`(+`:hover`), `.modal-body`, `.modal-desc`, `.modal-empty-state`, `.modal-categories-list`, `.modal-check-item`(+`:hover`+its checkbox-input rule), `.check-item-text`, `.check-item-name`, `.check-item-desc`, `.modal-footer`, `.visibility-pill.unlisted`, `.shorts-grid .thumbnail-wrapper` (see point 3). The now-orphaned section-header comments for these clusters (`/* Admin Preferences Panel */`, `/* Checkbox overlay styling */`, `/* Queue List styling */`, `/* Checkbox overlay on thumbnail */`, `/* Admin actions on queue card */`, `/* Selected state card glow and background */`, `/* Modal styling */`) are removed along with them.

- [ ] **Step 2: Build check**

```bash
cd /Users/light/Git/youkeep && npm run build
```
Confirm it ends with `✨ Build complete!` and no errors mentioning `channels.vue` or any of the 6 new `channels/` components.

- [ ] **Step 3: Manual verification against the running dev server**

Start the dev server and sign in via the dev-login fixture (`server/api/dev/login.post.ts`) as an admin user:

```bash
cd /Users/light/Git/youkeep && npm run dev
```

Navigate to `/channels` and verify, in order:

1. **Directory <-> detail view.** The channel grid renders (loading skeletons briefly, then cards or the "No channels archived" empty state). Clicking a channel card navigates to `/channels?channelId=...` and shows the detail view; clicking "All Channels" navigates back to the plain directory grid.
2. **All 3 sub-tabs.** Archived Videos, Shorts, and Playlists tabs all switch correctly via the tab bar, each showing its own content (or its own empty state) and its own live count badge (including the Playlists count, sourced via `channelPlaylistsTabRef`).
3. **Playlists list -> detail -> back.** From the Playlists tab, click a playlist card to see its detail view (with position/status badges on each video), then "Back to playlists" to return to the list.
4. **Search/sort synchronization.** Type into the Archived Videos tab's search box, then switch to the Shorts tab — the same query is still applied (and vice versa). Change the sort dropdown on one tab and confirm the other tab reflects the same sort choice.
5. **Settings drawer.** Click "Tracking options" to open the drawer (from `ChannelDetailHeader`'s emit); confirm the visibility select, the download-preferences form (toggle switches + custom save path + Save), and the delete-channel button all work; close via the drawer's own × button and via clicking the backdrop.
6. **Subscribe/unsubscribe.** Toggle the Subscribe button and confirm the toast and button label update.
7. **Sync pause/resume.** From the header's Pause/Resume Sync button, and (implicitly, via the same underlying handler) from the Archived Videos tab's empty-state "Start initial sync" action on an unsynced channel.
8. **Delete a video and delete a channel.** Use the admin thumbnail-overlay delete icon on a video card, and the settings drawer's "Delete from archive" button; confirm both prompt for confirmation and both succeed.
9. **Confirm the dead polling requests are gone.** Open the browser's network tab while on `/channels?channelId=...` and confirm that `/api/admin/downloader/sync-all-status` and `/api/admin/downloader/queue` (the `checkSyncAllStatus`/`checkDownloaderPausedStatus` polling calls) never fire — only the videos/channel-detail refresh requests should repeat on the polling cadence.

- [ ] **Step 4: Commit**

```bash
cd /Users/light/Git/youkeep && git add app/pages/channels.vue && git commit -m "$(cat <<'EOF'
refactor: reduce channels.vue to page shell after component/composable split

Final step of the channels.vue split (6 components + 3 composables).
The page now only handles directory<->detail routing, the 3-way
sub-tab selector, the settings-drawer open state, and the polling
loop (with the dead sync-all-status/downloader-queue polling calls
removed). The entire style block moves here unscoped, with every
selector qualified under .channels-page (mirroring the settings.vue
split's .settings-container fix), plus two collision-specific
compound-selector fixes for classes this page's own CSS shares with
VideoCard.vue/VideoDropdownMenu.vue (which render inside this page
via <VideoCard>), and deletion of ~72 confirmed-orphaned CSS
selectors left behind by the same removed "Download Queue" tab whose
dead script was removed in this split too.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review Checklist (completed during planning; documented here for the record)

- **Spec coverage:** all 3 composables and 6 components from the approved design spec are present as their own tasks, in the same file paths. The 10-task decomposition suggested for this plan was followed exactly (no tasks merged or split).
- **Placeholder scan:** every task's code block is complete, runnable Vue/TypeScript — no `// ...`, `<!-- similar to above -->`, or `TODO` markers anywhere. The one place genuine repetition exists (the two near-identical `handleToggleSyncStatus`/`handleToggleSync` functions across Tasks 5 and 7) is preserved because the *original* file has them as two separate functions — deduplicating them would be a behavior-neutral-but-out-of-scope refactor, not a placeholder.
- **Type-consistency scan across tasks:** `useChannelDetail()`'s returned shape (`channelId`, `channel`, `singleChannelData`, `refreshSingleChannel`, `videosData`, `videosPending`, `refreshVideos`, `channelVideos`) is destructured identically (only picking the subset each file needs) in the parent and in Tasks 5-9. `useChannelsList()`'s shape (`channelsData`, `channels`, `pending`, `refreshChannels`) is likewise consistent across Tasks 4, 5, 7, 9. `useChannelVideoFilters()`'s shape (`videoSearchQuery`, `sortBy`) is consistent across both `ChannelVideoGrid` instances. The `ChannelDetailHeader` -> parent `open-drawer` emit and the parent -> `ChannelSettingsDrawer` `v-model:show-drawer` binding are declared with matching event/prop names on both sides.
- **CSS-scoping verification:** the full transformed style block (Task 10) was generated mechanically from the original (script-verified brace-balance: 106 open / 106 close braces after all deletions), not hand-transcribed, specifically to avoid the kind of selector-by-selector transcription error that caused the `settings.vue` split's 3 costly review rounds. Every deleted selector was independently verified against the template (and, for two ambiguous cases, against the server-side data model) before deletion; every retained selector was checked against `VideoCard.vue`/`VideoDropdownMenu.vue`/`UiCard.vue`/`UiSkeleton.vue`/`EmptyState.vue` (all components this page renders) for class-name collisions, and the two found (plus one narrower dead-selector case) were fixed with targeted compound/ancestor qualifiers rather than a blanket approach.
