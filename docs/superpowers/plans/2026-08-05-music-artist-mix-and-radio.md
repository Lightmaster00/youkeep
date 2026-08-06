# Music: Artist Mix + Track Radio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two new automatic music playlist types — "Mix `<Artiste>`" (random tracks from one artist) and "Radio" (a queue of similar tracks generated from a currently-playing track) — as the fifth and final item of the "video/music improvements" initiative.

**Architecture:** Two new Nitro API endpoints, structurally identical to the existing automatic-playlist endpoints (`genre-mix.get.ts` etc.), each returning `{ tracks: [...] }`. Two small frontend additions wire them to existing player mechanics that already support "play this list starting from this track" with no new player logic needed.

**Tech Stack:** Nuxt 4, Nitro (H3), better-sqlite3, Vue 3 Composition API, Vitest.

## Global Constraints

- The 4 existing automatic playlists (`most-played`, `recently-added`, `rediscover`, `genre-mix`) are not modified in any way.
- No ML/embeddings — only `genre`, `artist_id`, `language` (the same signals the existing playlists already use).
- No self-extending/infinite radio — a radio queue is a fixed list of up to 30 tracks, generated once per trigger.
- No persistence — neither the artist mix nor a radio queue is saved as a named playlist.
- No per-track-row radio button in this iteration — only the mini-player trigger.
- Unlike most prior sub-projects in this initiative, this one has no yt-dlp/download-execution involvement — both new endpoints are plain parameterized SQL and get real automated tests, not a manual-only exemption.
- The two frontend button additions have no automated test coverage available (this codebase has zero Vue component test infrastructure, an accepted project-wide gap) — verified manually in the running dev server instead.

---

### Task 1: `artist-mix` endpoint

**Files:**
- Create: `server/api/music/playlists/artist-mix.get.ts`
- Modify: `tests/integration/music-playlists.test.ts` (append a new `describe` block and import)

**Interfaces:**
- Produces: `GET /api/music/playlists/artist-mix?artistId=<id>` → `{ tracks: PlaylistTrack[] }`, where each track has the same shape as every other automatic-playlist endpoint (`id, title, track_number, genre, language, duration, local_file_path, local_thumbnail_path, has_clip, artist_id, artist_name`). 400 if `artistId` is missing.

- [ ] **Step 1: Create the endpoint**

This mirrors the existing `server/api/music/playlists/genre-mix.get.ts` exactly, replacing the `genre` filter with `artist_id`:

```ts
import { defineEventHandler, getQuery, createError } from 'h3';
import { getUserFromSession } from '../../../utils/auth';
import { musicVisibilityClause } from '../../../utils/musicVisibility';

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const artistId = query.artistId ? String(query.artistId) : null;
  if (!artistId) {
    throw createError({ statusCode: 400, statusMessage: 'artistId is required.' });
  }

  const session = await getUserFromSession(event);
  const db = getDb();

  const clause = musicVisibilityClause(session);
  const visClause = clause ? `AND ${clause}` : '';

  const rows = db.prepare(`
    SELECT t.id, t.title, t.track_number, t.genre, t.language, t.duration,
           t.local_file_path, t.local_thumbnail_path, t.has_clip, t.artist_id, a.name as artist_name
    FROM music_tracks t
    JOIN music_artists a ON t.artist_id = a.id
    WHERE t.download_status = 'completed' AND t.artist_id = ? ${visClause}
    ORDER BY RANDOM()
    LIMIT 30
  `).all(artistId);

  return { tracks: rows };
});
```

- [ ] **Step 2: Write the failing tests**

Add this import to the top of `tests/integration/music-playlists.test.ts`, alongside the existing playlist handler imports:

```ts
import artistMixHandler from '../../server/api/music/playlists/artist-mix.get';
```

