# Vue Component Test Infrastructure — Design

## Context

Fourteenth sub-project of the ongoing "bug fixes" initiative — the fifth and final item reopened after the user explicitly asked to reconsider previously-declined audit findings ("corrige tout"). Unlike the other four reopened items, this was never a declined *finding* — it's an accepted, repeatedly-referenced gap that every single Vue/UI sub-project across this entire session's history has cited in its own verification section ("zero Vue component test infrastructure, project-wide accepted gap, manual verification only via the dev-login fixture"). The user now wants it built for real.

Explored the current state:

- `vitest.config.ts` is a single flat config: `{ test: { environment: 'node', include: ['tests/**/*.test.ts'] } }`. Vitest `^4.1.10` is already installed (`package.json`), which supports the `projects` config field (the current mechanism for splitting multiple test environments in one Vitest run, superseding the older separate-workspace-file approach from Vitest 1-2).
- No `@vue/test-utils`, `@nuxt/test-utils`, `jsdom`, or `happy-dom` in `package.json`'s `devDependencies` (currently just `@types/bcryptjs`, `@types/better-sqlite3`, `vitest`).
- `tests/` currently holds only `tests/unit/*.test.ts` and `tests/integration/*.test.ts` — all server-side (`server/utils/*`, `server/api/*`), all running in the Node environment, all using the established `tests/helpers/testDb.ts` (`createTestDb`, `mockEvent`, etc.) convention. No component test files exist anywhere.
- 35 `.vue` files total across `app/components/` and `app/pages/`.

## Scope

- Set up Vitest's multi-project config to run the existing server-side Node-environment tests and new DOM-environment component tests in one `npm run test` invocation, using `@nuxt/test-utils` (not bare `@vue/test-utils`) so Nuxt's auto-imports (`useFetch`, `useState`, `useCookie`, `useToast`, `navigateTo`, etc. — used pervasively throughout this codebase's Vue files) resolve correctly in tests without hand-written mocks for each one.
- Write 3 proof-of-setup test files covering the 3 representative shapes this codebase's Vue code takes: a simple presentational component (`EmptyState.vue`), a composable with real behavioral logic (`useMusicPlayer.ts`), and a component with user interaction/emits/lifecycle concerns (`BaseModal.vue`).

## Non-Goals

- No retroactive test coverage for the other 32+ Vue files in the codebase — this sub-project establishes the tooling, convention, and 3 worked examples; extending coverage to the rest of the codebase is future, ongoing work for later sub-projects to pick up as they touch each area, not bundled in here.
- No end-to-end/browser-automation testing (Playwright, Cypress, etc.) — this is unit/component-level testing only, using Vitest + happy-dom, consistent with the existing server-side testing approach's grain (isolated units, not full-stack flows).
- No mandated code-coverage threshold or CI coverage gate — establishing the capability is the goal, not enforcing a coverage percentage.
- No change to the existing server-side tests' behavior, location, or conventions — they keep running exactly as they do today, just as one named project instead of the implicit default.

## Design

### 1. Dependencies

Add to `devDependencies`: `@nuxt/test-utils`, `@vue/test-utils` (direct dependency for `mount()`/`shallowMount()` even though `@nuxt/test-utils` pulls it in transitively — explicit since test files import from it directly), `happy-dom`.

### 2. `vitest.config.ts` — split into two projects

```ts
import { defineConfig } from 'vitest/config';
import { defineVitestProject } from '@nuxt/test-utils/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'server',
          environment: 'node',
          include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts']
        }
      },
      await defineVitestProject({
        test: {
          name: 'component',
          environment: 'happy-dom',
          include: ['tests/component/**/*.test.ts']
        }
      })
    ]
  }
});
```

`defineVitestProject` (from `@nuxt/test-utils/config`) is the officially documented helper for wiring a Nuxt app's auto-imports, plugins, and runtime config into a Vitest project — it handles resolving `#imports`/auto-imported composables so component test files can call `useState`, `useToast`, etc. without manual mocking, the same way the app itself does. The `server` project's `include` glob is narrowed from the current bare `tests/**/*.test.ts` to explicitly `tests/unit/**` + `tests/integration/**` so it doesn't also try to pick up the new `tests/component/**` files (which need the `component` project's `happy-dom` environment, not `node`).

