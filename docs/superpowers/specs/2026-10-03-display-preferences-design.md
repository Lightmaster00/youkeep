# Display Preferences (B1: preferences foundation, density, navigation, landing space) — Design

**Status:** Approved

## Goal

Let each user adapt how YouKeep looks and where it starts, with the administrator setting the instance-wide defaults. B1 delivers the preferences foundation (per-user storage + admin defaults + API + client composable + UI) and the first three settings built on it: grid **density**, which **navigation links** are shown, and the default **landing space**.

This is sub-project B1 of the second half of the original request ("customiser légèrement l'affichage: mise en page, algorithme…"). Part A (module on/off switches) is merged. **B2** — configurable home-feed sections and the ranking "algorithm" (server-side changes to `server/api/home/feed.get.ts`) — is deliberately deferred to its own cycle and will reuse the foundation built here. Theme (light/dark) and UI language are out of scope for both: the interface is designed dark/violet with translucent surfaces, and its text mixes English and French in hundreds of places, so neither is a "light" setting.

## Context

- Navigation per space is declared in `app/spaces/index.ts` (video: Home `/`, Shorts `/shorts`, Channels `/channels`, Subscriptions `/subscriptions`, Playlists `/playlists`; music and podcasts: a single "Bibliothèque" link). `app/layouts/default.vue` renders the sidebar straight from `activeSpace.navLinks`.
- Video grids are defined **per page**, in scoped CSS, with different column counts: `app/pages/index.vue` `.video-grid` is 4/3/2/1 columns by breakpoint, `app/pages/channels.vue` is 3/2/1, and `app/pages/subscriptions.vue`, `app/pages/search.vue`, `app/components/channels/ChannelVideoGrid.vue` and `ChannelPlaylistsTab.vue` define their own. There is no shared grid CSS.
- Settings: `app/pages/settings.vue` is admin-only; the `settings` table is a global key/value store (public reads under `/api/settings/*`, admin writes under `/api/admin/settings/*` with `requireAdmin` + CSRF). The only per-user page is `app/pages/account.vue`; per-user profile data lives in columns of the `users` table. There is no per-user preferences storage yet.
- Part A infrastructure available: `server/utils/modules.ts`, `useModules()`, `moduleForPagePath`, `resolveActiveSpaceId`, and the global route middleware `app/middleware/auth.global.ts`.
- Cross-cutting constraints: `forcePasswordChange` already allow-lists `/api/settings/`; `moduleGate` never gates `/api/settings` or `/api/account`; API-token (Bearer) auth resolves through `getUserFromSession`, so a mobile client can read and write preferences like the web UI.

## Scope

**In scope**
- A per-user preferences store and an admin-set defaults store, with one typed, validated schema.
- Three settings: `density`, `hiddenNavLinks`, `landingSpace`.
- Account page "Affichage" section (per user) and Settings → System "Affichage par défaut" panel (admin), sharing one form component.

**Out of scope** (deferred)
- Home-feed sections, their order and count, the hero block, ranking criteria and recommendation weighting (B2).
- Theme and language.
- Per-page sort defaults.
- Access control: hiding a navigation link does not block the page.

## Architecture

### Schema and merge rules (server)

New module `server/utils/displayPrefs.ts` is the single source of truth.

```typescript
export type Density = 'compact' | 'comfortable' | 'spacious';
export type LandingSpace = 'auto' | 'video' | 'music' | 'podcasts';
export const HIDEABLE_NAV_LINKS = ['/shorts', '/channels', '/subscriptions', '/playlists'] as const;

export interface DisplayPrefs {
  density: Density;
  hiddenNavLinks: string[];   // subset of HIDEABLE_NAV_LINKS, no duplicates
  landingSpace: LandingSpace;
}

export const APP_DEFAULTS: DisplayPrefs = { density: 'comfortable', hiddenNavLinks: [], landingSpace: 'auto' };
```

- A stored/received object is a **partial** (`Partial<DisplayPrefs>`).
- `validatePartial(input)` ignores unknown keys, rejects an invalid value for a known key (throws a typed `InvalidPrefError` naming the key), and treats `null` as "remove this key" (a deletion marker). It returns `{ set: Partial<DisplayPrefs>, remove: (keyof DisplayPrefs)[] }`.
- `mergePrefs(base, partial)` is shallow, per key (an array replaces, it never merges).
- Resolution order: `APP_DEFAULTS` → admin defaults → user overrides.
- A corrupt stored JSON value (unparseable, wrong shape, invalid member values) is treated as an empty partial; it never throws at read time.

### Storage

- `user_preferences(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, data TEXT NOT NULL, updated_at INTEGER NOT NULL)`, created with `CREATE TABLE IF NOT EXISTS` in `server/utils/db.ts` (and mirrored in `tests/helpers/testDb.ts`). It stores **only the keys the user changed**.
- Admin defaults: setting key `display_defaults` (JSON partial) in the existing `settings` table; absent means "no admin defaults".

### API

- `GET /api/settings/display` — public. Returns `{ effective, defaults, overrides, adminDefaults }`:
  - `defaults` = `APP_DEFAULTS` merged with the admin defaults (what a user sees when they have made no personal choice),
  - `adminDefaults` = the raw admin partial (so the admin panel knows which keys are set at instance level),
  - `overrides` = the caller's stored partial, or `null` for a guest,
  - `effective` = `defaults` merged with `overrides`.
  Guests get the instance defaults; a logged-in caller (cookie session or Bearer token) gets their own values. Reads never fail: any error falls back to `APP_DEFAULTS` with empty partials.
