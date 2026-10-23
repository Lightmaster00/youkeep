# i18n Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sub-project 1 of `docs/superpowers/specs/2026-10-24-languages-design.md`: the app can switch its UI language (en, fr for now) per user, with header, sidebar, login and account migrated.

**Architecture:** `@nuxtjs/i18n` with `strategy: 'no_prefix'`, lazy-loaded JSON catalogues. The user's choice is stored in `users.ui_language`, returned by `/api/auth/me` as `uiLanguage`, and applied by a client plugin after login/fetch; guests get a cookie plus browser-language detection. Language list and normalisation live in `shared/languages.ts`, used by server and client.

**Tech Stack:** Nuxt 4.6, `@nuxtjs/i18n` ^10, better-sqlite3, Vitest (projects `server` / `component`).

## Global Constraints

- Languages: en, fr, es, de, pt, it, zh, ja, ru are the *supported codes* (`shared/languages.ts`), but only `en` and `fr` catalogues ship in this plan; the others are added in sub-project 3 and must fall back to `en`.
- "Missing key in a language falls back to English; never show a raw key."
- "Dates and numbers formatted with `Intl` using the UI language."
- "Language preference changes apply immediately without reload."
- Admin (settings and admin routes) stays English: do NOT migrate `settings.vue`, `components/settings/*`, `pages/admin/*`.
- No change to existing route contracts except the additive `uiLanguage` field on `/api/auth/me`'s `user`.
- App code imports shared code via `#shared/…`, server code relative; `getDb`/`requireAdmin` are ambient Nitro auto-imports in server code; tests: `createTestDb`/`mockEvent` (`tests/helpers/testDb.ts`), component tests via `mountSuspended` with `vi.stubGlobal('$fetch', …)`.
- Never work on main; never push. Commit trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

---

### Task 1: Shared language helpers + server storage

**Files:**
- Create: `shared/languages.ts`, `server/api/account/language.get.ts`, `server/api/account/language.put.ts`
- Modify: `server/utils/db.ts` (after line 408, the `users.dob` ALTER), `server/api/auth/me.get.ts`, `tests/helpers/testDb.ts` (users table), `tests/integration/schema-parity.test.ts:36` (add `'users.ui_language'`)
- Test: `tests/unit/languages.test.ts`, `tests/integration/account-language.test.ts`

**Interfaces:**
- Produces: `SUPPORTED_LANGUAGES` (readonly tuple of the 9 codes), `type LanguageCode`, `LANGUAGE_NAMES: Record<LanguageCode,string>` (native names), `isLanguageCode(v: unknown): v is LanguageCode`, `pickLanguage(acceptLanguage: string | undefined | null): LanguageCode` (first supported primary subtag by q-order, else `'en'`). Routes: `GET /api/account/language` → `{ uiLanguage: LanguageCode | null }`; `PUT /api/account/language` body `{ uiLanguage: LanguageCode | null }` → same shape; invalid → 400. `/api/auth/me` → `user.uiLanguage: LanguageCode | null` (null user stays null).

- [ ] **Step 1: Write failing unit test** `tests/unit/languages.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { SUPPORTED_LANGUAGES, isLanguageCode, pickLanguage, LANGUAGE_NAMES } from '../../shared/languages';

describe('languages', () => {
  it('lists the nine languages, each with a native name', () => {
    expect([...SUPPORTED_LANGUAGES]).toEqual(['en', 'fr', 'es', 'de', 'pt', 'it', 'zh', 'ja', 'ru']);
    for (const c of SUPPORTED_LANGUAGES) expect(LANGUAGE_NAMES[c]).toBeTruthy();
  });
  it('validates codes', () => {
    expect(isLanguageCode('fr')).toBe(true);
    expect(isLanguageCode('xx')).toBe(false);
    expect(isLanguageCode(null)).toBe(false);
  });
  it('picks from Accept-Language by quality, on the primary subtag', () => {
    expect(pickLanguage('fr-CA,fr;q=0.9,en;q=0.8')).toBe('fr');
    expect(pickLanguage('xx;q=1, de;q=0.5')).toBe('de');
    expect(pickLanguage('zh-Hans-CN')).toBe('zh');
    expect(pickLanguage('')).toBe('en');
    expect(pickLanguage(undefined)).toBe('en');
    expect(pickLanguage('xx, yy')).toBe('en');
  });
});
```

- [ ] **Step 2:** `npx vitest run --project server tests/unit/languages.test.ts` → FAIL (module not found).

