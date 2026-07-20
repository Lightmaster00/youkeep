# UI Modernization & Video Player Redesign

## Goal

Make the YouKeep interface feel more modern and fluid, and redesign the video player to be more practical and elegant, while keeping the existing violet/pink "You|Keep" brand identity and dark theme.

## Approach

Extend the existing design-token system (`app/assets/css/main.css`) rather than replacing it, introduce a small set of shared presentational components (`app/components/ui/`), and extract the video player's logic into its own component. Apply the result to pages in independent, verifiable waves rather than a single large rewrite — the project has no UI test coverage, so each wave is manually verified in the browser before moving to the next.

Rejected alternatives:
- **Page-by-page polish with no shared components**: faster short-term but leaves every page duplicating its own card/button styles, so consistency erodes again over time.
- **Full architectural rewrite** (breaking up the large page files into sub-components as part of this pass): higher risk and effort than the ask requires; not pursued.

## 1. Design tokens (`app/assets/css/main.css`)

Additive only — nothing existing changes meaning, so no page can regress just from this section landing.

- **Spacing scale**: `--space-1` (4px) through `--space-8` (64px), replacing hardcoded pixel values as pages are migrated.
- **Motion tokens**: `--ease-standard` (a single cubic-bezier used consistently instead of the handful of slightly different curves currently scattered across files), `--duration-fast` (120ms), `--duration-base` (200ms), `--duration-slow` (350ms).
- **Page transitions**: a light fade on Nuxt route transitions (`<NuxtPage>` transition prop), and a small staggered fade-in for cards when a list first renders (video grids, channel grids, playlist grids).

## 2. Shared UI components (`app/components/ui/`)

Pure presentation, no business logic — pages keep their existing data-fetching and API calls, only the rendered markup changes to use these.

- **`UiButton.vue`** — wraps the existing `.btn` / `.btn-primary` / `.btn-secondary` / `.btn-danger` classes behind a component with `variant`, `size`, and a new `loading` prop (inline spinner) — most async actions across the app currently give no in-flight feedback.
- **`UiBadge.vue`** — unifies the various one-off badge styles (`PUBLIC`, role badges, download-status badges) behind one component with a `tone` prop.
- **`UiCard.vue`** — wraps `.glass-panel` / `.premium-card` with the signature depth-glass treatment (below) for video/channel/playlist/user cards.
- **`UiSkeleton.vue`** — animated pulse placeholders to replace bare centered spinners while lists load.

### Signature visual treatment — "calm depth glass"

Validated through mockup comparison (see Design Process below). This is the one deliberate visual signature of the redesign — everything else stays understated so this reads as intentional rather than decorative:

- **At rest**: fully neutral, no color. Background `rgba(20,20,28,0.7)`, border `1px solid rgba(255,255,255,0.06)`, shadow `0 8px 18px rgba(0,0,0,0.35)`.
- **On hover/focus**: the shadow gains a soft violet glow underneath — `0 10px 22px rgba(0,0,0,0.35), 0 4px 16px -4px rgba(139,92,246,0.15)` — over a `.3s ease` transition.
- **No idle animation.** Nothing pulses, breathes, or moves on its own; the card only reacts to actual interaction. This was a deliberate choice after trying — and rejecting — animated/ambient glow variants (too showy for a "sober futuristic" feel).
- Applied consistently to `UiCard.vue`, the secondary `UiButton.vue` variant, and active nav items, so it reads as one signature rather than a one-off card effect.

### Design process (for context, not itself a requirement)

Explored via the brainstorming visual companion: started from an open "organic" prompt, which the user redirected toward "glassmorphism but sober, futuristic" instead of literal organic motion (blobs, spring physics, cursor-follow light). Compared three glass directions (refined liquid glass, permanent gradient edge, depth glow), then iterated the winning "depth glow" direction from a strong animated version down to the fully static hover-only treatment above, which is the one that stuck.

## 3. Video player (`app/components/VideoPlayer.vue`)

- **Extraction**: move the existing player logic (playback state, scrubbing, keyboard shortcuts, fullscreen, speed, subtitles — currently ~500 lines inside `app/pages/watch/[id].vue`) into a standalone component with a small prop-based API (`video`, `subtitles`, playlist navigation callbacks). Behavior must not change during this step — it's a relocation, not a rewrite. Manually verify after extraction: play/pause, seek (click + drag), keyboard shortcuts, fullscreen, speed change, subtitle selection, playlist prev/next, buffering indicator.
- **Visual refresh**: apply the new spacing/motion tokens to the controls bar (better button spacing, thicker progress bar on hover, higher-contrast controls), keeping the existing hover time-preview tooltip and big-play/buffering overlays.
- **Theater mode**: new toggle that widens the player and dims the rest of the page (distinct from OS fullscreen), state kept for the session.
- **Floating mini-player**: scrolling away from the player while a video is playing shrinks it into a fixed corner mini-player with play/pause, progress, and close; clicking it scrolls back to the full player. Fixed position for v1 (not draggable).

## 4. Rollout waves

Each wave is independently completed, manually verified in a running dev server, shown to the user, and committed before the next begins:

1. **Foundations** — tokens (§1) + the four `Ui*` components (§2). No existing page is touched, so this carries no visible regression risk.
2. **Video player** — extraction + visual refresh + theater mode + mini-player (§3), scoped to `watch/[id].vue`.
3. **High-traffic pages** — Home (`index.vue`), Channels (`channels.vue`), Playlists: migrate to tokens/components, add list stagger-in animation.
4. **Secondary pages** — Account, Settings/Admin, Subscriptions, Shorts.

## Verification

No automated UI tests exist. For each wave: run the dev server, drive the affected pages/interactions directly in the browser, and compare against current behavior before/after. The existing Vitest suite (`tests/`) is unaffected since it covers server-side access control and rate limiting, not UI — it's re-run after each wave only as a safety net for any accidental server-side touches, not as UI verification.

## Out of scope

- Light mode / alternate color palette (brand stays violet/pink + dark)
- Breaking up large page files into sub-components beyond what the video player extraction requires
- Draggable/repositionable mini-player, picture-in-picture via the browser API
- Automated UI/visual regression tests
