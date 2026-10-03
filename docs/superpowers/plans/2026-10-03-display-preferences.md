# Display Preferences (B1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each user adapt grid density, hide some navigation links and choose a landing space, with the administrator setting instance-wide defaults, on top of a reusable preferences foundation (which sub-project B2 will extend with home-feed settings).

**Architecture:** One pure, typed schema file in `shared/` (validation, defaults, merge, view-building) is imported by both the Nitro server and the Vue app. The server stores only a user's changed keys in `user_preferences` and the admin defaults in the `settings` table; a single public `GET /api/settings/display` returns `{ effective, defaults, overrides, adminDefaults }`. The client keeps that in a `useDisplayPrefs` composable and applies it: a `data-density` attribute on `<html>` (CSS variables scale every grid), a filtered sidebar, and a once-per-tab landing redirect. One shared form component serves the Account page and an admin panel.

**Tech Stack:** Nuxt 4, Nitro (H3), TypeScript, better-sqlite3, Vue 3, Vitest (`server` project: `tests/unit` + `tests/integration`; `component` project: `tests/component`).

## Global Constraints

- Schema: `{ density: 'compact' | 'comfortable' | 'spacious' (default 'comfortable'), hiddenNavLinks ⊆ ['/shorts','/channels','/subscriptions','/playlists'] (default []), landingSpace: 'auto' | 'video' | 'music' | 'podcasts' (default 'auto') }`.
- Resolution order: `APP_DEFAULTS` → admin defaults (settings key `display_defaults`) → user overrides (table `user_preferences`, only the keys the user changed, `ON DELETE CASCADE`). Merge is shallow per key; an array replaces, never merges.
- `null` removes a key; unknown keys are ignored; an invalid value → 400 with nothing written; a body with no recognised key → 400; corrupt or no-longer-valid stored JSON = empty partial and never throws.
- `GET /api/settings/display` is public and returns `{ effective, defaults, overrides (null for guests), adminDefaults }`; reads never fail (fall back to app defaults). `PUT /api/account/preferences` uses `requireUser`. `POST /api/admin/settings/display-defaults` uses `requireAdmin` (+ CSRF like other admin POSTs).
- `forcePasswordChange` is NOT modified: `GET /api/settings/display` is allowed by the existing `/api/settings/` prefix; `PUT /api/account/preferences` stays blocked for a user with a temporary password.
- Home (`/`) and the single link of the music and podcasts spaces are never hideable. Hiding a link is NOT access control (the page stays reachable by URL).
- Landing redirect: client only, at most once per browser tab session and per user (sessionStorage key `landing_applied`), only when entering `/`, after the existing redirects, never when the target is `/` or a disabled module (falls back to `auto`).
- Density: `compact` adds 1 column / scales card widths by 0.8; `comfortable` 0 / 1; `spacious` removes 1 column (never fewer than 1) / scales by 1.25. Each page keeps its own base column counts and breakpoints. Verified in the Browser pane that `repeat(max(1, calc(N + var(--grid-offset, 0))), 1fr)` and `minmax(min(calc(280px * var(--grid-min-scale, 1)), 100%), 1fr)` are honoured.
- Out of scope: home-feed sections and ranking (B2), theme, language, per-page sort defaults.
- Commit trailer on every commit: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- `getDb()` is Nitro's ambient auto-import in `server/`: never import it. In tests use `(globalThis as any).getDb = () => db`.

## File Structure

- Create `shared/displayPrefs.ts` — pure schema/validation/merge/view (imported with relative paths from `server/`, `app/` and tests; no Nuxt auto-imports inside).
- Create `server/utils/displayPrefsStore.ts` — DB reads/writes + `parseChangeOrThrow`.
- Create `server/api/settings/display.get.ts`, `server/api/account/preferences.put.ts`, `server/api/admin/settings/display-defaults.post.ts`.
- Modify `server/utils/db.ts` (new table), `tests/helpers/testDb.ts` (table + helper).
- Create `app/utils/displayPrefs.ts` (`filterNavLinks`, `resolveLandingTarget`), `app/composables/useDisplayPrefs.ts`, `app/composables/useLanding.ts`, `app/components/DisplayPrefsForm.vue`.
- Modify `app/assets/css/main.css`, `app/layouts/default.vue`, `app/middleware/auth.global.ts`, `app/pages/index.vue`, `app/pages/subscriptions.vue`, `app/pages/channels.vue`, `app/pages/account.vue`, `app/components/settings/SettingsSystemTab.vue`.
- Tests: `tests/unit/displayPrefs.test.ts`, `tests/unit/displayPrefsClient.test.ts`, `tests/integration/displayPrefsStore.test.ts`, `tests/integration/display-preferences.test.ts`, `tests/component/useDisplayPrefs.test.ts`, `tests/component/useLanding.test.ts`; extend `tests/integration/force-password-change.test.ts`.
- Decision on sharing code between `server/` and `app/`: the repo has no `shared/` directory today, but Nuxt 4 supports a root `shared/` natively, and plain relative imports work in Nitro, Vite and Vitest alike (the `#shared` alias is NOT used, so the Node-environment Vitest project needs no alias). Task 1 verifies this with `npx nuxt build`.
- Density note, found while reading the real CSS: `/search` renders `<div class="video-grid">` but defines no grid rules for it (not a density target, left untouched); the home page shows its feed as horizontal rows (`.scroll-card { flex: 0 0 260px }`, 220px at ≤900px), so density there scales the card width; the `.video-grid` in `index.vue` is only the search-results mode; the Channels page (videos tab and playlists tab) is styled by an unscoped `<style>` block in `channels.vue`; Subscriptions uses `auto-fill`.

---

## Task 1: Shared schema, storage table, DB store

**Files:**
- Create: `shared/displayPrefs.ts`, `server/utils/displayPrefsStore.ts`
- Modify: `server/utils/db.ts` (new table after `user_hidden_videos`, currently ~lines 166-173), `tests/helpers/testDb.ts`
- Test: `tests/unit/displayPrefs.test.ts`, `tests/integration/displayPrefsStore.test.ts`

**Interfaces:**
- Produces (used by every later task): everything exported below from `shared/displayPrefs.ts` — `Density`, `LandingSpace`, `DENSITIES`, `LANDING_SPACES`, `HIDEABLE_NAV_LINKS`, `DisplayPrefs`, `PrefsPartial`, `PrefKey`, `PREF_KEYS`, `APP_DEFAULTS`, `InvalidPrefError`, `ValidatedChange`, `validatePartial(input: unknown): ValidatedChange`, `parseStoredPartial(raw): PrefsPartial`, `mergePrefs(base, partial): DisplayPrefs`, `applyChange(current, change): PrefsPartial`, `DisplayView`, `buildView(adminDefaults, overrides): DisplayView`; and from the store: `getAdminDefaults(db)`, `getUserOverrides(db, userId)`, `getDisplayView(db, userId | null)`, `saveUserOverrides(db, userId, change)`, `saveAdminDefaults(db, change)`, `parseChangeOrThrow(body)`.

- [ ] **Step 1: Write the failing unit tests for the schema**

Create `tests/unit/displayPrefs.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  APP_DEFAULTS,
  HIDEABLE_NAV_LINKS,
  InvalidPrefError,
  validatePartial,
  parseStoredPartial,
  mergePrefs,
  applyChange,
  buildView,
} from '../../shared/displayPrefs';

describe('APP_DEFAULTS', () => {
  it('has the documented defaults', () => {
    expect(APP_DEFAULTS).toEqual({ density: 'comfortable', hiddenNavLinks: [], landingSpace: 'auto' });
  });

  it('lists exactly the four hideable links', () => {
    expect([...HIDEABLE_NAV_LINKS]).toEqual(['/shorts', '/channels', '/subscriptions', '/playlists']);
  });
});

describe('validatePartial', () => {
  it('accepts valid values for every key', () => {
    const result = validatePartial({ density: 'compact', hiddenNavLinks: ['/shorts', '/playlists'], landingSpace: 'music' });
    expect(result.set).toEqual({ density: 'compact', hiddenNavLinks: ['/shorts', '/playlists'], landingSpace: 'music' });
    expect(result.remove).toEqual([]);
  });

  it('treats null as a removal marker', () => {
    const result = validatePartial({ density: null, landingSpace: 'video' });
    expect(result.set).toEqual({ landingSpace: 'video' });
    expect(result.remove).toEqual(['density']);
  });

  it('ignores unknown keys', () => {
    const result = validatePartial({ density: 'spacious', theme: 'light', extra: 1 });
    expect(result.set).toEqual({ density: 'spacious' });
    expect(result.remove).toEqual([]);
  });

  it('returns an empty change when there is no recognised key', () => {
    expect(validatePartial({ theme: 'light' })).toEqual({ set: {}, remove: [] });
  });

  it.each([
    [{ density: 'huge' }, 'density'],
    [{ density: 3 }, 'density'],
    [{ landingSpace: 'nowhere' }, 'landingSpace'],
    [{ hiddenNavLinks: 'shorts' }, 'hiddenNavLinks'],
    [{ hiddenNavLinks: ['/'] }, 'hiddenNavLinks'],
    [{ hiddenNavLinks: ['/music'] }, 'hiddenNavLinks'],
    [{ hiddenNavLinks: ['/shorts', '/shorts'] }, 'hiddenNavLinks'],
    [{ hiddenNavLinks: [1] }, 'hiddenNavLinks'],
  ])('rejects %j as invalid for %s', (input, key) => {
    try {
      validatePartial(input);
      throw new Error('expected validatePartial to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidPrefError);
      expect((err as InvalidPrefError).key).toBe(key);
    }
  });

  it.each([null, undefined, 'x', 5, [], [1]])('rejects a non-object body %j', (input) => {
    expect(() => validatePartial(input)).toThrow(InvalidPrefError);
  });

  it('accepts an empty array for hiddenNavLinks (show everything)', () => {
    expect(validatePartial({ hiddenNavLinks: [] }).set).toEqual({ hiddenNavLinks: [] });
  });
});

describe('parseStoredPartial', () => {
  it('returns an empty partial for missing input', () => {
    expect(parseStoredPartial(null)).toEqual({});
    expect(parseStoredPartial(undefined)).toEqual({});
    expect(parseStoredPartial('')).toEqual({});
  });

  it('parses a valid stored object', () => {
    expect(parseStoredPartial('{"density":"compact"}')).toEqual({ density: 'compact' });
  });

  it.each(['not json', '[]', '"str"', '{"density":"huge"}', '{"hiddenNavLinks":["/nope"]}'])(
    'treats corrupt or no-longer-valid JSON %s as an empty partial',
    (raw) => {
      expect(parseStoredPartial(raw)).toEqual({});
    }
  );
});

describe('mergePrefs', () => {
  it('overlays only the keys present in the partial', () => {
    expect(mergePrefs(APP_DEFAULTS, { density: 'compact' })).toEqual({ density: 'compact', hiddenNavLinks: [], landingSpace: 'auto' });
  });

  it('replaces an array instead of merging it', () => {
    const base = { ...APP_DEFAULTS, hiddenNavLinks: ['/shorts', '/channels'] };
    expect(mergePrefs(base, { hiddenNavLinks: ['/playlists'] }).hiddenNavLinks).toEqual(['/playlists']);
  });

  it('lets an explicit empty array override a non-empty default', () => {
    const base = { ...APP_DEFAULTS, hiddenNavLinks: ['/shorts'] };
    expect(mergePrefs(base, { hiddenNavLinks: [] }).hiddenNavLinks).toEqual([]);
  });

  it('copies arrays so callers cannot mutate the defaults', () => {
    const merged = mergePrefs(APP_DEFAULTS, null);
    merged.hiddenNavLinks.push('/shorts');
    expect(APP_DEFAULTS.hiddenNavLinks).toEqual([]);
  });
});

describe('applyChange', () => {
  it('sets then removes keys', () => {
    expect(applyChange({ density: 'compact', landingSpace: 'music' }, { set: { density: 'spacious' }, remove: ['landingSpace'] }))
      .toEqual({ density: 'spacious' });
  });
});

describe('buildView', () => {
  it('uses app defaults for a guest with no admin defaults', () => {
    expect(buildView({}, null)).toEqual({ effective: APP_DEFAULTS, defaults: APP_DEFAULTS, overrides: null, adminDefaults: {} });
  });

  it('resolves app defaults → admin defaults → user overrides', () => {
    const view = buildView({ density: 'compact', landingSpace: 'music' }, { landingSpace: 'podcasts' });
    expect(view.defaults).toEqual({ density: 'compact', hiddenNavLinks: [], landingSpace: 'music' });
    expect(view.effective).toEqual({ density: 'compact', hiddenNavLinks: [], landingSpace: 'podcasts' });
    expect(view.overrides).toEqual({ landingSpace: 'podcasts' });
    expect(view.adminDefaults).toEqual({ density: 'compact', landingSpace: 'music' });
  });

  it('gives a logged-in user with no choices an empty overrides object, not null', () => {
    expect(buildView({}, {}).overrides).toEqual({});
  });
});
```

