# Subscriptions Page Race Condition — Design

## Context

Second item of the ongoing "bug fixes" initiative, sourced from a full-project audit. `app/pages/subscriptions.vue`'s `fetchVideos(isLoadMore)` is called from three places — the initial `onMounted` load, an `IntersectionObserver`-driven infinite-scroll callback, and a `watch(inactiveChannelIds, ...)` deep watcher that fires on any channel-filter pill toggle — with no guard against overlapping requests.

Confirmed failure: a user scrolls to trigger a load-more fetch for page 2 under the current filter state, then toggles a channel pill before that fetch resolves. The filter watcher resets `videos.value = []` and `page.value = 1` and starts a fresh fetch for the new filter state. When the stale page-2 response for the *old* filter state later resolves, `isLoadMore` was `true` for that call, so it does `videos.value.push(...res.videos)`, appending old-filter videos onto what should be a new-filter-only list.

This is the same class of bug already fixed multiple times elsewhere in this codebase this session (`fetchArtists`/`fetchArtistDetail`/`playArtistMix` in `app/pages/music/index.vue`, `startRadio` in `app/components/MusicMiniPlayer.vue`), always with a request-id counter guard. Confirmed by reading the full current file: all three call sites go through the single `fetchVideos` function, which only writes to this component's own local refs (`videos`, `page`, `hasMore`) — unlike `startRadio`, which additionally needed a track-identity check because it wrote to shared external player state, `fetchVideos` has no such external state to protect, so a plain counter guard is sufficient.

## Scope

- Add a request-id counter guard to `fetchVideos()` in `app/pages/subscriptions.vue`, following the exact pattern already established elsewhere in this codebase.

## Non-Goals

- No changes to the infinite-scroll or filter-toggle UX itself — only the race-condition fix.
- No changes to any other page — this fix is scoped to `subscriptions.vue`'s own `fetchVideos` function.

## Design

A module-level `let fetchRequestId = 0;` declared alongside the component's other refs. At the very start of `fetchVideos(isLoadMore)`, before any of its existing setup logic (the `isLoadMore ? loadingMore : pending/videos/page/hasMore` reset block), increment the counter and capture it locally: `const requestId = ++fetchRequestId;`. After the `await $fetch(...)` call resolves (inside the `try` block, before touching `videos.value`/`page.value`/`hasMore.value`), check `if (requestId !== fetchRequestId) return;` — if a newer `fetchVideos` call has started in the meantime, discard this stale response instead of applying it.

The existing `finally` block (`pending.value = false; loadingMore.value = false;`) needs the same guard — a stale response's `finally` should not clear the *new* request's loading indicators. Move the guard check to also cover the `finally` block, or equivalently, guard the whole result-application logic (including the loading-state resets) behind the `requestId` check.

## Error Handling

- The existing `catch (err) { console.error(err); }` is unaffected — a stale request's error is simply logged and ignored, consistent with how a stale request's success response is now also ignored.

## Verification

- This codebase has zero Vue component test infrastructure (confirmed, accepted project-wide gap for this entire session) — verified manually in the running dev server instead: trigger a load-more scroll, then toggle a filter pill before it resolves, and confirm the video grid only ever shows videos matching the current filter state, never a mix of both.
