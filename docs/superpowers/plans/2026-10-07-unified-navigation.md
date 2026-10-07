# Unified Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or executing-plans.

**Goal:** Replace the header space switcher with a single sidebar listing Video, Music and Podcasts groups.
**Architecture:** pure `buildSidebarGroups` helper + layout rendering; spaces copy in English. Spec: `docs/superpowers/specs/2026-10-07-unified-navigation-design.md`.
**Tech Stack:** Nuxt 4, Vue 3, Vitest (`server` + `component` projects).

## Global Constraints
- English copy only. Same link ids (`/`, `/shorts`, `/channels`, `/subscriptions`, `/playlists`, `/music`, `/podcasts`); `filterNavLinks`, `resolveActiveSpaceId`, search logic untouched.
- Commit trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Run focused tests while iterating, full `npx vitest run` + `npx nuxt build 2>&1 | tail -5` before each commit. Never push.

### Task 1: Sidebar groups helper + English spaces copy
**Files:** Modify `app/spaces/index.ts`; Create `app/utils/sidebarGroups.ts`, `tests/unit/sidebarGroups.test.ts`.
- [ ] In `app/spaces/index.ts` change labels: `Vidéo`→`Video`, `Musique`→`Music`, both `Bibliothèque`→`Library`.
- [ ] Create `buildSidebarGroups(spaces, { isAdmin, enabled: ModuleId[], hiddenNavLinks, mustChangePassword })` returning `{ id, label, enabled, links }[]`: skip a space when `!isAdmin && !enabled.includes(id)`; `enabled` field = `enabled.includes(id)`; links = `filterNavLinks(space.navLinks, hiddenNavLinks)` minus links with `hideWhenMustChangePassword` when `mustChangePassword`; omit groups with no links.
- [ ] Unit tests: user with music disabled has no Music group; admin sees it with `enabled:false`; hidden `/shorts` removed but `/` kept; mustChangePassword yields no groups; order Video, Music, Podcasts. Mutation-check the gating condition.
- [ ] Full suite + build; commit `feat: sidebar groups helper and English space labels`.

### Task 2: Render one sidebar, remove the switcher
**Files:** Modify `app/layouts/default.vue`; Create `tests/component/SidebarNav.test.ts`.
- [ ] Delete the `.space-switcher` block (template ~lines 10-27), `spaceMenuOpen`, `toggleSpaceMenu`, `selectSpace`, `visibleSpaces`, `visibleNavLinks`, the `.space-switcher*`/`.space-menu*` CSS and the `.space-switcher-label` mobile rule (also remove the `v-html`-only leftovers). Keep `activeSpace` (search scope) and its imports; fix the click-outside handler that closed `spaceMenuOpen` (line ~317).
- [ ] Sidebar template: `v-for` over `sidebarGroups = computed(() => buildSidebarGroups(spaces, { isAdmin, enabled: enabledModules, hiddenNavLinks: displayPrefs.effective.value.hiddenNavLinks, mustChangePassword: !!user.value?.mustChangePassword }))`; for each group render `<div class="sidebar-group" :class="{ 'is-off': !group.enabled }">` with `<div class="sidebar-divider-title">{{ group.label }}<span v-if="!group.enabled" class="badge badge-failed">Off</span></div>` followed by the existing `NuxtLink` markup for its links. Style: `.sidebar-group + .sidebar-group` gets a top border; `.is-off` opacity .5; the title is `opacity:0` collapsed and 1 on `.sidebar-inner:hover` (hidden on mobile via the existing media rule).
- [ ] Component test (mountSuspended, stub `$fetch` as in other layout-adjacent tests): three group titles in order; Shorts etc. present; no `.space-switcher`; a hidden-link pref removes its link.
- [ ] Translate the leftover French in the layout nav area (`Désactivé`, `Effacer` search-history clear → `Clear`) if present.
- [ ] Full suite + build; commit `feat: one sidebar with Video, Music and Podcasts groups`.

### Task 3: Real verification (controller)
- [ ] Run the app (Docker or dev), Browser pane preset desktop then mobile: groups visible, navigation across Video/Music/Podcasts in one click, disabled module hidden for a user and dimmed "Off" for admin, search scope follows the page, no console errors. Fix findings; record in `.superpowers/sdd/progress.md`.