- [ ] **Step 2: Run the unit tests to verify they fail**

Run: `npx vitest run tests/unit/displayPrefs.test.ts`
Expected: FAIL — `Cannot find module '../../shared/displayPrefs'`

- [ ] **Step 3: Implement `shared/displayPrefs.ts`**

```typescript
// Pure module shared by the Nitro server and the Vue app (imported with
// relative paths): no Nuxt auto-imports and no I/O in here.

export type Density = 'compact' | 'comfortable' | 'spacious';
export type LandingSpace = 'auto' | 'video' | 'music' | 'podcasts';

export const DENSITIES: readonly Density[] = ['compact', 'comfortable', 'spacious'];
export const LANDING_SPACES: readonly LandingSpace[] = ['auto', 'video', 'music', 'podcasts'];
export const HIDEABLE_NAV_LINKS = ['/shorts', '/channels', '/subscriptions', '/playlists'] as const;

export interface DisplayPrefs {
  density: Density;
  hiddenNavLinks: string[];
  landingSpace: LandingSpace;
}

export type PrefsPartial = Partial<DisplayPrefs>;
export type PrefKey = keyof DisplayPrefs;
export const PREF_KEYS: readonly PrefKey[] = ['density', 'hiddenNavLinks', 'landingSpace'];

export const APP_DEFAULTS: DisplayPrefs = {
  density: 'comfortable',
  hiddenNavLinks: [],
  landingSpace: 'auto',
};

export class InvalidPrefError extends Error {
  key: string;
  constructor(key: string, message: string) {
    super(message);
    this.name = 'InvalidPrefError';
    this.key = key;
  }
}

export interface ValidatedChange {
  set: PrefsPartial;
  remove: PrefKey[];
}

function validateValue(key: PrefKey, value: unknown): DisplayPrefs[PrefKey] {
  if (key === 'density') {
    if (typeof value === 'string' && (DENSITIES as readonly string[]).includes(value)) return value as Density;
    throw new InvalidPrefError(key, `density must be one of: ${DENSITIES.join(', ')}.`);
  }
  if (key === 'landingSpace') {
    if (typeof value === 'string' && (LANDING_SPACES as readonly string[]).includes(value)) return value as LandingSpace;
    throw new InvalidPrefError(key, `landingSpace must be one of: ${LANDING_SPACES.join(', ')}.`);
  }
  if (!Array.isArray(value)) {
    throw new InvalidPrefError(key, 'hiddenNavLinks must be an array.');
  }
  const allowed = HIDEABLE_NAV_LINKS as readonly string[];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string' || !allowed.includes(item)) {
      throw new InvalidPrefError(key, `hiddenNavLinks may only contain: ${allowed.join(', ')}.`);
    }
    if (seen.has(item)) {
      throw new InvalidPrefError(key, 'hiddenNavLinks must not contain duplicates.');
    }
    seen.add(item);
  }
  return [...value] as string[];
}

// Unknown keys are ignored; an invalid value for a known key throws; null is a
// removal marker (back to the inherited default).
export function validatePartial(input: unknown): ValidatedChange {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new InvalidPrefError('body', 'A JSON object of preferences is required.');
  }
  const set: PrefsPartial = {};
  const remove: PrefKey[] = [];
  for (const key of PREF_KEYS) {
    if (!(key in input)) continue;
    const value = (input as Record<string, unknown>)[key];
    if (value === null) {
      remove.push(key);
      continue;
    }
    (set as Record<string, unknown>)[key] = validateValue(key, value);
  }
  return { set, remove };
}

// Stored JSON that is missing, corrupt or no longer valid is an empty partial.
export function parseStoredPartial(raw: string | null | undefined): PrefsPartial {
  if (!raw) return {};
  try {
    return validatePartial(JSON.parse(raw)).set;
  } catch {
    return {};
  }
}

export function mergePrefs(base: DisplayPrefs, partial: PrefsPartial | null | undefined): DisplayPrefs {
  return {
    density: partial?.density ?? base.density,
    hiddenNavLinks: [...(partial?.hiddenNavLinks ?? base.hiddenNavLinks)],
    landingSpace: partial?.landingSpace ?? base.landingSpace,
  };
}

export function applyChange(current: PrefsPartial, change: ValidatedChange): PrefsPartial {
  const next: PrefsPartial = { ...current, ...change.set };
  for (const key of change.remove) delete next[key];
  return next;
}

export interface DisplayView {
  effective: DisplayPrefs;
  defaults: DisplayPrefs;
  overrides: PrefsPartial | null;
  adminDefaults: PrefsPartial;
}

export function buildView(adminDefaults: PrefsPartial, overrides: PrefsPartial | null): DisplayView {
  const defaults = mergePrefs(APP_DEFAULTS, adminDefaults);
  return { effective: mergePrefs(defaults, overrides), defaults, overrides, adminDefaults };
}
```

- [ ] **Step 4: Run the unit tests to verify they pass**

Run: `npx vitest run tests/unit/displayPrefs.test.ts`
Expected: PASS

- [ ] **Step 5: Add the table to the real schema and to the test schema**

In `server/utils/db.ts`, right after the `user_hidden_videos` table (the block ending `FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE` / `);`), add:

```sql

    CREATE TABLE IF NOT EXISTS user_preferences (
      user_id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
```

In `tests/helpers/testDb.ts`, inside `createTestDb()`'s schema string, add right after the `api_tokens` table:

```sql
    CREATE TABLE user_preferences (
      user_id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
```

and add this exported helper next to `insertApiToken` (raw `data` string on purpose, so tests can store corrupt JSON):

```typescript
export function insertUserPreferences(db: Database.Database, opts: { userId: string; data: string; updatedAt?: number }) {
  db.prepare(`
    INSERT INTO user_preferences (user_id, data, updated_at)
    VALUES (?, ?, ?)
  `).run(opts.userId, opts.data, opts.updatedAt ?? Date.now());
}
```

- [ ] **Step 6: Write the failing integration tests for the store**

