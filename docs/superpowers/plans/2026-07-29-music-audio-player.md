# Music Audio Player & Smart Playlists Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let any user with access play music tracks from `/music` through a persistent bottom mini-player with shuffle/repeat/localStorage-resume, and surface four heuristic "automatic playlists" (most played, recently added, rediscover, per-genre mixes) that start playback immediately when clicked.

**Architecture:** `server/routes/downloads-music/[...path].ts` gains Range-request-capable audio streaming alongside its existing image serving. A new `music_play_history` table backs a play-recording endpoint and four playlist-read endpoints. A global `useMusicPlayer` composable (Nuxt `useState`, matching `useAuth`'s pattern) holds all playback state including shuffle/repeat/localStorage logic; a persistent `MusicMiniPlayer.vue` mounted in `app/layouts/default.vue` owns the actual `<audio>` element and survives navigation. `/music`'s track rows and a new "Playlists automatiques" section both feed the same `play()` entrypoint.

**Tech Stack:** Nuxt 4 / Nitro (H3), better-sqlite3, Vue 3 Composition API, Vitest.

## Global Constraints

- Only `download_status = 'completed'` tracks are ever playable, listed, or countable, exactly like every other Music mode read path.
- Visibility filtering is the same three-tier logic used throughout Music mode (guest→public, user→public+private, admin→all), applied via `canAccessMusicTrack` for the streaming/play-record endpoints and inline SQL clauses (matching the pattern in `server/api/music/artists/index.get.ts`) for the playlist list endpoints.
- Play-history recording and the "most played"/"rediscover" playlists require a logged-in session; they return empty/no-op for guests rather than erroring — playback itself is never blocked by auth.
- No `localStorage` persistence beyond what's explicitly designed here (track/queue/position/shuffle/repeat) — no other app state piggybacks on this key.
- No audio content analysis or ML — every "smart" feature here is a SQL query over metadata and play counts.
- Endpoints tested via Vitest need an explicit relative import for any project-local utility (`getDb`, `getUserFromSession`, `canAccessMusicTrack`, etc.) because Nitro's auto-import doesn't apply when a test imports the handler directly — write the test first, let the failure name the import, don't pre-guess the path (this has held in every endpoint task across Music mode so far).
- Type-checking requires `npx vue-tsc -b --noEmit` — plain `vue-tsc --noEmit -p .` is a silent no-op and must never be used as a verification step.
- All new user-facing UI copy is in French.
- `server/routes/downloads-music/[...path].ts` has no existing Vitest test file (sub-project 3a verified it live, not via unit tests, since it needs real files on disk) — this plan follows the same precedent for its audio extension: verified via manual/curl checks, not new test infrastructure.

---

### Task 1: `music_play_history` table + test fixtures

**Files:**
- Modify: `server/utils/db.ts`
- Modify: `tests/helpers/testDb.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `music_play_history` table (real + test schema) with columns `id, track_id, user_id, played_at`. Extended `insertMusicTrack` accepting `localFilePath`. New `insertMusicPlay(db, opts)` test helper. Consumed by Tasks 3, 4, 5's tests.

- [ ] **Step 1: Add the real table and index**

Open `server/utils/db.ts`. Find the `music_track_artists` table definition, immediately followed by the closing `` `); `` of the big schema block:

```sql
    CREATE TABLE IF NOT EXISTS music_track_artists (
      track_id TEXT NOT NULL,
      artist_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('primary', 'feat')),
      PRIMARY KEY (track_id, artist_id),
      FOREIGN KEY (track_id) REFERENCES music_tracks(id) ON DELETE CASCADE,
      FOREIGN KEY (artist_id) REFERENCES music_artists(id) ON DELETE CASCADE
    );
  `);
```

Insert a new table definition immediately before that closing `` `); ``:

```sql
    CREATE TABLE IF NOT EXISTS music_track_artists (
      track_id TEXT NOT NULL,
      artist_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('primary', 'feat')),
      PRIMARY KEY (track_id, artist_id),
      FOREIGN KEY (track_id) REFERENCES music_tracks(id) ON DELETE CASCADE,
      FOREIGN KEY (artist_id) REFERENCES music_artists(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS music_play_history (
      id TEXT PRIMARY KEY,
      track_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      played_at INTEGER NOT NULL,
      FOREIGN KEY (track_id) REFERENCES music_tracks(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
```

Then find the indexes block:

```sql
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_videos_channel_id ON videos(channel_id);
    CREATE INDEX IF NOT EXISTS idx_videos_download_status ON videos(download_status);
    CREATE INDEX IF NOT EXISTS idx_videos_visibility ON videos(visibility);
    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_history_user_id ON user_history(user_id);
    CREATE INDEX IF NOT EXISTS idx_personal_playlist_videos_playlist_id ON personal_playlist_videos(playlist_id);
  `);
```

Add one line to it:

```sql
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_videos_channel_id ON videos(channel_id);
    CREATE INDEX IF NOT EXISTS idx_videos_download_status ON videos(download_status);
    CREATE INDEX IF NOT EXISTS idx_videos_visibility ON videos(visibility);
    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_history_user_id ON user_history(user_id);
    CREATE INDEX IF NOT EXISTS idx_personal_playlist_videos_playlist_id ON personal_playlist_videos(playlist_id);
    CREATE INDEX IF NOT EXISTS idx_music_play_history_user_track ON music_play_history(user_id, track_id);
  `);
```

- [ ] **Step 2: Extend the test schema and fixtures**

Open `tests/helpers/testDb.ts`. In the `music_tracks` table definition inside `createTestDb()`, add a `local_file_path` column (the real schema already has it; the test schema never did because no prior sub-project needed to read it):

Find:
```sql
    CREATE TABLE music_tracks (
      id TEXT PRIMARY KEY,
      artist_id TEXT NOT NULL,
      album_id TEXT,
      title TEXT NOT NULL,
      track_number INTEGER,
      genre TEXT,
      language TEXT,
      duration INTEGER,
      download_status TEXT DEFAULT 'completed',
      local_thumbnail_path TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (artist_id) REFERENCES music_artists(id) ON DELETE CASCADE,
      FOREIGN KEY (album_id) REFERENCES music_albums(id) ON DELETE SET NULL
    );
  `);
