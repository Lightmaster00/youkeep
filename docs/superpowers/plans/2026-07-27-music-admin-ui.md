# Music Admin Ingestion UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin add music artists, monitor/control the music download queue, and trigger per-artist syncs and per-track cancels from the UI — none of this exists yet even though the backend (sub-project 2) and file-serving (sub-project 3a) are done.

**Architecture:** Two new read endpoints under `server/api/admin/music/` (a queue/artists listing, and concurrency get/set), both byte-for-byte mirrors of their existing video-pipeline equivalents retargeted at the music schema. A new "Music" tab in `app/pages/settings.vue`, built in the same Composition API style as the existing "Downloads" tab, reusing its CSS classes so the two tabs look like one consistent system rather than two different UI languages.

**Tech Stack:** Nitro server routes (H3), better-sqlite3, Vue 3 Composition API (single large existing `.vue` file, no new components).

## Global Constraints

- Visibility is always one of exactly `public`/`private`/`ultra_private`, presented as a fixed `<select>` — never a free-text field (per sub-project 3a's finding: `canAccessMusicTrack` fails closed on an unrecognized value, but the ingest endpoint itself still doesn't validate it, so the UI is the only current guardrail).
- Artist avatars are hotlinked YouTube CDN URLs (`music_artists.avatar_url`) — `<img>` them directly, never route them through `/downloads-music/`.
- No bulk "retry all failed"/"clear queue" actions, no channel-name search flow, no catalog/browsing UI, no playback — all explicitly out of scope (see spec Non-Goals).
- `npx vue-tsc --noEmit -p .` is a silent no-op in this repo (solution-style tsconfig) — always type-check with `npx vue-tsc -b --noEmit`.

---

### Task 1: `GET /api/admin/music/queue`

**Files:**
- Create: `server/api/admin/music/queue.get.ts`

**Interfaces:**
- Consumes: `requireAdmin`, `getDb` (Nuxt server auto-imports, no explicit import needed).
- Produces: `GET /api/admin/music/queue` → `{ queue: Array<{id, title, download_status, download_progress, download_speed, download_eta, last_error, artist_name}>, history: Array<{id, title, created_at, artist_name}>, artists: Array<{id, name, avatar_url, sync_status, visibility, track_count}>, isPaused: boolean, failedCount: number }`. Consumed by Task 3's `fetchMusicQueue`.

