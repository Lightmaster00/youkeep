# Music Catalog Browsing UI (3c-i) — Design

## Context

First of two pieces in Music mode's sub-project 3c, the last piece of sub-project 3 ("library UI"). Sub-projects 1 (data model), 2 (ingestion), 3a (file serving & access control), 3b (admin ingestion UI), and the space-switcher sub-project are all done and merged. The music space's home route (`app/pages/music/index.vue`) currently renders a static "coming soon" `EmptyState` placeholder — this sub-project replaces it with real, regular-user-facing catalog browsing (not admin-only). Manual metadata editing is deliberately split out into a follow-up sub-project (3c-ii) so this piece ships a usable read-only catalog sooner.

## Scope

- Three new GET endpoints under `server/api/music/`: an artist list (filtered, faceted), an artist detail, and a paginated track list scoped to one artist (optionally to one album or to album-less tracks).
- A new `canAccessMusicArtist` helper in `server/utils/auth.ts`, mirroring the existing `canAccessChannel`/`canAccessMusicTrack` visibility logic at the artist level.
- Replacing `app/pages/music/index.vue`'s content with a channels.vue-style grid/detail page: artist grid with search + genre/language/year filters, and a detail view (via `?artistId=` query param on the same route, not a new page) showing albums grouped with their tracks plus a "titres sans album" section.

## Non-Goals

- No manual metadata editing (album/track title, genre, language, year, album (re)assignment) — that is 3c-ii, which builds directly on this sub-project's browsing UI as the surface it edits in-place.
- No audio playback — out of scope for all of sub-project 3 (agreed at the start of sub-project 3) and sub-project 4 (audio player) specifically.
- No changes to the video-space's global header search (`searchQuery`/`handleSearch` in `app/layouts/default.vue`) — it remains video-only; the music catalog gets its own, page-local search input.
- Tracks that are not `download_status = 'completed'` (pending/downloading/failed) are never shown in this catalog — the catalog is "what's actually archived," not a queue view. Queue/status visibility remains the admin-only Settings "Music" tab from 3b.
- No new database columns or schema changes — `music_albums.cover_url` stays `NULL` from ingestion; this sub-project works around it with a server-computed fallback (see below), it does not populate the column.

## Design

### 1. `canAccessMusicArtist(artistId: string, event): Promise<boolean>` — `server/utils/auth.ts`

Mirrors `canAccessMusicTrack`'s visibility logic, but takes an artist id directly instead of joining through a track — needed because the artist detail and artist-list endpoints check access at the artist level, not the track level:

```ts
export async function canAccessMusicArtist(artistId: string, event: any): Promise<boolean> {
  const db = getDb();
  const artist = db.prepare('SELECT visibility FROM music_artists WHERE id = ?').get(artistId) as { visibility: string } | undefined;
  if (!artist) return false;

  const user = await getUserFromSession(event);
  const visMap: Record<string, number> = { 'public': 0, 'private': 1, 'ultra_private': 2 };
  // Fails closed on an unrecognized value, same reasoning as canAccessMusicTrack:
  // music_artists.visibility has no CHECK constraint.
  const level = visMap[artist.visibility] ?? 2;

  if (level === 0) return true;
  if (!user) return false;
  if (user.role === 'admin') return true;
  return level === 1; // private: any logged-in user; ultra_private: admin only (already returned above)
}
```

`canAccessMusicTrack` is left as-is (unchanged, still used by the file-serving route from 3a) — it is not refactored to call this new helper, since it already has its own tests and the duplication is small and low-risk.

### 2. `GET /api/music/artists`