```

Replace with (adds `local_file_path` to the table, and a new `music_play_history` table after it):
```sql
    CREATE TABLE music_tracks (
      id TEXT PRIMARY KEY,
      artist_id TEXT NOT NULL,
      album_id TEXT,
      title TEXT NOT NULL,
      track_number INTEGER,
      genre TEXT,
      language TEXT,
      duration INTEGER,
      download_status TEXT DEFAULT 'completed',
      local_file_path TEXT,
      local_thumbnail_path TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (artist_id) REFERENCES music_artists(id) ON DELETE CASCADE,
      FOREIGN KEY (album_id) REFERENCES music_albums(id) ON DELETE SET NULL
    );

    CREATE TABLE music_play_history (
      id TEXT PRIMARY KEY,
      track_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      played_at INTEGER NOT NULL,
      FOREIGN KEY (track_id) REFERENCES music_tracks(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
```

Now extend `insertMusicTrack` to accept `localFilePath`. Find:
```ts
export function insertMusicTrack(db: Database.Database, opts: {
  id: string;
  artistId: string;
  albumId?: string | null;
  trackNumber?: number | null;
  genre?: string | null;
  language?: string | null;
  duration?: number | null;
  downloadStatus?: string;
  localThumbnailPath?: string | null;
  createdAt?: number;
}) {
  db.prepare(`
    INSERT INTO music_tracks (id, artist_id, album_id, title, track_number, genre, language, duration, download_status, local_thumbnail_path, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    opts.id,
    opts.artistId,
    opts.albumId ?? null,
    `Track ${opts.id}`,
    opts.trackNumber ?? null,
    opts.genre ?? null,
    opts.language ?? null,
    opts.duration ?? null,
    opts.downloadStatus ?? 'completed',
    opts.localThumbnailPath ?? null,
    opts.createdAt ?? Date.now()
  );
}
```

Replace with:
```ts
export function insertMusicTrack(db: Database.Database, opts: {
  id: string;
  artistId: string;
  albumId?: string | null;
  trackNumber?: number | null;
  genre?: string | null;
  language?: string | null;
  duration?: number | null;
  downloadStatus?: string;
  localFilePath?: string | null;
  localThumbnailPath?: string | null;
  createdAt?: number;
}) {
  db.prepare(`
    INSERT INTO music_tracks (id, artist_id, album_id, title, track_number, genre, language, duration, download_status, local_file_path, local_thumbnail_path, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    opts.id,
    opts.artistId,
    opts.albumId ?? null,
    `Track ${opts.id}`,
    opts.trackNumber ?? null,
    opts.genre ?? null,
    opts.language ?? null,
    opts.duration ?? null,
    opts.downloadStatus ?? 'completed',
    opts.localFilePath ?? null,
    opts.localThumbnailPath ?? null,
    opts.createdAt ?? Date.now()
  );
}
```

Finally, add a new `insertMusicPlay` helper at the end of the file:
```ts
export function insertMusicPlay(db: Database.Database, opts: { id: string; trackId: string; userId: string; playedAt?: number }) {
  db.prepare(`
    INSERT INTO music_play_history (id, track_id, user_id, played_at)
    VALUES (?, ?, ?, ?)
  `).run(opts.id, opts.trackId, opts.userId, opts.playedAt ?? Date.now());
}
```

- [ ] **Step 3: Run the full suite to confirm no regressions**

Run: `npm test -- --run`
Expected: all 130 existing tests still pass (schema/fixture changes are additive: a new column with no `NOT NULL` constraint, a new optional fixture field, a new table, a new helper function — no existing call site is affected).

- [ ] **Step 4: Commit**

```bash
git add server/utils/db.ts tests/helpers/testDb.ts
git commit -m "feat: add music_play_history table and test fixtures"
```

---

### Task 2: Audio streaming support in `downloads-music` route

**Files:**
- Modify: `server/routes/downloads-music/[...path].ts`

**Interfaces:**
- Consumes: `canAccessMusicTrack`, `getMusicDownloadsDir`, `sanitizeFolderName` (all existing, ambient Nitro auto-imports, unchanged usage).
- Produces: nothing consumed by a later task in this plan (the mini-player just requests `local_file_path` URLs directly, no new interface).

- [ ] **Step 1: Replace the file content**

Read the current file (`server/routes/downloads-music/[...path].ts`) first, then replace its entire content with:

```ts
import fs from 'fs';
import path from 'path';
import { defineEventHandler, createError } from 'h3';

const IMAGE_CONTENT_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.png': 'image/png',
};

const AUDIO_CONTENT_TYPES: Record<string, string> = {
  '.m4a': 'audio/mp4',
  '.opus': 'audio/opus',
  '.webm': 'audio/webm',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
};

export default defineEventHandler(async (event) => {
  const filePath = event.context.params?.path;
  if (!filePath) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid file path' });
  }

  // Files are always stored flat as {artistDir}/{trackId}.{ext} — exactly two
  // path segments, no nesting.
  const parts = filePath.split('/');
  if (parts.length !== 2) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid file path' });
  }

  const fileName = parts[1] || '';
  const ext = path.extname(fileName).toLowerCase();
  const isAudio = ext in AUDIO_CONTENT_TYPES;
  const contentType = isAudio ? AUDIO_CONTENT_TYPES[ext] : IMAGE_CONTENT_TYPES[ext];
  if (!contentType) {
    // Includes any extension outside both maps — a 404 here reveals nothing
    // about whether a differently-extensioned file exists at this path.
    throw createError({ statusCode: 404, statusMessage: 'File not found' });
  }

  const trackId = fileName.slice(0, fileName.length - ext.length);
  const db = getDb();

  const track = db.prepare(`
    SELECT t.id, a.id as artist_id, a.name as artist_name
    FROM music_tracks t
    JOIN music_artists a ON t.artist_id = a.id
    WHERE t.id = ?
  `).get(trackId) as { id: string; artist_id: string; artist_name: string } | undefined;

  if (!track) {
    throw createError({ statusCode: 404, statusMessage: 'File not found' });
  }

  const hasAccess = await canAccessMusicTrack(trackId, event);
  if (!hasAccess) {
    throw createError({ statusCode: 403, statusMessage: 'Accès refusé. Ce contenu est restreint.' });
  }

  const downloadsDir = getMusicDownloadsDir();
  const artistDir = path.resolve(downloadsDir, sanitizeFolderName(track.artist_name || track.artist_id));
  const resolvedPath = path.resolve(artistDir, fileName);

  // Containment check: resolvedPath must stay inside artistDir.
  const relativeToArtistDir = path.relative(artistDir, resolvedPath);
  if (relativeToArtistDir.startsWith('..') || path.isAbsolute(relativeToArtistDir)) {
    throw createError({ statusCode: 403, statusMessage: 'Access denied' });
  }

  // Belt-and-braces: resolvedPath must also stay inside the overall music downloads dir.
  const relativeToDownloadsDir = path.relative(downloadsDir, resolvedPath);
  if (relativeToDownloadsDir.startsWith('..') || path.isAbsolute(relativeToDownloadsDir)) {
    throw createError({ statusCode: 403, statusMessage: 'Access denied' });
  }

  if (!fs.existsSync(resolvedPath)) {
    throw createError({ statusCode: 404, statusMessage: 'File not found' });
  }

  const stat = fs.statSync(resolvedPath);

  if (!isAudio) {
    event.node.res.setHeader('Content-Type', contentType);
    event.node.res.setHeader('Content-Length', stat.size);
    event.node.res.statusCode = 200;
    return fs.createReadStream(resolvedPath);
  }

  // Audio: support HTTP Range requests so the <audio> element can seek
  // without downloading the whole file — mirrors server/routes/downloads/[...path].ts's
  // existing video-streaming Range logic verbatim.
  const fileSize = stat.size;
  const range = event.node.req.headers.range;

  event.node.res.setHeader('Accept-Ranges', 'bytes');
  event.node.res.setHeader('Content-Type', contentType);

  if (range) {
    const rangeParts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(rangeParts[0] || '0', 10);
    const end = rangeParts[1] ? parseInt(rangeParts[1], 10) : fileSize - 1;

    if (start >= fileSize || end >= fileSize) {
      event.node.res.statusCode = 416;
      event.node.res.setHeader('Content-Range', `bytes */${fileSize}`);
      return 'Requested range not satisfiable';
    }

    const chunksize = (end - start) + 1;
    const fileStream = fs.createReadStream(resolvedPath, { start, end });

    event.node.res.statusCode = 206;
    event.node.res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
    event.node.res.setHeader('Content-Length', chunksize);

    return fileStream;
  }

  event.node.res.statusCode = 200;
  event.node.res.setHeader('Content-Length', fileSize);
  return fs.createReadStream(resolvedPath);
});
```

- [ ] **Step 2: Manual verification**

Using a real downloaded track from prior sub-projects' live tests (e.g. a GIMS track with a known `local_file_path` like `/downloads-music/GIMS/<trackId>.m4a`):

```bash
curl -sI http://localhost:3100/downloads-music/GIMS/<trackId>.m4a
```
Expected: `200`, `Content-Type: audio/mp4` (or the matching type for whatever extension that file actually has), `Accept-Ranges: bytes`.

```bash
curl -sI -H "Range: bytes=0-1023" http://localhost:3100/downloads-music/GIMS/<trackId>.m4a
```
Expected: `206 Partial Content`, `Content-Range: bytes 0-1023/<total-size>`, `Content-Length: 1024`.

Also confirm the existing image-serving behavior is unaffected: request a known thumbnail path, confirm `200` with the correct image `Content-Type` and no `Accept-Ranges` header (images still use the unchanged, non-Range code path).

- [ ] **Step 3: Commit**

```bash
git add server/routes/downloads-music/\[...path\].ts
git commit -m "feat: add audio streaming with Range support to music file-serving route"
```

---

### Task 3: `POST /api/music/tracks/[id]/play`

**Files:**
- Create: `server/api/music/tracks/[id]/play.post.ts`
- Test: `tests/integration/music-track-play.test.ts`

**Interfaces:**
- Consumes: `getUserFromSession`, `canAccessMusicTrack` (existing, `server/utils/auth.ts`), `insertMusicPlay` (Task 1).
- Produces: `POST /api/music/tracks/:id/play` response shape `{ recorded: boolean }`. Consumed by Task 7's mini-player (`recordPlayIfThresholdReached`).

- [ ] **Step 1: Write the failing tests**

Create `tests/integration/music-track-play.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import handler from '../../server/api/music/tracks/[id]/play.post';
import {
  createTestDb,
  insertUser,
  insertSession,
  insertMusicArtist,
  insertMusicTrack,
  mockEvent,
  sessionCookie
} from '../helpers/testDb';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
});

function loginAs(userId: string, role: 'admin' | 'user' = 'user') {
  insertUser(db, { id: userId, role });
  const sessionId = `sess-${userId}`;
  insertSession(db, { id: sessionId, userId });
  return sessionCookie(sessionId);
}

function eventFor(trackId: string, cookieHeader?: string) {
  return mockEvent(cookieHeader, { path: `/api/music/tracks/${trackId}/play`, params: { id: trackId } });
}