Create `tests/integration/displayPrefsStore.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  getAdminDefaults,
  getUserOverrides,
  getDisplayView,
  saveUserOverrides,
  saveAdminDefaults,
  parseChangeOrThrow,
} from '../../server/utils/displayPrefsStore';
import { validatePartial, APP_DEFAULTS } from '../../shared/displayPrefs';
import { createTestDb, insertUser, insertSetting, insertUserPreferences } from '../helpers/testDb';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
});

const row = (userId: string) => db.prepare('SELECT data FROM user_preferences WHERE user_id = ?').get(userId) as { data: string } | undefined;
const change = (input: unknown) => validatePartial(input);

describe('getAdminDefaults / getUserOverrides', () => {
  it('return empty partials when nothing is stored', () => {
    insertUser(db, { id: 'u1', role: 'user' });
    expect(getAdminDefaults(db)).toEqual({});
    expect(getUserOverrides(db, 'u1')).toEqual({});
  });

  it('read stored values', () => {
    insertUser(db, { id: 'u1', role: 'user' });
    insertSetting(db, { key: 'display_defaults', value: '{"density":"compact"}' });
    insertUserPreferences(db, { userId: 'u1', data: '{"landingSpace":"music"}' });
    expect(getAdminDefaults(db)).toEqual({ density: 'compact' });
    expect(getUserOverrides(db, 'u1')).toEqual({ landingSpace: 'music' });
  });

  it('treat corrupt stored JSON as empty', () => {
    insertUser(db, { id: 'u1', role: 'user' });
    insertSetting(db, { key: 'display_defaults', value: 'not json' });
    insertUserPreferences(db, { userId: 'u1', data: '{"density":"huge"}' });
    expect(getAdminDefaults(db)).toEqual({});
    expect(getUserOverrides(db, 'u1')).toEqual({});
  });

  it('never throw when the database is unavailable', () => {
    const broken = { prepare: () => { throw new Error('db down'); } } as unknown as Database.Database;
    expect(getAdminDefaults(broken)).toEqual({});
    expect(getUserOverrides(broken, 'u1')).toEqual({});
  });
});

describe('getDisplayView', () => {
  it('gives a guest the instance defaults and null overrides', () => {
    insertSetting(db, { key: 'display_defaults', value: '{"density":"spacious"}' });
    const view = getDisplayView(db, null);
    expect(view.overrides).toBeNull();
    expect(view.effective.density).toBe('spacious');
  });

  it('gives a user their overrides on top of the instance defaults', () => {
    insertUser(db, { id: 'u1', role: 'user' });
    insertSetting(db, { key: 'display_defaults', value: '{"density":"spacious"}' });
    insertUserPreferences(db, { userId: 'u1', data: '{"density":"compact"}' });
    const view = getDisplayView(db, 'u1');
    expect(view.effective.density).toBe('compact');
    expect(view.defaults.density).toBe('spacious');
    expect(view.overrides).toEqual({ density: 'compact' });
  });
});

describe('saveUserOverrides', () => {
  it('stores only the changed keys', () => {
    insertUser(db, { id: 'u1', role: 'user' });
    saveUserOverrides(db, 'u1', change({ density: 'compact' }));
    expect(JSON.parse(row('u1')!.data)).toEqual({ density: 'compact' });
  });

  it('merges with existing overrides and updates the row', () => {
    insertUser(db, { id: 'u1', role: 'user' });
    saveUserOverrides(db, 'u1', change({ density: 'compact' }));
    saveUserOverrides(db, 'u1', change({ landingSpace: 'music' }));
    expect(JSON.parse(row('u1')!.data)).toEqual({ density: 'compact', landingSpace: 'music' });
  });

  it('removes a key with null and deletes the row once nothing is left', () => {
    insertUser(db, { id: 'u1', role: 'user' });
    saveUserOverrides(db, 'u1', change({ density: 'compact', landingSpace: 'music' }));
    saveUserOverrides(db, 'u1', change({ density: null }));
    expect(JSON.parse(row('u1')!.data)).toEqual({ landingSpace: 'music' });
    saveUserOverrides(db, 'u1', change({ landingSpace: null }));
    expect(row('u1')).toBeUndefined();
  });

  it('replaces a corrupt stored value instead of failing', () => {
    insertUser(db, { id: 'u1', role: 'user' });
    insertUserPreferences(db, { userId: 'u1', data: 'garbage' });
    saveUserOverrides(db, 'u1', change({ density: 'spacious' }));
    expect(JSON.parse(row('u1')!.data)).toEqual({ density: 'spacious' });
  });

  it('deletes the preferences row when the user is deleted (cascade)', () => {
    insertUser(db, { id: 'u1', role: 'user' });
    saveUserOverrides(db, 'u1', change({ density: 'compact' }));
    db.prepare('DELETE FROM users WHERE id = ?').run('u1');
    expect(row('u1')).toBeUndefined();
  });
});

describe('saveAdminDefaults', () => {
  const stored = () => (db.prepare("SELECT value FROM settings WHERE key = 'display_defaults'").get() as { value: string } | undefined)?.value;

  it('creates, updates and finally removes the display_defaults setting', () => {
    saveAdminDefaults(db, change({ density: 'compact' }));
    expect(JSON.parse(stored()!)).toEqual({ density: 'compact' });
    saveAdminDefaults(db, change({ landingSpace: 'podcasts' }));
    expect(JSON.parse(stored()!)).toEqual({ density: 'compact', landingSpace: 'podcasts' });
    saveAdminDefaults(db, change({ density: null, landingSpace: null }));
    expect(stored()).toBeUndefined();
    expect(getDisplayView(db, null).effective).toEqual(APP_DEFAULTS);
  });
});

describe('parseChangeOrThrow', () => {
  it('returns the validated change', () => {
    expect(parseChangeOrThrow({ density: 'compact' }).set).toEqual({ density: 'compact' });
  });

  it('turns an invalid value into an h3 400', () => {
    expect(() => parseChangeOrThrow({ density: 'huge' })).toThrow(expect.objectContaining({ statusCode: 400 }));
  });

  it('turns a non-object body into a 400', () => {
    expect(() => parseChangeOrThrow(null)).toThrow(expect.objectContaining({ statusCode: 400 }));
  });

  it('rejects a body with no recognised key with a 400', () => {
    expect(() => parseChangeOrThrow({ theme: 'light' })).toThrow(expect.objectContaining({ statusCode: 400 }));
    expect(() => parseChangeOrThrow({})).toThrow(expect.objectContaining({ statusCode: 400 }));
  });

  it('accepts a body that only removes keys', () => {
    expect(parseChangeOrThrow({ density: null }).remove).toEqual(['density']);
  });
});
```

- [ ] **Step 7: Run the integration tests to verify they fail**

Run: `npx vitest run tests/integration/displayPrefsStore.test.ts`
Expected: FAIL — `Cannot find module '../../server/utils/displayPrefsStore'`

- [ ] **Step 8: Implement `server/utils/displayPrefsStore.ts`**

```typescript
import type Database from 'better-sqlite3';
import { createError } from 'h3';
import {
  InvalidPrefError,
  applyChange,
  buildView,
  parseStoredPartial,
  validatePartial,
} from '../../shared/displayPrefs';
import type { DisplayView, PrefsPartial, ValidatedChange } from '../../shared/displayPrefs';

export const DISPLAY_DEFAULTS_KEY = 'display_defaults';

export function getAdminDefaults(db: Database.Database): PrefsPartial {
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(DISPLAY_DEFAULTS_KEY) as { value: string } | undefined;
    return parseStoredPartial(row?.value);
  } catch {
    return {};
  }
}

export function getUserOverrides(db: Database.Database, userId: string): PrefsPartial {
  try {
    const row = db.prepare('SELECT data FROM user_preferences WHERE user_id = ?').get(userId) as { data: string } | undefined;
    return parseStoredPartial(row?.data);
  } catch {
    return {};
  }
}

// overrides is null for a guest, an object (possibly empty) for a logged-in user.
export function getDisplayView(db: Database.Database, userId: string | null): DisplayView {
  return buildView(getAdminDefaults(db), userId ? getUserOverrides(db, userId) : null);
}

export function saveUserOverrides(db: Database.Database, userId: string, change: ValidatedChange): void {
  const next = applyChange(getUserOverrides(db, userId), change);
  if (Object.keys(next).length === 0) {
    db.prepare('DELETE FROM user_preferences WHERE user_id = ?').run(userId);
    return;
  }
  db.prepare(`
    INSERT INTO user_preferences (user_id, data, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
  `).run(userId, JSON.stringify(next), Date.now());
}

export function saveAdminDefaults(db: Database.Database, change: ValidatedChange): void {
  const next = applyChange(getAdminDefaults(db), change);
  if (Object.keys(next).length === 0) {
    db.prepare('DELETE FROM settings WHERE key = ?').run(DISPLAY_DEFAULTS_KEY);
    return;
  }
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(DISPLAY_DEFAULTS_KEY, JSON.stringify(next));
}

// Shared by the two write routes: invalid value / no recognised key → 400.
export function parseChangeOrThrow(body: unknown): ValidatedChange {
  let change: ValidatedChange;
  try {
    change = validatePartial(body);
  } catch (err) {
    if (err instanceof InvalidPrefError) {
      throw createError({ statusCode: 400, statusMessage: err.message });
    }
    throw err;
  }
  if (Object.keys(change.set).length === 0 && change.remove.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'At least one of density, hiddenNavLinks, landingSpace is required.' });
  }
  return change;
}
```

- [ ] **Step 9: Run both test files, the full suite and the production build**

Run: `npx vitest run tests/unit/displayPrefs.test.ts tests/integration/displayPrefsStore.test.ts`
Expected: PASS

Run: `npx vitest run`
Expected: all tests PASS.

Run: `npx nuxt build 2>&1 | grep -E "Build complete|ERROR|error TS"`
Expected: `Build complete!` and no error (this confirms the root `shared/` directory is accepted next to `app/` and `server/`; nothing in `app/` imports it yet, so the app-side import is exercised in Task 3).

- [ ] **Step 10: Commit**

```bash
git add shared/displayPrefs.ts server/utils/displayPrefsStore.ts server/utils/db.ts tests/helpers/testDb.ts tests/unit/displayPrefs.test.ts tests/integration/displayPrefsStore.test.ts
git commit -m "feat: add display preferences schema, storage table and store

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 2: API routes

**Files:**
- Create: `server/api/settings/display.get.ts`, `server/api/account/preferences.put.ts`, `server/api/admin/settings/display-defaults.post.ts`
- Test: `tests/integration/display-preferences.test.ts` (new); extend `tests/integration/force-password-change.test.ts`

**Interfaces:**
- Consumes: Task 1's `getDisplayView`, `saveUserOverrides`, `saveAdminDefaults`, `parseChangeOrThrow`, `buildView`; `getUserFromSession`, `requireUser`, `requireAdmin` from `server/utils/auth.ts`.
- Produces: `GET /api/settings/display` → `DisplayView`; `PUT /api/account/preferences` (body = partial, `null` removes) → `DisplayView` for the caller; `POST /api/admin/settings/display-defaults` (same body) → `DisplayView` for the admin.

- [ ] **Step 1: Write the failing route tests**

Create `tests/integration/display-preferences.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import getHandler from '../../server/api/settings/display.get';
import putHandler from '../../server/api/account/preferences.put';
import adminPostHandler from '../../server/api/admin/settings/display-defaults.post';
import { createApiToken } from '../../server/utils/apiTokens';
import { APP_DEFAULTS } from '../../shared/displayPrefs';
import { createTestDb, insertUser, insertSession, insertSetting, insertUserPreferences, mockEvent, sessionCookie } from '../helpers/testDb';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
});

// Call at most once per userId in a test (a second call would violate users' PRIMARY KEY).
function loginAs(userId: string, role: 'admin' | 'user' = 'user') {
  insertUser(db, { id: userId, role });
  insertSession(db, { id: `sess-${userId}`, userId });
  return sessionCookie(`sess-${userId}`);
}

const get = (cookie?: string, headers?: Record<string, string>) => getHandler(mockEvent(cookie, { path: '/api/settings/display', headers }));
const put = (cookie: string | undefined, body: any) => putHandler(mockEvent(cookie, { path: '/api/account/preferences', body, method: 'PUT' }));
const adminPost = (cookie: string | undefined, body: any) => adminPostHandler(mockEvent(cookie, { path: '/api/admin/settings/display-defaults', body, method: 'POST' }));
const storedRow = (userId: string) => db.prepare('SELECT data FROM user_preferences WHERE user_id = ?').get(userId) as { data: string } | undefined;
const storedDefaults = () => (db.prepare("SELECT value FROM settings WHERE key = 'display_defaults'").get() as { value: string } | undefined)?.value;

describe('GET /api/settings/display', () => {
  it('returns the app defaults and null overrides to a guest', async () => {
    const view: any = await get();
    expect(view).toEqual({ effective: APP_DEFAULTS, defaults: APP_DEFAULTS, overrides: null, adminDefaults: {} });
  });

  it('gives a logged-in user with no choices an empty overrides object', async () => {
    const cookie = loginAs('u1');
    const view: any = await get(cookie);
    expect(view.overrides).toEqual({});
    expect(view.effective).toEqual(APP_DEFAULTS);
  });

  it('merges the user overrides over the admin defaults', async () => {
    const cookie = loginAs('u1');
    insertSetting(db, { key: 'display_defaults', value: '{"density":"spacious","landingSpace":"music"}' });
    insertUserPreferences(db, { userId: 'u1', data: '{"landingSpace":"podcasts"}' });
    const view: any = await get(cookie);
    expect(view.effective).toEqual({ density: 'spacious', hiddenNavLinks: [], landingSpace: 'podcasts' });
    expect(view.defaults.landingSpace).toBe('music');
    expect(view.adminDefaults).toEqual({ density: 'spacious', landingSpace: 'music' });
  });

  it('shows a guest the admin defaults', async () => {
    insertSetting(db, { key: 'display_defaults', value: '{"density":"compact"}' });
    const view: any = await get();
    expect(view.effective.density).toBe('compact');
    expect(view.overrides).toBeNull();
  });

  it('resolves a Bearer API token (no cookie) to that user', async () => {
    insertUser(db, { id: 'tok', role: 'user' });
    insertUserPreferences(db, { userId: 'tok', data: '{"density":"compact"}' });
    const { token } = createApiToken('tok', 'phone');
    const view: any = await get(undefined, { authorization: `Bearer ${token}` });
    expect(view.overrides).toEqual({ density: 'compact' });
    expect(view.effective.density).toBe('compact');
  });

  it('treats a corrupt stored row as no overrides', async () => {
    const cookie = loginAs('u1');
    insertUserPreferences(db, { userId: 'u1', data: '{{broken' });
    const view: any = await get(cookie);
    expect(view.overrides).toEqual({});
    expect(view.effective).toEqual(APP_DEFAULTS);
  });

  it('never fails: falls back to the app defaults when the database is unavailable', async () => {
    (globalThis as any).getDb = () => { throw new Error('db down'); };
    const view: any = await get();
    expect(view.effective).toEqual(APP_DEFAULTS);
    expect(view.overrides).toBeNull();
  });
});