Query params: `search` (matches `name`, case-insensitive substring), `genre`, `language`, `year` (all optional, all applied as filters on the artist's *tracks* — an artist matches if it has at least one completed track matching every supplied filter).

Visibility filtering mirrors `server/api/channels/index.get.ts` exactly, adapted to music's simpler model (no `user_channel_access` grant table for music, per 3a):
- Guest: `visibility = 'public'` only.
- Logged-in non-admin: `visibility IN ('public', 'private')`.
- Admin: no visibility filter.

Only artists with at least one `download_status = 'completed'` track are included (an artist that's been followed but has nothing downloaded yet doesn't appear — it's not "archived" yet).

Response:
```ts
{
  artists: Array<{ id, name, avatar_url, visibility, track_count }>, // track_count = completed tracks only
  facets: {
    genres: string[],   // DISTINCT non-null genre values across all tracks the requester can see
    languages: string[], // DISTINCT non-null language values, same scope
    years: number[],     // DISTINCT non-null music_albums.release_year values, same scope
  }
}
```

`facets` is computed from the same visibility-filtered, completed-only track set (via a join through `music_albums`/`music_artists`) regardless of the current `search`/`genre`/`language`/`year` filters — i.e. the filter options don't shrink as filters are applied, matching how a filter UI is normally expected to behave (you can always see and change to any other available value, not just ones compatible with your current selection).

### 3. `GET /api/music/artists/[id]`

Same 403/404 shape as `server/api/channels/[id].get.ts`: 404 if the artist doesn't exist, 403 via `canAccessMusicArtist` if it exists but access is denied.

Response:
```ts
{
  artist: { id, name, description, avatar_url, banner_url, visibility },
  albums: Array<{
    id, title, release_year,
    track_count,        // completed tracks only
    cover_url,          // computed fallback: local_thumbnail_path of the album's first completed track (by track_number, then created_at), or null if none has one
  }>, // ordered by release_year DESC (NULLs last), then title
  standaloneTrackCount: number, // completed tracks with album_id IS NULL for this artist
}
```

### 4. `GET /api/music/artists/[id]/tracks`

Query params: `albumId` (a real album id, or the literal string `none` for album-less tracks — required, no "all tracks across every album" mode, since the UI always requests one group at a time), `limit` (default 50), `offset` (default 0).

Access-checked the same way as the detail endpoint (`canAccessMusicArtist`). Only `download_status = 'completed'` tracks. Response:
```ts
{
  tracks: Array<{ id, title, track_number, genre, language, duration, local_thumbnail_path }>,
  total: number, // total completed tracks in this group, for "load more" button visibility
}
```
Ordered by `track_number ASC` (NULLs last) then `title ASC`.

### 5. `app/pages/music/index.vue`

Replaces the current static placeholder. Structure mirrors `app/pages/channels.vue`'s grid/detail split:

**Grid view** (default, no `artistId` in the query): search input + three `<select>` filters (genre/language/year, options populated from `facets`, each with an "Tous" / "Toutes" default option that clears that filter) fetching `GET /api/music/artists` reactively on change (same debounce/watch pattern already used in `channels.vue`'s search). Below, a responsive card grid — one card per artist (avatar via the hotlinked CDN URL with the existing `@error` fallback pattern, name, track count, visibility badge for admins). Empty state (`EmptyState` component, `icon="music"`) when the filtered list is empty, with distinct copy depending on whether any filter is active ("Aucun résultat pour ces filtres" vs "Aucun artiste archivé pour l'instant").

**Detail view** (`?artistId=X`): fetches artist detail + starts fetching each album's first page of tracks on demand (albums render collapsed-by-default with track_count shown, expand-on-click triggers the tracks fetch — avoids firing N track requests for an artist with many albums up front). Each expanded album shows its track list (title, track number, duration, genre/language badges when present) with a "Charger plus" button when `tracks.length < total`. A "Titres sans album" section at the bottom follows the same expand/paginate pattern using `albumId=none`. Back button returns to the grid view (clears `artistId`, matching `channels.vue`'s `goBack`).

Route stays `/music` for both views (query-param-driven, exactly like `channels.vue`'s `channelId` query param) — no new entry needed in `app/spaces.ts`'s `music.navLinks`, and the space-switcher's `route.path.startsWith('/music')` check is unaffected by query params.

## Error Handling

- `GET /api/music/artists/[id]` and `.../tracks`: 404 for a nonexistent artist, 403 for denied access — client shows the existing toast-error pattern and redirects back to the grid view (mirrors how `channels.vue` handles a bad `channelId`).
- Empty `facets` arrays (no data yet) simply render filter selects with only the default "Tous"/"Toutes" option — no special-casing needed.
- `GET /api/music/artists/[id]/tracks` with an `albumId` that doesn't belong to the artist (or doesn't exist): returns an empty `tracks`/`total: 0` rather than an error — treated as "no results," consistent with how a mistyped filter is handled elsewhere in this design, not a client bug that needs surfacing.

## Verification

- `GET /api/music/artists` across all three visibility tiers (guest/user/admin) against real data from prior sub-projects' live tests (GIMS artist, `public` visibility) — confirm correct inclusion/exclusion and that `facets` reflects real genre/language/year values if any are present (may be empty/sparse per the ingestion metadata-scarcity finding — expected, not a bug).
- `GET /api/music/artists/[id]` and `.../tracks` access-denied paths (403 for a `private`/`ultra_private` artist as a guest or non-privileged user), and the album-grouping/pagination shape against an artist with more tracks than the default page size.
- Browser: load `/music`, confirm the grid renders, apply each filter individually and in combination, click into an artist, expand an album and the "sans album" section, confirm "Charger plus" appears only when there are more tracks than the first page, click back to return to the grid.
- `npx vue-tsc -b --noEmit` clean (the only command in this repo that actually type-checks).