- [ ] **Step 3: Create `shared/languages.ts`**

```ts
export const SUPPORTED_LANGUAGES = ['en', 'fr', 'es', 'de', 'pt', 'it', 'zh', 'ja', 'ru'] as const;
export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number];

/** Each language written in itself, for the selector. */
export const LANGUAGE_NAMES: Record<LanguageCode, string> = {
  en: 'English', fr: 'Français', es: 'Español', de: 'Deutsch', pt: 'Português',
  it: 'Italiano', zh: '中文', ja: '日本語', ru: 'Русский'
};

export function isLanguageCode(v: unknown): v is LanguageCode {
  return typeof v === 'string' && (SUPPORTED_LANGUAGES as readonly string[]).includes(v);
}

/** The best supported language for an Accept-Language header, else 'en'. */
export function pickLanguage(acceptLanguage: string | undefined | null): LanguageCode {
  if (!acceptLanguage) return 'en';
  const ranked = acceptLanguage.split(',').map((part, index) => {
    const [tag = '', ...params] = part.trim().split(';');
    const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
    const quality = q ? Number(q.slice(2)) : 1;
    return { primary: tag.trim().toLowerCase().split('-')[0] ?? '', quality: Number.isFinite(quality) ? quality : 0, index };
  }).sort((a, b) => b.quality - a.quality || a.index - b.index);
  for (const { primary, quality } of ranked) {
    if (quality > 0 && isLanguageCode(primary)) return primary;
  }
  return 'en';
}
```

- [ ] **Step 4:** rerun → PASS.

- [ ] **Step 5: Failing integration test** `tests/integration/account-language.test.ts` (pattern of `display-preferences.test.ts`: `createTestDb`, `(globalThis as any).getDb = () => db`, `insertUser`, `insertSession`, `sessionCookie`, `mockEvent(cookie, { path, body, method })`):

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import getHandler from '../../server/api/account/language.get';
import putHandler from '../../server/api/account/language.put';
import meHandler from '../../server/api/auth/me.get';
import { createTestDb, insertUser, insertSession, mockEvent, sessionCookie } from '../helpers/testDb';

let db: Database.Database;
let cookie: string;
beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
  insertUser(db, { id: 'u1', role: 'user' });
  insertSession(db, { id: 's1', userId: 'u1' });
  cookie = sessionCookie('s1');
});
const get = (c?: string) => getHandler(mockEvent(c, { path: '/api/account/language' }));
const put = (c: string | undefined, body: any) => putHandler(mockEvent(c, { path: '/api/account/language', body, method: 'PUT' }));

