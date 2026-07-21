# UI Redesign Round 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure global navigation into an icon rail, refine the violet/pink palette so it reads as one coherent identity instead of an accent pasted on a neutral background, redesign `VideoCard` (layout + a hover video preview), and rebuild the homepage around a featured "bento" block plus content-discovery rows (recently added, popular, personalized suggestions, subscribed channels) with no duplicate content and correct anonymous-vs-logged-in behavior.

**Architecture:** Four independent-but-sequenced layers: (1) CSS token changes that propagate through the existing design-token system with no component edits, (2) a nav layout change scoped to `default.vue`, (3) a `VideoCard.vue` redesign in two steps (layout, then the new hover-preview interaction), (4) a new backend endpoint (`GET /api/home/feed`) that assembles the homepage's featured block and rows server-side (so "no duplicate content" is enforced in one place, not juggled across client-side fetches), consumed by a rewritten `index.vue`.

**Tech Stack:** Nuxt 4 / Vue 3 `<script setup lang="ts">`, Nitro (h3) server routes, better-sqlite3, Vitest for backend logic tests, manual browser verification for UI (no automated UI test suite exists in this project).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-21-ui-redesign-round2-design.md` — every task implements a section of this spec; read it before starting any task.
- No idle/ambient animation anywhere ("D2 — Calme" signature style from the previous round): elements are neutral at rest, motion/glow only on hover or user interaction. The new background wash (Task 1) must be static — no `@keyframes`, no scroll-linked motion.
- No automated UI test suite exists. `npm test` (23 tests as of this plan) covers only rate-limiting and access-control logic — it is a safety net for backend logic tasks, not a substitute for browser verification on any frontend task.
- Every frontend task ends with a manual browser verification step. Every backend task ends with `npm test` passing, including new tests written for that task.
- Video card hover preview only ever plays one preview at a time across the whole page (Task 4) — this is a hard functional requirement, not a nice-to-have.
- The homepage's search-mode branch (`v-else-if="searchQuery"` in `index.vue`) is explicitly out of scope — no task in this plan touches it.

---

### Task 1: Palette Refinement

**Files:**
- Modify: `app/assets/css/main.css:5-27` (color tokens), `app/assets/css/main.css:81-88` (`body` rule)

**Interfaces:**
- Produces: updated values for `--bg-base`, `--bg-surface`, `--bg-surface-hover`, `--bg-surface-active`, `--bg-elevated-1`, `--bg-elevated-2`, `--border-color`, `--text-secondary` — every later task and every existing component that consumes these tokens picks up the new look automatically, no other file changes.

- [ ] **Step 1: Update the color tokens**

In `app/assets/css/main.css`, replace the color-token block (currently lines 5-27):

```css
  --bg-base: #0c0a12; /* Near-black with a faint violet undertone, not gray */
  --bg-surface: rgba(28, 24, 38, 0.65); /* Violet-tinted glass, was neutral gray */
  --bg-surface-hover: rgba(38, 32, 50, 0.85);
  --bg-surface-active: rgba(50, 42, 64, 0.92);

  --bg-elevated-1: rgba(36, 30, 48, 0.75);
  --bg-elevated-2: rgba(46, 38, 60, 0.85);

  --accent-primary: #8b5cf6; /* Futuristic violet/purple */
  --accent-primary-hover: #a78bfa;
  --accent-primary-glow: rgba(139, 92, 246, 0.4);

  --accent-secondary: #ec4899; /* Vibrant cosmic pink */
  --accent-secondary-hover: #f472b6;
  --accent-secondary-glow: rgba(236, 72, 153, 0.4);


  --text-primary: #f8fafc;
  --text-secondary: #a5a3b8;
  --text-muted: #6e6b82;

  --border-color: rgba(167, 139, 250, 0.12);
  --border-color-glow: rgba(139, 92, 246, 0.25);
```

Only `--bg-base`, `--bg-surface`, `--bg-surface-hover`, `--bg-surface-active`, `--bg-elevated-1`, `--bg-elevated-2`, `--text-secondary`, `--text-muted`, and `--border-color` change values. `--accent-primary`, `--accent-primary-hover`, `--accent-primary-glow`, `--accent-secondary`, `--accent-secondary-hover`, `--accent-secondary-glow`, `--text-primary`, `--border-color-glow` are unchanged — copy them through as-is so the block stays contiguous.

- [ ] **Step 2: Add the static background wash**

In `app/assets/css/main.css`, replace the `body` rule (currently lines 81-88):

```css
body {
  background-color: var(--bg-base);
  background-image:
    radial-gradient(ellipse 120% 80% at 30% -10%, rgba(139, 92, 246, 0.12), transparent),
    radial-gradient(ellipse 100% 60% at 100% 100%, rgba(236, 72, 153, 0.06), transparent);
  background-repeat: no-repeat;
  color: var(--text-primary);
  font-family: var(--font-body);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  touch-action: manipulation;
}
```

No `@keyframes`, no `animation`, no `transition` on this rule — it must never move.

- [ ] **Step 3: Verify in the browser**

Run `npm run dev`, open any page. Expected: background is a near-black with a very subtle violet glow in the upper-left and a faint pink glow in the lower-right, both static (no movement on scroll or over time); cards, buttons, badges, and the video player all still render — their glass surfaces should look tinted (slightly violet), not neutral gray, and text should not look washed out or low-contrast against the new background. Compare against the git diff of `main.css` to confirm nothing outside the two edited blocks changed.

- [ ] **Step 4: Run the test suite**

Run: `npm test`
Expected: 23 passed (23) — this task touches no logic under test, so this is a regression check, not new coverage.

- [ ] **Step 5: Commit**

```bash
git add app/assets/css/main.css
git commit -m "style: refine palette to a violet-tinted base with a static background wash"
```

---

### Task 2: Global Navigation — Icon Rail

**Files:**
- Modify: `app/layouts/default.vue` (template lines 65-93, style lines 443-527)

**Interfaces:**
- Produces: no new props/exports — this is a self-contained presentational change to the layout every page renders inside.

- [ ] **Step 1: Wrap the sidebar nav in an inner positioning element**

In `app/layouts/default.vue`, replace the `<aside class="sidebar">...</aside>` block (currently lines 65-93):

```html
      <!-- Sidebar Navigation -->
      <aside class="sidebar">
        <div class="sidebar-inner">
          <nav class="sidebar-nav">
            <NuxtLink v-if="!user?.mustChangePassword" to="/" class="sidebar-link" active-class="active">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
              <span>Home</span>
            </NuxtLink>

            <NuxtLink v-if="!user?.mustChangePassword" to="/shorts" class="sidebar-link" active-class="active">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect><line x1="12" y1="18" x2="12.01" y2="18"></line></svg>
              <span>Shorts</span>
            </NuxtLink>

            <NuxtLink v-if="!user?.mustChangePassword" to="/channels" class="sidebar-link" active-class="active">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.33z"></path><polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02"></polygon></svg>
              <span>Channels</span>
            </NuxtLink>

            <NuxtLink v-if="!user?.mustChangePassword" to="/subscriptions" class="sidebar-link" active-class="active">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>
              <span>Subscriptions</span>
            </NuxtLink>

            <NuxtLink v-if="!user?.mustChangePassword" to="/playlists" class="sidebar-link" active-class="active">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
              <span>Playlists</span>
            </NuxtLink>
          </nav>
        </div>
      </aside>
```

This is the exact same five links, unchanged routes/icons/labels/guards — only the wrapping `<div class="sidebar-inner">` is new.

- [ ] **Step 2: Replace the sidebar CSS with the overlay-expand version**

In `app/layouts/default.vue`, replace the `.sidebar` through `.sidebar-link.active svg` rules (currently lines 443-487):

```css
.sidebar {
  width: var(--sidebar-collapsed-width);
  flex-shrink: 0;
  position: relative;
}