describe('POST /api/music/tracks/[id]/play', () => {
  it('returns 404 for a nonexistent track', async () => {
    const cookie = loginAs('u1');
    await expect(handler(eventFor('missing', cookie))).rejects.toMatchObject({ statusCode: 404 });
  });

  it('returns 403 for a private track requested by a guest', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'private' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });
    await expect(handler(eventFor('t1'))).rejects.toMatchObject({ statusCode: 403 });
  });

  it('does not record a play and returns recorded:false for a guest on a public track', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'public' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });

    const result: any = await handler(eventFor('t1'));
    expect(result.recorded).toBe(false);
    const rows = db.prepare('SELECT COUNT(*) as cnt FROM music_play_history').get() as { cnt: number };
    expect(rows.cnt).toBe(0);
  });

  it('records a play for a logged-in user on an accessible track', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'public' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });
    const cookie = loginAs('u1');

    const result: any = await handler(eventFor('t1', cookie));
    expect(result.recorded).toBe(true);
    const rows = db.prepare('SELECT track_id, user_id FROM music_play_history').all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].track_id).toBe('t1');
    expect(rows[0].user_id).toBe('u1');
  });

  it('inserts a new row on each call rather than upserting a count', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'public' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });
    const cookie = loginAs('u1');

    await handler(eventFor('t1', cookie));
    await handler(eventFor('t1', cookie));
    const rows = db.prepare('SELECT COUNT(*) as cnt FROM music_play_history').get() as { cnt: number };
    expect(rows.cnt).toBe(2);
  });

  it('returns 403 for a logged-in user on an ultra_private track they cannot access', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'ultra_private' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });
    const cookie = loginAs('u1');
    await expect(handler(eventFor('t1', cookie))).rejects.toMatchObject({ statusCode: 403 });
  });

  it('records a play for an admin on an ultra_private track', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'ultra_private' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });
    const cookie = loginAs('admin1', 'admin');

    const result: any = await handler(eventFor('t1', cookie));
    expect(result.recorded).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/integration/music-track-play.test.ts`
Expected: FAIL with a module-not-found error for `server/api/music/tracks/[id]/play.post`.

- [ ] **Step 3: Implement the endpoint**

Create `server/api/music/tracks/[id]/play.post.ts`:

```ts
import { defineEventHandler, createError } from 'h3';
import crypto from 'crypto';

export default defineEventHandler(async (event) => {
  const trackId = event.context.params?.id;
  if (!trackId) {
    throw createError({ statusCode: 400, statusMessage: 'Track ID is required.' });
  }

  const db = getDb();

  const track = db.prepare('SELECT id FROM music_tracks WHERE id = ?').get(trackId);
  if (!track) {
    throw createError({ statusCode: 404, statusMessage: 'Track not found.' });
  }

  const hasAccess = await canAccessMusicTrack(trackId, event);
  if (!hasAccess) {
    throw createError({ statusCode: 403, statusMessage: 'Access denied.' });
  }

  const session = await getUserFromSession(event);
  if (!session) {
    // Guests can listen but their plays aren't recorded.
    return { recorded: false };
  }

  db.prepare(`
    INSERT INTO music_play_history (id, track_id, user_id, played_at)
    VALUES (?, ?, ?, ?)
  `).run(crypto.randomUUID(), trackId, session.id, Date.now());

  return { recorded: true };
});
```

If the test run fails with a "not defined" error for `canAccessMusicTrack` or `getUserFromSession`, add the exact explicit relative import the failure demands (this file is at `server/api/music/tracks/[id]/play.post.ts`, 4 directories below `server/` — count from there rather than assuming).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/integration/music-track-play.test.ts`
Expected: PASS (all 7 tests)

- [ ] **Step 5: Run the full suite to confirm no regressions**

Run: `npm test -- --run`

- [ ] **Step 6: Commit**

```bash
git add server/api/music/tracks/\[id\]/play.post.ts tests/integration/music-track-play.test.ts
git commit -m "feat: add POST /api/music/tracks/[id]/play endpoint"
```

---

### Task 4: `POST /api/music/tracks/by-ids`

**Files:**
- Create: `server/api/music/tracks/by-ids.post.ts`
- Test: `tests/integration/music-tracks-by-ids.test.ts`

**Interfaces:**
- Consumes: `getDb`, `canAccessMusicTrack` (existing).
- Produces: `POST /api/music/tracks/by-ids` response shape `{ tracks: Array<{ id, title, track_number, genre, language, duration, local_file_path, local_thumbnail_path, artist_id, artist_name }> }`, ordered to match the requested `ids` array. Consumed by Task 6's `restoreFromLocalStorage`.

- [ ] **Step 1: Write the failing tests**

Create `tests/integration/music-tracks-by-ids.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import handler from '../../server/api/music/tracks/by-ids.post';
import {
  createTestDb,
  insertUser,
  insertSession,
  insertMusicArtist,
  insertMusicTrack,
  mockEvent,
  sessionCookie
} from '../helpers/testDb';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
});

function loginAs(userId: string, role: 'admin' | 'user' = 'user') {
  insertUser(db, { id: userId, role });
  const sessionId = `sess-${userId}`;
  insertSession(db, { id: sessionId, userId });
  return sessionCookie(sessionId);
}

function eventFor(ids: any, cookieHeader?: string) {
  return mockEvent(cookieHeader, { path: '/api/music/tracks/by-ids', body: { ids } });
}

describe('POST /api/music/tracks/by-ids', () => {
  it('returns 400 when ids is missing or not an array', async () => {
    await expect(handler(eventFor(undefined))).rejects.toMatchObject({ statusCode: 400 });
    await expect(handler(eventFor('not-an-array'))).rejects.toMatchObject({ statusCode: 400 });
  });

  it('returns an empty list for an empty ids array', async () => {
    const result: any = await handler(eventFor([]));
    expect(result.tracks).toEqual([]);
  });

  it('returns matching tracks preserving the requested order', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'public' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', localFilePath: '/downloads-music/a1/t1.m4a' });
    insertMusicTrack(db, { id: 't2', artistId: 'a1', localFilePath: '/downloads-music/a1/t2.m4a' });

    const result: any = await handler(eventFor(['t2', 't1']));
    expect(result.tracks.map((t: any) => t.id)).toEqual(['t2', 't1']);
    expect(result.tracks[0].local_file_path).toBe('/downloads-music/a1/t2.m4a');
  });

  it('silently drops ids that do not exist', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'public' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });

    const result: any = await handler(eventFor(['t1', 'missing']));
    expect(result.tracks.map((t: any) => t.id)).toEqual(['t1']);
  });

  it('excludes tracks the requester cannot access', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'ultra_private' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });

    const result: any = await handler(eventFor(['t1']));
    expect(result.tracks).toEqual([]);
  });

  it('includes an ultra_private track for an admin', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'ultra_private' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });
    const cookie = loginAs('admin1', 'admin');

    const result: any = await handler(eventFor(['t1'], cookie));
    expect(result.tracks.map((t: any) => t.id)).toEqual(['t1']);
  });

  it('excludes tracks that are not completed', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'public' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', downloadStatus: 'pending' });

    const result: any = await handler(eventFor(['t1']));
    expect(result.tracks).toEqual([]);
  });

  it('caps the number of ids processed at 200', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'public' });
    const ids: string[] = [];
    for (let i = 0; i < 250; i++) {
      const id = `t${i}`;
      insertMusicTrack(db, { id, artistId: 'a1' });
      ids.push(id);
    }

    const result: any = await handler(eventFor(ids));
    expect(result.tracks.length).toBeLessThanOrEqual(200);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/integration/music-tracks-by-ids.test.ts`
Expected: FAIL with a module-not-found error.

- [ ] **Step 3: Implement the endpoint**

Create `server/api/music/tracks/by-ids.post.ts`:

```ts
import { defineEventHandler, readBody, createError } from 'h3';

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  if (!body || typeof body !== 'object' || !Array.isArray(body.ids)) {
    throw createError({ statusCode: 400, statusMessage: 'ids array is required.' });
  }

  const ids: string[] = body.ids.filter((id: any) => typeof id === 'string').slice(0, 200);
  if (ids.length === 0) {
    return { tracks: [] };
  }

  const db = getDb();
  const placeholders = ids.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT t.id, t.title, t.track_number, t.genre, t.language, t.duration,
           t.local_file_path, t.local_thumbnail_path, t.artist_id, a.name as artist_name
    FROM music_tracks t
    JOIN music_artists a ON t.artist_id = a.id
    WHERE t.id IN (${placeholders}) AND t.download_status = 'completed'
  `).all(...ids) as any[];

  const accessible: any[] = [];
  for (const row of rows) {
    if (await canAccessMusicTrack(row.id, event)) {
      accessible.push(row);
    }
  }

  // Preserve the caller's requested order — the queue restored from
  // localStorage needs to match the order it was saved in, not whatever
  // order SQLite's IN clause happened to return.
  const byId = new Map(accessible.map((r) => [r.id, r]));
  const tracks = ids.map((id) => byId.get(id)).filter(Boolean);

  return { tracks };
});
```

If the test run fails with a "not defined" error for `canAccessMusicTrack`, add the exact explicit relative import the failure demands (this file is at `server/api/music/tracks/by-ids.post.ts`, 3 directories below `server/`).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/integration/music-tracks-by-ids.test.ts`
Expected: PASS (all 8 tests)

