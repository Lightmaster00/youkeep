# Space Switcher — Design

## Context

Music mode's sub-project 3 ("library UI") was decomposed into 3a (file serving & access control, done), 3b (admin ingestion UI, done), and 3c (catalog browsing UI, not started). While scoping 3c, it became clear that YouKeep's app shell (`app/layouts/default.vue`) hardcodes `spaces[0].navLinks` in its sidebar — there is exactly one space (`video`) defined in `app/spaces/index.ts`, and no UI exists to switch between spaces. This file is the not-yet-wired-up implementation of the long-standing "togglable content-type spaces" product vision (video/music/podcast/audiobook, see the `project_multi_content_vision` project memory).

Given a real music catalog UI is about to be built (3c), the user chose to build the real space-switching mechanism now rather than bolt a single `/music` link onto the video sidebar — this sub-project delivers that switcher, sequenced immediately before 3c so 3c's pages have somewhere to live.

## Scope

- A second `music` entry in `app/spaces/index.ts`.
- A space-switcher control in the header, next to the logo, that lists both spaces and navigates to the selected space's `homeRoute`.
- `app/layouts/default.vue` rewired so its sidebar renders the *active* space's `navLinks` (derived from the current route), not `spaces[0]` unconditionally.
- A minimal placeholder page at `app/pages/music/index.vue` so the music space's home route resolves to something real instead of a 404.

## Non-Goals

- No catalog content (artist/album browsing, filters, manual metadata editing) on the music placeholder page — that is sub-project 3c, which will build out this same route.
- No third space, no persisted/stored space preference — active space is derived purely from the current route.
- No changes to any existing video-space route, page, or endpoint.
- No playback — out of scope for all of Music mode's sub-project 3/4 split (agreed earlier in Music mode's design).

## Design

### 1. `app/spaces/index.ts`

Add an `icon` field to the `Space` interface (used by the switcher's pill button and dropdown rows — the existing `SpaceNavLink.icon` field is per-link, not per-space) and a second entry:

```ts
export interface Space {
  id: string;
  label: string;
  icon: string; // raw inline-SVG markup, rendered via v-html — used by the space switcher
  homeRoute: string;
  navLinks: SpaceNavLink[];
}
```

- `video` space gets `icon` set to the existing home-link SVG (already defined inline for `navLinks[0]`).
- New `music` space:
  ```ts
  {
    id: 'music',
    label: 'Musique',
    icon: '<svg ...>music note icon...</svg>',
    homeRoute: '/music',
    navLinks: [
      {
        to: '/music',
        label: 'Bibliothèque',
        icon: '<svg ...>same music note icon...</svg>',
        hideWhenMustChangePassword: true,
      },
    ],
  }
  ```
  One nav link only — there is nothing else to link to yet. 3c will add more links here (e.g. an artist-detail route) as it builds them; that's a routine edit to this array, not a re-architecture.

### 2. Active-space derivation

`default.vue` computes the active space from the current route, no stored state:

```ts
const activeSpace = computed(() =>
  route.path.startsWith('/music') ? spaces.find(s => s.id === 'music')! : spaces.find(s => s.id === 'video')!
);
```

Explicit prefix check rather than a generic "match against every space's navLinks" scan: the video space owns many routes that aren't in its `navLinks` array at all (`/watch/[id]`, `/account`, `/settings`, search results on `/`), so "default to video unless the path is under `/music`" is the correct and simplest rule. If a third space is added later, this becomes a small `if`/`else if` chain — not a blocker for now.

The sidebar's `<nav>` loop changes from `v-for="link in spaces[0].navLinks"` to `v-for="link in activeSpace.navLinks"`.

### 3. Space-switcher control

Placed in `.header-left`, immediately after the logo. Visually mirrors the existing `.user-menu` pattern (pill button: icon + label + chevron, `rgba(255,255,255,0.03)` background, hover/active elevation), opening a `.dropdown-menu`-style panel listing both spaces (icon + label per row). Implementation mirrors the existing dropdown wiring exactly:

- New `spaceMenuOpen = ref(false)`, toggled by `@click.stop`, closed by the existing `window.addEventListener('click', ...)` handler (extended to also close the space menu) and by selecting an option.
- Each row calls `navigateTo(space.homeRoute)` and closes the menu; the currently-active space's row gets a visual `active` state but is still clickable (no-op navigation to a route the user is already on is harmless — `navigateTo` on the current path doesn't error).
- No keyboard/focus-trap work beyond what the existing dropdown already does (it has none either) — same bar, not a regression.

### 4. `app/pages/music/index.vue`

Static placeholder, no data fetching (that's 3c's job — this page will be the one 3c fills in, not a separate route to migrate later):

```vue
<template>
  <EmptyState
    icon="music"
    title="Bibliothèque musicale"
    description="La navigation par artiste et album arrive bientôt."
  />
</template>

<script setup lang="ts">
definePageMeta({ middleware: 'auth' });
</script>
```

Reuses the existing `EmptyState` component (`app/components/EmptyState.vue`, already used by `channels.vue`, `subscriptions.vue`, `shorts.vue`, `index.vue`) rather than inventing new empty-state markup. `EmptyState`'s `icon` prop is currently a closed union (`'book' | 'channels' | 'shorts' | 'folder' | 'video'`) with no music-shaped option — add a `'music'` variant (same pattern as the existing ones: a new `v-else-if` branch with a feather-style music-note SVG) so the placeholder doesn't have to reuse a mismatched icon. This is the same kind of small, in-pattern addition as adding a new icon to any existing icon set, not a new component.

`definePageMeta({ middleware: 'auth' })` matches the auth-gating already applied to other top-level pages (e.g. `channels.vue`) — the music space's home page needs to be behind login exactly like the video space's equivalent pages.

## Error Handling

- No new error states — this sub-project introduces no data fetching, no forms, no new endpoints. The only "failure" mode is navigating to `/music` while logged out, which the existing `auth` middleware already handles identically to every other protected page.

## Verification

- Browser: from a logged-in session, open the space switcher, confirm both spaces are listed with correct icons/labels, the video space is marked active by default.
- Click "Musique": navigates to `/music`, sidebar swaps to the music space's single nav link, `EmptyState` renders with the music icon and placeholder copy.
- Click "Vidéo" from within `/music`: navigates back to `/`, sidebar reverts to the five video nav links.
- Directly visiting `/music` via URL (not through the switcher) still resolves the sidebar to the music space (proves derivation is route-based, not click-state-based).
- Confirm the space switcher closes on outside click, same as the existing user-menu dropdown.
- `npx vue-tsc -b --noEmit` clean (the only command in this repo that actually type-checks — `vue-tsc --noEmit -p .` is a silent no-op).
