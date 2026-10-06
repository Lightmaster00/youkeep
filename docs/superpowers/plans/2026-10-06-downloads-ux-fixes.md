# Downloads UX Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Fix four problems reported on a real Unraid install: music/podcast "Suivre" does not add anything, the video and music pipelines starve each other under a hidden shared cap, the sidebar download counter ignores music and podcasts, and the video queue sends/renders every pending item.

**Architecture:** Small, independent changes in the downloader modules, the two settings tab components, one new lightweight admin endpoint plus the layout badge, and a capped video queue response with a total. Branch: `fix/downloads-ux` (already checked out; never work on main).

**Tech Stack:** Nuxt 4, Nitro, better-sqlite3, Vue 3, Vitest (`server` and `component` projects).

## Global Constraints

- Evidence from live reproduction (Docker, real ingestion): with `max_concurrent_downloads` = 4–5 the video worker holds all 3 slots of `COMBINED_MAX_CONCURRENT_DOWNLOADS` and a pending music track stays pending indefinitely; at default 2 it works. Podcasts are NOT in the combined cap and already download in parallel.
- In the Music and Podcasts settings tabs, the search result button "Suivre" only fills the input (`selectMusicArtistCandidate` / `selectPodcastShowCandidate`); the user must then press "Add Artist" / "Add Podcast". The Video tab's "Track" opens a modal that finishes the add. Real users do not notice the second step.
- The sidebar badge (`app/layouts/default.vue`, the Settings link in the user dropdown) counts only the video queue and polls the full `/api/admin/downloader/queue` every 5 s.
- `/api/admin/downloader/queue` returns every pending video (3000 pending = 823 KB per response; the settings page polls it every 500 ms while downloads are active and renders one card per item).
- Server code imports shared code with relative paths; `getDb` is an ambient Nitro auto-import (never import it). Tests: `createTestDb` + `mockEvent` + `(globalThis as any).getDb = () => db`; component tests use `mountSuspended` with `$fetch` stubbed (see `tests/component/DisplayPrefsForm.test.ts`).
- Commit trailer (last line): `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Run the focused tests while iterating and the full `npx vitest run` + `npx nuxt build 2>&1 | tail -5` before each commit.

---

### Task 1: Remove the combined video+music concurrency cap

**Files:** Modify `server/utils/concurrency.ts`, `server/utils/downloader.ts` (~line 318), `server/utils/musicDownloader.ts` (~line 647, plus its import line 9), `tests/unit/concurrency.test.ts`. Also check `server/utils/podcastDownloader.ts` (a comment mentions the combined check, ~line 588) and fix the comment.

- [ ] Remove the `hasCapacityForCombinedDownloads(...)` blocks in the video and music worker loops (the per-pipeline `hasCapacityForMoreDownloads` checks stay; they already enforce each pipeline's own `max_concurrent_downloads` / `music_max_concurrent_downloads`). Remove `COMBINED_MAX_CONCURRENT_DOWNLOADS` and `hasCapacityForCombinedDownloads` from `concurrency.ts` and their imports/tests; update stale comments (e.g. "closing the cross-pipeline race window on the combined cap" in `downloader.ts`, the music equivalent, and the podcast comment).
- [ ] Also look at `server/utils/musicDownloader.ts` ~line 561 (`while (!hasCapacityForMoreDownloads(getActiveMusicDownloadCount(), maxConcurrent))`) and make sure nothing else references the other pipeline's active count (`getActiveDownloadCount` / `getActiveMusicDownloadCount` imports that become unused must be removed if no longer used).
- [ ] Test: in `tests/unit/concurrency.test.ts` delete the combined-cap tests; add nothing for the removed function. Add a unit test file `tests/unit/pipelineIndependence.test.ts` ONLY if a pure seam exists; otherwise rely on a code-level check: `grep -rn "COMBINED_MAX\|hasCapacityForCombined" server app tests` must return nothing.
- [ ] Run full suite + build; commit `fix: video and music downloads no longer share a hidden concurrency cap`.

### Task 2: "Suivre" adds directly (Music and Podcasts tabs)

**Files:** Modify `app/components/settings/SettingsPodcastsTab.vue` (`selectPodcastShowCandidate` ~line 341), `app/components/settings/SettingsMusicTab.vue` (`selectMusicArtistCandidate` ~line 376); Create `tests/component/SettingsIngestSuivre.test.ts`.

- [ ] `selectPodcastShowCandidate(show)`: if `show.feedUrl` is empty → `toast.error("Ce podcast n'a pas de flux RSS exploitable.")` and return. Otherwise set `podcastFeedInput.value = show.feedUrl`, clear `podcastShowSearchResults`, then `await handleAddPodcastShow()` (which already reads `podcastAutoSync` and `podcastShowVisibility`, shows the Adding… state, the success/error message, a toast, and refreshes the queue/shows). Make the handler `async`.
- [ ] `selectMusicArtistCandidate(channel)`: build the URL exactly as today; if empty → `toast.error("Impossible de déterminer l'adresse de cet artiste.")` and return; else set `musicArtistInput`, clear results, `await handleAddMusicArtist()`.
- [ ] Guard against double clicks: both handlers already disable their forms through `addingPodcastShow` / `addingMusicArtist`; make the "Suivre" buttons `:disabled` with the same flag so a second click while adding does nothing.
- [ ] Component tests (stub `$fetch` with `vi.stubGlobal`; check how the existing settings tab components get mounted — they may need `useToast`/composables that run in the nuxt env; use `mountSuspended`): clicking "Suivre" on a podcast result calls `POST /api/admin/podcasts/ingest` with `{ feedUrl, sync_status: 'downloading' }` exactly once without any further click; same for music with `/api/admin/music/ingest` and the URL built from handle/id; an empty feed URL calls no endpoint; the button is disabled while the request is pending. Mutation-check (restore the old "only fill the input" behaviour → tests fail).
- [ ] Run full suite + build; commit `fix: Suivre adds the podcast or artist immediately`.

### Task 3: Sidebar badge counts every download, via a lightweight endpoint

**Files:** Create `server/api/admin/downloader/active-counts.get.ts`, `tests/integration/active-counts.test.ts`; Modify `app/layouts/default.vue` (`fetchActiveDownloads`, ~lines 349-375, and the Settings badge ~line 95).

- [ ] Endpoint (`requireAdmin` first): returns `{ video: { downloading, pending }, music: { downloading, pending }, podcasts: { downloading, pending }, total, current: { kind: 'video'|'music'|'podcasts'|null, progress: number|null, speed: string|null } }` using `SELECT COUNT(*)` / `GROUP BY download_status` on `videos`, `music_tracks`, `podcast_episodes` (statuses `downloading` and `pending` only; `total` = sum of all six counts). `current` = the first `downloading` item looked up in order video → music → podcasts (`download_progress`, `download_speed`), else nulls. Wrap each table's query so a failure in one yields zeros for it (never 500).
- [ ] Layout: `fetchActiveDownloads` calls this endpoint instead of `/queue`; `activeDownloadCount` = `total`; `activeDownloadProgress`/`activeDownloadSpeed` from `current`. Keep the 5 s interval and the `isAdmin` guard. Do not change the template except if needed to show the combined count.
- [ ] Tests (integration, `createTestDb`): 401/403 for guest/non-admin; counts per table; `total`; `current` prefers video then music then podcasts; empty DB gives zeros and nulls. Mutation-check one count.
- [ ] Run full suite + build; commit `feat: sidebar download counter includes music and podcasts`.

### Task 4: Cap the video queue response and show the total

**Files:** Modify `server/api/admin/downloader/queue.get.ts`, `app/composables/useDownloadsQueue.ts`, `app/components/settings/SettingsDownloadsTab.vue`, `tests/integration/` (new `downloader-queue-limit.test.ts`).

- [ ] `queue.get.ts`: keep the existing ORDER BY (downloading first, then priority…) and add `LIMIT 100` (the music queue endpoint already does this). Add `queueTotal` (COUNT of rows with status in downloading/pending/failed) to the response; keep every other field (`history`, `isPaused`, `failedCount`) unchanged.
- [ ] `useDownloadsQueue.ts`: store `queueTotal` in `useState<number>('settings_downloads_queue_total', () => 0)` and expose it from `fetchQueue`; default to `queue.length` if the field is missing.
- [ ] `SettingsDownloadsTab.vue`: when `queueTotal > queue.length`, show a one-line notice under the queue header: `Affichage des {{ queue.length }} premiers téléchargements sur {{ queueTotal }}.` Keep "Clear Queue" visible when `queueTotal > 0` (it previously used `queue.length > 0`).
- [ ] Tests: with 150 pending + 2 downloading videos the response has 100 items, the 2 downloading ones first, `queueTotal` = 152; with 3 items `queueTotal` = 3; failed items are counted. Mutation-check the LIMIT.
- [ ] Run full suite + build; commit `perf: cap the video queue response at 100 items and report the total`.

### Task 5: Real verification (controller)

- [ ] Docker + Browser pane (preset desktop for form interactions; login by fetch is acceptable): (a) Podcasts tab: search "Planet Money" → one click on "Suivre" → show appears in "Followed Podcasts" and episodes download; Music tab the same with an artist; (b) set video max concurrency to 5 and confirm a music track downloads at the same time as videos; (c) with a large seeded pending queue, the downloads tab renders at most 100 cards and shows the total notice; (d) open the account dropdown and confirm the Settings badge counts music/podcast items.
- [ ] Clean up Docker; record in `.superpowers/sdd/progress.md`.
