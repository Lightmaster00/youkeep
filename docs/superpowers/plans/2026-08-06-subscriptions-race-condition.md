# Subscriptions Page Race Condition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix a race condition in `app/pages/subscriptions.vue` where a stale infinite-scroll response can be appended to the video grid after a filter change has already reset it to a different filter state.

**Architecture:** A single `fetchRequestId` counter guard added to `fetchVideos()`, following the same pattern already used elsewhere in this codebase (`app/pages/music/index.vue`'s `fetchArtists`/`fetchArtistDetail`, `app/components/MusicMiniPlayer.vue`'s `startRadio`).

**Tech Stack:** Nuxt 4, Vue 3 Composition API.

## Global Constraints

- No changes to the infinite-scroll or filter-toggle UX itself — only the race-condition fix.
- No changes to any other page or file — scoped entirely to `fetchVideos()` in `app/pages/subscriptions.vue`.
- This codebase has no Vue component test infrastructure (accepted, project-wide gap) — verification is manual only.

---

### Task 1: Add a `fetchRequestId` guard to `fetchVideos()`

**Files:**
- Modify: `app/pages/subscriptions.vue`

**Interfaces:**
- Produces: nothing consumed elsewhere — this is the only task in the plan.

- [ ] **Step 1: Add the counter declaration**

The script section currently declares state near the top (lines 73-83):

```ts
const channels = ref<any[]>([]);
const videos = ref<any[]>([]);
const page = ref(1);
const inactiveChannelIds = ref<string[]>([]);
const pending = ref(true);
const loadingMore = ref(false);
const hasMore = ref(true);
const loadMoreTrigger = ref<HTMLElement | null>(null);

let observer: IntersectionObserver | null = null;
```

Add a new counter variable right after `observer`:

```ts
const channels = ref<any[]>([]);
const videos = ref<any[]>([]);
const page = ref(1);
const inactiveChannelIds = ref<string[]>([]);
const pending = ref(true);
const loadingMore = ref(false);
const hasMore = ref(true);
const loadMoreTrigger = ref<HTMLElement | null>(null);

let observer: IntersectionObserver | null = null;
let fetchRequestId = 0;
```

- [ ] **Step 2: Guard `fetchVideos()`**

The function currently reads (lines 95-131):

```ts
// Fetch videos
const fetchVideos = async (isLoadMore = false) => {
  if (isLoadMore) {
    loadingMore.value = true;
  } else {
    pending.value = true;
    videos.value = [];
    page.value = 1;
    hasMore.value = true;
  }

  try {
    const res = await $fetch<any>('/api/videos', {
      params: {
        page: page.value,
        limit: 16,
        subscribed: 'true',
        excludeChannels: inactiveChannelIds.value.length > 0 ? inactiveChannelIds.value.join(',') : undefined,
        status: 'completed'
      }
    });

    if (isLoadMore) {
      videos.value.push(...res.videos);
    } else {
      videos.value = res.videos;
    }
    
    if (page.value >= res.pagination.totalPages) {
      hasMore.value = false;
    }
  } catch (err) {
    console.error(err);
  } finally {
    pending.value = false;
    loadingMore.value = false;
  }
};
```

Replace it with:

```ts
// Fetch videos
const fetchVideos = async (isLoadMore = false) => {
  const requestId = ++fetchRequestId;

  if (isLoadMore) {
    loadingMore.value = true;
  } else {
    pending.value = true;
    videos.value = [];
    page.value = 1;
    hasMore.value = true;
  }

  try {
    const res = await $fetch<any>('/api/videos', {
      params: {
        page: page.value,
        limit: 16,
        subscribed: 'true',
        excludeChannels: inactiveChannelIds.value.length > 0 ? inactiveChannelIds.value.join(',') : undefined,
        status: 'completed'
      }
    });

    if (requestId !== fetchRequestId) return;

    if (isLoadMore) {
      videos.value.push(...res.videos);
    } else {
      videos.value = res.videos;
    }
    
    if (page.value >= res.pagination.totalPages) {
      hasMore.value = false;
    }
  } catch (err) {
    if (requestId !== fetchRequestId) return;
    console.error(err);
  } finally {
    if (requestId === fetchRequestId) {
      pending.value = false;
      loadingMore.value = false;
    }
  }
};
```

Notes on this shape:
- `requestId` is captured immediately, before the synchronous reset block (`pending.value = true`, etc.) — this matters because the reset block itself is what a newer, still-in-flight call's stale sibling must not be allowed to clobber later, so the counter must already reflect "this is now the latest call" before any state is touched.
- The `requestId !== fetchRequestId` check inside `catch` prevents a stale request's network/parse error from being logged as if it were the current request's error (harmless today since it's just a `console.error`, but consistent with treating a stale response — success or failure — as fully discarded).
- The `finally` block's loading-state resets (`pending.value = false`, `loadingMore.value = false`) are now also guarded: a stale request's `finally` must not clear the *newer* request's loading indicator while that newer request is still in flight. The newer request's own `finally` will correctly clear the indicator when it completes.

- [ ] **Step 3: Manual verification in the dev server**

No automated test infrastructure exists for Vue components in this codebase. Verify visually instead:

1. Start the dev server (`npm run dev`) and ensure you have enough subscribed-channel videos to trigger infinite scroll (at least 17, so a second page exists) across at least 2 different subscribed channels.
2. Navigate to `/subscriptions`.
3. Scroll down to trigger a load-more fetch for page 2 (watch the network tab or the small spinner to confirm it's in flight).
4. Before that fetch resolves, immediately click a channel pill to toggle a filter.
5. Confirm the video grid ends up showing only videos matching the new filter state — no videos from the old (pre-toggle) filter state appear mixed in, and no duplicate/stale videos are appended after the filter change.
6. Confirm normal behavior still works when there's no race: a plain scroll-to-load-more without any interruption still appends the next page correctly, and a plain filter toggle without any scroll in flight still resets and loads correctly.
7. Confirm no stray console errors appear during either scenario.

Report what you observed.

- [ ] **Step 4: Commit**

```bash
git add app/pages/subscriptions.vue
git commit -m "fix: guard fetchVideos against stale infinite-scroll/filter-change races"
```