- [ ] **Step 5: Run the full suite to confirm no regressions**

Run: `npm test -- --run`

- [ ] **Step 6: Commit**

```bash
git add server/api/music/tracks/by-ids.post.ts tests/integration/music-tracks-by-ids.test.ts
git commit -m "feat: add POST /api/music/tracks/by-ids endpoint"
```

---

### Task 5: Automatic playlist endpoints

**Files:**
- Create: `server/api/music/playlists/most-played.get.ts`
- Create: `server/api/music/playlists/recently-added.get.ts`
- Create: `server/api/music/playlists/rediscover.get.ts`
- Create: `server/api/music/playlists/genre-mix.get.ts`
- Test: `tests/integration/music-playlists.test.ts`

**Interfaces:**
- Consumes: `getDb`, `getUserFromSession` (existing), `insertMusicPlay` (Task 1).
- Produces: four `GET` endpoints, each returning `{ tracks: PlayableTrack[] }` in the same shape as Task 4's `by-ids` response. Consumed by Task 9's playlist cards.

- [ ] **Step 1: Write the failing tests**

Create `tests/integration/music-playlists.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import mostPlayedHandler from '../../server/api/music/playlists/most-played.get';
import recentlyAddedHandler from '../../server/api/music/playlists/recently-added.get';
import rediscoverHandler from '../../server/api/music/playlists/rediscover.get';
import genreMixHandler from '../../server/api/music/playlists/genre-mix.get';
import {
  createTestDb,
  insertUser,
  insertSession,
  insertMusicArtist,
  insertMusicTrack,
  insertMusicPlay,
  mockEvent,
  sessionCookie
} from '../helpers/testDb';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
});

function loginAs(userId: string, role: 'admin' | 'user' = 'user') {
  insertUser(db, { id: userId, role });
  const sessionId = `sess-${userId}`;
  insertSession(db, { id: sessionId, userId });
  return sessionCookie(sessionId);
}

function eventFor(path: string, cookieHeader?: string) {
  return mockEvent(cookieHeader, { path });
}

describe('GET /api/music/playlists/most-played', () => {
  it('returns an empty list for a guest', async () => {
    const result: any = await mostPlayedHandler(eventFor('/api/music/playlists/most-played'));
    expect(result.tracks).toEqual([]);
  });

  it('orders by play count for the current user, ignoring other users\' plays', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'public' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });
    insertMusicTrack(db, { id: 't2', artistId: 'a1' });
    const cookie = loginAs('u1');
    insertUser(db, { id: 'u2', role: 'user' });

    insertMusicPlay(db, { id: 'p1', trackId: 't1', userId: 'u1' });
    insertMusicPlay(db, { id: 'p2', trackId: 't2', userId: 'u1' });
    insertMusicPlay(db, { id: 'p3', trackId: 't2', userId: 'u1' });
    insertMusicPlay(db, { id: 'p4', trackId: 't1', userId: 'u2' });
    insertMusicPlay(db, { id: 'p5', trackId: 't1', userId: 'u2' });
    insertMusicPlay(db, { id: 'p6', trackId: 't1', userId: 'u2' });

    const result: any = await mostPlayedHandler(eventFor('/api/music/playlists/most-played', cookie));
    expect(result.tracks.map((t: any) => t.id)).toEqual(['t2', 't1']);
  });

  it('excludes a private artist for a user without access', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'ultra_private' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });
    const cookie = loginAs('u1');
    insertMusicPlay(db, { id: 'p1', trackId: 't1', userId: 'u1' });

    const result: any = await mostPlayedHandler(eventFor('/api/music/playlists/most-played', cookie));
    expect(result.tracks).toEqual([]);
  });
});

describe('GET /api/music/playlists/recently-added', () => {
  it('works for a guest and orders by created_at descending', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'public' });
    insertMusicTrack(db, { id: 'old', artistId: 'a1', createdAt: 1000 });
    insertMusicTrack(db, { id: 'new', artistId: 'a1', createdAt: 2000 });

    const result: any = await recentlyAddedHandler(eventFor('/api/music/playlists/recently-added'));
    expect(result.tracks.map((t: any) => t.id)).toEqual(['new', 'old']);
  });

  it('excludes tracks that are not completed', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'public' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', downloadStatus: 'pending' });

    const result: any = await recentlyAddedHandler(eventFor('/api/music/playlists/recently-added'));
    expect(result.tracks).toEqual([]);
  });

  it('excludes a private artist for a guest', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'private' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });

    const result: any = await recentlyAddedHandler(eventFor('/api/music/playlists/recently-added'));
    expect(result.tracks).toEqual([]);
  });
});

describe('GET /api/music/playlists/rediscover', () => {
  it('returns an empty list for a guest', async () => {
    const result: any = await rediscoverHandler(eventFor('/api/music/playlists/rediscover'));
    expect(result.tracks).toEqual([]);
  });

  it('excludes a track played by the current user within the last 30 days', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'public' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });
    insertMusicTrack(db, { id: 't2', artistId: 'a1' });
    const cookie = loginAs('u1');
    insertMusicPlay(db, { id: 'p1', trackId: 't1', userId: 'u1', playedAt: Date.now() });

    const result: any = await rediscoverHandler(eventFor('/api/music/playlists/rediscover', cookie));
    expect(result.tracks.map((t: any) => t.id)).toEqual(['t2']);
  });

  it('includes a track played more than 30 days ago', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'public' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });
    const cookie = loginAs('u1');
    const fortyDaysAgo = Date.now() - 1000 * 60 * 60 * 24 * 40;
    insertMusicPlay(db, { id: 'p1', trackId: 't1', userId: 'u1', playedAt: fortyDaysAgo });

    const result: any = await rediscoverHandler(eventFor('/api/music/playlists/rediscover', cookie));
    expect(result.tracks.map((t: any) => t.id)).toEqual(['t1']);
  });
});

describe('GET /api/music/playlists/genre-mix', () => {
  it('returns 400 when genre is missing', async () => {
    await expect(genreMixHandler(eventFor('/api/music/playlists/genre-mix'))).rejects.toMatchObject({ statusCode: 400 });
  });

  it('returns only tracks matching the requested genre, for a guest', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'public' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', genre: 'Rock' });
    insertMusicTrack(db, { id: 't2', artistId: 'a1', genre: 'Electro' });

    const result: any = await genreMixHandler(eventFor('/api/music/playlists/genre-mix?genre=Rock'));
    expect(result.tracks.map((t: any) => t.id)).toEqual(['t1']);
  });

  it('excludes a private artist\'s tracks for a guest', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'private' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', genre: 'Rock' });

    const result: any = await genreMixHandler(eventFor('/api/music/playlists/genre-mix?genre=Rock'));
    expect(result.tracks).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/integration/music-playlists.test.ts`
Expected: FAIL with module-not-found errors for all four handlers.

- [ ] **Step 3: Implement `most-played.get.ts`**

Create `server/api/music/playlists/most-played.get.ts`:

```ts
import { defineEventHandler } from 'h3';

export default defineEventHandler(async (event) => {
  const session = await getUserFromSession(event);
  if (!session) {
    return { tracks: [] };
  }

  const db = getDb();
  const visClause = session.role === 'admin' ? '' : `AND a.visibility IN ('public', 'private')`;

  const rows = db.prepare(`
    SELECT t.id, t.title, t.track_number, t.genre, t.language, t.duration,
           t.local_file_path, t.local_thumbnail_path, t.artist_id, a.name as artist_name,
           COUNT(h.id) as play_count
    FROM music_play_history h
    JOIN music_tracks t ON h.track_id = t.id AND t.download_status = 'completed'
    JOIN music_artists a ON t.artist_id = a.id
    WHERE h.user_id = ? ${visClause}
    GROUP BY t.id
    ORDER BY play_count DESC
    LIMIT 30
  `).all(session.id);

  return { tracks: rows };
});
```

- [ ] **Step 4: Implement `recently-added.get.ts`**

Create `server/api/music/playlists/recently-added.get.ts`:

```ts
import { defineEventHandler } from 'h3';

export default defineEventHandler(async (event) => {
  const session = await getUserFromSession(event);
  const db = getDb();

  let visClause = `AND a.visibility = 'public'`;
  if (session && session.role === 'admin') {
    visClause = '';
  } else if (session) {
    visClause = `AND a.visibility IN ('public', 'private')`;
  }

  const rows = db.prepare(`
    SELECT t.id, t.title, t.track_number, t.genre, t.language, t.duration,
           t.local_file_path, t.local_thumbnail_path, t.artist_id, a.name as artist_name
    FROM music_tracks t
    JOIN music_artists a ON t.artist_id = a.id
    WHERE t.download_status = 'completed' ${visClause}
    ORDER BY t.created_at DESC
    LIMIT 30
  `).all();

  return { tracks: rows };
});
```

- [ ] **Step 5: Implement `rediscover.get.ts`**

Create `server/api/music/playlists/rediscover.get.ts`:

```ts
import { defineEventHandler } from 'h3';

export default defineEventHandler(async (event) => {
  const session = await getUserFromSession(event);
  if (!session) {
    return { tracks: [] };
  }

  const db = getDb();
  const visClause = session.role === 'admin' ? '' : `AND a.visibility IN ('public', 'private')`;
  const thirtyDaysAgo = Date.now() - 1000 * 60 * 60 * 24 * 30;

  const rows = db.prepare(`
    SELECT t.id, t.title, t.track_number, t.genre, t.language, t.duration,
           t.local_file_path, t.local_thumbnail_path, t.artist_id, a.name as artist_name
    FROM music_tracks t
    JOIN music_artists a ON t.artist_id = a.id
    WHERE t.download_status = 'completed' ${visClause}
      AND t.id NOT IN (
        SELECT track_id FROM music_play_history
        WHERE user_id = ? AND played_at > ?
      )
    ORDER BY RANDOM()
    LIMIT 30
  `).all(session.id, thirtyDaysAgo);

  return { tracks: rows };
});
```

- [ ] **Step 6: Implement `genre-mix.get.ts`**

Create `server/api/music/playlists/genre-mix.get.ts`:

```ts
import { defineEventHandler, getQuery, createError } from 'h3';

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const genre = query.genre ? String(query.genre) : null;
  if (!genre) {
    throw createError({ statusCode: 400, statusMessage: 'genre is required.' });
  }

  const session = await getUserFromSession(event);
  const db = getDb();

  let visClause = `AND a.visibility = 'public'`;
  if (session && session.role === 'admin') {
    visClause = '';
  } else if (session) {
    visClause = `AND a.visibility IN ('public', 'private')`;
  }

  const rows = db.prepare(`
    SELECT t.id, t.title, t.track_number, t.genre, t.language, t.duration,
           t.local_file_path, t.local_thumbnail_path, t.artist_id, a.name as artist_name
    FROM music_tracks t
    JOIN music_artists a ON t.artist_id = a.id
    WHERE t.download_status = 'completed' AND t.genre = ? ${visClause}
    ORDER BY RANDOM()
    LIMIT 30
  `).all(genre);

  return { tracks: rows };
});
```

If any test run fails with a "not defined" error for `getUserFromSession`, add the exact explicit relative import the failure demands in that specific file (all four files sit at the same directory depth, `server/api/music/playlists/`, 3 directories below `server/`).

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run tests/integration/music-playlists.test.ts`
Expected: PASS (all 12 tests)

- [ ] **Step 8: Run the full suite to confirm no regressions**

Run: `npm test -- --run`

- [ ] **Step 9: Commit**

```bash
git add server/api/music/playlists/ tests/integration/music-playlists.test.ts
git commit -m "feat: add automatic playlist endpoints (most-played, recently-added, rediscover, genre-mix)"
```

---

### Task 6: `useMusicPlayer` composable

**Files:**
- Create: `app/composables/useMusicPlayer.ts`

**Interfaces:**
- Consumes: nothing new (pure Vue/Nuxt state + `$fetch`).
- Produces: `useMusicPlayer()` returning `{ currentTrack, queue, currentIndex, isPlaying, currentTime, duration, audioEl, shuffleOn, repeatMode, play, togglePlay, seek, next, prev, toggleShuffle, cycleRepeat, recordPlayIfThresholdReached, saveToLocalStorage, restoreFromLocalStorage }`. Consumed by Task 7 (mini-player, the sole owner of the actual `<audio>` element) and Task 8/9 (call `play()` to start playback).

- [ ] **Step 1: Write the composable**

Create `app/composables/useMusicPlayer.ts`:

```ts
export interface PlayableTrack {
  id: string;
  title: string;
  artist_name?: string;
  track_number?: number | null;
  genre?: string | null;
  language?: string | null;
  duration?: number | null;
  local_file_path: string;
  local_thumbnail_path?: string | null;
}

const STORAGE_KEY = 'music_player_state';