Add this new `describe` block at the end of the file (after the existing `describe('GET /api/music/playlists/genre-mix', ...)` block, before the file's closing):

```ts
describe('GET /api/music/playlists/artist-mix', () => {
  it('returns 400 when artistId is missing', async () => {
    await expect(artistMixHandler(eventFor('/api/music/playlists/artist-mix'))).rejects.toMatchObject({ statusCode: 400 });
  });

  it('returns only tracks from the requested artist, for a guest', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'public' });
    insertMusicArtist(db, { id: 'a2', visibility: 'public' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });
    insertMusicTrack(db, { id: 't2', artistId: 'a2' });

    const result: any = await artistMixHandler(eventFor('/api/music/playlists/artist-mix?artistId=a1'));
    expect(result.tracks.map((t: any) => t.id)).toEqual(['t1']);
  });

  it('excludes a private artist\'s tracks for a guest', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'private' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });

    const result: any = await artistMixHandler(eventFor('/api/music/playlists/artist-mix?artistId=a1'));
    expect(result.tracks).toEqual([]);
  });

  it('includes a private artist\'s tracks for a logged-in non-admin user', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'private' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });
    const cookie = loginAs('u1');

    const result: any = await artistMixHandler(eventFor('/api/music/playlists/artist-mix?artistId=a1', cookie));
    expect(result.tracks.map((t: any) => t.id)).toEqual(['t1']);
  });

  it('excludes tracks that are not completed', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'public' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', downloadStatus: 'pending' });

    const result: any = await artistMixHandler(eventFor('/api/music/playlists/artist-mix?artistId=a1'));
    expect(result.tracks).toEqual([]);
  });

  it('includes has_clip', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'public' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', hasClip: true });

    const result: any = await artistMixHandler(eventFor('/api/music/playlists/artist-mix?artistId=a1'));
    expect(result.tracks[0].has_clip).toBe(1);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/integration/music-playlists.test.ts`
Expected: FAIL — `Cannot find module '../../server/api/music/playlists/artist-mix.get'` (the endpoint from Step 1 doesn't exist yet if you did Step 2 first; if you did Step 1 first, skip straight to Step 4's run and confirm PASS instead — either order is fine as long as both steps land before committing).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/integration/music-playlists.test.ts`
Expected: all tests in the file PASS, including the 6 new ones.

- [ ] **Step 5: Commit**

```bash
git add server/api/music/playlists/artist-mix.get.ts tests/integration/music-playlists.test.ts
git commit -m "feat: add artist-mix automatic music playlist endpoint"
```

---

### Task 2: `radio` endpoint

**Files:**
- Create: `server/api/music/playlists/radio.get.ts`
- Modify: `tests/integration/music-playlists.test.ts` (append a new `describe` block and import)

**Interfaces:**
- Consumes: nothing from Task 1 (independent endpoint).
- Produces: `GET /api/music/playlists/radio?trackId=<id>` → `{ tracks: PlaylistTrack[] }` (same track shape as Task 1, never includes the seed track itself). 400 if `trackId` is missing, 404 if `trackId` doesn't resolve to a real track.

- [ ] **Step 1: Create the endpoint**

```ts
import { defineEventHandler, getQuery, createError } from 'h3';
import { getUserFromSession } from '../../../utils/auth';
import { musicVisibilityClause } from '../../../utils/musicVisibility';

const RADIO_TOTAL = 30;
const RADIO_SAME_ARTIST_MAX = 8;

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const trackId = query.trackId ? String(query.trackId) : null;
  if (!trackId) {
    throw createError({ statusCode: 400, statusMessage: 'trackId is required.' });
  }

  const session = await getUserFromSession(event);
  const db = getDb();

  const seed = db.prepare(`SELECT artist_id, genre FROM music_tracks WHERE id = ?`).get(trackId) as { artist_id: string; genre: string | null } | undefined;
  if (!seed) {
    throw createError({ statusCode: 404, statusMessage: 'Track not found.' });
  }

  const clause = musicVisibilityClause(session);
  const visClause = clause ? `AND ${clause}` : '';

  const sameArtistRows = db.prepare(`
    SELECT t.id, t.title, t.track_number, t.genre, t.language, t.duration,
           t.local_file_path, t.local_thumbnail_path, t.has_clip, t.artist_id, a.name as artist_name
    FROM music_tracks t
    JOIN music_artists a ON t.artist_id = a.id
    WHERE t.download_status = 'completed' AND t.artist_id = ? AND t.id != ? ${visClause}
    ORDER BY RANDOM()
    LIMIT ?
  `).all(seed.artist_id, trackId, seed.genre ? RADIO_SAME_ARTIST_MAX : RADIO_TOTAL) as any[];

  let combined = sameArtistRows;

  if (seed.genre) {
    const remaining = RADIO_TOTAL - sameArtistRows.length;
    const excludeIds = [trackId, ...sameArtistRows.map((r) => r.id)];
    const placeholders = excludeIds.map(() => '?').join(',');
    const sameGenreRows = db.prepare(`
      SELECT t.id, t.title, t.track_number, t.genre, t.language, t.duration,
             t.local_file_path, t.local_thumbnail_path, t.has_clip, t.artist_id, a.name as artist_name
      FROM music_tracks t
      JOIN music_artists a ON t.artist_id = a.id
      WHERE t.download_status = 'completed' AND t.genre = ? AND t.id NOT IN (${placeholders}) ${visClause}
      ORDER BY RANDOM()
      LIMIT ?
    `).all(seed.genre, ...excludeIds, remaining) as any[];

    combined = [...sameArtistRows, ...sameGenreRows];
    // Shuffle in JS so same-artist and same-genre tracks are interleaved,
    // not grouped — the SQL above necessarily returns them as two blocks.
    for (let i = combined.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [combined[i], combined[j]] = [combined[j], combined[i]];
    }
  }

  return { tracks: combined };
});
```

Note: when `seed.genre` is falsy (`null` or `''`), `sameArtistRows` was already queried with `LIMIT RADIO_TOTAL` (30), so `combined = sameArtistRows` on its own is already the full same-artist-only result — no further query needed.

- [ ] **Step 2: Write the failing tests**

Add this import to `tests/integration/music-playlists.test.ts`:

```ts
import radioHandler from '../../server/api/music/playlists/radio.get';
```

Add this `describe` block after the `artist-mix` block from Task 1:

```ts
describe('GET /api/music/playlists/radio', () => {
  it('returns 400 when trackId is missing', async () => {
    await expect(radioHandler(eventFor('/api/music/playlists/radio'))).rejects.toMatchObject({ statusCode: 400 });
  });

  it('returns 404 when trackId does not exist', async () => {
    await expect(radioHandler(eventFor('/api/music/playlists/radio?trackId=nope'))).rejects.toMatchObject({ statusCode: 404 });
  });

  it('excludes the seed track from the result', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'public' });
    insertMusicTrack(db, { id: 'seed', artistId: 'a1', genre: 'Rock' });
    insertMusicTrack(db, { id: 't2', artistId: 'a1', genre: 'Rock' });

    const result: any = await radioHandler(eventFor('/api/music/playlists/radio?trackId=seed'));
    expect(result.tracks.map((t: any) => t.id)).not.toContain('seed');
  });

  it('caps same-artist tracks at RADIO_SAME_ARTIST_MAX (8) when the seed has a genre, filling the rest from the same genre', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'public' });
    insertMusicArtist(db, { id: 'a2', visibility: 'public' });
    insertMusicTrack(db, { id: 'seed', artistId: 'a1', genre: 'Rock' });
    for (let i = 0; i < 10; i++) {
      insertMusicTrack(db, { id: `same-artist-${i}`, artistId: 'a1', genre: 'Rock' });
    }
    for (let i = 0; i < 10; i++) {
      insertMusicTrack(db, { id: `same-genre-${i}`, artistId: 'a2', genre: 'Rock' });
    }

    const result: any = await radioHandler(eventFor('/api/music/playlists/radio?trackId=seed'));
    const sameArtistCount = result.tracks.filter((t: any) => t.artist_id === 'a1').length;
    expect(sameArtistCount).toBeLessThanOrEqual(8);
    expect(result.tracks.length).toBe(18); // 10 same-artist candidates capped at 8, plus 10 same-genre candidates (only 18 total exist)
  });

  it('excludes tracks with a different genre when the seed has a genre', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'public' });
    insertMusicArtist(db, { id: 'a2', visibility: 'public' });
    insertMusicTrack(db, { id: 'seed', artistId: 'a1', genre: 'Rock' });
    insertMusicTrack(db, { id: 'other-genre', artistId: 'a2', genre: 'Electro' });

    const result: any = await radioHandler(eventFor('/api/music/playlists/radio?trackId=seed'));
    expect(result.tracks.map((t: any) => t.id)).not.toContain('other-genre');
  });

  it('falls back to same-artist-only when the seed has no genre', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'public' });
    insertMusicArtist(db, { id: 'a2', visibility: 'public' });
    insertMusicTrack(db, { id: 'seed', artistId: 'a1', genre: null });
    insertMusicTrack(db, { id: 'same-artist', artistId: 'a1', genre: null });
    insertMusicTrack(db, { id: 'other-artist', artistId: 'a2', genre: null });

    const result: any = await radioHandler(eventFor('/api/music/playlists/radio?trackId=seed'));
    expect(result.tracks.map((t: any) => t.id)).toEqual(['same-artist']);
  });

  it('excludes a private artist\'s tracks for a guest', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'public' });
    insertMusicArtist(db, { id: 'a2', visibility: 'private' });
    insertMusicTrack(db, { id: 'seed', artistId: 'a1', genre: 'Rock' });
    insertMusicTrack(db, { id: 'hidden', artistId: 'a2', genre: 'Rock' });

    const result: any = await radioHandler(eventFor('/api/music/playlists/radio?trackId=seed'));
    expect(result.tracks.map((t: any) => t.id)).not.toContain('hidden');
  });

  it('includes has_clip', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'public' });
    insertMusicTrack(db, { id: 'seed', artistId: 'a1', genre: 'Rock' });
    insertMusicTrack(db, { id: 't2', artistId: 'a1', genre: 'Rock', hasClip: true });

    const result: any = await radioHandler(eventFor('/api/music/playlists/radio?trackId=seed'));
    expect(result.tracks.find((t: any) => t.id === 't2').has_clip).toBe(1);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/integration/music-playlists.test.ts`
Expected: FAIL — `Cannot find module '../../server/api/music/playlists/radio.get'` if you added the tests before the endpoint file; otherwise skip to Step 4.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/integration/music-playlists.test.ts`
Expected: all tests in the file PASS, including the 8 new `radio` tests and the 6 `artist-mix` tests from Task 1.

