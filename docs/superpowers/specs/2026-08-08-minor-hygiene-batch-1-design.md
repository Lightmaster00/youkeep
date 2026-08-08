# Minor Hygiene Batch 1 — Design

## Context

Fourth sub-project of the ongoing "bug fixes" initiative, continuing the Minor-severity backlog from the project audit. Bundles 3 small, independent, mechanical fixes.

## Scope

1. **`VideoPlayer.vue` listener leak**: `startScrubbing()` adds `document.addEventListener('mousemove', scrubTo)` and `document.addEventListener('mouseup', stopScrubbing)`, only removed inside `stopScrubbing()` itself (fires on `mouseup`). If a user starts dragging the progress bar then navigates away while still holding the mouse button, the component unmounts but these two listeners stay registered on `document` forever, bound to stale closures over now-null refs. The existing `onUnmounted` block already removes 3 other document listeners but not these two.
2. **`channels.vue` setTimeout leak**: `handleSyncPlaylists()` schedules `setTimeout(() => refreshPlaylists(), 5000)` with no handle stored/cleared. If the user navigates away within 5s, it still fires. Lower impact than #1 (a stray fetch call, not a listener pileup), but the same class of hygiene issue, with an established fix pattern already used in this codebase (`watch/[id].vue`'s recently-merged auto-advance timer fix).
3. **`BaseModal.vue` accessibility**: the shared modal component (used by 4 consumers: `MusicAlbumEditModal`, `MusicTrackEditModal`, `playlists/index.vue`, `playlists/[id].vue`) has no `role="dialog"`/`aria-modal`, no Escape-to-close, and no focus management. Fixing it once fixes accessibility for all 4 current consumers.

## Non-Goals

- No full focus trap (Tab/Shift+Tab cycling within the modal) — explicit user choice. Escape-to-close and initial/restored focus only.
- No changes to any modal's own content/layout — only the shared `BaseModal.vue` wrapper.
- No fix for any other Minor-severity backlog item not listed above (concurrency/disk-space guards, large-file splits, duplicated sync logic, Shorts under-detection, CSRF, admin error messages) — those remain in the backlog, not scheduled into this batch.

## Design

### 1. `VideoPlayer.vue`

Add the two missing `removeEventListener` calls to the existing `onUnmounted` block, alongside the 3 already there:

```ts
onUnmounted(() => {
  document.removeEventListener('fullscreenchange', onFullscreenChange);
  document.removeEventListener('click', onDocumentClick);
  document.removeEventListener('mousemove', scrubTo);
  document.removeEventListener('mouseup', stopScrubbing);
  if (process.client) {
    document.removeEventListener('visibilitychange', handleVisibilityChange);
  }
  if (controlsTimeout) clearTimeout(controlsTimeout);
});
```

`removeEventListener` on a listener that was never added (the common case, since scrubbing usually isn't in progress at unmount) is a harmless no-op — no guard needed.

### 2. `channels.vue`

A module-scoped `let syncPlaylistsRefreshTimer: ReturnType<typeof setTimeout> | null = null;` declared near the component's other state. `handleSyncPlaylists()` stores the handle instead of firing a bare `setTimeout`. The existing `onUnmounted` block (currently only clearing `animationFrameId`) gains a clear for this timer too:

```ts
onUnmounted(() => {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
  }
  if (syncPlaylistsRefreshTimer) {
    clearTimeout(syncPlaylistsRefreshTimer);
    syncPlaylistsRefreshTimer = null;
  }
});
```

Since `handleSyncPlaylists` is a one-shot user-triggered action with no natural "state changed" watcher to also hook into (unlike `watch/[id].vue`'s `videoId`), unmount-based cleanup alone is sufficient here — there's no equivalent "force-navigate to the wrong thing" bug to close, just a stray fetch to prevent.

### 3. `BaseModal.vue`

Add real script logic to the currently-empty `<script setup>` block:

- `role="dialog"` and `:aria-modal="show"` on the `.modal-card` element in the template.
- A `keydown` listener on `document`, added when `show` becomes `true` and removed when it becomes `false` or on unmount (via a `watch(() => props.show, ...)` and `onUnmounted`), that emits `close` on `Escape`.
- Focus management via the same `show` watcher: on `true`, capture `document.activeElement` (the triggering element) into a local ref, wait a `nextTick`, then call `.focus()` on the modal card itself (which needs a `tabindex="-1"` added so it's programmatically focusable without being in the normal Tab order). On `false`, restore focus to the captured triggering element if it still exists in the DOM.

This is scoped entirely to `BaseModal.vue` — none of its 4 consumers need any changes, since they all already pass `show`/`title` and listen for `close` the same way.

## Error Handling

- Restoring focus to a captured element that's no longer in the DOM (e.g. the page re-rendered while the modal was open) is guarded with a `document.contains(el)` check before calling `.focus()` — silently skipped if the element is gone, rather than throwing.

## Verification

- All 3 fixes are plain Vue component logic with no automated test infrastructure available in this codebase (confirmed, accepted project-wide gap) — verification is manual for all 3: (1) start a scrub drag on the video progress bar, navigate away mid-drag, confirm no lingering console errors or dangling behavior when moving the mouse afterward; (2) trigger a playlist sync, navigate away within 5s, confirm no stray toast/refresh fires afterward; (3) open each of the 4 BaseModal consumers, confirm Escape closes the modal, confirm focus visibly moves into the modal on open and returns to the triggering button on close.