export function useMusicPlayer() {
  const currentTrack = useState<PlayableTrack | null>('music_player_current_track', () => null);
  const queue = useState<PlayableTrack[]>('music_player_queue', () => []);
  const currentIndex = useState<number>('music_player_current_index', () => -1);
  const isPlaying = useState<boolean>('music_player_is_playing', () => false);
  const currentTime = useState<number>('music_player_current_time', () => 0);
  const duration = useState<number>('music_player_duration', () => 0);
  const audioEl = useState<HTMLAudioElement | null>('music_player_audio_el', () => null);
  const shuffleOn = useState<boolean>('music_player_shuffle', () => false);
  const repeatMode = useState<'off' | 'all' | 'one'>('music_player_repeat', () => 'off');
  const shuffledOrder = useState<number[] | null>('music_player_shuffled_order', () => null);
  const hasCountedThisPlay = useState<boolean>('music_player_has_counted', () => false);

  function loadTrack(track: PlayableTrack, index: number) {
    currentTrack.value = track;
    currentIndex.value = index;
    hasCountedThisPlay.value = false;
    if (audioEl.value) {
      audioEl.value.src = track.local_file_path;
      audioEl.value.currentTime = 0;
    }
  }

  function generateShuffledOrder(fromIndex: number) {
    const indices = queue.value.map((_, i) => i).filter((i) => i !== fromIndex);
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = indices[i]!;
      indices[i] = indices[j]!;
      indices[j] = tmp;
    }
    shuffledOrder.value = [fromIndex, ...indices];
  }

  function play(track: PlayableTrack, tracks: PlayableTrack[]) {
    const idx = tracks.findIndex((t) => t.id === track.id);
    queue.value = tracks;
    loadTrack(track, idx === -1 ? 0 : idx);
    if (shuffleOn.value) {
      generateShuffledOrder(currentIndex.value);
    }
    if (audioEl.value) {
      audioEl.value.play();
      isPlaying.value = true;
    }
  }

  function togglePlay() {
    if (!audioEl.value || !currentTrack.value) return;
    if (isPlaying.value) {
      audioEl.value.pause();
      isPlaying.value = false;
    } else {
      audioEl.value.play();
      isPlaying.value = true;
    }
  }

  function seek(seconds: number) {
    if (!audioEl.value) return;
    audioEl.value.currentTime = seconds;
    currentTime.value = seconds;
  }

  function toggleShuffle() {
    shuffleOn.value = !shuffleOn.value;
    if (shuffleOn.value) {
      generateShuffledOrder(currentIndex.value);
    } else {
      shuffledOrder.value = null;
    }
  }

  function cycleRepeat() {
    repeatMode.value = repeatMode.value === 'off' ? 'all' : repeatMode.value === 'all' ? 'one' : 'off';
  }

  function nextIndex(): number | null {
    if (queue.value.length === 0) return null;
    if (repeatMode.value === 'one') return currentIndex.value;

    if (shuffleOn.value && shuffledOrder.value) {
      const posInShuffled = shuffledOrder.value.indexOf(currentIndex.value);
      const nextPos = posInShuffled + 1;
      if (nextPos < shuffledOrder.value.length) return shuffledOrder.value[nextPos]!;
      if (repeatMode.value === 'all') {
        generateShuffledOrder(shuffledOrder.value[0]!);
        return shuffledOrder.value[0]!;
      }
      return null;
    }

    const next = currentIndex.value + 1;
    if (next < queue.value.length) return next;
    if (repeatMode.value === 'all') return 0;
    return null;
  }

  function prevIndex(): number | null {
    if (queue.value.length === 0) return null;
    if (shuffleOn.value && shuffledOrder.value) {
      const posInShuffled = shuffledOrder.value.indexOf(currentIndex.value);
      const prevPos = posInShuffled - 1;
      return prevPos >= 0 ? shuffledOrder.value[prevPos]! : null;
    }
    const prev = currentIndex.value - 1;
    return prev >= 0 ? prev : null;
  }

  function next() {
    const idx = nextIndex();
    if (idx === null) return;
    const track = queue.value[idx];
    if (!track) return;
    loadTrack(track, idx);
    if (audioEl.value) {
      audioEl.value.play();
      isPlaying.value = true;
    }
  }

  function prev() {
    const idx = prevIndex();
    if (idx === null) return;
    const track = queue.value[idx];
    if (!track) return;
    loadTrack(track, idx);
    if (audioEl.value) {
      audioEl.value.play();
      isPlaying.value = true;
    }
  }

  function recordPlayIfThresholdReached() {
    if (hasCountedThisPlay.value || !currentTrack.value) return;
    const dur = duration.value || currentTrack.value.duration || 0;
    if (dur <= 0) return;
    const threshold = Math.min(30, dur * 0.5);
    if (currentTime.value >= threshold) {
      hasCountedThisPlay.value = true;
      $fetch(`/api/music/tracks/${currentTrack.value.id}/play`, { method: 'POST' }).catch(() => {});
    }
  }

  function saveToLocalStorage() {
    if (typeof window === 'undefined' || !currentTrack.value) return;
    const state = {
      trackId: currentTrack.value.id,
      queueTrackIds: queue.value.map((t) => t.id),
      currentIndex: currentIndex.value,
      currentTime: currentTime.value,
      shuffleOn: shuffleOn.value,
      repeatMode: repeatMode.value,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  async function restoreFromLocalStorage() {
    if (typeof window === 'undefined') return;
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;

    let saved: any;
    try {
      saved = JSON.parse(raw);
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }
    if (!saved || !Array.isArray(saved.queueTrackIds) || saved.queueTrackIds.length === 0) return;

    try {
      const data = await $fetch<{ tracks: PlayableTrack[] }>('/api/music/tracks/by-ids', {
        method: 'POST',
        body: { ids: saved.queueTrackIds }
      });
      const restoredQueue = data.tracks || [];
      if (restoredQueue.length === 0) {
        window.localStorage.removeItem(STORAGE_KEY);
        return;
      }

      const idx = restoredQueue.findIndex((t) => t.id === saved.trackId);
      queue.value = restoredQueue;
      currentIndex.value = idx === -1 ? 0 : idx;
      currentTrack.value = restoredQueue[currentIndex.value] ?? null;
      shuffleOn.value = !!saved.shuffleOn;
      repeatMode.value = ['off', 'all', 'one'].includes(saved.repeatMode) ? saved.repeatMode : 'off';
      if (shuffleOn.value) generateShuffledOrder(currentIndex.value);
      hasCountedThisPlay.value = false;
      isPlaying.value = false;

      if (audioEl.value && currentTrack.value) {
        const el = audioEl.value;
        const track = currentTrack.value;
        el.src = track.local_file_path;
        const restoreTime = typeof saved.currentTime === 'number' ? saved.currentTime : 0;
        const setTime = () => {
          el.currentTime = restoreTime;
          currentTime.value = restoreTime;
          el.removeEventListener('loadedmetadata', setTime);
        };
        el.addEventListener('loadedmetadata', setTime);
      }
    } catch (e) {
      // Restore is best-effort — a failed fetch just leaves nothing playing.
    }
  }

  return {
    currentTrack, queue, currentIndex, isPlaying, currentTime, duration, audioEl,
    shuffleOn, repeatMode,
    play, togglePlay, seek, next, prev, toggleShuffle, cycleRepeat,
    recordPlayIfThresholdReached, saveToLocalStorage, restoreFromLocalStorage,
  };
}
```

- [ ] **Step 2: Type-check**

Run: `npx vue-tsc -b --noEmit`
Expected: no errors beyond the 2 known pre-existing ones (`app/components/VideoPlayer.vue`, `app/pages/subscriptions.vue`, unrelated).

- [ ] **Step 3: Commit**

```bash
git add app/composables/useMusicPlayer.ts
git commit -m "feat: add useMusicPlayer composable"
```

---

### Task 7: `MusicMiniPlayer.vue` + mount in the app shell

**Files:**
- Create: `app/components/MusicMiniPlayer.vue`
- Modify: `app/layouts/default.vue`

**Interfaces:**
- Consumes: `useMusicPlayer()` (Task 6).
- Produces: nothing consumed by a later task (Tasks 8/9 call `useMusicPlayer().play()` directly, independent of this component's existence).

- [ ] **Step 1: Create the mini-player component**

Create `app/components/MusicMiniPlayer.vue`:

```vue
<template>
  <div v-if="currentTrack" class="mini-player">
    <audio
      ref="audioElRef"
      @timeupdate="onTimeUpdate"
      @loadedmetadata="onLoadedMetadata"
      @durationchange="onLoadedMetadata"
      @ended="onEnded"
      @play="isPlaying = true"
      @pause="isPlaying = false"
      @error="onAudioError"
    ></audio>

    <img :src="currentTrack.local_thumbnail_path || fallbackCover" class="mini-player-cover" alt="" />

    <div class="mini-player-info">
      <span class="mini-player-title">{{ currentTrack.title }}</span>
      <span class="mini-player-artist">{{ currentTrack.artist_name || '' }}</span>
    </div>

    <div class="mini-player-controls">
      <button @click="prev" class="mini-player-btn" title="Précédent">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="19 20 9 12 19 4 19 20"></polygon><line x1="5" y1="19" x2="5" y2="5" stroke="currentColor" stroke-width="2"></line></svg>
      </button>
      <button @click="togglePlay" class="mini-player-btn mini-player-play-btn" title="Lecture/Pause">
        <svg v-if="isPlaying" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>
        <svg v-else xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
      </button>
      <button @click="next" class="mini-player-btn" title="Suivant">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5 4 15 12 5 20 5 4"></polygon><line x1="19" y1="5" x2="19" y2="19" stroke="currentColor" stroke-width="2"></line></svg>
      </button>
    </div>

    <div class="mini-player-progress-row">
      <span class="mini-player-time">{{ formatDuration(currentTime) }}</span>
      <div class="mini-player-progress-bar" @click="onProgressClick" ref="progressBarRef">
        <div class="mini-player-progress-fill" :style="{ width: progressPercent + '%' }"></div>
      </div>
      <span class="mini-player-time">{{ formatDuration(duration) }}</span>
    </div>

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
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useMusicPlayer } from '~/composables/useMusicPlayer';
import { useToast } from '~/composables/useToast';

const {
  currentTrack, isPlaying, currentTime, duration,
  audioEl, shuffleOn, repeatMode,
  togglePlay, seek, next, prev, toggleShuffle, cycleRepeat,
  recordPlayIfThresholdReached, saveToLocalStorage, restoreFromLocalStorage,
} = useMusicPlayer();

const toast = useToast();
const audioElRef = ref<HTMLAudioElement | null>(null);
const progressBarRef = ref<HTMLDivElement | null>(null);
const volume = ref(1);

const progressPercent = computed(() => (duration.value > 0 ? (currentTime.value / duration.value) * 100 : 0));

function onTimeUpdate() {
  if (!audioElRef.value) return;
  currentTime.value = audioElRef.value.currentTime;
  recordPlayIfThresholdReached();
  debouncedSave();
}

function onLoadedMetadata() {
  if (!audioElRef.value) return;
  duration.value = audioElRef.value.duration || 0;
}

function onEnded() {
  next();
}

function onAudioError() {
  toast.error('Erreur de lecture audio.');
  isPlaying.value = false;
}

function onProgressClick(e: MouseEvent) {
  if (!progressBarRef.value || duration.value <= 0) return;
  const rect = progressBarRef.value.getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  seek(ratio * duration.value);
}

function onVolumeChange() {
  if (audioElRef.value) audioElRef.value.volume = volume.value;
}

let saveDebounceTimer: ReturnType<typeof setTimeout> | null = null;
function debouncedSave() {
  if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
  saveDebounceTimer = setTimeout(() => saveToLocalStorage(), 1000);
}

const fallbackCover = 'data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%23666\' stroke-width=\'1.5\'><path d=\'M9 18V5l12-2v13\'></path><circle cx=\'6\' cy=\'18\' r=\'3\'></circle><circle cx=\'18\' cy=\'16\' r=\'3\'></circle></svg>';