- `PUT /api/account/preferences` — `requireUser`. Body is a partial; a value of `null` removes that key (back to the default). Returns the same shape as the GET. `400` for an invalid value or a body with no recognised key; nothing is written in that case. Writing an empty result deletes the row.
- `POST /api/admin/settings/display-defaults` — `requireAdmin`. Same body semantics, writes `display_defaults`, returns the same shape as the GET.
- None of these paths belong to a module prefix, so `moduleGate` never gates them. `forcePasswordChange` needs **no change**: `GET /api/settings/display` is already allowed by the existing `/api/settings/` prefix (a user with a temporary password still gets their layout), while `PUT /api/account/preferences` stays blocked for such a user like the rest of `/api/account/*` except password and profile.

### Client

- `app/composables/useDisplayPrefs.ts`: `useState` holds `{ effective, defaults, overrides, adminDefaults }` and a `loaded` flag; exposes `ensureLoaded()`, `refresh()`, `saveOverrides(partial)`, `saveAdminDefaults(partial)`. On any fetch failure it keeps `APP_DEFAULTS`-equivalent client defaults. After a successful save it applies the returned state immediately.
- **Density** — `app/layouts/default.vue` sets `data-density` on `<html>` through `useHead({ htmlAttrs })`, so server-rendered pages carry it (no flash). Each of the six grid definitions listed in Context keeps its current column count per breakpoint and subtracts/adds a shared offset exposed as a CSS variable on `:root` by density (`compact` +1, `comfortable` 0, `spacious` −1, never fewer than 1 column), written as `repeat(max(1, calc(N + var(--grid-offset, 0))), 1fr)` with N that page's current count. The implementation plan must verify in a real browser that `calc()`/`max()` are honoured inside `repeat()`; if not, the fallback is explicit per-density rules keyed on `html[data-density]`. Card internals are unchanged.
- **Navigation** — the sidebar filters `activeSpace.navLinks` by `hiddenNavLinks`; `/` (Home) and the single link of the music and podcasts spaces are never hideable. Pure helper `filterNavLinks(links, hidden)` in `app/utils/` (unit-tested).
- **Landing space** — pure helper `resolveLandingTarget(effective.landingSpace, enabledModules)` in `app/utils/` returns the route to start on, or `null`: `auto` → first enabled module's home; an explicit choice → that module's home if it is enabled, else the `auto` result. `app/middleware/auth.global.ts` applies it **once per browser tab session**: on the client, when the target route is `/` and `sessionStorage` has no `landing_applied` flag, set the flag, and if the resolved home is not `/`, `navigateTo` it. Later visits to `/` never redirect, so the Video home stays reachable. Guests use the instance defaults. The `sessionStorage` access is wrapped in try/catch (private mode) and fails to "no redirect".

### Settings UI

- One shared component `app/components/DisplayPrefsForm.vue`: a density select (Compacte / Normale / Large), checkboxes for Shorts / Chaînes / Abonnements / Playlists ("masquer"), and a landing-space select (Automatique / Vidéo / Musique / Podcasts, listing only enabled modules). It takes a mode (`user` | `admin`) and emits changes. In `user` mode each setting shows its current effective value and, when personalised, a "Rétablir le défaut de l'instance" link (sends `null`). In `admin` mode the same link sends `null` to the admin defaults (back to the app default). Saves on change with a toast, controls disabled while saving, and re-sync of the form state from the server response on both success and failure (the Modules-panel lesson: never trust a one-way-bound control's DOM state after a failed save).
- Account page: new "Affichage" section in `app/pages/account.vue`.
- Settings → System: new "Affichage par défaut" panel in `app/components/settings/SettingsSystemTab.vue`.

## Error Handling

- Preferences cannot be read (network or server error): the client uses the app defaults and the UI is fully usable.
- Corrupt stored JSON, or a stored value that is no longer valid: treated as an empty partial for that user/instance; never an error to the user.
- Invalid value on write (`400`): nothing is written; the form re-syncs to server state and shows the server's message.
- A `landingSpace` that points to a disabled module is ignored (falls back to `auto`); a `hiddenNavLinks` entry outside `HIDEABLE_NAV_LINKS` is rejected on write and dropped on read.
- Deleting a user cascades to their preferences row.

## Testing

- Unit: `displayPrefs` schema — defaults, `validatePartial` (valid, invalid value per key, unknown keys ignored, `null` as removal, duplicate/foreign nav links rejected), `mergePrefs` (array replaced, not merged), resolution order, corrupt-JSON tolerance; `filterNavLinks`; `resolveLandingTarget` (auto, explicit, explicit-but-disabled, nothing enabled).
- Integration (`createTestDb` + `mockEvent`): `GET /api/settings/display` as guest / logged-in user / Bearer-token user / with admin defaults set / with a corrupt stored row; `PUT /api/account/preferences` (401 guest, valid write, `null` removal, invalid value → 400 with nothing written, empty body → 400, empty result deletes the row, writes only the changed keys); `POST /api/admin/settings/display-defaults` (401/403/400/valid, effect on a user without overrides and on a guest); cascade deletion with the user; forced password change (the public GET is allowed, the PUT is still blocked, with the middleware's allow-list unchanged).
- Component (nuxt env, `$fetch` stubbed): `useDisplayPrefs` — loads, falls back on failure, applies a save's response, `ensureLoaded` fetches once.
- Manual verification in a real Docker container with the Browser pane on the Mac's LAN IP, with real form logins and clicks (not `curl` alone): measure the number of grid columns at a fixed viewport width for each density on the home, subscriptions, channels and search pages; hide links and check the sidebar; landing redirect happens once per tab and not on a second visit to `/`, including with the chosen module disabled; "Rétablir le défaut" returns to the instance default; admin defaults are seen by a brand-new user and by a guest; a failed save (forced refusal) re-syncs the control; a Bearer token can read and write preferences.
