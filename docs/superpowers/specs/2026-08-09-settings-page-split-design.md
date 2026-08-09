# Settings Page Split — Design

## Context

Seventh sub-project of the ongoing "bug fixes" initiative — the last remaining backlog item from the original full-project audit's code-quality findings. `app/pages/settings.vue` is 4133 lines, mixing 5 distinct admin concerns (Dashboard/Stats, Downloads, Music, System, Users) in one file, both in template and script.

Confirmed by reading the full file directly (not assuming from the template's clean tab structure alone — the script turned out significantly more tangled than the template suggested):

- The template has 5 cleanly delimited `v-if="activeTab === '...'"` blocks — a clean split boundary on that side.
- The script does **not** cleanly mirror this: only 4 numbered section comments exist (`1. STATS TAB`, `2. DOWNLOADS TAB`, `3. CONFIGURATION TAB`, `4. USERS TAB`) — Music tab's state/functions are interleaved inside the "Downloads" numbered region with no separating comment, and had to be identified by reading the actual variable names (`music`-prefixed refs and functions inside that region).
- `channels`/`channelsData` (a `useFetch` call and its derived `computed`) is declared inside the "1. STATS TAB" section but is also consumed by the Users tab's per-user "full channel access" checkbox logic — a genuine cross-tab data dependency, not just organizational sloppiness.
- Two counters — `activeDownloadCount` and `musicActiveDownloadCount` — are computed from `queue`/`musicQueue` (declared in the Downloads/Music regions) but are rendered in the tab sidebar itself (the parent-level template, not inside any tab's own `v-if` block), for the numeric badges on the "Downloads" and "Music" tab buttons.
- Two polling loops (`runPolling` for the video queue, `runMusicPolling` for the music queue) are started once from a single root-level `onMounted` and run continuously for as long as the Settings page is open, **regardless of which tab is currently active** — `runPolling` always fetches; `runMusicPolling` only actually calls `fetchMusicQueue()` when `activeTab.value === 'music'`, but its own re-scheduling timer always runs. This is why the sidebar badges stay live even when viewing a different tab.
- An initial hypothesis during design exploration — that a single shared `requestAnimationFrame` loop smooths progress bars for both video and music downloads — was checked directly against the template and found to be **false**: the `smoothProgress`/`progressRates`/RAF logic (`updateSmoothProgress`) only reads `queue.value` (video) and is only referenced in the Downloads tab's template; the Music tab's template renders `track.download_progress` raw, with no smoothing at all. This significantly simplifies the split versus what was initially flagged.
- No other cross-tab data dependencies were found after reading the System (Configuration) and Users tab script regions in full — System is self-contained (video sync schedule + yt-dlp diagnostics), and Users only reaches outside its own region for the `channels` list noted above.

## Scope

- Split `app/pages/settings.vue` into 5 tab components plus 3 shared composables, with the parent page reduced to page structure, tab-switching, and the two cross-tab polling loops.

## Non-Goals

- No behavior changes — this is a pure structural refactor. Every existing feature, button, form, and polling/refresh cadence must work identically after the split.
- No changes to `app/pages/channels.vue` (explicitly out of scope for this sub-project, per user decision — deferred to a future sub-project given it lacks the same clean tab-boundary structure).
- No change to the `allowedTabs` array's pre-existing omission of `'music'` (confirmed during exploration: `?tab=music` in the URL doesn't restore that tab on reload today, since `'music'` isn't in `allowedTabs = ['stats', 'downloads', 'users', 'system']` — this is a real, separate pre-existing bug, not something this refactor should silently fix or silently preserve-as-a-feature; noting it explicitly as out of scope, to be raised as a possible future Minor fix, not bundled in here).
- No introduction of a state-management library (Pinia, etc.) — the split uses this codebase's existing `useState`-based composable pattern (already established by `useMusicPlayer()` and similar), not a new dependency.

## Design

### 1. New child components (one per existing tab)

- `app/components/settings/SettingsStatsTab.vue` — the Dashboard/Stats tab's template + script (stats fetch, `sortedChannels`, formatting helpers). Consumes `useAdminChannels()` for the channel list instead of its own local `useFetch`.
- `app/components/settings/SettingsDownloadsTab.vue` — the Downloads tab's template + script (channel search/ingest, queue actions, sponsorblock settings, default download directory, schedule form — everything currently in the "2. DOWNLOADS TAB" region that isn't music-prefixed). Consumes `useDownloadsQueue()` for `queue`/`smoothProgress`/`fetchQueue`.
- `app/components/settings/SettingsMusicTab.vue` — the Music tab's template + the music-prefixed state/functions currently interleaved in the "2. DOWNLOADS TAB" region (artist add/sync/pause, music schedule, music module/clips toggles). Consumes `useMusicQueue()`.
- `app/components/settings/SettingsSystemTab.vue` — the System/Configuration tab's template + script (video sync schedule, yt-dlp diagnostics/update) — self-contained, no shared composable needed.
- `app/components/settings/SettingsUsersTab.vue` — the Users tab's template + script (user list, add/edit/delete, password reset). Consumes `useAdminChannels()` for the per-user channel-access checkboxes.

Each child component owns only its own tab's UI state (refs like `syncingAll`, `ingestMessage`, form `reactive()` objects, etc.) — nothing here needs to be shared, confirmed by the exploration above finding no other cross-tab references.

### 2. New shared composables

- `app/composables/useDownloadsQueue.ts` — wraps `queue` (`useState`), `failedCount`, `isPaused`, `activeDownloadCount` (computed from `queue`), the `smoothProgress`/`progressRates` RAF-driven smoothing logic (moved in verbatim, including its `watch(() => queue.value, ...)` trigger), and `fetchQueue()`. Exposes a cleanup function (e.g. `stopSmoothProgressLoop()`) for the parent to call in its own `onUnmounted` — since `useState` composables are effectively singletons shared across whichever components call them, the RAF loop's lifecycle is tied to data (no active downloads → loop stops itself, matching today's behavior) rather than to any one component's mount/unmount, and only the page-level `onUnmounted` (leaving Settings entirely) needs to force-cancel it as a safety net.
- `app/composables/useMusicQueue.ts` — wraps `musicQueue` (`useState`), `musicFailedCount`, `musicIsPaused`, `musicActiveDownloadCount` (computed), and `fetchMusicQueue()`. No RAF/smoothing logic (confirmed not needed, per the corrected finding above).
- `app/composables/useAdminChannels.ts` — wraps the existing `channelsData`/`channels` `useFetch` call, so `SettingsStatsTab` and `SettingsUsersTab` share one fetch instead of each doing its own.