- [ ] **Step 5: Commit**

```bash
git add server/api/music/playlists/radio.get.ts tests/integration/music-playlists.test.ts
git commit -m "feat: add radio automatic music playlist endpoint"
```

---

### Task 3: "Lecture aléatoire" button on the artist detail page

**Files:**
- Modify: `app/pages/music/index.vue`

**Interfaces:**
- Consumes: `GET /api/music/playlists/artist-mix?artistId=<id>` from Task 1.
- Produces: nothing consumed by later tasks (Task 4 is independent).

- [ ] **Step 1: Add the trigger function**

The file already has a `playPlaylist` function (around line 300) that fetches nothing (it receives pre-fetched tracks) and calls `playMusicTrack(playlist.tracks[0], playlist.tracks)`:

```ts
function playPlaylist(playlist: { tracks: any[] }) {
  if (playlist.tracks.length === 0) return;
  playMusicTrack(playlist.tracks[0], playlist.tracks);
}
```

Add a new function right after it that fetches the artist-mix endpoint and plays the result the same way:

```ts
async function playArtistMix() {
  if (!artistId.value) return;
  const data = await $fetch<any>('/api/music/playlists/artist-mix', { params: { artistId: artistId.value } });
  if (data.tracks?.length > 0) {
    playMusicTrack(data.tracks[0], data.tracks);
  }
}
```