const formatDuration = (seconds: number | null): string => {
  if (!seconds) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

onMounted(async () => {
  audioEl.value = audioElRef.value;
  if (audioElRef.value) audioElRef.value.volume = volume.value;
  await restoreFromLocalStorage();
});
</script>

<style scoped>
.mini-player {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: 72px;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 0 24px;
  background: rgba(15, 15, 22, 0.96);
  backdrop-filter: blur(20px);
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  z-index: 900;
}

.mini-player-cover {
  width: 48px;
  height: 48px;
  border-radius: var(--border-radius-md);
  object-fit: cover;
  flex-shrink: 0;
}

.mini-player-info {
  display: flex;
  flex-direction: column;
  width: 180px;
  flex-shrink: 0;
  overflow: hidden;
}

.mini-player-title {
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mini-player-artist {
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mini-player-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.mini-player-btn {
  background: none;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 6px;
  display: inline-flex;
  align-items: center;
  transition: color 0.2s;
}

.mini-player-btn:hover {
  color: var(--text-primary);
}

.mini-player-btn.active {
  color: var(--accent-primary);
}

.mini-player-play-btn {
  background: var(--text-primary);
  color: var(--bg-base);
  border-radius: 50%;
  width: 32px;
  height: 32px;
  justify-content: center;
}

.mini-player-play-btn:hover {
  color: var(--bg-base);
  opacity: 0.9;
}

.mini-player-progress-row {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.mini-player-time {
  font-size: 11px;
  color: var(--text-secondary);
  flex-shrink: 0;
  width: 36px;
}

.mini-player-progress-bar {
  flex: 1;
  height: 4px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 2px;
  cursor: pointer;
  position: relative;
}

.mini-player-progress-fill {
  height: 100%;
  background: var(--accent-primary);
  border-radius: 2px;
}

.mini-player-extra-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.repeat-one-badge {
  position: absolute;
  font-size: 8px;
  font-weight: 700;
  margin-left: -6px;
  margin-top: 6px;
}

.mini-player-volume {
  width: 80px;
}
</style>
```

- [ ] **Step 2: Mount the component and reserve space in `app/layouts/default.vue`**

In the `<template>`, find the closing of the toast container block, right before the final `</div>` of `.layout-container`:

```html
    <!-- Toast Notification Container -->
    <div class="toast-container">
      <TransitionGroup name="toast">
        <div v-for="toast in toasts" :key="toast.id" class="toast-notification" :class="`toast-${toast.type}`">
          <!-- Success SVG -->
          <svg v-if="toast.type === 'success'" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
          <!-- Error SVG -->
          <svg v-else-if="toast.type === 'error'" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>
          <!-- Info SVG -->
          <svg v-else xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
          <span>{{ toast.message }}</span>
          <button @click="removeToast(toast.id)" class="toast-close-btn">&times;</button>
        </div>
      </TransitionGroup>
    </div>
  </div>
</template>
```

Replace with (adds `<MusicMiniPlayer />` right after the toast container, still inside `.layout-container`):

```html
    <!-- Toast Notification Container -->
    <div class="toast-container">
      <TransitionGroup name="toast">
        <div v-for="toast in toasts" :key="toast.id" class="toast-notification" :class="`toast-${toast.type}`">
          <!-- Success SVG -->
          <svg v-if="toast.type === 'success'" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
          <!-- Error SVG -->
          <svg v-else-if="toast.type === 'error'" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>
          <!-- Info SVG -->
          <svg v-else xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
          <span>{{ toast.message }}</span>
          <button @click="removeToast(toast.id)" class="toast-close-btn">&times;</button>
        </div>
      </TransitionGroup>
    </div>

    <MusicMiniPlayer />
  </div>
</template>
```

Now find the `.content-area` class binding on `<main>`:

```html
      <!-- Main Content Page slot -->
      <main class="content-area">
        <slot />
      </main>
```

Replace with (adds a conditional class so page content never sits under the mini-player):

```html
      <!-- Main Content Page slot -->
      <main class="content-area" :class="{ 'has-mini-player': !!currentTrack }">
        <slot />
      </main>
```

In `<script setup>`, add the import and destructure `currentTrack` from the composable. Find:

```ts
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useAuth } from '~/composables/useAuth';
import { useToast } from '~/composables/useToast';
import { spaces } from '~/spaces';

const { user, isAdmin, logout } = useAuth();
const { toasts, removeToast } = useToast();
```

Replace with:

```ts
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useAuth } from '~/composables/useAuth';
import { useToast } from '~/composables/useToast';
import { useMusicPlayer } from '~/composables/useMusicPlayer';
import { spaces } from '~/spaces';

const { user, isAdmin, logout } = useAuth();
const { toasts, removeToast } = useToast();
const { currentTrack } = useMusicPlayer();
```

Finally, add CSS for `.has-mini-player`. In `<style scoped>`, find the `.content-area` rule:

```css
.content-area {
  flex: 1;
  overflow-y: auto;
  scrollbar-gutter: stable;
  padding: 24px;
  background: var(--bg-base);
  display: flex;
  flex-direction: column;
}
```

Add a rule immediately after it:

```css
.content-area {
  flex: 1;
  overflow-y: auto;
  scrollbar-gutter: stable;
  padding: 24px;
  background: var(--bg-base);
  display: flex;
  flex-direction: column;
}

.content-area.has-mini-player {
  padding-bottom: 96px;
}
```

- [ ] **Step 3: Type-check**

Run: `npx vue-tsc -b --noEmit`
Expected: no new errors beyond the 2 known pre-existing ones.

- [ ] **Step 4: Manual verification**

Start the dev server, log in, confirm the mini-player is absent from every page (no track played yet), and that no console errors appear from `MusicMiniPlayer`'s `onMounted` (an empty/absent `localStorage` key must be a silent no-op).

- [ ] **Step 5: Commit**

```bash
git add app/components/MusicMiniPlayer.vue app/layouts/default.vue
git commit -m "feat: add persistent music mini-player mounted in the app shell"
```

---

### Task 8: Wire `/music` track rows to playback

**Files:**
- Modify: `app/pages/music/index.vue`

**Interfaces:**
- Consumes: `useMusicPlayer()` (Task 6).
- Produces: nothing consumed by a later task.

- [ ] **Step 1: Add the composable and a `playTrack` function**

In `app/pages/music/index.vue`'s `<script setup>`, find:

```ts
import { ref, reactive, computed, watch, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuth } from '~/composables/useAuth';

const { isAdmin } = useAuth();
```

Replace with:

```ts
import { ref, reactive, computed, watch, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuth } from '~/composables/useAuth';
import { useMusicPlayer } from '~/composables/useMusicPlayer';

const { isAdmin } = useAuth();
const { currentTrack, play: playMusicTrack } = useMusicPlayer();
```

Then, directly below the existing `function toggleStandalone() { ... }` function (before the `editingTrack`/`editingAlbum` block), add:

```ts
function playTrack(track: any, groupKey: string) {
  if (!track.local_file_path) return;
  const group = trackGroups[groupKey];
  if (!group) return;
  playMusicTrack(track, group.tracks);
}
```

- [ ] **Step 2: Make track rows clickable in the template**

Find the per-album track row:

```html
            <div v-for="track in trackGroups[album.id]?.tracks || []" :key="track.id" class="track-row">
              <span class="track-number">{{ track.track_number || '–' }}</span>
              <span class="track-title">{{ track.title }}</span>
              <span v-if="track.genre" class="badge badge-pending">{{ track.genre }}</span>
              <span v-if="track.language" class="badge badge-pending">{{ track.language }}</span>
              <span class="track-duration">{{ formatDuration(track.duration) }}</span>
              <button v-if="isAdmin" @click="openTrackEdit(track, album.id)" class="edit-btn" title="Modifier">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"></path></svg>
              </button>
            </div>
```

Replace with (adds `@click="playTrack(track, album.id)"` on the row and a "now playing" class, and `@click.stop` on the existing edit button so it keeps overriding the new row click just like it already overrides the album-header click):

```html
            <div
              v-for="track in trackGroups[album.id]?.tracks || []"
              :key="track.id"
              class="track-row"
              :class="{ 'now-playing': currentTrack?.id === track.id }"
              @click="playTrack(track, album.id)"
            >
              <span class="track-number">{{ track.track_number || '–' }}</span>
              <span class="track-title">{{ track.title }}</span>
              <span v-if="track.genre" class="badge badge-pending">{{ track.genre }}</span>
              <span v-if="track.language" class="badge badge-pending">{{ track.language }}</span>
              <span class="track-duration">{{ formatDuration(track.duration) }}</span>
              <button v-if="isAdmin" @click.stop="openTrackEdit(track, album.id)" class="edit-btn" title="Modifier">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"></path></svg>
              </button>
            </div>
```

Find the identical block for the standalone group (using `trackGroups['none']?.tracks`) and apply the same change, using `playTrack(track, 'none')`:

```html
            <div
              v-for="track in trackGroups['none']?.tracks || []"
              :key="track.id"
              class="track-row"
              :class="{ 'now-playing': currentTrack?.id === track.id }"
              @click="playTrack(track, 'none')"
            >
              <span class="track-number">{{ track.track_number || '–' }}</span>
              <span class="track-title">{{ track.title }}</span>
              <span v-if="track.genre" class="badge badge-pending">{{ track.genre }}</span>
              <span v-if="track.language" class="badge badge-pending">{{ track.language }}</span>
              <span class="track-duration">{{ formatDuration(track.duration) }}</span>
              <button v-if="isAdmin" @click.stop="openTrackEdit(track, 'none')" class="edit-btn" title="Modifier">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"></path></svg>
              </button>
            </div>
```

- [ ] **Step 3: Add CSS for the clickable/now-playing row**

In `<style scoped>`, find the `.track-row` rule:

```css
.track-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  font-size: 14px;
}
```

Replace with:

```css
.track-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  font-size: 14px;
  cursor: pointer;
}

