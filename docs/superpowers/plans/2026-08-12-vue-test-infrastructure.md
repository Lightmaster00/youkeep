# Vue Component Test Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up Vue/Nuxt component test infrastructure in this codebase for the first time, using Vitest's multi-project config to run the existing server-side Node tests and new DOM-environment component tests in one `npm run test` invocation, and prove it works with 3 real test files covering the 3 representative shapes this codebase's Vue code takes.

**Architecture:** `vitest.config.ts` splits into two named Vitest projects: `server` (unchanged Node environment, narrowed `include` glob so it only picks up the existing `tests/unit/**` and `tests/integration/**` files) and `component` (Nuxt-aware `environment: 'nuxt'`, powered by `@nuxt/test-utils`'s `defineVitestProject()` helper, covering new `tests/component/**` files). Component tests use `mountSuspended()` from `@nuxt/test-utils/runtime` (not bare `@vue/test-utils` `mount()`) so Nuxt auto-imports and globally-registered components like `<NuxtLink>` resolve correctly.

**Tech Stack:** Nuxt 4, Vue 3, Vitest 4, @nuxt/test-utils, happy-dom

## Global Constraints

- No retroactive test coverage for any Vue file beyond the 3 named proof-of-setup targets.
- No end-to-end/browser-automation tooling (Playwright, Cypress, etc.) — Vitest + happy-dom + @nuxt/test-utils only.
- No mandated code-coverage threshold or CI gate.
- No change to existing server-side tests' behavior, location, or conventions — they must keep passing exactly as before, just reorganized under a named "server" project.
- useMusicPlayer.ts's saveToLocalStorage/restoreFromLocalStorage are explicitly out of scope.

---

## Verified deviations from the original design spec

This plan's config and test code were arrived at by actually installing the packages and running real tests against this exact repo (Nuxt `4.4.8` resolved from the `^4.4.7` floor, Vitest `4.1.10`, Vue `3.5.35`). Three things in the original spec sketch (`docs/superpowers/specs/2026-08-12-vue-test-infrastructure-design.md`) turned out to be wrong or incomplete once actually run, and are corrected below:

1. **`environment: 'happy-dom'` is wrong for the component project.** The spec's `vitest.config.ts` sketch set `environment: 'happy-dom'` inside the object passed to `defineVitestProject()`. `@nuxt/test-utils`'s own `defineVitestConfig`/`defineVitestProject` source (`node_modules/@nuxt/test-utils/dist/config.mjs`) hard-codes `environment: 'nuxt'` as what enables its Nuxt integration (auto-imports, global component registration, etc.); `happy-dom` is then used *underneath* that as the DOM implementation (it's Nuxt Test Utils' own default `domEnvironment`, picked up automatically once `happy-dom` is an installed dependency — no explicit wiring needed). Using `environment: 'happy-dom'` directly would skip Nuxt's environment integration entirely. **Task 1 uses `environment: 'nuxt'`, verified working.**
2. **Bare `@vue/test-utils` `mount()` does not resolve `<NuxtLink>` or other Nuxt auto-imports/components.** Confirmed by running it directly: mounting `EmptyState.vue` (which renders `<NuxtLink>`) with plain `mount()` throws `[Vue warn]: Failed to resolve component: RouterLink` and the link never renders. Swapping to `mountSuspended()` (imported from `@nuxt/test-utils/runtime`) fixed it immediately — this is the officially-provided integration point and what all 3 test files in this plan use. `@vue/test-utils` is still an installed dependency (it's what `mountSuspended` is built on, and `wrapper.find()`/`.trigger()`/`.emitted()` all come from it), but application code never calls its `mount()` directly.
3. **`useState()` is a cross-test singleton within one test file — state leaks between `it()` blocks.** Verified directly: setting `player.queue.value` to a 1-item array in one test and asserting `queue.value.length === 0` in a subsequent test (in the same file, no reset) fails with `1` received — because `@nuxt/test-utils` reuses one Nuxt app instance per test file, and Nuxt's `useState(key, ...)` is keyed globally by that string key, not scoped per component/test. **`tests/component/useMusicPlayer.test.ts` (Task 3) has a `beforeEach` that explicitly resets every relevant `useState` key to a known baseline before each test** — this is required, not optional, or tests will pass/fail depending on execution order.

Two further corrections surfaced while writing the `useMusicPlayer` and `BaseModal` proof tests, verified against the actual current source (not the design spec's assumptions):

4. **`BaseModal.vue`'s focus-on-show and Escape-listener behavior only fires on a `show` prop *transition*, not on initial mount.** The component's `watch(() => props.show, ...)` has no `{ immediate: true }`. Mounting the component directly with `show: true` from the start leaves `document.activeElement` untouched and never attaches the `keydown` listener — verified directly (mounting with `show: true` and asserting the card is focused fails; the same mount with an initial `show: false` then `wrapper.setProps({ show: true })` succeeds). Task 4's tests for "focus moves to the modal card" and "Escape emits close" all mount with `show: false` first and then transition to `true`, matching how the real app opens a modal.
5. **`useMusicPlayer.ts`'s `prevIndex()` does not special-case `repeatMode === 'one'`,  unlike `nextIndex()`.** `nextIndex()` has `if (repeatMode.value === 'one') return currentIndex.value;` as its first check. `prevIndex()` has no equivalent line — it only special-cases shuffle and `'all'`, so with `repeatMode: 'one'`, `prev()` just decrements the index normally (falls through to the same behavior as `'off'`, except still wrapping under `'all'`). Verified by running `prev()` with `repeatMode: 'one'` at index 1 of a 3-track queue and observing it land on index 0, not stay on index 1. Task 3's test documents and asserts this actual (asymmetric) behavior rather than the design spec's assumption that `prev()` mirrors `next()`.

---

## Task 1: Install dependencies and split `vitest.config.ts` into two projects

**Files:**
- Modify: `/Users/light/Git/youkeep/package.json` (devDependencies)
- Modify: `/Users/light/Git/youkeep/package-lock.json` (generated by `npm install`)
- Modify: `/Users/light/Git/youkeep/vitest.config.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: the `server` and `component` Vitest projects that Tasks 2–4's test files run under. Any file matching `tests/component/**/*.test.ts` automatically runs under the `component` project (Nuxt-aware, `happy-dom` DOM, `mountSuspended` available from `@nuxt/test-utils/runtime`). Any file matching `tests/unit/**/*.test.ts` or `tests/integration/**/*.test.ts` runs under the unchanged `server` project.

- [ ] **Step 1: Confirm the current baseline passes**

Run: `npm run test`
Expected output (last lines):
```
 Test Files  28 passed (28)
      Tests  291 passed (291)
```
If this doesn't match, stop and investigate before proceeding — Task 1's later "no regression" check depends on this baseline being accurate.

- [ ] **Step 2: Install the three new dev dependencies**

Run:
```bash
npm install --save-dev @nuxt/test-utils @vue/test-utils happy-dom
```

This resolves (verified in this repo, given the existing `nuxt: ^4.4.7` / `vitest: ^4.1.10` / `vue: ^3.5.35`):
- `@nuxt/test-utils` → `^4.1.0`
- `@vue/test-utils` → `^2.4.11`
- `happy-dom` → `^20.11.2`

After this step, `package.json`'s `devDependencies` block reads:
```json
  "devDependencies": {
    "@nuxt/test-utils": "^4.1.0",
    "@types/bcryptjs": "^2.4.6",
    "@types/better-sqlite3": "^7.6.13",
    "@vue/test-utils": "^2.4.11",
    "happy-dom": "^20.11.2",
    "vitest": "^4.1.10"
  }
```
(npm sorts devDependencies alphabetically on write; the exact ordering above is what `npm install` produces.)

- [ ] **Step 3: Rewrite `vitest.config.ts` with the two-project split**

Replace the entire contents of `/Users/light/Git/youkeep/vitest.config.ts` with:

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
          environment: 'nuxt',
          include: ['tests/component/**/*.test.ts']
        }
      })
    ]
  }
});
```

Notes for the implementer (verified, not guesswork):
- `environment: 'nuxt'` is required on the component project — it's what tells `@nuxt/test-utils` to wire up Nuxt's auto-imports and component registry. `environment: 'happy-dom'` here does NOT work (see "Verified deviations" section above).
- `happy-dom` doesn't need to be referenced anywhere in this config file — `@nuxt/test-utils` picks it up automatically as the DOM implementation because it's an installed dependency (its own default `domEnvironment`).
- The `server` project's `include` is narrowed from the old flat config's `tests/**/*.test.ts` to the two explicit globs so it does not also try to run the new `tests/component/**` files under the Node environment (which would fail — those files use DOM APIs and Nuxt auto-imports).

- [ ] **Step 4: Verify the server-side suite still passes unchanged under the new config**

Run: `npm run test`
Expected output (last lines) — same 291 tests as Step 1's baseline, now reported per-project:
```
 Test Files  28 passed (28)
      Tests  291 passed (291)
```
There is no `tests/component/**` directory yet, so the `component` project runs 0 test files at this point — that's expected, not an error.

If any of the 291 tests fail or the count differs from Step 1's baseline, stop — this task's deliverable is explicitly "the split works, nothing regressed," so a regression here must be fixed (most likely cause: the `include` globs in Step 3 don't match this repo's actual `tests/unit`/`tests/integration` layout) before moving on.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vitest.config.ts
git commit -m "test: split vitest config into server/component projects, add @nuxt/test-utils"
```

---

## Task 2: `tests/component/EmptyState.test.ts` — simple presentational component

**Files:**
- Create: `/Users/light/Git/youkeep/tests/component/EmptyState.test.ts`

**Interfaces:**
- Consumes: the `component` Vitest project from Task 1 (must be complete first); `mountSuspended` from `@nuxt/test-utils/runtime`; `app/components/EmptyState.vue`'s props (`title: string`, `description: string`, `icon?: 'book' | 'channels' | 'shorts' | 'folder' | 'video' | 'music'`, `actionText?: string`, `actionRoute?: string`) and its single emit (`action`, no payload).
- Produces: nothing consumed by later tasks — Tasks 2–4 are independent of each other.

- [ ] **Step 1: Create the test file**

Create `/Users/light/Git/youkeep/tests/component/EmptyState.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import EmptyState from '../../app/components/EmptyState.vue';

describe('EmptyState', () => {
  it('renders the title and description text', async () => {
    const wrapper = await mountSuspended(EmptyState, {
      props: { title: 'No videos yet', description: 'Subscribe to a channel to get started' }
    });
    expect(wrapper.text()).toContain('No videos yet');
    expect(wrapper.text()).toContain('Subscribe to a channel to get started');
  });

  it('renders a NuxtLink (not a button) when actionRoute and actionText are both set', async () => {
    const wrapper = await mountSuspended(EmptyState, {
      props: {
        title: 'No playlists',
        description: 'Create one to get started',
        actionRoute: '/playlists/new',
        actionText: 'Create playlist'
      }
    });
    const link = wrapper.find('a');
    expect(link.exists()).toBe(true);
    expect(link.attributes('href')).toBe('/playlists/new');
    expect(link.text()).toContain('Create playlist');
    expect(wrapper.find('button').exists()).toBe(false);
  });

  it('renders a button (not a link) when only actionText is set', async () => {
    const wrapper = await mountSuspended(EmptyState, {
      props: { title: 'No results', description: 'Try a different search', actionText: 'Clear search' }
    });
    const button = wrapper.find('button');
    expect(button.exists()).toBe(true);
    expect(button.text()).toContain('Clear search');
    expect(wrapper.find('a').exists()).toBe(false);
  });

  it('renders neither a link nor a button when actionText is unset', async () => {
    const wrapper = await mountSuspended(EmptyState, {
      props: { title: 'Nothing here', description: 'Nothing to see' }
    });
    expect(wrapper.find('a').exists()).toBe(false);
    expect(wrapper.find('button').exists()).toBe(false);
  });

  it('emits "action" with no payload when the button is clicked', async () => {
    const wrapper = await mountSuspended(EmptyState, {
      props: { title: 'No results', description: 'Try a different search', actionText: 'Clear search' }
    });
    await wrapper.find('button').trigger('click');
    const emitted = wrapper.emitted('action');
    expect(emitted).toBeTruthy();
    expect(emitted![0]).toEqual([]);
  });

  it('renders the book icon variant', async () => {
    const wrapper = await mountSuspended(EmptyState, {
      props: { title: 't', description: 'd', icon: 'book' }
    });
    const path = wrapper.find('svg.main-icon path');
    expect(path.attributes('d')).toContain('M4 19.5A2.5 2.5 0 0 1 6.5 17H20');
  });

  it('renders the music icon variant (two circles)', async () => {
    const wrapper = await mountSuspended(EmptyState, {
      props: { title: 't', description: 'd', icon: 'music' }
    });
    expect(wrapper.findAll('svg.main-icon circle').length).toBe(2);
  });

  it('renders the default (video) icon variant when icon is unset', async () => {
    const wrapper = await mountSuspended(EmptyState, {
      props: { title: 't', description: 'd' }
    });
    expect(wrapper.findAll('svg.main-icon polygon').length).toBe(1);
    expect(wrapper.findAll('svg.main-icon rect').length).toBe(1);
  });
});
```

- [ ] **Step 2: Run the new test file**

Run: `npx vitest run tests/component/EmptyState.test.ts`
Expected output (last lines):
```
 Test Files  1 passed (1)
      Tests  8 passed (8)
```

- [ ] **Step 3: Run the full suite to confirm no cross-project interference**

Run: `npm run test`
Expected output (last lines):
```
 Test Files  29 passed (29)
      Tests  299 passed (299)
```
(291 pre-existing `server` tests + 8 new `component` tests.)

- [ ] **Step 4: Commit**

```bash
git add tests/component/EmptyState.test.ts
git commit -m "test: add EmptyState component test as proof-of-setup"
```

---

## Task 3: `tests/component/useMusicPlayer.test.ts` — composable with real behavioral logic

**Files:**
- Create: `/Users/light/Git/youkeep/tests/component/useMusicPlayer.test.ts`

**Interfaces:**
- Consumes: the `component` Vitest project from Task 1 (must be complete first); `useMusicPlayer` and `PlayableTrack` exported from `app/composables/useMusicPlayer.ts`; `mountSuspended` from `@nuxt/test-utils/runtime`; Vue's `defineComponent`/`h` to host the composable (a composable is not itself mountable); Nuxt's auto-imported `useState` (no explicit import needed inside `tests/component/**` files — confirmed working, see Step 2's run).
- Produces: nothing consumed by later tasks — Tasks 2–4 are independent of each other.

- [ ] **Step 1: Create the test file**

Create `/Users/light/Git/youkeep/tests/component/useMusicPlayer.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { defineComponent, h } from 'vue';
import { useMusicPlayer, type PlayableTrack } from '../../app/composables/useMusicPlayer';

// useMusicPlayer() is built on Nuxt's useState(), which is a singleton keyed
// by string ("music_player_queue", "music_player_current_index", etc.) and
// SHARED across every call within the same Nuxt app instance -- including
// across every `it()` block in this file, since @nuxt/test-utils reuses one
// Nuxt app per test file. Each test below explicitly sets the full state it
// needs before asserting, rather than relying on the composable's default
// initial values (which only apply the very first time a key is touched).
//
// useMusicPlayer() is not itself a component, so it must be invoked from
// inside a host component's setup() and mounted with mountSuspended --
// that's what gives it access to Nuxt's useState. Destructuring the
// composable's return value into a variable declared before mountSuspended()
// resolves does NOT work: the getter/variable would be captured before
// setup() has run. Instead we stash it on a holder object and read it back
// after awaiting mountSuspended().

function track(id: string): PlayableTrack {
  return { id, title: `Track ${id}`, local_file_path: `${id}.mp3` };
}

async function setupPlayer() {
  const holder: { player?: ReturnType<typeof useMusicPlayer> } = {};
  const Host = defineComponent({
    setup() {
      holder.player = useMusicPlayer();
      return () => h('div');
    }
  });
  await mountSuspended(Host);
  return holder.player!;
}

describe('useMusicPlayer', () => {
  let player: ReturnType<typeof useMusicPlayer>;

  beforeEach(async () => {
    player = await setupPlayer();
    // Reset every piece of shared state to a known baseline before each test.
    player.queue.value = [];
    player.currentIndex.value = -1;
    player.currentTrack.value = null;
    player.isPlaying.value = false;
    player.currentTime.value = 0;
    player.duration.value = 0;
    player.audioEl.value = null;
    player.shuffleOn.value = false;
    player.repeatMode.value = 'off';
  });

  describe('play()', () => {
    it('sets currentTrack/currentIndex to the matching track when it is already queued, keeping the given order', () => {
      // Note: Vue wraps `queue.value` in a reactive proxy on assignment, so
      // the assigned array is never the exact same object reference as the
      // input `tracks` array even when play() does `queue.value = tracks`
      // with no copying -- toBe() identity checks against `tracks` will
      // always fail here regardless of whether a copy happened internally.
      // The real, observable contract is the resulting content and order.
      const t1 = track('1');
      const t2 = track('2');
      const tracks = [t1, t2];
      player.play(t2, tracks);
      expect(player.queue.value.map((t) => t.id)).toEqual(['1', '2']);
      expect(player.currentIndex.value).toBe(1);
      expect(player.currentTrack.value?.id).toBe('2');
    });

    it('prepends the track and sets currentIndex to 0 when the track is not in the queue', () => {
      const t1 = track('1');
      const t2 = track('2');
      player.play(t1, [t2]);
      expect(player.queue.value.map((t) => t.id)).toEqual(['1', '2']);
      expect(player.currentIndex.value).toBe(0);
      expect(player.currentTrack.value?.id).toBe('1');
    });
  });

  describe('next()/prev() with repeatMode', () => {
    function seedQueue() {
      const tracks = [track('1'), track('2'), track('3')];
      player.play(tracks[0]!, tracks);
      return tracks;
    }

    it("next() does nothing further at the end of the queue when repeatMode is 'off'", () => {
      const tracks = seedQueue();
      player.currentIndex.value = 2;
      player.currentTrack.value = tracks[2]!;
      player.repeatMode.value = 'off';
      player.next();
      // stayed on the last track, did not wrap
      expect(player.currentTrack.value?.id).toBe('3');
      expect(player.currentIndex.value).toBe(2);
      expect(player.isPlaying.value).toBe(false);
    });

    it("next() wraps to index 0 at the end of the queue when repeatMode is 'all'", () => {
      const tracks = seedQueue();
      player.currentIndex.value = 2;
      player.currentTrack.value = tracks[2]!;
      player.repeatMode.value = 'all';
      player.next();
      expect(player.currentTrack.value?.id).toBe('1');
      expect(player.currentIndex.value).toBe(0);
    });

    it("next() replays the same index when repeatMode is 'one'", () => {
      const tracks = seedQueue();
      player.currentIndex.value = 1;
      player.currentTrack.value = tracks[1]!;
      player.repeatMode.value = 'one';
      player.next();
      expect(player.currentTrack.value?.id).toBe('2');
      expect(player.currentIndex.value).toBe(1);
    });

    it("prev() does nothing further before the start of the queue when repeatMode is 'off'", () => {
      const tracks = seedQueue();
      player.currentIndex.value = 0;
      player.currentTrack.value = tracks[0]!;
      player.repeatMode.value = 'off';
      player.prev();
      expect(player.currentTrack.value?.id).toBe('1');
      expect(player.currentIndex.value).toBe(0);
      expect(player.isPlaying.value).toBe(false);
    });

    it("prev() wraps to the last index before the start of the queue when repeatMode is 'all'", () => {
      const tracks = seedQueue();
      player.currentIndex.value = 0;
      player.currentTrack.value = tracks[0]!;
      player.repeatMode.value = 'all';
      player.prev();
      expect(player.currentTrack.value?.id).toBe('3');
      expect(player.currentIndex.value).toBe(2);
    });

    it("prev() does NOT special-case repeatMode 'one' (asymmetric with next() -- prevIndex() has no 'one' branch) and moves to the previous index", () => {
      const tracks = seedQueue();
      player.currentIndex.value = 1;
      player.currentTrack.value = tracks[1]!;
      player.repeatMode.value = 'one';
      player.prev();
      // Verified against the actual source: prevIndex() only special-cases
      // shuffle and 'all'; unlike nextIndex(), it has no `repeatMode.value
      // === 'one'` guard, so prev() falls through to plain decrement.
      expect(player.currentTrack.value?.id).toBe('1');
      expect(player.currentIndex.value).toBe(0);
    });
  });

  describe('toggleShuffle()', () => {
    it('generates a shuffledOrder that includes every queue index exactly once', () => {
      const tracks = [track('1'), track('2'), track('3'), track('4')];
      player.play(tracks[0]!, tracks);
      player.toggleShuffle();
      expect(player.shuffleOn.value).toBe(true);
      const order = useState<number[] | null>('music_player_shuffled_order').value;
      expect(order).not.toBeNull();
      expect([...order!].sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
    });

    it('clears shuffledOrder when toggled back off', () => {
      const tracks = [track('1'), track('2')];
      player.play(tracks[0]!, tracks);
      player.toggleShuffle();
      player.toggleShuffle();
      expect(player.shuffleOn.value).toBe(false);
      const order = useState<number[] | null>('music_player_shuffled_order').value;
      expect(order).toBeNull();
    });
  });

  describe('replaceQueueKeepingCurrent()', () => {
    it('updates queue/currentIndex/currentTrack without touching audioEl or hasCountedThisPlay', () => {
      const t1 = track('1');
      const t2 = track('2');
      player.play(t1, [t1]);

      // Simulate an attached <audio> element and a play already counted --
      // hasCountedThisPlay is intentionally not part of useMusicPlayer()'s
      // returned object, but since useState() is keyed globally we can read
      // it back directly by its key, the same way the composable does
      // internally.
      const fakeAudioEl = { src: 'original.mp3', currentTime: 42 } as unknown as HTMLMediaElement;
      player.audioEl.value = fakeAudioEl;
      const hasCounted = useState<boolean>('music_player_has_counted');
      hasCounted.value = true;

      player.replaceQueueKeepingCurrent(t2, [t1, t2]);

      expect(player.queue.value.map((t) => t.id)).toEqual(['1', '2']);
      expect(player.currentIndex.value).toBe(1);
      expect(player.currentTrack.value?.id).toBe('2');
      // audioEl.src/currentTime must be untouched -- unlike play()/next()/
      // prev() (which call loadTrack() and reset src + currentTime),
      // replaceQueueKeepingCurrent() never calls loadTrack().
      expect(player.audioEl.value?.src).toBe('original.mp3');
      expect(player.audioEl.value?.currentTime).toBe(42);
      // hasCountedThisPlay must not have been reset to false
      expect(hasCounted.value).toBe(true);
    });

    it('prepends and sets currentIndex to 0 when the new track is not in the given list', () => {
      const t1 = track('1');
      const t2 = track('2');
      player.play(t1, [t1]);
      player.replaceQueueKeepingCurrent(t2, [t1]);
      expect(player.queue.value.map((t) => t.id)).toEqual(['2', '1']);
      expect(player.currentIndex.value).toBe(0);
      expect(player.currentTrack.value?.id).toBe('2');
    });
  });
});
```

Explicitly out of scope for this file (per the Global Constraints and the design spec): `saveToLocalStorage()`/`restoreFromLocalStorage()`, which need `window.localStorage` and a real (or mocked) `$fetch` — future work.

- [ ] **Step 2: Run the new test file**

Run: `npx vitest run tests/component/useMusicPlayer.test.ts`
Expected output (last lines):
```
 Test Files  1 passed (1)
      Tests  12 passed (12)
```

- [ ] **Step 3: Run the full suite to confirm no cross-project interference**

Run: `npm run test`
Expected output — count depends on whether Task 2 has already run in this checkout; if both Task 2 and Task 3 are done, expect:
```
 Test Files  30 passed (30)
      Tests  311 passed (311)
```
(291 pre-existing `server` tests + 8 `EmptyState` + 12 `useMusicPlayer`.) If only Task 3 is done (Task 2 not yet merged), expect `291 + 12 = 303` across 29 files instead.

- [ ] **Step 4: Commit**

```bash
git add tests/component/useMusicPlayer.test.ts
git commit -m "test: add useMusicPlayer composable test as proof-of-setup"
```

---

## Task 4: `tests/component/BaseModal.test.ts` — interactions, emits, and focus lifecycle

**Files:**
- Create: `/Users/light/Git/youkeep/tests/component/BaseModal.test.ts`

**Interfaces:**
- Consumes: the `component` Vitest project from Task 1 (must be complete first); `mountSuspended` from `@nuxt/test-utils/runtime`; `app/components/BaseModal.vue`'s props (`show: boolean`, `title: string`), its single emit (`close`, no payload), and its default + `footer` slots.
- Produces: nothing consumed by later tasks — Tasks 2–4 are independent of each other.

- [ ] **Step 1: Create the test file**

Create `/Users/light/Git/youkeep/tests/component/BaseModal.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { nextTick } from 'vue';
import BaseModal from '../../app/components/BaseModal.vue';

// BaseModal's focus/keydown-listener behavior is driven by a
// `watch(() => props.show, ...)` with no `{ immediate: true }`. That means
// the watcher callback only runs on a show TRANSITION (false -> true or
// true -> false) -- it does NOT run just because the component happened to
// mount with `show: true` already set. Verified directly: mounting with
// `show: true` from the start leaves `document.activeElement` untouched and
// does not attach the Escape listener. Tests that need the "shown" behavior
// must mount with `show: false` and then `setProps({ show: true })` to
// trigger the watcher, exactly like the real app does when a modal is
// toggled open by user action.

describe('BaseModal', () => {
  it('clicking the backdrop emits close', async () => {
    const wrapper = await mountSuspended(BaseModal, {
      props: { show: true, title: 'Confirm' },
      slots: { default: 'Are you sure?' }
    });
    await wrapper.find('.modal-overlay').trigger('click');
    expect(wrapper.emitted('close')).toBeTruthy();
    expect(wrapper.emitted('close')!.length).toBe(1);
  });

  it('clicking the modal card itself does NOT emit close (click.stop guard)', async () => {
    const wrapper = await mountSuspended(BaseModal, {
      props: { show: true, title: 'Confirm' },
      slots: { default: 'Are you sure?' }
    });
    await wrapper.find('.modal-card').trigger('click');
    expect(wrapper.emitted('close')).toBeFalsy();
  });

  it('clicking the close button emits close', async () => {
    const wrapper = await mountSuspended(BaseModal, {
      props: { show: true, title: 'Confirm' },
      slots: { default: 'Are you sure?' }
    });
    await wrapper.find('.close-modal-btn').trigger('click');
    expect(wrapper.emitted('close')).toBeTruthy();
  });

  it('pressing Escape while shown emits close', async () => {
    const wrapper = await mountSuspended(BaseModal, {
      props: { show: false, title: 'Confirm' },
      attachTo: document.body
    });
    await wrapper.setProps({ show: true });
    await nextTick();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(wrapper.emitted('close')).toBeTruthy();
  });

  it('pressing Escape while NOT shown does not emit close', async () => {
    const wrapper = await mountSuspended(BaseModal, {
      props: { show: false, title: 'Confirm' },
      attachTo: document.body
    });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(wrapper.emitted('close')).toBeFalsy();
  });

  it('pressing Escape after transitioning shown -> not shown no longer emits close (listener detached)', async () => {
    const wrapper = await mountSuspended(BaseModal, {
      props: { show: false, title: 'Confirm' },
      attachTo: document.body
    });
    await wrapper.setProps({ show: true });
    await nextTick();
    await wrapper.setProps({ show: false });
    await nextTick();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(wrapper.emitted('close')).toBeFalsy();
  });

  it('moves focus to the modal card when show transitions from false to true', async () => {
    const wrapper = await mountSuspended(BaseModal, {
      props: { show: false, title: 'Confirm' },
      attachTo: document.body
    });
    await wrapper.setProps({ show: true });
    await nextTick(); // flush the watcher
    await nextTick(); // flush the nextTick() scheduled inside the watcher
    const card = wrapper.find('.modal-card').element as HTMLElement;
    expect(document.activeElement).toBe(card);
  });

  it('does NOT move focus when mounted directly with show: true (watch has no immediate:true)', async () => {
    const wrapper = await mountSuspended(BaseModal, {
      props: { show: true, title: 'Confirm' },
      attachTo: document.body
    });
    await nextTick();
    await nextTick();
    const card = wrapper.find('.modal-card').element as HTMLElement;
    expect(document.activeElement).not.toBe(card);
  });

  it('returns focus to the previously-focused element when show transitions from true to false', async () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const wrapper = await mountSuspended(BaseModal, {
      props: { show: false, title: 'Confirm' },
      attachTo: document.body
    });
    await wrapper.setProps({ show: true });
    await nextTick();
    await nextTick();
    expect(document.activeElement).toBe(wrapper.find('.modal-card').element);

    await wrapper.setProps({ show: false });
    await nextTick();
    expect(document.activeElement).toBe(trigger);

    trigger.remove();
  });

  it('does not throw or restore focus to a removed element (document.contains() guard)', async () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();

    const wrapper = await mountSuspended(BaseModal, {
      props: { show: false, title: 'Confirm' },
      attachTo: document.body
    });
    await wrapper.setProps({ show: true });
    await nextTick();
    await nextTick();

    // The element that had focus before the modal opened is removed from
    // the document while the modal is still open.
    trigger.remove();

    await wrapper.setProps({ show: false });
    await nextTick();

    // document.contains(previouslyFocusedEl) is false, so the component
    // must not attempt to call .focus() on the detached element; body (or
    // nothing) ends up focused instead of throwing.
    expect(document.activeElement).not.toBe(trigger);
  });
});
```

- [ ] **Step 2: Run the new test file**

Run: `npx vitest run tests/component/BaseModal.test.ts`
Expected output (last lines):
```
 Test Files  1 passed (1)
      Tests  10 passed (10)
```

- [ ] **Step 3: Run the full suite to confirm no cross-project interference**

Run: `npm run test`
Expected output — count depends on how many of Tasks 2–4 have landed in this checkout. With all three done:
```
 Test Files  31 passed (31)
      Tests  321 passed (321)
```
(291 pre-existing `server` tests + 8 `EmptyState` + 12 `useMusicPlayer` + 10 `BaseModal`.)

- [ ] **Step 4: Commit**

```bash
git add tests/component/BaseModal.test.ts
git commit -m "test: add BaseModal component test as proof-of-setup"
```

---

## Final verification (after all 4 tasks are merged)

Run: `npm run test`
Expected output (last lines):
```
 Test Files  31 passed (31)
      Tests  321 passed (321)
```

This is the sub-project's own verification per the design spec: both projects (`server`, `component`) run in one `npm run test` invocation, the 291 pre-existing server-side tests are unchanged, and all 3 new component test files (30 tests total: 8 + 12 + 10) pass.