### 3. Parent `app/pages/settings.vue`

Retains: the page title, the tab sidebar (button list with `activeTab` switching, and the badge counts read from `useDownloadsQueue().activeDownloadCount`/`useMusicQueue().musicActiveDownloadCount`), `activeTab` state and its `route.query.tab` sync logic, `isAdmin`/`currentUser` gating and the `/account` redirect, and the two polling loops (`runPolling`/`runMusicPolling`, calling `fetchQueue()`/`fetchMusicQueue()` from the composables) started in `onMounted` and cleaned up in `onUnmounted` (including the `useDownloadsQueue()` RAF-loop cleanup call). The template becomes 5 `<SettingsXTab v-if="activeTab === 'x'" />` blocks instead of 5 inline `<div v-if="...">` sections.

## Error Handling

- No new error paths — every existing `try/catch`/toast-error pattern in each tab's handlers moves verbatim into its new component file.

## Verification

- This codebase has zero Vue component test infrastructure (accepted, project-wide gap) — verification is manual only: exercise every tab's every action (search/ingest a channel, pause/resume/retry downloads, add/sync/pause a music artist, edit sponsorblock settings, save schedules, run yt-dlp diagnostics, add/edit/delete a user) after the split and confirm identical behavior to before. Specifically verify the two behaviors that depend on the parent-level polling design: (1) the Downloads and Music tab sidebar badges update live even while viewing a different tab; (2) navigating away from Settings entirely (not just switching tabs) stops both polling loops and the progress-smoothing RAF loop (no console errors, no lingering network requests after leaving the page).