.sidebar-inner {
  position: absolute;
  top: 0;
  left: 0;
  width: var(--sidebar-collapsed-width);
  height: 100%;
  border-right: 1px solid rgba(255, 255, 255, 0.03);
  padding: 20px 12px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: width var(--duration-base) var(--ease-standard), background-color var(--duration-base) var(--ease-standard), box-shadow var(--duration-base) var(--ease-standard);
  z-index: 50;
}

.sidebar-inner:hover {
  width: var(--sidebar-width);
  overflow-y: auto;
  background-color: rgba(28, 24, 38, 0.96);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
}

.sidebar-nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.sidebar-link {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 16px;
  border-radius: var(--border-radius-md);
  font-size: 14.5px;
  font-weight: 500;
  color: var(--text-secondary);
  transition: all 0.2s cubic-bezier(0.25, 0.8, 0.25, 1);
  margin-bottom: 2px;
  white-space: nowrap;
}

.sidebar-link svg {
  flex-shrink: 0;
}

.sidebar-link span {
  opacity: 0;
  transition: opacity 0.15s ease;
}

.sidebar-inner:hover .sidebar-link span {
  opacity: 1;
}

.sidebar-link:hover {
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-primary);
  transform: translateX(4px);
}

.sidebar-link.active {
  background: rgba(255, 255, 255, 0.1);
  color: white;
  font-weight: 600;
}

.sidebar-link.active svg {
  color: white;
}
```

`.sidebar` keeps a fixed collapsed-width footprint in the flex layout at all times (so `.content-area` never resizes), while `.sidebar-inner` is absolutely positioned inside it and grows to `--sidebar-width` only visually, on hover — this is what makes the expansion an overlay instead of a reflow.

- [ ] **Step 3: Update the mobile media query**

In `app/layouts/default.vue`, inside the existing `@media (max-width: 768px)` block, replace:

```css
  .sidebar {
    width: var(--sidebar-collapsed-width);
  }
  .sidebar-link span, .sidebar-divider-title {
    display: none;
  }
```

with:

```css
  .sidebar-inner:hover {
    width: var(--sidebar-collapsed-width);
    background-color: transparent;
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
    box-shadow: none;
  }
  .sidebar-link span, .sidebar-divider-title {
    display: none;
  }
```

This cancels the hover-expand below 768px (touch devices don't have a meaningful hover state, and the rail should stay icon-only there, matching the previous fixed mobile behavior) while leaving the rest of the mobile rules (icon-only link layout, active-state bottom border) untouched.

- [ ] **Step 4: Verify in the browser**

Run `npm run dev`. On desktop width: confirm the rail sits at its collapsed width with icons only, and hovering anywhere over it smoothly expands it to show labels as an overlay — watch that `.content-area`'s content does **not** shift or reflow while this happens (open devtools, confirm `.sidebar`'s box stays the same width in the layout while `.sidebar-inner` grows on top of the content). Confirm the active-page highlight, hover background, and `translateX(4px)` nudge on individual links still work inside the expanded state. Resize below 768px and confirm the rail stays icon-only with no hover-expand and the existing bottom-border active indicator still shows.

- [ ] **Step 5: Run the test suite**

Run: `npm test`
Expected: 23 passed (23).

- [ ] **Step 6: Commit**

```bash
git add app/layouts/default.vue
git commit -m "feat: turn sidebar into a permanent icon rail with hover-expand overlay"
```

---

### Task 3: VideoCard Layout Redesign

**Files:**
- Modify: `app/components/VideoCard.vue`

**Interfaces:**
- Consumes: `props.video` (unchanged shape), `props.showChannelInfo` (unchanged).
- Produces: no prop/emit changes — purely template/style, so every existing consumer (`index.vue`, `channels.vue`, `playlists/[id].vue`) keeps working unmodified.

- [ ] **Step 1: Restructure the template**

In `app/components/VideoCard.vue`, replace the `<!-- Video Details -->` block (currently lines 18-38):

```html
    <!-- Video Details -->
    <div class="video-info">
      <h4 class="video-title" :title="video.title">{{ video.title }}</h4>
      <div v-if="showChannelInfo" class="channel-row">
        <img
          :src="video.channel_avatar || fallbackAvatar"
          @error="handleAvatarError"
          class="channel-avatar"
          alt="Avatar"
          referrerpolicy="no-referrer"
        />
        <div class="channel-meta">
          <p class="channel-title">{{ video.channel_title }}</p>
          <div class="metadata-row">
            <span>{{ formattedViews }} views</span>
            <span class="dot">•</span>
            <span>{{ formattedUploadDate }}</span>
          </div>
        </div>
      </div>
      <div v-else class="metadata-row metadata-row-standalone">
        <span>{{ formattedViews }} views</span>
        <span class="dot">•</span>
        <span>{{ formattedUploadDate }}</span>
      </div>
    </div>
```

(`showChannelInfo="false"` consumers — the per-channel rows on `channels.vue` and `index.vue`'s channel groupings — get the metadata row on its own line under the title, same information as before, just without an avatar since there's nothing to show one for.)

- [ ] **Step 2: Replace the info-section styles**

In `app/components/VideoCard.vue`, replace from `/* ===== Info Section ===== */` through the end of the `<style>` block (currently lines 193-255):

```css
/* ===== Info Section ===== */
.video-info {
  display: flex;
  flex-direction: column;
  padding: 12px 2px 4px 2px;
}

.video-title {
  font-size: 14.5px;
  line-height: 1.35;
  font-weight: 600;
  color: white;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
  margin: 0 0 9px 0;
}

.channel-row {
  display: flex;
  align-items: center;
  gap: 9px;
}

.channel-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  object-fit: cover;
  background: rgba(255, 255, 255, 0.05);
  flex-shrink: 0;
}

.channel-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.channel-title {
  font-size: 13px;
  color: #c4b5fd;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin: 0;
  transition: color var(--duration-base) var(--ease-standard);
}

.video-card:hover .channel-title {
  color: #e9d5ff;
}

.metadata-row {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #8a87a0;
  transition: color var(--duration-base) var(--ease-standard);
}

.video-card:hover .metadata-row {
  color: #a5a3b8;
}

.metadata-row-standalone {
  margin-top: 1px;
}

.dot {
  font-weight: 700;
}
```

- [ ] **Step 3: Verify in the browser**

Run `npm run dev`, open the home page and a channel page. Expected: every card shows the title first (up to 2 lines), then a 32px avatar next to the channel name and `views · date` on the next line (not beside the title anymore); cards rendered with `show-channel-info="false"` (channel-grouped rows) show just the metadata line under the title, no avatar. Confirm channel name brightens on card hover and hover-glow (from `UiCard`) still works.

- [ ] **Step 4: Run the test suite**

Run: `npm test`
Expected: 23 passed (23).

- [ ] **Step 5: Commit**

```bash
git add app/components/VideoCard.vue
git commit -m "style: redesign VideoCard layout — avatar aligned with channel/metadata, not the title"
```

---

### Task 4: VideoCard Hover Video Preview

**Files:**
- Create: `app/composables/useVideoPreview.ts`
- Modify: `app/components/VideoCard.vue`

**Interfaces:**
- Produces (`useVideoPreview.ts`): `useVideoPreview(): { activePreviewId: Ref<string | null> }` — a module-scope singleton ref shared by every `VideoCard` instance, so setting it in one card automatically deactivates any other card's preview.
- Consumes: `props.video.local_video_path`, `props.video.duration` (both already on the existing `video` prop shape).

- [ ] **Step 1: Create the shared preview-coordinator composable**

Create `app/composables/useVideoPreview.ts`:

```ts
import { ref } from 'vue';