describe('account language', () => {
  it('is null until chosen, then stored', async () => {
    expect(await get(cookie)).toEqual({ uiLanguage: null });
    expect(await put(cookie, { uiLanguage: 'fr' })).toEqual({ uiLanguage: 'fr' });
    expect(await get(cookie)).toEqual({ uiLanguage: 'fr' });
  });
  it('null clears the choice', async () => {
    await put(cookie, { uiLanguage: 'de' });
    expect(await put(cookie, { uiLanguage: null })).toEqual({ uiLanguage: null });
  });
  it('rejects unknown codes and anonymous callers', async () => {
    await expect(put(cookie, { uiLanguage: 'xx' })).rejects.toMatchObject({ statusCode: 400 });
    await expect(put(cookie, {})).rejects.toMatchObject({ statusCode: 400 });
    await expect(get(undefined)).rejects.toMatchObject({ statusCode: 401 });
  });
  it('is exposed on /api/auth/me', async () => {
    await put(cookie, { uiLanguage: 'ja' });
    const me: any = await meHandler(mockEvent(cookie, { path: '/api/auth/me' }));
    expect(me.user.uiLanguage).toBe('ja');
  });
});
```

- [ ] **Step 6:** run → FAIL. Then implement:
  - `db.ts` after the `users.dob` line: `try { db.exec(\`ALTER TABLE users ADD COLUMN ui_language TEXT;\`); } catch (e) {}`
  - `tests/helpers/testDb.ts` users table: add `ui_language TEXT` (nullable, no default, matching the real ALTER); add `'users.ui_language'` to the `columns.names` list in `schema-parity.test.ts:36` only if parity fails for it (the test says which side is missing; follow its message).
  - `language.get.ts`:

```ts
import { defineEventHandler } from 'h3';
import { requireUser } from '../../utils/auth';
import { getDb } from '../../utils/db';

export default defineEventHandler(async (event) => {
  const session = await requireUser(event);
  const row = getDb().prepare('SELECT ui_language FROM users WHERE id = ?').get(session.id) as { ui_language: string | null } | undefined;
  return { uiLanguage: row?.ui_language ?? null };
});
```
  - `language.put.ts`: `requireUser`, `readJsonObject` from `../../utils/validation`; accept `uiLanguage` that is `null` or `isLanguageCode` (import from `../../../shared/languages`), else `throw createError({ statusCode: 400, statusMessage: 'Unsupported language.' })`; `UPDATE users SET ui_language = ? WHERE id = ?`; return `{ uiLanguage }`. (Check `readJsonObject`'s signature in `server/utils/validation.ts` and how `preferences.put.ts` uses it; an API token is fine for this route.)
  - `me.get.ts`: after `getUserFromSession`, if `user`, read `ui_language` and return `{ user: { ...user, uiLanguage } }`.

- [ ] **Step 7:** `npx vitest run --project server tests/unit/languages.test.ts tests/integration/account-language.test.ts tests/integration/schema-parity.test.ts` → all PASS. Mutation check: change `isLanguageCode` check in the PUT to always true → the "rejects unknown codes" test must fail; revert.

- [ ] **Step 8: Commit** `feat(i18n): language list and per-user ui_language (account route, exposed on /api/auth/me)`.

---

### Task 2: Wire `@nuxtjs/i18n` and apply the user's language

**Files:**
- Modify: `package.json` (+lock), `nuxt.config.ts`, `app/composables/useAuth.ts` (`UserSession` gains `uiLanguage?: LanguageCode | null`), `tests/component/authMiddleware.test.ts` only if it breaks
- Create: `i18n/locales/en.json`, `i18n/locales/fr.json`, `app/plugins/uiLanguage.ts`, `app/utils/uiLanguage.ts`
- Test: `tests/unit/uiLanguage.test.ts` (pure helper), `tests/component/UiLanguagePlugin.test.ts`

**Interfaces:**
- Consumes: `LanguageCode`, `isLanguageCode`, `pickLanguage` (Task 1).
- Produces: `resolveUiLanguage(opts: { userLanguage?: string | null; cookie?: string | null; accept?: string | null }): LanguageCode` in `app/utils/uiLanguage.ts` (order: user's saved → cookie → Accept-Language → `'en'`); every component can call `useI18n()` → `t`, `locale`, `setLocale`.

- [ ] **Step 1:** `npm install @nuxtjs/i18n@^10` ; confirm it supports Nuxt 4.6 (`npm ls @nuxtjs/i18n nuxt`). If the install reports a peer conflict, stop and report BLOCKED with the message.

- [ ] **Step 2: Failing unit test** `tests/unit/uiLanguage.test.ts` for `resolveUiLanguage`: saved `'fr'` beats cookie `'de'`; no saved → cookie `'de'` beats accept `'es'`; invalid cookie `'xx'` ignored; nothing → `'en'`; accept `'it-IT,it;q=0.9'` → `'it'`.

- [ ] **Step 3: Implement** `app/utils/uiLanguage.ts` using `isLanguageCode`/`pickLanguage` from `#shared/languages`; test passes.

- [ ] **Step 4: Configure** `nuxt.config.ts`: add `modules: ['@nuxtjs/i18n']` and

```ts
i18n: {
  strategy: 'no_prefix',
  defaultLocale: 'en',
  locales: [
    { code: 'en', language: 'en-US', name: 'English', file: 'en.json' },
    { code: 'fr', language: 'fr-FR', name: 'Français', file: 'fr.json' }
  ],
  lazy: true,
  langDir: 'locales',
  detectBrowserLanguage: { useCookie: true, cookieKey: 'yk_ui_lang', fallbackLocale: 'en', redirectOn: 'root' },
  compilation: { strictMessage: false }
}
```
  Nuxt 4 + i18n v10 look for `i18n/locales/` under the project root; if the build says the folder is wrong, adjust `langDir`/`restructureDir` per the module docs (check with `npx nuxt build`). Missing keys must fall back to English: set `fallbackLocale: 'en'` in `i18n/i18n.config.ts` (`export default defineI18nConfig(() => ({ legacy: false, fallbackLocale: 'en', missingWarn: false, fallbackWarn: false }))`) and reference it with `vueI18n: './i18n/i18n.config.ts'`.

- [ ] **Step 5:** create `i18n/locales/en.json` and `fr.json` containing only `{ "common": { "loading": "Loading…" / "Chargement…" } }` for now (Tasks 3–4 fill them in).

- [ ] **Step 6: Failing component test** `tests/component/UiLanguagePlugin.test.ts`: with `useState('auth_user').value = { id: 'u1', username: 'a', role: 'user', uiLanguage: 'fr' }`, after calling the plugin's exported `applyUserLanguage(nuxtApp)` the `useI18n().locale.value` is `'fr'`; with `uiLanguage: null` and locale `'fr'` already set by cookie, it stays `'fr'`; with an unsupported value it stays unchanged.

- [ ] **Step 7: Implement** `app/plugins/uiLanguage.ts`: export `applyUserLanguage`; in the default plugin `watch(() => useState<UserSession|null>('auth_user').value?.uiLanguage, (code) => { if (isLanguageCode(code)) nuxtApp.$i18n.setLocale(code); }, { immediate: true })`. Runs on server too so SSR matches (the `auth.global` middleware calls `fetchUser` before render; if the plugin runs earlier than the user state is filled, the `watch` still fires when it is set).

- [ ] **Step 8:** run the new tests, then the full component project (`npx vitest run --project component`): all existing English assertions must still pass (default locale `en`). Then `npx nuxt build` succeeds.

- [ ] **Step 9: Commit** `feat(i18n): @nuxtjs/i18n with en/fr catalogues, user language applied after login`.

---

### Task 3: Language selector in Account

**Files:**
- Create: `app/components/LanguageSelect.vue`, `app/composables/useUiLanguage.ts`
- Modify: `app/pages/account.vue` (new "Language" section placed after the personal-information box; use existing `glass-panel`, `form-group`, `form-label`, `form-input` classes)
- Test: `tests/component/LanguageSelect.test.ts`

**Interfaces:**
- Consumes: `SUPPORTED_LANGUAGES`, `LANGUAGE_NAMES`, `isLanguageCode` (Task 1); `PUT /api/account/language`; `setLocale` (Task 2).
- Produces: `useUiLanguage()` → `{ current: ComputedRef<LanguageCode>, change(code: LanguageCode): Promise<boolean> }`. `change` sets the locale immediately (optimistic), updates `auth_user.uiLanguage`, PUTs; on failure restores the previous locale, shows `useToast().error(t('language.saveFailed'))`, returns false. `LanguageSelect` renders a `<select data-testid="ui-language-select">` of only the languages whose catalogue exists (`useI18n().locales` codes), bound **one-way** (`:value`) and resynced from `current` after a failure.

- [ ] **Step 1: Failing test** `LanguageSelect.test.ts` (mountSuspended, `vi.stubGlobal('$fetch', fetchMock)`): (a) options are English and Français, labelled by `LANGUAGE_NAMES`; (b) choosing `fr` calls `$fetch('/api/account/language', { method: 'PUT', body: { uiLanguage: 'fr' } })` and the locale becomes `fr`; (c) when the PUT rejects, the locale goes back to `en`, the `<select>` shows `en` again (assert `select.element.value === 'en'`), and a toast is added.

- [ ] **Step 2:** run → FAIL; implement `useUiLanguage.ts`, `LanguageSelect.vue`, and in `account.vue` add `<h4>{{ t('language.title') }}</h4>`-style section with `<LanguageSelect />` (account.vue is migrated to `t()` in Task 4; here only add the section using `t`).

- [ ] **Step 3:** add keys to `en.json`/`fr.json`: `language.title` ("Language"/"Langue"), `language.interface` ("Interface language"/"Langue de l'interface"), `language.saveFailed` ("Couldn't save your language."/"Impossible d'enregistrer votre langue.").

- [ ] **Step 4:** tests PASS. Mutation check: remove the restore-on-failure line → test (c) must fail; revert.

- [ ] **Step 5: Commit** `feat(i18n): language selector in Account`.

---

### Task 4: Migrate header, sidebar, login and account to `t()`

**Files:**
- Modify: `app/layouts/default.vue`, `app/spaces/index.ts` (+ its consumers), `app/pages/login.vue`, `app/pages/account.vue`, `app/error.vue`, `i18n/locales/en.json`, `i18n/locales/fr.json`
- Test: `tests/component/I18nSwitch.test.ts`

**Interfaces:**
- Consumes: `useI18n().t`. Key scheme: `<area>.<name>` in camelCase — `header.*` (search, clearRecent, suggestions, recentSearches, accountMenuFor, account, settings, logOut, logIn, waitingPaused), `nav.*` (video, music, podcasts, home, shorts, channels, subscriptions, playlists, library, discover, likedSongs, recent, history, subscribed), `login.*`, `account.*`, `error.*`, `common.*`.
- Produces: all user-visible strings of these files come from the catalogue; `en.json` holds the exact current English text (so existing tests keep passing) and `fr.json` the French.

- [ ] **Step 1: Failing test** `I18nSwitch.test.ts`: mount `app/layouts/default.vue` (look at how other component tests mount the layout, e.g. `grep -l "layouts/default" tests/component`) with the user's `uiLanguage` set to `fr`: the open user menu shows "Compte", "Paramètres", "Se déconnecter"; in `en` it shows "Account", "Settings", "Log out". Also a sidebar assertion: "Accueil"/"Abonnements" in fr, "Home"/"Subscriptions" in en.

- [ ] **Step 2:** run → FAIL. Migrate:
  - `app/spaces/index.ts`: replace each `label: 'X'` with `labelKey: 'nav.x'` **keeping** `label` out; update `buildSidebarGroups` / consumers (`grep -rn "\.label" app tests | grep -i "space\|group\|item"`) to translate at render time. Keep the English text available to non-Vue code only if a consumer needs it; otherwise remove.
  - `default.vue`, `login.vue`, `account.vue`, `error.vue`: replace every literal user-visible string (template text, `placeholder`, `aria-label`, `title`, toast and error messages built in script) by `t('…')`; parameterised strings use named interpolation, e.g. `t('header.accountMenuFor', { name: user.username })` with catalogue text `"Account menu for {name}"`. Do not touch `useHead({ title: 'Account' })` → use `t('account.title')`.
  - Fill `en.json` first (exact current strings), then `fr.json` (natural French, informal-neutral, consistent with the French wording already used across the app's earlier UI: "Se déconnecter", "Paramètres", "Abonnements", "Chaînes", "Playlists", "Bibliothèque", "Découvrir", "Titres likés", "Récents", "Historique", "Abonné").

- [ ] **Step 3:** `npx vitest run --project component` — every pre-existing test must pass unchanged (English default). Fix only the migration, never loosen a test.

- [ ] **Step 4:** run `npx nuxi typecheck` → exit 0.

- [ ] **Step 5: Commit** `feat(i18n): header, sidebar, login, account and error page translated (en, fr)`.

---

### Task 5: Catalogue parity + hard-coded-text guard

**Files:**
- Create: `tests/unit/i18nCatalogues.test.ts`

- [ ] **Step 1: Write the tests** (pure node, read the JSON files with `fs`):
  1. Flatten keys of every `i18n/locales/*.json`; every non-`en` catalogue must have exactly the same key set as `en` (report missing/extra keys in the failure message).
  2. Every `{name}` placeholder set in a French message equals the one in the matching English message.
  3. Guard: for the migrated files list `['app/layouts/default.vue','app/pages/login.vue','app/pages/account.vue','app/error.vue']`, strip `<script>`/`<style>`/comments/SVG blocks and assert the template contains no text node matching `/>\s*[A-Za-z][A-Za-z' ]{2,}\s*</` outside `{{ }}` and no `placeholder="…"`/`aria-label="…"`/`title="…"` attribute with a literal (non-bound) value containing letters.

- [ ] **Step 2:** run; fix any hard-coded text the guard finds. Mutation check: temporarily write `<h1>Hello</h1>` into login.vue → guard fails; revert. Delete one key from `fr.json` → parity fails; revert.

- [ ] **Step 3: Commit** `test(i18n): catalogue parity and hard-coded text guard`.

---

### Task 6: Controller-run live verification

(Run by the controller, not a subagent.)

- [ ] `npx nuxt build`; run `.output/server/index.mjs` with a temp `YOUKEEP_DATA_DIR` and `PORT`/`NITRO_PORT`; seed a user with better-sqlite3 (see the live-check method used in earlier phases); log in by form in the Browser pane (`resize_window` preset desktop).
- [ ] Verify: guest login page follows the browser language / `yk_ui_lang` cookie; after login the saved language applies on first paint (no flash of English on reload); Account → Language → Français switches header, sidebar and account page instantly without reload; a reload keeps it; logging out and in as another user (no saved language) does not inherit it; console has no hydration warnings; an unknown cookie value falls back to English.
- [ ] Full gate: `npx vitest run` (all projects), `npx nuxi typecheck`, `npx nuxt build` all green. Report any deviation.
