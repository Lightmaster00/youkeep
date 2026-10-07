# Unified Navigation (one sidebar, no space switcher) — Design

**Status:** Approved in chat (2026-10-07)

## Goal
Remove the hidden "space switcher" in the header. One sidebar, always the same, lists Video, Music and Podcasts so any page is one click away. User feedback: the separated spaces are a brake, not natural.

## Decisions (user)
- Model: **one sidebar** with three always-visible groups (not tabs, not a nicer switcher).
- Home: **keep the video home as is** (a mixed home is out of scope).
- Nav copy is English (Video, Music, Podcasts, Library).

## Behaviour
- Sidebar groups in fixed order: **Video** (Home, Shorts, Channels, Subscriptions, Playlists), **Music** (Library), **Podcasts** (Library). The existing collapsed icon rail stays: a thin divider separates groups; on hover (desktop) each group shows its title (`.sidebar-divider-title`); on mobile titles stay hidden.
- Module gating: a disabled module's group is hidden for regular users; admins see it dimmed with an "Off" badge (as the switcher did). The group of the current page is highlighted through the links' normal `active` state.
- `hiddenNavLinks` and `landingSpace` preferences keep working unchanged (same link ids, `filterNavLinks` applied to the Video group).
- The header space switcher and its CSS/state (`spaceMenuOpen`, `toggleSpaceMenu`, `selectSpace`, `visibleSpaces`) are removed.
- Header search keeps its current scope logic: the section of the current route (`resolveActiveSpaceId`) unless the admin chose global search. Unchanged.
- No page, route, redirect or API changes.

## Architecture
- `app/spaces/index.ts`: copy becomes English (`Video`, `Music`, `Podcasts`, `Library`); each space keeps `id`, `icon`, `homeRoute`, `navLinks`.
- New pure helper `buildSidebarGroups(spaces, { isAdmin, enabled, hiddenNavLinks, mustChangePassword })` in `app/utils/sidebarGroups.ts` returning `[{ id, label, enabled, links }]` (disabled groups only for admins; links filtered by `filterNavLinks`; links with `hideWhenMustChangePassword` dropped when a password change is required; groups left empty are omitted).
- `app/layouts/default.vue` renders the groups; `visibleNavLinks`, `visibleSpaces` and the switcher markup are deleted.

## Testing
- Unit tests for `buildSidebarGroups` (module gating for admin vs user, hidden links, mustChangePassword, empty-group omission).
- Component test: layout renders three group titles and the right links; no `.space-switcher` element.
- Real check in the Browser pane (desktop + mobile preset): all groups visible, navigation works across spaces, disabled module hidden/dimmed, search scope follows the page.