// Module-scope (not inside the exported function) so every import shares
// the same ref — this is what makes "only one card previews at a time"
// work without prop drilling or an event bus.
const activePreviewId = ref<string | null>(null);

export function useVideoPreview() {
  return { activePreviewId };
}
```

- [ ] **Step 2: Add preview state and lifecycle to VideoCard's script**

In `app/components/VideoCard.vue`, in the `<script setup>` block, add after the existing imports and before `const props = ...`:

```ts
import { computed, onUnmounted, ref, watch } from 'vue';
import { useVideoPreview } from '~/composables/useVideoPreview';
```

(Replace the existing `import { computed } from 'vue';` line with this one — `onUnmounted`, `ref`, and `watch` are newly needed.)

After the existing `defineEmits<...>()` block, add:

```ts
const HOVER_DELAY_MS = 550;
const PREVIEW_START_RATIO = 0.10;
const PREVIEW_END_RATIO = 0.40;

const { activePreviewId } = useVideoPreview();
const isPreviewActive = computed(() => activePreviewId.value === props.video.id);
const previewVideoEl = ref<HTMLVideoElement | null>(null);
const previewProgressPercent = ref(0);
let hoverTimer: ReturnType<typeof setTimeout> | null = null;

const handleCardMouseEnter = () => {
  if (!props.video.local_video_path || !props.video.duration) return;
  hoverTimer = setTimeout(() => {
    activePreviewId.value = props.video.id;
  }, HOVER_DELAY_MS);
};

const handleCardMouseLeave = () => {
  if (hoverTimer) {
    clearTimeout(hoverTimer);
    hoverTimer = null;
  }
  if (activePreviewId.value === props.video.id) {
    activePreviewId.value = null;
  }
};

const handlePreviewTimeUpdate = () => {
  const el = previewVideoEl.value;
  const duration = props.video.duration;
  if (!el || !duration) return;
  const startTime = duration * PREVIEW_START_RATIO;
  const endTime = duration * PREVIEW_END_RATIO;
  if (el.currentTime >= endTime) {
    el.currentTime = startTime;
  }
  previewProgressPercent.value = ((el.currentTime - startTime) / (endTime - startTime)) * 100;
};

watch(isPreviewActive, (active) => {
  if (!active) {
    previewProgressPercent.value = 0;
    return;
  }
  const duration = props.video.duration;
  requestAnimationFrame(() => {
    const el = previewVideoEl.value;
    if (!el || !duration) return;
    el.currentTime = duration * PREVIEW_START_RATIO;
    el.play().catch(() => {
      // Autoplay can be blocked in some contexts even when muted; failing
      // silently just means the thumbnail stays static, which is a safe
      // fallback rather than a broken UI.
    });
  });
});

onUnmounted(() => {
  if (hoverTimer) clearTimeout(hoverTimer);
  if (activePreviewId.value === props.video.id) {
    activePreviewId.value = null;
  }
});
```

- [ ] **Step 3: Wire the mouse events and add the preview elements to the template**

In `app/components/VideoCard.vue`, change the root `<UiCard>` tag (currently line 2) from:

```html
  <UiCard class="video-card" :style="{ cursor: clickable ? 'pointer' : 'default' }" @click="playVideo">
```

to:

```html
  <UiCard
    class="video-card"
    :style="{ cursor: clickable ? 'pointer' : 'default' }"
    @click="playVideo"
    @mouseenter="handleCardMouseEnter"
    @mouseleave="handleCardMouseLeave"
  >
```

Inside `<div class="thumbnail-wrapper">`, immediately after the existing `<img class="thumbnail-img" ... />` element, add:

```html
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
```

(This sits above the existing `<span class="duration-badge">` in source order but the CSS in Step 4 positions everything independently, so order among the absolutely-positioned overlay elements doesn't matter — only that they're all inside `.thumbnail-wrapper`.)

- [ ] **Step 4: Add the preview element styles**

In `app/components/VideoCard.vue`, inside the `<style scoped>` block, add after the existing `.thumbnail-wrapper::after` rule:

```css
.thumbnail-preview-video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  z-index: 1;
}

.preview-badge {
  position: absolute;
  top: 8px;
  left: 8px;
  background: rgba(0, 0, 0, 0.75);
  color: white;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  z-index: 3;
}

.preview-progress {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: rgba(255, 255, 255, 0.15);
  z-index: 3;
}

.preview-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--accent-primary), var(--accent-secondary));
}
```

`.thumbnail-preview-video` is `position: absolute; inset: 0` so it covers the existing `<img>` in place without changing the wrapper's layout; the `<img>` stays mounted underneath (not `v-if`'d away) so there's no layout flash when the preview starts or ends — it just becomes covered or uncovered.

- [ ] **Step 5: Verify in the browser**

Run `npm run dev`, open the home page (needs at least one downloaded video with a real `local_video_path` and known `duration`). Hover a card and hold for just under 550ms, then move away — confirm no preview starts (timer was cancelled). Hover and hold past 550ms — confirm the thumbnail is replaced by a looping muted preview starting around 10% into the video, with the "APERÇU" badge and a progress bar filling and resetting as it loops between the 10%–40% window. While one card is previewing, hover a second card past the delay — confirm the first card's preview stops and reverts to its static thumbnail before the second starts (only one `<video>` element should exist in the DOM at a time — check via devtools Elements panel). Move the mouse quickly across many cards in a row without stopping — confirm no preview ever starts and no stray `<video>` elements accumulate in the DOM. Navigate away from the page mid-preview and confirm no console errors from an orphaned timer or video element.

- [ ] **Step 6: Run the test suite**

Run: `npm test`
Expected: 23 passed (23).

- [ ] **Step 7: Commit**

```bash
git add app/composables/useVideoPreview.ts app/components/VideoCard.vue
git commit -m "feat: add hover video preview to VideoCard"
```

---

### Task 5: Generalize Recommendation Logic + Extend Test Helpers

**Files:**
- Create: `server/utils/recommend.ts`
- Modify: `server/api/videos/recommend.get.ts`
- Modify: `tests/helpers/testDb.ts`
- Test: `tests/unit/recommend.test.ts`

**Interfaces:**
- Produces: `getRecommendedVideos(db: Database.Database, userId: string, opts: { type: 'short' | 'video' | 'all'; limit: number }): RecommendedVideo[]` — Task 6 (`GET /api/home/feed`) calls this with `{ type: 'all', limit: N }` for the "Suggéré pour toi" section and the bento's suggestion slot.
- `RecommendedVideo` fields: `id, title, description, duration, view_count, local_video_path, local_thumbnail_path, is_short, channel_id, upload_date, channel_title, channel_avatar`.

- [ ] **Step 1: Extend the test database helper**

In `tests/helpers/testDb.ts`, add the missing columns to the `videos` table and two new tables, plus their insert helpers. Replace the `videos` table definition inside `createTestDb()`:

```sql
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

and add, after the `user_channel_access` table definition, still inside the same `db.exec(...)` template string:

```sql

    CREATE TABLE user_history (
      user_id TEXT NOT NULL,
      video_id TEXT NOT NULL,
      watched_at INTEGER NOT NULL,
      watch_time_seconds INTEGER DEFAULT 0,
      PRIMARY KEY (user_id, video_id)
    );

    CREATE TABLE user_hidden_videos (
      user_id TEXT NOT NULL,
      video_id TEXT NOT NULL,
      hidden_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, video_id)
    );

    CREATE TABLE user_subscriptions (
      user_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, channel_id)
    );
```

Update `insertVideo` to accept the new optional fields:

