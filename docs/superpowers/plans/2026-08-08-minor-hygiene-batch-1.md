# Minor Hygiene Batch 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 3 independent, small Minor-severity hygiene issues from the project audit backlog: a listener leak in the video player, a timer leak in the channels page, and missing accessibility affordances in the shared modal component.

**Architecture:** Three fully independent, single-file changes with no shared interfaces. Each is its own task.

**Tech Stack:** Nuxt 4, Vue 3 Composition API.

## Global Constraints

- No full focus trap (Tab/Shift+Tab cycling within the modal) — Escape-to-close and initial/restored focus only.
- No changes to any of `BaseModal.vue`'s 4 consumers (`MusicAlbumEditModal.vue`, `MusicTrackEditModal.vue`, `app/pages/playlists/index.vue`, `app/pages/playlists/[id].vue`) — the fix is entirely contained in the shared component.
- No other Minor-severity backlog items in scope (concurrency/disk-space guards, large-file splits, duplicated sync logic, Shorts under-detection, CSRF, admin error messages).
- This codebase has no Vue component test infrastructure (accepted, project-wide gap) — verification is manual only, for all 3 tasks.

---

### Task 1: Clean up scrubbing listeners on unmount in `VideoPlayer.vue`

**Files:**
- Modify: `app/components/VideoPlayer.vue`

**Interfaces:**
- Produces: nothing consumed by later tasks — fully independent.

- [ ] **Step 1: Add the two missing `removeEventListener` calls**

The existing `onUnmounted` block currently reads (lines 631-638):

```ts
onUnmounted(() => {
  document.removeEventListener('fullscreenchange', onFullscreenChange);
  document.removeEventListener('click', onDocumentClick);
  if (process.client) {
    document.removeEventListener('visibilitychange', handleVisibilityChange);
  }
  if (controlsTimeout) clearTimeout(controlsTimeout);
});
```

Add the two scrubbing listener removals:

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

- [ ] **Step 2: Manual verification**

No automated test infrastructure exists for Vue components in this codebase. Verify visually instead:

1. Start the dev server (`npm run dev`) and open a video.
2. Click-and-hold on the progress bar to start scrubbing (don't release the mouse button).
3. While still holding the mouse button down, click a link that navigates away from the video (e.g. a recommended video, or the back button — use a mouse click that doesn't require releasing the held button first, such as a middle-click-open-in-new-tab if needed, or simply release over a link and immediately click it).
4. After navigating, move the mouse around the new page and confirm no errors appear in the console and nothing unexpected happens (no phantom scrubbing behavior, no errors referencing the old player's refs).
5. As a regression check, confirm normal scrubbing (click, drag, release on the same page) still works exactly as before.

Report what you observed.

- [ ] **Step 3: Commit**

```bash
git add app/components/VideoPlayer.vue
git commit -m "fix: clean up scrubbing listeners on VideoPlayer unmount"
```

---

### Task 2: Clean up the playlist-sync refresh timer in `channels.vue`

**Files:**
- Modify: `app/pages/channels.vue`

**Interfaces:**
- Produces: nothing consumed by later tasks — fully independent.

- [ ] **Step 1: Declare the timer variable**

Add a module-scoped timer variable near the component's other `let`/state declarations (place it directly above `handleSyncPlaylists` for locality, matching the pattern already used for the recently-fixed `watch/[id].vue` timer):

```ts
let syncPlaylistsRefreshTimer: ReturnType<typeof setTimeout> | null = null;
```

- [ ] **Step 2: Store the timer handle in `handleSyncPlaylists()`**

The function currently reads (lines 1183-1198):

```ts
async function handleSyncPlaylists() {
  if (!channelId.value) return;
  syncingPlaylists.value = true;
  try {
    const res = await $fetch<any>(`/api/admin/channels/${channelId.value}/sync-playlists`, {
      method: 'POST'
    });
    toast.success(res.message || 'Playlist sync started.');
    // The sync runs in the background on the server; give it a moment before refreshing.
    setTimeout(() => refreshPlaylists(), 5000);
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Failed to start playlist sync.');
  } finally {
    syncingPlaylists.value = false;
  }
}
```

Change it to store the handle:

```ts
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
```

- [ ] **Step 3: Clear the timer on unmount**

The existing `onUnmounted` block currently reads (lines 936-940):

```ts
onUnmounted(() => {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
  }
});
```

Add the new clear:

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

Do not create a new `onUnmounted` block — this is the existing one already handling unrelated cleanup (`animationFrameId`) in this file.

- [ ] **Step 4: Manual verification**

No automated test infrastructure exists for Vue components in this codebase. Verify visually instead:

1. Start the dev server (`npm run dev`) and open a channel's detail page.
2. Trigger "Sync Playlists".
3. Within 5 seconds, navigate away from the channel page (e.g. go to a different channel or a different page entirely).
4. Confirm no stray toast/refresh/console error fires after the 5-second mark on the page you navigated to.
5. As a regression check, trigger "Sync Playlists" again and this time stay on the page for the full 5 seconds — confirm the playlists still refresh as before.

Report what you observed.

- [ ] **Step 5: Commit**

```bash
git add app/pages/channels.vue
git commit -m "fix: clear playlist-sync refresh timer on channels page unmount"
```

---

### Task 3: Add accessibility affordances to `BaseModal.vue`

**Files:**
- Modify: `app/components/BaseModal.vue`

**Interfaces:**
- Produces: nothing consumed by later tasks — fully independent. No changes required in any of the 4 consumer files (`MusicAlbumEditModal.vue`, `MusicTrackEditModal.vue`, `app/pages/playlists/index.vue`, `app/pages/playlists/[id].vue`) — they already pass `show`/`title` props and listen for the `close` event, and this task doesn't change that contract.

- [ ] **Step 1: Replace the full file**

The file currently reads in full (28 lines):

```vue
<template>
  <div v-if="show" class="modal-overlay" @click="$emit('close')">
    <div class="modal-card glass-panel animate-pop" @click.stop>
      <div class="modal-header">
        <h3>{{ title }}</h3>
        <button class="close-modal-btn" @click="$emit('close')">&times;</button>
      </div>
      <div class="modal-body">
        <slot></slot>
      </div>
      <div v-if="$slots.footer" class="modal-footer">
        <slot name="footer"></slot>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  show: boolean;
  title: string;
}>();

defineEmits<{
  (e: 'close'): void;
}>();
</script>
```

Replace it with:

```vue
<template>
  <div v-if="show" class="modal-overlay" @click="$emit('close')">
    <div
      ref="modalCardEl"
      class="modal-card glass-panel animate-pop"
      role="dialog"
      :aria-modal="show"
      tabindex="-1"
      @click.stop
    >
      <div class="modal-header">
        <h3>{{ title }}</h3>
        <button class="close-modal-btn" @click="$emit('close')">&times;</button>
      </div>
      <div class="modal-body">
        <slot></slot>
      </div>
      <div v-if="$slots.footer" class="modal-footer">
        <slot name="footer"></slot>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, onUnmounted } from 'vue';

const props = defineProps<{
  show: boolean;
  title: string;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const modalCardEl = ref<HTMLElement | null>(null);
let previouslyFocusedEl: HTMLElement | null = null;

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    emit('close');
  }
}

watch(() => props.show, (isShown) => {
  if (isShown) {
    previouslyFocusedEl = document.activeElement as HTMLElement | null;
    document.addEventListener('keydown', onKeydown);
    nextTick(() => {
      modalCardEl.value?.focus();
    });
  } else {
    document.removeEventListener('keydown', onKeydown);
    if (previouslyFocusedEl && document.contains(previouslyFocusedEl)) {
      previouslyFocusedEl.focus();
    }
    previouslyFocusedEl = null;
  }
});

onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown);
});
</script>
```

Notes on this shape:
- `tabindex="-1"` on `.modal-card` makes it programmatically focusable (via `.focus()`) without adding it to the normal Tab order — the standard pattern for "focus the dialog container itself" when there's no specific first field to focus.
- The `watch(() => props.show, ...)` callback handles both directions (open and close) in one place, matching how `show` is the single source of truth this component already uses for its `v-if`.
- `document.contains(previouslyFocusedEl)` guards against restoring focus to an element that was removed from the DOM while the modal was open (e.g. the underlying page re-rendered) — silently skipped rather than throwing.
- The `keydown` listener is added/removed alongside `show` changes (not just once at `onMounted`), so it's only ever active while a modal is actually shown — consistent with not wanting a global Escape handler active when no modal from this component is open. `onUnmounted` is still added as a defense-in-depth cleanup for the edge case where the component unmounts while `show` is `true` (the listener would otherwise leak, since the `watch` callback's `else` branch never runs to remove it).

- [ ] **Step 2: Manual verification**

No automated test infrastructure exists for Vue components in this codebase. Verify visually instead, across all 4 consumers if practical (at minimum, verify 2 of them — one from each: a modal used in a page, e.g. `playlists/index.vue`'s create-playlist modal, and one from an edit-modal component, e.g. `MusicTrackEditModal.vue`):

1. Start the dev server (`npm run dev`).
2. Open a modal that uses `BaseModal` (e.g. create a playlist from `/playlists`).
3. Confirm focus visibly moves into the modal when it opens (e.g. a focus ring appears on the modal card, or use browser dev tools to confirm `document.activeElement` is inside `.modal-card`).
4. Press Escape. Confirm the modal closes.
5. Confirm focus returns to the button that originally opened the modal.
6. Repeat for at least one more `BaseModal` consumer (e.g. `MusicTrackEditModal.vue`, reached from an admin music track's edit action) to confirm the fix generalizes across consumers with no per-consumer changes needed.
7. Confirm clicking the existing close button (`&times;`) and clicking the overlay background still close the modal as before (regression check — these paths are unchanged by this task).

Report what you observed.

- [ ] **Step 3: Commit**

```bash
git add app/components/BaseModal.vue
git commit -m "feat: add Escape-to-close and focus management to BaseModal"
```