describe('PUT /api/account/preferences', () => {
  it('rejects a guest with 401', async () => {
    await expect(put(undefined, { density: 'compact' })).rejects.toMatchObject({ statusCode: 401 });
  });

  it('stores only the changed keys and returns the new view', async () => {
    const cookie = loginAs('u1');
    const view: any = await put(cookie, { density: 'compact' });
    expect(JSON.parse(storedRow('u1')!.data)).toEqual({ density: 'compact' });
    expect(view.overrides).toEqual({ density: 'compact' });
    expect(view.effective.density).toBe('compact');
  });

  it('accepts several keys at once', async () => {
    const cookie = loginAs('u1');
    await put(cookie, { hiddenNavLinks: ['/shorts'], landingSpace: 'music' });
    expect(JSON.parse(storedRow('u1')!.data)).toEqual({ hiddenNavLinks: ['/shorts'], landingSpace: 'music' });
  });

  it('removes a key with null, and deletes the row when nothing is left', async () => {
    const cookie = loginAs('u1');
    await put(cookie, { density: 'compact', landingSpace: 'music' });
    await put(cookie, { density: null });
    expect(JSON.parse(storedRow('u1')!.data)).toEqual({ landingSpace: 'music' });
    await put(cookie, { landingSpace: null });
    expect(storedRow('u1')).toBeUndefined();
  });

  it('writes nothing and returns 400 for an invalid value', async () => {
    const cookie = loginAs('u1');
    await expect(put(cookie, { density: 'huge' })).rejects.toMatchObject({ statusCode: 400 });
    await expect(put(cookie, { hiddenNavLinks: ['/'] })).rejects.toMatchObject({ statusCode: 400 });
    await expect(put(cookie, { hiddenNavLinks: ['/shorts', '/shorts'] })).rejects.toMatchObject({ statusCode: 400 });
    expect(storedRow('u1')).toBeUndefined();
  });

  it('does not partially apply a body that mixes a valid and an invalid key', async () => {
    const cookie = loginAs('u1');
    await expect(put(cookie, { landingSpace: 'music', density: 'huge' })).rejects.toMatchObject({ statusCode: 400 });
    expect(storedRow('u1')).toBeUndefined();
  });

  it('returns 400 for an empty body or a body with no recognised key', async () => {
    const cookie = loginAs('u1');
    await expect(put(cookie, {})).rejects.toMatchObject({ statusCode: 400 });
    await expect(put(cookie, { theme: 'light' })).rejects.toMatchObject({ statusCode: 400 });
    await expect(put(cookie, null)).rejects.toMatchObject({ statusCode: 400 });
  });

  it('works for a Bearer API token', async () => {
    insertUser(db, { id: 'tok', role: 'user' });
    const { token } = createApiToken('tok', 'phone');
    const event = mockEvent(undefined, { path: '/api/account/preferences', body: { density: 'spacious' }, headers: { authorization: `Bearer ${token}` } });
    await putHandler(event);
    expect(JSON.parse(storedRow('tok')!.data)).toEqual({ density: 'spacious' });
  });

  it("never touches another user's preferences", async () => {
    const cookie = loginAs('u1');
    insertUser(db, { id: 'u2', role: 'user' });
    insertUserPreferences(db, { userId: 'u2', data: '{"density":"compact"}' });
    await put(cookie, { density: 'spacious' });
    expect(JSON.parse(storedRow('u2')!.data)).toEqual({ density: 'compact' });
  });
});

