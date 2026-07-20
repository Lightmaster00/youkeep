# UI Redesign Round 2 — Navigation, Palette, Video Cards & Homepage Discovery

## Context

The previous UI modernization pass (2026-07-20) built shared design tokens and primitive components (`UiButton`, `UiBadge`, `UiCard`, `UiSkeleton`), extracted and enhanced `VideoPlayer.vue`, and applied the "calm depth-glass" signature style (neutral at rest, soft violet glow only on hover, no idle animation) across the app. It was reviewed and merged, but the user's reaction was that the app still "looks the same" — same menus, same cards, same color that "feels a bit off." That earlier pass was structurally significant (shared components, extracted player) but perceptually subtle: it changed *how things are built*, not *how the app is laid out or how it feels to browse*.

This round targets perception directly: a restructured global navigation, a refined color identity, a redesigned video card with a hover video preview, and a homepage that surfaces actual content (recently added, popular, personalized suggestions) instead of the current single-hero-plus-generic-channel-rows layout.

A related but independent request — cutting sponsor/self-promo/outro segments during download (via yt-dlp's SponsorBlock integration) and extracting video chapters for the player timeline — is explicitly **out of scope** for this spec. It's a downloader/backend feature, not a UI redesign concern, and will get its own brainstorm/spec after this one ships.

## Also Fixed (already committed, bundled with this work)

`app/middleware/auth.global.ts`'s `publicRoutes` list included `/`, `/channels`, `/categories`, `/watch/*` but not `/shorts`, so an anonymous visitor could browse the home feed but was redirected to `/login` when opening Shorts. `/shorts` has been added to `publicRoutes` — Shorts is now public browsing like every other content page, consistent with the rest of the app. (No design decision needed here; it was an inconsistency, not a choice.)

## 1. Global Navigation — Icon Rail

**Current:** fixed-width (`--sidebar-width`) sidebar, always showing icon + label, collapses to icon-only under 768px.

**New:** the sidebar becomes a permanent icon-only rail at all viewport widths above mobile:
- Collapsed width: reuse the existing `--sidebar-collapsed-width` token as the rail's resting width (currently only used at the 768px breakpoint — it becomes the default, not a breakpoint override).
- On hover (of the rail as a whole, not per-link), the rail expands to its current full `--sidebar-width` and shows labels, as an **overlay** (increased z-index, opaque/glass background) rather than pushing `.content-area` — so hovering the rail never reflows the page. The existing `.sidebar-link` hover/active treatment (background, `translateX(4px)`) is preserved inside the expanded state.
- Below 768px, keep the current mobile treatment (icon-only, bottom-anchored active indicator) — the rail's resting state already matches it, so the existing mobile media query mostly collapses into the new default; only the `.sidebar-link span` / label visibility behavior changes (hidden at rest everywhere now, not just on mobile).
- No change to which links exist (Home, Shorts, Channels, Subscriptions, Playlists) or their routes/icons — this is a layout change, not an IA change.

## 2. Visual Identity — Palette Refinement

Keep the violet (`--accent-primary: #8b5cf6`) / pink (`--accent-secondary: #ec4899`) accent pair. The problem isn't the accent — it's that the base surface (`--bg-base: #0a0a0f`, a neutral cosmic-void gray-black) shares no undertone with the accent, so the accent reads as pasted on top rather than part of the same palette.

Changes to `app/assets/css/main.css` tokens:
- `--bg-base`: `#0a0a0f` → `#0c0a12` (a near-black with a faint violet undertone, not a visible color shift on its own).
- Add a fixed, non-animated background wash behind the app shell: two large radial gradients — `radial-gradient(ellipse 120% 80% at 30% -10%, rgba(139, 92, 246, 0.12), transparent)` and `radial-gradient(ellipse 100% 60% at 100% 100%, rgba(236, 72, 153, 0.06), transparent)` — composited under `--bg-base`. Static (no keyframe animation, no scroll-linked motion) — consistent with the existing "calm" principle that nothing moves without user interaction.
- `--bg-surface` and related surface tokens shift from neutral gray glass (`rgba(22, 22, 30, ...)`) to a violet-tinted glass (`rgba(28, 24, 38, ...)`), and `--border-color` shifts from neutral white-alpha to a faint violet-alpha (`rgba(167, 139, 250, 0.12)` in place of `rgba(255, 255, 255, 0.08)`).
- `--text-secondary` shifts from neutral slate (`#94a3b8`) to a warmer violet-gray (`#a5a3b8` at rest, `#c4b5fd`/`#e9d5ff` for secondary text specifically inside video cards per section 3 — see below for why cards get their own tuned values rather than reusing the global secondary token directly).

This is a token-level change, so it should propagate through every component built on the token system (Tasks 1-17 primitives, `UiCard`, `VideoPlayer`, etc.) without per-component edits, the same way the original token system was designed to work.

## 3. Video Card Redesign (`VideoCard.vue`)

**Layout** (replaces the current avatar-in-its-own-column-next-to-title layout):
- Thumbnail: unchanged aspect ratio and duration badge treatment.
- Title: full width, directly under the thumbnail, up to 2 lines (unchanged truncation behavior).
- Below the title: a single row — 32px circular channel avatar on the left, next to a two-line text stack (channel name, then `views · relative date`). This replaces the current side-by-side avatar-next-to-title arrangement; the avatar is no longer vertically centered against the title, it's aligned with the channel/metadata line specifically.
- Confirmed sizing (validated in the visual companion): avatar 32px; title 14.5px/600; channel name 13px, color `#c4b5fd`; metadata line 12px, color `#8a87a0`. On hover, channel name brightens to `#e9d5ff` and metadata to `#a5a3b8` (matching the existing pattern of text brightening on card hover).

**Hover video preview:**
- After ~500-600ms of continuous hover (not on quick mouse-past), the thumbnail `<img>` is replaced by a `<video>` element, muted, looping over a fixed excerpt of the file — from 10% to 40% of the video's duration (seeked via `currentTime`, not a separate encoded clip).
- Source: `video.local_video_path` directly — the same field `VideoPlayer.vue` already uses for playback, so no new streaming/token infrastructure is needed for the common case (videos browsed while logged in). If a card is ever rendered in a context that requires the same `?token=` querystring `VideoPlayer.vue` uses for shared/public links, thread it through the same way.
- Visual affordance during preview: a small "APERÇU" badge (top-left) and a thin progress bar (bottom edge of the thumbnail, using the accent gradient) showing position within the 10%-40% excerpt window.
- Concurrency: only one card plays a preview at a time across the page. When a new card starts its hover timer and fires, any other card's active preview is stopped and reverted to its static thumbnail first.
- Cleanup: on `mouseleave` (even before the preview started, to cancel a pending timer) the video element is torn down and the thumbnail `<img>` is restored — no lingering decoded video element for cards the user has moved past.
- This is a genuinely new interactive behavior (not just a visual restyle), so it needs its own manual verification pass: confirm no runaway memory/decoder growth when hovering quickly across many cards in a long grid, and confirm it behaves inside horizontally-scrolling rows (section 5) as well as static grids.

## 4. Homepage Restructure (`app/pages/index.vue`)

**Current state (important — this already exists and is closer to the target than other pages were):** `index.vue` already renders a "Netflix-style" feed: a single hero video banner (the most-recent video by `upload_date`), a "Recently Added" horizontal-scroll row (next 10 videos), and per-channel horizontal-scroll rows (any channel with 2+ videos in the fetched pool, sorted by video count) — all client-side computed from one `/api/videos?limit=60` fetch. It also already has **the exact "duplicate modules" problem** flagged during design review: `recentVideos` (indices 1-10) and `channelGroups` (built from `allVideos.slice(1)`, i.e. indices 1-onward) overlap, so a video can legitimately appear in both the "Recently Added" row and its channel's row below it today, in production.

**New structure:**

1. **Featured block (bento)**, replacing the single hero banner: one large tile (the most popular video — see "Popularity" below) plus up to 4 smaller tiles (a mix of: most-recently-added channel, most-recently-added video(s), and — logged in only — one personalized suggestion). Exact tile-content selection logic is an implementation detail to work out against real data shape, not a fixed formula; the binding constraint is "1 large + up to 4 small, drawn from popular/recent/suggested pools."
2. **Ajoutés récemment** — horizontal-scroll row, videos sorted by `videos.created_at DESC` (archive date — when it was downloaded into YouKeep), **not** `upload_date` (original YouTube upload date, which is what the current default homepage sort uses). This is a deliberate correction: "recently added" should mean recently archived, not recently uploaded to YouTube — a channel's whole backlog getting downloaded at once shouldn't flood this row with years-old videos.
3. **Populaires** — horizontal-scroll row. Primary sort: local popularity, computed as `COUNT(DISTINCT user_id)` from `user_history` per video (no new table or tracked column needed — this data already exists from `POST /api/videos/track`). Fallback/blend: when local view data is too sparse (e.g. an instance with few users or a freshly-downloaded video with no local plays yet) fall back to YouTube's own `videos.view_count` so the row isn't empty or meaningless on a lightly-used instance. Exact sparsity threshold and blend formula are an implementation detail.
4. **Suggéré pour toi** — horizontal-scroll row, **logged-in only**. Reuses the scoring approach already implemented in `server/api/videos/recommend.get.ts` (channel-affinity from watch time, penalizing already-watched videos), currently hardcoded to `is_short = 1`. Generalize it to also serve long-form video suggestions for this row (the Shorts page keeps using it filtered to shorts as it does today).
5. **Par chaîne suivie** — horizontal-scroll row(s), **logged-in only**, one row per subscribed channel (`user_subscriptions`) that has enough videos to justify a row. This **replaces** the current "any channel with 2+ videos in the pool" generic grouping — the generic version wasn't part of what was designed here and conflated "channels YouKeep happens to have a lot of videos from" with "channels you actually follow." If a logged-in user has no subscriptions, this section simply doesn't render (same as the anonymous case below), rather than falling back to the generic grouping.

**No duplicate content:** every video (and, where relevant, channel) selected for the featured block is excluded from every row below it. Rows don't need to be mutually exclusive from *each other* beyond that — the constraint from design review was specifically "nothing appears twice on the page," anchored on the featured block since that's the most prominent placement.

**Anonymous (logged-out) visitors:** since `/` is (and remains) a public route, but "Suggéré pour toi" and "Par chaîne suivie" both require a session, anonymous visitors see only the featured block, "Ajoutés récemment," and "Populaires." The other two rows are omitted entirely (no empty section, no login prompt placeholder) — confirmed as the preferred behavior over showing a generic non-personalized "suggestions" row in their place.

**Search mode is unaffected.** The existing `v-else-if="searchQuery"` branch (channel pills + paginated video grid) is a separate code path from the feed and isn't part of this redesign — the new featured-block-plus-rows structure only replaces the current `v-else` "Netflix-style" branch.

## Non-Goals / Deferred

- Sponsor-segment cutting (`--sponsorblock-remove` at download time) and chapter extraction/timeline display — separate project, own spec, starts after this one ships.
- Any change to the search-results view of the homepage.
- Any change to which pages exist or what the sidebar links to (icons/routes/labels are unchanged — only the rail's presentation changes).

## Verification

No automated UI test suite exists for this project (unchanged from the previous round) — `npm test`'s 23 tests are a safety net for non-UI logic, not a substitute for manual verification. Each task will need browser verification, same as the previous round, with particular attention to:
- The hover-preview video element lifecycle (section 3) — this is new runtime behavior, not just CSS, and the one piece of this spec with real risk of a bug (leaked video elements, multiple concurrent previews, previews not cancelling on fast mouse movement).
- Anonymous vs. logged-in homepage rendering (section 4) — needs checking both as a logged-out visitor and a logged-in user with and without subscriptions.
- The rail's hover-expand overlay (section 1) not reflowing `.content-area` on any page.
