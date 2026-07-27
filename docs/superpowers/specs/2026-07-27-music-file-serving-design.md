# Music File Serving & Access Control — Design

## Context

First of three pieces making up sub-project 3 ("Music library UI") of the Music mode initiative (see project memory `project_music_mode` for the full ordered plan). Sub-projects 1 (data model) and 2 (ingestion pipeline) are done and merged. Sub-project 2's own final review flagged that `local_file_path`/`local_thumbnail_path` are written to `music_tracks` but served nowhere — there's no music equivalent of `server/routes/downloads/[...path].ts` or `canAccessVideo`. Sub-project 3 decomposes into:

- **(a) File serving & access control** (this spec).
- (b) Admin UI to trigger ingest/pause/resume/sync/cancel on the sub-project-2 endpoints — depends on (a) for showing artist avatars/track thumbnails in that UI.
- (c) Catalog browsing UI (artist/album list, filter, manual metadata editing) — depends on (a) for the same reason.

Playback (an `<audio>` element, streaming, range-requests) is explicitly out of scope for all of sub-project 3 — it belongs to sub-project 4 ("player"), agreed separately.

## Scope

A route that serves music thumbnail/cover images from disk, gated by the same visibility rules the video pipeline already enforces for its own files — nothing else.

## Non-Goals

- No audio file serving or streaming of any kind — no range-request support, no `Content-Range` handling. Deferred to sub-project 4, which actually needs it for playback.
- No fix for `music_albums.cover_url` currently always being `NULL` (ingestion never populates it) — that's the catalog UI's (sub-project 3c's) problem to solve (e.g. falling back to a track's thumbnail), not this route's.
- No per-user explicit access grant table for music (`user_artist_access` or equivalent) — sub-project 1 already deferred this; this spec does not revisit that decision. A non-admin has no override path through `ultra_private` for music, full stop, until that table exists.
- No share-link/token support for music tracks — `music_tracks` has no `share_token` column (a sub-project-1 schema decision), so token-based access (which `canAccessVideo` supports for videos) has no music equivalent here.

## Design

### 1. Access control: `canAccessMusicTrack`

New function in `server/utils/auth.ts`, alongside the existing `canAccessVideo`/`canAccessChannel`:

```typescript
export async function canAccessMusicTrack(trackId: string, event: any): Promise<boolean> {
  const db = getDb();

  const track = db.prepare(`
    SELECT a.visibility as artist_visibility
    FROM music_tracks t
    JOIN music_artists a ON t.artist_id = a.id
    WHERE t.id = ?
  `).get(trackId) as { artist_visibility: string } | undefined;

  if (!track) return false;

  const user = await getUserFromSession(event);

  const visMap: Record<string, number> = { 'public': 0, 'private': 1, 'ultra_private': 2 };
  const level = visMap[track.artist_visibility] ?? 0;

  if (level === 0) return true; // Public: everyone
  if (!user) return false;      // Guest: no access to restricted content
  if (user.role === 'admin') return true; // Admin sees everything
  if (level === 1) return true; // Private: any logged-in member

  // Ultra Private: admin-only for music today — no equivalent of
  // user_channel_access exists for music artists yet (see Non-Goals).
  return false;
}
```

This is a deliberately simpler version of `canAccessVideo` (`server/utils/auth.ts:110`): one visibility source instead of a max of two, no `share_token` branch, no explicit-grant-table branch. Every simplification traces to a real schema difference already decided in sub-project 1, not a new cut made here.

### 2. Route: `server/routes/downloads-music/[...path].ts`

Mirrors `server/routes/downloads/[...path].ts`'s containment/resolution logic, trimmed to images only:

- Path shape: `{artistFolderName}/{trackId}.{ext}`, matching exactly what `downloadMusicTrackFile` already writes into `local_thumbnail_path` (`/downloads-music/${folderName}/${trackId}.${ext}`, sub-project 2).
- Reject any extension other than `jpg`, `jpeg`, `webp`, `png` with 404 — this is the mechanism that keeps audio files unservable through this route without needing a separate allow/deny flag; there's no code path that would ever serve a `.opus`/`.m4a`/etc. file.
- Resolve `trackId` from the filename, look up `music_tracks` → `artist_id` → `music_artists.name`, rebuild the same `sanitizeFolderName`-based directory the download step used, and containment-check the resolved absolute path stays inside that directory (same belt-and-braces double check pattern as the video route: per-artist containment, then a second check against the overall music downloads dir).
- Call `canAccessMusicTrack(trackId, event)`; 403 if it returns `false`.
- On success, stream the file with `Content-Type` set from the extension (`image/jpeg` or `image/webp`/`image/png`), no range-request handling, no `Accept-Ranges` header — this is a plain image response, not the seekable-media response the video route also has to be.

### 3. Error handling

- Malformed path (wrong segment count, `..`, missing filename) → 400, same as the video route.
- Track row or artist row not found → 404.
- Non-image extension → 404 (not 403 — a 403 would confirm the file exists but is restricted; a 404 reveals nothing about whether an audio file is present at that path).
- Containment check fails → 403.
- Visibility check fails → 403.
- File not found on disk (row exists, file doesn't) → 404.

## Verification

- Request a real thumbnail path from a completed track (the sub-project-2 live test against the GIMS channel left real files under `data/downloads-music/GIMS/`) while the owning artist is `visibility = 'public'` → 200, correct `Content-Type`, image bytes match the file on disk.
- Set that artist to `visibility = 'private'`, request as a guest (no session) → 403. Request as a logged-in non-admin → 200. Request as admin → 200.
- Set the artist to `visibility = 'ultra_private'`, request as a logged-in non-admin → 403. Request as admin → 200.
- Request the same track's audio file path directly (swap the thumbnail extension for `.opus`/whatever the real downloaded extension is) → 404, regardless of visibility or session state.
- Request a path with `../` segments → 403 (containment) or 400 (malformed), not a successful file read outside the music downloads directory.
- Request a thumbnail path for a nonexistent track id → 404.
