# Music Module Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin turn the whole Music module on/off from Settings — off means "Musique" disappears from the space-switcher for everyone else and `/music`/`/api/music/*`/`/downloads-music/*` become unreachable for non-admins, while the admin always keeps full access and no data is touched.

**Architecture:** A single `music_module_enabled` row in the existing `settings` table, read via a new public endpoint and written via a new admin-only endpoint. Enforcement is one new Nitro server middleware gating every `/api/music/*` and `/downloads-music/*` request — zero changes to any of the ~15 existing music endpoints from prior sub-projects. Client-side: the space-switcher and the `/music` page both check the public read endpoint; a checkbox in Settings' existing "Music" tab flips it.

**Tech Stack:** Nuxt 4 / Nitro (H3) server routes and middleware, better-sqlite3, Vue 3 Composition API, Vitest.

## Global Constraints

- Admin access is never restricted by this toggle, for any surface (`/music`, the Settings Music tab, `/api/music/*`, `/api/admin/music/*`).
- Disabling never touches ingestion (pause/resume stays a separate, existing control) and never deletes/hides database rows — only reachability of the UI/API surface changes.
- The public read endpoint (`GET /api/settings/music-module`) never throws and defaults to `enabled: true` if the setting row is missing.
- The enforcement middleware returns a plain `404` (not `403`) for a blocked request — never reveal that a disabled resource exists via a different status code.
- Endpoints tested via Vitest need an explicit relative import for any project-local utility (`getDb`, `requireAdmin`, `getUserFromSession`) because Nitro's auto-import doesn't apply when a test imports the handler directly — write the test first, let the failure name the import, don't pre-guess the path (holds for every endpoint task across Music mode so far).
- Type-checking requires `npx vue-tsc -b --noEmit` — plain `vue-tsc --noEmit -p .` is a silent no-op and must never be used as a verification step.
- All new user-facing UI copy is in French.

---

### Task 1: Setting storage + public read endpoint

**Files:**
- Modify: `server/utils/db.ts`
- Modify: `tests/helpers/testDb.ts`
- Create: `server/api/settings/music-module.get.ts`
- Test: `tests/integration/music-module-settings.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `music_module_enabled` setting row (real + test schema, default `'1'`). New test fixtures: a `settings` table in `createTestDb()` (didn't exist before — no prior sub-project needed it) and an `insertSetting(db, {key, value})` helper. `GET /api/settings/music-module` response shape `{ enabled: boolean }`. Consumed by Task 3 (middleware) and Task 4 (client).

- [ ] **Step 1: Seed the real setting**

Open `server/utils/db.ts`. Find the existing seed block:

```ts
  const musicMaxConcurrentCheck = db.prepare("SELECT COUNT(*) as count FROM settings WHERE key = 'music_max_concurrent_downloads'").get() as { count: number };
  if (musicMaxConcurrentCheck.count === 0) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('music_max_concurrent_downloads', '2')").run();
    console.log('Seeded setting music_max_concurrent_downloads: 2');
  }
```

Add a new block immediately after it:

```ts
  const musicMaxConcurrentCheck = db.prepare("SELECT COUNT(*) as count FROM settings WHERE key = 'music_max_concurrent_downloads'").get() as { count: number };
  if (musicMaxConcurrentCheck.count === 0) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('music_max_concurrent_downloads', '2')").run();
    console.log('Seeded setting music_max_concurrent_downloads: 2');
  }

  const musicModuleEnabledCheck = db.prepare("SELECT COUNT(*) as count FROM settings WHERE key = 'music_module_enabled'").get() as { count: number };
  if (musicModuleEnabledCheck.count === 0) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('music_module_enabled', '1')").run();
    console.log('Seeded setting music_module_enabled: 1');
  }
```

- [ ] **Step 2: Add a `settings` table and `insertSetting` helper to the test schema**

Open `tests/helpers/testDb.ts`. No `settings` table exists in the test schema yet (no prior sub-project needed to read/write it). Find the `createTestDb()` function's `db.exec` block and add a `settings` table — a natural spot is right after the `sessions` table definition:

```sql
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
```

Then add a new helper function alongside the other `insertX` helpers (e.g. near `insertMusicPlay`):

```ts
export function insertSetting(db: Database.Database, opts: { key: string; value: string }) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(opts.key, opts.value);
}
```

- [ ] **Step 3: Write the failing tests**

Create `tests/integration/music-module-settings.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import getHandler from '../../server/api/settings/music-module.get';
import { createTestDb, insertSetting, mockEvent } from '../helpers/testDb';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
});

