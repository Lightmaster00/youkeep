# Music Module Toggle (Sub-project 5) — Design

## Context

Fifth sub-project of Music mode, following sub-project 4 (audio player & smart playlists, done and merged). Every prior sub-project assumed Music mode is always on — `app/spaces.ts` unconditionally lists the "Musique" space, and nothing gates `/music` or `/api/music/*` beyond the existing per-track/per-artist visibility tiers. There is currently no way for an instance's admin to hide or disable the module entirely (e.g. an instance that only wants video archiving). This sub-project adds that toggle.

## Scope

- A new `music_module_enabled` setting (default on), following the exact `settings` table pattern already used for `music_downloader_paused`/`music_max_concurrent_downloads`.
- A new public read endpoint and an admin-only write endpoint for this setting.
- Server-side enforcement via a single new Nitro middleware, so disabling the module doesn't just hide it — direct URL/API access is also blocked for non-admins.
- Client-side: the space-switcher hides "Musique" when disabled (for non-admins); a new toggle in the Settings "Music" tab controls it.

## Non-Goals

- No change to the ingestion pipeline's own pause/resume control (already exists, sub-project 3b) — disabling the module does not stop in-flight or scheduled downloads. These are deliberately separate controls: one governs visibility/access, the other governs whether new audio gets downloaded.
- No deletion or hiding of existing database rows (artists/albums/tracks) — disabling only affects reachability of the UI/API surface, not the data itself. Re-enabling instantly restores full access to everything that was there before.
- No partial/granular disabling (e.g. "browsing on, playback off") — this is a single on/off switch for the whole module.
- Admin access is never restricted by this toggle — an admin can always reach `/music`, the Settings "Music" tab, and every `/api/music/*`/`/api/admin/music/*` endpoint regardless of the setting's value. The toggle only affects what non-admin users (and guests) can reach.

## Design

### 1. Setting storage — `server/utils/db.ts`

Add a seed block immediately after the existing `music_max_concurrent_downloads` seed:

```ts
const musicModuleEnabledCheck = db.prepare("SELECT COUNT(*) as count FROM settings WHERE key = 'music_module_enabled'").get() as { count: number };
if (musicModuleEnabledCheck.count === 0) {
  db.prepare("INSERT INTO settings (key, value) VALUES ('music_module_enabled', '1')").run();
  console.log('Seeded setting music_module_enabled: 1');
}
```

Stored as `'1'`/`'0'` text, matching every other boolean-flavored setting in this table.

### 2. `GET /api/settings/music-module` — public read

No authentication required — even a guest browsing public video content needs to know whether "Musique" should appear in the space-switcher. This is the first endpoint under a new `server/api/settings/` namespace (everything settings-related today lives under `server/api/admin/`); this one is deliberately outside `admin/` because it must be callable by anyone, including guests.

```ts
export default defineEventHandler(async () => {
  const db = getDb();
  const row = db.prepare("SELECT value FROM settings WHERE key = 'music_module_enabled'").get() as { value: string } | undefined;
  return { enabled: row?.value !== '0' };
});
```

Defaults to `true` if the row is somehow missing (fail-open for *visibility only* — this endpoint never gates access by itself, see §4 for the actual enforcement point, which fails closed).

### 3. `POST /api/admin/settings/music-module` — admin write

```ts
export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const body = await readBody(event);
  if (!body || typeof body.enabled !== 'boolean') {
    throw createError({ statusCode: 400, statusMessage: 'enabled (boolean) is required.' });
  }
  const db = getDb();
  db.prepare("UPDATE settings SET value = ? WHERE key = 'music_module_enabled'").run(body.enabled ? '1' : '0');
  return { enabled: body.enabled };
});
```

### 4. Server-side enforcement — `server/middleware/musicModuleGate.ts`

