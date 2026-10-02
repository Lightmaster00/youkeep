# Module Switches (Video / Music / Podcasts) — Design

**Status:** Approved

## Goal

Let the administrator switch each of YouKeep's three modules — Video, Music, Podcasts — on or off. A disabled module disappears for regular users and **all of its background work stops** (download queue, scheduled sync); its data is left untouched, and everything resumes when it is re-enabled. At least one module must always remain enabled.

This is sub-project A of a two-part request. Sub-project B (light display customization: layout, home-feed "algorithm", etc.) is deliberately deferred to its own brainstorm and builds on the list of active modules this project introduces.

## Context

- Spaces are declared in `app/spaces/index.ts`: `video` (home route `/`, nav links Home/Shorts/Channels/Subscriptions/Playlists), `music` (`/music`), `podcasts` (`/podcasts`). `app/layouts/default.vue` derives the visible spaces and the active space from the route and renders the space switcher and header search.
- Only Music has a switch today: setting `music_module_enabled` (seeded `'1'` in `server/utils/db.ts`), public `GET /api/settings/music-module`, admin `POST /api/admin/settings/music-module`, `server/middleware/musicModuleGate.ts` (404 for `/api/music/*` and `/downloads-music/*` unless the caller is an admin), a "Module Musique" switch in `app/components/settings/SettingsMusicTab.vue`, and a "Désactivé" badge for admins in the layout.
- Today, disabling Music **only hides it**: the setting is read solely by the route gate, so Music downloads and sync keep running in the background. This project changes that.
- Each module already has a pause flag (`downloader_paused`, `music_downloader_paused`, `podcast_downloader_paused`) read at about three places per module in `server/utils/downloader.ts`, `musicDownloader.ts`, `podcastDownloader.ts`, plus a cron job per module (`initScheduler`, `initMusicScheduler`, `initPodcastScheduler`). Queue workers are started by `server/plugins/scheduler.ts`.
- Existing middlewares this must coexist with: `forcePasswordChange.ts`, `securityHeaders.ts`, `csrf.ts`, and API-token auth through `getUserFromSession`.

## Scope

**In scope**
- A generic, central notion of "module enabled" with one switch per module (admin-only).
- A route gate covering every module's API and file routes, replacing `musicModuleGate`.
- Background work (workers and crons) skipping a disabled module without touching the admin's own pause state.
- A "Modules" panel in Settings → System; the redirect and hiding behaviour for regular users; the admin badge.
- Search behaviour (global search page, header autocomplete) ignoring disabled modules.

**Out of scope**
- Sub-features of Video (Shorts, Channels, Subscriptions, Playlists) — handled by sub-project B.
- Per-user module visibility (switches are global).
- Any display/layout customization (sub-project B).
- Deleting a module's data.

## Architecture

### Storage

Three keys in the existing `settings` table: `video_module_enabled` and `podcasts_module_enabled` (new, seeded `'1'` when missing, same idempotent seeding pattern as the other settings) and the existing `music_module_enabled`, unchanged — so existing installs need no migration. A value of `'0'` means disabled; anything else (including a missing row) means enabled.

### Central module `server/utils/modules.ts`

- `type ModuleId = 'video' | 'music' | 'podcasts'`.
- `MODULE_SETTING_KEYS: Record<ModuleId, string>`.
- `isModuleEnabled(db, id): boolean` — reads the setting; fails open (enabled) if the read throws.
- `getEnabledModules(db): ModuleId[]`.
- `setModulesEnabled(db, changes: Partial<Record<ModuleId, boolean>>)` — validates that the resulting state keeps at least one module enabled and throws a typed error otherwise, then writes all changes in one transaction.
- `MODULE_ROUTE_PREFIXES: Record<ModuleId, string[]>`:
  - `video`: `/api/videos`, `/api/channels`, `/api/playlists`, `/api/home`, `/downloads` (matched as `/downloads` or `/downloads/…` only — never `/downloads-music` or `/downloads-podcasts`)
  - `music`: `/api/music`, `/downloads-music`
  - `podcasts`: `/api/podcasts`, `/downloads-podcasts`