describe('GET /api/settings/music-module', () => {
  it('returns enabled: true when the setting is missing entirely', async () => {
    const result: any = await getHandler(mockEvent(undefined, { path: '/api/settings/music-module' }));
    expect(result.enabled).toBe(true);
  });

  it('returns enabled: true when the setting value is "1"', async () => {
    insertSetting(db, { key: 'music_module_enabled', value: '1' });
    const result: any = await getHandler(mockEvent(undefined, { path: '/api/settings/music-module' }));
    expect(result.enabled).toBe(true);
  });

  it('returns enabled: false when the setting value is "0"', async () => {
    insertSetting(db, { key: 'music_module_enabled', value: '0' });
    const result: any = await getHandler(mockEvent(undefined, { path: '/api/settings/music-module' }));
    expect(result.enabled).toBe(false);
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npx vitest run tests/integration/music-module-settings.test.ts`
Expected: FAIL with a module-not-found error for `server/api/settings/music-module.get`.

- [ ] **Step 5: Implement the endpoint**

Create `server/api/settings/music-module.get.ts`:

```ts
import { defineEventHandler } from 'h3';

export default defineEventHandler(async () => {
  const db = getDb();
  const row = db.prepare("SELECT value FROM settings WHERE key = 'music_module_enabled'").get() as { value: string } | undefined;
  return { enabled: row?.value !== '0' };
});
```

If the test run fails with a "not defined" error for `getDb`, add the exact explicit relative import the failure demands (this file is at `server/api/settings/music-module.get.ts`, 2 directories below `server/` — count from there rather than assuming).

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/integration/music-module-settings.test.ts`
Expected: PASS (all 3 tests)

- [ ] **Step 7: Run the full suite to confirm no regressions**

Run: `npm test -- --run`
Expected: all existing tests still pass (the `settings` table and `insertSetting` helper are purely additive to the test schema).

- [ ] **Step 8: Commit**

```bash
git add server/utils/db.ts tests/helpers/testDb.ts server/api/settings/music-module.get.ts tests/integration/music-module-settings.test.ts
git commit -m "feat: add music_module_enabled setting and public read endpoint"
```

---

### Task 2: Admin write endpoint

**Files:**
- Create: `server/api/admin/settings/music-module.post.ts`
- Test: `tests/integration/music-module-settings.test.ts` (extend the file from Task 1)

**Interfaces:**
- Consumes: `requireAdmin` (existing, `server/utils/auth.ts`).
- Produces: `POST /api/admin/settings/music-module` response shape `{ enabled: boolean }`. Not consumed by any other task directly (Task 4's UI calls it by URL/method, not by import).

- [ ] **Step 1: Write the failing tests**

Open `tests/integration/music-module-settings.test.ts` (from Task 1). Add the imports it needs — extend the existing `import { createTestDb, insertSetting, mockEvent } from '../helpers/testDb';` line to also bring in `insertUser`, `insertSession`, `sessionCookie`, and add an import for the new POST handler:

```ts
import postHandler from '../../server/api/admin/settings/music-module.post';
import { createTestDb, insertSetting, insertUser, insertSession, mockEvent, sessionCookie } from '../helpers/testDb';
```

Add a `loginAs` helper and a new `describe` block after the existing `GET` one:

```ts
function loginAs(db: Database, userId: string, role: 'admin' | 'user' = 'user') {
  insertUser(db, { id: userId, role });
  const sessionId = `sess-${userId}`;
  insertSession(db, { id: sessionId, userId });
  return sessionCookie(sessionId);
}

describe('POST /api/admin/settings/music-module', () => {
  it('returns 401 for a guest', async () => {
    await expect(postHandler(mockEvent(undefined, { path: '/api/admin/settings/music-module', body: { enabled: false } }))).rejects.toMatchObject({ statusCode: 401 });
  });

  it('returns 403 for a logged-in non-admin', async () => {
    const cookie = loginAs(db, 'u1', 'user');
    await expect(postHandler(mockEvent(cookie, { path: '/api/admin/settings/music-module', body: { enabled: false } }))).rejects.toMatchObject({ statusCode: 403 });
  });

  it('returns 400 when enabled is missing or not a boolean', async () => {
    const cookie = loginAs(db, 'admin1', 'admin');
    await expect(postHandler(mockEvent(cookie, { path: '/api/admin/settings/music-module', body: {} }))).rejects.toMatchObject({ statusCode: 400 });
    await expect(postHandler(mockEvent(cookie, { path: '/api/admin/settings/music-module', body: { enabled: 'false' } }))).rejects.toMatchObject({ statusCode: 400 });
  });

  it('persists enabled: false for an admin', async () => {
    insertSetting(db, { key: 'music_module_enabled', value: '1' });
    const cookie = loginAs(db, 'admin1', 'admin');
    const result: any = await postHandler(mockEvent(cookie, { path: '/api/admin/settings/music-module', body: { enabled: false } }));
    expect(result.enabled).toBe(false);
    const row = db.prepare("SELECT value FROM settings WHERE key = 'music_module_enabled'").get() as { value: string };
    expect(row.value).toBe('0');
  });

  it('persists enabled: true for an admin, re-enabling', async () => {
    insertSetting(db, { key: 'music_module_enabled', value: '0' });
    const cookie = loginAs(db, 'admin1', 'admin');
    const result: any = await postHandler(mockEvent(cookie, { path: '/api/admin/settings/music-module', body: { enabled: true } }));
    expect(result.enabled).toBe(true);
    const row = db.prepare("SELECT value FROM settings WHERE key = 'music_module_enabled'").get() as { value: string };
    expect(row.value).toBe('1');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/integration/music-module-settings.test.ts`
Expected: FAIL with a module-not-found error for `server/api/admin/settings/music-module.post`.

- [ ] **Step 3: Implement the endpoint**

Create `server/api/admin/settings/music-module.post.ts`:

```ts
import { defineEventHandler, readBody, createError } from 'h3';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);

  const body = await readBody(event);
  if (!body || typeof body !== 'object' || typeof body.enabled !== 'boolean') {
    throw createError({ statusCode: 400, statusMessage: 'enabled (boolean) is required.' });
  }

  const db = getDb();
  db.prepare("UPDATE settings SET value = ? WHERE key = 'music_module_enabled'").run(body.enabled ? '1' : '0');

  return { enabled: body.enabled };
});
```

If the test run fails with a "not defined" error for `requireAdmin` or `getDb`, add the exact explicit relative import the failure demands (this file is at `server/api/admin/settings/music-module.post.ts`, 3 directories below `server/`).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/integration/music-module-settings.test.ts`
Expected: PASS (all 8 tests: 3 from Task 1's GET block + 5 new POST tests)

- [ ] **Step 5: Run the full suite to confirm no regressions**

Run: `npm test -- --run`

- [ ] **Step 6: Commit**

```bash
git add server/api/admin/settings/music-module.post.ts tests/integration/music-module-settings.test.ts
git commit -m "feat: add admin write endpoint for music_module_enabled"
```

---

### Task 3: Enforcement middleware

**Files:**
- Create: `server/middleware/musicModuleGate.ts`
- Test: `tests/integration/music-module-gate.test.ts`

**Interfaces:**
- Consumes: `getDb`, `getUserFromSession` (existing).
- Produces: nothing consumed by a later task in this plan (this is the actual enforcement point; Task 4's client-side checks are UX niceties on top of it, not dependent on its internals).

- [ ] **Step 1: Write the failing tests**

Create `tests/integration/music-module-gate.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import handler from '../../server/middleware/musicModuleGate';
import { createTestDb, insertSetting, insertUser, insertSession, mockEvent, sessionCookie } from '../helpers/testDb';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
});

function loginAs(userId: string, role: 'admin' | 'user' = 'user') {
  insertUser(db, { id: userId, role });
  const sessionId = `sess-${userId}`;
  insertSession(db, { id: sessionId, userId });
  return sessionCookie(sessionId);
}

describe('musicModuleGate middleware', () => {
  it('passes through non-music paths regardless of the setting', async () => {
    insertSetting(db, { key: 'music_module_enabled', value: '0' });
    const result = await handler(mockEvent(undefined, { path: '/api/channels' }));
    expect(result).toBeUndefined();
  });

  it('passes through /api/music/* for a guest when enabled', async () => {
    insertSetting(db, { key: 'music_module_enabled', value: '1' });
    const result = await handler(mockEvent(undefined, { path: '/api/music/artists' }));
    expect(result).toBeUndefined();
  });

  it('passes through /downloads-music/* for a guest when enabled', async () => {
    insertSetting(db, { key: 'music_module_enabled', value: '1' });
    const result = await handler(mockEvent(undefined, { path: '/downloads-music/GIMS/t1.opus' }));
    expect(result).toBeUndefined();
  });

  it('passes through when the setting is missing entirely (defaults to enabled)', async () => {
    const result = await handler(mockEvent(undefined, { path: '/api/music/artists' }));
    expect(result).toBeUndefined();
  });

  it('blocks /api/music/* for a guest with a 404 when disabled', async () => {
    insertSetting(db, { key: 'music_module_enabled', value: '0' });
    await expect(handler(mockEvent(undefined, { path: '/api/music/artists' }))).rejects.toMatchObject({ statusCode: 404 });
  });

  it('blocks /downloads-music/* for a guest with a 404 when disabled', async () => {
    insertSetting(db, { key: 'music_module_enabled', value: '0' });
    await expect(handler(mockEvent(undefined, { path: '/downloads-music/GIMS/t1.opus' }))).rejects.toMatchObject({ statusCode: 404 });
  });

  it('blocks /api/music/* for a logged-in non-admin when disabled', async () => {
    insertSetting(db, { key: 'music_module_enabled', value: '0' });
    const cookie = loginAs('u1', 'user');
    await expect(handler(mockEvent(cookie, { path: '/api/music/artists' }))).rejects.toMatchObject({ statusCode: 404 });
  });

  it('passes through /api/music/* for an admin even when disabled', async () => {
    insertSetting(db, { key: 'music_module_enabled', value: '0' });
    const cookie = loginAs('admin1', 'admin');
    const result = await handler(mockEvent(cookie, { path: '/api/music/artists' }));
    expect(result).toBeUndefined();
  });

  it('does not gate /api/admin/music/* at all (untouched by this middleware)', async () => {
    insertSetting(db, { key: 'music_module_enabled', value: '0' });
    const result = await handler(mockEvent(undefined, { path: '/api/admin/music/ingest' }));
    expect(result).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/integration/music-module-gate.test.ts`
Expected: FAIL with a module-not-found error for `server/middleware/musicModuleGate`.

- [ ] **Step 3: Implement the middleware**

Create `server/middleware/musicModuleGate.ts`:

```ts
import { defineEventHandler, createError } from 'h3';

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

If the test run fails with a "not defined" error for `getDb` or `getUserFromSession`, add the exact explicit relative import the failure demands (this file is at `server/middleware/musicModuleGate.ts`, 1 directory below `server/`).

Note: the "does not gate `/api/admin/music/*`" test works because that path doesn't start with `/api/music/` (it starts with `/api/admin/music/`) — the `startsWith` check is intentionally exact-prefix, not a substring match, so this is correct by construction, not by accident.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/integration/music-module-gate.test.ts`
Expected: PASS (all 9 tests)

- [ ] **Step 5: Run the full suite to confirm no regressions**

Run: `npm test -- --run`
Expected: all tests pass, including every pre-existing `/api/music/*` and `/api/admin/music/*` endpoint test — this middleware is new and additive; it isn't wired into any existing test's request path (those tests call handlers directly, bypassing Nitro's middleware chain entirely, so this task cannot break them by construction — this middleware only takes effect for real HTTP requests through the Nitro server, verified in Task 4's manual browser check).

- [ ] **Step 6: Commit**

```bash
git add server/middleware/musicModuleGate.ts tests/integration/music-module-gate.test.ts
git commit -m "feat: add server middleware enforcing the music module toggle"
```

---

### Task 4: Client wiring — space-switcher, `/music` redirect, Settings toggle

**Files:**
- Modify: `app/layouts/default.vue`
- Modify: `app/pages/music/index.vue`
- Modify: `app/pages/settings.vue`

**Interfaces:**
- Consumes: `GET /api/settings/music-module` (Task 1), `POST /api/admin/settings/music-module` (Task 2).
- Produces: nothing consumed by a later task (last task in this plan).

- [ ] **Step 1: Fetch the setting and filter the space-switcher in `app/layouts/default.vue`**

In `<script setup>`, find the existing `const activeSpace = computed(...)` block and its surrounding declarations:

```ts
const { user, isAdmin, logout } = useAuth();
const { toasts, removeToast } = useToast();
const { currentTrack } = useMusicPlayer();
const dropdownOpen = ref(false);
const spaceMenuOpen = ref(false);
const searchQuery = ref('');
const router = useRouter();
const route = useRoute();
const activeSpace = computed(() =>
  (route.path.startsWith('/music') ? spaces.find((s) => s.id === 'music') : spaces.find((s) => s.id === 'video')) ?? spaces[0]!
);
```

Add a new piece of state and a computed list of visible spaces directly after it:

```ts
const { user, isAdmin, logout } = useAuth();
const { toasts, removeToast } = useToast();
const { currentTrack } = useMusicPlayer();
const dropdownOpen = ref(false);
const spaceMenuOpen = ref(false);
const searchQuery = ref('');
const router = useRouter();
const route = useRoute();
const activeSpace = computed(() =>
  (route.path.startsWith('/music') ? spaces.find((s) => s.id === 'music') : spaces.find((s) => s.id === 'video')) ?? spaces[0]!
);

const musicModuleEnabled = ref(true);
const visibleSpaces = computed(() =>
  spaces.filter((s) => s.id !== 'music' || musicModuleEnabled.value || isAdmin.value)
);

async function fetchMusicModuleEnabled() {
  try {
    const data = await $fetch<{ enabled: boolean }>('/api/settings/music-module');
    musicModuleEnabled.value = data.enabled;
  } catch (e) {
    musicModuleEnabled.value = true;
  }
}
```

Find the existing `onMounted` block that fetches active downloads:

```ts
onMounted(() => {
  fetchActiveDownloads();
  downloadCountInterval = setInterval(fetchActiveDownloads, 5000);
});
```

Add the new fetch call to it:

```ts
onMounted(() => {
  fetchActiveDownloads();
  downloadCountInterval = setInterval(fetchActiveDownloads, 5000);
  fetchMusicModuleEnabled();
});
```

- [ ] **Step 2: Use `visibleSpaces` in the dropdown and add the "Désactivé" badge**

In the `<template>`, find the space-switcher dropdown's `v-for`:

```html
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
```

Replace `v-for="space in spaces"` with `v-for="space in visibleSpaces"`, and add the badge:

```html
          <div v-if="spaceMenuOpen" class="dropdown-menu space-menu" @click.stop>
            <div
              v-for="space in visibleSpaces"
              :key="space.id"
              class="dropdown-item space-menu-item"
              :class="{ active: space.id === activeSpace.id }"
              @click="selectSpace(space.homeRoute)"
            >
              <i class="space-switcher-icon" v-html="space.icon"></i>
              {{ space.label }}
              <span v-if="space.id === 'music' && !musicModuleEnabled" class="badge badge-failed" style="margin-left: auto;">Désactivé</span>
            </div>
          </div>
```

(`badge-failed` is the existing red-ish badge class already used elsewhere in this file for negative-state indicators — e.g. `ultra_private` visibility badges throughout Music mode's prior sub-projects — reused here rather than inventing a new style.)

- [ ] **Step 3: Redirect from `/music` when disabled for a non-admin**

Open `app/pages/music/index.vue`. Find the existing `onMounted` block:

```ts
onMounted(() => {
  if (artistId.value) {
    fetchArtistDetail();
  } else {
    fetchArtists();
  }
});
```

Replace with a version that checks the setting first:

```ts
onMounted(async () => {
  try {
    const data = await $fetch<{ enabled: boolean }>('/api/settings/music-module');
    if (!data.enabled && !isAdmin.value) {
      router.push('/');
      return;
    }
  } catch (e) {
    // If the check itself fails, don't block access on a network error —
    // the server-side middleware is the real enforcement point regardless.
  }
  if (artistId.value) {
    fetchArtistDetail();
  } else {
    fetchArtists();
  }
});
```

- [ ] **Step 4: Add the toggle to Settings' Music tab**

Open `app/pages/settings.vue`. Find the start of the Music tab:

```html
        <div v-if="activeTab === 'music' && isAdmin" class="tab-pane">
          <div class="downloads-header-panel glass-panel">
            <div class="header-text">
              <h2>Music Ingestion</h2>
              <p>Follow YouTube channels as music artists. Audio is extracted, no re-encoding.</p>
            </div>
```

Add a new panel immediately before `.downloads-header-panel`:

```html
        <div v-if="activeTab === 'music' && isAdmin" class="tab-pane">
          <div class="downloads-header-panel glass-panel" style="margin-bottom: 16px;">
            <div class="header-text">
              <h2>Module Musique</h2>
              <p>Active ou désactive tout l'espace Musique pour les utilisateurs non-admin (navigation, lecture, API). Les administrateurs gardent toujours accès.</p>
            </div>
            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
              <input type="checkbox" v-model="musicModuleEnabled" @change="toggleMusicModule" :disabled="togglingMusicModule" />
              <span>{{ musicModuleEnabled ? 'Activé' : 'Désactivé' }}</span>
            </label>
          </div>

          <div class="downloads-header-panel glass-panel">
            <div class="header-text">
              <h2>Music Ingestion</h2>
              <p>Follow YouTube channels as music artists. Audio is extracted, no re-encoding.</p>
            </div>
```

In `<script setup>`, find the existing music-tab-related state declarations (near `musicIsPaused`, `musicAutoSync`, etc. — the exact surrounding names vary; add near them for locality) and add:

```ts
const musicModuleEnabled = ref(true);
const togglingMusicModule = ref(false);

async function fetchMusicModuleEnabled() {
  try {
    const data = await $fetch<{ enabled: boolean }>('/api/settings/music-module');
    musicModuleEnabled.value = data.enabled;
  } catch (e) {
    // leave the default
  }
}

async function toggleMusicModule() {
  togglingMusicModule.value = true;
  const desired = musicModuleEnabled.value;
  try {
    await $fetch('/api/admin/settings/music-module', { method: 'POST', body: { enabled: desired } });
    toast.success(desired ? 'Module Musique activé.' : 'Module Musique désactivé.');
  } catch (e: any) {
    musicModuleEnabled.value = !desired;
    toast.error(e?.data?.statusMessage || 'Erreur lors de la mise à jour du module Musique.');
  } finally {
    togglingMusicModule.value = false;
  }
}
```

(`v-model="musicModuleEnabled"` already flips the checkbox's bound value optimistically before `@change` fires `toggleMusicModule`, which is why the error path reverts it — matching the optimistic-update-with-rollback pattern already used by this file's other toggle-style controls.)

Find wherever this file's existing `onMounted` fetches music-tab data (e.g. alongside fetching `musicArtists`/`musicQueue`) and add a call to `fetchMusicModuleEnabled()` in the same place, so the checkbox reflects the real current state when the admin opens the tab.

- [ ] **Step 5: Type-check**

Run: `npx vue-tsc -b --noEmit`
Expected: no new errors beyond the 2 known pre-existing ones (`app/components/VideoPlayer.vue`, `app/pages/subscriptions.vue`, unrelated).

- [ ] **Step 6: Manual verification**

Start the dev server, log in as admin, go to Settings → Music, confirm the new "Module Musique" toggle shows "Activé" by default. Toggle it off, confirm a toast confirms success. Open a second, non-admin session (or log out): confirm "Musique" is absent from the space-switcher; confirm navigating directly to `/music` redirects to `/`; confirm `curl`ing `/api/music/artists` without an admin session returns 404. Back in the admin session, confirm "Musique" still appears in the switcher with a "Désactivé" badge, and `/music`/`/api/music/artists` still work normally for the admin. Toggle back on in Settings, confirm the non-admin session's switcher and `/music` access are immediately restored (no data loss, nothing to re-seed).

- [ ] **Step 7: Commit**

```bash
git add app/layouts/default.vue app/pages/music/index.vue app/pages/settings.vue
git commit -m "feat: wire music module toggle into space-switcher, /music, and Settings"
```

---

## Self-Review Notes

- **Spec coverage:** setting storage + public read (Task 1) ✓, admin write (Task 2) ✓, server-side enforcement for `/api/music/*` and `/downloads-music/*` with admin bypass and 404 (Task 3) ✓, space-switcher filtering + admin badge, `/music` redirect, Settings toggle (Task 4) ✓. Non-goals (ingestion untouched, no data deletion, no partial disabling, admin never restricted) are all structurally guaranteed by the design — the middleware only touches two path prefixes and always early-returns for an admin session.
- **Placeholder scan:** none found — every step shows complete code, exact file paths, and exact commands.
- **Type consistency:** `GET /api/settings/music-module` and `POST /api/admin/settings/music-module` both use `{ enabled: boolean }` — matches every client-side consumer's destructuring (`data.enabled`) in Tasks 4. `insertSetting(db, {key, value})` (Task 1) is used identically by Tasks 2 and 3's tests.