```ts
export function insertVideo(db: Database.Database, opts: {
  id: string;
  channelId: string;
  visibility?: string;
  shareToken?: string | null;
  downloadStatus?: string;
  uploadDate?: string | null;
  duration?: number | null;
  viewCount?: number;
  isShort?: boolean;
  localVideoPath?: string | null;
  localThumbnailPath?: string | null;
  createdAt?: number;
}) {
  db.prepare(`
    INSERT INTO videos (id, title, channel_id, visibility, share_token, download_status, upload_date, duration, view_count, is_short, local_video_path, local_thumbnail_path, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    opts.id,
    `Video ${opts.id}`,
    opts.channelId,
    opts.visibility ?? 'public',
    opts.shareToken ?? null,
    opts.downloadStatus ?? 'completed',
    opts.uploadDate ?? null,
    opts.duration ?? null,
    opts.viewCount ?? 0,
    opts.isShort ? 1 : 0,
    opts.localVideoPath ?? null,
    opts.localThumbnailPath ?? null,
    opts.createdAt ?? Date.now()
  );
}
```

This changes `insertVideo`'s signature (new optional fields only — every existing call site in `access-control.test.ts` passes a subset of these as before and keeps working since all new fields are optional).

Add three new helpers at the end of the file:

```ts
export function insertUserHistory(db: Database.Database, opts: { userId: string; videoId: string; watchTimeSeconds?: number; watchedAt?: number }) {
  db.prepare(`
    INSERT INTO user_history (user_id, video_id, watched_at, watch_time_seconds)
    VALUES (?, ?, ?, ?)
  `).run(opts.userId, opts.videoId, opts.watchedAt ?? Date.now(), opts.watchTimeSeconds ?? 0);
}

export function insertHiddenVideo(db: Database.Database, opts: { userId: string; videoId: string }) {
  db.prepare(`
    INSERT INTO user_hidden_videos (user_id, video_id, hidden_at)
    VALUES (?, ?, ?)
  `).run(opts.userId, opts.videoId, Date.now());
}

export function insertSubscription(db: Database.Database, opts: { userId: string; channelId: string }) {
  db.prepare(`
    INSERT INTO user_subscriptions (user_id, channel_id, created_at)
    VALUES (?, ?, ?)
  `).run(opts.userId, opts.channelId, Date.now());
}
```

- [ ] **Step 2: Run the existing test suite to confirm the helper change didn't break anything**

Run: `npm test`
Expected: 23 passed (23) — `access-control.test.ts` uses `insertVideo` with only `id`/`channelId`/`visibility`/`shareToken`, all still valid with the new optional-field signature.

- [ ] **Step 3: Write the failing test for `getRecommendedVideos`**

Create `tests/unit/recommend.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { getRecommendedVideos } from '../../server/utils/recommend';
import { createTestDb, insertChannel, insertVideo, insertUserHistory, insertHiddenVideo } from '../helpers/testDb';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
});

