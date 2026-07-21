# Content Spaces Architecture — Foundation

## Context

Long-term, YouKeep should host more than video: music, podcasts, and audiobooks, each as an independently toggleable "space" within the app (see project memory `project_multi_content_vision`). That's explicitly **not** being built now — this spec covers only the groundwork so that adding a real space later doesn't require restructuring navigation, routing, or settings that were written as if video were the only content type that would ever exist.

Right now exactly one space (Video) will exist and be visible. Music/Podcasts/Audiobooks are not being scaffolded, toggled, or even mentioned in the UI yet — there's nothing behind them, and a switcher or settings toggle for an empty space would be dead UI to maintain for no benefit. This spec produces **no visible change** to the app. Its only output is an internal refactor: the current sidebar navigation (Home, Shorts, Channels, Subscriptions, Playlists) stops being hand-written directly in `app/layouts/default.vue` and becomes the rendered output of a declared "Video" space definition, in a registry structured to hold more than one space later.

## Non-Goals

- No space switcher UI (pointless with one space; specified below only as a forward-looking placement decision for when it's needed).
- No settings toggle UI for enabling/disabling spaces (nothing to toggle yet).
- No schema/data-model decisions for music, podcasts, or audiobooks — each future space designs its own data model when it's actually built; this spec doesn't presuppose a shared generic content table.
- No change to `app/middleware/auth.global.ts`'s `publicRoutes` mechanism — route protection and nav-space grouping are different concerns and this spec doesn't merge them, to avoid touching auth behavior as a side effect of a nav refactor.
- No visual change to the sidebar itself — this is orthogonal to (and can land before, after, or alongside) the pending UI redesign round-2 spec, which changes the sidebar's *presentation* (icon rail). That spec should consume whatever this one produces rather than being refactored twice; exact sequencing is a planning-time decision, not fixed here.

## The Registry

A new module, `app/spaces/index.ts`, exports a typed array of space definitions:

```ts
interface SpaceNavLink {
  to: string;
  label: string;
  icon: string; // raw inline-SVG markup, copied verbatim from the current sidebar-link icons (no icon-component system introduced)
  hideWhenMustChangePassword?: boolean; // mirrors the current `v-if="!user?.mustChangePassword"` guard
}

interface Space {
  id: string;           // 'video' for now
  label: string;        // 'Vidéo'
  homeRoute: string;     // '/'
  navLinks: SpaceNavLink[];
}

export const spaces: Space[] = [
  {
    id: 'video',
    label: 'Vidéo',
    homeRoute: '/',
    navLinks: [
      { to: '/', label: 'Home', icon: '...', hideWhenMustChangePassword: true },
      { to: '/shorts', label: 'Shorts', icon: '...', hideWhenMustChangePassword: true },
      { to: '/channels', label: 'Channels', icon: '...', hideWhenMustChangePassword: true },
      { to: '/subscriptions', label: 'Subscriptions', icon: '...', hideWhenMustChangePassword: true },
      { to: '/playlists', label: 'Playlists', icon: '...', hideWhenMustChangePassword: true },
    ],
  },
];
```

This is a straight extraction of what's already hardcoded in `app/layouts/default.vue`'s `<nav class="sidebar-nav">` block (5 `NuxtLink`s, each with an inline SVG and the same `mustChangePassword` guard) — no new links, no renamed routes, no icon changes. `default.vue` is updated to `v-for` over `spaces[0].navLinks` instead of listing the five links by hand, proving the abstraction actually drives rendering rather than being documentation nobody reads.

Video-specific behavior that lives outside plain nav links — the search bar in the header, the download-queue badge on the Settings link — stays exactly where it is in `default.vue`. It is not pulled into the registry; only the plain link list is. Trying to generalize header search or the download badge into the space registry now would be designing for content types (music search? podcast download queue?) that don't exist yet and aren't being decided today.

## Forward-Looking Decisions (recorded now, not built now)

Two UI questions were resolved in advance so that whoever builds the next real space doesn't have to re-litigate them:

- **Space switcher placement**: when a second space is ever built, the switcher goes at the top of the icon rail (above the nav links), not in the header. Confirmed with the user during this spec's design.
- **Space visibility while empty**: a space with nothing behind it stays completely invisible in the product (no "coming soon" entries in settings or a switcher) until it's actually built — confirmed as the preferred approach over showing disabled/greyed placeholders.

## Verification

This is an internal refactor with zero intended behavior change. Verification is: every sidebar link still renders with the same route, label, icon, and `mustChangePassword` visibility behavior as before, on desktop and the sub-768px collapsed layout, both logged in and (for the routes that are public) logged out. `npm test`'s existing 23 tests aren't affected by this change (no coverage over `default.vue` today) and should still pass.