`artistId` is the existing `computed(() => (route.query.artistId ? String(route.query.artistId) : ''))` already declared near line 247 — no new state needed.

- [ ] **Step 2: Add the button to the template**

The artist detail header currently reads (lines 82-91):

```html
        <div class="artist-detail-header">
          <img :src="artist.avatar_url || fallbackAvatar" @error="handleAvatarError" class="artist-detail-avatar" alt="" />
          <div class="artist-detail-info">
            <div class="title-row" style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
              <h1 class="artist-detail-name">{{ artist.name }}</h1>
              <span v-if="isAdmin" class="badge" :class="getVisBadgeClass(artist.visibility)">{{ formatVisibility(artist.visibility) }}</span>
            </div>
            <p v-if="artist.description" class="artist-detail-desc">{{ artist.description }}</p>
          </div>
        </div>
```

Add a "Lecture aléatoire" button below the description, still inside `.artist-detail-info`, reusing the existing `btn btn-secondary` classes already used for the page's `back-btn`:

```html
        <div class="artist-detail-header">
          <img :src="artist.avatar_url || fallbackAvatar" @error="handleAvatarError" class="artist-detail-avatar" alt="" />
          <div class="artist-detail-info">
            <div class="title-row" style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
              <h1 class="artist-detail-name">{{ artist.name }}</h1>
              <span v-if="isAdmin" class="badge" :class="getVisBadgeClass(artist.visibility)">{{ formatVisibility(artist.visibility) }}</span>
            </div>
            <p v-if="artist.description" class="artist-detail-desc">{{ artist.description }}</p>
            <button @click="playArtistMix" class="btn btn-secondary artist-mix-btn">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
              Lecture aléatoire
            </button>
          </div>
        </div>
```

