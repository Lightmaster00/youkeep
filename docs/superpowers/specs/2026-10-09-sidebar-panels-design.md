# Sidebar panels (accordion by space) — Design

**Status:** Approved in chat (2026-10-09). Replaces the always-expanded groups of the unified sidebar (2026-10-07-unified-navigation-design.md) with accordion panels, keeping the notion of spaces. No header space switcher.

## Behaviour
- Each space (Video, Music, Podcasts) is a **panel**: a header button (space icon + label + chevron) followed by its links. **One panel is open at a time**; opening one closes the others.
- On load and whenever the route moves to another space, the panel of the current space opens (`resolveActiveSpaceId`; module-less pages like /account, /search, /settings use the same fallback as the search scope). A user can open another panel by hand (that does NOT navigate); opening is exclusive. Clicking the open panel's header closes it (all panels may be closed).
- The last manually chosen state (open id or none) is remembered per browser in `localStorage` (try/catch, page renders fine without it) and applies only until the route changes space.
- Module gating and prefs unchanged (`buildSidebarGroups`): disabled modules hidden for users, dimmed with an "Off" badge for admins; hidden nav links, guest-only filtering, mustChangePassword handling all stay. The group list gains `icon` (from `spaces[].icon`).
- Accessibility: header is a real `<button>` with `aria-expanded` and `aria-controls`; panel content has `role="region"` + `aria-labelledby`; Enter/Space toggles; focus stays on the header; `prefers-reduced-motion` disables the height animation.
- Desktop rail (existing 64px icon rail that widens on hover): collapsed rail shows each header icon; the open panel's link icons appear under its header, closed panels show only the header icon. On hover the rail widens and labels/titles/chevrons appear (same behaviour as today). Mobile (≤768px): same icon-only structure, labels hidden, tapping a header icon opens that panel.
- Animation: panel content height animates with `grid-template-rows: 0fr → 1fr` (≤200 ms).

## Architecture
- `app/utils/sidebarGroups.ts`: add `icon` to each group; new pure `resolveOpenPanel({ activeSpaceId, manual, groupIds })` (manual = `{ id: string | null } | undefined`; returns the open id or null; manual wins only while the route's space did not change since it was set — tracked by the layout via the space id at set time).
- New component `app/components/SidebarPanels.vue` (props: groups, activeSpaceId, mustChangePassword already applied) holds the accordion state and storage; `app/layouts/default.vue` renders it in place of the current group loop and keeps only the rail CSS that still applies (move panel styles into the component).
- No route, API or preference changes.

## Testing
- Unit: `resolveOpenPanel` (route opens its space, manual override, manual ignored after the route changes space, unknown space, none open).
- Component (`SidebarNav` + new `SidebarPanels` tests): exactly one panel open; route auto-open; clicking another header opens it and closes the first without navigating; clicking the open header closes it; `aria-expanded`/`aria-controls`; storage failure does not break; guests/disabled modules still filtered; Off badge for admins.
- Real check by the controller in Docker + Browser pane (desktop and phone preset): click through the three panels, navigate across spaces, reload (state restored), keyboard toggle, no console errors.
