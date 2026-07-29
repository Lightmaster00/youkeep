# Music Manual Metadata Editing (3c-ii) — Design

## Context

Second and final piece of Music mode's sub-project 3c, following 3c-i (read-only catalog browsing, done and merged). yt-dlp almost never populates `genre`/`track_number` and never populates `album`/`music_albums.cover_url` in practice (see the ingestion metadata-scarcity finding in the `project_music_mode` memory) — manual entry is the primary way this data will ever exist, not a rare fallback. This sub-project adds the write path: admin-only editing of track and album metadata, in-context on `/music`.

No write endpoints exist yet for `music_albums`/`music_tracks` — this is greenfield, not an extension of anything partial.

## Scope

- Two new `PATCH` endpoints under `server/api/admin/music/`: track fields and album fields.
- Edit-modal UI on `app/pages/music/index.vue`, admin-only, reusing the existing `BaseModal` component.
- Updating 3c-i's artist-detail endpoint so a manually-set `music_albums.cover_url` takes priority over its computed thumbnail fallback.

## Non-Goals

- No track↔album reassignment and no manual album creation — an admin can correct metadata on rows that exist, not restructure which tracks belong to which album. Deferred to a future pass if it proves needed.
- No artist name/description/avatar editing — renaming an artist would orphan already-served thumbnails (the file-serving route recomputes the artist's directory from the *current* name on every request, per the 3a design) and is out of scope here regardless.
- No bulk editing (multi-select, batch apply) — one row, one modal, one save.
- No audio playback, no changes to 3c-i's read endpoints beyond the `cover_url` priority fix described above.

## Design

### 1. `PATCH /api/admin/music/tracks/[id]`

Admin-only (403 for anyone else, checked server-side — never UI-only). Body: `{ title?: string, genre?: string, language?: string, trackNumber?: number }`, all fields optional independently.

- `title`, if present, must be a non-empty string after trimming (400 otherwise) — a track can't lose its title.
- `genre`, `language`, `trackNumber`: if the key is present in the body, an empty string (or, for `trackNumber`, a value that doesn't parse to a positive integer) clears the field to `NULL`. A non-empty valid value sets it. If the key is absent entirely, the field is untouched.
- Server builds a dynamic `UPDATE music_tracks SET ... WHERE id = ?` touching only the keys actually present in the body (mirrors the "only update what's provided" principle from 3b's `COALESCE`-preserve pattern, but implemented as conditional `SET` clauses since here — unlike 3b's enum field — every field is independently optional and "clear to NULL" is itself a valid, distinct action, which a single `COALESCE(?, current)` can't express).
- 404 if the track doesn't exist.

### 2. `PATCH /api/admin/music/albums/[id]`

Same shape and rules: `{ title?: string, releaseYear?: number, coverUrl?: string }`. `title` required non-empty if present; `releaseYear` and `coverUrl` clear to `NULL` on an empty/invalid value, same as track's optional fields. `releaseYear` validated as a 4-digit integer in a sane range (1900–2100) when non-empty. 404 if the album doesn't exist, 403 for non-admins.

### 3. Why no "keep current" sentinel is needed here (unlike 3b)

3b's bug happened because its add-artist form's visibility `<select>` defaulted to a generic literal option (`public`) even when re-editing an already-`private`/`ultra_private` artist, and always sent that literal — silently downgrading rows the admin never meant to touch. This sub-project's edit modal is structurally different: it always opens **pre-filled with the row's actual current values**, sourced directly from the `albums`/`trackGroups` state 3c-i's page already holds in memory (no extra fetch needed — the modal receives the track/album object as a prop when opened). The form's default *is* the current reality, not a generic literal, so submitting an untouched field resubmits its real value rather than clobbering it. The endpoints still validate and apply updates conditionally server-side (never "the UI is the only guardrail," per the 3b lesson), but the sentinel-option pattern itself isn't needed because the failure mode it existed to prevent can't occur here.

### 4. UI — `app/pages/music/index.vue`

Two new small modal components, `app/components/MusicTrackEditModal.vue` and `app/components/MusicAlbumEditModal.vue`, each wrapping `BaseModal` with the field set above (all `<input>`s using `.form-input`, matching 3c-i's fix for the nonexistent `.form-select`). Each modal receives the current row via a prop, emits `saved` with the updated row on success.

On the catalog page: a pencil-icon button, `v-if="isAdmin"`, appears next to each track row (opens `MusicTrackEditModal`) and each album header (opens `MusicAlbumEditModal`). On `saved`, the page patches the corresponding entry directly in its own `trackGroups`/`albums` reactive state (no refetch) — e.g. find the track by id in `trackGroups[groupKey].tracks` and replace it; find the album by id in `albums` and replace it.

### 5. `cover_url` priority fix — `server/api/music/artists/[id]/index.get.ts`

The album subquery's `cover_url` field becomes `COALESCE(al.cover_url, <existing computed-fallback subquery>)` — a manually-set cover always wins; the computed first-track-thumbnail fallback only applies when `al.cover_url IS NULL`, exactly as today.

## Error Handling

- Both endpoints: 400 for an empty `title`, 400 for a `releaseYear`/`trackNumber` that fails validation, 404 for a nonexistent row, 403 for non-admin — each surfaced via the existing toast-error pattern in the modal's save handler.
- Modal save failures don't close the modal (so the admin doesn't lose their edits) — only a successful save closes it and emits `saved`.

## Verification

- Endpoint tests (Vitest, mirroring 3c-i's test style): admin-only enforcement (403 for guest/non-admin, 200 for admin), partial updates (only provided fields change), clear-to-NULL behavior on empty values, `title` rejection on empty, `releaseYear`/`trackNumber` validation, 404 for a nonexistent row.
- `cover_url` priority: a test on the artist-detail endpoint confirming a manually-set `cover_url` overrides the computed fallback, and that the fallback still applies when `cover_url` is `NULL`.
- Browser: as an admin, edit a track's genre/language/track_number/title and an album's title/year/cover, confirm the catalog page reflects the change immediately without a full reload; confirm the pencil buttons are absent for a non-admin session; confirm clearing a field to empty then saving actually clears it (re-open the modal, confirm it now shows empty).
- `npx vue-tsc -b --noEmit` clean.
