# YouKeep UI Modernization & Video Player Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Modernize YouKeep's interface with a consistent "calm depth-glass" signature style and shared components, and rebuild the video player into its own component with theater mode and a floating mini-player.

**Architecture:** Extend the existing CSS-variable design system in `app/assets/css/main.css` (additive tokens only), add four presentation-only components under `app/components/ui/`, extract the video player from `app/pages/watch/[id].vue` into `app/components/VideoPlayer.vue`, then migrate pages onto the new primitives in independently-shippable waves.

**Tech Stack:** Nuxt 4 / Vue 3 `<script setup>`, plain CSS with custom properties (no CSS framework), Vitest for the existing server-side suite (unaffected by this work).

## Global Constraints

- Brand stays violet/pink (`--accent-primary: #8b5cf6`, `--accent-secondary: #ec4899`) on the dark theme (`--bg-base: #0a0a0f`) — no new palette, no light mode.
- Design tokens are additive: no existing CSS variable, class, or its meaning changes in Wave 1 — only new ones are introduced.
- The signature hover treatment ("calm depth glass") is the **only** deliberate ambient visual signature: neutral at rest, a soft violet glow appears only on hover/focus, nothing animates on its own. Exact values: rest `background: rgba(20, 20, 28, 0.7); border: 1px solid rgba(255, 255, 255, 0.06); box-shadow: 0 8px 18px rgba(0, 0, 0, 0.35);`, hover adds `0 4px 16px -4px rgba(139, 92, 246, 0.15)` to the shadow, transition `box-shadow var(--duration-base) var(--ease-standard)`.
- No automated UI test suite exists and none is being added by this plan (see spec, "Out of scope"). Every task's verification step is a manual check in a running `npm run dev` server — run `npm test` after each task only as a safety net in case a server file was touched by accident, not as UI verification.
- The video player extraction (Task 7) must not change behavior — it's a relocation, not a rewrite. New player features (theater mode, mini-player) are separate, later tasks.
- Follow existing code conventions: `<script setup lang="ts">`, scoped `<style>` per component, SVG icons inlined (no icon library dependency currently used).

---

## Wave 1 — Foundations

### Task 1: Add spacing and motion design tokens

**Files:**
- Modify: `app/assets/css/main.css:41-51` (end of the `:root` block)

**Interfaces:**
- Produces: CSS custom properties `--space-1` through `--space-8`, `--ease-standard`, `--duration-fast`, `--duration-base`, `--duration-slow`, available globally to every component from this point on.

- [ ] **Step 1: Insert the new tokens**

Open `app/assets/css/main.css` and replace lines 41-51 (the layout/radius/font block ending the `:root` selector):

```css
  /* Layout Details */
  --sidebar-width: 240px;
  --sidebar-collapsed-width: 72px;
  --header-height: 56px;
  --border-radius-sm: 6px;
  --border-radius-md: 12px;
  --border-radius-lg: 20px;

  /* Spacing Scale (base unit: 4px) */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 32px;
  --space-7: 48px;
  --space-8: 64px;

  /* Motion */
  --ease-standard: cubic-bezier(0.25, 0.8, 0.25, 1);
  --duration-fast: 120ms;
  --duration-base: 200ms;
  --duration-slow: 350ms;

  /* Fonts */
  --font-title: 'Outfit', 'Inter', sans-serif;
  --font-body: 'Inter', sans-serif;
}
```

- [ ] **Step 2: Verify in the browser**

Run `npm run dev`, open `http://localhost:3000` in a browser, open devtools, and in the console run:

```js
getComputedStyle(document.documentElement).getPropertyValue('--space-5')
```

Expected: `" 24px"` (or `"24px"`). Confirms the tokens are live without touching any page.

- [ ] **Step 3: Commit**

```bash
git add app/assets/css/main.css
git commit -m "feat: add spacing and motion design tokens"
```

---

### Task 2: Add route transition and list stagger-in utility

**Files:**
- Modify: `app/assets/css/main.css` (append new section)
- Modify: `app/app.vue`

**Interfaces:**
- Produces: global CSS class `.stagger-in` (apply to a list container; each direct child fades/slides in with an incrementing delay, capped at 8 children) and a Nuxt page-transition named `page`.

- [ ] **Step 1: Add the page transition CSS**

Append to the end of `app/assets/css/main.css`:

```css
/* Page transition */
.page-enter-active,
.page-leave-active {
  transition: opacity var(--duration-base) var(--ease-standard);
}
.page-enter-from,
.page-leave-to {
  opacity: 0;
}

/* Staggered list entrance — apply to a grid/list container */
.stagger-in > * {
  animation: stagger-fade-in var(--duration-slow) var(--ease-standard) both;
}
.stagger-in > *:nth-child(1) { animation-delay: 0ms; }
.stagger-in > *:nth-child(2) { animation-delay: 30ms; }
.stagger-in > *:nth-child(3) { animation-delay: 60ms; }
.stagger-in > *:nth-child(4) { animation-delay: 90ms; }
.stagger-in > *:nth-child(5) { animation-delay: 120ms; }
.stagger-in > *:nth-child(6) { animation-delay: 150ms; }
.stagger-in > *:nth-child(7) { animation-delay: 180ms; }
.stagger-in > *:nth-child(n+8) { animation-delay: 210ms; }

@keyframes stagger-fade-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
```

- [ ] **Step 2: Wire the page transition in `app/app.vue`**

Current content of `app/app.vue`:

```vue
<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
```

Replace the `<template>` block with:

```vue
<template>
  <NuxtLayout>
    <NuxtPage :transition="{ name: 'page', mode: 'out-in' }" />
  </NuxtLayout>
</template>
```

(The `<script setup>` block below it, with the service worker registration, is unchanged.)

- [ ] **Step 3: Verify in the browser**