Mirrors `server/api/admin/downloader/queue.get.ts`, with the `ORDER BY` clause simplified since `music_tracks` has no `priority`/`is_short` columns, and a new `artists` array added (no video-pipeline equivalent — the video "Downloads" tab has a separate channels page; this sub-project isn't building one for music, so the artist list lives here instead).

- [ ] **Step 1: Write the endpoint**

Create `server/api/admin/music/queue.get.ts`:

```typescript
import { defineEventHandler } from 'h3';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const db = getDb();

  const queue = db.prepare(`
    SELECT 
      t.id, 
      t.title, 
      t.download_status, 
      t.download_progress, 
      t.download_speed, 
      t.download_eta,
      t.last_error,
      a.name as artist_name
    FROM music_tracks t
    JOIN music_artists a ON t.artist_id = a.id
    WHERE t.download_status IN ('downloading', 'pending', 'failed')
    ORDER BY 
      CASE t.download_status
        WHEN 'downloading' THEN 1
        ELSE 2
      END,
      CASE WHEN t.download_progress > 0 THEN 0 ELSE 1 END,
      t.created_at ASC
  `).all();

  const history = db.prepare(`
    SELECT 
      t.id, 
      t.title, 
      t.created_at,
      a.name as artist_name
    FROM music_tracks t
    JOIN music_artists a ON t.artist_id = a.id
    WHERE t.download_status = 'completed'
    ORDER BY t.created_at DESC
    LIMIT 10
  `).all();

  const artists = db.prepare(`
    SELECT 
      a.id,
      a.name,
      a.avatar_url,
      a.sync_status,
      a.visibility,
      COUNT(t.id) as track_count
    FROM music_artists a
    LEFT JOIN music_tracks t ON t.artist_id = a.id
    GROUP BY a.id
    ORDER BY a.name ASC
  `).all();

  const pausedSetting = db.prepare("SELECT value FROM settings WHERE key = 'music_downloader_paused'").get() as { value: string } | undefined;
  const isPaused = pausedSetting ? pausedSetting.value === '1' : false;

  const failedRow = db.prepare(`SELECT COUNT(*) as count FROM music_tracks WHERE download_status = 'failed'`).get() as { count: number };
  const failedCount = failedRow?.count || 0;

  return { queue, history, artists, isPaused, failedCount };
});
```

- [ ] **Step 2: Type-check**

Run: `npx vue-tsc -b --noEmit`
Expected: only the 3 pre-existing, unrelated `.vue` file errors (`VideoPlayer.vue`, `default.vue`, `subscriptions.vue`) that predate this work — nothing new.

- [ ] **Step 3: Commit**

```bash
git add server/api/admin/music/queue.get.ts
git commit -m "feat: add GET endpoint for the music queue, history, and artists list"
```

---

### Task 2: Music concurrency endpoints

**Files:**
- Create: `server/api/admin/music/concurrency.get.ts`
- Create: `server/api/admin/music/concurrency.post.ts`

**Interfaces:**
- Consumes: `parseMaxConcurrentDownloads`, `isValidMaxConcurrentValue` from `server/utils/concurrency.ts` (already generic, built in the concurrent-downloads sub-project — no changes needed there); `requireAdmin`, `getDb` (auto-imports).
- Produces: `GET /api/admin/music/concurrency` → `{ maxConcurrentDownloads: number }`; `POST /api/admin/music/concurrency` with body `{ maxConcurrentDownloads: number }` → `{ success: true }` or a 400. Consumed by Task 3's `fetchMusicConcurrency`/`handleSaveMusicConcurrency`.

Byte-for-byte mirror of `server/api/admin/downloader/concurrency.get.ts`/`.post.ts`, retargeted at `music_max_concurrent_downloads` (already seeded, default `'2'`, in sub-project 2).

- [ ] **Step 1: Write the GET endpoint**

Create `server/api/admin/music/concurrency.get.ts`:

```typescript
import { defineEventHandler } from 'h3';
import { parseMaxConcurrentDownloads } from '../../../utils/concurrency';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const db = getDb();

  const row = db.prepare("SELECT value FROM settings WHERE key = 'music_max_concurrent_downloads'").get() as { value: string } | undefined;

  return { maxConcurrentDownloads: parseMaxConcurrentDownloads(row?.value) };
});
```

- [ ] **Step 2: Write the POST endpoint**

Create `server/api/admin/music/concurrency.post.ts`:

```typescript
import { defineEventHandler, readBody, createError } from 'h3';
import { isValidMaxConcurrentValue } from '../../../utils/concurrency';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const body = await readBody(event);
  const value = body?.maxConcurrentDownloads;

  if (!isValidMaxConcurrentValue(value)) {
    throw createError({ statusCode: 400, statusMessage: 'maxConcurrentDownloads must be an integer >= 1.' });
  }

  const db = getDb();
  db.prepare(`UPDATE settings SET value = ? WHERE key = 'music_max_concurrent_downloads'`).run(String(value));

  return { success: true };
});
```

- [ ] **Step 3: Type-check**

Run: `npx vue-tsc -b --noEmit`
Expected: only the same 3 pre-existing errors — nothing new.

- [ ] **Step 4: Commit**

```bash
git add server/api/admin/music/concurrency.get.ts server/api/admin/music/concurrency.post.ts
git commit -m "feat: add GET/POST endpoints for the music concurrency setting"
```

---

### Task 3: Settings page — script section

**Files:**
- Modify: `app/pages/settings.vue` (script section only — refs, handler functions, `onMounted`/`onUnmounted` wiring)

**Interfaces:**
- Consumes: `GET/POST /api/admin/music/queue`, `/concurrency`, and the existing `POST /api/admin/music/ingest`, `/pause`, `/resume`, `/artists/[id]/sync`, `/tracks/[id]/cancel` (sub-project 2, already built); `toast` (already imported in this file, `useToast()`); `formatStatus` (already defined in this file, generic status-label lookup — reused as-is, no music-specific version needed since the status strings are the same four values).
- Produces: `musicQueue`, `musicHistory`, `musicArtists`, `musicIsPaused`, `musicFailedCount`, `maxConcurrentMusicDownloads`, `musicActiveDownloadCount` (computed) refs; `fetchMusicQueue`, `toggleMusicPause`, `fetchMusicConcurrency`, `handleSaveMusicConcurrency`, `handleAddMusicArtist`, `handleSyncMusicArtist`, `handleCancelMusicTrack` functions — all consumed by Task 4's template.

This task only touches the `<script setup>` block — the template (Task 4) will reference some of these names before they're wired to any visible UI, which is fine (Vue doesn't error on unused script bindings).