### Route gate `server/middleware/moduleGate.ts`

Replaces `musicModuleGate.ts` (deleted). For a request whose path matches a module's prefix exactly or as `prefix/…`: if that module is enabled, continue; otherwise allow admins (resolved through `getUserFromSession`, so API tokens work) and answer everyone else with the same 404 shape as today. Routes for auth, account, settings and admin are never in the prefix table, so they are never gated. A failure while reading the setting or the session falls through to "allow", as the current gate does.

### Background work

A small helper (e.g. `isModuleActive(db, id)` in `modules.ts`) is used by:
- the pause checks in each downloader (worker loop and per-item processing): effective pause = `paused OR NOT enabled`;
- each cron callback and each "sync all" entry point: return immediately when the module is disabled.
The admin's own pause flag is never read-modified-written by the switch, so re-enabling restores exactly the previous state. Work already in flight when a module is disabled completes; no new item starts.

### API

- `GET /api/settings/modules` (public): `{ video: boolean, music: boolean, podcasts: boolean }`. Added to the allow-list implicitly by the existing `/api/settings/` prefix.
- `POST /api/admin/settings/modules` (admin, CSRF as usual): body with any subset of `video|music|podcasts` booleans; `400` if a value is not a boolean or if the result would leave no module enabled; nothing is written in that case.
- The old `GET /api/settings/music-module` and `POST /api/admin/settings/music-module` routes are removed; their tests are migrated to the new endpoints.

### Client

- Composable `app/composables/useModules.ts`: fetches `/api/settings/modules` once, exposes reactive `modules`, `enabledModules`, `isEnabled(id)`, `firstEnabledHome` (home route of the first enabled space, in the order video, music, podcasts) and `refresh()`. On fetch failure everything is treated as enabled.
- `app/layouts/default.vue`: `visibleSpaces` hides disabled spaces for non-admins; admins see them with the "Désactivé" badge (generalised from the Music-only badge). The header autocomplete and `handleSearch` ignore disabled spaces.
- `app/middleware/auth.global.ts` (or a dedicated global route middleware): a non-admin navigating to a page owned by a disabled module (`/` and the video pages, `/music*`, `/podcasts*`) is redirected to `firstEnabledHome`.
- `app/pages/search.vue`: in global mode, skips the fetch and the section of every disabled module.

### Settings UI

A "Modules" panel at the top of `SettingsSystemTab.vue` with three switches (label, short description, state). The switch of the only remaining enabled module is disabled with an explanatory message. The "Module Musique" switch in `SettingsMusicTab.vue` is removed; the separate "Clips vidéo" switch stays.

## Error Handling

- Disabling the last enabled module, even by a direct API call: `400`, state unchanged.
- Settings cannot be read on the client: all modules treated as enabled, so an admin can never be locked out by a transient error.
- Requests already running when a module is disabled finish normally; only new requests are refused.
- Gate or session lookup errors never turn into a blanket 404: they fall through to "allow".

## Testing

- Unit/integration for `modules.ts`: default state, per-module read, fail-open on a read error, `setModulesEnabled` (valid change, last-module refusal, atomic write, non-boolean rejection).
- Integration for `moduleGate`: for each module and each of its prefixes — enabled (everyone passes), disabled (admin via cookie and via API token passes; regular user and guest get 404); `/downloads` vs `/downloads-music` vs `/downloads-podcasts` prefix isolation; auth/account/settings/admin routes are never gated.
- Integration for the new routes: public read shape; admin-only write (401/403 otherwise); last-module `400`; partial updates leave the other modules untouched.
- Downloaders: a disabled module's worker/cron does not start new work; re-enabling resumes; the admin's pause flag is unchanged by toggling.
- Migrated tests from the old music-module routes keep passing against the new endpoints.
- Manual verification in a real Docker container with the Browser pane on the Mac's LAN IP (not `curl` alone — interactive-UI bugs escaped curl-only verification in several previous sub-projects): disable each module in turn and check the space switcher, navigation, the redirect from `/`, the admin badge, the grayed-out last switch, global search and autocomplete ignoring the disabled module, downloads genuinely stopping and resuming, and the reverse.