describe('getRecommendedVideos', () => {
  it('filters by type: short returns only is_short videos', () => {
    insertChannel(db, { id: 'c1' });
    insertVideo(db, { id: 'v1', channelId: 'c1', isShort: true, uploadDate: '20260101' });
    insertVideo(db, { id: 'v2', channelId: 'c1', isShort: false, uploadDate: '20260101' });
    const results = getRecommendedVideos(db, 'u1', { type: 'short', limit: 15 });
    expect(results.map(v => v.id)).toEqual(['v1']);
  });

  it('filters by type: video returns only long-form videos', () => {
    insertChannel(db, { id: 'c1' });
    insertVideo(db, { id: 'v1', channelId: 'c1', isShort: true, uploadDate: '20260101' });
    insertVideo(db, { id: 'v2', channelId: 'c1', isShort: false, uploadDate: '20260101' });
    const results = getRecommendedVideos(db, 'u1', { type: 'video', limit: 15 });
    expect(results.map(v => v.id)).toEqual(['v2']);
  });

  it('type: all returns both shorts and long-form videos', () => {
    insertChannel(db, { id: 'c1' });
    insertVideo(db, { id: 'v1', channelId: 'c1', isShort: true, uploadDate: '20260101' });
    insertVideo(db, { id: 'v2', channelId: 'c1', isShort: false, uploadDate: '20260101' });
    const results = getRecommendedVideos(db, 'u1', { type: 'all', limit: 15 });
    expect(results.map(v => v.id).sort()).toEqual(['v1', 'v2']);
  });

  it('excludes hidden videos', () => {
    insertChannel(db, { id: 'c1' });
    insertVideo(db, { id: 'v1', channelId: 'c1', isShort: false, uploadDate: '20260101' });
    insertHiddenVideo(db, { userId: 'u1', videoId: 'v1' });
    const results = getRecommendedVideos(db, 'u1', { type: 'video', limit: 15 });
    expect(results).toHaveLength(0);
  });

  it('excludes videos not in completed status', () => {
    insertChannel(db, { id: 'c1' });
    insertVideo(db, { id: 'v1', channelId: 'c1', isShort: false, downloadStatus: 'downloading', uploadDate: '20260101' });
    const results = getRecommendedVideos(db, 'u1', { type: 'video', limit: 15 });
    expect(results).toHaveLength(0);
  });

  it('respects the limit', () => {
    insertChannel(db, { id: 'c1' });
    for (let i = 0; i < 5; i++) {
      insertVideo(db, { id: `v${i}`, channelId: 'c1', isShort: false, uploadDate: '20260101' });
    }
    const results = getRecommendedVideos(db, 'u1', { type: 'video', limit: 3 });
    expect(results).toHaveLength(3);
  });

  it('ranks a video from a heavily-watched channel above one from an unwatched channel', () => {
    insertChannel(db, { id: 'c1' });
    insertChannel(db, { id: 'c2' });
    insertVideo(db, { id: 'v1', channelId: 'c1', isShort: false, uploadDate: '20260101' });
    insertVideo(db, { id: 'v2', channelId: 'c2', isShort: false, uploadDate: '20260101' });
    // Heavy watch history on c1 dwarfs the +/-20% random factor applied to scores.
    insertUserHistory(db, { userId: 'u1', videoId: 'v1', watchTimeSeconds: 100000 });
    const results = getRecommendedVideos(db, 'u1', { type: 'video', limit: 15 });
    expect(results[0].id).toBe('v1');
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npx vitest run tests/unit/recommend.test.ts`
Expected: FAIL — `Cannot find module '../../server/utils/recommend'`.

- [ ] **Step 5: Create the shared recommendation util**

Create `server/utils/recommend.ts`:

```ts
import type Database from 'better-sqlite3';

export interface RecommendedVideo {
  id: string;
  title: string;
  description: string | null;
  duration: number | null;
  view_count: number | null;
  local_video_path: string | null;
  local_thumbnail_path: string | null;
  is_short: number;
  channel_id: string;
  upload_date: string | null;
  channel_title: string;
  channel_avatar: string | null;
}

const CANDIDATE_POOL_SIZE = 500;

export function getRecommendedVideos(
  db: Database.Database,
  userId: string,
  opts: { type: 'short' | 'video' | 'all'; limit: number }
): RecommendedVideo[] {
  // 1. Get user channel watch times
  const channelTimes = db.prepare(`
    SELECT v.channel_id, SUM(uh.watch_time_seconds) as total_time
    FROM user_history uh
    JOIN videos v ON uh.video_id = v.id
    WHERE uh.user_id = ?
    GROUP BY v.channel_id
  `).all(userId) as { channel_id: string; total_time: number }[];

  const channelWeights = new Map<string, number>();
  for (const row of channelTimes) {
    channelWeights.set(row.channel_id, row.total_time);
  }

  // 2. Get user watch time per video to penalize already watched videos
  const watchedVideos = db.prepare(`
    SELECT video_id, watch_time_seconds
    FROM user_history
    WHERE user_id = ?
  `).all(userId) as { video_id: string; watch_time_seconds: number }[];

  const watchedTimeMap = new Map<string, number>();
  for (const row of watchedVideos) {
    watchedTimeMap.set(row.video_id, row.watch_time_seconds);
  }

  // 3. Get a bounded pool of completed videos with channel info to score.
  const isShortClause = opts.type === 'short' ? 'AND v.is_short = 1' : opts.type === 'video' ? 'AND v.is_short = 0' : '';
  const candidates = db.prepare(`
    SELECT v.id, v.title, v.description, v.duration, v.view_count, v.local_video_path, v.local_thumbnail_path, v.is_short, v.channel_id, v.upload_date,
           c.title as channel_title, c.avatar_url as channel_avatar
    FROM videos v
    JOIN channels c ON v.channel_id = c.id
    WHERE v.download_status = 'completed' ${isShortClause}
      AND v.id NOT IN (SELECT video_id FROM user_hidden_videos WHERE user_id = ?)
      AND (
        (v.visibility IN ('public', 'private') AND c.visibility IN ('public', 'private'))
        OR
        v.channel_id IN (SELECT channel_id FROM user_channel_access WHERE user_id = ?)
      )
    ORDER BY v.upload_date DESC
    LIMIT ?
  `).all(userId, userId, CANDIDATE_POOL_SIZE) as RecommendedVideo[];

  if (candidates.length === 0) {
    return [];
  }

  // 4. Calculate score for each candidate
  const scoredCandidates = candidates.map((video) => {
    let score = 10; // Base score (minimum weight)

    const weight = channelWeights.get(video.channel_id) || 0;
    score += weight;

    const watchedTime = watchedTimeMap.get(video.id) || 0;
    if (watchedTime > 0) {
      if (video.duration && watchedTime >= video.duration - 10) {
        score *= 0.05;
      } else {
        score *= 0.5;
      }
    }

    score *= (0.8 + Math.random() * 0.4);

    return { video, score };
  });

  scoredCandidates.sort((a, b) => b.score - a.score);

  return scoredCandidates.slice(0, opts.limit).map(c => c.video);
}
```

This is a straight extraction of `recommend.get.ts`'s existing logic (Steps 1-4, byte-for-byte the same scoring math), with `v.is_short = 1` replaced by the parameterized `isShortClause` and the hardcoded `.slice(0, 15)` replaced by `opts.limit`.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run tests/unit/recommend.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 7: Update `recommend.get.ts` to use the shared util**

Replace `server/api/videos/recommend.get.ts` entirely:

```ts
import { defineEventHandler, createError } from 'h3';
import { getRecommendedVideos } from '../../utils/recommend';

export default defineEventHandler(async (event) => {
  const session = await getUserFromSession(event);
  if (!session) {
    throw createError({ statusCode: 401, statusMessage: 'Non autorisé.' });
  }

  const db = getDb();
  const videos = getRecommendedVideos(db, session.id, { type: 'short', limit: 15 });
  return { videos };
});
```

This preserves the exact existing behavior for the Shorts page (`is_short = 1`, top 15) — it's now a two-line wrapper around the shared util instead of owning the algorithm.

- [ ] **Step 8: Run the full test suite**

Run: `npm test`
Expected: 30 passed (30) — the existing 23 plus the 7 new `recommend.test.ts` tests.

- [ ] **Step 9: Manually verify the Shorts page is unaffected**

Run `npm run dev`, log in, open `/shorts`. Expected: recommendations still load exactly as before (this endpoint's behavior didn't change, only its implementation moved).

- [ ] **Step 10: Commit**

```bash
git add server/utils/recommend.ts server/api/videos/recommend.get.ts tests/helpers/testDb.ts tests/unit/recommend.test.ts
git commit -m "refactor: extract recommendation scoring into a reusable, type-generalized util"
```

---

### Task 6: Homepage Feed Endpoint

**Files:**
- Create: `server/api/home/feed.get.ts`
- Test: `tests/integration/home-feed.test.ts`

**Interfaces:**
- Consumes: `getRecommendedVideos` from `server/utils/recommend.ts` (Task 5).
- Produces: `GET /api/home/feed` response shape:
  ```ts
  {
    featured: {
      large: FeedVideo | null;
      small: FeedVideo[]; // 0-4 items
    };
    sections: Array<
      | { id: 'recent' | 'popular' | 'suggested'; title: string; videos: FeedVideo[] }
      | { id: 'subscriptions'; title: string; channels: Array<{ channelId: string; channelTitle: string; channelAvatar: string | null; videos: FeedVideo[] }> }
    >;
  }
  ```
  where `FeedVideo` has the fields: `id, title, duration, view_count, upload_date, created_at, local_video_path, local_thumbnail_path, channel_id, channel_title, channel_avatar` — this is the exact shape Task 7/8's `index.vue` consumes and the exact shape `VideoCard`'s `video` prop expects (a superset of what it reads).
- `suggested` and `subscriptions` are omitted from `sections` entirely when there's no session — Task 7/8 render whatever sections array they're given, with no client-side knowledge of why a section might be missing.

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/home-feed.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import handler from '../../server/api/home/feed.get';
import {
  createTestDb,
  insertUser,
  insertSession,
  insertChannel,
  insertVideo,
  insertUserHistory,
  insertSubscription,
  mockEvent,
  sessionCookie
} from '../helpers/testDb';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
});

function loginAs(userId: string) {
  insertUser(db, { id: userId, role: 'user' });
  const sessionId = `sess-${userId}`;
  insertSession(db, { id: sessionId, userId });
  return mockEvent(sessionCookie(sessionId));
}

const guestEvent = () => mockEvent();

describe('GET /api/home/feed', () => {
  it('omits suggested and subscriptions sections for a guest', async () => {
    insertChannel(db, { id: 'c1' });
    insertVideo(db, { id: 'v1', channelId: 'c1', uploadDate: '20260101' });
    const result: any = await handler(guestEvent());
    const sectionIds = result.sections.map((s: any) => s.id);
    expect(sectionIds).not.toContain('suggested');
    expect(sectionIds).not.toContain('subscriptions');
  });

  it('includes suggested and subscriptions sections for a logged-in user with data', async () => {
    insertChannel(db, { id: 'c1' });
    insertChannel(db, { id: 'c2' });
    insertVideo(db, { id: 'v1', channelId: 'c1', uploadDate: '20260101' });
    insertVideo(db, { id: 'v2', channelId: 'c2', uploadDate: '20260101' });
    insertVideo(db, { id: 'v3', channelId: 'c2', uploadDate: '20260102' });
    const event = loginAs('u1');
    insertSubscription(db, { userId: 'u1', channelId: 'c2' });
    const result: any = await handler(event);
    const sectionIds = result.sections.map((s: any) => s.id);
    expect(sectionIds).toContain('suggested');
    expect(sectionIds).toContain('subscriptions');
  });

  it('never shows the same video in both the featured block and a section', async () => {
    insertChannel(db, { id: 'c1' });
    for (let i = 0; i < 10; i++) {
      insertVideo(db, { id: `v${i}`, channelId: 'c1', uploadDate: '20260101', viewCount: 100 - i, createdAt: Date.now() - i * 1000 });
    }
    const result: any = await handler(guestEvent());
    const featuredIds = new Set([
      ...(result.featured.large ? [result.featured.large.id] : []),
      ...result.featured.small.map((v: any) => v.id)
    ]);
    for (const section of result.sections) {
      if (section.videos) {
        for (const v of section.videos) {
          expect(featuredIds.has(v.id)).toBe(false);
        }
      }
    }
  });

  it('excludes a subscribed channel row entirely if the user has fewer than 2 visible videos left from it after exclusion', async () => {
    insertChannel(db, { id: 'c1' });
    insertVideo(db, { id: 'v1', channelId: 'c1', uploadDate: '20260101', viewCount: 1000 });
    const event = loginAs('u1');
    insertSubscription(db, { userId: 'u1', channelId: 'c1' });
    const result: any = await handler(event);
    const subsSection = result.sections.find((s: any) => s.id === 'subscriptions');
    // c1's only video is very likely to be the featured "large" pick (highest view_count),
    // leaving 0 videos for its subscription row, so the row should not appear.
    if (subsSection) {
      expect(subsSection.channels.find((c: any) => c.channelId === 'c1')).toBeUndefined();
    }
  });

  it('orders the popular section by local viewers first, view_count as tiebreaker', async () => {
    insertChannel(db, { id: 'c1' });
    insertVideo(db, { id: 'v1', channelId: 'c1', uploadDate: '20260101', viewCount: 1000000 });
    insertVideo(db, { id: 'v2', channelId: 'c1', uploadDate: '20260101', viewCount: 10 });
    insertUser(db, { id: 'watcher', role: 'user' });
    insertUserHistory(db, { userId: 'watcher', videoId: 'v2' });
    const result: any = await handler(guestEvent());
    // v2 has a local viewer and no session data was requested by guests, but local
    // popularity is a property of the video, not the requester, so it still ranks first.
    const allPopular = [
      ...(result.featured.large ? [result.featured.large] : []),
      ...result.featured.small,
      ...(result.sections.find((s: any) => s.id === 'popular')?.videos ?? [])
    ];
    const v1Index = allPopular.findIndex((v: any) => v.id === 'v1');
    const v2Index = allPopular.findIndex((v: any) => v.id === 'v2');
    expect(v2Index).toBeLessThan(v1Index);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/integration/home-feed.test.ts`
Expected: FAIL — `Cannot find module '../../server/api/home/feed.get'`.

- [ ] **Step 3: Implement the endpoint**

Create `server/api/home/feed.get.ts`:

```ts
import { defineEventHandler } from 'h3';
import { getRecommendedVideos } from '../../utils/recommend';
import type { UserSession } from '../../utils/auth';

interface FeedVideo {
  id: string;
  title: string;
  duration: number | null;
  view_count: number | null;
  upload_date: string | null;
  created_at?: number; // present on pool-sourced videos (recent/popular/subscriptions), absent on suggestion-sourced ones — not read by any consumer, so this is safe
  local_video_path: string | null;
  local_thumbnail_path: string | null;
  channel_id: string;
  channel_title: string;
  channel_avatar: string | null;
}

function getVisibilityFilter(session: UserSession | null): { sql: string; params: any[] } {
  if (!session) {
    return { sql: "v.visibility = 'public' AND c.visibility = 'public'", params: [] };
  }
  if (session.role === 'admin') {
    return { sql: '1=1', params: [] };
  }
  return {
    sql: `(
      (v.visibility IN ('public', 'private') AND c.visibility IN ('public', 'private'))
      OR v.channel_id IN (SELECT channel_id FROM user_channel_access WHERE user_id = ?)
    )`,
    params: [session.id]
  };
}

function getHiddenFilter(session: UserSession | null): { sql: string; params: any[] } {
  if (!session) return { sql: '', params: [] };
  return { sql: 'AND v.id NOT IN (SELECT video_id FROM user_hidden_videos WHERE user_id = ?)', params: [session.id] };
}

const FEED_VIDEO_COLUMNS = `
  v.id, v.title, v.duration, v.view_count, v.upload_date, v.created_at,
  v.local_video_path, v.local_thumbnail_path, v.channel_id,
  c.title as channel_title, c.avatar_url as channel_avatar
`;

export default defineEventHandler(async (event) => {
  const session = await getUserFromSession(event);
  const db = getDb();
  const visibility = getVisibilityFilter(session);
  const hidden = getHiddenFilter(session);

  const popularPool = db.prepare(`
    SELECT ${FEED_VIDEO_COLUMNS},
           (SELECT COUNT(DISTINCT user_id) FROM user_history WHERE video_id = v.id) as local_viewers
    FROM videos v
    JOIN channels c ON v.channel_id = c.id
    WHERE v.download_status = 'completed'
      AND ${visibility.sql}
      ${hidden.sql}
    ORDER BY local_viewers DESC, v.view_count DESC
    LIMIT 30
  `).all(...visibility.params, ...hidden.params) as (FeedVideo & { local_viewers: number })[];

  const recentPool = db.prepare(`
    SELECT ${FEED_VIDEO_COLUMNS}
    FROM videos v
    JOIN channels c ON v.channel_id = c.id
    WHERE v.download_status = 'completed'
      AND ${visibility.sql}
      ${hidden.sql}
    ORDER BY v.created_at DESC
    LIMIT 30
  `).all(...visibility.params, ...hidden.params) as FeedVideo[];

  const usedIds = new Set<string>();

  // --- Featured block ---
  const large = popularPool[0] ?? null;
  if (large) usedIds.add(large.id);

  const small: FeedVideo[] = [];
  if (session) {
    const suggestions = getRecommendedVideos(db, session.id, { type: 'all', limit: 10 }) as unknown as FeedVideo[];
    const suggestion = suggestions.find(v => !usedIds.has(v.id));
    if (suggestion) {
      small.push(suggestion);
      usedIds.add(suggestion.id);
    }
  }
  for (const v of recentPool) {
    if (small.length >= 4) break;
    if (usedIds.has(v.id)) continue;
    small.push(v);
    usedIds.add(v.id);
  }

  // --- Sections ---
  const sections: any[] = [];

  const recentSection = recentPool.filter(v => !usedIds.has(v.id)).slice(0, 15);
  if (recentSection.length > 0) {
    sections.push({ id: 'recent', title: 'Ajoutés récemment', videos: recentSection });
  }

  const popularSection = popularPool.filter(v => !usedIds.has(v.id)).slice(0, 15);
  if (popularSection.length > 0) {
    sections.push({ id: 'popular', title: 'Populaires', videos: popularSection });
  }

  if (session) {
    const suggestions = getRecommendedVideos(db, session.id, { type: 'all', limit: 20 }) as unknown as FeedVideo[];
    const suggestedSection = suggestions.filter(v => !usedIds.has(v.id)).slice(0, 15);
    if (suggestedSection.length > 0) {
      sections.push({ id: 'suggested', title: 'Suggéré pour toi', videos: suggestedSection });
    }

    const subChannels = db.prepare(`
      SELECT c.id, c.title, c.avatar_url
      FROM channels c
      JOIN user_subscriptions us ON us.channel_id = c.id
      WHERE us.user_id = ?
      ORDER BY us.created_at DESC
    `).all(session.id) as { id: string; title: string; avatar_url: string | null }[];

    const subscriptionChannels: any[] = [];
    for (const ch of subChannels) {
      if (subscriptionChannels.length >= 8) break;
      const chVideos = db.prepare(`
        SELECT ${FEED_VIDEO_COLUMNS}
        FROM videos v
        JOIN channels c ON v.channel_id = c.id
        WHERE v.channel_id = ?
          AND v.download_status = 'completed'
          AND ${visibility.sql}
          ${hidden.sql}
        ORDER BY v.created_at DESC
        LIMIT 20
      `).all(ch.id, ...visibility.params, ...hidden.params) as FeedVideo[];
      const filtered = chVideos.filter(v => !usedIds.has(v.id));
      if (filtered.length >= 2) {
        subscriptionChannels.push({
          channelId: ch.id,
          channelTitle: ch.title,
          channelAvatar: ch.avatar_url,
          videos: filtered.slice(0, 12)
        });
      }
    }

    if (subscriptionChannels.length > 0) {
      sections.push({ id: 'subscriptions', title: 'Par chaîne suivie', channels: subscriptionChannels });
    }
  }

  return {
    featured: { large, small },
    sections
  };
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/integration/home-feed.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: 35 passed (35).

- [ ] **Step 6: Manually verify against the real database**

Run `npm run dev`. In a browser tab (or via `curl`), hit `http://localhost:3000/api/home/feed` while logged out, then again after logging in as an existing user. Expected: logged-out response has no `suggested` or `subscriptions` entries in `sections`; logged-in response includes them (assuming the account has watch history and/or subscriptions); no video ID appears in more than one place across the whole response.

- [ ] **Step 7: Commit**

```bash
git add server/api/home/feed.get.ts tests/integration/home-feed.test.ts
git commit -m "feat: add GET /api/home/feed with featured-block exclusion and anonymous-safe sections"
```

---

### Task 7: Homepage — Featured Bento Block

**Files:**
- Modify: `app/pages/index.vue`

**Interfaces:**
- Consumes: `GET /api/home/feed`'s `featured: { large: FeedVideo | null; small: FeedVideo[] }` (Task 6).

- [ ] **Step 1: Replace the data-fetching and computed logic**

In `app/pages/index.vue`, replace the feed-fetching block (currently lines 152-213, from `// Fetch for home feed...` through the end of `channelGroups`) with:

```ts
// Fetch for home feed (featured block + discovery rows)
const { data: homeFeedData, pending: homeFeedPending } = await useFetch<{
  featured: { large: any; small: any[] };
  sections: any[];
}>('/api/home/feed', {
  immediate: !searchQuery.value
});

watch(homeFeedData, () => { loading.value = false; }, { immediate: true });

const featuredLarge = computed(() => homeFeedData.value?.featured?.large ?? null);
const featuredSmall = computed(() => homeFeedData.value?.featured?.small ?? []);
const feedSections = computed(() => homeFeedData.value?.sections ?? []);
```

This replaces `feedData`/`feedPending`/`heroVideo`/`recentVideos`/`channelGroups`. Leave `computeData` and its `watch([searchData, feedData, searchQuery], ...)` as they are for the search branch — but change `feedData.value?.videos` inside `computeData` to only run for the search path (it already only reads `feedData` in the `else` branch, which is no longer used since `allVideos` for the non-search feed is replaced by `featuredLarge`/`featuredSmall`/`feedSections`; Task 9 removes the now-dead `else` branch of `computeData` and the `feedData`/`feedPending` fetch's home-feed usage entirely — for this task, leave `computeData`'s structure in place and only add the new fetch/computeds above it, since Task 9 is where the old fields get cleaned up once the template no longer references them).

- [ ] **Step 2: Replace the hero banner markup with the bento block**

In `app/pages/index.vue`, replace the `<!-- Hero Banner -->` block (currently lines 63-91):

```html
      <!-- Featured Bento Block -->
      <div v-if="featuredLarge" class="featured-bento">
        <div class="featured-large" @click="navigateTo(`/watch/${featuredLarge.id}`)">
          <div class="hero-backdrop">
            <img :src="featuredLarge.local_thumbnail_path || `https://i.ytimg.com/vi/${featuredLarge.id}/maxresdefault.jpg`" @error="handleHeroError" class="hero-bg-img" alt="" />
            <div class="hero-gradient-left"></div>
            <div class="hero-gradient-bottom"></div>
          </div>
          <div class="hero-content">
            <div class="hero-channel-badge">
              <img :src="featuredLarge.channel_avatar || fallbackAvatar" @error="handleAvatarError" class="hero-channel-img" alt="" />
              <span>{{ featuredLarge.channel_title }}</span>
            </div>
            <h1 class="hero-title">{{ featuredLarge.title }}</h1>
            <div class="hero-meta">
              <span>{{ formatViews(featuredLarge.view_count) }} views</span>
              <span class="meta-dot">•</span>
              <span>{{ formatUploadDate(featuredLarge.upload_date) }}</span>
              <span class="meta-dot">•</span>
              <span>{{ formatDuration(featuredLarge.duration) }}</span>
            </div>
            <div class="hero-actions">
              <button class="hero-play-btn" @click.stop="navigateTo(`/watch/${featuredLarge.id}`)">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                Play
              </button>
            </div>
          </div>
        </div>
        <div v-for="video in featuredSmall" :key="video.id" class="featured-small">
          <VideoCard :video="video" />
        </div>
      </div>
```

(The old `.hero-desc` paragraph is dropped — `FeedVideo` doesn't carry a `description` field, since Task 6's endpoint doesn't select `v.description` for feed rows. This is intentional: the bento's large tile is one cell in a grid now, not a full-width banner, and has less room for body text than the old hero did.)

- [ ] **Step 3: Update the bento CSS**

In `app/pages/index.vue`, replace the `/* ===== Hero Banner ===== */` block through `.hero-play-btn:hover` (currently lines 292-420) with:

```css
/* ===== Featured Bento Block ===== */
.featured-bento {
  display: grid;
  grid-template-columns: 2fr 1fr 1fr;
  grid-template-rows: repeat(2, 1fr);
  gap: 16px;
  margin-bottom: 32px;
  height: 420px;
}

.featured-large {
  grid-row: span 2;
  position: relative;
  border-radius: var(--border-radius-lg);
  overflow: hidden;
  cursor: pointer;
}

.hero-backdrop {
  position: absolute;
  inset: 0;
}

.hero-bg-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  filter: brightness(0.55);
  transition: transform 8s ease, filter 0.5s ease;
}

.featured-large:hover .hero-bg-img {
  transform: scale(1.03);
  filter: brightness(0.45);
}

.hero-gradient-left {
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, rgba(10, 10, 15, 0.95) 0%, rgba(10, 10, 15, 0.6) 40%, transparent 70%);
}

.hero-gradient-bottom {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 160px;
  background: linear-gradient(to top, var(--bg-base) 0%, transparent 100%);
}

.hero-content {
  position: absolute;
  bottom: 32px;
  left: 32px;
  max-width: 90%;
  z-index: 2;
}

.hero-channel-badge {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  font-size: 13px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.8);
}

.hero-channel-img {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  object-fit: cover;
}

.hero-title {
  font-size: 26px;
  font-weight: 800;
  color: white;
  line-height: 1.2;
  margin: 0 0 12px 0;
  letter-spacing: -0.02em;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.hero-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.5);
  margin-bottom: 18px;
}

