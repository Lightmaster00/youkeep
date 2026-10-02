# Module Switches Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the administrator switch each of YouKeep's three modules (Video, Music, Podcasts) on or off; a disabled module disappears for regular users and all of its background work stops, with at least one module always enabled.

**Architecture:** One central server module (`server/utils/modules.ts`) is the single source of truth (setting keys, route prefixes, enabled check, "at least one" rule, effective pause). A generic `moduleGate` middleware replaces `musicModuleGate`; the downloaders/crons/sync-all consult the same helper so a disabled module never starts new work (the admin's own pause flag is never written). The client gets a `useModules` composable that drives the space switcher, a global redirect, and search; Settings → System gets a "Modules" panel.

**Tech Stack:** Nuxt 4, Nitro (H3), TypeScript, better-sqlite3, Vue 3, Vitest (`server` project: `tests/unit` + `tests/integration`; `component` project: `tests/component`).

## Global Constraints

- Three modules: video, music, podcasts. Settings keys: `video_module_enabled`, `music_module_enabled` (existing, unchanged — no migration), `podcasts_module_enabled`. Value `'0'` = disabled; anything else (including a missing row) = enabled.
- At least one module must always remain enabled; POST with a result leaving none enabled → 400 and nothing is written. Writes for multiple modules are one transaction.
- A disabled module: invisible to regular users (404 on its routes, hidden in nav/space switcher, redirect to the first enabled module's home), admins keep full access with the "Désactivé" badge.
- All background work of a disabled module stops (new downloads, scheduled sync); in-flight work finishes; the admin's pause flag is never modified by the switch; data untouched; everything resumes on re-enable.
- Route prefixes: video = `/api/videos`, `/api/channels`, `/api/playlists`, `/api/home`, and `/downloads` (exact or `/downloads/…`, NEVER matching `/downloads-music` or `/downloads-podcasts`); music = `/api/music`, `/downloads-music`; podcasts = `/api/podcasts`, `/downloads-podcasts`. Auth, account, settings and admin routes are never gated. Gate/session read errors fall through to "allow" (fail open).
- Public `GET /api/settings/modules` → `{ video, music, podcasts }` booleans; admin `POST /api/admin/settings/modules` accepts any subset of booleans (400 on non-boolean). Old music-module GET/POST routes are removed and their tests migrated.
- Client: `useModules` composable (`modules`, `enabledModules`, `isEnabled(id)`, `firstEnabledHome` in order video→music→podcasts, `refresh()`); on fetch failure everything is treated as enabled. Global search (page and header autocomplete) ignores disabled modules.
- Settings UI: "Modules" panel at the top of Settings → System; the switch of the only remaining enabled module is disabled with an explanatory message; the Module Musique switch is removed from the Music tab ("Clips vidéo" stays).
- Manual verification must be done in a real Docker container with the Browser pane on the Mac's LAN IP (re-check with `ipconfig getifaddr en0`), NOT curl alone. The Browser pane pauses video playback in the background — not a bug.
- Commit trailer on every commit: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## File Structure

- Create `server/utils/modules.ts` — module ids, setting keys, route prefixes, `moduleForPath`, `isModuleEnabled`, `getModuleStates`, `setModulesEnabled` (+ `LastModuleError`), `isEffectivelyPaused`.
- Create `server/middleware/moduleGate.ts` (delete `server/middleware/musicModuleGate.ts`).
- Create `server/api/settings/modules.get.ts`, `server/api/admin/settings/modules.post.ts` (delete the two `music-module` routes).
- Modify `server/utils/db.ts` (seed two new keys), `server/utils/concurrency.ts`, `server/utils/downloader.ts`, `server/utils/musicDownloader.ts`, `server/utils/podcastDownloader.ts` (background work).
- Create `app/utils/moduleRouting.ts`, `app/composables/useModules.ts`; modify `app/layouts/default.vue`, `app/middleware/auth.global.ts`, `app/composables/useSearchSuggestions.ts`, `app/pages/search.vue`, `app/pages/music/index.vue`, `app/components/settings/SettingsSystemTab.vue`, `app/components/settings/SettingsMusicTab.vue`.
- Tests: `tests/unit/modules.test.ts`, `tests/integration/modules.test.ts`, `tests/integration/module-gate.test.ts` (renamed from `music-module-gate.test.ts`), `tests/integration/modules-settings.test.ts` (renamed from `music-module-settings.test.ts`), `tests/integration/modules-background.test.ts`, `tests/unit/moduleRouting.test.ts`, `tests/component/useModules.test.ts`, update `tests/component/useSearchSuggestions.test.ts`.

---

## Task 1: Central module helper + seeding

**Files:**
- Create: `server/utils/modules.ts`
- Modify: `server/utils/db.ts` (right after the existing `music_module_enabled` seed, currently ~lines 671-675)
- Test: `tests/unit/modules.test.ts` (pure functions), `tests/integration/modules.test.ts` (DB functions)

**Interfaces:**
- Produces (used by every later server task):
  - `type ModuleId = 'video' | 'music' | 'podcasts'`; `const MODULE_IDS: ModuleId[]` (order video, music, podcasts)
  - `MODULE_SETTING_KEYS: Record<ModuleId, string>`; `MODULE_ROUTE_PREFIXES: Record<ModuleId, string[]>`
  - `moduleForPath(path: string): ModuleId | null`
  - `isModuleEnabled(db: Database.Database, id: ModuleId): boolean`
  - `getModuleStates(db): Record<ModuleId, boolean>`
  - `setModulesEnabled(db, changes: Partial<Record<ModuleId, boolean>>): void` — throws `LastModuleError` if the result would leave none enabled
  - `class LastModuleError extends Error`
  - `isEffectivelyPaused(db, pausedSettingKey: string, id: ModuleId): boolean`

- [ ] **Step 1: Write the failing unit tests**

Create `tests/unit/modules.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { MODULE_IDS, MODULE_SETTING_KEYS, moduleForPath } from '../../server/utils/modules';

describe('module constants', () => {
  it('lists the three modules in navigation order', () => {
    expect(MODULE_IDS).toEqual(['video', 'music', 'podcasts']);
  });

  it('keeps the existing music setting key unchanged (no migration)', () => {
    expect(MODULE_SETTING_KEYS.music).toBe('music_module_enabled');
    expect(MODULE_SETTING_KEYS.video).toBe('video_module_enabled');
    expect(MODULE_SETTING_KEYS.podcasts).toBe('podcasts_module_enabled');
  });
});

describe('moduleForPath', () => {
  it.each([
    ['/api/videos', 'video'],
    ['/api/videos/abc', 'video'],
    ['/api/videos/recommend', 'video'],
    ['/api/channels', 'video'],
    ['/api/channels/c1/videos', 'video'],
    ['/api/playlists', 'video'],
    ['/api/home/feed', 'video'],
    ['/downloads', 'video'],
    ['/downloads/chan/v.mp4', 'video'],
    ['/api/music', 'music'],
    ['/api/music/artists', 'music'],
    ['/downloads-music', 'music'],
    ['/downloads-music/a/t.opus', 'music'],
    ['/api/podcasts', 'podcasts'],
    ['/api/podcasts/shows/1/episodes', 'podcasts'],
    ['/downloads-podcasts', 'podcasts'],
    ['/downloads-podcasts/s/e.mp3', 'podcasts'],
  ])('maps %s to %s', (path, expected) => {
    expect(moduleForPath(path)).toBe(expected);
  });

  it.each([
    '/api/auth/me',
    '/api/account/tokens',
    '/api/settings/modules',
    '/api/admin/music/ingest',
    '/api/admin/downloader/queue',
    '/api/musicfoo',
    '/api/videosfoo',
    '/downloadsfoo',
    '/login',
    '/',
  ])('does not gate %s', (path) => {
    expect(moduleForPath(path)).toBeNull();
  });

  it('never lets /downloads match /downloads-music or /downloads-podcasts', () => {
    expect(moduleForPath('/downloads-music/x')).toBe('music');
    expect(moduleForPath('/downloads-podcasts/x')).toBe('podcasts');
  });

  it('ignores the query string', () => {
    expect(moduleForPath('/api/music/artists?x=1')).toBe('music');
    expect(moduleForPath('/api/auth/me?x=/api/music')).toBeNull();
  });
});
```

- [ ] **Step 2: Write the failing integration tests**

Create `tests/integration/modules.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  isModuleEnabled,
  getModuleStates,
  setModulesEnabled,
  isEffectivelyPaused,
  LastModuleError,
} from '../../server/utils/modules';
import { createTestDb, insertSetting } from '../helpers/testDb';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
});

const value = (key: string) => (db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined)?.value;

describe('isModuleEnabled', () => {
  it('is enabled when the setting row is missing', () => {
    expect(isModuleEnabled(db, 'video')).toBe(true);
    expect(isModuleEnabled(db, 'podcasts')).toBe(true);
  });

  it('is enabled for "1" and disabled for "0"', () => {
    insertSetting(db, { key: 'music_module_enabled', value: '1' });
    insertSetting(db, { key: 'video_module_enabled', value: '0' });
    expect(isModuleEnabled(db, 'music')).toBe(true);
    expect(isModuleEnabled(db, 'video')).toBe(false);
  });

  it('fails open (enabled) when the read throws', () => {
    const broken = { prepare: () => { throw new Error('db unavailable'); } } as unknown as Database.Database;
    expect(isModuleEnabled(broken, 'music')).toBe(true);
  });
});

describe('getModuleStates', () => {
  it('returns all three states', () => {
    insertSetting(db, { key: 'podcasts_module_enabled', value: '0' });
    expect(getModuleStates(db)).toEqual({ video: true, music: true, podcasts: false });
  });
});

describe('setModulesEnabled', () => {
  it('creates missing rows and updates existing ones', () => {
    insertSetting(db, { key: 'music_module_enabled', value: '1' });
    setModulesEnabled(db, { music: false, podcasts: false });
    expect(value('music_module_enabled')).toBe('0');
    expect(value('podcasts_module_enabled')).toBe('0');
    expect(value('video_module_enabled')).toBeUndefined();
  });

  it('re-enables a module', () => {
    insertSetting(db, { key: 'music_module_enabled', value: '0' });
    setModulesEnabled(db, { music: true });
    expect(value('music_module_enabled')).toBe('1');
  });

  it('refuses to disable the last enabled module and writes nothing', () => {
    insertSetting(db, { key: 'video_module_enabled', value: '0' });
    insertSetting(db, { key: 'podcasts_module_enabled', value: '0' });
    expect(() => setModulesEnabled(db, { music: false })).toThrow(LastModuleError);
    expect(value('music_module_enabled')).toBeUndefined();
  });

  it('refuses a single call that would disable everything, and writes nothing (atomic)', () => {
    expect(() => setModulesEnabled(db, { video: false, music: false, podcasts: false })).toThrow(LastModuleError);
    expect(value('video_module_enabled')).toBeUndefined();
    expect(value('music_module_enabled')).toBeUndefined();
    expect(value('podcasts_module_enabled')).toBeUndefined();
  });

  it('allows swapping which module is the enabled one in a single call', () => {
    insertSetting(db, { key: 'video_module_enabled', value: '0' });
    insertSetting(db, { key: 'music_module_enabled', value: '0' });
    setModulesEnabled(db, { podcasts: false, video: true });
    expect(value('podcasts_module_enabled')).toBe('0');
    expect(value('video_module_enabled')).toBe('1');
  });
});

describe('isEffectivelyPaused', () => {
  it('is false when not paused and the module is enabled', () => {
    insertSetting(db, { key: 'music_downloader_paused', value: '0' });
    expect(isEffectivelyPaused(db, 'music_downloader_paused', 'music')).toBe(false);
  });

  it('is true when the admin paused it', () => {
    insertSetting(db, { key: 'music_downloader_paused', value: '1' });
    expect(isEffectivelyPaused(db, 'music_downloader_paused', 'music')).toBe(true);
  });

  it('is true when the module is disabled, without touching the admin pause flag', () => {
    insertSetting(db, { key: 'music_downloader_paused', value: '0' });
    insertSetting(db, { key: 'music_module_enabled', value: '0' });
    expect(isEffectivelyPaused(db, 'music_downloader_paused', 'music')).toBe(true);
    expect(value('music_downloader_paused')).toBe('0');
  });

  it('resumes exactly to the admin choice once re-enabled', () => {
    insertSetting(db, { key: 'music_downloader_paused', value: '0' });
    insertSetting(db, { key: 'music_module_enabled', value: '0' });
    setModulesEnabled(db, { music: true });
    expect(isEffectivelyPaused(db, 'music_downloader_paused', 'music')).toBe(false);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/modules.test.ts tests/integration/modules.test.ts`
Expected: FAIL — `Cannot find module '../../server/utils/modules'`

- [ ] **Step 4: Implement `server/utils/modules.ts`**

```typescript
import type Database from 'better-sqlite3';

export type ModuleId = 'video' | 'music' | 'podcasts';

export const MODULE_IDS: ModuleId[] = ['video', 'music', 'podcasts'];

// music_module_enabled predates this module and keeps its name so existing
// installs need no migration.
export const MODULE_SETTING_KEYS: Record<ModuleId, string> = {
  video: 'video_module_enabled',
  music: 'music_module_enabled',
  podcasts: 'podcasts_module_enabled',
};

export const MODULE_ROUTE_PREFIXES: Record<ModuleId, string[]> = {
  video: ['/api/videos', '/api/channels', '/api/playlists', '/api/home', '/downloads'],
  music: ['/api/music', '/downloads-music'],
  podcasts: ['/api/podcasts', '/downloads-podcasts'],
};

export class LastModuleError extends Error {
  constructor() {
    super('At least one module must remain enabled.');
    this.name = 'LastModuleError';
  }
}

// A prefix matches the exact path or the path followed by "/" — so "/downloads"
// never matches "/downloads-music", and "/api/music" never matches "/api/musicfoo".
export function moduleForPath(rawPath: string): ModuleId | null {
  const path = rawPath.split('?')[0] || '';
  for (const id of MODULE_IDS) {
    for (const prefix of MODULE_ROUTE_PREFIXES[id]) {
      if (path === prefix || path.startsWith(prefix + '/')) return id;
    }
  }
  return null;
}

export function isModuleEnabled(db: Database.Database, id: ModuleId): boolean {
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(MODULE_SETTING_KEYS[id]) as { value: string } | undefined;
    return row?.value !== '0';
  } catch {
    return true;
  }
}

export function getModuleStates(db: Database.Database): Record<ModuleId, boolean> {
  return {
    video: isModuleEnabled(db, 'video'),
    music: isModuleEnabled(db, 'music'),
    podcasts: isModuleEnabled(db, 'podcasts'),
  };
}

export function setModulesEnabled(db: Database.Database, changes: Partial<Record<ModuleId, boolean>>): void {
  const next = { ...getModuleStates(db), ...changes };
  if (!MODULE_IDS.some((id) => next[id])) {
    throw new LastModuleError();
  }

  const write = db.transaction(() => {
    const upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    for (const id of MODULE_IDS) {
      if (changes[id] !== undefined) {
        upsert.run(MODULE_SETTING_KEYS[id], changes[id] ? '1' : '0');
      }
    }
  });
  write();
}

// Effective pause for background work: the admin's own pause flag OR the module
// being disabled. The pause flag itself is only ever read here, never written.
export function isEffectivelyPaused(db: Database.Database, pausedSettingKey: string, id: ModuleId): boolean {
  const paused = db.prepare('SELECT value FROM settings WHERE key = ?').get(pausedSettingKey) as { value: string } | undefined;
  return paused?.value === '1' || !isModuleEnabled(db, id);
}
```

- [ ] **Step 5: Seed the two new settings**

In `server/utils/db.ts`, find the existing block:

```typescript
  const musicModuleEnabledCheck = db.prepare("SELECT COUNT(*) as count FROM settings WHERE key = 'music_module_enabled'").get() as { count: number };
  if (musicModuleEnabledCheck.count === 0) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('music_module_enabled', '1')").run();
    console.log('Seeded setting music_module_enabled: 1');
  }
```

Add immediately after it:

```typescript

  const videoModuleEnabledCheck = db.prepare("SELECT COUNT(*) as count FROM settings WHERE key = 'video_module_enabled'").get() as { count: number };
  if (videoModuleEnabledCheck.count === 0) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('video_module_enabled', '1')").run();
    console.log('Seeded setting video_module_enabled: 1');
  }

  const podcastsModuleEnabledCheck = db.prepare("SELECT COUNT(*) as count FROM settings WHERE key = 'podcasts_module_enabled'").get() as { count: number };
  if (podcastsModuleEnabledCheck.count === 0) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('podcasts_module_enabled', '1')").run();
    console.log('Seeded setting podcasts_module_enabled: 1');
  }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/modules.test.ts tests/integration/modules.test.ts`
Expected: PASS (all tests in both files)

- [ ] **Step 7: Commit**

```bash
git add server/utils/modules.ts server/utils/db.ts tests/unit/modules.test.ts tests/integration/modules.test.ts
git commit -m "feat: add central module helper and seed video/podcasts module settings

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 2: Generic `moduleGate` middleware

**Files:**
- Create: `server/middleware/moduleGate.ts`
- Delete: `server/middleware/musicModuleGate.ts`
- Rename + modify: `tests/integration/music-module-gate.test.ts` → `tests/integration/module-gate.test.ts`

**Interfaces:**
- Consumes: `moduleForPath`, `isModuleEnabled` (Task 1); `getUserFromSession` (`server/utils/auth.ts`, existing — handles cookies and API tokens).
- Produces: the default-exported H3 handler `moduleGate`.

- [ ] **Step 1: Rename the existing test and point it at the new middleware**

```bash
git mv tests/integration/music-module-gate.test.ts tests/integration/module-gate.test.ts
```

In `tests/integration/module-gate.test.ts` change line 3 from
`import handler from '../../server/middleware/musicModuleGate';` to
`import handler from '../../server/middleware/moduleGate';`
and change `describe('musicModuleGate middleware', () => {` to `describe('moduleGate middleware — music', () => {`. Leave every existing test untouched (they keep guarding Music's behaviour, including both fail-open tests).

- [ ] **Step 2: Append new tests for Video, Podcasts and cross-module isolation**

Append at the end of `tests/integration/module-gate.test.ts` (after the final `});`):

```typescript

describe('moduleGate middleware — video and podcasts', () => {
  it.each([
    ['video', 'video_module_enabled', ['/api/videos', '/api/videos/abc', '/api/channels', '/api/channels/c1', '/api/playlists', '/api/home/feed', '/downloads', '/downloads/chan/v.mp4']],
    ['podcasts', 'podcasts_module_enabled', ['/api/podcasts', '/api/podcasts/shows', '/downloads-podcasts', '/downloads-podcasts/s/e.mp3']],
  ])('blocks every %s route with a 404 for a guest and a regular user when disabled', async (_name, key, paths) => {
    insertSetting(db, { key: key as string, value: '0' });
    const userCookie = loginAs('u1', 'user');
    for (const path of paths as string[]) {
      await expect(handler(mockEvent(undefined, { path }))).rejects.toMatchObject({ statusCode: 404 });
      await expect(handler(mockEvent(userCookie, { path }))).rejects.toMatchObject({ statusCode: 404 });
    }
  });

  it.each([
    ['video_module_enabled', '/api/videos'],
    ['podcasts_module_enabled', '/api/podcasts/shows'],
  ])('lets an admin through when %s is 0', async (key, path) => {
    insertSetting(db, { key, value: '0' });
    const cookie = loginAs('admin1', 'admin');
    expect(await handler(mockEvent(cookie, { path }))).toBeUndefined();
  });

  it('lets an admin through using an API token (no cookie) when the module is disabled', async () => {
    const { createApiToken } = await import('../../server/utils/apiTokens');
    insertSetting(db, { key: 'video_module_enabled', value: '0' });
    insertUser(db, { id: 'admin-token', role: 'admin' });
    const { token } = createApiToken('admin-token', 'cli');
    const event = mockEvent(undefined, { path: '/api/videos', headers: { authorization: `Bearer ${token}` } });
    expect(await handler(event)).toBeUndefined();
  });

  it('uses the h3 404 message for the module it blocked', async () => {
    insertSetting(db, { key: 'video_module_enabled', value: '0' });
    await expect(handler(mockEvent(undefined, { path: '/api/videos/abc' }))).rejects.toMatchObject({
      statusCode: 404,
      statusMessage: 'Cannot find any route matching /api/videos/abc.',
    });
  });

  it('only blocks the disabled module: other modules stay reachable', async () => {
    insertSetting(db, { key: 'video_module_enabled', value: '0' });
    expect(await handler(mockEvent(undefined, { path: '/api/music/artists' }))).toBeUndefined();
    expect(await handler(mockEvent(undefined, { path: '/api/podcasts/shows' }))).toBeUndefined();
  });

  it('does not let a disabled video module block /downloads-music or /downloads-podcasts', async () => {
    insertSetting(db, { key: 'video_module_enabled', value: '0' });
    expect(await handler(mockEvent(undefined, { path: '/downloads-music/a/t.opus' }))).toBeUndefined();
    expect(await handler(mockEvent(undefined, { path: '/downloads-podcasts/s/e.mp3' }))).toBeUndefined();
  });

  it.each(['/api/auth/me', '/api/account/tokens', '/api/settings/modules', '/api/admin/downloader/queue', '/login'])(
    'never gates %s even with every module flag at 0',
    async (path) => {
      insertSetting(db, { key: 'video_module_enabled', value: '0' });
      insertSetting(db, { key: 'music_module_enabled', value: '0' });
      insertSetting(db, { key: 'podcasts_module_enabled', value: '0' });
      expect(await handler(mockEvent(undefined, { path }))).toBeUndefined();
    }
  );
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/integration/module-gate.test.ts`
Expected: FAIL — `Cannot find module '../../server/middleware/moduleGate'`

- [ ] **Step 4: Implement the generic gate and delete the old one**

Create `server/middleware/moduleGate.ts`:

```typescript
import { defineEventHandler, createError } from 'h3';
import { getUserFromSession } from '../utils/auth';
import { moduleForPath, isModuleEnabled } from '../utils/modules';

export default defineEventHandler(async (event) => {
  const path = (event.path || '').split('?')[0] ?? '';
  const moduleId = moduleForPath(path);
  if (!moduleId) return;

  let enabled = true;
  try {
    enabled = isModuleEnabled(getDb(), moduleId);
  } catch {
    enabled = true;
  }
  if (enabled) return;

  try {
    const session = await getUserFromSession(event);
    if (session?.role === 'admin') return;
  } catch {
    return;
  }

  throw createError({ statusCode: 404, statusMessage: `Cannot find any route matching ${path}.` });
});
```

```bash
git rm server/middleware/musicModuleGate.ts
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/integration/module-gate.test.ts`
Expected: PASS (the migrated music tests + the new ones)

Run: `npx vitest run tests/integration/csrf.test.ts tests/integration/force-password-change.test.ts tests/integration/security-headers.test.ts`
Expected: PASS (other middlewares untouched)

- [ ] **Step 6: Commit**

```bash
git add server/middleware/moduleGate.ts tests/integration/module-gate.test.ts
git commit -m "feat: replace musicModuleGate with a generic moduleGate for all modules

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 3: `GET`/`POST /api/(admin/)settings/modules`

**Files:**
- Create: `server/api/settings/modules.get.ts`, `server/api/admin/settings/modules.post.ts`
- Delete: `server/api/settings/music-module.get.ts`, `server/api/admin/settings/music-module.post.ts`
- Rename + rewrite: `tests/integration/music-module-settings.test.ts` → `tests/integration/modules-settings.test.ts`

**Interfaces:**
- Consumes: `getModuleStates`, `setModulesEnabled`, `LastModuleError`, `MODULE_IDS`, `ModuleId` (Task 1); `requireAdmin` (`server/utils/auth.ts`).
- Produces: `GET /api/settings/modules` → `{ video: boolean; music: boolean; podcasts: boolean }`; `POST /api/admin/settings/modules` with body = any non-empty subset of those booleans → same shape (the new states).

Note: `app/components/settings/SettingsMusicTab.vue`, `app/layouts/default.vue` and `app/pages/music/index.vue` still call the old `music-module` endpoints until Tasks 5-6; each of those tasks removes the call. Until then the old endpoints' absence only affects the UI in the dev build between tasks — the full-suite tests do not exercise those Vue files.

- [ ] **Step 1: Rename the old test and rewrite it for the new endpoints**

```bash
git mv tests/integration/music-module-settings.test.ts tests/integration/modules-settings.test.ts
```

Replace the whole content of `tests/integration/modules-settings.test.ts` with:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import getHandler from '../../server/api/settings/modules.get';
import postHandler from '../../server/api/admin/settings/modules.post';
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

const value = (key: string) => (db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined)?.value;
const post = (cookie: string | undefined, body: any) => postHandler(mockEvent(cookie, { path: '/api/admin/settings/modules', body }));

describe('GET /api/settings/modules', () => {
  it('returns every module enabled when no setting exists', async () => {
    const result: any = await getHandler(mockEvent(undefined, { path: '/api/settings/modules' }));
    expect(result).toEqual({ video: true, music: true, podcasts: true });
  });

  it('reflects each module independently', async () => {
    insertSetting(db, { key: 'music_module_enabled', value: '0' });
    insertSetting(db, { key: 'podcasts_module_enabled', value: '0' });
    const result: any = await getHandler(mockEvent(undefined, { path: '/api/settings/modules' }));
    expect(result).toEqual({ video: true, music: false, podcasts: false });
  });

  it('is readable by a guest (public)', async () => {
    await expect(getHandler(mockEvent(undefined, { path: '/api/settings/modules' }))).resolves.toBeDefined();
  });

  it('returns everything enabled when the database is unavailable (fail-open)', async () => {
    (globalThis as any).getDb = () => ({ prepare: () => { throw new Error('Database is locked or unavailable'); } });
    const result: any = await getHandler(mockEvent(undefined, { path: '/api/settings/modules' }));
    expect(result).toEqual({ video: true, music: true, podcasts: true });
  });
});

describe('POST /api/admin/settings/modules', () => {
  it('returns 401 for a guest and 403 for a non-admin', async () => {
    await expect(post(undefined, { music: false })).rejects.toMatchObject({ statusCode: 401 });
    await expect(post(loginAs('u1', 'user'), { music: false })).rejects.toMatchObject({ statusCode: 403 });
  });

  it('returns 400 for an empty body, an unknown key only, or a non-boolean value', async () => {
    const cookie = loginAs('admin1', 'admin');
    await expect(post(cookie, {})).rejects.toMatchObject({ statusCode: 400 });
    await expect(post(cookie, { nope: true })).rejects.toMatchObject({ statusCode: 400 });
    await expect(post(cookie, { music: 'false' })).rejects.toMatchObject({ statusCode: 400 });
    await expect(post(cookie, null)).rejects.toMatchObject({ statusCode: 400 });
  });

  it('persists a single module and returns the new states', async () => {
    const cookie = loginAs('admin1', 'admin');
    const result: any = await post(cookie, { podcasts: false });
    expect(result).toEqual({ video: true, music: true, podcasts: false });
    expect(value('podcasts_module_enabled')).toBe('0');
    expect(value('video_module_enabled')).toBeUndefined();
  });

  it('updates several modules in one call', async () => {
    const cookie = loginAs('admin1', 'admin');
    const result: any = await post(cookie, { video: false, music: false });
    expect(result).toEqual({ video: false, music: false, podcasts: true });
  });

  it('re-enables a module', async () => {
    insertSetting(db, { key: 'music_module_enabled', value: '0' });
    const cookie = loginAs('admin1', 'admin');
    const result: any = await post(cookie, { music: true });
    expect(result.music).toBe(true);
    expect(value('music_module_enabled')).toBe('1');
  });

  it('refuses to disable the last enabled module with 400 and changes nothing', async () => {
    insertSetting(db, { key: 'video_module_enabled', value: '0' });
    insertSetting(db, { key: 'podcasts_module_enabled', value: '0' });
    const cookie = loginAs('admin1', 'admin');
    await expect(post(cookie, { music: false })).rejects.toMatchObject({ statusCode: 400 });
    expect(value('music_module_enabled')).toBeUndefined();
  });

  it('refuses a single call that would disable everything', async () => {
    const cookie = loginAs('admin1', 'admin');
    await expect(post(cookie, { video: false, music: false, podcasts: false })).rejects.toMatchObject({ statusCode: 400 });
    expect(value('video_module_enabled')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/integration/modules-settings.test.ts`
Expected: FAIL — cannot find `server/api/settings/modules.get`

- [ ] **Step 3: Implement the routes and delete the old ones**

Create `server/api/settings/modules.get.ts`:

```typescript
import { defineEventHandler } from 'h3';
import { getModuleStates } from '../../utils/modules';

export default defineEventHandler(async () => {
  try {
    return getModuleStates(getDb());
  } catch {
    return { video: true, music: true, podcasts: true };
  }
});
```

Create `server/api/admin/settings/modules.post.ts`:

```typescript
import { defineEventHandler, readBody, createError } from 'h3';
import { requireAdmin } from '../../../utils/auth';
import { MODULE_IDS, getModuleStates, setModulesEnabled, LastModuleError } from '../../../utils/modules';
import type { ModuleId } from '../../../utils/modules';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);

  const body = await readBody(event);
  if (!body || typeof body !== 'object') {
    throw createError({ statusCode: 400, statusMessage: 'A body with video, music and/or podcasts (boolean) is required.' });
  }

  const changes: Partial<Record<ModuleId, boolean>> = {};
  for (const id of MODULE_IDS) {
    if (id in body) {
      if (typeof body[id] !== 'boolean') {
        throw createError({ statusCode: 400, statusMessage: `${id} must be a boolean.` });
      }
      changes[id] = body[id];
    }
  }
  if (Object.keys(changes).length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'At least one of video, music, podcasts (boolean) is required.' });
  }

  const db = getDb();
  try {
    setModulesEnabled(db, changes);
  } catch (err) {
    if (err instanceof LastModuleError) {
      throw createError({ statusCode: 400, statusMessage: 'At least one module must remain enabled.' });
    }
    throw err;
  }

  return getModuleStates(db);
});
```

```bash
git rm server/api/settings/music-module.get.ts server/api/admin/settings/music-module.post.ts
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/integration/modules-settings.test.ts`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add server/api/settings/modules.get.ts server/api/admin/settings/modules.post.ts tests/integration/modules-settings.test.ts
git commit -m "feat: add generic modules settings endpoints, remove music-module routes

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 4: Background work honours disabled modules

**Files:**
- Modify: `server/utils/concurrency.ts` (`SyncAllEntitiesConfig`, `runSyncAllEntities`)
- Modify: `server/utils/downloader.ts`, `server/utils/musicDownloader.ts`, `server/utils/podcastDownloader.ts` (worker loops, sync-all callers, cron callbacks, metadata refresh)
- Test: `tests/integration/modules-background.test.ts`

**Interfaces:**
- Consumes: `isEffectivelyPaused`, `isModuleEnabled`, `ModuleId` (Task 1).
- Produces: `SyncAllEntitiesConfig.moduleId?: ModuleId` — when set, `runSyncAllEntities` returns immediately (flag untouched) if the module is disabled, and treats a module that becomes disabled mid-loop like a pause.

What is tested directly vs by inspection: `runSyncAllEntities` is tested directly (this task's test file). The three worker `while` loops, the three cron callbacks and the metadata-refresh loop are not unit-testable as written (they own module-level timers/state), so they are edited with exact, minimal replacements below and verified in the reviewer's diff read and in Task 7's real run (a disabled module's download genuinely stays pending).

Deliberately NOT changed: the three `catch` blocks that read the pause flag to decide "was this download interrupted on purpose" (`downloader.ts` ~406, `musicDownloader.ts` ~718 and ~752, `podcastDownloader.ts` ~709). In-flight work finishes normally when a module is disabled (it is not interrupted), so those blocks keep their meaning.

- [ ] **Step 1: Write the failing tests for `runSyncAllEntities`**

Create `tests/integration/modules-background.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { runSyncAllEntities } from '../../server/utils/concurrency';
import { createTestDb, insertSetting } from '../helpers/testDb';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  insertSetting(db, { key: 'music_sync_all_active', value: '0' });
  insertSetting(db, { key: 'music_downloader_paused', value: '0' });
});

const value = (key: string) => (db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined)?.value;

function makeConfig(overrides: Record<string, any> = {}) {
  const calls = { fetch: vi.fn(), process: vi.fn(), onStart: vi.fn(), onPaused: vi.fn(), onComplete: vi.fn(), onFatal: vi.fn(), startWorker: vi.fn() };
  const config = {
    db,
    activeFlagSettingKey: 'music_sync_all_active',
    pausedSettingKey: 'music_downloader_paused',
    moduleId: 'music' as const,
    fetchEntities: () => { calls.fetch(); return [{ id: 'a' }, { id: 'b' }]; },
    processEntity: async (e: { id: string }) => { calls.process(e.id); },
    onStart: calls.onStart,
    onPaused: calls.onPaused,
    onComplete: calls.onComplete,
    onFatalError: calls.onFatal,
    startWorker: calls.startWorker,
    ...overrides,
  };
  return { config, calls };
}

describe('runSyncAllEntities with a moduleId', () => {
  it('runs normally when the module is enabled', async () => {
    const { config, calls } = makeConfig();
    await runSyncAllEntities(config);
    expect(calls.process).toHaveBeenCalledTimes(2);
    expect(calls.onComplete).toHaveBeenCalled();
    expect(value('music_sync_all_active')).toBe('0');
  });

  it('returns immediately when the module is disabled: nothing fetched, flag never raised', async () => {
    insertSetting(db, { key: 'music_module_enabled', value: '0' });
    const { config, calls } = makeConfig();
    await runSyncAllEntities(config);
    expect(calls.fetch).not.toHaveBeenCalled();
    expect(calls.process).not.toHaveBeenCalled();
    expect(calls.onComplete).not.toHaveBeenCalled();
    expect(calls.startWorker).not.toHaveBeenCalled();
    expect(value('music_sync_all_active')).toBe('0');
  });

  it('never touches the admin pause flag, whatever the module state', async () => {
    insertSetting(db, { key: 'music_module_enabled', value: '0' });
    await runSyncAllEntities(makeConfig().config);
    expect(value('music_downloader_paused')).toBe('0');
  });

  it('stops like a pause when the module gets disabled in the middle of the loop', async () => {
    const { config, calls } = makeConfig({
      processEntity: async (e: { id: string }) => {
        calls.process(e.id);
        db.prepare("INSERT INTO settings (key, value) VALUES ('music_module_enabled', '0') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
      },
    });
    await runSyncAllEntities(config);
    expect(calls.process).toHaveBeenCalledTimes(1);
    expect(calls.onPaused).toHaveBeenCalledTimes(1);
    expect(value('music_sync_all_active')).toBe('0');
  });

  it('keeps honouring the admin pause flag as before', async () => {
    db.prepare("UPDATE settings SET value = '1' WHERE key = 'music_downloader_paused'").run();
    const { config, calls } = makeConfig();
    await runSyncAllEntities(config);
    expect(calls.process).not.toHaveBeenCalled();
    expect(calls.onPaused).toHaveBeenCalledTimes(1);
  });

  it('behaves exactly as before when no moduleId is given (backwards compatible)', async () => {
    insertSetting(db, { key: 'music_module_enabled', value: '0' });
    const { config, calls } = makeConfig({ moduleId: undefined });
    await runSyncAllEntities(config);
    expect(calls.process).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/integration/modules-background.test.ts`
Expected: FAIL — the "returns immediately when the module is disabled" and "mid-loop" tests fail (the current `runSyncAllEntities` ignores `moduleId`).

- [ ] **Step 3: Teach `runSyncAllEntities` about modules**

In `server/utils/concurrency.ts`, add to the imports at the top:

```typescript
import { isModuleEnabled, isEffectivelyPaused } from './modules';
import type { ModuleId } from './modules';
```

Add the optional field to `SyncAllEntitiesConfig<T>` (after `startWorker: () => void;`):

```typescript
  // When set, a disabled module makes the whole run a no-op, and a module that
  // gets disabled mid-run stops the loop exactly like a pause.
  moduleId?: ModuleId;
```

In `runSyncAllEntities`, add `moduleId,` to the destructuring list (after `startWorker,`). Then insert, as the very first statement of the function body after the destructuring and BEFORE the `db.prepare(\`UPDATE settings SET value = '1' ...` line:

```typescript
  if (moduleId && !isModuleEnabled(db, moduleId)) {
    return;
  }
```

Replace the in-loop pause check:

```typescript
      const pausedSetting = db.prepare('SELECT value FROM settings WHERE key = ?').get(pausedSettingKey) as { value: string } | undefined;
      if (pausedSetting?.value === '1') {
        onPaused();
        break;
      }
```

with:

```typescript
      const paused = moduleId
        ? isEffectivelyPaused(db, pausedSettingKey, moduleId)
        : (db.prepare('SELECT value FROM settings WHERE key = ?').get(pausedSettingKey) as { value: string } | undefined)?.value === '1';
      if (paused) {
        onPaused();
        break;
      }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/integration/modules-background.test.ts tests/unit/concurrency.test.ts`
Expected: PASS

- [ ] **Step 5: Wire `moduleId` into the three sync-all callers**

In each file, add to the existing `./concurrency` import nothing (it is already imported); pass the new field in the `runSyncAllEntities({ ... })` call, right after the `pausedSettingKey` line:

- `server/utils/downloader.ts` (`syncAllChannels`, `pausedSettingKey: 'downloader_paused',`): add `moduleId: 'video',`
- `server/utils/musicDownloader.ts` (`syncAllMusicArtists`, `pausedSettingKey: 'music_downloader_paused',`): add `moduleId: 'music',`
- `server/utils/podcastDownloader.ts` (`syncAllPodcastShows`, `pausedSettingKey: 'podcast_downloader_paused',`): add `moduleId: 'podcasts',`

- [ ] **Step 6: Make the three worker loops honour a disabled module**

Add the import to each of the three files (next to the existing `./concurrency` import line): `import { isEffectivelyPaused } from './modules';`

`server/utils/downloader.ts` (worker loop, currently ~lines 284-290) — replace:

```typescript
        // Check if global download is paused
        const pausedSetting = db.prepare("SELECT value FROM settings WHERE key = 'downloader_paused'").get() as { value: string } | undefined;
        if (pausedSetting?.value === '1') {
```

with:

```typescript
        // Check if global download is paused, or the Video module is disabled
        if (isEffectivelyPaused(db, 'downloader_paused', 'video')) {
```

`server/utils/musicDownloader.ts` (worker loop, currently ~lines 615-617) — replace:

```typescript
        const pausedSetting = db.prepare("SELECT value FROM settings WHERE key = 'music_downloader_paused'").get() as { value: string } | undefined;
        if (pausedSetting?.value === '1') {
          await sleepOrWakeableMusic(5000);
```

with:

```typescript
        if (isEffectivelyPaused(db, 'music_downloader_paused', 'music')) {
          await sleepOrWakeableMusic(5000);
```

`server/utils/podcastDownloader.ts` (worker loop, currently ~lines 608-610) — replace:

```typescript
        const pausedSetting = db.prepare("SELECT value FROM settings WHERE key = 'podcast_downloader_paused'").get() as { value: string } | undefined;
        if (pausedSetting?.value === '1') {
          await sleepOrWakeablePodcast(5000);
```

with:

```typescript
        if (isEffectivelyPaused(db, 'podcast_downloader_paused', 'podcasts')) {
          await sleepOrWakeablePodcast(5000);
```

(Re-read each region before editing — line numbers may have shifted by a few lines; the surrounding text above is exact. In each loop the removed `pausedSetting` constant was used only by that `if`; confirm with a search inside the same loop body and keep it if anything else still reads it.)

- [ ] **Step 7: Make the video metadata-refresh loop honour a disabled module**

In `server/utils/downloader.ts`, find the metadata refresh loop (`for (const video of videosToRefresh) {`, currently ~line 1610) and replace:

```typescript
    // Check if global download is paused
    const pausedSetting = db.prepare("SELECT value FROM settings WHERE key = 'downloader_paused'").get() as { value: string } | undefined;
    if (pausedSetting?.value === '1') {
      addLog('Metadata refresh aborted: downloader is paused.');
      break;
    }
```

with:

```typescript
    // Check if global download is paused, or the Video module is disabled
    if (isEffectivelyPaused(db, 'downloader_paused', 'video')) {
      addLog('Metadata refresh aborted: downloader is paused or the Video module is disabled.');
      break;
    }
```

- [ ] **Step 8: Make the three cron callbacks skip a disabled module**

Add `isModuleEnabled` to each file's `./modules` import (`import { isEffectivelyPaused, isModuleEnabled } from './modules';`).

`server/utils/downloader.ts` — in the `new Cron(cronExpression, async () => {` callback, directly after the first `console.log('Automated cron trigger: starting channel synchronization...');` line, wait: guard must come BEFORE that log. Replace:

```typescript
      const job = new Cron(cronExpression, async () => {
        console.log('Automated cron trigger: starting channel synchronization...');
```

with:

```typescript
      const job = new Cron(cronExpression, async () => {
        if (!isModuleEnabled(db, 'video')) {
          console.log('Automated cron: Video module is disabled. Skipping.');
          return;
        }
        console.log('Automated cron trigger: starting channel synchronization...');
```

`server/utils/musicDownloader.ts` — replace:

```typescript
      const job = new Cron(cronExpression, async () => {
        console.log('Automated music cron trigger: starting artist synchronization...');
```

with:

```typescript
      const job = new Cron(cronExpression, async () => {
        if (!isModuleEnabled(db, 'music')) {
          console.log('Automated music cron: Music module is disabled. Skipping.');
          return;
        }
        console.log('Automated music cron trigger: starting artist synchronization...');
```

`server/utils/podcastDownloader.ts` — replace:

```typescript
      const job = new Cron(cronExpression, async () => {
        console.log('Automated podcast cron trigger: starting show synchronization...');
```

with:

```typescript
      const job = new Cron(cronExpression, async () => {
        if (!isModuleEnabled(db, 'podcasts')) {
          console.log('Automated podcast cron: Podcasts module is disabled. Skipping.');
          return;
        }
        console.log('Automated podcast cron trigger: starting show synchronization...');
```

- [ ] **Step 9: Run the full suite and the build**

Run: `npx vitest run`
Expected: all tests PASS.

Run: `npx nuxt build 2>&1 | grep -E "Build complete|ERROR|error TS"`
Expected: `Build complete!` and no TypeScript errors.

- [ ] **Step 10: Commit**

```bash
git add server/utils/concurrency.ts server/utils/downloader.ts server/utils/musicDownloader.ts server/utils/podcastDownloader.ts tests/integration/modules-background.test.ts
git commit -m "feat: stop a disabled module's downloads and scheduled sync

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 5: Client — `useModules`, layout, redirect, search

**Files:**
- Create: `app/utils/moduleRouting.ts`, `app/composables/useModules.ts`
- Modify: `app/layouts/default.vue`, `app/middleware/auth.global.ts`, `app/composables/useSearchSuggestions.ts`, `app/pages/search.vue`, `app/pages/music/index.vue`
- Test: `tests/unit/moduleRouting.test.ts`, `tests/component/useModules.test.ts`, update `tests/component/useSearchSuggestions.test.ts`

**Interfaces:**
- Consumes: `GET /api/settings/modules` (Task 3); `spaces` from `~/spaces` (`{ id, homeRoute }`, ids `video|music|podcasts`).
- Produces:
  - `type ModuleId = 'video' | 'music' | 'podcasts'`, `moduleForPagePath(path: string): ModuleId | null` (`app/utils/moduleRouting.ts`)
  - `useModules(): { modules: Ref<Record<ModuleId, boolean>>; enabledModules: ComputedRef<ModuleId[]>; isEnabled(id: string): boolean; firstEnabledHome: ComputedRef<string>; refresh(): Promise<void>; ensureLoaded(): Promise<void> }`
  - `useSearchSuggestions().fetchSuggestions(term, mode, activeSpaceId, enabled?: ModuleId[])` — new optional 4th parameter, default all three.

- [ ] **Step 1: Write the failing unit tests for page-path routing**

Create `tests/unit/moduleRouting.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { moduleForPagePath } from '../../app/utils/moduleRouting';

describe('moduleForPagePath', () => {
  it.each([
    ['/', 'video'],
    ['/shorts', 'video'],
    ['/channels', 'video'],
    ['/subscriptions', 'video'],
    ['/playlists', 'video'],
    ['/playlists/abc', 'video'],
    ['/watch/jNQXAC9IVRw', 'video'],
    ['/music', 'music'],
    ['/music/anything', 'music'],
    ['/podcasts', 'podcasts'],
    ['/podcasts/shows', 'podcasts'],
  ])('%s belongs to %s', (path, expected) => {
    expect(moduleForPagePath(path)).toBe(expected);
  });

  it.each(['/login', '/account', '/settings', '/search', '/admin', '/admin/users', '/musicfoo', '/podcastsfoo', '/channelsfoo'])(
    '%s belongs to no module (never redirected)',
    (path) => {
      expect(moduleForPagePath(path)).toBeNull();
    }
  );
});
```

- [ ] **Step 2: Write the failing component tests for `useModules`**

Create `tests/component/useModules.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useModules } from '../../app/composables/useModules';

const fetchMock = vi.fn();
vi.stubGlobal('$fetch', fetchMock);

beforeEach(() => {
  fetchMock.mockReset();
  const { modules } = useModules();
  modules.value = { video: true, music: true, podcasts: true };
  useState<boolean>('modules_loaded').value = false;
});

describe('useModules', () => {
  it('treats every module as enabled before anything is fetched', () => {
    const { isEnabled, enabledModules, firstEnabledHome } = useModules();
    expect(isEnabled('video')).toBe(true);
    expect(enabledModules.value).toEqual(['video', 'music', 'podcasts']);
    expect(firstEnabledHome.value).toBe('/');
  });

  it('refresh() loads the states from /api/settings/modules', async () => {
    fetchMock.mockResolvedValueOnce({ video: false, music: true, podcasts: false });
    const { refresh, isEnabled, enabledModules } = useModules();
    await refresh();
    expect(fetchMock).toHaveBeenCalledWith('/api/settings/modules');
    expect(isEnabled('video')).toBe(false);
    expect(isEnabled('music')).toBe(true);
    expect(enabledModules.value).toEqual(['music']);
  });

  it('firstEnabledHome follows the order video, music, podcasts', async () => {
    fetchMock.mockResolvedValueOnce({ video: false, music: false, podcasts: true });
    const { refresh, firstEnabledHome } = useModules();
    await refresh();
    expect(firstEnabledHome.value).toBe('/podcasts');

    fetchMock.mockResolvedValueOnce({ video: false, music: true, podcasts: true });
    await refresh();
    expect(firstEnabledHome.value).toBe('/music');
  });

  it('treats everything as enabled when the fetch fails', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network'));
    const { refresh, isEnabled } = useModules();
    await refresh();
    expect(isEnabled('video')).toBe(true);
    expect(isEnabled('music')).toBe(true);
    expect(isEnabled('podcasts')).toBe(true);
  });

  it('treats a missing key in the response as enabled', async () => {
    fetchMock.mockResolvedValueOnce({ music: false });
    const { refresh, isEnabled } = useModules();
    await refresh();
    expect(isEnabled('video')).toBe(true);
    expect(isEnabled('music')).toBe(false);
  });

  it('ensureLoaded() fetches once, then reuses the loaded state', async () => {
    fetchMock.mockResolvedValue({ video: true, music: false, podcasts: true });
    const { ensureLoaded } = useModules();
    await ensureLoaded();
    await ensureLoaded();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('isEnabled() ignores an unknown id (treated as enabled)', () => {
    expect(useModules().isEnabled('something-else')).toBe(true);
  });
});
```

- [ ] **Step 3: Add the failing `useSearchSuggestions` tests for disabled modules**

In `tests/component/useSearchSuggestions.test.ts`, inside the existing `describe('useSearchSuggestions', ...)` block (after the last `it(...)`), add:

```typescript
  it('in global mode, skips disabled modules and only calls the enabled endpoints', async () => {
    fetchMock.mockResolvedValue({ videos: [], tracks: [], episodes: [] });
    const { fetchSuggestions } = useSearchSuggestions();
    fetchSuggestions('foo', 'global', 'video', ['video', 'podcasts']);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock).toHaveBeenCalledWith('/api/videos', { params: { q: 'foo', limit: 3 } });
    expect(fetchMock).toHaveBeenCalledWith('/api/podcasts/episodes/search', { params: { q: 'foo', limit: 3 } });
    expect(fetchMock).not.toHaveBeenCalledWith('/api/music/tracks/search', expect.anything());
  });

  it('in global mode with the default enabled list, still calls all three endpoints', async () => {
    fetchMock.mockResolvedValue({ videos: [], tracks: [], episodes: [] });
    const { fetchSuggestions } = useSearchSuggestions();
    fetchSuggestions('foo', 'global', 'video');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
  });
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/moduleRouting.test.ts tests/component/useModules.test.ts tests/component/useSearchSuggestions.test.ts`
Expected: FAIL — missing `moduleRouting`, missing `useModules`, and the "skips disabled modules" test fails.

- [ ] **Step 5: Implement `app/utils/moduleRouting.ts`**

```typescript
export type ModuleId = 'video' | 'music' | 'podcasts';

const VIDEO_PAGE_PREFIXES = ['/shorts', '/channels', '/subscriptions', '/playlists', '/watch'];

// Which module owns a page route. Cross-module pages (/search, /account,
// /settings, /admin, /login) belong to none, so they are never redirected.
export function moduleForPagePath(rawPath: string): ModuleId | null {
  const path = rawPath.split('?')[0] || '';
  if (path === '/') return 'video';
  if (VIDEO_PAGE_PREFIXES.some((p) => path === p || path.startsWith(p + '/'))) return 'video';
  if (path === '/music' || path.startsWith('/music/')) return 'music';
  if (path === '/podcasts' || path.startsWith('/podcasts/')) return 'podcasts';
  return null;
}
```

- [ ] **Step 6: Implement `app/composables/useModules.ts`**

```typescript
import { computed } from 'vue';
import { spaces } from '~/spaces';
import type { ModuleId } from '~/utils/moduleRouting';

const ORDER: ModuleId[] = ['video', 'music', 'podcasts'];

export const useModules = () => {
  const modules = useState<Record<ModuleId, boolean>>('modules', () => ({ video: true, music: true, podcasts: true }));
  const loaded = useState<boolean>('modules_loaded', () => false);

  const enabledModules = computed(() => ORDER.filter((id) => modules.value[id]));

  const isEnabled = (id: string): boolean => modules.value[id as ModuleId] !== false;

  const firstEnabledHome = computed(() => {
    const space = spaces.find((s) => modules.value[s.id as ModuleId] !== false);
    return space?.homeRoute ?? '/';
  });

  // On any failure everything is treated as enabled, so a transient error can
  // never lock an admin out; the server-side gate is the real enforcement.
  const refresh = async () => {
    try {
      const data = await $fetch<Partial<Record<ModuleId, boolean>>>('/api/settings/modules');
      modules.value = {
        video: data?.video !== false,
        music: data?.music !== false,
        podcasts: data?.podcasts !== false,
      };
    } catch {
      modules.value = { video: true, music: true, podcasts: true };
    } finally {
      loaded.value = true;
    }
  };

  const ensureLoaded = async () => {
    if (!loaded.value) await refresh();
  };

  return { modules, enabledModules, isEnabled, firstEnabledHome, refresh, ensureLoaded };
};
```

- [ ] **Step 7: Update `useSearchSuggestions` to skip disabled modules**

In `app/composables/useSearchSuggestions.ts` change `runFetch` and `fetchSuggestions`.

Replace the signature line `async function runFetch(term: string, mode: SearchMode, activeSpaceId: SpaceId) {` with:

```typescript
  async function runFetch(term: string, mode: SearchMode, activeSpaceId: SpaceId, enabled: SpaceId[]) {
```

Replace the global-mode block:

```typescript
      if (mode === 'global') {
        const [videos, tracks, episodes] = await Promise.all([
          fetchVideos(term, 3),
          fetchTracks(term, 3),
          fetchEpisodes(term, 3),
        ]);
        results = [...videos, ...tracks, ...episodes];
```

with:

```typescript
      if (mode === 'global') {
        const none = Promise.resolve([] as Suggestion[]);
        const [videos, tracks, episodes] = await Promise.all([
          enabled.includes('video') ? fetchVideos(term, 3) : none,
          enabled.includes('music') ? fetchTracks(term, 3) : none,
          enabled.includes('podcasts') ? fetchEpisodes(term, 3) : none,
        ]);
        results = [...videos, ...tracks, ...episodes];
```

Replace `function fetchSuggestions(term: string, mode: SearchMode, activeSpaceId: SpaceId) {` with:

```typescript
  function fetchSuggestions(term: string, mode: SearchMode, activeSpaceId: SpaceId, enabled: SpaceId[] = ['video', 'music', 'podcasts']) {
```

and replace `debounceTimer = setTimeout(() => runFetch(trimmed, mode, activeSpaceId), DEBOUNCE_MS);` with:

```typescript
    debounceTimer = setTimeout(() => runFetch(trimmed, mode, activeSpaceId, enabled), DEBOUNCE_MS);
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/moduleRouting.test.ts tests/component/useModules.test.ts tests/component/useSearchSuggestions.test.ts`
Expected: PASS

- [ ] **Step 9: Wire the layout to `useModules`**

In `app/layouts/default.vue`:

1. Replace the badge on the space switcher item (template line ~25):
`<span v-if="space.id === 'music' && !musicModuleEnabled" class="badge badge-failed" style="margin-left: auto;">Désactivé</span>`
with:
`<span v-if="!isEnabled(space.id)" class="badge badge-failed" style="margin-left: auto;">Désactivé</span>`

2. Replace the script block (currently lines ~259-271):

```typescript
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

with:

```typescript
const { enabledModules, isEnabled, refresh: refreshModules } = useModules();
// Non-admins only see enabled modules; admins see all, disabled ones carry a badge.
const visibleSpaces = computed(() =>
  spaces.filter((s) => isAdmin.value || isEnabled(s.id))
);
```

3. In `onMounted` replace the call `fetchMusicModuleEnabled();` (line ~382) with `refreshModules();`.

4. In `onSearchInput`, change the call
`fetchSuggestions(term, contentSearchMode.value as 'per_space' | 'global', activeSpace.value.id as 'video' | 'music' | 'podcasts');`
to:
`fetchSuggestions(term, contentSearchMode.value as 'per_space' | 'global', activeSpace.value.id as 'video' | 'music' | 'podcasts', enabledModules.value);`

(`useModules` is a Nuxt auto-imported composable from `app/composables`; do not add an import.)

- [ ] **Step 10: Add the global redirect middleware step**

In `app/middleware/auth.global.ts`, add this import at the very top of the file:

```typescript
import { moduleForPagePath } from '~/utils/moduleRouting';
```

and add, as the LAST block inside the middleware function (after the `/admin` check):

```typescript

  // A disabled module is invisible to non-admins: send them to the first
  // enabled module's home. Cross-module pages (/search, /account, ...) belong
  // to no module and are never redirected.
  const { ensureLoaded, isEnabled, firstEnabledHome } = useModules();
  await ensureLoaded();
  const owner = moduleForPagePath(to.path);
  if (owner && !auth.isAdmin.value && !isEnabled(owner)) {
    return navigateTo(firstEnabledHome.value);
  }
```

- [ ] **Step 11: Make the search page skip disabled modules**

In `app/pages/search.vue`:

1. Add `v-if` to the three section elements: `<section class="search-section">` at the Vidéos section → `<section v-if="isEnabled('video')" class="search-section">`; the Musique section → `v-if="isEnabled('music')"`; the Podcasts section → `v-if="isEnabled('podcasts')"` (same attribute position).

2. In the script, add after `const query = ...`:

```typescript
const { isEnabled } = useModules();
```

and replace the three calls at the end of `fetchAll`:

```typescript
  fetchVideos();
  fetchTracks();
  fetchEpisodes();
```

with:

```typescript
  if (isEnabled('video')) fetchVideos();
  if (isEnabled('music')) fetchTracks();
  if (isEnabled('podcasts')) fetchEpisodes();
```

- [ ] **Step 12: Remove the obsolete check from the music page**

In `app/pages/music/index.vue`, inside `onMounted(async () => {`, delete the whole `try { ... } catch (e) { ... }` block that fetches `/api/settings/music-module` (the global redirect middleware and the server gate now enforce this). Keep the lines after it (`if (artistId.value) { fetchArtistDetail(); } else { fetchArtists(); }`). After deleting, search the file: if `router` or `isAdmin` are now unused (grep `router\.` / `isAdmin`), remove only the variables that became unused.

- [ ] **Step 13: Run the suite and the build**

Run: `npx vitest run`
Expected: all tests PASS.

Run: `npx nuxt build 2>&1 | grep -E "Build complete|ERROR|error TS"`
Expected: `Build complete!`, no TypeScript errors.

- [ ] **Step 14: Commit**

```bash
git add app/utils/moduleRouting.ts app/composables/useModules.ts app/composables/useSearchSuggestions.ts app/layouts/default.vue app/middleware/auth.global.ts app/pages/search.vue app/pages/music/index.vue tests/unit/moduleRouting.test.ts tests/component/useModules.test.ts tests/component/useSearchSuggestions.test.ts
git commit -m "feat: client-side module awareness (switcher, redirect, search)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 6: Settings UI — "Modules" panel

**Files:**
- Modify: `app/components/settings/SettingsSystemTab.vue`, `app/components/settings/SettingsMusicTab.vue`

**Interfaces:**
- Consumes: `useModules()` (`modules`, `refresh`) and `POST /api/admin/settings/modules` (Tasks 3, 5); `useToast()` already imported in `SettingsSystemTab.vue`.

This task has no new automated test file (Vue template wiring, verified for real in Task 7); its gate is `npx vitest run` + `npx nuxt build`.

- [ ] **Step 1: Add the "Modules" panel at the top of the System tab**

In `app/components/settings/SettingsSystemTab.vue`, inside `<div class="system-diagnostic-col">` and BEFORE the existing first `<div class="config-section glass-panel">` (the "Engine Binaries" panel), insert:

```html
        <div class="config-section glass-panel">
          <div class="section-title-row">
            <div class="icon-orb bg-pink">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
            </div>
            <div>
              <h3>Modules</h3>
              <p class="section-desc">Active ou désactive chaque espace pour les utilisateurs non-admin. Un module désactivé disparaît de la navigation et son travail en arrière-plan (téléchargements, synchronisation) s'arrête ; les données restent intactes. Les administrateurs gardent accès.</p>
            </div>
          </div>

          <div class="mt-3" style="display: flex; flex-direction: column; gap: 12px;">
            <label
              v-for="m in moduleOptions"
              :key="m.id"
              style="display: flex; align-items: center; justify-content: space-between; gap: 12px; cursor: pointer;"
            >
              <span>
                <strong>{{ m.label }}</strong>
                <span class="section-desc" style="display: block; margin: 2px 0 0;">{{ m.description }}</span>
                <span v-if="isLastEnabledModule(m.id)" class="section-desc" style="display: block; margin: 2px 0 0;">Au moins un module doit rester actif.</span>
              </span>
              <span style="display: flex; align-items: center; gap: 8px; white-space: nowrap;">
                <input
                  type="checkbox"
                  :checked="modules[m.id]"
                  :disabled="savingModuleId !== null || isLastEnabledModule(m.id)"
                  @change="onModuleChange(m.id, $event)"
                />
                <span>{{ modules[m.id] ? 'Activé' : 'Désactivé' }}</span>
              </span>
            </label>
          </div>
        </div>

```

- [ ] **Step 2: Add the script for the panel**

In the `<script setup lang="ts">` block of `SettingsSystemTab.vue`, change the first import line to also import `computed`:

```typescript
import { ref, computed, watch, onUnmounted, onMounted } from 'vue';
```

Add, after the `handleSaveContentSearchMode` function (before the existing `onMounted(() => {`):

```typescript
type ModuleKey = 'video' | 'music' | 'podcasts';

const { modules, refresh: refreshModules } = useModules();
const savingModuleId = ref<ModuleKey | null>(null);

const moduleOptions: { id: ModuleKey; label: string; description: string }[] = [
  { id: 'video', label: 'Vidéo', description: 'Accueil, Shorts, Chaînes, Abonnements, Playlists et lecture vidéo.' },
  { id: 'music', label: 'Musique', description: 'Bibliothèque musicale, artistes, lecteur audio.' },
  { id: 'podcasts', label: 'Podcasts', description: 'Bibliothèque de podcasts et lecteur.' },
];

const enabledModuleCount = computed(() => moduleOptions.filter((m) => modules.value[m.id]).length);
const isLastEnabledModule = (id: ModuleKey) => modules.value[id] && enabledModuleCount.value === 1;

const onModuleChange = async (id: ModuleKey, event: Event) => {
  const enabled = (event.target as HTMLInputElement).checked;
  savingModuleId.value = id;
  try {
    await $fetch('/api/admin/settings/modules', { method: 'POST', body: { [id]: enabled } });
    toast.success(enabled ? 'Module activé.' : 'Module désactivé.');
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Échec de la mise à jour du module.');
  } finally {
    // Always re-read the truth from the server so the switches and the space
    // switcher reflect what was actually saved (e.g. after a refused change).
    await refreshModules();
    savingModuleId.value = null;
  }
};
```

and add `refreshModules();` as the first statement inside the existing `onMounted(() => {` block of this component.

- [ ] **Step 3: Remove the "Module Musique" switch from the Music tab**

In `app/components/settings/SettingsMusicTab.vue`:

1. Delete the first `downloads-header-panel` block in the template — the one containing `<h2>Module Musique</h2>` (currently lines 3-12, from `<div class="downloads-header-panel glass-panel" style="margin-bottom: 16px;">` through its closing `</div>`). Keep the next block ("Clips vidéo") exactly as it is.

2. In the `<script setup>`, delete these now-unused declarations: `const musicModuleEnabled = ref(true);`, `const togglingMusicModule = ref(false);` (if present), the `fetchMusicModuleEnabled` function (it calls `/api/settings/music-module`), and the `toggleMusicModule` function (it calls `/api/admin/settings/music-module`). Also delete the call to `fetchMusicModuleEnabled()` wherever it is invoked (search the file). Do NOT touch `musicDownloadClipsEnabled`, `fetchMusicDownloadClipsEnabled` or `toggleMusicDownloadClips`.

3. Confirm nothing in the repo still references the removed endpoints:
Run: `grep -rn "music-module" app server`
Expected: no output.

- [ ] **Step 4: Verify with the suite and a build**

Run: `npx vitest run`
Expected: all tests PASS.

Run: `npx nuxt build 2>&1 | grep -E "Build complete|ERROR|error TS"`
Expected: `Build complete!`, no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add app/components/settings/SettingsSystemTab.vue app/components/settings/SettingsMusicTab.vue
git commit -m "feat: add Modules panel to Settings System, remove the Music-tab module switch

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 7: Manual end-to-end verification (real Docker + Browser pane)

**Files:** none (verification only — no code changes expected).

Do NOT rely on `curl` alone: interactive-UI bugs escaped curl-only checks on several earlier sub-projects. API/background checks use `curl`; every UI check uses the Browser pane on the Mac's LAN IP.

- [ ] **Step 1: Build, start, seed an admin and a normal user**

```bash
LAN=$(ipconfig getifaddr en0); echo "LAN IP: $LAN"
docker build -t youkeep-test .
docker rm -f ykt >/dev/null 2>&1; docker volume rm ykd5 ykv5 >/dev/null 2>&1
docker volume create ykd5 >/dev/null; docker volume create ykv5 >/dev/null
docker run --rm -v ykv5:/v alpine chown 99:100 /v
docker run -d --name ykt -p 3999:3000 -e PUID=99 -e PGID=100 -v ykd5:/app/data -v ykv5:/downloads/videos youkeep-test
sleep 20
curl -s -X POST http://localhost:3999/api/auth/setup -H 'Content-Type: application/json' -d '{"username":"admin","password":"testtest123"}' >/dev/null
curl -s -c /tmp/a.txt -X POST http://localhost:3999/api/auth/login -H 'Content-Type: application/json' -d '{"username":"admin","password":"testtest123"}' >/dev/null
A=$(grep csrf_token /tmp/a.txt | awk '{print $NF}')
curl -s -b /tmp/a.txt -H "x-csrf-token: $A" -X POST http://localhost:3999/api/admin/users -H 'Content-Type: application/json' -d '{"username":"bob","password":"temp12345","role":"user"}'
curl -s -c /tmp/b.txt -X POST http://localhost:3999/api/auth/login -H 'Content-Type: application/json' -d '{"username":"bob","password":"temp12345"}' >/dev/null
B=$(grep csrf_token /tmp/b.txt | awk '{print $NF}')
curl -s -b /tmp/b.txt -H "x-csrf-token: $B" -X PUT http://localhost:3999/api/account/password -H 'Content-Type: application/json' -d '{"password":"newpass12345"}'
```
Expected: `/api/settings/modules` returns `{"video":true,"music":true,"podcasts":true}` (seeding works):
```bash
curl -s http://localhost:3999/api/settings/modules; echo
docker exec ykt node -e "const D=require('/app/.output/server/node_modules/better-sqlite3');const d=new D('/app/data/youkeep.db',{readonly:true});console.log(d.prepare(\"SELECT key,value FROM settings WHERE key LIKE '%_module_enabled' ORDER BY key\").all())"
```
Expected: three rows (`music_module_enabled`, `podcasts_module_enabled`, `video_module_enabled`), all `'1'`.

- [ ] **Step 2: Background work genuinely stops and resumes (curl)**

```bash
A=$(grep csrf_token /tmp/a.txt | awk '{print $NF}')
# 1. disable Video, then queue a real download as admin (admins bypass the gate)
curl -s -b /tmp/a.txt -H "x-csrf-token: $A" -X POST http://localhost:3999/api/admin/settings/modules -H 'Content-Type: application/json' -d '{"video":false}'; echo
curl -s -b /tmp/a.txt -H "x-csrf-token: $A" -X POST http://localhost:3999/api/admin/downloader/ingest -H 'Content-Type: application/json' -d '{"url":"https://www.youtube.com/watch?v=jNQXAC9IVRw","start_sync":true}' | head -c 120; echo
sleep 45
docker exec ykt sh -c 'find /downloads/videos -name "*.mp4" | wc -l'
curl -s -b /tmp/a.txt http://localhost:3999/api/admin/downloader/queue | python3 -c "import sys,json; d=json.load(sys.stdin); print('isPaused (admin flag):', d['isPaused'], '| queue:', [(v['id'], v['download_status']) for v in d['queue']])"
```
Expected: `0` mp4 files after 45 s; `isPaused` stays `False` (the admin's flag is untouched); the video is `pending`.
```bash
# 2. re-enable: the pending download must now complete
curl -s -b /tmp/a.txt -H "x-csrf-token: $A" -X POST http://localhost:3999/api/admin/settings/modules -H 'Content-Type: application/json' -d '{"video":true}'; echo
for i in $(seq 1 30); do n=$(docker exec ykt sh -c 'find /downloads/videos -name "*.mp4" | wc -l'); [ "$n" -gt 0 ] && break; sleep 5; done; echo "mp4 files after re-enable: $n"
```
Expected: `1` mp4 file after re-enabling.

- [ ] **Step 3: Gate behaviour per role (curl)**

```bash
A=$(grep csrf_token /tmp/a.txt | awk '{print $NF}')
curl -s -b /tmp/a.txt -H "x-csrf-token: $A" -X POST http://localhost:3999/api/admin/settings/modules -H 'Content-Type: application/json' -d '{"podcasts":false}' >/dev/null
for who in "-b /tmp/a.txt" "-b /tmp/b.txt" ""; do
  curl -s -o /dev/null -w "podcasts API [$who]: %{http_code}\n" $who http://localhost:3999/api/podcasts/shows
done
curl -s -o /dev/null -w "video API still reachable for bob: %{http_code}\n" -b /tmp/b.txt http://localhost:3999/api/videos
curl -s -o /dev/null -w "downloads (video file) for bob: %{http_code}\n" -b /tmp/b.txt -H "Range: bytes=0-10" http://localhost:3999/downloads/jawed/jNQXAC9IVRw.mp4
# the last enabled module cannot be disabled (podcasts is already off, so this would leave nothing)
curl -s -w "\nHTTP %{http_code}\n" -b /tmp/a.txt -H "x-csrf-token: $A" -X POST http://localhost:3999/api/admin/settings/modules -H 'Content-Type: application/json' -d '{"video":false,"music":false}'
curl -s http://localhost:3999/api/settings/modules; echo
```
Expected:
- podcasts API: admin `200`, bob `404`, guest `404`;
- bob: `/api/videos` → `200`, the media file → `206`;
- the double-disable request → `HTTP 400` with the message `At least one module must remain enabled.`;
- the final `GET` still shows `{"video":true,"music":true,"podcasts":false}` (nothing was written).
Any other outcome is a real bug: stop and report BLOCKED with the exact output.

- [ ] **Step 4: UI checks in the Browser pane (as admin)**

Reset to all enabled first: `curl -s -b /tmp/a.txt -H "x-csrf-token: $A" -X POST http://localhost:3999/api/admin/settings/modules -H 'Content-Type: application/json' -d '{"video":true,"music":true,"podcasts":true}'`.

With the Browser pane open on `http://<LAN IP>:3999/login`:
1. Log in as `admin` / `testtest123` through the real login form (type into the fields and click the button — do not log in via `fetch`).
2. Go to Settings → System. Confirm the "Modules" panel is the first panel, with three switches all "Activé". Toggle **Podcasts** off through the UI; confirm the toast, the label turns "Désactivé", and open the space switcher in the header: Podcasts is still listed (admin) with the "Désactivé" badge.
3. Toggle **Music** off. Now only Video is enabled: confirm its switch is greyed out with the "Au moins un module doit rester actif." message, and cannot be clicked.
4. Re-enable Music through its switch (the Video switch becomes clickable again).
5. Settings → Music tab: confirm the "Module Musique" switch is gone and the "Clips vidéo" switch is still there.
6. Take a screenshot of the Modules panel in each state for the report.

- [ ] **Step 5: UI checks in the Browser pane (as a normal user)**

1. Log out (header user menu), then log in as `bob` / `newpass12345` through the real form.
2. With Podcasts disabled (admin did it in Step 4 and left it off; if not, disable it via the API as in Step 3): open the space switcher — Podcasts must be absent, Video and Music present. Navigate to `/podcasts` by typing the URL — expect a redirect to `/`.
3. Disable Video and keep Music (as admin via API, in a separate `curl`): reload `/` as bob — expect a redirect to `/music`; the space switcher shows only Music.
4. Set the search mode to global (`curl -s -b /tmp/a.txt -H "x-csrf-token: $A" -X POST http://localhost:3999/api/admin/settings/content-search-mode -H 'Content-Type: application/json' -d '{"mode":"global"}'`), reload, type `zoo` in the header search bar and wait for the dropdown: with only Music enabled, suggestions must come only from Music (no video/podcast calls). Verify no request to `/api/videos` or `/api/podcasts/...` is made: in the page run `performance.getEntriesByType('resource').map(e => e.name).filter(n => /\/api\/(videos|podcasts)/.test(n))` and expect `[]`. Submit the search and confirm `/search` shows only the Musique section.
5. Re-enable everything via API and confirm bob's navigation shows all three spaces again.

- [ ] **Step 6: Clean up and run the full suite**

```bash
docker rm -f ykt >/dev/null 2>&1; docker rmi youkeep-test >/dev/null 2>&1; docker volume rm ykd5 ykv5 >/dev/null 2>&1; rm -f /tmp/a.txt /tmp/b.txt
npx vitest run
```
Expected: all tests PASS.

No commit for this task. If any step reveals a real bug, stop, describe it precisely (expected vs actual, commands, output) and report BLOCKED so the controller can decide on the fix.
