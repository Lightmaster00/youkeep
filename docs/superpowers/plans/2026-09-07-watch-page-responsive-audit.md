# Watch Page Responsive Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the one confirmed narrow-viewport overflow bug found by a real-browser audit of the watch page and its video player — `VideoPlayer.vue`'s `.controls-row` overflowing by up to 138px at 320px, with zero existing responsive coverage — using the same proven breakpoint-tier idiom already shipped for `MusicMiniPlayer.vue`/`PodcastMiniPlayer.vue`.

**Architecture:** `VideoPlayer.vue`'s transport controls (play, rewind/forward 10s, volume, time display on the left; speed, theater mode, fullscreen on the right, `justify-content: space-between`) sum to more width than the player has at narrow viewports, and the component has no media queries at all today. The fix hides the least-essential controls at two narrower tiers — exactly the pattern already proven for the app's mini-players — rather than shrinking every control uniformly or inventing a new approach. The three other candidates the design spec flagged (`watch/[id].vue`'s `.tech-grid`, `.rec-thumbnail-wrapper`, and `.mini-player`) were all independently measured live and found to already be clean or negligibly close — no code changes needed for any of them, and this plan documents why rather than fixing what isn't broken.

**Tech Stack:** Nuxt 4 (Vue 3 `<script setup>`, SFC `<style scoped>`), Nitro, better-sqlite3, Vitest 4 + happy-dom + `@vue/test-utils` (`npm test` → `vitest run`).

## Global Constraints

- No new automated tests for this bug class — CSS overflow has no automated coverage anywhere in this codebase; verification is real-browser measurement only.
- No changes to any other page, layout, or shared component beyond `app/pages/watch/[id].vue` and `app/components/VideoPlayer.vue`.
- No redesign of the player's control set or the page's information architecture — CSS-only overflow fixes (plus the minimal template class additions needed to target specific buttons with CSS, matching the existing `speed-btn`/`cc-btn` convention already in this file).
- Fixes reuse the already-established idioms verbatim where the bug shape matches a previously-solved one — specifically, `MusicMiniPlayer.vue`/`PodcastMiniPlayer.vue`'s proven breakpoint-tier pattern (hide secondary controls at defined narrow tiers) for `VideoPlayer.vue`'s controls row. Do not invent a new pattern for a bug shape this codebase has already solved.
- Every claimed fix is backed by real-browser before/after `scrollWidth - clientWidth` measurement at the full width sweep (320/375/414/480/481/560/561/600/900/1200/1201px minimum).
- The seek/progress bar must never collapse to near-zero width and no control may become unreachable or fall outside the player's bounds at any swept width — the same standard sub-project 1's Task 4 review held the mini-players to.

---

## Audit Results

This section is the completed investigation, done directly against the running app (dev server + real browser, logged in via the `POST /api/dev/login` fixture, `ALLOW_DEV_LOGIN=1` in a local, gitignored `.env`), using a real archived video (`6Db-cEgbmC4`, "Dj Goja x Jason Derulo x Melody - Mi Chico (Official Music Video)", channel "Jason Derulo") with 10 real "recommended videos" sidebar entries and the admin-only Technical Details panel expanded.

### Per-candidate findings

#### 1. `VideoPlayer.vue`'s `.controls-row` — **BUG CONFIRMED, the only real bug found in this sub-project**

`app/components/VideoPlayer.vue:86-208` renders, on the left (`.controls-left`, `:88-145`): Play/Pause (36px), Rewind 10s (36px), Forward 10s (36px), a volume control (36px collapsed + a hover-reveal slider), and a time display (~64px). On the right (`.controls-right`, `:148-207`): a speed selector (~33px, "1x"), a conditional subtitles button (only when the video has subtitle tracks — this test video has none), a Theater Mode button (36px), and a Fullscreen button (36px). `.controls-row` itself (`:868-874`) is `display: flex; justify-content: space-between`, and this ENTIRE component has **zero `@media` queries** — confirmed by grepping the whole 1045-line file.

| Viewport | `.controls-row` overflow |
|---|---|
| 320px | 138px |
| 375px | (not directly re-measured pre-fix; scales down from 138px, same shape) |
| 400px | 50px (with volume+theater already hidden in this row's own isolated test — see below) |
| 450px | 1px (with volume+theater hidden) |
| 480px | 0px (with volume+theater hidden) |
| 510px | 29px (no hides applied) |
| 540px | 0px (no hides applied) |
| 561px+ | 0px (no hides applied) |

Root cause, isolated by hiding one control group at a time and re-measuring: `leftWidth` (247.97px) + `rightWidth` (121.16px) = 369.13px of combined content, against a `rowWidth` of only 246.6px at a 320px viewport — a ~123px shortfall (matching the measured 138px overflow once gaps/padding are included). No single control is the culprit; it's the combined total of `flex-shrink: 0` controls with no hide/shrink tier at all.

**Fix, verified live in exactly this order (each step's own contribution measured before adding the next):**
1. Hiding `.volume-control` alone: 138px → 94px at 320px. Not sufficient alone.
2. Also hiding the Theater Mode button: 94px → 50px at 320px. Still not sufficient at 320px, but **is** sufficient (0px) starting at 450px, and remains sufficient up through the natural resolution point (between 510px, where it still needs `29px` with NO hides, and 540px, where it needs none).
3. Also hiding the Rewind 10s and Forward 10s buttons: 50px → **0px** at 320px.

This gives a clean two-tier scheme:
- **Medium tier, `max-width: 560px`** (a round number safely covering the measured 510-540px natural-resolution gap — at 561px, confirmed 0px overflow with NO hides applied, so 560px is a safe upper boundary): hide `.volume-control` and the Theater Mode button.
- **Compact tier, `max-width: 480px`** (matching this app's established compact-tier value, and confirmed live: at 481px the medium-tier hides alone already reach 0px, so 480px is a safe boundary with no gap): additionally hide the Rewind 10s and Forward 10s buttons.

Confirmed by direct measurement at the exact boundaries: 320px → 0px, 375px → 0px, 480px → 0px, 481px → 0px (medium-tier hides only, rewind/forward correctly still visible), 560px → 0px, 561px → 0px (zero hides active, correctly matching pre-fix natural behavior), 600px and above → unaffected (visually confirmed via screenshot: Play, time display, "1x" speed, and Fullscreen remain visible and usable at 320px with the fix applied, with clean spacing and no cramping).

`.progress-bar-container` (the seek bar, `:782`) lives in a **separate row above** `.controls-row`, not inside it, and is unaffected by any of these hides — confirmed its width stays at the player's full width (246.6px at a 320px viewport in this test) at every measurement, satisfying the Global Constraint that the seek bar must never collapse.

**Two things this fix does NOT cover, disclosed rather than silently assumed:**
- **The conditional Prev/Next playlist buttons** (`v-if="hasPrevVideo"`/`v-if="hasNextVideo"`, `:96-113`) were **not measured with real playlist data** — this dev database has zero seeded playlists (`GET /api/playlists/personal` returned an empty array), so a video played from within a playlist (which would add up to 2 more 36px buttons to `.controls-left`) could not be tested live. Since these buttons are already `flex-shrink: 0` inside the same row this fix targets, and adding them increases demand beyond what was measured, Task 1 defensively hides them at the same compact tier as the Rewind/Forward buttons (cheap and harmless when absent, since the CSS rule only affects rendering when they exist) — but this is a reasoned precaution, not a live-verified fix, and is called out as such rather than claimed equivalent to the rest of this audit's evidence.
- **The Subtitles button** (`v-if="subtitles && subtitles.length > 0"`, `:168-195`) could not be tested either, since the test video has no subtitle tracks. Its sibling classes (`.subtitles-menu`, `:993-1001`) are separately assessed as low-risk below (#5) — the button itself, when present, adds another 36px `flex-shrink: 0` element to `.controls-right`, which would modestly tighten the margins found above but is unlikely to invalidate the two-tier breakpoint values given the margin already measured (e.g., 561px had 29px of slack at 510px). Not fixed defensively (unlike Prev/Next) because there is no CSS-only way to "hide it a bit more" beyond what the compact tier already achieves, and inventing a third tier for an unmeasured scenario would violate the "no speculative work" principle this initiative has held to throughout. Documented as a known gap for a future audit if it turns out to matter.

#### 2. `watch/[id].vue`'s `.tech-grid` — **CLEAN (negligible, not fixed)**

`watch/[id].vue:1055-1059`, `minmax(240px, 1fr)`, inside the admin-only "Archive Technical Details" collapsible panel. Expanded live (via the `.tech-details-header` click handler) and measured at a 320px viewport: `.tech-grid`'s own `scrollWidth - clientWidth` was **1px** — a rounding artifact, not a real bug. This refutes the design spec's suspicion that 240px (smaller than the 260-300px values that DID overflow in prior sub-projects) would behave the same way here; the sidebar's actual available width at this point in the page (238.6px) happens to almost exactly match the 240px minimum. Not fixed — a 1px difference is below any reasonable threshold and matches this initiative's established practice of recording, not speculatively patching, negligible cases.

#### 3. `watch/[id].vue`'s `.rec-thumbnail-wrapper` — **CLEAN, the design spec's suspicion was wrong**

`watch/[id].vue:1256-1264`, a 168px fixed-width, `flex-shrink: 0` thumbnail in the "recommended videos" sidebar list. Measured live with all 10 real recommendation cards at a 320px viewport: every `.recommendation-card`'s own `scrollWidth - clientWidth` was **0px**, and each card measured 272.6px wide — comfortably wider than the 168px thumbnail plus its sibling info column. The design spec's concern (that the sidebar's content box might be too narrow once `.watch-content` collapses to one column below 1200px) does not hold in practice: once collapsed, the sidebar gets the page's full content width, not a squeezed fraction of it — there is no adjacent player column competing for space at this width. Not fixed — there is nothing to fix.

#### 4. `watch/[id].vue`'s `.mini-player` — **CLEAN at every width this project tests**

`watch/[id].vue:1504-1508`, `position: fixed; bottom: 24px; right: 24px; width: 280px;`, the in-page floating mini-player shown when scrolling past the main video while it's playing. Triggered live (played the video, dispatched a `scroll` event on `.content-area`, the component's real scroll-listener target) and measured its `getBoundingClientRect()` at a 320px viewport: `left: 16px`, `right: 296px` — fully within the `[0, 320]` viewport bounds, with 16px of margin on each side. This project's established convention treats 320px as the narrowest width that must work; the element fits there with room to spare. Not fixed. (Below 320px — a width this project does not test or support elsewhere — it would eventually clip, but that is consistent with every other page in this app, none of which are verified below 320px either.)

#### 5. `VideoPlayer.vue`'s `.speed-menu`/`.subtitles-menu` — **CLEAN, confirmed low-risk as anticipated**

`:955-961`, `:993-1001`, both `min-width: 120px`, `position: absolute; right: 0`, anchored to their trigger button inside the player's own bounds. The player itself is always at least ~240px wide at every tested viewport (it spans the full watch-content column), comfortably containing a 120px popup. No live overflow measured; matches the design spec's own low-suspicion assessment.

### Audit summary

| # | Element | File:Lines | Outcome |
|---|---|---|---|
| 1 | `.controls-row` (+ its Volume/Theater/Rewind/Forward controls) | `VideoPlayer.vue:86-208` (template), `:868-1035` (style) | **BUG**, the only real fix in this sub-project → Task 1 |
| 2 | `.tech-grid` | `watch/[id].vue:1055-1059` | Clean (1px, negligible) — not fixed |
| 3 | `.rec-thumbnail-wrapper` | `watch/[id].vue:1256-1264` | Clean (0px with 10 real cards) — design spec's suspicion refuted |
| 4 | `.mini-player` | `watch/[id].vue:1504-1508` | Clean (16px margin at 320px) — not fixed |
| 5 | `.speed-menu`/`.subtitles-menu` | `VideoPlayer.vue:955-961, 993-1001` | Clean, confirmed low-risk as anticipated |

Since only one file needs a code change, and `watch/[id].vue` itself needs none, this plan has a single fix task (in `VideoPlayer.vue`) plus a final verification task that re-confirms both the fix AND that the four clean candidates remain clean on the actual committed code.

---

## File Structure

| File | Change |
|---|---|
| `app/components/VideoPlayer.vue` | Modify — add two targeting classes to existing buttons (Task 1 Step 1), add two new `@media` blocks (Task 1 Step 2) |
| `app/pages/watch/[id].vue` | No change — every candidate in this file was confirmed clean |

No new source files, no test files.

---

### Task 1: Add narrow-viewport breakpoint tiers to VideoPlayer.vue's controls row

**Files:**
- Modify: `app/components/VideoPlayer.vue:116` (Rewind 10s button), `:121` (Forward 10s button), `:198` (Theater Mode button), `:96-113` (Prev/Next playlist buttons), `:1032-1035` (insert new media queries after this point)
- Test: none (established convention — no automated tests for this bug class)

**Interfaces:**
- Consumes: nothing from elsewhere — this is a self-contained change to one component's template classes and its own `<style scoped>` block.
- Produces: `.controls-row` stops overflowing its container at every width from 320px up. Task 2 re-measures `.controls-row`'s `scrollWidth - clientWidth` on the actual committed code to assert this.

- [ ] **Step 1: Add targeting classes to the buttons that need to be hidden at narrow widths**

In `app/components/VideoPlayer.vue`, replace line 116:

```vue
          <button class="ctrl-btn" @click="skip(-10)" title="Rewind 10s (←)">
```

with:

```vue
          <button class="ctrl-btn skip-btn" @click="skip(-10)" title="Rewind 10s (←)">
```

Replace line 121:

```vue
          <button class="ctrl-btn" @click="skip(10)" title="Forward 10s (→)">
```

with:

```vue
          <button class="ctrl-btn skip-btn" @click="skip(10)" title="Forward 10s (→)">
```

Replace line 198:

```vue
          <button class="ctrl-btn" @click="toggleTheaterMode" :title="isTheaterMode ? 'Exit Theater Mode' : 'Theater Mode'">
```

with:

```vue
          <button class="ctrl-btn theater-btn" @click="toggleTheaterMode" :title="isTheaterMode ? 'Exit Theater Mode' : 'Theater Mode'">
```

Then, for the conditional Prev/Next playlist buttons (defensively hidden at the compact tier per the Audit Results — these could not be measured live since no playlist exists in the dev database, but they are the same `flex-shrink: 0` shape as the buttons just fixed, and hiding them costs nothing when they're absent), replace lines 96-113:

```vue
          <!-- Playlist Prev Video -->
          <button
            v-if="hasPrevVideo"
            class="ctrl-btn"
            @click="emit('prev')"
            title="Previous Video"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="white" stroke="none"><polygon points="19 20 9 12 19 4 19 20"></polygon><line x1="5" y1="4" x2="5" y2="20" stroke="white" stroke-width="2"></line></svg>
          </button>

          <!-- Playlist Next Video -->
          <button
            v-if="hasNextVideo"
            class="ctrl-btn"
            @click="emit('next')"
            title="Next Video"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="white" stroke="none"><polygon points="5 4 15 12 5 20 5 4"></polygon><line x1="19" y1="4" x2="19" y2="20" stroke="white" stroke-width="2"></line></svg>
          </button>
```

with:

```vue
          <!-- Playlist Prev Video -->
          <button
            v-if="hasPrevVideo"
            class="ctrl-btn skip-btn"
            @click="emit('prev')"
            title="Previous Video"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="white" stroke="none"><polygon points="19 20 9 12 19 4 19 20"></polygon><line x1="5" y1="4" x2="5" y2="20" stroke="white" stroke-width="2"></line></svg>
          </button>

          <!-- Playlist Next Video -->
          <button
            v-if="hasNextVideo"
            class="ctrl-btn skip-btn"
            @click="emit('next')"
            title="Next Video"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="white" stroke="none"><polygon points="5 4 15 12 5 20 5 4"></polygon><line x1="19" y1="4" x2="19" y2="20" stroke="white" stroke-width="2"></line></svg>
          </button>
```

(Both buttons now share the `skip-btn` class with the Rewind/Forward buttons — all four are hidden together at the compact tier below, since they're the same "secondary transport control" shape.)

- [ ] **Step 2: Add the two breakpoint tiers**

In `app/components/VideoPlayer.vue`, find lines 1032-1035:

```css
.ctrl-btn.cc-btn.active svg {
  color: var(--accent-primary-hover);
  filter: drop-shadow(0 0 5px var(--accent-primary-glow));
}
```

Immediately after this rule (before the `@keyframes spin` block), insert:

```css

/* Narrow-viewport controls-row breakpoints, mirroring the proven tier
   pattern already shipped for MusicMiniPlayer.vue / PodcastMiniPlayer.vue.
   Measured live: .controls-left (247.97px) + .controls-right (121.16px)
   demand 369px combined against a 246.6px row at a 320px viewport.
   Medium (<= 560px): hiding .volume-control and the theater-mode button
   alone closes the gap down to 450px (1px overflow) and fully resolves it
   by 480px — 560px is a round, safely-covering boundary for the measured
   510-540px natural-resolution range (561px already reads 0px overflow
   with zero hides applied).
   Compact (<= 480px): the Rewind/Forward 10s buttons (and the
   playlist-only Prev/Next buttons, which share the same .skip-btn class)
   are hidden too, closing the remaining 50px gap measured at 320px down
   to 0px. The seek bar lives in a separate row above .controls-row and is
   never affected by any of these hides. */
@media (max-width: 560px) {
  .volume-control {
    display: none;
  }

  .theater-btn {
    display: none;
  }
}

@media (max-width: 480px) {
  .skip-btn {
    display: none;
  }
}
```

- [ ] **Step 3: Confirm the existing suite is still green**

Run: `cd /Users/light/Git/youkeep && npm test`
Expected: PASS — the existing Vitest suite is unrelated to this component's CSS and must stay green (no new tests are added, per the Global Constraints).

- [ ] **Step 4: Commit**

```bash
cd /Users/light/Git/youkeep
git add app/components/VideoPlayer.vue
git commit -m "fix: stop video player controls overflowing at mobile widths

.controls-row had zero responsive coverage — its transport controls
(play, rewind/forward 10s, volume, time, speed, theater mode, fullscreen)
summed to 369px of combined content against a 246.6px row at a 320px
viewport (138px measured overflow). Adds the same two-tier breakpoint
pattern already proven for MusicMiniPlayer.vue/PodcastMiniPlayer.vue:
volume + theater mode hidden below 560px, rewind/forward (and the
playlist-only prev/next buttons, defensively) hidden below 480px. The
seek bar lives in a separate row and is unaffected.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Manual end-to-end verification — real-browser width sweep

This is the task the Global Constraints mandate: measured rendered layout on the actual committed code, not a re-read of the audit's own numbers (which were gathered live but before this exact diff existed as committed code). This task also re-confirms the four candidates the audit found clean, since Task 1's own changes could not have affected them but the plan's own standard is to verify, not assume.

**Files:**
- Modify: none
- Test: none automated — this task is the verification

**Interfaces:**
- Consumes: `.volume-control`, `.theater-btn`, `.skip-btn` (Task 1); `.controls-row`, `.progress-bar-container`, `.tech-grid`, `.rec-thumbnail-wrapper`, `.mini-player` from the existing, unchanged markup.
- Produces: a pass/fail record for every swept width, plus a `git diff --stat` proving only `app/components/VideoPlayer.vue` changed. Nothing downstream consumes it — this is the final task.

- [ ] **Step 1: Start the dev server and log in**

`.claude/launch.json`'s `youkeep-dev` configuration already exists. Start it via `preview_start` with `name: "youkeep-dev"`.

A local, gitignored `.env` with `ALLOW_DEV_LOGIN=1` should already exist at `/Users/light/Git/youkeep/.env`. Then, in the browser:

```js
const csrf = document.cookie.split('; ').find(c => c.startsWith('csrf_token='))?.split('=')[1];
await fetch('/api/dev/login', { method: 'POST', headers: {'content-type':'application/json', 'x-csrf-token': csrf || ''}, body: '{}' }).then(r => r.status)
```

Expected: `200`. If it 403s on the very first attempt with a CSRF error, reload once first and retry.

- [ ] **Step 2: Find a real video and navigate to it**

```js
const videos = await fetch('/api/videos?limit=5').then(r=>r.json());
videos.videos.map(v => ({ id: v.id, title: v.title, status: v.download_status }))
```

Use any `status: "completed"` video's id (this plan's own audit used `6Db-cEgbmC4`, still present in the same dev database unless it changed). Navigate to `/watch/<id>`.

- [ ] **Step 3: Sweep the controls-row fix at the full width set**

At each width in **320, 375, 414, 480, 481, 560, 561, 600, 900, 1200, 1201**, reload after each resize, then run:

```js
(() => {
  const row = document.querySelector('.controls-row');
  const bar = document.querySelector('.progress-bar-container');
  return {
    width: window.innerWidth,
    rowOverflow: row.scrollWidth - row.clientWidth,
    progressBarWidth: bar.getBoundingClientRect().width,
    volumeVisible: getComputedStyle(document.querySelector('.volume-control')).display !== 'none',
    theaterVisible: getComputedStyle(document.querySelector('.theater-btn')).display !== 'none',
    skipBtnsVisible: Array.from(document.querySelectorAll('.skip-btn')).every(b => getComputedStyle(b).display !== 'none')
  };
})()
```

Expected: `rowOverflow <= 0` at every width. `progressBarWidth` stays a substantial, non-collapsed value at every width (never near 0). `volumeVisible`/`theaterVisible` are `false` at ≤560px and `true` above it. `skipBtnsVisible` is `false` at ≤480px and `true` above it (note: `hasPrevVideo`/`hasNextVideo` are false for a non-playlist video, so `.skip-btn` will only match the Rewind/Forward buttons in this test — that's expected and matches the audit's own disclosed gap around playlist mode).

- [ ] **Step 4: Hit-test that the remaining controls are actually usable at 320px, not just present**

At 320px:

```js
(() => {
  const play = Array.from(document.querySelectorAll('.ctrl-btn')).find(b => b.title && b.title.includes('Play'));
  const speed = document.querySelector('.speed-btn');
  const fullscreen = Array.from(document.querySelectorAll('.ctrl-btn')).find(b => b.title === 'Fullscreen (F)');
  const hit = el => {
    const r = el.getBoundingClientRect();
    const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return t ? (t.closest('button')?.title || t.className) : null;
  };
  return { playHit: hit(play), speedHit: hit(speed), fullscreenHit: hit(fullscreen) };
})()
```

Expected: each hit-test returns the element itself (or a child of it, e.g. an `<svg>`/`<span>` inside the button) — not some unrelated element sitting on top of it, confirming these remaining controls are genuinely clickable, not just visually present.

- [ ] **Step 5: Re-confirm the four candidates the audit found clean, on the actual committed code**

Expand the Technical Details panel (click `.tech-details-header`) and measure at 320px:

```js
(() => {
  const grid = document.querySelector('.tech-grid');
  const cards = Array.from(document.querySelectorAll('.recommendation-card'));
  return {
    techGridOverflow: grid.scrollWidth - grid.clientWidth,
    worstRecCardOverflow: cards.length ? Math.max(...cards.map(c => c.scrollWidth - c.clientWidth)) : 'n/a',
    recCardCount: cards.length
  };
})()
```

Expected: `techGridOverflow` at or near 0 (≤1-2px, matching the audit's own measurement), `worstRecCardOverflow` at 0 with `recCardCount > 0` (confirming real cards were actually present, not an empty state).

Then trigger the floating mini-player (play the video, then dispatch a scroll event on `.content-area` after scrolling it past the player) and measure:

```js
const ca = document.querySelector('.content-area');
ca.scrollTop = 800;
ca.dispatchEvent(new Event('scroll'));
await new Promise(r => setTimeout(r, 500));
const mp = document.querySelector('.mini-player');
const r = mp ? mp.getBoundingClientRect() : null;
({ found: !!mp, left: r?.left, right: r?.right, viewportWidth: window.innerWidth })
```

Expected: `found: true`, `left >= 0`, `right <= viewportWidth`.

- [ ] **Step 6: Confirm no other file was touched**

Run: `cd /Users/light/Git/youkeep && git diff --stat main -- app/`

Expected: exactly one file listed — `app/components/VideoPlayer.vue`. Any other file appearing (in particular `app/pages/watch/[id].vue`, which this plan's audit found needs no changes) means work was done outside the audit's findings — revert it.

- [ ] **Step 7: Stop the dev server**

Stop the preview server. No commit is needed for this task.

---

## Self-Review

Run at the end of writing, against the design spec at `docs/superpowers/specs/2026-09-07-watch-page-responsive-audit-design.md`.

### 1. Spec coverage

| Spec requirement | Where it lands | Outcome |
|---|---|---|
| Audit `.tech-grid` | Audit §2 | **Checked, clean** (1px, negligible) — design spec's own uncertainty resolved with a real number, not fixed |
| Audit `.rec-thumbnail-wrapper` | Audit §3 | **Checked, clean** (0px with 10 real cards) — design spec's suspicion explicitly refuted, with the reason why (sidebar gets full width once collapsed, no competing column) |
| Audit `.mini-player` | Audit §4 | **Checked, clean** (16px margin at 320px) — the one genuinely new bug SHAPE this sub-project set out to investigate turned out not to be a bug at the widths this project tests |
| Audit `VideoPlayer.vue`'s `.controls-row` | Audit §1 | **Bug confirmed and fixed** — the largest-radius, and only real, bug in this sub-project → Task 1 |
| Audit `.speed-menu`/`.subtitles-menu` | Audit §5 | **Checked, clean, confirmed low-risk as anticipated** |
| Reuse the mini-players' proven breakpoint-tier pattern for the controls row | Task 1 Step 2 | Covered — same two-tier shape (medium/compact), values chosen from this component's own live measurement rather than copy-pasted verbatim from the mini-players (their exact pixel values don't transfer, since the control sets differ) |
| Work out the fix for the two genuinely new bug shapes live rather than assuming one | Audit §1 (fix derivation), §4 (mini-player investigation) | Covered — the controls-row fix was derived by incrementally testing hide-groups and measuring after each; the mini-player was investigated and found not to need a fix at all |
| Global Constraint — no other files changed | File Structure table + Task 2 Step 6 | Covered — `watch/[id].vue` explicitly needs no change, verified by the final `git diff --stat` |
| Global Constraint — no redesign of the control set | Task 1 only adds `display: none` at narrow tiers and two targeting classes; no control's behavior, order, or icon changes | Covered |
| Verification — real-browser measurement at the full width sweep, seek bar never collapses, controls never unreachable | Task 2 | Covered — Step 3 sweeps 11 widths including the 480/481 and 560/561 boundaries, Step 4 hit-tests real clickability (not just visual presence), Step 5 re-confirms the four clean candidates rather than trusting the audit's own numbers forever |

No gap found. Every spec section maps to a task or to a recorded, evidence-backed "clean, not fixed" audit outcome.

**A note on how this sub-project differs from its two live-audited predecessors**: sub-projects 3 and 4 each found MORE bugs than their design specs anticipated. This one is the opposite — three of the four named candidates turned out to be false positives once measured with real content, and the one real bug (`.controls-row`) was flagged by the design spec as the most likely candidate and confirmed to be exactly that, at exactly the scale expected (zero existing coverage, the same shape already solved once in this app). This is itself a useful data point for this initiative: a candidate list produced by static reading is a hypothesis in both directions — it can undercount bugs (as sub-projects 3 and 4 found) or overcount them (as this one did) — and only live measurement settles which.

### 2. Placeholder scan

Searched for `TBD`, `TODO`, `implement later`, `fill in details`, `add appropriate error handling`, `add validation`, `handle edge cases`, `write tests for the above`, `similar to Task N`, and any step describing a change without showing it.

- Task 1's CSS and template steps show the full before-and-after block, including the two new media-query rules written out in full with their reasoning as a comment (matching this initiative's established practice of documenting *why* a breakpoint value was chosen, not just the value).
- Task 2's browser steps show complete JS snippets and exact pass conditions.
- The playlist-mode and subtitles-button gaps (Audit §1) are explicitly disclosed as unverified rather than silently assumed fixed or silently omitted — matching this initiative's established honesty precedent (e.g. sub-project 3's `MusicAlbumEditModal` gap).

### 3. Type and signature consistency

- Every selector used in Task 1 and Task 2's snippets was confirmed to exist in the current on-disk file at the stated lines: `.controls-row`/`.controls-left`/`.controls-right`/`.ctrl-btn` (`VideoPlayer.vue:86-207`, `:868-895`), the Rewind/Forward/Theater/Prev/Next buttons (`:96-121`, `:198`), `.volume-control` (`:126`), `.progress-bar-container` (`:782`), `.speed-btn` (`:151`), `.tech-grid` (`watch/[id].vue:1055`), `.tech-details-header` (`watch/[id].vue:127`), `.recommendation-card` (`watch/[id].vue:1248`), `.mini-player` (`watch/[id].vue:37, 1504`).
- The two new classes (`.skip-btn`, `.theater-btn`) are introduced in Task 1 Step 1 and consumed by Task 1 Step 2's media queries and Task 2's verification snippets — same names throughout.
- `.skip-btn` is deliberately shared by four buttons (Rewind, Forward, Prev, Next) rather than four separate classes, since all four are hidden together at the same tier — documented as intentional in Task 1 Step 1's own text, not an oversight.
- Test command is `npm test` → `vitest run`, matching every prior sub-project in this initiative.
- The dev-login CSRF flow is recorded once, in Task 2 Step 1, reusing the exact mechanism discovered and documented in the two prior live-audited sub-projects.
