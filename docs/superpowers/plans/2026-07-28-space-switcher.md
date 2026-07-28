# Space Switcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a real space-switching mechanism to YouKeep's app shell — a second `music` space alongside the existing `video` space, a switcher control in the header to move between them, and a minimal placeholder `/music` page so the new space has somewhere to land.

**Architecture:** `app/spaces/index.ts` gains a second `Space` entry (`music`) and a per-space `icon` field. `app/layouts/default.vue` derives the active space from `route.path` (no stored state) via a `computed`, renders that space's `navLinks` in the sidebar instead of the hardcoded `spaces[0]`, and gets a new pill+dropdown control in the header that mirrors the existing `.user-menu` interaction pattern. `app/components/EmptyState.vue` gets one more icon variant (`'music'`) so the new placeholder page doesn't have to reuse a mismatched icon.

**Tech Stack:** Nuxt 4 / Vue 3 Composition API (`<script setup>`), no new dependencies, no new API endpoints, no new automated tests (this codebase has no frontend component test infra — verification is `npx vue-tsc -b --noEmit` plus manual browser click-through, matching how prior UI-only sub-projects in this project were verified).

## Global Constraints

- The active space is derived purely from `route.path` (`route.path.startsWith('/music')` → music space, else video space) — no persisted or synced state of any kind.
- No changes to any existing video-space route, page, endpoint, or the video space's existing five `navLinks`.
- No catalog content on `/music` — it is a static placeholder using the existing `EmptyState` component; sub-project 3c will fill this route in later.
- No third space, no new API endpoints, no playback.
- Type-checking in this repo requires `npx vue-tsc -b --noEmit` — plain `vue-tsc --noEmit -p .` is a silent no-op (solution-style tsconfig) and must never be used as a verification step.
- `/music` requires login by default: `app/middleware/auth.global.ts` is a global route middleware whose `publicRoutes` allowlist (`/login`, `/`, `/channels`, `/categories`, `/shorts`) does not include `/music`, so no per-page `definePageMeta` is needed or wanted — adding one would be redundant with (and could conflict with) the global middleware.

---

### Task 1: Add the `music` space and per-space icons to `app/spaces/index.ts`

**Files:**
- Modify: `app/spaces/index.ts`

**Interfaces:**
- Consumes: nothing (this is the foundational data file).
- Produces: `Space.icon: string` field (new). `spaces` array now contains two entries: `spaces[0]` (`id: 'video'`) and `spaces[1]` (`id: 'music'`). Later tasks import `spaces` from `~/spaces` exactly as `default.vue` already does today.

- [ ] **Step 1: Add the `icon` field to the `Space` interface and set it on the `video` entry**

Open `app/spaces/index.ts`. Replace the `Space` interface and the start of the `video` entry:

```ts
export interface Space {
  id: string;
  label: string;
  icon: string; // raw inline-SVG markup, rendered via v-html — used by the space switcher
  homeRoute: string;
  navLinks: SpaceNavLink[];
}

export const spaces: Space[] = [
  {
    id: 'video',
    label: 'Vidéo',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>',
    homeRoute: '/',
    navLinks: [
```

Everything else inside the `video` entry (all five `navLinks` objects, down through the closing `],` of `navLinks` and the entry's closing `},`) stays exactly as it is today — do not touch it.

- [ ] **Step 2: Add the `music` space entry**

Immediately after the `video` entry's closing `},` (still inside the `spaces` array, before the array's final closing `];`), add:

```ts
  {
    id: 'music',
    label: 'Musique',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>',
    homeRoute: '/music',
    navLinks: [
      {
        to: '/music',
        label: 'Bibliothèque',
        icon: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>',
        hideWhenMustChangePassword: true,
      },
    ],
  },
```

The full file's `spaces` array should now have exactly two top-level entries: `video` (unchanged five `navLinks`) and `music` (one `navLink`).

- [ ] **Step 3: Type-check**

Run: `npx vue-tsc -b --noEmit`
Expected: no errors. (This is the only command in this repo that actually type-checks — confirm it reports success, not just exits silently on an unrelated no-op path.)

- [ ] **Step 4: Commit**

```bash
git add app/spaces/index.ts
git commit -m "feat: add music space to spaces.ts"
```

---

### Task 2: Add a `'music'` icon variant to `app/components/EmptyState.vue`

**Files:**
- Modify: `app/components/EmptyState.vue`

**Interfaces:**
- Consumes: nothing.
- Produces: `EmptyState`'s `icon` prop union gains `'music'` as a valid value, rendering a feather-style music-note SVG. Task 4 passes `icon="music"` to this component.

- [ ] **Step 1: Add the new SVG branch in the template**

Open `app/components/EmptyState.vue`. Inside `.icon-container`, immediately before the final `<!-- Videos / Default Play icon -->` / `<svg v-else ...>` branch, insert a new branch:

```vue
        <!-- Music / Music Note -->
        <svg v-else-if="icon === 'music'" xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="main-icon">
          <path d="M9 18V5l12-2v13"></path>
          <circle cx="6" cy="18" r="3"></circle>
          <circle cx="18" cy="16" r="3"></circle>
        </svg>

```