.track-row:hover {
  background: rgba(255, 255, 255, 0.03);
}

.track-row.now-playing {
  color: var(--accent-primary);
}

.track-row.now-playing .track-number,
.track-row.now-playing .track-duration {
  color: var(--accent-primary);
}
```

- [ ] **Step 4: Type-check**

Run: `npx vue-tsc -b --noEmit`
Expected: no new errors beyond the 2 known pre-existing ones.

- [ ] **Step 5: Manual verification**

Log in, navigate to `/music`, expand an album with multiple tracks, click a track: confirm the mini-player appears and starts playing, the clicked row is visually highlighted. Click a second track in the same group: confirm playback switches immediately and the highlight moves. Click the admin pencil button on a track row: confirm it opens the edit modal and does NOT also start playback (confirms `@click.stop` isolation still holds).

- [ ] **Step 6: Commit**

```bash
git add app/pages/music/index.vue
git commit -m "feat: wire music track rows to playback"
```

---

### Task 9: "Playlists automatiques" section on `/music`

**Files:**
- Modify: `app/pages/music/index.vue`

**Interfaces:**
- Consumes: the four playlist endpoints (Task 5), `useMusicPlayer()` (Task 6, already imported by Task 8).
- Produces: nothing consumed by a later task (final task in this plan).

- [ ] **Step 1: Add playlist-fetching state and functions**

In `app/pages/music/index.vue`'s `<script setup>`, directly below the `hasActiveFilters` computed (still in the "Grid view state" section), add:

```ts
// --- Automatic playlists ---
const playlists = ref<Array<{ key: string; label: string; tracks: any[] }>>([]);

async function fetchPlaylists() {
  const results: Array<{ key: string; label: string; tracks: any[] }> = [];

  try {
    const mostPlayed = await $fetch<any>('/api/music/playlists/most-played');
    if (mostPlayed.tracks?.length > 0) {
      results.push({ key: 'most-played', label: 'Les plus écoutés', tracks: mostPlayed.tracks });
    }
  } catch (e) { /* silently skip this card on error */ }

  try {
    const recentlyAdded = await $fetch<any>('/api/music/playlists/recently-added');
    if (recentlyAdded.tracks?.length > 0) {
      results.push({ key: 'recently-added', label: 'Ajoutés récemment', tracks: recentlyAdded.tracks });
    }
  } catch (e) { /* silently skip this card on error */ }

  try {
    const rediscover = await $fetch<any>('/api/music/playlists/rediscover');
    if (rediscover.tracks?.length > 0) {
      results.push({ key: 'rediscover', label: 'À (re)découvrir', tracks: rediscover.tracks });
    }
  } catch (e) { /* silently skip this card on error */ }

  for (const g of facets.value.genres) {
    try {
      const genreMix = await $fetch<any>('/api/music/playlists/genre-mix', { params: { genre: g } });
      if (genreMix.tracks?.length > 0) {
        results.push({ key: `genre-${g}`, label: `Mix ${g}`, tracks: genreMix.tracks });
      }
    } catch (e) { /* silently skip this card on error */ }
  }

  playlists.value = results;
}

function playPlaylist(playlist: { tracks: any[] }) {
  if (playlist.tracks.length === 0) return;
  playMusicTrack(playlist.tracks[0], playlist.tracks);
}
```

- [ ] **Step 2: Fetch playlists after the artist grid loads**

Find the existing `fetchArtists` function's success path:

```ts
    const data = await $fetch<any>('/api/music/artists', { params });
    if (requestId !== artistsRequestId) return;
    artists.value = data.artists || [];
    facets.value = data.facets || { genres: [], languages: [], years: [] };
```

Replace with (fetches playlists once, only on the initial unfiltered load, right after `facets` is populated — later filtered re-fetches don't need to redo this):

```ts
    const data = await $fetch<any>('/api/music/artists', { params });
    if (requestId !== artistsRequestId) return;
    artists.value = data.artists || [];
    facets.value = data.facets || { genres: [], languages: [], years: [] };
    if (!hasActiveFilters.value && playlists.value.length === 0) {
      fetchPlaylists();
    }
```

- [ ] **Step 3: Render the playlist cards in the template**

In the grid view, find the filters bar's closing `</div>` followed by the loading/error/empty states:

```html
      <div v-if="gridPending" class="music-loading">Chargement...</div>
```

Insert a new section immediately before this line (still inside `<div v-if="!artistId">`, after `.music-filters-bar`'s closing `</div>`):

```html
      <div v-if="playlists.length > 0" class="playlists-row">
        <div
          v-for="playlist in playlists"
          :key="playlist.key"
          class="playlist-card"
          @click="playPlaylist(playlist)"
        >
          <div class="playlist-card-icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
          </div>
          <div class="playlist-card-info">
            <h4 class="playlist-card-label">{{ playlist.label }}</h4>
            <p class="playlist-card-count">{{ playlist.tracks.length }} titre(s)</p>
          </div>
        </div>
      </div>

      <div v-if="gridPending" class="music-loading">Chargement...</div>
```

- [ ] **Step 4: Add CSS for the playlist cards**

In `<style scoped>`, directly after the `.music-filters-bar select.form-input { ... }` rule, add:

```css
.playlists-row {
  display: flex;
  gap: 16px;
  overflow-x: auto;
  margin-bottom: 24px;
  padding-bottom: 4px;
}

.playlist-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 18px;
  border-radius: var(--border-radius-lg);
  cursor: pointer;
  border: 1px solid var(--border-color);
  background: rgba(139, 92, 246, 0.08);
  flex-shrink: 0;
  min-width: 220px;
  transition: transform 0.2s ease, border-color 0.2s ease;
}

.playlist-card:hover {
  transform: translateY(-2px);
  border-color: rgba(139, 92, 246, 0.4);
}

.playlist-card-icon {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--accent-primary);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.playlist-card-label {
  font-size: 14px;
  font-weight: 600;
}

.playlist-card-count {
  font-size: 12px;
  color: var(--text-secondary);
}
```

- [ ] **Step 5: Type-check**

Run: `npx vue-tsc -b --noEmit`
Expected: no new errors beyond the 2 known pre-existing ones.

- [ ] **Step 6: Manual verification**

Log in, navigate to `/music` (no filters active), confirm playlist cards appear above the artist grid for whichever playlists have data (e.g. "Ajoutés récemment" should always appear if any completed tracks exist; "Les plus écoutés"/"À (re)découvrir" only appear once at least one track has actually been played by this user, per Task 8's manual verification). Click a card: confirm playback starts immediately with that playlist's first track and the mini-player's queue matches. Log out, reload: confirm "Les plus écoutés"/"À (re)découvrir" cards are absent (guest-empty), while "Ajoutés récemment" and any genre-mix cards still appear if applicable.

- [ ] **Step 7: Commit**

```bash
git add app/pages/music/index.vue
git commit -m "feat: add automatic playlists section to music catalog page"
```

---

## Self-Review Notes

- **Spec coverage:** audio streaming with Range support (Task 2) ✓, `music_play_history` table + play-recording endpoint (Tasks 1, 3) ✓, localStorage restore via `by-ids` (Tasks 4, 6) ✓, shuffle/repeat (Task 6) ✓, persistent mini-player surviving navigation (Task 7) ✓, track-row playback wiring + now-playing indicator (Task 8) ✓, four automatic playlists surfaced as clickable cards (Tasks 5, 9) ✓. Verification section bullets from the spec are each covered by a manual-verification step in Tasks 2, 7, 8, 9, or an automated test in Tasks 1, 3, 4, 5.
- **Placeholder scan:** none found — every step shows complete code, exact file paths, and exact commands.
- **Type consistency:** `PlayableTrack` (Task 6) matches the field names returned by every endpoint that feeds it — Task 4's `by-ids`, Task 5's four playlist endpoints, and the existing `tracks.get.ts` from 3c-i (`id, title, track_number, genre, language, duration, local_thumbnail_path`) plus the new `local_file_path`/`artist_name`/`artist_id` fields, consistently named `snake_case` to match every other Music mode endpoint response. `useMusicPlayer()`'s returned shape (Task 6) is destructured identically in Task 7 (mini-player) and Tasks 8/9 (`play`, aliased to `playMusicTrack`, and `currentTrack`).