- [ ] **Step 1: Add the refs**

In `app/pages/settings.vue`, find this existing line (search for `const maxConcurrentDownloads = ref(2);`):

```typescript
const maxConcurrentDownloads = ref(2);
const savingConcurrency = ref(false);
```

Immediately after it, add:

```typescript
const musicQueue = ref<any[]>([]);
const musicHistory = ref<any[]>([]);
const musicArtists = ref<any[]>([]);
const musicIsPaused = ref(false);
const musicFailedCount = ref(0);
const pausingOrResumingMusic = ref(false);
const maxConcurrentMusicDownloads = ref(2);
const savingMusicConcurrency = ref(false);
const musicArtistInput = ref('');
const musicArtistVisibility = ref('public');
const musicAutoSync = ref(true);
const addingMusicArtist = ref(false);
const musicIngestMessage = ref('');
const musicIngestSuccess = ref(false);
const syncingArtistId = ref<string | null>(null);

const musicActiveDownloadCount = computed(() => {
  return musicQueue.value.filter(t => t.download_status === 'downloading').length;
});
```

- [ ] **Step 2: Add the fetch/action functions**

Find the existing `fetchQueue`/`toggleGlobalPause`/`fetchConcurrency`/`handleSaveConcurrency` block (search for `const fetchQueue = async () => {`). Immediately after `handleSaveConcurrency`'s closing `};`, add:

```typescript
const fetchMusicQueue = async () => {
  try {
    const data = await $fetch<any>('/api/admin/music/queue');
    musicQueue.value = data.queue || [];
    musicHistory.value = data.history || [];
    musicArtists.value = data.artists || [];
    musicIsPaused.value = data.isPaused || false;
    musicFailedCount.value = data.failedCount || 0;
  } catch (err) {
    console.error('Failed to fetch music queue:', err);
  }
};

const toggleMusicPause = async () => {
  pausingOrResumingMusic.value = true;
  try {
    const endpoint = musicIsPaused.value ? '/api/admin/music/resume' : '/api/admin/music/pause';
    await $fetch(endpoint, { method: 'POST' });
    musicIsPaused.value = !musicIsPaused.value;
    toast.success(musicIsPaused.value ? 'Music downloads paused.' : 'Music downloads resumed.');
    fetchMusicQueue();
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'An error occurred.');
  } finally {
    pausingOrResumingMusic.value = false;
  }
};

const fetchMusicConcurrency = async () => {
  try {
    const data = await $fetch<any>('/api/admin/music/concurrency');
    maxConcurrentMusicDownloads.value = data.maxConcurrentDownloads ?? 2;
  } catch (err) {
    console.error('Failed to fetch music concurrency setting:', err);
  }
};

const handleSaveMusicConcurrency = async () => {
  savingMusicConcurrency.value = true;
  try {
    await $fetch('/api/admin/music/concurrency', {
      method: 'POST',
      body: { maxConcurrentDownloads: maxConcurrentMusicDownloads.value }
    });
    toast.success('Music concurrency setting saved.');
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Failed to save music concurrency setting.');
  } finally {
    savingMusicConcurrency.value = false;
  }
};

const handleAddMusicArtist = async () => {
  const url = musicArtistInput.value.trim();
  if (!url) return;

  addingMusicArtist.value = true;
  musicIngestMessage.value = '';
  try {
    const res = await $fetch<any>('/api/admin/music/ingest', {
      method: 'POST',
      body: {
        url,
        sync_status: musicAutoSync.value ? 'downloading' : 'paused',
        visibility: musicArtistVisibility.value
      }
    });
    musicIngestSuccess.value = res.success;
    musicIngestMessage.value = res.message;
    musicArtistInput.value = '';
    toast.success('Artist added.');
    fetchMusicQueue();
  } catch (err: any) {
    musicIngestSuccess.value = false;
    musicIngestMessage.value = err.data?.statusMessage || 'Failed to add artist.';
    toast.error('Error adding artist.');
  } finally {
    addingMusicArtist.value = false;
  }
};

const handleSyncMusicArtist = async (artistId: string) => {
  syncingArtistId.value = artistId;
  try {
    await $fetch(`/api/admin/music/artists/${artistId}/sync`, { method: 'POST' });
    toast.success('Artist sync started.');
    setTimeout(() => fetchMusicQueue(), 3000);
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Failed to sync artist.');
  } finally {
    syncingArtistId.value = null;
  }
};

const handleCancelMusicTrack = async (trackId: string) => {
  try {
    await $fetch(`/api/admin/music/tracks/${trackId}/cancel`, { method: 'POST' });
    toast.success('Download cancelled.');
    fetchMusicQueue();
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Cancellation failed.');
  }
};
```

- [ ] **Step 3: Add music polling and wire it into `onMounted`/`onUnmounted`**

Find the existing `runPolling`/`onMounted`/`onUnmounted` block at the end of the script (search for `let pollingTimeout: any = null;`). Immediately before the `onMounted(() => {` line, add:

```typescript
let musicPollingTimeout: any = null;

const runMusicPolling = async () => {
  if (!isAdmin.value) return;
  await fetchMusicQueue();
  const hasActiveMusicDownload = musicQueue.value.some(t => t.download_status === 'downloading');
  const nextPollDelay = hasActiveMusicDownload ? 500 : 3000;
  musicPollingTimeout = setTimeout(runMusicPolling, nextPollDelay);
};

```

Then change the existing `onMounted`/`onUnmounted` block from:

```typescript
onMounted(() => {
  if (isAdmin.value) {
    fetchSchedule();
    fetchDefaultDir();
    fetchSponsorBlockSettings();
    fetchConcurrency();
    runPolling();
  }
});

onUnmounted(() => {
  if (pollingTimeout) clearTimeout(pollingTimeout);
});
```

to:

```typescript
onMounted(() => {
  if (isAdmin.value) {
    fetchSchedule();
    fetchDefaultDir();
    fetchSponsorBlockSettings();
    fetchConcurrency();
    runPolling();
    fetchMusicConcurrency();
    runMusicPolling();
  }
});

onUnmounted(() => {
  if (pollingTimeout) clearTimeout(pollingTimeout);
  if (musicPollingTimeout) clearTimeout(musicPollingTimeout);
});
```

- [ ] **Step 4: Type-check**