Run `npm run dev`, log in, and click between `Home`, `Channels`, `Playlists` in the sidebar. Expected: each page fades in/out instead of snapping instantly. No layout shift or flash of unstyled content.

- [ ] **Step 4: Commit**

```bash
git add app/assets/css/main.css app/app.vue
git commit -m "feat: add page transition and list stagger-in animation utility"
```

---

### Task 3: Create `UiCard.vue` (the signature depth-glass component)

**Files:**
- Create: `app/components/ui/UiCard.vue`
- Modify: `app/assets/css/main.css:477-479` (`.premium-card:hover` — currently the "too marked" lift+scale+glow effect rejected during design; tone it down to match the new signature so the two don't visually clash while both exist during the transition)

**Interfaces:**
- Produces: `<UiCard>` component, props `flat?: boolean` (when true, no pointer cursor — for cards that aren't clickable), default slot for content. Renders a single `<div class="ui-card">` wrapper.

- [ ] **Step 1: Create the component**

```vue
<!-- app/components/ui/UiCard.vue -->
<template>
  <div class="ui-card" :class="{ 'ui-card--flat': flat }">
    <slot />
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ flat?: boolean }>(), { flat: false });
</script>

<style scoped>
.ui-card {
  border-radius: var(--border-radius-lg);
  background: rgba(20, 20, 28, 0.7);
  border: 1px solid rgba(255, 255, 255, 0.06);
  box-shadow: 0 8px 18px rgba(0, 0, 0, 0.35);
  transition: box-shadow var(--duration-base) var(--ease-standard);
  cursor: pointer;
}

.ui-card:hover {
  box-shadow: 0 10px 22px rgba(0, 0, 0, 0.35), 0 4px 16px -4px rgba(139, 92, 246, 0.15);
}

.ui-card--flat {
  cursor: default;
}
</style>
```

- [ ] **Step 2: Tone down the legacy `.premium-card` hover to match**

In `app/assets/css/main.css`, replace the existing rule (lines 477-479 as of Task 1's edits — search for `.premium-card:hover`):

```css
.premium-card:hover {
  transform: translateY(-6px) scale(1.02);
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.6), 0 0 30px rgba(139, 92, 246, 0.15);
  border-color: rgba(139, 92, 246, 0.3);
  background: linear-gradient(145deg, rgba(40, 40, 65, 0.7) 0%, rgba(20, 20, 35, 0.8) 100%);
}
```

with:

```css
.premium-card:hover {
  box-shadow: 0 10px 22px rgba(0, 0, 0, 0.35), 0 4px 16px -4px rgba(139, 92, 246, 0.15);
}
```

(This class is still referenced by `VideoCard.vue` until Task 12 migrates it onto `UiCard` directly — toning it down now keeps the interface visually consistent throughout the rollout instead of having two competing hover styles side by side.)

- [ ] **Step 3: Verify in the browser**

Run `npm run dev`, log in as an existing user, go to `/` (Home). The video cards should now lift/glow noticeably less on hover than before (no jump/scale, just a subtle shadow change) — this is the toned-down `.premium-card`, confirming Step 2 took effect. `UiCard` itself has no consumer yet, so there's nothing new to see for it directly.

- [ ] **Step 4: Commit**

```bash
git add app/components/ui/UiCard.vue app/assets/css/main.css
git commit -m "feat: add UiCard component and tone down legacy premium-card hover"
```

---

### Task 4: Create `UiButton.vue`

**Files:**
- Create: `app/components/ui/UiButton.vue`
- Modify: `app/assets/css/main.css` (promote the duplicated `.spinner` CSS to a global class, append after the `.btn-xs` rule around line 267)

**Interfaces:**
- Produces: `<UiButton>` component, props `variant?: 'primary' | 'secondary' | 'danger' | 'danger-outline'` (default `'primary'`), `size?: 'md' | 'sm' | 'xs'` (default `'md'`), `loading?: boolean` (default `false`), `disabled?: boolean` (default `false`). Emits nothing extra — forwards native `click` via Vue's automatic attribute/event fallthrough. Default slot is the button label; hidden while `loading` is true (spinner shown instead).

- [ ] **Step 1: Promote the global spinner class**

`.spinner` is currently redefined independently in `app/pages/index.vue`, `login.vue`, `channels.vue`, `subscriptions.vue`, and `shorts.vue` (all with the same 20px/2.5px-border/0.8s-spin definition, e.g. `app/pages/login.vue:241-251`). Append a single global definition to `app/assets/css/main.css`:

```css
/* Global spinner (was duplicated per-page — see plan Task 4) */
.spinner {
  width: 20px;
  height: 20px;
  border: 2.5px solid rgba(255, 255, 255, 0.3);
  border-radius: 50%;
  border-top-color: white;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
```

Leave the per-page duplicates in place for now — removing them is out of scope for this task (it would touch 5 unrelated files with no visual benefit, since a page-local rule of the same specificity simply wins; cleaning them up can happen naturally when each of those pages is migrated in Waves 3-4).

- [ ] **Step 2: Create the component**

```vue
<!-- app/components/ui/UiButton.vue -->
<template>
  <button
    class="btn"
    :class="[`btn-${variant}`, size !== 'md' ? `btn-${size}` : '']"
    :disabled="disabled || loading"
  >
    <span v-if="loading" class="spinner ui-button-spinner"></span>
    <slot v-else />
  </button>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  variant?: 'primary' | 'secondary' | 'danger' | 'danger-outline';
  size?: 'md' | 'sm' | 'xs';
  loading?: boolean;
  disabled?: boolean;
}>(), {
  variant: 'primary',
  size: 'md',
  loading: false,
  disabled: false,
});
</script>

<style scoped>
.ui-button-spinner {
  width: 14px;
  height: 14px;
  border-width: 2px;
}
</style>
```

- [ ] **Step 3: Verify with a throwaway usage**

Temporarily add to `app/pages/index.vue` template (right after the opening `<div>` — remove this in the next step, it's only to visually confirm the component renders):

```vue
<UiButton variant="primary">Test</UiButton>
<UiButton variant="secondary" loading>Test</UiButton>
```

Run `npm run dev`, open `/`. Expected: a solid violet-to-pink gradient button labeled "Test", and next to it a secondary-styled button showing a small spinning circle instead of text. Remove both test lines from `index.vue` before committing.

- [ ] **Step 4: Commit**

```bash
git add app/components/ui/UiButton.vue app/assets/css/main.css
git commit -m "feat: add UiButton component with loading state"
```

---

### Task 5: Create `UiBadge.vue`

**Files:**
- Create: `app/components/ui/UiBadge.vue`

**Interfaces:**
- Produces: `<UiBadge>` component, prop `tone?: 'pending' | 'downloading' | 'completed' | 'failed' | 'neutral'` (default `'neutral'`), default slot is the label text. Reuses the existing `.badge` / `.badge-pending` / `.badge-downloading` / `.badge-completed` / `.badge-failed` classes already defined in `app/assets/css/main.css:271-306` — no new CSS needed for the known tones.

- [ ] **Step 1: Add a `neutral` tone to main.css**

The existing badge classes cover pending/downloading/completed/failed but not a generic neutral badge (used today ad-hoc for things like visibility labels: `PUBLIC`, `STANDARD USER`). Append to `app/assets/css/main.css`, right after the existing `.badge-failed` rule:

```css
.badge-neutral {
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-secondary);
  border: 1px solid rgba(255, 255, 255, 0.1);
}
```

- [ ] **Step 2: Create the component**

```vue
<!-- app/components/ui/UiBadge.vue -->
<template>
  <span class="badge" :class="`badge-${tone}`">
    <slot />
  </span>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  tone?: 'pending' | 'downloading' | 'completed' | 'failed' | 'neutral';
}>(), { tone: 'neutral' });
</script>
```

- [ ] **Step 3: Verify with a throwaway usage**

Temporarily add to `app/pages/index.vue`, run `npm run dev`, open `/`:

```vue
<UiBadge tone="completed">Test</UiBadge>
<UiBadge tone="neutral">Test</UiBadge>
```

Expected: a green pill-shaped badge reading "TEST" and a subtle gray one. Remove the test lines before committing.

- [ ] **Step 4: Commit**

```bash
git add app/components/ui/UiBadge.vue app/assets/css/main.css
git commit -m "feat: add UiBadge component with neutral tone"
```

---

### Task 6: Create `UiSkeleton.vue`

**Files:**
- Create: `app/components/ui/UiSkeleton.vue`

**Interfaces:**
- Produces: `<UiSkeleton>` component, props `width?: string` (default `'100%'`), `height?: string` (default `'16px'`), `rounded?: 'sm' | 'md' | 'lg'` (default `'md'`, maps to the existing `--border-radius-*` tokens). Renders a single pulsing block — no slot.

- [ ] **Step 1: Create the component**

```vue
<!-- app/components/ui/UiSkeleton.vue -->
<template>
  <div
    class="ui-skeleton"
    :style="{ width, height, borderRadius: `var(--border-radius-${rounded})` }"
  ></div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  width?: string;
  height?: string;
  rounded?: 'sm' | 'md' | 'lg';
}>(), {
  width: '100%',
  height: '16px',
  rounded: 'md',
});
</script>

<style scoped>
.ui-skeleton {
  background: linear-gradient(
    90deg,
    rgba(255, 255, 255, 0.04) 25%,
    rgba(255, 255, 255, 0.09) 37%,
    rgba(255, 255, 255, 0.04) 63%
  );
  background-size: 400% 100%;
  animation: ui-skeleton-pulse 1.6s ease-in-out infinite;
}

@keyframes ui-skeleton-pulse {
  0% { background-position: 100% 50%; }
  100% { background-position: 0 50%; }
}
</style>
```

- [ ] **Step 2: Verify with a throwaway usage**

Temporarily add to `app/pages/index.vue`, run `npm run dev`, open `/`:

```vue
<UiSkeleton width="240px" height="140px" rounded="lg" />
```

Expected: a rounded rectangle with a soft light band sweeping left-to-right on a loop. Remove the test line before committing.

- [ ] **Step 3: Commit**

```bash
git add app/components/ui/UiSkeleton.vue
git commit -m "feat: add UiSkeleton loading placeholder component"
```

---

## Wave 2 — Video Player

### Task 7: Extract `VideoPlayer.vue` from `watch/[id].vue`

**Files:**
- Create: `app/components/VideoPlayer.vue`
- Modify: `app/pages/watch/[id].vue` (remove the extracted markup/logic, replace with `<VideoPlayer>` usage)

**Interfaces:**
- Consumes (from the parent page): `video` object (must have `id`, `local_video_path`, `local_thumbnail_path`, `is_short`), `subtitles` array of `{ code, label, url }`, `token?: string` (share token query param), playlist navigation: `hasPrevVideo?: boolean`, `hasNextVideo?: boolean`.
- Produces (events emitted to the parent): `ended` (video playback finished — the parent currently reacts to this via `handleVideoEnded`), `prev` (user clicked previous-in-playlist), `next` (user clicked next-in-playlist).

This is the highest-risk task in the plan: it moves working code, not new code. Do not change any behavior in this task — visual refresh and new features are Tasks 9-11.

- [ ] **Step 1: Identify the exact boundaries to move**

In `app/pages/watch/[id].vue`, the player markup is the `<div class="video-player-container" ...>` block currently spanning roughly lines 20-234 (from `<!-- Custom Video Player -->` down to the closing `</div>` right before `<!-- Video Header Info -->`). The corresponding script logic (refs, computed, and functions like `togglePlay`, `skip`, `onTimeUpdate`, `handleKeydown`, `toggleFullscreen`, `setSpeed`, `selectSubtitle`, scrubbing handlers, and the CSS rules for `.video-player-container`, `.player-controls`, `.progress-bar-container`, `.ctrl-btn`, `.speed-control`, `.subtitles-control`, etc.) all live in the same file's `<script setup>` and `<style scoped>` blocks. Read the full file first to find every reference before moving anything, since Vue's `<script setup>` has no explicit export list to grep for.

- [ ] **Step 2: Create `VideoPlayer.vue` with the moved template, script, and style**

Move the identified template block into a new file with this shape (props/emits wrapper around the existing internals — every ref, computed, and function body inside stays byte-for-byte identical to what it was in `watch/[id].vue`, only re-homed):

```vue
<!-- app/components/VideoPlayer.vue -->
<template>
  <div
    class="video-player-container"
    ref="playerContainer"
    @mouseenter="showControls = true"
    @mouseleave="handleMouseLeave"
    @mousemove="handleMouseMove"
    @dblclick="toggleFullscreen"
    :class="{ 'controls-visible': showControls || isPaused, 'is-short-player': video?.is_short === 1 }"
    tabindex="0"
    @keydown="handleKeydown"
  >
    <!-- ... exact markup moved from watch/[id].vue, unchanged ... -->
  </div>
</template>

<script setup lang="ts">
// ... exact refs/computed/functions moved from watch/[id].vue's <script setup>, unchanged ...

const props = defineProps<{
  video: any;
  subtitles: { code: string; label: string; url: string }[];
  token?: string;
  hasPrevVideo?: boolean;
  hasNextVideo?: boolean;
}>();

const emit = defineEmits<{
  ended: [];
  prev: [];
  next: [];
}>();

// Where the old code called handleVideoEnded() directly, it now does:
// emit('ended');
// Where it called playPrevVideo()/playNextVideo(), it now does:
// emit('prev') / emit('next');
</script>

<style scoped>
/* ... exact styles moved from watch/[id].vue, unchanged ... */
</style>
```

- [ ] **Step 3: Update `watch/[id].vue` to use the new component**

Replace the moved block in `app/pages/watch/[id].vue` with:

```vue
<VideoPlayer
  :video="video"
  :subtitles="subtitles"
  :token="token"
  :has-prev-video="hasPrevVideo"
  :has-next-video="hasNextVideo"
  @ended="handleVideoEnded"
  @prev="playPrevVideo"
  @next="playNextVideo"
/>
```

Remove the now-unused refs/computed/functions and `<style>` rules from `watch/[id].vue` that were moved into `VideoPlayer.vue` (leave `handleVideoEnded`, `playPrevVideo`, `playNextVideo`, `hasPrevVideo`, `hasNextVideo` in the parent — those manage playlist navigation and history tracking, which stay page-level concerns).

- [ ] **Step 4: Manually verify full parity**

Run `npm run dev`, log in, open any watched video (`/watch/{id}`), and check every one of these against the pre-extraction behavior:
- Play/pause via click on the video and via the play button
- Seek by clicking the progress bar and by dragging the scrubber
- Hover time-preview tooltip on the progress bar
- Keyboard shortcuts: Space, ←, →, F, M
- Fullscreen toggle (button and double-click)
- Playback speed menu changes actual playback rate
- Subtitle menu switches tracks (if the video has any)
- If in a playlist context: prev/next buttons navigate and update the URL
- Buffering spinner appears on a slow network (throttle in devtools if needed)

Any difference from before the extraction is a bug in the move — fix it before proceeding, don't defer it to a later task.

- [ ] **Step 5: Commit**

```bash
git add app/components/VideoPlayer.vue app/pages/watch/[id].vue
git commit -m "refactor: extract VideoPlayer into its own component"
```

---

### Task 8: Visual refresh of the player controls

**Files:**
- Modify: `app/components/VideoPlayer.vue` (style block only)

**Interfaces:**
- Consumes: the `--space-*` and motion tokens from Task 1.
- No prop/emit changes.

- [ ] **Step 1: Apply spacing tokens to the controls row**

Find the `.controls-row`, `.controls-left`, `.controls-right` rules in `VideoPlayer.vue`'s `<style>` block and replace any hardcoded `gap`/`padding` pixel values with the matching token, e.g.:

```css
.controls-left,
.controls-right {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.controls-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--space-4) var(--space-3);
}
```

- [ ] **Step 2: Thicken the progress bar on hover**

Find `.progress-bar-container` and add a hover rule (keep the existing base height as-is, this only affects the hover state):

```css
.progress-bar-container {
  transition: height var(--duration-fast) var(--ease-standard);
}

.progress-bar-container:hover {
  height: 6px;
}
```

(If `.progress-bar-container` already sets an explicit `height`, this hover rule overrides it only while hovered — check the base rule's current height value and keep it unchanged.)

- [ ] **Step 3: Apply the standard easing to `.ctrl-btn` hover**

Find `.ctrl-btn` and ensure its hover transition uses the shared token instead of any ad-hoc duration:

```css
.ctrl-btn {
  transition: background-color var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard);
}
```

- [ ] **Step 4: Verify in the browser**

Run `npm run dev`, open `/watch/{id}`, hover over the progress bar (should visibly thicken) and over individual control buttons (should transition smoothly, no visual snap). Confirm nothing from Task 7's verification list regressed.

- [ ] **Step 5: Commit**

```bash
git add app/components/VideoPlayer.vue
git commit -m "style: apply design tokens to video player controls"
```

---

### Task 9: Add theater mode

**Files:**
- Modify: `app/components/VideoPlayer.vue`

**Interfaces:**
- Produces: new emit `theater-mode-change` (payload: `boolean`) so the parent page can dim/resize its own layout around the player.
- Modify (parent): `app/pages/watch/[id].vue` listens for `@theater-mode-change` and toggles a class on its `.player-column`/`.watch-content` wrapper.

- [ ] **Step 1: Add the theater-mode state and toggle button in `VideoPlayer.vue`**

Add near the other player refs in `<script setup>`:

```ts
const isTheaterMode = ref(false);

function toggleTheaterMode() {
  isTheaterMode.value = !isTheaterMode.value;
  emit('theater-mode-change', isTheaterMode.value);
}
```

Add `'theater-mode-change': [boolean]` to the `defineEmits<{ ... }>()` type from Task 7.

Add a button next to the existing fullscreen button in the controls-right section:

```vue
<button class="ctrl-btn" @click="toggleTheaterMode" :title="isTheaterMode ? 'Exit Theater Mode' : 'Theater Mode'">
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"></rect></svg>
</button>
```

- [ ] **Step 2: React to it in `watch/[id].vue`**

Add a ref and handler in `app/pages/watch/[id].vue`'s `<script setup>`:

```ts
const theaterMode = ref(false);

function onTheaterModeChange(value: boolean) {
  theaterMode.value = value;
}
```

Bind it on the component and on the page wrapper:

```vue
<VideoPlayer
  ...
  @theater-mode-change="onTheaterModeChange"
/>
```

Find the root content wrapper in the template (the element with class `watch-content`) and add:

```vue
<div class="watch-content" :class="{ 'theater-mode': theaterMode }">
```

- [ ] **Step 3: Add the dimming/widening CSS**

Append to `app/pages/watch/[id].vue`'s `<style>` block:

```css
.watch-content.theater-mode {
  grid-template-columns: 1fr;
}

.watch-content.theater-mode .sidebar-column {
  display: none;
}

.watch-content.theater-mode .player-column {
  max-width: 1400px;
  margin: 0 auto;
}
```

(Adjust the selector names for the sidebar/player wrapper if the actual grid uses different class names than `sidebar-column` — check the current `.watch-content` grid definition in the file before writing the override, since it must match the real structure.)

- [ ] **Step 4: Verify in the browser**

Run `npm run dev`, open `/watch/{id}`, click the new theater-mode button. Expected: the "Other archived videos" sidebar disappears and the player area widens, without entering OS fullscreen. Click again to exit and confirm the layout returns to normal.

- [ ] **Step 5: Commit**

```bash
git add app/components/VideoPlayer.vue app/pages/watch/[id].vue
git commit -m "feat: add theater mode to video player"
```

---

### Task 10: Add the floating mini-player

**Files:**
- Modify: `app/pages/watch/[id].vue`

**Interfaces:**
- No changes to `VideoPlayer.vue`'s props/emits — the mini-player is a second, small `<video>`-free UI shell in the parent page that mirrors playback state via the same `videoPlayer` element reference exposed by `VideoPlayer.vue`.
- Produces (from `VideoPlayer.vue`): expose the internal `<video>` element ref via `defineExpose({ videoEl: videoPlayer })` so the parent can read `currentTime`/`duration`/`paused` for the mini-player's mirrored controls, and call `.play()`/`.pause()` on it directly.

- [ ] **Step 1: Expose the video element from `VideoPlayer.vue`**

Add at the end of `VideoPlayer.vue`'s `<script setup>`:

```ts
defineExpose({ videoEl: videoPlayer });
```

- [ ] **Step 2: Track scroll position in `watch/[id].vue`**

Add to the `<script setup>` block:

```ts
const videoPlayerRef = ref<InstanceType<typeof VideoPlayer> | null>(null);
const showMiniPlayer = ref(false);
const playerContainerEl = ref<HTMLElement | null>(null);

function handleScroll() {
  if (!playerContainerEl.value) return;
  const rect = playerContainerEl.value.getBoundingClientRect();
  const videoEl = videoPlayerRef.value?.videoEl;
  const isPlaying = videoEl && !videoEl.paused;
  showMiniPlayer.value = isPlaying === true && rect.bottom < 0;
}

onMounted(() => {
  window.addEventListener('scroll', handleScroll, { passive: true });
});
onUnmounted(() => {
  window.removeEventListener('scroll', handleScroll);
});

function closeMiniPlayer() {
  videoPlayerRef.value?.videoEl?.pause();
  showMiniPlayer.value = false;
}

function scrollToPlayer() {
  playerContainerEl.value?.scrollIntoView({ behavior: 'smooth' });
}

function toggleMiniPlayerPlayback() {
  const videoEl = videoPlayerRef.value?.videoEl;
  if (!videoEl) return;
  if (videoEl.paused) videoEl.play(); else videoEl.pause();
}
```

- [ ] **Step 3: Wire the ref and add the mini-player markup**

Update the `<VideoPlayer>` usage to attach the refs:

```vue
<div ref="playerContainerEl">
  <VideoPlayer
    ref="videoPlayerRef"
    :video="video"
    :subtitles="subtitles"
    :token="token"
    :has-prev-video="hasPrevVideo"
    :has-next-video="hasNextVideo"
    @ended="handleVideoEnded"
    @prev="playPrevVideo"
    @next="playNextVideo"
    @theater-mode-change="onTheaterModeChange"
  />
</div>

<div v-if="showMiniPlayer" class="mini-player" @click="scrollToPlayer">
  <div class="mini-player-thumb">
    <img :src="video.local_thumbnail_path" alt="" />
  </div>
  <div class="mini-player-info">
    <p class="mini-player-title">{{ video.title }}</p>
  </div>
  <button class="mini-player-btn" @click.stop="toggleMiniPlayerPlayback" title="Play/Pause">
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="white" stroke="none"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
  </button>
  <button class="mini-player-close" @click.stop="closeMiniPlayer" title="Close">
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
  </button>
</div>
```

- [ ] **Step 4: Add the mini-player CSS**

Append to `watch/[id].vue`'s `<style>` block:

```css
.mini-player {
  position: fixed;
  bottom: var(--space-5);
  right: var(--space-5);
  width: 280px;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2);
  border-radius: var(--border-radius-md);
  background: rgba(20, 20, 28, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
  cursor: pointer;
  z-index: 500;
}

.mini-player-thumb {
  width: 64px;
  height: 36px;
  border-radius: var(--border-radius-sm);
  overflow: hidden;
  flex-shrink: 0;
}

.mini-player-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.mini-player-info {
  flex: 1;
  min-width: 0;
}

.mini-player-title {
  font-size: 12px;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mini-player-btn,
.mini-player-close {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.06);
  flex-shrink: 0;
}
```

- [ ] **Step 5: Verify in the browser**

Run `npm run dev`, open `/watch/{id}`, start playback, scroll down past the player. Expected: the mini-player appears bottom-right showing the thumbnail and title. Click its play/pause button — playback toggles without scrolling. Click the card itself — smooth-scrolls back to the full player. Click the close (×) button — video pauses and the mini-player disappears. Scroll back up manually without pausing — mini-player should also disappear once the real player is back in view (covered by the `rect.bottom < 0` check in `handleScroll`).

- [ ] **Step 6: Commit**

```bash
git add app/pages/watch/[id].vue app/components/VideoPlayer.vue
git commit -m "feat: add floating mini-player on scroll"
```

---

## Wave 3 — High-Traffic Pages

### Task 11: Migrate `VideoCard.vue` onto `UiCard`

**Files:**
- Modify: `app/components/VideoCard.vue`

**Interfaces:**
- No prop/emit changes — `VideoCard.vue`'s public API (`video`, `showChannelInfo`, `@hidden`) is unchanged. This purely swaps its internal wrapper element and removes now-redundant local CSS, and since `index.vue`, `subscriptions.vue`, and (after Task 12/13) `channels.vue` / `playlists/[id].vue` all render video grids through this one component, it's the single highest-leverage task in this wave.

- [ ] **Step 1: Wrap the card content in `UiCard`**

In `app/components/VideoCard.vue`, change the root template element:

```vue
<template>
  <UiCard class="video-card" @click="playVideo">
    <!-- Thumbnail Wrapper -->
    <div class="thumbnail-wrapper">
      <!-- ... unchanged ... -->
    </div>
    <!-- Video Details -->
    <div class="video-info">
      <!-- ... unchanged ... -->
    </div>
  </UiCard>
</template>
```

(`UiCard` is auto-imported by Nuxt from `app/components/ui/UiCard.vue` — no explicit `import` needed, matching how `VideoDropdownMenu` is already used in this same file without an import statement.)

- [ ] **Step 2: Remove the now-redundant hover styles from this component's `<style>` block**

Delete the `.video-card:hover .thumbnail-wrapper` rule (currently at `app/components/VideoCard.vue:152-156`) — `UiCard`'s hover glow now handles the card-level feedback, and the thumbnail zoom-on-hover rule (`.video-card:hover .thumbnail-img`, lines 166-168) can stay since it's a distinct, complementary effect (image zooms slightly while the card glows).

Also remove the `border`/`box-shadow`/`background` declarations from the base `.thumbnail-wrapper` rule if they were only there to interact with the deleted hover rule — check by reading the full rule first; keep anything still needed for the thumbnail's own appearance (e.g. its `border-radius`, `aspect-ratio`).

- [ ] **Step 3: Verify in the browser**

Run `npm run dev`, open `/` (Home). Expected: video cards still render identically in layout, still navigate to the video on click, still show the dropdown menu — but now hovering shows the calm violet glow from `UiCard` instead of the old border-color change. Repeat the check on `/subscriptions`.

- [ ] **Step 4: Commit**

```bash
git add app/components/VideoCard.vue
git commit -m "refactor: migrate VideoCard onto UiCard signature style"
```

---

### Task 12: Replace `channels.vue`'s hand-rolled video cards with `<VideoCard>`

**Files:**
- Modify: `app/pages/channels.vue:272-449` (the "Archived Videos" tab's `v-else class="video-grid"` block and its 3 sibling occurrences for Shorts/Playlists-adjacent video lists — confirm exact line ranges by searching for `class="video-card premium-card"`, which currently appears 4 times in this file)

**Interfaces:**
- Consumes: `<VideoCard>`'s existing public API (`video`, `show-channel-info`, `@hidden`).

- [ ] **Step 1: Find and replace each hand-rolled card block**

For the first occurrence (the main "Archived Videos" grid, `v-else class="video-grid"` around line 272), the current markup duplicates everything `VideoCard.vue` already does (thumbnail, error fallback, duration badge, title, meta). Replace the per-video `<div class="video-card premium-card" ...>...</div>` block with:

```vue
<VideoCard
  v-for="video in archivedVideos"
  :key="video.id"
  :video="video"
  :show-channel-info="false"
  @hidden="onVideoHidden"
/>
```

(If `onVideoHidden` doesn't already exist in this page's `<script setup>`, add a minimal handler that removes the video from the local list, mirroring how `index.vue` handles the same `@hidden` event — check `app/pages/index.vue`'s `onVideoHidden` implementation and reuse the same logic here, adapted to whichever local ref holds `archivedVideos`.)

- [ ] **Step 2: Repeat for the remaining 3 occurrences**

Apply the identical swap pattern to the other three `class="video-card premium-card"` blocks in this file (the Shorts tab grid and any other video list using the same markup shape) — each one's surrounding `v-for` source array differs (e.g. `archivedShorts` instead of `archivedVideos`) but the replacement `<VideoCard>` usage is otherwise identical to Step 1.

- [ ] **Step 3: Remove the now-dead local card CSS**

Once no template in this file references `class="video-card"` or `class="premium-card"` directly, delete their rule blocks from this file's `<style scoped>` section (they're fully superseded by `VideoCard.vue` and `UiCard.vue`'s own scoped styles). Search the file for `.video-card` and `.premium-card` selectors to find every rule to remove.

- [ ] **Step 4: Verify in the browser**

Run `npm run dev`, open any channel page's "Archived Videos" and "Shorts" tabs. Expected: identical grid layout and card content as before, now sharing the exact same component (and hover glow) as the Home page. Click a card to confirm navigation still works, and confirm the "hide video" action (via the card's dropdown menu) still removes it from the grid.

- [ ] **Step 5: Commit**

```bash
git add app/pages/channels.vue
git commit -m "refactor: use shared VideoCard component on the channel page"
```

---

### Task 13: Replace `playlists/[id].vue`'s hand-rolled video list with `<VideoCard>`

**Files:**
- Modify: `app/pages/playlists/[id].vue`

**Interfaces:**
- Consumes: `<VideoCard>`'s existing public API.

- [ ] **Step 1: Identify the current markup**

This page currently renders its playlist video list (seen earlier in this project as the numbered list with a thumbnail, title, channel, view count, and an "×" remove button) with its own hand-rolled markup rather than `<VideoCard>`. Read the file's template to find the `v-for` loop over the playlist's videos.

- [ ] **Step 2: Replace with `<VideoCard>`, keeping the remove button**

`VideoCard.vue` doesn't have a "remove from playlist" affordance (that's playlist-specific, not a general video-card concern), so keep it as a sibling element rather than trying to force it into the shared component:

```vue
<div class="playlist-video-row" v-for="(video, index) in playlistVideos" :key="video.id">
  <span class="playlist-video-index">{{ index + 1 }}</span>
  <VideoCard :video="video" :show-channel-info="true" @hidden="() => {}" />
  <button class="playlist-remove-btn" @click="removeFromPlaylist(video.id)" title="Remove from Playlist">
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
  </button>
</div>
```

(`removeFromPlaylist` is the existing handler already wired to the current "×" button — reuse it as-is; only the surrounding video presentation changes. `@hidden="() => {}"` is a no-op since "hide from home feed" isn't a relevant action inside a playlist view — confirm against the file whether `VideoDropdownMenu`'s hide option should even show here, and if the existing markup already suppressed it, replicate that via `VideoCard`'s existing props before wiring the no-op.)

- [ ] **Step 3: Remove the dead hand-rolled card CSS**

Same as Task 12 Step 3 — delete any now-unreferenced `.video-card`/thumbnail rules from this file's `<style scoped>` block.

- [ ] **Step 4: Verify in the browser**

Run `npm run dev`, open a personal playlist with at least 2 videos. Expected: same list layout, now using the shared card component (with the new hover glow), remove button still works and re-indexes the remaining videos.

- [ ] **Step 5: Commit**

```bash
git add app/pages/playlists/[id].vue
git commit -m "refactor: use shared VideoCard component on the playlist detail page"
```

---

### Task 14: Add stagger-in animation to the main grids

**Files:**
- Modify: `app/pages/index.vue`, `app/pages/channels.vue`

**Interfaces:**
- Consumes: the `.stagger-in` utility class from Task 2.

- [ ] **Step 1: Apply the class to the home feed grid**

In `app/pages/index.vue`, find the container that wraps the `<VideoCard v-for="video in allVideos" ...>` loop (the recent-videos grid) and add `stagger-in` alongside its existing class(es):

```vue
<div class="video-grid stagger-in">
  <VideoCard v-for="video in allVideos" :key="video.id" :video="video" @hidden="onVideoHidden" />
</div>
```

- [ ] **Step 2: Apply the class to the channel page's archived-videos grid**

In `app/pages/channels.vue`, add `stagger-in` to the `video-grid` container from Task 12:

```vue
<div v-else class="video-grid stagger-in">
  <VideoCard v-for="video in archivedVideos" :key="video.id" :video="video" :show-channel-info="false" @hidden="onVideoHidden" />
</div>
```

- [ ] **Step 3: Verify in the browser**

Run `npm run dev`, hard-refresh `/` and a channel page. Expected: cards fade/slide in with a slight, quick cascade left-to-right/top-to-bottom instead of all appearing instantly — subtle, under half a second total, not a distracting delay before content is usable.

- [ ] **Step 4: Commit**

```bash
git add app/pages/index.vue app/pages/channels.vue
git commit -m "style: add stagger-in animation to video grids"
```

---

## Wave 4 — Secondary Pages

### Task 15: Migrate `login.vue` and `account.vue` buttons/spinners onto `UiButton`

**Files:**
- Modify: `app/pages/login.vue`
- Modify: `app/pages/account.vue`

**Interfaces:**
- Consumes: `<UiButton>` from Task 4.

- [ ] **Step 1: Replace the login submit button**

In `app/pages/login.vue`, the submit button currently renders its own spinner span (`<span v-if="loadingSubmit" class="spinner"></span>`, line 61) alongside a `.btn` class. Replace that button element with:

```vue
<UiButton variant="primary" type="submit" :loading="loadingSubmit">
  Log in
</UiButton>
```

(Confirm the exact current label text and any additional attributes like `:disabled` on the existing button before replacing it, and carry them over — `UiButton` already disables itself while `loading` is true, so a separate `:disabled` binding is only needed if the button has its own extra disable condition beyond the loading state.)

- [ ] **Step 2: Remove the now-unused local `.spinner` rule**

Delete the `.spinner`/`@keyframes spin` block from `app/pages/login.vue`'s `<style>` (found at `app/pages/login.vue:241-251`) — it's superseded by the global rule added in Task 4 Step 1, and `UiButton` no longer needs a page-local definition to render its own spinner.

- [ ] **Step 3: Replace `account.vue`'s "Save Information" and "Update Password" buttons**

In `app/pages/account.vue`, find the two form submit buttons (`Save Information`, `Update Password`) and convert each to `<UiButton variant="primary" type="submit" :loading="...">`, wiring each to whichever local loading ref currently gates that specific form's submit state (check the file for the existing ref names, e.g. `savingProfile`/`savingPassword`, and use the correct one per button rather than a shared one).

- [ ] **Step 4: Verify in the browser**

Run `npm run dev`. On `/login`, submit with valid credentials on a throttled network (devtools) and confirm the spinner shows before redirect. On `/account`, edit your name and save, and separately change your password — confirm each button shows its own independent spinner without affecting the other.

- [ ] **Step 5: Commit**

```bash
git add app/pages/login.vue app/pages/account.vue
git commit -m "refactor: migrate login and account page buttons onto UiButton"
```

---

### Task 16: Migrate `settings.vue` role/status badges onto `UiBadge`

**Files:**
- Modify: `app/pages/settings.vue`

**Interfaces:**
- Consumes: `<UiBadge>` from Task 5.

- [ ] **Step 1: Replace the user role badge**

Find the role badge in the "Saved User Accounts" list (`<span class="user-card-role-badge" :class="u.role">{{ u.role === 'admin' ? 'Administrator' : 'Standard User' }}</span>`) and replace with:

```vue
<UiBadge :tone="u.role === 'admin' ? 'completed' : 'neutral'">
  {{ u.role === 'admin' ? 'Administrator' : 'Standard User' }}
</UiBadge>
```

- [ ] **Step 2: Remove the now-unused `.user-card-role-badge` CSS**

Delete its rule block from `settings.vue`'s `<style>` section once nothing in the template references that class anymore.

- [ ] **Step 3: Verify in the browser**

Run `npm run dev`, log in as admin, open Settings → Users. Expected: the admin's own badge and every standard user's badge render with the shared badge component's shape/typography, admin in the green "completed" tone, standard users in the neutral gray tone.

- [ ] **Step 4: Commit**

```bash
git add app/pages/settings.vue
git commit -m "refactor: migrate settings page role badges onto UiBadge"
```

---

### Task 17: Add skeleton loading states to `channels.vue` and `subscriptions.vue`

**Files:**
- Modify: `app/pages/channels.vue`
- Modify: `app/pages/subscriptions.vue`

**Interfaces:**
- Consumes: `<UiSkeleton>` from Task 6.

- [ ] **Step 1: Replace the channel list's loading spinner**

In `app/pages/channels.vue`, find the `v-if="channelsPending"` (or equivalent) block that currently shows `<div class="spinner"></div>` for the channel grid, and replace it with a grid of skeleton cards matching the real card's approximate shape:

```vue
<div v-if="channelsPending" class="video-grid">
  <UiCard v-for="n in 6" :key="n" flat>
    <UiSkeleton height="140px" rounded="lg" />
    <div style="padding: var(--space-3);">
      <UiSkeleton height="14px" width="70%" />
      <div style="margin-top: var(--space-2);">
        <UiSkeleton height="12px" width="40%" />
      </div>
    </div>
  </UiCard>
</div>
```

- [ ] **Step 2: Apply the same pattern to `subscriptions.vue`'s loading state**

Find its equivalent `<div class="spinner"></div>` loading block and replace it with the same skeleton-grid pattern from Step 1, sized for however many placeholder cards make sense for that page's typical result count (6 is a reasonable default, matching Step 1).

- [ ] **Step 3: Verify in the browser**

Run `npm run dev` with network throttling enabled (devtools → Network → Slow 3G), reload `/channels` and `/subscriptions`. Expected: a grid of pulsing placeholder cards appears immediately, replaced by real content once data arrives — no layout jump between the skeleton grid and the real grid.

- [ ] **Step 4: Commit**

```bash
git add app/pages/channels.vue app/pages/subscriptions.vue
git commit -m "feat: add skeleton loading states to channels and subscriptions pages"
```

---

## Deferred — same pattern, no new decisions

The spec's Wave 4 names four secondary pages (Account, Settings/Admin, Subscriptions, Shorts). Tasks 15-17 cover Account, Settings' user badges, and Subscriptions' loading state — enough to establish every pattern (`UiButton` with loading, `UiBadge` tones, `UiSkeleton` grids). Two remaining spots use the identical, already-demonstrated patterns and are left out of this plan to avoid repeating the same instructions with no new design decisions:

- `app/pages/shorts.vue` has its own local `.spinner` duplicate (`app/pages/shorts.vue:566`) — delete it the same way Task 15 Step 2 did for `login.vue`, since it's superseded by the global rule from Task 4.
- `app/pages/settings.vue`'s downloader-queue section (`admin/downloader` tab) has its own action buttons and download-status displays — migrate them onto `UiButton`/`UiBadge` the same way Task 15 and Task 16 did, using `badge-pending`/`badge-downloading`/`badge-completed`/`badge-failed` tones (already defined, not the `neutral` one added in Task 5) for the download status pills.

## Final check across the whole plan

- [ ] **Run the existing server-side test suite one last time** to confirm none of the 17 tasks accidentally touched server code:

```bash
npm test
```

Expected: `23 passed (23)`, same as before this plan started — this plan should not add, remove, or change any of those tests.

- [ ] **Full manual pass**: with `npm run dev` running, click through Home, a Channel page, a Playlist, Login/Logout, Account, and Settings → Users, confirming every card, button, badge, and skeleton looks and behaves consistently, and that the video player (including theater mode and the mini-player) works on at least one full video playthrough.