`npm run test` (already `vitest run`) and `npm run test:watch` (already `vitest`) need no changes — Vitest runs all configured projects under one invocation of either command.

### 3. `tests/component/EmptyState.test.ts`

Tests `app/components/EmptyState.vue` (props: `title`, `description`, `icon?`, `actionText?`, `actionRoute?`; emits: `action`). Covers:
- Renders `title`/`description` text content.
- Renders a `<NuxtLink>` (not a `<button>`) when both `actionRoute` and `actionText` are set, pointing at `actionRoute`.
- Renders a `<button>` (not a link) when only `actionText` is set (no `actionRoute`).
- Renders neither action element when `actionText` is unset.
- Clicking the action `<button>` emits `action` with no payload.
- Renders the correct `<svg>` variant per `icon` value (spot-check 2-3 of the 6 icon branches, not all 6 — proving the conditional rendering works, not enumerating every icon).

### 4. `tests/component/useMusicPlayer.test.ts`

Tests `app/composables/useMusicPlayer.ts`'s pure logic (not `saveToLocalStorage`/`restoreFromLocalStorage`, which need `window.localStorage` + a real `$fetch` — out of scope for this proof, a future coverage pass can add them). Covers:
- `play()` on a track already in the current queue sets `currentTrack`/`currentIndex` without replacing the queue array.
- `play()` on a track NOT in the current queue prepends it and sets `currentIndex` to 0.
- `next()`/`prev()` respect `repeatMode` (`'off'` stops at the queue's end; `'all'` wraps around; `'one'` replays the same index).
- `toggleShuffle()` generates a `shuffledOrder` that includes every queue index exactly once.
- `replaceQueueKeepingCurrent()` updates `queue`/`currentIndex`/`currentTrack` WITHOUT touching `audioEl`/`hasCountedThisPlay` (regression coverage for the real bug fixed earlier this session, where the radio/artist-mix "replace queue" action was incorrectly restarting the currently-playing track).

Since `useMusicPlayer()` uses `useState` (a Nuxt auto-import backed by a singleton-per-key pattern), tests need the `component` project's Nuxt-aware environment even though there's no `.vue` template involved — confirmed as the correct project to place this file in, not a reason to invent a third project.

### 5. `tests/component/BaseModal.test.ts`

Tests `app/components/BaseModal.vue` (props: `show`, `title`; emits: `close`; slots: default, `footer`). Covers:
- Clicking the `.modal-overlay` backdrop emits `close`.
- Clicking `.modal-card` itself (inside the backdrop) does NOT emit `close` (the `@click.stop` guard).
- Clicking the `.close-modal-btn` emits `close`.
- Pressing Escape while `show` is `true` emits `close`.
- Pressing Escape while `show` is `false` does NOT emit `close` (the keydown listener is only attached while shown).
- On mount with `show: true`, the modal card receives focus (via `nextTick`).
- On transitioning `show` from `true` to `false`, focus returns to whichever element had it before the modal opened, guarded by `document.contains()` (matching the component's own guard against restoring focus to a since-removed element).

## Error Handling

Not applicable — this sub-project adds test infrastructure and test files, not application error-handling code.

## Verification

This sub-project verifies itself: `npm run test` running both the `server` and `component` projects together, with the 3 new component test files passing, IS the verification. No manual/live verification needed for the tests themselves. As a sanity check that the split didn't regress the existing server-side suite, the full existing test count (291 as of the prior sub-project) should still pass unchanged under the `server` project, with the new component tests passing additionally under the `component` project.