This must be a `v-else-if` chained after the existing `folder` branch and before the existing `v-else` (default/video) branch, so the branch chain stays a single connected `v-if`/`v-else-if`/…/`v-else` sequence.

- [ ] **Step 2: Widen the `icon` prop type**

In the `<script setup>` block, change:

```ts
  icon?: 'book' | 'channels' | 'shorts' | 'folder' | 'video';
```

to:

```ts
  icon?: 'book' | 'channels' | 'shorts' | 'folder' | 'video' | 'music';
```

- [ ] **Step 3: Type-check**

Run: `npx vue-tsc -b --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/components/EmptyState.vue
git commit -m "feat: add music icon variant to EmptyState"
```

---

### Task 3: Create the `/music` placeholder page

**Files:**
- Create: `app/pages/music/index.vue`

**Interfaces:**
- Consumes: `EmptyState` component (`icon` prop now accepts `'music'`, from Task 2) via Nuxt's component auto-import (same as `channels.vue`, `shorts.vue`, `subscriptions.vue`, `index.vue` already do — no explicit `import` statement needed).
- Produces: the route `/music` resolves to a real page (target of `music` space's `homeRoute` from Task 1, and of the switcher's navigation in Task 4).

- [ ] **Step 1: Write the page**

Create `app/pages/music/index.vue`:

```vue
<template>
  <EmptyState
    icon="music"
    title="Bibliothèque musicale"
    description="La navigation par artiste et album arrive bientôt."
  />
</template>
```

No `<script setup>` block is needed — the page has no reactive state or logic, and no `definePageMeta` is needed because `/music` is not in `auth.global.ts`'s `publicRoutes` allowlist, so it is already protected by the global auth middleware by default (see Global Constraints).

- [ ] **Step 2: Type-check**

Run: `npx vue-tsc -b --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual verification**

Nuxt's file-based routing maps `app/pages/music/index.vue` to the route `/music` automatically — no route registration needed. Start the dev server, log in, navigate the browser directly to `/music`, confirm:
- The page renders the `EmptyState` with the music-note icon, the title "Bibliothèque musicale", and the description text.
- Logged out, navigating to `/music` redirects to `/login` (proves the global auth middleware is protecting the new route, since `/music` isn't in its public allowlist).

- [ ] **Step 4: Commit**

```bash
git add app/pages/music/index.vue
git commit -m "feat: add music placeholder page"
```

---

### Task 4: Wire the space switcher into `app/layouts/default.vue`

**Files:**
- Modify: `app/layouts/default.vue`

**Interfaces:**
- Consumes: `spaces` array from `~/spaces` (both entries, with `icon`, from Task 1). `route` (already available via `useRoute()` in this file's existing script).
- Produces: nothing consumed by later tasks (this is the last task in the plan).

- [ ] **Step 1: Add the `activeSpace` computed**

In `app/layouts/default.vue`'s `<script setup>` block, the import line already reads:

```ts
import { spaces } from '~/spaces';
```

Change the Vue import line from:

```ts
import { ref, onMounted, onUnmounted, watch } from 'vue';
```

to:

```ts
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
```

Then, directly below the existing `const route = useRoute();` line, add:

```ts
const activeSpace = computed(() =>
  route.path.startsWith('/music') ? spaces.find((s) => s.id === 'music')! : spaces.find((s) => s.id === 'video')!
);
```

- [ ] **Step 2: Add the space-menu open/close state**

Directly below the existing `const dropdownOpen = ref(false);` line, add:

```ts
const spaceMenuOpen = ref(false);
```

- [ ] **Step 3: Add the toggle/select/close functions**

Directly below the existing `toggleDropdown` function:

```ts
const toggleDropdown = () => {
  dropdownOpen.value = !dropdownOpen.value;
};
```

add:

```ts
const toggleSpaceMenu = () => {
  spaceMenuOpen.value = !spaceMenuOpen.value;
};

const selectSpace = (homeRoute: string) => {
  spaceMenuOpen.value = false;
  navigateTo(homeRoute);
};
```

- [ ] **Step 4: Close the space menu on outside click**

The existing outside-click handler reads:

```ts
// Close dropdown if clicked outside
const closeDropdown = () => {
  dropdownOpen.value = false;
};
onMounted(() => {
  window.addEventListener('click', closeDropdown);
});
onUnmounted(() => {
  window.removeEventListener('click', closeDropdown);
});
```

Change `closeDropdown` to also close the space menu:

```ts
// Close dropdown if clicked outside
const closeDropdown = () => {
  dropdownOpen.value = false;
  spaceMenuOpen.value = false;
};
onMounted(() => {
  window.addEventListener('click', closeDropdown);
});
onUnmounted(() => {
  window.removeEventListener('click', closeDropdown);
});
```

- [ ] **Step 5: Add the switcher control to the template**

In the `<template>`, the header currently reads:

```html
      <div class="header-left">
        <NuxtLink to="/" class="logo">
          <span class="logo-you">You</span><span class="logo-keep">Keep</span>
        </NuxtLink>
      </div>
