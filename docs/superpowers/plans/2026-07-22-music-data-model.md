# Music Content Data Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the four database tables that back YouKeep's future Music mode — `music_artists`, `music_albums`, `music_tracks`, `music_track_artists` — with no application logic on top of them yet.

**Architecture:** Pure schema addition. Four `CREATE TABLE IF NOT EXISTS` statements added to the existing table-creation block in `server/utils/db.ts`, following the exact style already used there for `channels`/`videos`/`playlists`/`playlist_videos`. No new files, no API routes, no UI.

**Tech Stack:** better-sqlite3 (synchronous SQLite driver already in use), TypeScript.

## Global Constraints

- Four tables only, exactly as specified in the design: `music_artists`, `music_albums`, `music_tracks`, `music_track_artists`.
- `music_artists.channel_id` is nullable and `UNIQUE` — an artist may exist with no followed YouTube channel (feat-only artists).
- `music_albums.source` is constrained to `'youtube'` or `'manual'`.
- `music_track_artists.role` is constrained to `'primary'` or `'feat'`, with a composite primary key `(track_id, artist_id)`.
- Deleting an album must set its tracks' `album_id` to `NULL`, not delete the tracks (`ON DELETE SET NULL`).
- Deleting an artist must cascade to their albums, tracks, and track-artist credit rows (`ON DELETE CASCADE`).
- No ingestion pipeline, UI, player, module toggle, or per-user access control in this plan — schema only.

---

### Task 1: Add the four music tables

**Files:**
- Modify: `server/utils/db.ts:185-193` (end of the existing `CREATE TABLE` block, immediately after `playlist_videos`)

**Interfaces:**
- Consumes: nothing — this is the first piece of the Music mode initiative, no prior task to build on.
- Produces: four tables (`music_artists`, `music_albums`, `music_tracks`, `music_track_artists`) with the exact column names, types, and constraints below. Every future Music mode sub-project (ingestion, UI, player) depends on these exact names and shapes — do not rename or restructure without updating this plan.

This is the current end of the table-creation block:

```typescript
    CREATE TABLE IF NOT EXISTS playlist_videos (
      playlist_id TEXT NOT NULL,
      video_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      PRIMARY KEY (playlist_id, video_id),
      FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
      FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE
    );
  `);

  // Run schema updates if columns are missing (database migration)
```

- [ ] **Step 1: Add the four `CREATE TABLE IF NOT EXISTS` statements**

In `server/utils/db.ts`, insert the following immediately after the `playlist_videos` table's closing `);` and before the closing `` `); `` of the `db.exec(...)` block (i.e. right before the `// Run schema updates if columns are missing` comment):

```typescript
    CREATE TABLE IF NOT EXISTS music_artists (
      id TEXT PRIMARY KEY,
      channel_id TEXT UNIQUE,
      name TEXT NOT NULL,
      description TEXT,
      avatar_url TEXT,
      banner_url TEXT,
      sync_status TEXT DEFAULT 'paused',
      visibility TEXT DEFAULT 'public',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS music_albums (
      id TEXT PRIMARY KEY,
      artist_id TEXT NOT NULL,
      title TEXT NOT NULL,
      release_year INTEGER,
      cover_url TEXT,
      source TEXT NOT NULL CHECK(source IN ('youtube', 'manual')),
      created_at INTEGER NOT NULL,
      FOREIGN KEY (artist_id) REFERENCES music_artists(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS music_tracks (
      id TEXT PRIMARY KEY,
      artist_id TEXT NOT NULL,
      album_id TEXT,
      title TEXT NOT NULL,
      track_number INTEGER,
      genre TEXT,
      language TEXT,
      duration INTEGER,
      view_count INTEGER,
      upload_date TEXT,
      download_status TEXT DEFAULT 'pending',
      download_progress INTEGER DEFAULT 0,
      download_speed TEXT,
      download_eta TEXT,
      last_error TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (artist_id) REFERENCES music_artists(id) ON DELETE CASCADE,
      FOREIGN KEY (album_id) REFERENCES music_albums(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS music_track_artists (
      track_id TEXT NOT NULL,
      artist_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('primary', 'feat')),
      PRIMARY KEY (track_id, artist_id),
      FOREIGN KEY (track_id) REFERENCES music_tracks(id) ON DELETE CASCADE,
      FOREIGN KEY (artist_id) REFERENCES music_artists(id) ON DELETE CASCADE
    );
```

The block should read, in full, from `playlist_videos` onward:

```typescript
    CREATE TABLE IF NOT EXISTS playlist_videos (
      playlist_id TEXT NOT NULL,
      video_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      PRIMARY KEY (playlist_id, video_id),
      FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
      FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS music_artists (
      id TEXT PRIMARY KEY,
      channel_id TEXT UNIQUE,
      name TEXT NOT NULL,
      description TEXT,
      avatar_url TEXT,
      banner_url TEXT,
      sync_status TEXT DEFAULT 'paused',
      visibility TEXT DEFAULT 'public',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS music_albums (
      id TEXT PRIMARY KEY,
      artist_id TEXT NOT NULL,
      title TEXT NOT NULL,
      release_year INTEGER,
      cover_url TEXT,
      source TEXT NOT NULL CHECK(source IN ('youtube', 'manual')),
      created_at INTEGER NOT NULL,
      FOREIGN KEY (artist_id) REFERENCES music_artists(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS music_tracks (
      id TEXT PRIMARY KEY,
      artist_id TEXT NOT NULL,
      album_id TEXT,
      title TEXT NOT NULL,
      track_number INTEGER,
      genre TEXT,
      language TEXT,
      duration INTEGER,
      view_count INTEGER,
      upload_date TEXT,
      download_status TEXT DEFAULT 'pending',
      download_progress INTEGER DEFAULT 0,
      download_speed TEXT,
      download_eta TEXT,
      last_error TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (artist_id) REFERENCES music_artists(id) ON DELETE CASCADE,
      FOREIGN KEY (album_id) REFERENCES music_albums(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS music_track_artists (
      track_id TEXT NOT NULL,
      artist_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('primary', 'feat')),
      PRIMARY KEY (track_id, artist_id),
      FOREIGN KEY (track_id) REFERENCES music_tracks(id) ON DELETE CASCADE,
      FOREIGN KEY (artist_id) REFERENCES music_artists(id) ON DELETE CASCADE
    );
  `);

  // Run schema updates if columns are missing (database migration)
```

- [ ] **Step 2: Verify the tables are created**

Write a throwaway verification script (same technique used earlier in this project — see the `syncChannelPlaylists`/`max_concurrent_downloads` debugging sessions — to exercise `server/utils/db.ts` directly without a compiled build):

```bash
cat > scratch_verify_music_tables.ts <<'EOF'
import { getDb } from './server/utils/db';

const db = getDb();
const tables = db.prepare(`
  SELECT name FROM sqlite_master
  WHERE type = 'table' AND name LIKE 'music_%'
  ORDER BY name
`).all();
console.log('Music tables found:', tables);

for (const t of ['music_artists', 'music_albums', 'music_tracks', 'music_track_artists']) {
  const cols = db.prepare(`PRAGMA table_info(${t})`).all();
  console.log(`\n${t} columns:`, cols.map((c: any) => `${c.name} ${c.type}`));
}
EOF
npx --yes tsx scratch_verify_music_tables.ts
rm -f scratch_verify_music_tables.ts
```

Expected: prints all four table names under "Music tables found", and each table's column list lines up with the schema in Step 1 (e.g. `music_artists columns: [ 'id TEXT', 'channel_id TEXT', 'name TEXT', 'description TEXT', 'avatar_url TEXT', 'banner_url TEXT', 'sync_status TEXT', 'visibility TEXT', 'created_at INTEGER' ]`).

- [ ] **Step 3: Verify insert/constraint/cascade behavior with real data**

This is pure DDL with no application code to unit test — the meaningful verification is exercising the constraints directly, per the design spec's Verification section. Write and run a second throwaway script:

```bash
cat > scratch_verify_music_constraints.ts <<'EOF'
import crypto from 'crypto';
import { getDb } from './server/utils/db';

const db = getDb();
const now = Date.now();

// 1. Insert a primary artist (with a channel_id) and a feat-only artist (no channel_id)
const primaryArtistId = crypto.randomUUID();
const featArtistId = crypto.randomUUID();
db.prepare(`INSERT INTO music_artists (id, channel_id, name, created_at) VALUES (?, ?, ?, ?)`)
  .run(primaryArtistId, 'UCsomeChannelId123', 'Primary Artist', now);
db.prepare(`INSERT INTO music_artists (id, channel_id, name, created_at) VALUES (?, ?, ?, ?)`)
  .run(featArtistId, null, 'Feat-Only Artist', now);
console.log('1. Inserted primary + feat-only artists: OK');