.meta-dot { font-weight: 700; }

.hero-actions {
  display: flex;
  gap: 12px;
}

.hero-play-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 28px;
  background: white;
  color: #0c0a12;
  border: none;
  border-radius: 6px;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s ease;
}

.hero-play-btn:hover {
  background: rgba(255, 255, 255, 0.85);
  transform: scale(1.03);
}

.featured-small {
  min-height: 0;
  overflow: hidden;
}

@media (max-width: 900px) {
  .featured-bento {
    grid-template-columns: 1fr 1fr;
    grid-template-rows: 240px repeat(2, auto);
    height: auto;
  }
  .featured-large {
    grid-row: 1;
    grid-column: 1 / -1;
    height: 240px;
  }
  .hero-content { left: 24px; bottom: 24px; }
  .hero-title { font-size: 20px; }
}

@media (max-width: 640px) {
  .featured-bento {
    grid-template-columns: 1fr;
  }
  .featured-large { height: 220px; }
}
```

- [ ] **Step 4: Verify in the browser**

Run `npm run dev`, open `/` both logged out and logged in. Expected: a bento block replaces the old full-width hero — one large tile on the left spanning the full height, up to four smaller `VideoCard`s filling the right side in a 2x2-ish arrangement; clicking the large tile or its Play button navigates to `/watch/<id>`; the small tiles behave like any other `VideoCard` (click to watch, hover glow, hover preview from Task 4). Resize to under 900px and confirm the layout collapses to a stacked, still-usable arrangement with no overlapping text. If a `VideoCard` doesn't fit its bento cell cleanly (thumbnail or text clipped awkwardly), adjust `.featured-small`'s sizing here — this is expected fine-tuning, not a sign the approach is wrong.

- [ ] **Step 5: Run the test suite**

Run: `npm test`
Expected: 35 passed (35).

- [ ] **Step 6: Commit**

```bash
git add app/pages/index.vue
git commit -m "feat: replace homepage hero banner with a featured bento block"
```

---

### Task 8: Homepage — Content Discovery Rows

**Files:**
- Modify: `app/pages/index.vue`

**Interfaces:**
- Consumes: `feedSections` (Task 7's computed, backed by `GET /api/home/feed`'s `sections` array).

- [ ] **Step 1: Replace the recently-added and channel-group rows with section-driven rows**

In `app/pages/index.vue`, replace the `<!-- Recently Added Row -->` and `<!-- Channel Rows -->` blocks (currently lines 93-118):

```html
      <!-- Content Discovery Rows -->
      <template v-for="section in feedSections" :key="section.id">
        <div v-if="section.videos" class="content-row">
          <h3 class="row-title">{{ section.title }}</h3>
          <div class="scroll-row">
            <div class="scroll-track">
              <div v-for="video in section.videos" :key="video.id" class="scroll-card">
                <VideoCard :video="video" @hidden="onVideoHidden" />
              </div>
            </div>
          </div>
        </div>

        <template v-else-if="section.channels">
          <div v-for="channelRow in section.channels" :key="channelRow.channelId" class="content-row">
            <div class="row-header">
              <h3 class="row-title">{{ channelRow.channelTitle }}</h3>
              <NuxtLink :to="`/channels?id=${channelRow.channelId}`" class="see-all-link">See all →</NuxtLink>
            </div>
            <div class="scroll-row">
              <div class="scroll-track">
                <div v-for="video in channelRow.videos" :key="video.id" class="scroll-card">
                  <VideoCard :video="video" :show-channel-info="false" @hidden="onVideoHidden" />
                </div>
              </div>
            </div>
          </div>
        </template>
      </template>