- [ ] **Step 3: Add a small CSS rule for spacing**

Find the existing `.artist-detail-desc` rule in the `<style>` block (search for `.artist-detail-desc`) and add a margin-top rule for the new button right after it, so it doesn't sit flush against the description text:

```css
.artist-mix-btn {
  margin-top: 10px;
}
```

- [ ] **Step 4: Manual verification in the dev server**

No automated test infrastructure exists for Vue components in this codebase. Verify visually instead:

1. Start the dev server: `npm run dev`.
2. Navigate to an artist's detail page (`/music?artistId=<id>`) for an artist with at least a few completed tracks.
3. Click "Lecture aléatoire". Confirm the mini-player starts playing a track from that artist, and the played track is included in a queue where `next`/`prev` cycle through other tracks from the same artist.
4. Confirm clicking it again produces (likely) a different random order/track — not required to be different every time given randomness, but should not error.
5. Try it on an artist with zero completed tracks (or fewer than 30) — confirm no error, and either nothing happens (0 tracks) or playback starts normally with fewer tracks in queue.

Report what you observed.

- [ ] **Step 5: Commit**

```bash
git add app/pages/music/index.vue
git commit -m "feat: add artist mix random-play button to artist detail page"
```

---

### Task 4: "Démarrer une radio" button in the mini-player

**Files:**
- Modify: `app/components/MusicMiniPlayer.vue`

**Interfaces:**
- Consumes: `GET /api/music/playlists/radio?trackId=<id>` from Task 2; `play(track, tracks)` from `useMusicPlayer()` (verified: when `track` is not found by id in `tracks`, `play` prepends it — `server/api` naming aside, this is `app/composables/useMusicPlayer.ts`'s existing `play()` function, unchanged by this plan).
- Produces: nothing consumed by later tasks (last task in the plan).

- [ ] **Step 1: Destructure `play` from `useMusicPlayer()`**

The component currently destructures (lines 86-91):

```ts
const {
  currentTrack, isPlaying, currentTime, duration,
  audioEl, shuffleOn, repeatMode, clipMode,
  togglePlay, seek, next, prev, toggleShuffle, cycleRepeat, setClipMode,
  recordPlayIfThresholdReached, saveToLocalStorage, restoreFromLocalStorage,
} = useMusicPlayer();
```

Add `play` to the destructured list:

```ts
const {
  currentTrack, isPlaying, currentTime, duration,
  audioEl, shuffleOn, repeatMode, clipMode,
  togglePlay, seek, next, prev, toggleShuffle, cycleRepeat, setClipMode, play,
  recordPlayIfThresholdReached, saveToLocalStorage, restoreFromLocalStorage,
} = useMusicPlayer();
```

- [ ] **Step 2: Add the trigger function**

Add this function near the component's other handler functions (e.g. after `onProgressClick` or any of the existing `on*`/toggle functions — exact placement among existing functions doesn't matter, just keep it in the `<script setup>` block):

```ts
async function startRadio() {
  if (!currentTrack.value) return;
  try {
    const data = await $fetch<any>('/api/music/playlists/radio', { params: { trackId: currentTrack.value.id } });
    if (data.tracks?.length > 0) {
      play(currentTrack.value, data.tracks);
    }
  } catch (e) {
    // Fail silently and leave the current queue untouched — consistent with
    // how music/index.vue's fetchPlaylists() treats each automatic-playlist
    // fetch as independently best-effort.
  }
}
```