// 2. Insert an album under the primary artist
const albumId = crypto.randomUUID();
db.prepare(`INSERT INTO music_albums (id, artist_id, title, release_year, source, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
  .run(albumId, primaryArtistId, 'Test Album', 2024, 'manual', now);
console.log('2. Inserted album: OK');

// 3. Insert a track under that album, attributed to the primary artist
const trackId = crypto.randomUUID();
db.prepare(`INSERT INTO music_tracks (id, artist_id, album_id, title, genre, language, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
  .run(trackId, primaryArtistId, albumId, 'Test Track', 'Electronic', 'fr', now);
console.log('3. Inserted track: OK');

// 4. Credit both artists on the track (primary + feat)
db.prepare(`INSERT INTO music_track_artists (track_id, artist_id, role) VALUES (?, ?, ?)`)
  .run(trackId, primaryArtistId, 'primary');
db.prepare(`INSERT INTO music_track_artists (track_id, artist_id, role) VALUES (?, ?, ?)`)
  .run(trackId, featArtistId, 'feat');
console.log('4. Inserted primary + feat credits: OK');

// 5. Delete the album — track should survive with album_id set to NULL
db.prepare(`DELETE FROM music_albums WHERE id = ?`).run(albumId);
const trackAfterAlbumDelete = db.prepare(`SELECT album_id FROM music_tracks WHERE id = ?`).get(trackId) as { album_id: string | null };
console.log('5. Track album_id after album delete (expect null):', trackAfterAlbumDelete.album_id);

// 6. Delete the primary artist — their track and its credit rows should cascade-delete;
//    the feat-only artist (unrelated row) must survive.
db.prepare(`DELETE FROM music_artists WHERE id = ?`).run(primaryArtistId);
const trackAfterArtistDelete = db.prepare(`SELECT * FROM music_tracks WHERE id = ?`).get(trackId);
const creditsAfterArtistDelete = db.prepare(`SELECT * FROM music_track_artists WHERE track_id = ?`).all(trackId);
const featArtistStillExists = db.prepare(`SELECT * FROM music_artists WHERE id = ?`).get(featArtistId);
console.log('6a. Track after primary artist delete (expect undefined):', trackAfterArtistDelete);
console.log('6b. Track-artist credits after cascade (expect []):', creditsAfterArtistDelete);
console.log('6c. Feat-only artist still exists (expect defined):', !!featArtistStillExists);

// 7. Attempt to insert a second artist with a duplicate channel_id — must fail
try {
  db.prepare(`INSERT INTO music_artists (id, channel_id, name, created_at) VALUES (?, ?, ?, ?)`)
    .run(crypto.randomUUID(), 'UCsomeChannelId123', 'Duplicate Channel Artist', now);
  console.log('7. UNIQUE constraint check: FAILED (insert should have been rejected)');
} catch (err: any) {
  console.log('7. UNIQUE constraint check: OK (rejected as expected) —', err.message);
}

// Cleanup: remove the feat-only artist left over from this run
db.prepare(`DELETE FROM music_artists WHERE id = ?`).run(featArtistId);
console.log('\nCleanup done.');
EOF
npx --yes tsx scratch_verify_music_constraints.ts
rm -f scratch_verify_music_constraints.ts
```

Expected output, in order:
1. `1. Inserted primary + feat-only artists: OK`
2. `2. Inserted album: OK`
3. `3. Inserted track: OK`
4. `4. Inserted primary + feat credits: OK`
5. `5. Track album_id after album delete (expect null): null`
6. `6a. Track after primary artist delete (expect undefined): undefined`
   `6b. Track-artist credits after cascade (expect []): []`
   `6c. Feat-only artist still exists (expect defined): true`
7. `7. UNIQUE constraint check: OK (rejected as expected) — ...` (with a SQLite UNIQUE constraint error message)
8. `Cleanup done.`

If any line doesn't match (e.g. the track still exists after its album is deleted, or the artist cascade doesn't propagate), the foreign key clauses in Step 1 are wrong — fix them and re-run this script before proceeding. Do not proceed to commit with a failing verification script.

- [ ] **Step 4: Commit**

```bash
git add server/utils/db.ts
git commit -m "feat: add music content data model (artists, albums, tracks, credits)

First sub-project of Music mode: four new tables independent of the
existing video schema, with many-to-many feat credits via
music_track_artists and genre/language/release-year filtering fields.
No ingestion, UI, player, or module toggle yet — schema only."
```
