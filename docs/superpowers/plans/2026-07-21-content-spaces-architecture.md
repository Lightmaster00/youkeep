# Content Spaces Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the sidebar's hardcoded nav links into a typed `Space` registry (`app/spaces/index.ts`), and make `app/layouts/default.vue` render its nav from that registry instead of five hand-written `NuxtLink`s — with zero visible or behavioral change — so a future second space (Music/Podcasts/Audiobooks) can be added by extending the registry instead of restructuring nav/routing.

**Architecture:** One new small data module (the registry) consumed by one existing template via `v-for`. No new components, no new routes, no state management — this is a pure data-extraction refactor.

**Tech Stack:** Nuxt 4 / Vue 3 `<script setup lang="ts">`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-21-content-spaces-architecture-design.md` — read it before starting.
- Zero visible change. Every sidebar link must render with the identical route, label, icon (byte-identical inline SVG), and `mustChangePassword` visibility guard as today, on both the desktop hover-expand rail and the sub-768px collapsed layout, logged in and logged out.
- No space switcher UI, no settings toggle UI, no schema decisions for future spaces, no change to `app/middleware/auth.global.ts` — all explicitly out of scope per the spec's Non-Goals.
- No automated UI test suite exists for this project; `npm test`'s existing 35 tests don't cover `default.vue` and aren't expected to gain coverage from this change — verification is manual browser comparison.

---

### Task 1: Extract sidebar nav into a Space registry

**Files:**
- Create: `app/spaces/index.ts`
- Modify: `app/layouts/default.vue:66-95`

**Interfaces:**
- Produces: `interface SpaceNavLink { to: string; label: string; icon: string; hideWhenMustChangePassword?: boolean }`, `interface Space { id: string; label: string; homeRoute: string; navLinks: SpaceNavLink[] }`, and `export const spaces: Space[]` — a single entry for now (`id: 'video'`). Nothing else in the codebase consumes this yet; `default.vue` is the only consumer this task adds.

- [ ] **Step 1: Read the current sidebar nav verbatim**

Read `app/layouts/default.vue` lines 66-95 (the `<aside class="sidebar">` block). Confirm it still contains exactly 5 `NuxtLink`s (Home `/`, Shorts `/shorts`, Channels `/channels`, Subscriptions `/subscriptions`, Playlists `/playlists`), each with a `v-if="!user?.mustChangePassword"` guard, an inline `<svg>`, and a `<span>` label — this plan assumes that exact shape. If it doesn't match, stop and report the actual content instead of proceeding.

- [ ] **Step 2: Create the registry**

Create `app/spaces/index.ts`. Copy each `<svg>...</svg>` string byte-for-byte from the current template into the `icon` field below — do not retype them by hand (risk of a stray attribute or whitespace difference that changes rendering).

```ts
export interface SpaceNavLink {
  to: string;
  label: string;
  icon: string; // raw inline-SVG markup, rendered via v-html
  hideWhenMustChangePassword?: boolean;
}

export interface Space {
  id: string;
  label: string;
  homeRoute: string;
  navLinks: SpaceNavLink[];
}

export const spaces: Space[] = [
  {
    id: 'video',
    label: 'Vidéo',
    homeRoute: '/',
    navLinks: [
      {
        to: '/',
        label: 'Home',
        icon: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>',
        hideWhenMustChangePassword: true,
      },
      {
        to: '/shorts',
        label: 'Shorts',
        icon: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect><line x1="12" y1="18" x2="12.01" y2="18"></line></svg>',
        hideWhenMustChangePassword: true,
      },
      {
        to: '/channels',
        label: 'Channels',
        icon: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.33z"></path><polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02"></polygon></svg>',
        hideWhenMustChangePassword: true,
      },
      {
        to: '/subscriptions',
        label: 'Subscriptions',
        icon: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>',
        hideWhenMustChangePassword: true,
      },
      {
        to: '/playlists',
        label: 'Playlists',
        icon: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>',
        hideWhenMustChangePassword: true,
      },
    ],
  },
];
```

- [ ] **Step 3: Replace the hardcoded nav with a `v-for` over the registry**

In `app/layouts/default.vue`, replace the `<nav class="sidebar-nav">...</nav>` block (currently lines 68-93, the five `NuxtLink`s) with:

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

Use `v-show`, not `v-if`, here: the original used `v-if` per-link (each link independently mounted/unmounted), but since all five links share the identical guard condition in this registry-driven version, `v-show` (toggle visibility, keep mounted) is behaviorally equivalent for this codebase's usage — `mustChangePassword` doesn't change mid-session without a full page navigation to `/account` (per `app/layouts/default.vue`'s existing `checkPasswordEnforcement`), so there's no meaningful mount/unmount timing difference a user could observe. This keeps the template simpler than repeating a `v-if` inside `v-for`.

**Do not wrap the icon in a bare `<span>`.** `app/layouts/default.vue`'s existing CSS has `.sidebar-link span { opacity: 0; ... }` / `.sidebar-inner:hover .sidebar-link span { opacity: 1; }`, written for the *label* span (so labels fade in on hover-expand). That's a descendant selector — if the icon were also wrapped in a `<span>`, it would match too and the icon itself would incorrectly fade to invisible at rest. The `<i class="sidebar-link-icon">` wrapper above avoids this collision entirely (no CSS today targets `span` will match it, and no new CSS is needed — the existing `.sidebar-link svg { flex-shrink: 0; }` and `.sidebar-link.active svg { color: white; }` rules are descendant selectors that still reach the nested `<svg>` inside `<i>` exactly as they reached the bare `<svg>` before).

In the `<script setup>` block of `app/layouts/default.vue`, add the import (alongside the existing imports near the top):

```ts
import { spaces } from '~/spaces';
```

- [ ] **Step 4: Verify the icon renders correctly via `v-html`**

`v-html` requires the bound value to be trusted markup — confirm each `icon` string in the registry is a complete, well-formed `<svg>...</svg>` element (it is, copied verbatim in Step 2) and that no user input ever flows into this field (it doesn't; `spaces` is a static compile-time constant, not derived from any request or database value). This is safe precisely because the content is a fixed literal, not a security-sensitive use of `v-html`.

- [ ] **Step 5: Manual verification in the browser**

Run `npm run dev`. Compare the sidebar before/after (or check against the description in Step 1 if you didn't capture a screenshot first): confirm all 5 links still show with the correct icon, label, and route, in the same order, both logged in and logged out (for `/`, `/channels`, which are public routes — `/shorts`, `/subscriptions`, `/playlists` require login, so check those while logged in). Hover the rail and confirm labels still appear via the existing hover-expand behavior (unrelated to this change, but confirms nothing broke). Resize to under 768px and confirm the mobile icon-only layout is unchanged. If you have an account with `mustChangePassword` set, confirm the whole nav is hidden for it, matching the old `v-if` behavior.

- [ ] **Step 6: Run the test suite**

Run: `npm test`
Expected: 35 passed (35) — this change has no test coverage today and none is being added (per Global Constraints), so this is a pure regression check.

- [ ] **Step 7: Commit**

```bash
git add app/spaces/index.ts app/layouts/default.vue
git commit -m "refactor: extract sidebar nav links into a Space registry

Prepares for a future second space (music/podcasts/audiobooks) without
presupposing anything about it — this commit only re-expresses the
existing Video-only nav as data, with zero visible or behavioral change."
```
