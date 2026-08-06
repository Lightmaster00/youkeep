# Music: Artist Mix + Track Radio — Design

## Context

Fifth and final item of the "video/music improvements" initiative (Cache-Control headers, music resync cron, playlist ingestion, and the finished-live VOD badge shipped first). This item started as the vaguest on the original 5-item list — "refine the 4 automatic music playlists (mix by artist, radio-from-a-track, etc.)."

Read directly from the codebase: the 4 existing automatic playlists (`server/api/music/playlists/{most-played,recently-added,rediscover,genre-mix}.get.ts`) are all simple, independent SQL queries returning up to 30 tracks each, filtered by the caller's music visibility clause and `download_status = 'completed'`. Neither "mix by artist" nor "radio from a track" — the two concrete examples given at the very start — exist today. Clarified with the user: this item means adding these two new automatic-playlist types, not modifying the 4 existing ones (which are explicitly out of scope and untouched).

The only signals available for any similarity logic are `music_tracks.genre`, `music_tracks.language`, and `music_tracks.artist_id` (no embeddings, no collaborative filtering beyond a user's own `music_play_history`).

## Scope

- A new "Mix `<Artiste>`" automatic playlist: 30 random tracks from a single artist, triggered from that artist's own detail page.
- A new "Radio" feature: starting from a currently-playing track, generate a queue of up to 30 similar tracks (weighted toward the same genre, with a few tracks from the same artist mixed in), triggered from the mini-player.

## Non-Goals

- The 4 existing automatic playlists (`most-played`, `recently-added`, `rediscover`, `genre-mix`) are not modified in any way — their logic, labels, and placement stay exactly as they are today.
- No ML-based or embedding-based similarity — only `genre`/`artist_id`/`language`, the same signals the existing playlists already use.
- No self-extending/infinite radio — a radio queue is a fixed list of up to 30 tracks, generated once when triggered. Reaching the end of it behaves exactly like reaching the end of any other queue today (repeat/shuffle modes apply identically, no special "radio mode").
- No persistence — neither the artist mix nor a radio queue is saved as a named playlist; both are ephemeral, exactly like today's automatic playlists (which are also generated fresh on every page load).
- No per-track "start radio" button on track rows in this iteration — only the mini-player trigger, per the user's explicit choice.

## Design

### 1. Artist Mix

New endpoint `GET /api/music/playlists/artist-mix?artistId=<id>`, structurally identical to the existing `genre-mix.get.ts` but filtering on `t.artist_id` instead of `t.genre`:

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

**Trigger:** a new "Lecture aléatoire" button on the artist detail view in `app/pages/music/index.vue` (the `v-if="artistId"` branch of the page, where the artist's albums/tracks are already listed). On click: fetch the endpoint, then call the existing `useMusicPlayer().play(tracks[0], tracks)` to start playback with the returned list as the queue — no new player logic needed, this reuses the exact mechanism every other "play a list" action on this page already uses.

If the artist has fewer than 30 completed tracks, the query naturally returns fewer — no special-casing needed (same behavior `genre-mix` already has for small genres).

### 2. Track Radio

New endpoint `GET /api/music/playlists/radio?trackId=<id>`:

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

When `seed.genre` is null, `sameArtistRows` alone (already limited to `RADIO_TOTAL` in that branch, not `RADIO_SAME_ARTIST_MAX`) is returned unshuffled-further — a plain random same-artist list, matching the spec's stated fallback.

**Trigger:** a new "Démarrer une radio" button in `app/components/MusicMiniPlayer.vue`, placed alongside the existing shuffle/repeat buttons (`toggleShuffle`/`cycleRepeat`), acting on `currentTrack`. On click: fetch `/api/music/playlists/radio?trackId=<currentTrack.id>`, then call `play(currentTrack, tracks)` from `useMusicPlayer()` — since `tracks` (the radio result) never contains the seed track, `play()`'s existing `idx === -1` branch (`queue.value = [track, ...tracks]`) naturally prepends the currently-playing track to the front of the new queue, requiring no new player logic.

## Error Handling

- `artist-mix` and `radio` both return the standard `400` (missing required query param) already used by `genre-mix` for a missing `genre`.
- `radio` additionally returns `404` if `trackId` doesn't resolve to a real track (a case `genre-mix`/`artist-mix` don't need, since a genre/artist string with zero matches just yields an empty list, not an invalid input).
- Both endpoints reuse the existing `musicVisibilityClause` gating, so a user can never receive tracks their session shouldn't see — identical protection to the 4 existing playlists.
- If the mini-player's radio fetch fails (network error, unexpected 4xx/5xx), fail silently and leave the current queue untouched — consistent with how `music/index.vue`'s `fetchPlaylists()` already treats each automatic-playlist fetch as independently best-effort (`catch (e) { /* silently skip this card on error */ }`).

## Verification

- Both endpoints are plain parameterized SQL queries with no yt-dlp/download-execution involvement, so unlike prior sub-projects in this initiative, these ARE unit-testable. New integration tests cover: `artist-mix` returns only tracks from the requested artist, respects visibility, returns fewer than 30 if the artist has fewer; `radio` returns tracks excluding the seed, respects the same-artist cap when a genre is present, falls back to same-artist-only when the seed has no genre, respects visibility, 404s on an unknown `trackId`.
- The two frontend trigger buttons (artist page "Lecture aléatoire", mini-player "Démarrer une radio") have no existing Vue component test infrastructure in this codebase (confirmed in prior sub-projects, an accepted project-wide gap) — verified manually in the running dev server instead: trigger each button, confirm the player queue updates and playback starts from the expected track.