describe('POST /api/admin/settings/display-defaults', () => {
  it('returns 401 for a guest and 403 for a non-admin', async () => {
    await expect(adminPost(undefined, { density: 'compact' })).rejects.toMatchObject({ statusCode: 401 });
    await expect(adminPost(loginAs('u1', 'user'), { density: 'compact' })).rejects.toMatchObject({ statusCode: 403 });
    expect(storedDefaults()).toBeUndefined();
  });

  it('stores the defaults and returns the admin view', async () => {
    const cookie = loginAs('admin1', 'admin');
    const view: any = await adminPost(cookie, { density: 'spacious', landingSpace: 'music' });
    expect(JSON.parse(storedDefaults()!)).toEqual({ density: 'spacious', landingSpace: 'music' });
    expect(view.adminDefaults).toEqual({ density: 'spacious', landingSpace: 'music' });
  });

  it('applies to a user without overrides and to a guest, but not over a personal choice', async () => {
    const cookie = loginAs('admin1', 'admin');
    await adminPost(cookie, { density: 'compact' });
    insertUser(db, { id: 'plain', role: 'user' });
    insertUser(db, { id: 'picky', role: 'user' });
    insertUserPreferences(db, { userId: 'picky', data: '{"density":"spacious"}' });
    insertSession(db, { id: 'sess-plain', userId: 'plain' });
    insertSession(db, { id: 'sess-picky', userId: 'picky' });
    expect(((await get(sessionCookie('sess-plain'))) as any).effective.density).toBe('compact');
    expect(((await get(sessionCookie('sess-picky'))) as any).effective.density).toBe('spacious');
    expect(((await get()) as any).effective.density).toBe('compact');
  });

  it('removes a default with null and deletes the setting when nothing is left', async () => {
    const cookie = loginAs('admin1', 'admin');
    await adminPost(cookie, { density: 'compact' });
    await adminPost(cookie, { density: null });
    expect(storedDefaults()).toBeUndefined();
  });

  it('returns 400 and writes nothing for an invalid value or an empty body', async () => {
    const cookie = loginAs('admin1', 'admin');
    await expect(adminPost(cookie, { density: 'huge' })).rejects.toMatchObject({ statusCode: 400 });
    await expect(adminPost(cookie, {})).rejects.toMatchObject({ statusCode: 400 });
    expect(storedDefaults()).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/integration/display-preferences.test.ts`
Expected: FAIL — cannot find `server/api/settings/display.get`.

- [ ] **Step 3: Implement the three routes**

Create `server/api/settings/display.get.ts`:

```typescript
import { defineEventHandler } from 'h3';
import { getUserFromSession } from '../../utils/auth';
import { getDisplayView } from '../../utils/displayPrefsStore';
import { buildView } from '../../../shared/displayPrefs';

// Public: a guest gets the instance defaults, a logged-in caller (cookie
// session or Bearer API token) additionally gets their own overrides. Reads
// never fail: on any error the app defaults are returned.
export default defineEventHandler(async (event) => {
  try {
    const session = await getUserFromSession(event);
    return getDisplayView(getDb(), session?.id ?? null);
  } catch {
    return buildView({}, null);
  }
});
```

Create `server/api/account/preferences.put.ts`:

```typescript
import { defineEventHandler, readBody } from 'h3';
import { requireUser } from '../../utils/auth';
import { getDisplayView, saveUserOverrides, parseChangeOrThrow } from '../../utils/displayPrefsStore';

export default defineEventHandler(async (event) => {
  const session = await requireUser(event);
  const change = parseChangeOrThrow(await readBody(event));

  const db = getDb();
  saveUserOverrides(db, session.id, change);
  return getDisplayView(db, session.id);
});
```

Create `server/api/admin/settings/display-defaults.post.ts`:

```typescript
import { defineEventHandler, readBody } from 'h3';
import { requireAdmin } from '../../../utils/auth';
import { getDisplayView, saveAdminDefaults, parseChangeOrThrow } from '../../../utils/displayPrefsStore';

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event);
  const change = parseChangeOrThrow(await readBody(event));

  const db = getDb();
  saveAdminDefaults(db, change);
  return getDisplayView(db, session.id);
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/integration/display-preferences.test.ts`
Expected: PASS

- [ ] **Step 5: Prove the forced-password-change behaviour (no middleware change)**

In `tests/integration/force-password-change.test.ts`, add inside the existing `describe('forcePasswordChange middleware', ...)` block (reuse its existing `mustChange(userId)` helper and `middleware` import):

```typescript
  it('lets a user with a temporary password read the display settings but not write preferences', async () => {
    const cookie = mustChange('u1');
    await expect(middleware(mockEvent(cookie, { path: '/api/settings/display' }))).resolves.toBeUndefined();
    await expect(middleware(mockEvent(cookie, { path: '/api/account/preferences', method: 'PUT' }))).rejects.toMatchObject({ statusCode: 403 });
  });
```

Run: `npx vitest run tests/integration/force-password-change.test.ts`
Expected: PASS (the middleware itself is unchanged: `/api/settings/` is already allow-listed and `/api/account/preferences` is not).

- [ ] **Step 6: Full suite**

Run: `npx vitest run`
Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add server/api/settings/display.get.ts server/api/account/preferences.put.ts server/api/admin/settings/display-defaults.post.ts tests/integration/display-preferences.test.ts tests/integration/force-password-change.test.ts
git commit -m "feat: add display preferences API (read, user write, admin defaults)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 3: Client helpers, `useDisplayPrefs`, `useLanding`

**Files:**
- Create: `app/utils/displayPrefs.ts`, `app/composables/useDisplayPrefs.ts`, `app/composables/useLanding.ts`
- Test: `tests/unit/displayPrefsClient.test.ts`, `tests/component/useDisplayPrefs.test.ts`, `tests/component/useLanding.test.ts`

**Interfaces:**
- Consumes: `shared/displayPrefs` (Task 1); `GET /api/settings/display`, `PUT /api/account/preferences`, `POST /api/admin/settings/display-defaults` (Task 2); existing `useAuth()` (`user` ref with `id`), `useModules()` (`ensureLoaded`, `enabledModules`), `ModuleId` from `app/utils/moduleRouting.ts`.
- Produces:
  - `filterNavLinks<T extends { to: string }>(links: T[], hidden: string[]): T[]`
  - `resolveLandingTarget(landing: LandingSpace, enabled: ModuleId[]): string | null`
  - `useDisplayPrefs(): { view: Ref<DisplayView>; effective: ComputedRef<DisplayPrefs>; ensureLoaded(): Promise<void>; refresh(): Promise<void>; saveOverrides(partial): Promise<DisplayView>; saveAdminDefaults(partial): Promise<DisplayView> }` — `ensureLoaded` refetches whenever the logged-in user id differs from the one the state was loaded for (so login/logout are picked up); `saveOverrides`/`saveAdminDefaults` throw the `$fetch` error on failure (callers handle toasts) and never change the state on failure.
  - `useLanding(): { consumeLandingTarget(): Promise<string | null> }` — client only; returns the route to start on at most once per browser tab session and per user (sessionStorage `landing_applied` holds the user id or `'guest'`), else `null`.

- [ ] **Step 1: Write the failing unit tests for the pure helpers**

Create `tests/unit/displayPrefsClient.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { filterNavLinks, resolveLandingTarget } from '../../app/utils/displayPrefs';

const videoLinks = [
  { to: '/', label: 'Home' },
  { to: '/shorts', label: 'Shorts' },
  { to: '/channels', label: 'Channels' },
  { to: '/subscriptions', label: 'Subscriptions' },
  { to: '/playlists', label: 'Playlists' },
];

describe('filterNavLinks', () => {
  it('returns every link when nothing is hidden', () => {
    expect(filterNavLinks(videoLinks, [])).toEqual(videoLinks);
  });

  it('hides only the requested hideable links', () => {
    expect(filterNavLinks(videoLinks, ['/shorts', '/playlists']).map((l) => l.to)).toEqual(['/', '/channels', '/subscriptions']);
  });

  it('never hides Home, even if "/" is listed', () => {
    expect(filterNavLinks(videoLinks, ['/', '/shorts', '/channels', '/subscriptions', '/playlists']).map((l) => l.to)).toEqual(['/']);
  });

  it('never hides the single library link of the music and podcasts spaces', () => {
    const music = [{ to: '/music', label: 'Bibliothèque' }];
    const podcasts = [{ to: '/podcasts', label: 'Bibliothèque' }];
    expect(filterNavLinks(music, ['/music', '/shorts'])).toEqual(music);
    expect(filterNavLinks(podcasts, ['/podcasts'])).toEqual(podcasts);
  });

  it('does not mutate its input', () => {
    const input = [...videoLinks];
    filterNavLinks(input, ['/shorts']);
    expect(input).toEqual(videoLinks);
  });
});

describe('resolveLandingTarget', () => {
  const all = ['video', 'music', 'podcasts'] as const;

  it('auto with Video enabled stays on the Video home (no redirect)', () => {
    expect(resolveLandingTarget('auto', [...all])).toBeNull();
  });

  it('auto without Video goes to the first enabled module', () => {
    expect(resolveLandingTarget('auto', ['music', 'podcasts'])).toBe('/music');
    expect(resolveLandingTarget('auto', ['podcasts'])).toBe('/podcasts');
  });

  it('an explicit enabled choice goes to that module home', () => {
    expect(resolveLandingTarget('music', [...all])).toBe('/music');
    expect(resolveLandingTarget('podcasts', [...all])).toBe('/podcasts');
  });

  it('an explicit Video choice means no redirect', () => {
    expect(resolveLandingTarget('video', [...all])).toBeNull();
  });

  it('an explicit choice that is disabled falls back to auto', () => {
    expect(resolveLandingTarget('music', ['video', 'podcasts'])).toBeNull();
    expect(resolveLandingTarget('music', ['podcasts'])).toBe('/podcasts');
  });

  it('returns null when nothing is enabled', () => {
    expect(resolveLandingTarget('auto', [])).toBeNull();
    expect(resolveLandingTarget('music', [])).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/displayPrefsClient.test.ts`
Expected: FAIL — cannot find `app/utils/displayPrefs`.

- [ ] **Step 3: Implement `app/utils/displayPrefs.ts`**

```typescript
import { HIDEABLE_NAV_LINKS } from '../../shared/displayPrefs';
import type { LandingSpace } from '../../shared/displayPrefs';
import type { ModuleId } from './moduleRouting';

// A link is dropped only if it is hideable AND listed as hidden, so Home ('/')
// and the single library link of the music/podcasts spaces can never disappear.
export function filterNavLinks<T extends { to: string }>(links: T[], hidden: string[]): T[] {
  const hideable = HIDEABLE_NAV_LINKS as readonly string[];
  return links.filter((link) => !(hideable.includes(link.to) && hidden.includes(link.to)));
}

const HOMES: Record<ModuleId, string> = { video: '/', music: '/music', podcasts: '/podcasts' };
const ORDER: ModuleId[] = ['video', 'music', 'podcasts'];

// Route to start on, or null when no redirect is needed (the Video home is
// '/', which is where an entry to the app already lands).
export function resolveLandingTarget(landing: LandingSpace, enabled: ModuleId[]): string | null {
  const target: ModuleId | undefined =
    landing !== 'auto' && enabled.includes(landing) ? landing : ORDER.find((id) => enabled.includes(id));
  if (!target) return null;
  const home = HOMES[target];
  return home === '/' ? null : home;
}
```

- [ ] **Step 4: Run to verify the helpers pass**

Run: `npx vitest run tests/unit/displayPrefsClient.test.ts`
Expected: PASS

- [ ] **Step 5: Write the failing component tests for `useDisplayPrefs`**

Create `tests/component/useDisplayPrefs.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useDisplayPrefs } from '../../app/composables/useDisplayPrefs';
import { buildView } from '../../shared/displayPrefs';

const fetchMock = vi.fn();
vi.stubGlobal('$fetch', fetchMock);

function setUser(id: string | null) {
  useState<any>('auth_user').value = id ? { id, username: id, role: 'user' } : null;
}

beforeEach(() => {
  fetchMock.mockReset();
  useState<any>('display_prefs').value = buildView({}, null);
  useState<any>('display_prefs_for').value = undefined;
  setUser(null);
});

describe('useDisplayPrefs', () => {
  it('starts with the app defaults', () => {
    const { effective } = useDisplayPrefs();
    expect(effective.value).toEqual({ density: 'comfortable', hiddenNavLinks: [], landingSpace: 'auto' });
  });

  it('ensureLoaded fetches the view once for the same user', async () => {
    fetchMock.mockResolvedValue(buildView({ density: 'compact' }, null));
    const { ensureLoaded, effective } = useDisplayPrefs();
    await ensureLoaded();
    await ensureLoaded();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/settings/display');
    expect(effective.value.density).toBe('compact');
  });

  it('refetches when the logged-in user changes (login / logout)', async () => {
    fetchMock.mockResolvedValue(buildView({}, null));
    const { ensureLoaded } = useDisplayPrefs();
    await ensureLoaded();
    setUser('u1');
    await ensureLoaded();
    setUser(null);
    await ensureLoaded();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('keeps the app defaults when the fetch fails', async () => {
    fetchMock.mockRejectedValue(new Error('network'));
    const { ensureLoaded, effective } = useDisplayPrefs();
    await ensureLoaded();
    expect(effective.value.density).toBe('comfortable');
  });

  it('saveOverrides PUTs the partial and applies the returned view', async () => {
    const returned = buildView({}, { density: 'spacious' });
    fetchMock.mockResolvedValueOnce(returned);
    const { saveOverrides, view } = useDisplayPrefs();
    const result = await saveOverrides({ density: 'spacious' });
    expect(fetchMock).toHaveBeenCalledWith('/api/account/preferences', { method: 'PUT', body: { density: 'spacious' } });
    expect(result).toEqual(returned);
    expect(view.value.overrides).toEqual({ density: 'spacious' });
  });

  it('saveAdminDefaults POSTs the partial and applies the returned view', async () => {
    const returned = buildView({ landingSpace: 'music' }, {});
    fetchMock.mockResolvedValueOnce(returned);
    const { saveAdminDefaults, effective } = useDisplayPrefs();
    await saveAdminDefaults({ landingSpace: 'music' });
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/settings/display-defaults', { method: 'POST', body: { landingSpace: 'music' } });
    expect(effective.value.landingSpace).toBe('music');
  });

  it('leaves the state untouched and rethrows when a save fails', async () => {
    fetchMock.mockRejectedValueOnce(Object.assign(new Error('bad'), { data: { statusMessage: 'Invalid' } }));
    const { saveOverrides, effective } = useDisplayPrefs();
    await expect(saveOverrides({ density: 'compact' })).rejects.toThrow('bad');
    expect(effective.value.density).toBe('comfortable');
  });
});
```

- [ ] **Step 6: Write the failing component tests for `useLanding`**

Create `tests/component/useLanding.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useLanding } from '../../app/composables/useLanding';
import { buildView } from '../../shared/displayPrefs';

const fetchMock = vi.fn();
vi.stubGlobal('$fetch', fetchMock);

const realSessionStorage = window.sessionStorage;

let modulesResponse = { video: true, music: true, podcasts: true };
let displayResponse = buildView({}, null);

function setUser(id: string | null) {
  useState<any>('auth_user').value = id ? { id, username: id, role: 'user' } : null;
}

beforeEach(() => {
  fetchMock.mockReset();
  modulesResponse = { video: true, music: true, podcasts: true };
  displayResponse = buildView({}, null);
  fetchMock.mockImplementation(async (url: string) => {
    if (url === '/api/settings/modules') return modulesResponse;
    if (url === '/api/settings/display') return displayResponse;
    throw new Error(`unexpected fetch ${url}`);
  });
  useState<any>('modules').value = { video: true, music: true, podcasts: true };
  useState<boolean>('modules_loaded').value = false;
  useState<any>('display_prefs').value = buildView({}, null);
  useState<any>('display_prefs_for').value = undefined;
  setUser(null);
  window.sessionStorage.clear();
});

afterEach(() => {
  Object.defineProperty(window, 'sessionStorage', { configurable: true, writable: true, value: realSessionStorage });
});

describe('useLanding.consumeLandingTarget', () => {
  it('returns null for the default (auto, Video enabled) and still consumes the once-per-session marker', async () => {
    const { consumeLandingTarget } = useLanding();
    expect(await consumeLandingTarget()).toBeNull();
    expect(window.sessionStorage.getItem('landing_applied')).toBe('guest');
  });

  it('returns the chosen space home the first time only', async () => {
    displayResponse = buildView({ landingSpace: 'music' }, null);
    const { consumeLandingTarget } = useLanding();
    expect(await consumeLandingTarget()).toBe('/music');
    expect(await consumeLandingTarget()).toBeNull();
  });

  it('applies again for a different user in the same tab', async () => {
    displayResponse = buildView({ landingSpace: 'podcasts' }, null);
    const { consumeLandingTarget } = useLanding();
    expect(await consumeLandingTarget()).toBe('/podcasts');
    setUser('u1');
    expect(await consumeLandingTarget()).toBe('/podcasts');
    expect(window.sessionStorage.getItem('landing_applied')).toBe('u1');
  });

  it('ignores an explicit choice that points to a disabled module', async () => {
    modulesResponse = { video: true, music: false, podcasts: true };
    displayResponse = buildView({ landingSpace: 'music' }, null);
    const { consumeLandingTarget } = useLanding();
    expect(await consumeLandingTarget()).toBeNull();
  });

  it('with auto and Video disabled goes to the first enabled module', async () => {
    modulesResponse = { video: false, music: false, podcasts: true };
    const { consumeLandingTarget } = useLanding();
    expect(await consumeLandingTarget()).toBe('/podcasts');
  });

  it('never redirects (and never throws) when sessionStorage is unavailable', async () => {
    displayResponse = buildView({ landingSpace: 'music' }, null);
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      writable: true,
      value: { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, clear: () => {} },
    });
    const { consumeLandingTarget } = useLanding();
    expect(await consumeLandingTarget()).toBeNull();
  });
});
```

- [ ] **Step 7: Run both component test files to verify failure**

Run: `npx vitest run tests/component/useDisplayPrefs.test.ts tests/component/useLanding.test.ts`
Expected: FAIL — missing composables.

- [ ] **Step 8: Implement `useDisplayPrefs`**

Create `app/composables/useDisplayPrefs.ts`:

```typescript
import { computed } from 'vue';
import { buildView } from '../../shared/displayPrefs';
import type { DisplayView } from '../../shared/displayPrefs';

export const useDisplayPrefs = () => {
  const auth = useAuth();
  const view = useState<DisplayView>('display_prefs', () => buildView({}, null));
  // Which user (id, or null for a guest) the state was loaded for; undefined = never loaded.
  const loadedFor = useState<string | null | undefined>('display_prefs_for', () => undefined);

  const effective = computed(() => view.value.effective);

  const refresh = async () => {
    const userId = auth.user.value?.id ?? null;
    // useRequestFetch forwards the caller's cookies during SSR (a plain $fetch would not),
    // and is the browser $fetch on the client.
    const requestFetch = useRequestFetch();
    try {
      view.value = await requestFetch<DisplayView>('/api/settings/display');
    } catch {
      view.value = buildView({}, null);
    } finally {
      loadedFor.value = userId;
    }
  };

  const ensureLoaded = async () => {
    if (loadedFor.value !== (auth.user.value?.id ?? null)) await refresh();
  };

  // Saves throw the $fetch error on failure (the caller shows it) and leave the state untouched.
  const saveOverrides = async (partial: Record<string, unknown>) => {
    const data = await $fetch<DisplayView>('/api/account/preferences', { method: 'PUT', body: partial });
    view.value = data;
    return data;
  };

  const saveAdminDefaults = async (partial: Record<string, unknown>) => {
    const data = await $fetch<DisplayView>('/api/admin/settings/display-defaults', { method: 'POST', body: partial });
    view.value = data;
    return data;
  };

  return { view, effective, ensureLoaded, refresh, saveOverrides, saveAdminDefaults };
};
```


- [ ] **Step 9: Implement `useLanding`**

Create `app/composables/useLanding.ts`:

```typescript
import { resolveLandingTarget } from '../utils/displayPrefs';

const MARKER_KEY = 'landing_applied';

export const useLanding = () => {
  const auth = useAuth();
  const modules = useModules();
  const prefs = useDisplayPrefs();

  // The route to start on, at most once per browser tab session and per user,
  // or null. Client only; any sessionStorage failure means "no redirect".
  const consumeLandingTarget = async (): Promise<string | null> => {
    if (!import.meta.client) return null;
    const userKey = auth.user.value?.id ?? 'guest';
    try {
      if (window.sessionStorage.getItem(MARKER_KEY) === userKey) return null;
      window.sessionStorage.setItem(MARKER_KEY, userKey);
    } catch {
      return null;
    }
    await Promise.all([modules.ensureLoaded(), prefs.ensureLoaded()]);
    return resolveLandingTarget(prefs.effective.value.landingSpace, modules.enabledModules.value);
  };

  return { consumeLandingTarget };
};
```

- [ ] **Step 10: Run the tests, the full suite and the build**

Run: `npx vitest run tests/unit/displayPrefsClient.test.ts tests/component/useDisplayPrefs.test.ts tests/component/useLanding.test.ts`
Expected: PASS. If a component test fails only because `useRequestFetch` is not the stubbed `$fetch` in the test environment, change `useDisplayPrefs.refresh` to call `requestFetch` obtained as `const requestFetch = import.meta.server ? useRequestFetch() : $fetch;` and re-run — the behaviour (cookie-forwarding on the server, browser `$fetch` on the client) must stay the same.

Run: `npx vitest run` → all PASS. Run: `npx nuxt build 2>&1 | grep -E "Build complete|ERROR|error TS"` → `Build complete!` (this is the first build that imports `shared/` from `app/`).

- [ ] **Step 11: Commit**

```bash
git add app/utils/displayPrefs.ts app/composables/useDisplayPrefs.ts app/composables/useLanding.ts tests/unit/displayPrefsClient.test.ts tests/component/useDisplayPrefs.test.ts tests/component/useLanding.test.ts
git commit -m "feat: add display preferences client helpers and composables

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 4: Density

**Files:**
- Modify: `app/assets/css/main.css`, `app/layouts/default.vue`, `app/middleware/auth.global.ts`, `app/pages/index.vue`, `app/pages/subscriptions.vue`, `app/pages/channels.vue`

**Interfaces:**
- Consumes: `useDisplayPrefs()` (Task 3): `effective.value.density`, `ensureLoaded()`.
- Produces: `<html data-density="compact|comfortable|spacious">` (server-rendered) and the CSS variables `--grid-offset` / `--grid-min-scale` that grid rules use.

No new automated test (CSS and layout wiring are verified for real in Task 7, where column counts are measured in the Browser pane); the gate is the full suite + a clean build. The CSS technique itself was already verified in the Browser pane before this plan was written: `repeat(max(1, calc(4 + var(--grid-offset, 0))), 1fr)` gives 5 tracks for offset 1 and 1 track for offset −9; `minmax(min(calc(280px * var(--s, 1)), 100%), 1fr)` shrinks the minimum (0.8 → 4 tracks of 250px in 1000px); `flex: 0 0 calc(260px * var(--s, 1))` gives 325px at 1.25.

- [ ] **Step 1: Add the density variables to `main.css`**

In `app/assets/css/main.css`, immediately after the closing `}` of the first `:root { ... }` block, add:

```css

/* Display density (see DisplayPrefs). Pages fold these into their own grid and
   card-width rules; comfortable keeps every page exactly as it was. */
:root {
  --grid-offset: 0;
  --grid-min-scale: 1;
}

html[data-density="compact"] {
  --grid-offset: 1;
  --grid-min-scale: 0.8;
}

html[data-density="spacious"] {
  --grid-offset: -1;
  --grid-min-scale: 1.25;
}
```

- [ ] **Step 2: Set `data-density` on `<html>`, server-side too**

In `app/layouts/default.vue`, right after the line `const { user, isAdmin, logout } = useAuth();`, add:

```typescript
const displayPrefs = useDisplayPrefs();
useHead({ htmlAttrs: { 'data-density': computed(() => displayPrefs.effective.value.density) } });
```

(`useHead`, `computed` and `useDisplayPrefs` are auto-imported in this file; `computed` is already used in it. Do not add imports.)

In `app/middleware/auth.global.ts`, add as the LAST statement of the middleware function (after the module redirect block, at the same indentation as the other top-level statements inside the function):

```typescript

  // Load the display preferences for the current user (also on the server, so
  // the density attribute is part of the first HTML response).
  await useDisplayPrefs().ensureLoaded();
```

Note for the implementer: the module-redirect block ends with `if (owner && !auth.isAdmin.value && !isEnabled(owner)) { return navigateTo(...); }` — the new statement goes after that `if`, so a redirected navigation skips it, which is fine.

- [ ] **Step 3: Home page — rows and search-results grid (`app/pages/index.vue`)**

In the `<style scoped>` block:

1. `.scroll-card` (currently `flex: 0 0 260px;`, around line 526): change to `flex: 0 0 calc(260px * var(--grid-min-scale, 1));`. In the `@media (max-width: 900px)` block that sets it to `220px` (around line 532) change to `flex: 0 0 calc(220px * var(--grid-min-scale, 1));`. Re-read that region first and keep every other declaration.
2. The search-results `.video-grid` (lines ~542-560): replace the four rules with:

```css
.video-grid {
  display: grid;
  grid-template-columns: repeat(max(1, calc(4 + var(--grid-offset, 0))), 1fr);
  gap: 20px;
  margin-bottom: 32px;
}

@media (max-width: 1400px) {
  .video-grid { grid-template-columns: repeat(max(1, calc(3 + var(--grid-offset, 0))), 1fr); }
}

@media (max-width: 1000px) {
  .video-grid { grid-template-columns: repeat(max(1, calc(2 + var(--grid-offset, 0))), 1fr); }
}

@media (max-width: 640px) {
  .video-grid { grid-template-columns: 1fr; }
}
```

- [ ] **Step 4: Subscriptions (`app/pages/subscriptions.vue`)**

In `.video-grid` (around line 296) change only the `grid-template-columns` line to:
`grid-template-columns: repeat(auto-fill, minmax(min(calc(280px * var(--grid-min-scale, 1)), 100%), 1fr));` (keep the explanatory comment above it).

- [ ] **Step 5: Channels (`app/pages/channels.vue`, the unscoped `<style>` block)**

1. `.channels-page .video-grid` (around line 432): `grid-template-columns: repeat(3, 1fr);` → `repeat(max(1, calc(3 + var(--grid-offset, 0))), 1fr);`
2. Inside `@media (max-width: 1024px)`: `repeat(2, 1fr)` → `repeat(max(1, calc(2 + var(--grid-offset, 0))), 1fr)`. Leave the `@media (max-width: 640px)` `1fr` rule unchanged.
3. `.channels-page .video-grid.playlists-video-grid` (around line 462): `repeat(auto-fill, minmax(min(260px, 100%), 1fr))` → `repeat(auto-fill, minmax(min(calc(260px * var(--grid-min-scale, 1)), 100%), 1fr))`.

(`ChannelVideoGrid.vue` and `ChannelPlaylistsTab.vue` define no grid CSS of their own — they are styled by this unscoped block — so they need no edit. `/search` defines no grid rules and is intentionally not touched.)

- [ ] **Step 6: Verify**

Run: `npx vitest run` — all PASS.
Run: `npx nuxt build 2>&1 | grep -E "Build complete|ERROR|error TS"` — `Build complete!`.
Run: `grep -rn "repeat(3, 1fr)\|repeat(4, 1fr)\|minmax(min(280px\|minmax(min(260px\|flex: 0 0 260px" app/pages/index.vue app/pages/subscriptions.vue app/pages/channels.vue` — Expected: no output (every targeted rule now folds in the variables).

- [ ] **Step 7: Commit**

```bash
git add app/assets/css/main.css app/layouts/default.vue app/middleware/auth.global.ts app/pages/index.vue app/pages/subscriptions.vue app/pages/channels.vue
git commit -m "feat: grid density preference (data-density, CSS variables)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 5: Navigation filtering and landing redirect

**Files:**
- Modify: `app/layouts/default.vue`, `app/middleware/auth.global.ts`

**Interfaces:**
- Consumes: `filterNavLinks` (`~/utils/displayPrefs`), `useDisplayPrefs().effective`, `useLanding().consumeLandingTarget()` (Task 3).
- Produces: a sidebar that hides the user's hidden links, and a once-per-tab-session landing redirect applied both on client navigations (middleware) and on the first page load (layout `onMounted`).

No new automated test (interactive wiring; the pure logic is already unit-tested in Task 3, the flows are verified in Task 7). Gate: full suite + clean build.

- [ ] **Step 1: Filter the sidebar links**

In `app/layouts/default.vue`:

1. Add this import next to the other `~/` imports in the `<script setup>` (re-read the file to match the local import style):

```typescript
import { filterNavLinks } from '~/utils/displayPrefs';
```

2. After the `activeSpace` computed, add:

```typescript
// Navigation links the current user chose to show (Home and the library links are never hideable).
const visibleNavLinks = computed(() =>
  filterNavLinks(activeSpace.value.navLinks, displayPrefs.effective.value.hiddenNavLinks)
);
```

3. In the template, in the sidebar `<NuxtLink v-for="link in activeSpace.navLinks" ...>` change the iterated expression to `visibleNavLinks`. Change nothing else on that element (keep `v-show`, `:key`, `:to`, `class`, `active-class`).

- [ ] **Step 2: Landing redirect on client navigations**

In `app/middleware/auth.global.ts`, replace the final block added in Task 4:

```typescript

  // Load the display preferences for the current user (also on the server, so
  // the density attribute is part of the first HTML response).
  await useDisplayPrefs().ensureLoaded();
```

with:

```typescript

  // Load the display preferences for the current user (also on the server, so
  // the density attribute is part of the first HTML response).
  await useDisplayPrefs().ensureLoaded();

  // Landing space: when entering the app at '/', start on the user's chosen
  // space, once per browser tab session. Client only (sessionStorage); it runs
  // after every redirect above, so those still win.
  if (import.meta.client && to.path === '/') {
    const target = await useLanding().consumeLandingTarget();
    if (target) return navigateTo(target);
  }
```

- [ ] **Step 3: Landing redirect on the first page load**

A server-rendered first load does not necessarily re-run the client middleware, so the layout covers it too. In `app/layouts/default.vue`, inside the existing `onMounted(() => { ... })` block that already calls `refreshModules();`, add at its end:

```typescript
  if (route.path === '/') {
    useLanding().consumeLandingTarget().then((target) => {
      if (target) router.replace(target);
    });
  }
```

(`route` and `router` are already declared in this file. The once-per-session marker makes it safe if both the middleware and this block run.)

- [ ] **Step 4: Verify**

Run: `npx vitest run` — all PASS.
Run: `npx nuxt build 2>&1 | grep -E "Build complete|ERROR|error TS"` — `Build complete!`.

- [ ] **Step 5: Commit**

```bash
git add app/layouts/default.vue app/middleware/auth.global.ts
git commit -m "feat: hide navigation links and apply the landing space per preferences

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 6: Preferences form, Account section, admin defaults panel

**Files:**
- Create: `app/components/DisplayPrefsForm.vue`
- Modify: `app/pages/account.vue`, `app/components/settings/SettingsSystemTab.vue`

**Interfaces:**
- Consumes: `useDisplayPrefs()` (`view`, `saveOverrides`, `saveAdminDefaults`, `refresh`), `useModules()` (`enabledModules`), `useToast()` (existing), `DENSITIES`/`LANDING_SPACES`/`HIDEABLE_NAV_LINKS` from `shared/displayPrefs`.
- Produces: `<DisplayPrefsForm mode="user" />` and `<DisplayPrefsForm mode="admin" />`.

No new automated test (interactive component; verified for real in Task 7). Gate: full suite + clean build.

**Behavioural requirements (from a real bug found in the previous sub-project — do not skip):** every control is bound one-way (`:value` / `:checked`) and saves on change. The browser changes a control natively before the server answers, and Vue does not rewrite the DOM when the bound value did not change (e.g. a refused or failed save). So after EVERY save attempt — success or failure — the handler must force the DOM element back to the reactive state in a `finally` (`el.value = ...` / `el.checked = ...`), and re-sync from the server on failure (`refresh()`).

- [ ] **Step 1: Create the shared form component**

Create `app/components/DisplayPrefsForm.vue`:

```vue
<template>
  <div class="display-prefs-form">
    <!-- Density -->
    <div class="pref-block">
      <div class="pref-head">
        <label class="form-label" :for="`${uid}-density`">Densité des grilles</label>
        <a v-if="isOverridden('density')" href="#" class="reset-link" @click.prevent="resetKey('density')">Rétablir le défaut{{ mode === 'user' ? " de l'instance" : '' }}</a>
      </div>
      <select :id="`${uid}-density`" class="form-input" :value="shown.density" :disabled="saving" @change="onDensityChange">
        <option value="compact">Compacte (plus de colonnes)</option>
        <option value="comfortable">Normale</option>
        <option value="spacious">Large (moins de colonnes)</option>
      </select>
    </div>

    <!-- Navigation -->
    <div class="pref-block">
      <div class="pref-head">
        <span class="form-label">Liens de navigation à masquer</span>
        <a v-if="isOverridden('hiddenNavLinks')" href="#" class="reset-link" @click.prevent="resetKey('hiddenNavLinks')">Rétablir le défaut{{ mode === 'user' ? " de l'instance" : '' }}</a>
      </div>
      <label v-for="link in navOptions" :key="link.to" class="check-row">
        <input
          type="checkbox"
          :checked="shown.hiddenNavLinks.includes(link.to)"
          :disabled="saving"
          @change="onNavChange(link.to, $event)"
        />
        <span>{{ link.label }}</span>
      </label>
      <p class="pref-hint">L'accueil et les bibliothèques ne peuvent pas être masqués. Une page masquée reste accessible par son adresse.</p>
    </div>

    <!-- Landing space -->
    <div class="pref-block">
      <div class="pref-head">
        <label class="form-label" :for="`${uid}-landing`">Espace affiché au démarrage</label>
        <a v-if="isOverridden('landingSpace')" href="#" class="reset-link" @click.prevent="resetKey('landingSpace')">Rétablir le défaut{{ mode === 'user' ? " de l'instance" : '' }}</a>
      </div>
      <select :id="`${uid}-landing`" class="form-input" :value="shown.landingSpace" :disabled="saving" @change="onLandingChange">
        <option value="auto">Automatique (premier espace actif)</option>
        <option v-for="space in landingOptions" :key="space.id" :value="space.id">{{ space.label }}</option>
      </select>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useToast } from '~/composables/useToast';
import type { DisplayPrefs, PrefKey } from '../../shared/displayPrefs';

const props = defineProps<{ mode: 'user' | 'admin' }>();

const toast = useToast();
const { view, saveOverrides, saveAdminDefaults, refresh } = useDisplayPrefs();
const { enabledModules } = useModules();

const uid = `dpf-${props.mode}`;
const saving = ref(false);

// What the form shows: in user mode the effective values (personal choice or
// inherited default); in admin mode the instance defaults (app defaults + admin).
const shown = computed<DisplayPrefs>(() => (props.mode === 'user' ? view.value.effective : view.value.defaults));

// Whether this key is set at the level the form edits (so a "reset" makes sense).
const isOverridden = (key: PrefKey): boolean => {
  const level = props.mode === 'user' ? view.value.overrides : view.value.adminDefaults;
  return !!level && key in level;
};

const navOptions = [
  { to: '/shorts', label: 'Shorts' },
  { to: '/channels', label: 'Chaînes' },
  { to: '/subscriptions', label: 'Abonnements' },
  { to: '/playlists', label: 'Playlists' },
];

const SPACE_LABELS: Record<string, string> = { video: 'Vidéo', music: 'Musique', podcasts: 'Podcasts' };
const landingOptions = computed(() =>
  enabledModules.value.map((id) => ({ id, label: SPACE_LABELS[id] ?? id }))
);

const save = (partial: Record<string, unknown>) =>
  props.mode === 'user' ? saveOverrides(partial) : saveAdminDefaults(partial);

// Save, then ALWAYS force the DOM back to the reactive state (see the
// behavioural requirements): a refused or failed save leaves the control the
// browser already flipped out of sync with what the server holds.
async function commit(partial: Record<string, unknown>, resync: () => void) {
  saving.value = true;
  try {
    await save(partial);
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || "Échec de l'enregistrement de l'affichage.");
    await refresh();
  } finally {
    saving.value = false;
    resync();
  }
}

function onDensityChange(event: Event) {
  const el = event.target as HTMLSelectElement;
  commit({ density: el.value }, () => { el.value = shown.value.density; });
}

function onLandingChange(event: Event) {
  const el = event.target as HTMLSelectElement;
  commit({ landingSpace: el.value }, () => { el.value = shown.value.landingSpace; });
}

function onNavChange(to: string, event: Event) {
  const el = event.target as HTMLInputElement;
  const current = new Set(shown.value.hiddenNavLinks);
  if (el.checked) current.add(to);
  else current.delete(to);
  // Keep the canonical order of the options so the stored array is stable.
  const next = navOptions.map((o) => o.to).filter((t) => current.has(t));
  commit({ hiddenNavLinks: next }, () => { el.checked = shown.value.hiddenNavLinks.includes(to); });
}

async function resetKey(key: PrefKey) {
  await commit({ [key]: null }, () => {});
}

</script>

<style scoped>
.display-prefs-form {
  display: flex;
  flex-direction: column;
  gap: 22px;
}

.pref-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.pref-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.reset-link {
  font-size: 12.5px;
  color: var(--accent-primary);
}

.check-row {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
}

.pref-hint {
  font-size: 12.5px;
  color: var(--text-secondary);
  margin: 2px 0 0;
}
</style>
```

- [ ] **Step 2: Account page — "Affichage" section**

In `app/pages/account.vue`, in the LEFT column (`<div class="account-col">` that holds the profile box), add a new box right after the profile box's closing `</div>` and before the column's closing `</div>` (the left column has only the profile box, while the right column already holds Security and API tokens — this balances the two):

```html
        <div class="profile-box glass-panel">
          <div class="security-header">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="security-icon"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
            <div>
              <h4>Affichage</h4>
              <p class="section-desc mb-0">Adaptez la densité des grilles, la navigation et l'espace affiché au démarrage. Les valeurs non modifiées suivent les défauts de l'instance.</p>
            </div>
          </div>

          <hr class="separator" />

          <DisplayPrefsForm mode="user" />
        </div>
```

(Re-read the left column in the file to find the right place; `DisplayPrefsForm` is auto-imported from `app/components`.) In the `<script setup>` add inside the existing `onMounted` that calls `fetchProfile()`... no — do not touch `onMounted`; the preferences are already loaded by the global middleware. Add nothing to the script.

- [ ] **Step 3: Admin panel — "Affichage par défaut"**

In `app/components/settings/SettingsSystemTab.vue`, insert a new panel immediately AFTER the "Modules" panel (the first `config-section glass-panel` in `.system-diagnostic-col`) and BEFORE the "Engine Binaries" panel (`<h3>Engine Binaries</h3>`):

```html
        <div class="config-section glass-panel">
          <div class="section-title-row">
            <div class="icon-orb bg-pink">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="9" y1="21" x2="9" y2="9"></line></svg>
            </div>
            <div>
              <h3>Affichage par défaut</h3>
              <p class="section-desc">Valeurs de départ de l'affichage pour toute l'instance (invités et utilisateurs). Chaque utilisateur peut ensuite les personnaliser depuis son compte.</p>
            </div>
          </div>

          <div class="mt-3">
            <DisplayPrefsForm mode="admin" />
          </div>
        </div>

```

No script change is needed in this file.

- [ ] **Step 4: Verify**

Run: `npx vitest run` — all PASS.
Run: `npx nuxt build 2>&1 | grep -E "Build complete|ERROR|error TS"` — `Build complete!`.

- [ ] **Step 5: Commit**

```bash
git add app/components/DisplayPrefsForm.vue app/pages/account.vue app/components/settings/SettingsSystemTab.vue
git commit -m "feat: display preferences form on the Account page and admin defaults panel

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 7: Manual end-to-end verification (real Docker + Browser pane)

**Files:** none (verification only — no code changes expected).

Do NOT rely on `curl` alone for anything interactive. Use the Browser pane on the Mac's LAN IP with REAL form logins and REAL clicks. In zsh an unquoted variable is not word-split, so never build curl option strings in variables (this once made an admin request go out without its cookie).

- [ ] **Step 1: Build, start, create an admin and a normal user**

```bash
LAN=$(ipconfig getifaddr en0); echo "LAN IP: $LAN"
docker build -t youkeep-test .
docker rm -f ykt >/dev/null 2>&1; docker volume rm ykd7 >/dev/null 2>&1; docker volume create ykd7 >/dev/null
docker run -d --name ykt -p 3999:3000 -e PUID=99 -e PGID=100 -v ykd7:/app/data youkeep-test
sleep 20
curl -s -X POST http://localhost:3999/api/auth/setup -H 'Content-Type: application/json' -d '{"username":"admin","password":"testtest123"}' >/dev/null
curl -s -c /tmp/a.txt -X POST http://localhost:3999/api/auth/login -H 'Content-Type: application/json' -d '{"username":"admin","password":"testtest123"}' >/dev/null
A=$(grep csrf_token /tmp/a.txt | awk '{print $NF}')
curl -s -b /tmp/a.txt -H "x-csrf-token: $A" -X POST http://localhost:3999/api/admin/users -H 'Content-Type: application/json' -d '{"username":"bob","password":"temp12345","role":"user"}' >/dev/null
curl -s -c /tmp/b.txt -X POST http://localhost:3999/api/auth/login -H 'Content-Type: application/json' -d '{"username":"bob","password":"temp12345"}' >/dev/null
B=$(grep csrf_token /tmp/b.txt | awk '{print $NF}')
curl -s -b /tmp/b.txt -H "x-csrf-token: $B" -X PUT http://localhost:3999/api/account/password -H 'Content-Type: application/json' -d '{"password":"newpass12345"}'; echo
curl -s http://localhost:3999/api/settings/display; echo
```
Expected: the last call prints a view with `overrides: null`, `effective` = `{"density":"comfortable","hiddenNavLinks":[],"landingSpace":"auto"}`. Seed a few real videos so grids have content: queue `https://www.youtube.com/watch?v=jNQXAC9IVRw` as admin (`POST /api/admin/downloader/ingest` with `{"url":...,"start_sync":true}`) and wait for the mp4 to appear in `docker exec ykt sh -c 'find /downloads -name "*.mp4" | wc -l'`.

- [ ] **Step 2: API and token behaviour (curl)**

```bash
A=$(grep csrf_token /tmp/a.txt | awk '{print $NF}'); B=$(grep csrf_token /tmp/b.txt | awk '{print $NF}')
# invalid value is refused and nothing is written
curl -s -o /dev/null -w "invalid density: %{http_code}\n" -b /tmp/b.txt -H "x-csrf-token: $B" -X PUT http://localhost:3999/api/account/preferences -H 'Content-Type: application/json' -d '{"density":"huge"}'
curl -s -o /dev/null -w "guest PUT: %{http_code}\n" -X PUT http://localhost:3999/api/account/preferences -H 'Content-Type: application/json' -d '{"density":"compact"}'
# a Bearer token can read and write preferences
TOKEN=$(curl -s -b /tmp/b.txt -H "x-csrf-token: $B" -X POST http://localhost:3999/api/account/tokens -H 'Content-Type: application/json' -d '{"label":"verif"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")
curl -s -X PUT http://localhost:3999/api/account/preferences -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"density":"compact"}' | python3 -c "import sys,json; d=json.load(sys.stdin); print('token write ->', d['overrides'])"
curl -s http://localhost:3999/api/settings/display -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json; d=json.load(sys.stdin); print('token read ->', d['effective']['density'])"
# back to default for the browser tests
curl -s -b /tmp/b.txt -H "x-csrf-token: $B" -X PUT http://localhost:3999/api/account/preferences -H 'Content-Type: application/json' -d '{"density":null}' | python3 -c "import sys,json; print('reset ->', json.load(sys.stdin)['overrides'])"
```
Expected: `invalid density: 400`, `guest PUT: 401`, token write shows `{'density': 'compact'}`, token read `compact`, reset shows `{}`.

- [ ] **Step 3: Admin defaults and the Account section in the browser (as bob)**

In the Browser pane on `http://<LAN IP>:3999/login`: log in as `bob` / `newpass12345` with the real form. Open `/account`: confirm an "Affichage" box in the left column below the profile, with the density select on "Normale", four unchecked link boxes and the landing select on "Automatique". Then:

1. Select **Compacte** with a real click. Confirm the toast/no error, then reload the page and confirm the select still reads Compacte and a "Rétablir le défaut de l'instance" link appears next to it. Confirm `document.documentElement.dataset.density === 'compact'` after the reload (this proves the attribute is server-rendered, i.e. present before hydration: check it in the very first HTML with `curl -s -b /tmp/b.txt http://localhost:3999/ | grep -o 'data-density="[a-z]*"'` after the preference is saved — expect `compact`).
2. Click "Rétablir le défaut de l'instance": the link disappears and the select reads Normale.
3. Tick **Shorts** and **Playlists**: the sidebar (on `/`) must no longer list them; Home, Channels and Subscriptions remain. Untick them and confirm they come back. Confirm no way exists to hide Home.
4. Failed-save re-sync (the lesson from the Modules switches): provoke a real failure by pausing the container. Run `docker pause ykt`, then change the density select with a real click and wait about 3 seconds (the request cannot complete), then `docker unpause ykt`. Confirm an error toast appears and the select snaps back to its previous value. Repeat with a link checkbox: after the failed save it must be back in its previous checked/unchecked state, not left flipped.

- [ ] **Step 4: Density measured in the browser (as bob)**

Use a fixed desktop viewport (resize_window to 1440x900 if the pane allows; otherwise note the width). For each density in turn (set it through the Account select with a real click), measure with `javascript_tool` on each page:

- `/subscriptions`: `getComputedStyle(document.querySelector('.video-grid')).gridTemplateColumns.split(' ').length` — compact must have MORE tracks than comfortable, spacious FEWER (auto-fill: needs at least a couple of videos subscribed; subscribe bob to the seeded channel via `POST /api/channels/<id>/subscribe` or the UI, and check the route name in `server/api/channels`).
- `/` with a search (`/?q=zoo`): the search-results `.video-grid` tracks: at 1440px comfortable = 3 (the ≤1400 rule applies below 1400; at 1440 expect 4), compact = comfortable + 1, spacious = comfortable − 1.
- `/` home rows: `getComputedStyle(document.querySelector('.scroll-card')).flexBasis` — comfortable `260px`, compact `208px`, spacious `325px`.
- `/channels?id=<seeded channel id>`: `.channels-page .video-grid` tracks 3 / 4 / 2 for comfortable / compact / spacious at a wide viewport.
Record the measured numbers in the report. Anything that does not move with the density, or moves the wrong way, is a bug.

- [ ] **Step 5: Landing space once per tab (as bob)**

1. As bob, choose **Musique** in "Espace affiché au démarrage" (real click).
2. Open a NEW tab (`tabs_create`) and navigate to `http://<LAN IP>:3999/` — it must end on `/music`. Click the logo / Home link back to `/`: it must STAY on `/` (the redirect happens once per tab session). Reload `/`: still `/` (marker survives a reload within the tab session).
3. Open yet another new tab to `/`: redirected to `/music` again (new tab session).
4. Disable Music through the admin API (`POST /api/admin/settings/modules` `{"music":false}` with the admin cookie), open a new tab on `/`: bob must stay on `/` (explicit choice disabled → treated as automatic). Re-enable Music afterwards.
5. Set the landing back to "Automatique" for bob and confirm a new tab stays on `/`.

- [ ] **Step 6: Admin defaults, a new user and a guest**

1. Log out bob; log in as `admin` with the real form. Open Settings → System: the "Affichage par défaut" panel is second (after "Modules"). Set density **Large** and landing **Podcasts** with real clicks; confirm the "Rétablir le défaut" links appear (admin mode wording has no "de l'instance").
2. Create a brand-new user `carol` (`POST /api/admin/users`, then clear her temporary password with `PUT /api/account/password` using her own session) and log her in through the real form in a new tab session: her Account → Affichage shows "Large" and "Podcasts" (inherited), with NO reset links; her `/` lands on `/podcasts` and the grids are spacious.
3. A guest (`curl -s http://localhost:3999/api/settings/display`) sees `effective.density` = `spacious`, `overrides` = `null`.
4. Carol sets density to Compacte: only she changes; reload as bob (default) and as a guest to confirm they still see the admin default. Carol's "Rétablir le défaut de l'instance" goes back to Large.
5. In Settings, click "Rétablir le défaut" on both admin defaults: carol/guest return to app defaults.

- [ ] **Step 7: Interactions and clean-up checks**

1. Temporary-password user: create `dave` and do NOT clear his temporary password; `curl -s -b <dave cookie> http://localhost:3999/api/settings/display` returns 200, while `PUT /api/account/preferences` with his cookie returns 403.
2. Module interplay: with Video disabled and Music enabled, bob (landing "auto") opening `/` ends on `/music` (module redirect), and his sidebar/space switcher show only Music.
3. Check `docker logs ykt` for stack traces or errors during all of the above; report any.

- [ ] **Step 8: Clean up and run the full suite**

```bash
docker rm -f ykt >/dev/null 2>&1; docker rmi youkeep-test >/dev/null 2>&1; docker volume rm ykd7 >/dev/null 2>&1; rm -f /tmp/a.txt /tmp/b.txt
npx vitest run
```
Expected: all tests PASS.

No commit for this task. If any step reveals a real bug, stop, describe it precisely (expected vs actual, commands, output) and report BLOCKED so the controller can decide on the fix.
