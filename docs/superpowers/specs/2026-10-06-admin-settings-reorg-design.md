# Admin Settings Reorganisation + Unified Downloads Hub — Design

**Status:** Approved (design sections 1–4 approved in chat)

## Goal

Make the admin Settings area understandable at a glance: organise it by task instead of by media type, give the three media types (Videos, Music, Podcasts) one identical way to add and manage sources, merge the three download queues into one view, and write every admin string in plain English with one shared vocabulary.

This is sub-project 1+2 of a four-part usability effort (the user's request: "the layout is not clear, the three spaces don't look alike, the download queues are scattered, and the app mixes French and English"). Language decision: **English only**. Order chosen by the user: (1) admin settings, (2) downloads hub — this spec — then (3) consistent spaces (Video/Music/Podcasts navigation) and (4) a sweep of the remaining French/English strings. Sub-projects 3 and 4 are out of scope here.

## Context (verified in the code)

- `app/pages/settings.vue` (2180 lines, admin-only) has six tabs — `stats` (Dashboard), `downloads` (actually the **video** downloader), `music`, `podcasts`, `users`, `system` — via `allowedTabs` and `?tab=`. Each media tab mixes adding sources, scheduling, concurrency, SponsorBlock/clips and its own queue.
- `SettingsMusicTab.vue` and `SettingsPodcastsTab.vue` are near copies (search → pick → add form, followed list, queue). The video tab uses a different flow (search → "Track" → options modal with content types, start date, visibility, save path).
- Existing admin routes: per channel `PUT /api/admin/channels/[id]/options`, `POST …/pause`, `POST …/sync`, `PUT …/visibility`; per artist and per show `POST …/pause` and `POST …/sync` only (no visibility route). Queue routes: `/api/admin/downloader/queue` (capped at 100 + `queueTotal`), `/api/admin/music/queue`, `/api/admin/podcasts/queue` (both `LIMIT 100`, no total, silent truncation), `/api/admin/downloader/active-counts` (video/music/podcasts downloading+pending counts and `current`). Pause/resume, concurrency, schedule and retry-failed routes exist per type.
- Composables `useDownloadsQueue`, `useMusicQueue`, `usePodcastQueue` each hold their own state; `settings.vue` runs three pollers (500 ms while a download is active, else 3 s).
- `SettingsSystemTab.vue` already hosts Modules, "Affichage par défaut" (French), Engine Binaries, logs, Danger Zone, Search Platforms and a "Recherche" block (French).
- The "Suivre" one-click add (music/podcasts) and the active-counts endpoint were added on branch `fix/downloads-ux` (not yet merged when this spec was written); this work builds on them.

## Scope

**In scope:** the new tab structure; a reusable source-section component (Videos/Music/Podcasts) with Follow in one click; a unified Downloads tab; the System tab regrouped; the Overview "Activity" card; backward-compatible `?tab=` links; adding `queueTotal` to the music and podcast queue responses; English copy and a glossary for every admin screen; tests.

**Out of scope:** consistent navigation across the three spaces (sub-project 3); the English sweep of non-admin pages — account, channels, player, spaces (sub-project 4); changing how downloaders work; per-artist/per-show visibility editing (no route exists today); i18n infrastructure (the app is English only).

## Information architecture

Tabs (key → label): `overview` Overview, `library` Library, `downloads` Downloads, `users` Users, `system` System.

Backward compatibility for `?tab=`: `stats` → `overview`; `downloads` stays `downloads` (filter All); `music` → `library` with the Music section open; `podcasts` → `library` with the Podcasts section open; `users`, `system` unchanged. `settings.vue` normalises the query on load and when it changes. Existing callers (e.g. the empty-library action "Go to downloads", links to `?tab=music`) keep working unchanged.

### Overview
The current dashboard (`SettingsStatsTab`) with an **Activity** card on top: what is downloading right now (count per type, from `active-counts`), the total queued, and a link to Downloads. Strings translated and clarified.

### Library
One page, three sections in a fixed order — **Videos**, **Music**, **Podcasts** — each rendered by the same component (`LibrarySourceSection.vue`) driven by a small per-type configuration (labels, endpoints, how to read a search result, how to list followed sources). Each section contains, in this order:
1. Title and one plain sentence (e.g. "Follow YouTube channels. New videos are downloaded automatically.").
2. Search box or pasted URL/handle/feed, with results; each result has a **Follow** button that adds in one click, using the section's "Options for new follows". Re-entrancy guard and "keep results if the add fails, clear them after success" (the behaviour introduced for Suivre) apply to all three.
3. **Options for new follows** (collapsed disclosure): auto-sync on/off and visibility for all types; for Videos also content types (videos, shorts, lives), start date, save folder. These replace the per-channel "Track" modal. Defaults match today's defaults.
4. **Following** list: one row per source (channel, artist, show) with item count, sync state with a pause/resume switch (`…/pause`), a "Sync now" action (`…/sync`), visibility (editable for channels via `visibility.put`; read-only badge for artists/shows), and a link to its page. For channels, an "Edit options" action opens the existing options editor (`options.put`) so per-channel settings are changed after the fact. The Videos list is new here (previously only on the Channels page) and reads the existing channels API.
5. **Sync all** for the section (replaces "Sync All Channels" and the music/podcast equivalents).
Deep link: `?tab=library&section=music|podcasts|videos` scrolls to and expands that section.

### Downloads
- Three **type cards** (Videos, Music, Podcasts), identical in structure: state (Active/Paused), Pause/Resume, "Simultaneous downloads" with Save, and "N failed" with Retry when there are failures. Concurrency and pause use the existing per-type routes.
- A **filter** All / Videos / Music / Podcasts with a count per filter.
- One **queue list**. "All" shows every downloading item first (any type), then queued items (types interleaved in a stable order), then failed. Each card shows a type pill, title, source, progress, speed, ETA and actions (Prioritize for videos; Cancel). Statuses read **Queued**, **Downloading**, **Failed**.
- The list is capped at 100 items per view with the line "Showing the first 100 of N", using totals returned by the queue routes; the music and podcast queue routes gain `queueTotal` (same semantics as the video route: downloading + pending + failed).
- Per-type **Clear queue** stays in this tab; empty state reads "Nothing is downloading".
- One **Advanced** disclosure (collapsed): scheduled sync per type (cron presets), SponsorBlock categories (Videos), music clips toggle.
- One polling loop in this tab (500 ms while anything is downloading, else 3 s) replacing the three loops in `settings.vue`; the sidebar/dropdown counter keeps using `active-counts`. A badge with the total active count appears on the Downloads tab button.
- Unified rendering reuses one queue-card component for the three types (today there are three copies of the markup).

### Users
Unchanged behaviour; copy translated and clarified.

### System
Regrouped under short titles with one explanatory sentence each: **Modules**, **Default display** (was "Affichage par défaut"), **Search providers** (platforms plus the block currently titled "Recherche"), **Tools & logs** (engine binaries, worker output, ingestion logs — collapsed by default), **Danger zone** (collapsed, existing confirmations kept).

## Vocabulary (applies to every admin screen)

Follow / Following (not Track/Suivre), Library, Overview, Queued, Downloading, Failed, Sync, Sync now, Sync all, Paused/Active, Simultaneous downloads, Options for new follows, Advanced, Danger zone. Sentences are short, active, no jargon ("cron" appears only inside Advanced next to presets). All French strings in the admin screens are translated.

## Architecture notes

- New components under `app/components/settings/`: `LibrarySourceSection.vue` (generic), `LibraryTab.vue`, `DownloadsTab.vue` (replaces `SettingsDownloadsTab.vue`, the music/podcast tabs), `DownloadTypeCard.vue`, `DownloadQueueList.vue` / queue card, `OverviewActivityCard.vue`. The old `SettingsDownloadsTab`, `SettingsMusicTab` and `SettingsPodcastsTab` are removed once their content lives in the new components. `SettingsStatsTab` becomes the Overview body, `SettingsSystemTab` is regrouped, `SettingsUsersTab` keeps its place.
- A composable `useAllDownloads` aggregates the three existing composables' state (or their routes) and exposes the merged, ordered, capped list and totals; the three type composables stay as the data sources.
- No change to downloader behaviour or to existing route contracts except the additive `queueTotal` on the music and podcast queue routes.

## Error handling

- A failed Follow keeps the results so it can be retried (existing behaviour, now shared). Per-row actions (pause, sync, visibility) toast on failure and resync their switch from server state (the one-way-binding lesson from earlier sub-projects).
- A queue route failing (one type) shows that type's card in an error state and leaves the other types working.
- Unknown `?tab=` values fall back to `overview`.

## Testing

- Component tests (nuxt env, `$fetch` stubbed): `LibrarySourceSection` for each type (search, one-click Follow, no double add, results kept on failure and cleared on success, options respected, Following rows: pause/sync switch resync after failure); the Downloads tab (filter counts, ordering with downloading first across types, 100 cap + "Showing the first 100 of N", type card pause/concurrency calls, retry), the tab-query normalisation (`stats`, `music`, `podcasts`, unknown).
- Server tests: `queueTotal` on the music and podcast queue routes (counts all three statuses; list still capped at 100).
- A check that no French strings remain in the admin components (a simple test or script scanning those files for accented French words from a short list, to guard the English-only rule for this area).
- Real verification in Docker with the Browser pane (preset desktop for form interaction): follow a channel, an artist and a podcast from Library; see all three in Following; watch a mixed queue in Downloads with filters; legacy `?tab=` links; failed-save resync with `docker stop`.