```

Replace it with:

```html
      <div class="header-left">
        <NuxtLink to="/" class="logo">
          <span class="logo-you">You</span><span class="logo-keep">Keep</span>
        </NuxtLink>

        <div class="space-switcher" :class="{ 'is-active': spaceMenuOpen }" @click.stop="toggleSpaceMenu">
          <i class="space-switcher-icon" v-html="activeSpace.icon"></i>
          <span class="space-switcher-label">{{ activeSpace.label }}</span>
          <svg class="dropdown-arrow" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>

          <div v-if="spaceMenuOpen" class="dropdown-menu space-menu" @click.stop>
            <div
              v-for="space in spaces"
              :key="space.id"
              class="dropdown-item space-menu-item"
              :class="{ active: space.id === activeSpace.id }"
              @click="selectSpace(space.homeRoute)"
            >
              <i class="space-switcher-icon" v-html="space.icon"></i>
              {{ space.label }}
            </div>
          </div>
        </div>
      </div>
```

- [ ] **Step 6: Update the sidebar to use `activeSpace`**

The sidebar `<nav>` currently reads:

```html
          <nav class="sidebar-nav">
            <NuxtLink
              v-for="link in spaces[0].navLinks"
              v-show="!link.hideWhenMustChangePassword || !user?.mustChangePassword"
              :key="link.to"
              :to="link.to"
              class="sidebar-link"
              active-class="active"
            >
              <i class="sidebar-link-icon" v-html="link.icon"></i>
              <span>{{ link.label }}</span>
            </NuxtLink>
          </nav>
```

Change `v-for="link in spaces[0].navLinks"` to `v-for="link in activeSpace.navLinks"`. Nothing else in this block changes.

- [ ] **Step 7: Add CSS for the switcher**

In the `<style scoped>` block, directly after the existing `.logo-keep { ... }` rule, add:

```css
.space-switcher {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: 16px;
  padding: 6px 14px 6px 10px;
  border-radius: 40px;
  cursor: pointer;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.05);
  transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.space-switcher:hover,
.space-switcher.is-active {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(139, 92, 246, 0.3);
  box-shadow: 0 4px 20px rgba(139, 92, 246, 0.15);
}

.space-switcher.is-active .dropdown-arrow {
  transform: rotate(180deg);
  color: var(--accent-primary-hover);
}

.space-switcher-icon {
  display: flex;
  align-items: center;
  color: var(--text-secondary);
}

.space-menu {
  top: 44px;
  left: 0;
  right: auto;
  width: 200px;
}

.space-menu-item {
  gap: 12px;
}

.space-menu-item.active {
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-primary);
}
```

`.dropdown-arrow` and `.dropdown-menu`/`.dropdown-item` are reused as-is from the existing user-menu styles already in this file — only the position/width override (`.space-menu`) and the extra active-row treatment (`.space-menu-item.active`) are new.

- [ ] **Step 8: Type-check**

Run: `npx vue-tsc -b --noEmit`
Expected: no errors.

- [ ] **Step 9: Manual verification**

Start the dev server, log in, and confirm in the browser:
- The switcher pill appears next to the logo, showing the video-space icon and "Vidéo", and the sidebar shows the usual five video links.
- Clicking the pill opens a dropdown listing "Vidéo" and "Musique"; "Vidéo" is visually marked active.
- Clicking "Musique" navigates to `/music`; the pill now shows "Musique" and the sidebar shows the single "Bibliothèque" link; the placeholder page (Task 3) renders.
- Clicking the pill again and selecting "Vidéo" navigates back to `/` and the sidebar reverts to the five video links.
- Navigating the browser directly to `/music` via the URL bar (not through the switcher) still shows the music sidebar and the pill reading "Musique" — confirms the active space is derived from the route, not click history.
- Clicking anywhere outside an open switcher dropdown closes it (same as the existing user-menu dropdown).
- Opening the switcher dropdown while the user-menu dropdown is already open (or vice versa) — clicking one closes the other via the shared outside-click handler; no visual overlap.

- [ ] **Step 10: Commit**

```bash
git add app/layouts/default.vue
git commit -m "feat: wire space switcher into default layout"
```

---

## Self-Review Notes

- **Spec coverage:** `app/spaces/index.ts` (Task 1) ✓, active-space derivation + sidebar rewiring (Task 4, Steps 1 & 6) ✓, switcher pill+dropdown (Task 4, Steps 5 & 7) ✓, `EmptyState` music icon (Task 2) ✓, `/music` placeholder page (Task 3) ✓. Verification section's five bullet points are each covered by a manual-verification step in Tasks 3 and 4.
- **Placeholder scan:** none found — every step shows complete code, exact file paths, and exact commands.
- **Type consistency:** `Space.icon: string` (Task 1) is consumed as `activeSpace.icon` / `space.icon` (Task 4, template) — matches. `EmptyState`'s `icon` prop (Task 2) is consumed as `icon="music"` (Task 3) — matches, and `'music'` is in the updated union. `selectSpace(homeRoute: string)` (Task 4, Step 3) is called with `space.homeRoute` (Task 4, Step 5) — matches `Space.homeRoute: string` (Task 1).
