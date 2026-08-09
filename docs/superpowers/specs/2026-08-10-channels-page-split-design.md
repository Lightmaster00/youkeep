# Channels Page Split — Design

## Context

Eighth sub-project of the ongoing "bug fixes" initiative — the last remaining large-file backlog item from the original full-project audit's code-quality findings (`settings.vue`, the other flagged file, was split in sub-project 7). `app/pages/channels.vue` is 2802 lines (684 template, ~806 script, ~1308 style).

Confirmed by reading the full file directly:

- Unlike `settings.vue`, this file does **not** have a clean tab-boundary structure. The template has two mutually exclusive top-level views selected by `route.query.channelId`: a small (~70 line) channel directory/grid view, and a much larger single-channel detail view (banner, profile header, stats, an internal 3-way sub-tab system for Archived Videos / Shorts / Playlists rendered with `v-show` — not `v-if` — plus an admin settings drawer positioned as a page-level sibling).
- The "Archived Videos" and "Shorts" sub-tabs are ~95% identical template (diffed directly): they differ only in which stat count they read, placeholder text, sort-option list (Videos has a duration sort, Shorts doesn't), empty-state copy, the list source computed, a CSS class name, and a "Short" badge overlay.
- The "Archived Videos" and "Shorts" sub-tabs currently share the exact same `videoSearchQuery`/`sortBy` refs — typing in one tab's search box currently also filters what the other tab would show, and since both tabs are always mounted (`v-show`), switching tabs never resets either.
- A significant amount of dead code was found and confirmed via grep (zero template references): a previously-removed "Download Queue" tab left behind `queuedVideos`, `smoothProgress`/`progressRates` plus their `requestAnimationFrame` smoothing loop, batch video selection (`selectedVideoIds`, `toggleSelection`, `isAllFilteredSelected`, `toggleSelectAllFiltered`), `handleBatchAction`, `handlePrioritizeTask`, `cancelTask`, `handleDownloadAll`, and the global downloader pause/resume + sync-all machinery (`isSyncingAll`, `checkSyncAllStatus`, `handleSyncAll`, `isDownloaderPaused`, `checkDownloaderPausedStatus`, `handleToggleDownloaderPause`). The last two (`checkSyncAllStatus`/`checkDownloaderPausedStatus`) are called from the page's `runPolling()` loop every 1-3 seconds for admins, making two HTTP requests whose results are never rendered anywhere. Also dead: a handful of isolated helper functions (`formatDuration`, `formatViews`, `handleThumbnailError`, `parseETAToSeconds`, `playVideo`).
- `channels`/`channelsData`/`refreshChannels` (the directory's channel list) is also consumed by several detail-view action handlers (pause/resume/delete) to refresh the list after a mutation — the same kind of genuine cross-view data dependency `useAdminChannels()` served in the settings.vue split.
- `channel`/`channelId`/`channelVideos`/`refreshSingleChannel`/`refreshVideos` (the selected channel's own data) is read broadly: by the header, the stats panel, the settings drawer, and both video-grid instances (for their empty-state copy, which depends on whether the channel has been synced at all).

## Scope

- Split `app/pages/channels.vue` into 6 components plus 3 shared composables, with the parent page reduced to routing/view-switching and the polling loop.
- Remove the confirmed dead code as part of this refactor (explicit user decision: optimize for the cleanest long-term result, not a byte-for-byte-preserving move).

## Non-Goals

- No changes to any file outside `app/pages/channels.vue` and its new split-off files (e.g. no changes to `app/pages/settings.vue`, no changes to backend endpoints).
- No new features — every remaining (non-dead) button, form, and polling cadence must work identically after the split.
- No introduction of a state-management library — uses this codebase's existing `useState`-based composable pattern (established by `useMusicPlayer()`, and by `useDownloadsQueue()`/`useMusicQueue()`/`useAdminChannels()` from the settings.vue split).
- This spec covers only the channels.vue split. A separate, broader project-wide audit (files, dead code, duplication, other optimization opportunities beyond channels.vue) is a distinct next step, out of scope here.

## Design

### 1. New composables (`app/composables/`)

- `useChannelsList.ts` — wraps `useFetch('/api/channels')`, exposing `channels` (computed list) and `refreshChannels`. Consumed by `ChannelDirectoryView` and by any detail-view handler that mutates a channel (pause/resume/delete) and needs the directory list to reflect it afterward.
- `useChannelDetail.ts` — wraps the selected channel's `useFetch` calls: `channelId` (synced from `route.query.channelId`, including the existing guard that only updates it while still on `/channels` to avoid a navigation-transition flash), `channel`, `singleChannelData`, `channelVideos`, `refreshSingleChannel`, `refreshVideos`. Consumed by the header, stats panel, settings drawer, and both video-grid instances.
- `useChannelVideoFilters.ts` — wraps `videoSearchQuery` and `sortBy` as shared `useState`. Consumed by both `ChannelVideoGrid` instances so search/sort stay synchronized between the Videos and Shorts tabs, exactly matching today's behavior.

### 2. New components (`app/components/channels/`)

- `ChannelDirectoryView.vue` — the channel grid (loading skeletons, empty state, channel cards). Consumes `useChannelsList()`.
- `ChannelDetailHeader.vue` — banner, avatar, title, sync/visibility badges, description, and the subscribe / tracking-options-drawer-trigger / sync-toggle buttons. Consumes `useChannelDetail()` for `channel`/`channelId`, plus its own local state for `subscribed` and the subscribe/sync-toggle handlers. Emits an event (or takes a `v-model`) to let the parent control `showDrawer`, since the drawer is a page-level sibling triggered from here.
- `ChannelStatsPanel.vue` — the stats row plus the archive-targets-summary panel (always shown together, purely derived from `singleChannelData.stats`, no owned state). Consumes `useChannelDetail()`.
- `ChannelVideoGrid.vue` — replaces both the Videos and Shorts tab blocks with one component taking a `variant: 'videos' | 'shorts'` prop, driving the small set of differences (stat count read, placeholder text, sort options, empty-state copy, list source, CSS class, Short badge). Consumes `useChannelDetail()` (for `channelVideos`/empty-state logic) and `useChannelVideoFilters()` (for the shared search/sort). Keeps the existing admin thumbnail-overlay actions (share link, visibility select, delete) as local handlers.
- `ChannelPlaylistsTab.vue` — the playlists list-or-detail block, already self-contained today (its own `selectedPlaylistId`/`selectedPlaylistData`/`syncingPlaylists`/`loadingPlaylistDetail` state and `openPlaylist`/`closePlaylist`/`handleSyncPlaylists` handlers move here verbatim). Consumes `useChannelDetail()` for `channelId`.
- `ChannelSettingsDrawer.vue` — the admin preferences drawer (visibility select, download-preferences form, delete-channel button) plus the backdrop. Consumes `useChannelDetail()` for `channel`/`channelId`/`refreshSingleChannel`, and `useChannelsList()`'s `refreshChannels` for the post-delete list refresh. Takes `showDrawer` as a prop/`v-model` from the parent (toggled open by `ChannelDetailHeader`, closed by itself or the backdrop).

### 3. Parent `app/pages/channels.vue`

Retains: the top-level `v-if="channelId && channel"` switch between the detail view (assembling the 5 detail-related components: header, stats panel, tab bar with the 3 sub-tabs, settings drawer) and `ChannelDirectoryView`; the `activeTab` state for the 3-way sub-tab bar (stays at parent level since it's page-level UI state, not owned by any one child); and the polling loop (`runPolling`, cleaned of the dead `checkSyncAllStatus`/`checkDownloaderPausedStatus` calls — it will call only `refreshVideos()`/`refreshSingleChannel()` going forward, same cadence logic as today).

## Error Handling

No new error paths — every existing `try/catch`/toast-error pattern moves verbatim into its new file. Dead handlers (which had their own try/catch blocks) are deleted along with their dead call sites, not preserved.

## Verification

Zero Vue component test infrastructure exists in this codebase (project-wide, accepted gap) — verification is manual only, via the dev-login fixture (`server/api/dev/login.post.ts`). Specifically verify: switching between the channel directory and a channel's detail view; all 3 sub-tabs (Archived Videos, Shorts, Playlists including list→detail→back); that typing in the Videos tab's search box also filters the Shorts tab's results (and vice versa) exactly as before; opening/editing/saving/closing the settings drawer, including the backdrop-click-to-close; subscribe/unsubscribe; sync pause/resume from both the header button and (implicitly, via the same handler) the empty-state "Start initial sync" action; deleting a video and deleting a channel; and confirming via the network tab that the two previously-wasted `sync-all-status`/downloader-`queue`-status polling requests no longer fire.