```

`section.videos` (present on `recent`/`popular`/`suggested`) renders one row with `section.title` as the heading; `section.channels` (present only on the `subscriptions` section) renders one row per subscribed channel, matching the previous channel-grouped-rows presentation exactly (title = channel name, "See all →" link, `show-channel-info="false"` since the row heading already names the channel).

- [ ] **Step 2: Update `onVideoHidden` for the new data shape**

In `app/pages/index.vue`, replace the `onVideoHidden` function (currently lines 234-236):

```ts
const onVideoHidden = (id: string) => {
  if (homeFeedData.value) {
    homeFeedData.value.featured.small = homeFeedData.value.featured.small.filter((v: any) => v.id !== id);
    if (homeFeedData.value.featured.large?.id === id) {
      homeFeedData.value.featured.large = null;
    }
    for (const section of homeFeedData.value.sections) {
      if (section.videos) {
        section.videos = section.videos.filter((v: any) => v.id !== id);
      }
      if (section.channels) {
        for (const ch of section.channels) {
          ch.videos = ch.videos.filter((v: any) => v.id !== id);
        }
      }
    }
  }
  allVideos.value = allVideos.value.filter(v => v.id !== id);
};
```

(`allVideos` is still used by the search-mode branch, so that line stays; the new block handles hiding a video from the feed-driven featured block and rows, which `allVideos` no longer represents.)

- [ ] **Step 3: Verify in the browser**

Run `npm run dev`, open `/` logged in as a user with subscriptions and some watch history. Expected: below the bento block, one row per non-empty section in this order: Ajoutés récemment, Populaires, Suggéré pour toi (if logged in), then one row per subscribed channel with enough videos (if logged in) — each horizontally scrollable exactly like the old rows. Log out and confirm only Ajoutés récemment and Populaires show (no empty "Suggéré pour toi" heading, no empty channel rows). Use the hide-video action (from `VideoDropdownMenu`, inside a card) on a video that appears in a row and confirm it disappears immediately without a page reload.

- [ ] **Step 4: Run the test suite**

Run: `npm test`
Expected: 35 passed (35).

- [ ] **Step 5: Commit**

```bash
git add app/pages/index.vue
git commit -m "feat: drive homepage discovery rows from /api/home/feed sections"
```

---

### Task 9: Homepage Cleanup and Final Verification

**Files:**
- Modify: `app/pages/index.vue`

**Interfaces:**
- None — this task only removes now-dead code left over from Tasks 7-8's incremental replacement.

- [ ] **Step 1: Remove the dead home-feed fetch and computeds**

In `app/pages/index.vue`, the original `feedData`/`feedPending` fetch (the block right before the one Task 7 Step 1 added) is now unused — nothing reads `feedData` outside of `computeData`'s search branch, which reads `searchData`, not `feedData`. Remove the now-dead `else` branch of `computeData` and the parts of `allVideos`/`feedPending` wiring that only existed to serve the old hero/rows:

Replace `computeData` and its `watch` call:

```ts
const computeData = () => {
  if (searchQuery.value) {
    allVideos.value = searchData.value?.videos || [];
    searchPagination.value = searchData.value?.pagination || null;
  }
  loading.value = searchQuery.value ? searchPending.value : false;
};