Run: `npx vue-tsc -b --noEmit`
Expected: only the 3 pre-existing errors — nothing new. (The new refs/functions are unused by any template yet, which is not a type error in this project's config.)

- [ ] **Step 5: Commit**

```bash
git add app/pages/settings.vue
git commit -m "feat: add music tab script logic to settings.vue (no UI yet)"
```

---

### Task 4: Settings page — tab button and template

**Files:**
- Modify: `app/pages/settings.vue` (template section only)

**Interfaces:**
- Consumes: every ref/function from Task 3, plus the existing `activeTab`, `isAdmin`, `currentUser`, `formatStatus`.
- Produces: the visible "Music" tab — no further tasks consume this directly; Task 5 verifies it.

- [ ] **Step 1: Add the tab button**

Find the existing "Downloads" tab button in the tabs sidebar (search for `:class="{ active: activeTab === 'downloads' }"`). Its full block ends with:

```html
          <span>Downloads</span>
          <span v-if="activeDownloadCount > 0" class="tab-badge">{{ activeDownloadCount }}</span>
        </button>

        <button 
          v-if="isAdmin && !currentUser?.mustChangePassword" 
          class="tab-btn" 
          :class="{ active: activeTab === 'users' }" 
```

Insert a new button between the Downloads button's closing `</button>` and the Users button, so it reads:

```html
          <span>Downloads</span>
          <span v-if="activeDownloadCount > 0" class="tab-badge">{{ activeDownloadCount }}</span>
        </button>

        <button 
          v-if="isAdmin && !currentUser?.mustChangePassword" 
          class="tab-btn" 
          :class="{ active: activeTab === 'music' }" 
          @click="activeTab = 'music'"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>
          <span>Music</span>
          <span v-if="musicActiveDownloadCount > 0" class="tab-badge">{{ musicActiveDownloadCount }}</span>
        </button>

        <button 
          v-if="isAdmin && !currentUser?.mustChangePassword" 
          class="tab-btn" 
          :class="{ active: activeTab === 'users' }" 
```

- [ ] **Step 2: Add the tab pane**

Find the end of the Downloads tab pane and the start of the Ingest Options Modal (search for `<!-- Ingest Options Modal -->`). The Downloads tab pane's closing looks like:

```html
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Ingest Options Modal -->
```

Insert the new Music tab pane between the Downloads pane's closing `</div>` (the one that closes `<div v-if="activeTab === 'downloads' && isAdmin" class="tab-pane">`) and the Ingest Options Modal comment:

```html
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- ================= MUSIC TAB ================= -->
        <div v-if="activeTab === 'music' && isAdmin" class="tab-pane">
          <div class="downloads-header-panel glass-panel">
            <div class="header-text">
              <h2>Music Ingestion</h2>
              <p>Follow YouTube channels as music artists. Audio is extracted, no re-encoding.</p>
            </div>

            <div class="queue-actions-row">
              <button
                @click="toggleMusicPause"
                class="btn"
                :class="musicIsPaused ? 'btn-primary-glow' : 'btn-secondary-dark'"
                :disabled="pausingOrResumingMusic"
              >
                <svg v-if="musicIsPaused" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                <svg v-else xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-2"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>
                <span>{{ musicIsPaused ? 'Resume Music Sync' : 'Pause Music Sync' }}</span>
              </button>

              <div class="concurrency-control" style="display: inline-flex; align-items: center; gap: 8px;">
                <label for="max-concurrent-music-downloads" style="font-size: 13px; color: var(--text-secondary);">Max concurrent downloads</label>
                <input
                  id="max-concurrent-music-downloads"
                  type="number"
                  min="1"
                  v-model.number="maxConcurrentMusicDownloads"
                  class="form-input"
                  style="width: 64px;"
                />
                <button @click="handleSaveMusicConcurrency" class="btn btn-secondary-dark btn-sm" :disabled="savingMusicConcurrency">
                  {{ savingMusicConcurrency ? 'Saving...' : 'Save' }}
                </button>
              </div>
            </div>
          </div>

          <div class="downloads-dashboard-layout">
            <!-- Left Side: Add artist + followed artists -->
            <div class="downloads-main-col">
              <div class="ingest-box glass-panel">
                <div class="section-title-row">
                  <div class="icon-orb bg-purple">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>
                  </div>
                  <div>
                    <h3>Track a Music Artist</h3>
                    <p class="section-desc">Paste a YouTube channel URL or @handle.</p>
                  </div>
                </div>

                <form @submit.prevent="handleAddMusicArtist" class="ingest-form mt-3">
                  <div class="search-input-wrapper">
                    <input
                      type="text"
                      v-model="musicArtistInput"
                      placeholder="YouTube channel URL or @handle"
                      class="form-input search-input"
                      required
                      :disabled="addingMusicArtist"
                    />
                  </div>
                  <select v-model="musicArtistVisibility" class="form-select" :disabled="addingMusicArtist">
                    <option value="public">Public</option>
                    <option value="private">Private</option>
                    <option value="ultra_private">Ultra Private</option>
                  </select>
                  <button type="submit" class="btn btn-primary" :disabled="addingMusicArtist">
                    <span v-if="addingMusicArtist">Adding...</span>
                    <span v-else>Add Artist</span>
                  </button>
                </form>

                <div class="form-group mt-2">
                  <label class="checkbox-container">
                    <input type="checkbox" v-model="musicAutoSync" :disabled="addingMusicArtist" />
                    <span class="checkmark"></span>
                    Sync automatically (start downloading right away)
                  </label>
                </div>

                <div v-if="musicIngestMessage" class="form-msg mt-3" :class="musicIngestSuccess ? 'success-msg' : 'error-msg'">
                  {{ musicIngestMessage }}
                </div>
              </div>

              <div class="ingest-box glass-panel mt-4">
                <div class="section-title-row">
                  <div class="icon-orb bg-blue">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle></svg>
                  </div>
                  <div>
                    <h3>Followed Artists</h3>
                    <p class="section-desc">{{ musicArtists.length }} artist(s) tracked.</p>
                  </div>
                </div>

                <div v-if="musicArtists.length === 0" class="mt-3">
                  <p class="section-desc">No artists followed yet.</p>
                </div>
                <div v-else class="search-results-grid mt-3">
                  <div v-for="artist in musicArtists" :key="artist.id" class="search-channel-card">
                    <img
                      :src="artist.avatar_url || '/img/default-avatar.png'"
                      class="channel-avatar-thumb"
                      referrerpolicy="no-referrer"
                      @error="($event) => { const target = $event.target as HTMLImageElement; if (target) { target.src = '/img/default-avatar.png'; } }"
                    />
                    <div class="channel-search-info">
                      <h5>{{ artist.name }}</h5>
                      <p class="channel-search-meta">
                        <span>{{ formatStatus(artist.sync_status) }}</span>
                        <span class="meta-dot">•</span>
                        <span>{{ artist.visibility }}</span>
                        <span class="meta-dot">•</span>
                        <span>{{ artist.track_count }} track(s)</span>
                      </p>
                    </div>
                    <button
                      @click="handleSyncMusicArtist(artist.id)"
                      class="btn btn-primary btn-xs"
                      :disabled="syncingArtistId === artist.id"
                    >
                      {{ syncingArtistId === artist.id ? 'Syncing...' : 'Sync' }}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <!-- Right Side: Queue -->
            <div class="downloads-side-col">
              <div class="queue-box glass-panel">
                <div class="queue-header-row">
                  <div class="flex-align-center gap-10">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--accent-secondary);"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>
                    <h3 style="margin: 0; font-size: 15px; font-weight: 700;">Music Queue</h3>
                  </div>
                  <span :class="musicIsPaused ? 'badge-paused-global' : 'badge-active-global'">
                    {{ musicIsPaused ? 'Suspended' : 'Active' }}
                  </span>
                </div>

                <div v-if="musicQueue.length === 0" class="queue-empty-state">
                  <h4>Music Pipeline Idle</h4>
                  <p>Queue is empty.</p>
                </div>
                <div v-else class="queue-list-premium">
                  <div v-for="track in musicQueue" :key="track.id" class="queue-card-premium">
                    <div class="queue-card-details">
                      <div class="queue-card-meta-main">
                        <h4 class="queue-card-title" :title="track.title">{{ track.title }}</h4>
                        <span class="queue-card-channel-name">{{ track.artist_name }}</span>
                      </div>
                      <span class="status-badge" :class="`status-${track.download_status}`">
                        {{ formatStatus(track.download_status) }}
                      </span>
                    </div>

                    <div class="queue-progress-container">
                      <div class="progress-bar-glow-bg">
                        <div
                          class="progress-bar-glow-fill"
                          :style="{ width: (track.download_progress || 0) + '%' }"
                        ></div>
                      </div>
                      <span class="progress-percent-text">{{ Math.round(track.download_progress || 0) }}%</span>
                    </div>

                    <div class="queue-diagnostics-row" v-if="track.download_status === 'downloading'">
                      <span v-if="track.download_speed" class="diag-meta-spec">Speed: {{ track.download_speed }}</span>
                      <span v-if="track.download_eta" class="diag-meta-spec">ETA: {{ track.download_eta }}</span>
                    </div>

                    <div class="queue-error-box" v-if="track.download_status === 'failed' && track.last_error">
                      <strong>Log:</strong> {{ track.last_error }}
                    </div>

                    <div class="queue-card-action-bar">
                      <button
                        @click="handleCancelMusicTrack(track.id)"
                        class="btn-action-premium btn-action-danger"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Ingest Options Modal -->
```

- [ ] **Step 3: Type-check**

Run: `npx vue-tsc -b --noEmit`
Expected: only the 3 pre-existing errors — nothing new.

- [ ] **Step 4: Commit**

```bash
git add app/pages/settings.vue
git commit -m "feat: add Music tab UI to settings.vue

Add-artist form (URL/handle + 3-option visibility select + auto-sync
checkbox), global pause/resume + concurrency control, followed-artists
list with per-artist sync, and a queue list with per-track cancel —
reusing the Downloads tab's CSS classes throughout."
```

---

### Task 5: Verification

**Files:** none (verification only, no code changes)

- [ ] **Step 1: Verify the new endpoints directly**

Start the dev server and create an admin session (same technique used in prior sub-projects' verification passes — a throwaway script inserting a `sessions` row for the existing admin user). Then:

```bash
ADMIN="<session id from the script>"

curl -s -H "Cookie: youkeep_session=$ADMIN" http://localhost:3100/api/admin/music/queue
# Expected: { queue: [...], history: [...], artists: [...], isPaused: false, failedCount: 0 } —
# with the GIMS artist (from sub-project 2/3a's live tests) present in `artists`,
# and its already-completed tracks present in `history`.

curl -s -H "Cookie: youkeep_session=$ADMIN" http://localhost:3100/api/admin/music/concurrency
# Expected: { maxConcurrentDownloads: 2 }

curl -s -X POST -H "Cookie: youkeep_session=$ADMIN" -H "Content-Type: application/json" \
  -d '{"maxConcurrentDownloads": 3}' http://localhost:3100/api/admin/music/concurrency
curl -s -H "Cookie: youkeep_session=$ADMIN" http://localhost:3100/api/admin/music/concurrency
# Expected: { maxConcurrentDownloads: 3 }, then restore to 2 the same way.
```

- [ ] **Step 2: Verify the UI in the browser**

Using the Browser pane: navigate to `/settings`, click the new "Music" tab, and confirm:
- The GIMS artist appears in the "Followed Artists" list with its avatar (a real YouTube CDN image, not a broken-image icon), track count, sync status, and visibility.
- The queue list is empty or shows any tracks currently mid-download (from the artist being left mid-ingest in prior sub-projects' live tests).
- The pause/resume button and concurrency input render and are clickable.
- Typing a value into the "Add Artist" URL field and clicking "Add Artist" without a real session shows the expected "Unauthorized" error path if not logged in as admin in that browser tab (same limitation noted in prior sub-projects' UI verification passes — full authenticated click-through requires real admin credentials this environment doesn't have; the goal here is confirming the UI renders and wires correctly, which the error path itself demonstrates, exactly as it did for the earlier "Sync Playlists" and concurrency-control UI verifications in this project).

- [ ] **Step 3: Report results**

Summarize pass/fail for each check above. If any step fails, return to the relevant task and fix before considering this plan complete.