A new Nitro server middleware (auto-registered for every request, a standard Nuxt/Nitro feature this codebase hasn't used yet but is the correct minimal-blast-radius tool here — it avoids touching any of the ~15 existing `/api/music/*` and `/downloads-music/*` endpoint files from prior sub-projects):

```ts
export default defineEventHandler(async (event) => {
  const path = event.path || '';
  const isMusicRoute = path.startsWith('/api/music/') || path.startsWith('/downloads-music/');
  if (!isMusicRoute) return;

  const db = getDb();
  const row = db.prepare("SELECT value FROM settings WHERE key = 'music_module_enabled'").get() as { value: string } | undefined;
  const enabled = row?.value !== '0';
  if (enabled) return;

  const session = await getUserFromSession(event);
  if (session?.role === 'admin') return;

  throw createError({ statusCode: 404, statusMessage: 'Not found.' });
});
```

Fails closed on the actual gate (unlike §2's display-only read): a missing/malformed setting row here still defaults `enabled` to `true` (matching §2's default), so the *fail-safe* direction is "don't accidentally lock everyone out due to a missing seed row," not "fail open on a disabled state" — the `if (enabled) return` / explicit admin-check / explicit `404` covers the actual disabled case correctly. `/api/admin/music/*` and `/api/admin/settings/music-module` are untouched (they don't start with `/api/music/`), so admin controls always work regardless of this middleware.

404 (not 403) is deliberate — consistent with how this codebase already treats "resource doesn't exist" for a disabled/hidden surface elsewhere (e.g. the file-serving routes' path-traversal handling never distinguishes "exists but forbidden" from "doesn't exist" for anonymous requesters).

### 5. `/music` page-level redirect

`app/pages/music/index.vue` fetches `GET /api/settings/music-module` on mount (alongside its existing data fetching); if `enabled === false` and the current user isn't an admin, `navigateTo('/')`. This is a UX nicety on top of §4's real enforcement — without it, a non-admin hitting `/music` directly would see a page that immediately 404s on its own API calls rather than being cleanly redirected.

### 6. Space-switcher — `app/layouts/default.vue`

Fetches `GET /api/settings/music-module` once on mount (a new small piece of state, e.g. `musicModuleEnabled`). The space-switcher's dropdown list (`v-for="space in spaces"`) filters out the `music` entry when `!musicModuleEnabled && !isAdmin`. For an admin viewing a disabled module, the "Musique" entry stays visible with a small "Désactivé" badge next to its label (reusing the existing `.badge` styling already used elsewhere in this file), so the admin has a clear, discoverable path back to re-enabling it.

### 7. Settings UI — `app/pages/settings.vue`, "Music" tab

A new toggle at the very top of the existing Music tab (above the current pause/resume + concurrency row), labeled "Activer le module Musique" — a simple on/off switch (reusing whatever toggle/switch pattern this codebase already uses elsewhere, e.g. the existing pause/resume button's visual style, or a proper `<input type="checkbox">`-based switch if one already exists in this file — confirm during planning). Calls `POST /api/admin/settings/music-module` on change, with a toast on success/failure matching the existing pattern in this tab.

## Error Handling

- `POST /api/admin/settings/music-module` with a missing/non-boolean `enabled`: 400.
- The middleware throws a plain 404 for any blocked request — no leaking of "this exists but is disabled" via a different status code.
- `GET /api/settings/music-module` never throws — a DB error here should not break page rendering for something this low-stakes; on a fetch failure the client-side default is "show Musique" (fail open for *visibility*, since §4 is the real gate and fails closed there).

## Verification

- Endpoint tests: public read reflects the current setting; admin write requires `requireAdmin`, validates the body, persists the value; the middleware blocks `/api/music/*` and `/downloads-music/*` for a non-admin when disabled (404) and allows them when enabled or for an admin regardless.
- Browser: toggle off as admin, confirm "Musique" disappears from the switcher in a non-admin/guest session but stays visible (badged) for the admin; confirm a non-admin hitting `/music` directly gets redirected; confirm `/api/music/artists` returns 404 for a non-admin, 200 for the admin, while disabled; toggle back on, confirm everything is immediately reachable again with no data loss.
- `npx vue-tsc -b --noEmit` clean.