watch([searchData, searchQuery], computeData, { immediate: true });
```

Remove the `homeFeedData` `watch` block Task 7 Step 1 added (`watch(homeFeedData, () => { loading.value = false; }, { immediate: true });`) — replaced by the `loading.value` line above, which now derives from `searchPending` in search mode and from `homeFeedPending` otherwise. Add, right after the `computeData` block:

```ts
watch(homeFeedPending, (pending) => {
  if (!searchQuery.value) loading.value = pending;
}, { immediate: true });
```

- [ ] **Step 2: Confirm no remaining references to the removed hero-specific state**

Search the file for `heroVideo`, `recentVideos`, `channelGroups`, `feedData` — none of these identifiers should remain anywhere in `app/pages/index.vue` (Task 7/8 already stopped rendering them; this step is the final check that nothing still declares or reads them). If any reference remains, remove it.

- [ ] **Step 3: Full verification pass**

Run `npm run dev` and walk through, in order:
1. Logged out, no search: bento block + Ajoutés récemment + Populaires only, no console errors.
2. Logged in, no search: bento block + all applicable sections, no duplicate video anywhere on the page (spot-check a few IDs across the bento and the rows below it).
3. Search with a query: unaffected — channel pills, paginated video grid, pagination controls all still work exactly as before (this branch was never touched).
4. Empty archive (or a fresh test account pointed at a DB with zero completed videos): the existing `EmptyState` still shows instead of an empty bento/rows layout.

- [ ] **Step 4: Run the full test suite one last time**

Run: `npm test`
Expected: 35 passed (35).

- [ ] **Step 5: Commit**

```bash
git add app/pages/index.vue
git commit -m "chore: remove dead pre-redesign homepage feed state"
```

---

## Final Check Across the Whole Plan

After all 9 tasks are complete and reviewed, before merging:
- Confirm the palette change (Task 1) reads consistently across every page, not just the homepage — spot-check `/channels`, `/watch/<id>`, `/settings`.
- Confirm the icon rail (Task 2) doesn't clip or break on any page with unusually long content directly under the header.
- Confirm `VideoCard`'s hover preview (Task 4) behaves the same everywhere it's used: home feed, channel pages, playlist pages, subscriptions.
- Run `npm test` one final time (expected: 35 passed) and do one more full manual pass per Task 9 Step 3.
