# Music File Serving & Access Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve music track thumbnails/covers over HTTP, gated by the same three-tier visibility model (`public`/`private`/`ultra_private`) the video pipeline already enforces, simplified to match the music schema's actual shape.

**Architecture:** A new `canAccessMusicTrack` function in `server/utils/auth.ts` (a deliberately simpler sibling of the existing `canAccessVideo`), backed by real integration tests against an in-memory test DB (extending the existing `tests/helpers/testDb.ts` harness with `music_artists`/`music_tracks` support). A new Nitro route, `server/routes/downloads-music/[...path].ts`, mirrors the existing video download route's containment/resolution logic but is restricted to image extensions only — no audio, no range-requests.

**Tech Stack:** Nitro server routes (H3), better-sqlite3, Vitest for the access-control logic (real integration tests, not mocks — same pattern as the existing `tests/integration/access-control.test.ts`).

## Global Constraints

- Images only (`jpg`, `jpeg`, `webp`, `png`) — any other extension, including audio, is rejected with 404. No range-request support, no `Content-Range`/`Accept-Ranges` headers.
- No per-user explicit access grant table for music (`user_channel_access`'s music equivalent doesn't exist) — a non-admin has no override path through `ultra_private` for music, full stop.
- No `share_token` support for music tracks (the column doesn't exist on `music_tracks`).
- `canAccessMusicTrack` uses a single visibility source (`music_artists.visibility`) — no max-of-two-levels logic like `canAccessVideo` has for video+channel, since `music_tracks` has no visibility column of its own.

---

### Task 1: Extend the test DB harness for music tables

**Files:**
- Modify: `tests/helpers/testDb.ts`

**Interfaces:**
- Produces: `music_artists`/`music_tracks` tables added to `createTestDb()`'s in-memory schema, plus `insertMusicArtist(db, opts)` and `insertMusicTrack(db, opts)` helper functions — consumed by Task 2's tests.

Mirrors the existing `insertChannel`/`insertVideo` helpers in the same file, trimmed to only the columns `canAccessMusicTrack` actually touches (this file's own header comment already states the principle: "only the tables/columns the access-control logic under test actually touches" — follow it, don't copy the full production schema).

- [ ] **Step 1: Add the two tables to `createTestDb()`**

In `tests/helpers/testDb.ts`, inside the `db.exec(\`...\`)` call in `createTestDb()`, immediately after the closing `);` of the `CREATE TABLE user_subscriptions` statement and before the closing `` `); `` of the whole `db.exec` block, add:

```typescript
    CREATE TABLE music_artists (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      visibility TEXT DEFAULT 'public',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE music_tracks (
      id TEXT PRIMARY KEY,
      artist_id TEXT NOT NULL,
      title TEXT NOT NULL,
      local_thumbnail_path TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (artist_id) REFERENCES music_artists(id) ON DELETE CASCADE
    );
```

- [ ] **Step 2: Add the two insert helpers**

At the end of `tests/helpers/testDb.ts`, after the existing `insertSubscription` function, add:

```typescript
export function insertMusicArtist(db: Database.Database, opts: { id: string; visibility?: string }) {
  db.prepare(`
    INSERT INTO music_artists (id, name, visibility, created_at)
    VALUES (?, ?, ?, ?)
  `).run(opts.id, `Artist ${opts.id}`, opts.visibility ?? 'public', Date.now());
}

export function insertMusicTrack(db: Database.Database, opts: {
  id: string;
  artistId: string;
  localThumbnailPath?: string | null;
  createdAt?: number;
}) {
  db.prepare(`
    INSERT INTO music_tracks (id, artist_id, title, local_thumbnail_path, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    opts.id,
    opts.artistId,
    `Track ${opts.id}`,
    opts.localThumbnailPath ?? null,
    opts.createdAt ?? Date.now()
  );
}
```

- [ ] **Step 3: Verify the file still loads correctly**

Run: `npx vitest run tests/integration/access-control.test.ts`
Expected: still passes (16 pre-existing tests) — this step only adds new tables/functions, it doesn't change anything the existing tests use, so nothing should break. This confirms the added SQL is syntactically valid (a typo in the new `CREATE TABLE` block would break `createTestDb()` for every test file that imports it, including this one).

- [ ] **Step 4: Commit**

```bash
git add tests/helpers/testDb.ts
git commit -m "test: add music_artists/music_tracks support to the test DB harness"
```

---

### Task 2: `canAccessMusicTrack`

**Files:**
- Modify: `server/utils/auth.ts` (append the new function)
- Modify: `tests/integration/access-control.test.ts` (append a new `describe` block and import)

**Interfaces:**
- Consumes: `insertMusicArtist`, `insertMusicTrack` (Task 1, `../helpers/testDb`); `getUserFromSession`, `getDb` (already in `auth.ts`, both auto-imported/already-present — `getDb` is a Nitro server auto-import, `getUserFromSession` is defined earlier in the same file).
- Produces: `export async function canAccessMusicTrack(trackId: string, event: any): Promise<boolean>`, consumed by Task 3's route.

TDD: write the tests first against the not-yet-existing function, watch them fail, then implement.

- [ ] **Step 1: Write the failing tests**

In `tests/integration/access-control.test.ts`, change the import line from:

```typescript
import { canAccessVideo, canAccessChannel } from '../../server/utils/auth';
import {
  createTestDb,
  insertUser,
  insertSession,
  insertChannel,
  insertVideo,
  grantChannelAccess,
  mockEvent,
  sessionCookie
} from '../helpers/testDb';
```

to:

```typescript
import { canAccessVideo, canAccessChannel, canAccessMusicTrack } from '../../server/utils/auth';
import {
  createTestDb,
  insertUser,
  insertSession,
  insertChannel,
  insertVideo,
  grantChannelAccess,
  mockEvent,
  sessionCookie,
  insertMusicArtist,
  insertMusicTrack
} from '../helpers/testDb';
```

Then append this new `describe` block at the end of the file, after the closing `});` of the existing `describe('canAccessVideo', ...)` block:

```typescript

describe('canAccessMusicTrack', () => {
  it('is accessible to a guest when the artist is public', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'public' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });
    expect(await canAccessMusicTrack('t1', guestEvent())).toBe(true);
  });

  it('denies a guest access to a track from a private artist', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'private' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });
    expect(await canAccessMusicTrack('t1', guestEvent())).toBe(false);
  });

  it('allows any logged-in user to access a track from a private artist', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'private' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });
    const event = loginAs('u1', 'user');
    expect(await canAccessMusicTrack('t1', event)).toBe(true);
  });

  it('is not accessible to a regular user when the artist is ultra_private (no grant mechanism exists for music)', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'ultra_private' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });
    const event = loginAs('u1', 'user');
    expect(await canAccessMusicTrack('t1', event)).toBe(false);
  });

  it('is always accessible to an admin regardless of visibility', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'ultra_private' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });
    const event = loginAs('admin1', 'admin');
    expect(await canAccessMusicTrack('t1', event)).toBe(true);
  });

  it('returns false for a track that does not exist', async () => {
    expect(await canAccessMusicTrack('missing', guestEvent())).toBe(false);
  });

  it('returns false when the track exists but its artist row does not (orphaned data)', async () => {
    // Exercises the INNER JOIN in the implementation: a track whose artist_id
    // doesn't resolve should be treated as inaccessible, not throw.
    db.exec(`PRAGMA foreign_keys = OFF;`);
    insertMusicTrack(db, { id: 't1', artistId: 'missing-artist' });
    db.exec(`PRAGMA foreign_keys = ON;`);
    expect(await canAccessMusicTrack('t1', guestEvent())).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/integration/access-control.test.ts`
Expected: FAIL — `canAccessMusicTrack` is not exported from `server/utils/auth.ts` yet (import error / undefined function).

- [ ] **Step 3: Implement `canAccessMusicTrack`**

At the end of `server/utils/auth.ts`, after the existing `canAccessChannel` function, add:

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
  // user_channel_access exists for music artists yet.
  return false;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/integration/access-control.test.ts`
Expected: PASS (23 tests: 16 pre-existing + 7 new)

- [ ] **Step 5: Commit**

```bash
git add server/utils/auth.ts tests/integration/access-control.test.ts
git commit -m "feat: add canAccessMusicTrack, a simplified visibility check for music"
```

---

### Task 3: The file-serving route

**Files:**
- Create: `server/routes/downloads-music/[...path].ts`

**Interfaces:**
- Consumes: `canAccessMusicTrack` (Task 2, `server/utils/auth.ts`, auto-imported); `getMusicDownloadsDir` (`server/utils/musicDownloader.ts`, auto-imported); `sanitizeFolderName` (`server/utils/downloader.ts`, auto-imported); `getDb` (auto-imported).
- Produces: `GET /downloads-music/{artistFolderName}/{trackId}.{ext}`, consumed by Task 4's live verification and eventually by sub-project 3b/3c's UI (`<img>` tags).

Mirrors `server/routes/downloads/[...path].ts`'s containment/resolution logic, trimmed to images only (no range-request handling, no `Accept-Ranges`, no video/audio content types). `getDb`, `getMusicDownloadsDir`, `sanitizeFolderName`, and `canAccessMusicTrack` are all Nitro server auto-imports (exported from `server/utils/**`) — this file only needs explicit imports for Node builtins and `h3`, matching the established pattern in every other file under `server/routes/`/`server/api/`.

- [ ] **Step 1: Write the route**

Create `server/routes/downloads-music/[...path].ts`:

```typescript
import fs from 'fs';
import path from 'path';
import { defineEventHandler, createError } from 'h3';

const IMAGE_CONTENT_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.png': 'image/png',
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
  const contentType = IMAGE_CONTENT_TYPES[ext];
  if (!contentType) {
    // Includes audio extensions and anything else — this route serves
    // images only. A 404 here reveals nothing about whether a non-image
    // file exists at this path.
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
  event.node.res.setHeader('Content-Type', contentType);
  event.node.res.setHeader('Content-Length', stat.size);
  event.node.res.statusCode = 200;
  return fs.createReadStream(resolvedPath);
});
```

- [ ] **Step 2: Type-check**

Run: `npx vue-tsc -b --noEmit`
Expected: only the 3 pre-existing, unrelated `.vue` file errors (`VideoPlayer.vue`, `default.vue`, `subscriptions.vue`) that predate this work — nothing new. (Do NOT use `npx vue-tsc --noEmit -p .` — it's a silent no-op in this repo.)

- [ ] **Step 3: Commit**

```bash
git add server/routes/downloads-music/
git commit -m "feat: add images-only file-serving route for music thumbnails"
```

---

### Task 4: Live verification against real files

**Files:** none (verification only, no code changes)

The Task 2 integration tests already cover `canAccessMusicTrack`'s logic exhaustively against an in-memory DB. This task verifies the actual HTTP route — Nitro routing, real file resolution, real containment behavior — against real thumbnail files left on disk from the sub-project-2 live test (the GIMS channel ingest, `data/downloads-music/GIMS/*.webp`).

- [ ] **Step 1: Confirm real thumbnail files still exist**

```bash
ls data/downloads-music/GIMS/*.webp | head -3
sqlite3 data/youkeep.db "SELECT id, local_thumbnail_path FROM music_tracks WHERE local_thumbnail_path IS NOT NULL LIMIT 3;"
```

Expected: at least one row, with a `local_thumbnail_path` like `/downloads-music/GIMS/<trackId>.webp`, and a matching file on disk. If none exist (e.g. this is a fresh environment), re-run a small ingest against a real channel first, following the same technique used in sub-project 2's Task 8 verification, before continuing.

- [ ] **Step 2: Start the dev server and confirm the GIMS artist's current visibility**

Start the dev server (`.claude/launch.json`'s `youkeep-dev` config, or create one pointed at `npm run dev` on a free port if it doesn't exist yet — see prior sub-projects' verification passes for the exact pattern). Then:

```bash
sqlite3 data/youkeep.db "SELECT id, name, visibility FROM music_artists WHERE name = 'GIMS';"
```

Note the artist's id — needed for the visibility-toggling steps below.

- [ ] **Step 3: Public access — guest request succeeds**

With the artist at its current visibility (confirm it's `'public'`; if not, `UPDATE music_artists SET visibility = 'public' WHERE id = '<id>';` first), pick one real track id + extension from Step 1 and request it with no session cookie:

```bash
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" "http://localhost:3100/downloads-music/GIMS/<trackId>.webp"
```

Expected: `200 image/webp` (or `image/jpeg` if the real extension differs — use whatever Step 1 actually found).

- [ ] **Step 4: Private tier — guest denied, member allowed**

```bash
sqlite3 data/youkeep.db "UPDATE music_artists SET visibility = 'private' WHERE name = 'GIMS';"
```

Create a temporary non-admin session (mirroring the admin-session-creation technique used in prior sub-projects' verification, but with `role = 'user'`):

```bash
cat > scratch_mk_member_session.ts <<'EOF'
import crypto from 'crypto';
import { getDb } from './server/utils/db';

const db = getDb();
const userId = crypto.randomUUID();
db.prepare("INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?, ?, 'x', 'user', ?)")
  .run(userId, `verify_member_${userId.slice(0, 8)}`, Date.now());
const sessionId = crypto.randomUUID();
db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)')
  .run(sessionId, userId, Date.now() + 1000 * 60 * 60);
console.log(JSON.stringify({ userId, sessionId }));
EOF
npx --yes tsx scratch_mk_member_session.ts
rm -f scratch_mk_member_session.ts
```

Save the printed `sessionId` as `$MEMBER_SESSION`, then:

```bash
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3100/downloads-music/GIMS/<trackId>.webp"
# Expected: 403 (no cookie — guest)

curl -s -o /dev/null -w "%{http_code}\n" -H "Cookie: youkeep_session=$MEMBER_SESSION" "http://localhost:3100/downloads-music/GIMS/<trackId>.webp"
# Expected: 200 (logged-in member)
```

- [ ] **Step 5: Ultra-private tier — member denied, admin allowed**

```bash
sqlite3 data/youkeep.db "UPDATE music_artists SET visibility = 'ultra_private' WHERE name = 'GIMS';"
```

Reuse `$MEMBER_SESSION` from Step 4 and the admin session technique from prior sub-projects' verification passes (`$ADMIN_SESSION`):

```bash
curl -s -o /dev/null -w "%{http_code}\n" -H "Cookie: youkeep_session=$MEMBER_SESSION" "http://localhost:3100/downloads-music/GIMS/<trackId>.webp"
# Expected: 403 (regular member, no grant mechanism exists for music)

curl -s -o /dev/null -w "%{http_code}\n" -H "Cookie: youkeep_session=$ADMIN_SESSION" "http://localhost:3100/downloads-music/GIMS/<trackId>.webp"
# Expected: 200 (admin)
```

- [ ] **Step 6: Restore visibility, reject a non-image extension, reject a path-traversal attempt, reject an unknown track**

```bash
sqlite3 data/youkeep.db "UPDATE music_artists SET visibility = 'public' WHERE name = 'GIMS';"

# Real audio extension for the same track — must 404 regardless of the now-public visibility:
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3100/downloads-music/GIMS/<trackId>.opus"
# Expected: 404

# Path traversal attempt:
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3100/downloads-music/GIMS/..%2f..%2f..%2fetc%2fpasswd"
# Expected: 400 or 403 (not 200, and definitely not the contents of /etc/passwd)

# Nonexistent track id, valid-looking image extension:
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3100/downloads-music/GIMS/nonexistent-track-id.jpg"
# Expected: 404
```

- [ ] **Step 7: Clean up the temporary member account and report results**

```bash
sqlite3 data/youkeep.db "DELETE FROM sessions WHERE user_id = '<userId from Step 4's script output>';"
sqlite3 data/youkeep.db "DELETE FROM users WHERE id = '<userId from Step 4's script output>';"
```

Summarize pass/fail for each step above. If any step fails, return to Task 3 and fix before considering this plan complete — do not mark this task done on a partial pass.