- [ ] **Step 3: Add the button to the template**

The `.mini-player-extra-controls` block currently reads (lines 58-77):

```html
    <div class="mini-player-extra-controls">
      <button @click="toggleShuffle" class="mini-player-btn" :class="{ active: shuffleOn }" title="Aléatoire">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 3 21 3 21 8"></polyline><line x1="4" y1="20" x2="21" y2="3"></line><polyline points="21 16 21 21 16 21"></polyline><line x1="15" y1="15" x2="21" y2="21"></line><line x1="4" y1="4" x2="9" y2="9"></line></svg>
      </button>
      <button @click="cycleRepeat" class="mini-player-btn" :class="{ active: repeatMode !== 'off' }" title="Répétition">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"></polyline><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><polyline points="7 23 3 19 7 15"></polyline><path d="M21 13v2a4 4 0 0 1-4 4H3"></path></svg>
        <span v-if="repeatMode === 'one'" class="repeat-one-badge">1</span>
      </button>
      <input
        type="range"
        min="0"
        max="1"
        step="0.05"
        v-model.number="volume"
        @input="onVolumeChange"
        class="mini-player-volume"
        title="Volume"
        aria-label="Volume"
      />
    </div>
```

Add a "Démarrer une radio" button right after the repeat button, before the volume slider:

```html
    <div class="mini-player-extra-controls">
      <button @click="toggleShuffle" class="mini-player-btn" :class="{ active: shuffleOn }" title="Aléatoire">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 3 21 3 21 8"></polyline><line x1="4" y1="20" x2="21" y2="3"></line><polyline points="21 16 21 21 16 21"></polyline><line x1="15" y1="15" x2="21" y2="21"></line><line x1="4" y1="4" x2="9" y2="9"></line></svg>
      </button>
      <button @click="cycleRepeat" class="mini-player-btn" :class="{ active: repeatMode !== 'off' }" title="Répétition">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"></polyline><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><polyline points="7 23 3 19 7 15"></polyline><path d="M21 13v2a4 4 0 0 1-4 4H3"></path></svg>
        <span v-if="repeatMode === 'one'" class="repeat-one-badge">1</span>
      </button>
      <button @click="startRadio" class="mini-player-btn" title="Démarrer une radio">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9"></path><path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"></path><circle cx="12" cy="12" r="2"></circle><path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5"></path><path d="M19.1 4.9C23 8.8 23 15.2 19.1 19.1"></path></svg>
      </button>
      <input
        type="range"
        min="0"
        max="1"
        step="0.05"
        v-model.number="volume"
        @input="onVolumeChange"
        class="mini-player-volume"
        title="Volume"
        aria-label="Volume"
      />
    </div>
```

This reuses the existing plain `.mini-player-btn` class (no `active` state needed — unlike shuffle/repeat, radio isn't a toggle, it's a one-shot action) so no new CSS is required.

- [ ] **Step 4: Manual verification in the dev server**

No automated test infrastructure exists for Vue components in this codebase. Verify visually instead:

1. Start the dev server: `npm run dev`.
2. Play any track with a `genre` set (from the artist page or an automatic playlist).
3. Click the new radio button in the mini-player. Confirm playback continues on the same track (it should not restart or skip), and the queue is now the generated radio list — check via `next`/`prev` that subsequent tracks are from the same genre (with occasional same-artist tracks mixed in).
4. Play a track with no `genre` set (if one exists in the dev DB; if not, temporarily clear a track's genre via the admin edit UI or DB, test, then restore it). Click radio. Confirm the queue becomes same-artist tracks only.
5. Click radio on a track whose artist/genre combination has very few or zero other matching tracks. Confirm no error — the queue may just stay small or (if the radio endpoint returns 0 tracks) nothing happens and playback of the current track continues uninterrupted.

Report what you observed.

- [ ] **Step 5: Commit**

```bash
git add app/components/MusicMiniPlayer.vue
git commit -m "feat: add radio button to music mini-player"
```
