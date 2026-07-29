# Music Manual Metadata Editing (3c-ii) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins correct/fill in track and album metadata (title, genre, language, track number, album title, release year, cover URL) directly on the `/music` catalog page, via two new admin-only `PATCH` endpoints and two edit modals.

**Architecture:** Two new `PATCH` endpoints under `server/api/admin/music/` (`tracks/[id]`, `albums/[id]`) apply partial, field-by-field updates guarded by `requireAdmin`. Two new small Vue components (`MusicTrackEditModal.vue`, `MusicAlbumEditModal.vue`) wrap the existing shared `BaseModal`. `app/pages/music/index.vue` gets admin-only pencil buttons that open these modals, pre-filled from the row already in memory, and patches its own local state on save (no refetch).

**Tech Stack:** Nuxt 4 / Nitro (H3) server routes, better-sqlite3, Vue 3 Composition API, Vitest.

## Global Constraints

- Both new endpoints are admin-only, enforced via `requireAdmin(event)` (from `server/utils/auth.ts`) — 401 for a guest, 403 for a logged-in non-admin. Never UI-only.
- Every field in both endpoints' request bodies is independently optional. A field key present with an empty/invalid value clears it to `NULL` (except `title`, which is required non-empty whenever the key is present, on both tracks and albums). A field key absent from the body leaves that column untouched.
- No "keep current" sentinel `<option>` is needed for these forms (unlike sub-project 3b) — the edit modals always open pre-filled with the row's real current values already held in the page's own state, not a generic default, so resubmitting an untouched field resubmits its real value. Endpoints still validate and apply updates conditionally server-side regardless (never "the UI is the only guardrail").
- `music_albums.cover_url`, once manually set, takes priority over 3c-i's computed first-track-thumbnail fallback in the artist-detail endpoint's response.
- No track↔album reassignment, no manual album creation, no artist name/description/avatar editing — out of scope.
- All new forms use `.form-input` (the app's real global input/select class) — never `.form-select`, which resolves to nothing anywhere in this app.
- Type-checking requires `npx vue-tsc -b --noEmit` — plain `vue-tsc --noEmit -p .` is a silent no-op and must never be used as a verification step.
- Endpoint files in this codebase call project-local utilities (`getDb`, `requireAdmin`, etc.) as bare ambient identifiers, relying on Nitro's auto-import at runtime — but Vitest's direct-handler-import tests do NOT get that auto-import transform, so an endpoint's test file will fail with a "not defined" error for any such identifier until the endpoint file adds an explicit relative import. This has come up in every prior sub-project's endpoint tasks (3c-i's Tasks 2–4): write the test first, let it fail, and only then add the exact import the failure demands — don't guess a path up front.
- All new user-facing UI copy is in French.

---

### Task 1: `PATCH /api/admin/music/tracks/[id]`

**Files:**
- Modify: `tests/helpers/testDb.ts`
- Create: `server/api/admin/music/tracks/[id].patch.ts`
- Test: `tests/integration/music-track-edit.test.ts`

**Interfaces:**
- Consumes: `requireAdmin` (existing, `server/utils/auth.ts`), `insertMusicArtist`/`insertMusicTrack` (existing, `tests/helpers/testDb.ts`).
- Produces: extended `mockEvent(cookieHeader?, opts?: { path?: string; params?: Record<string,string>; body?: any })` (used by Task 2's test file too). `PATCH /api/admin/music/tracks/:id` response shape `{ track: { id, title, track_number, genre, language } }`. Not consumed by any other task's tests, but Task 4's UI calls this endpoint directly by URL/method, not by import.

- [ ] **Step 1: Extend `mockEvent` to support a request body**

Open `tests/helpers/testDb.ts`. Replace the `mockEvent` function:

```ts
export function mockEvent(cookieHeader?: string, opts?: { path?: string; params?: Record<string, string>; body?: any }): any {
  const req: any = {
    headers: { cookie: cookieHeader || '' }
  };
  if (opts && Object.prototype.hasOwnProperty.call(opts, 'body')) {
    // H3's readBody(event) checks for a value already stored under this
    // well-known symbol before attempting to read/parse a raw request
    // stream — setting it directly lets tests supply a body without
    // simulating an actual HTTP request stream. Symbol.for is a global
    // registry lookup, so this matches h3's own internal ParsedBodySymbol
    // even though it isn't exported from the package.
    req[Symbol.for('h3ParsedBody')] = opts.body;
  }
  return {
    path: opts?.path ?? '/',
    context: { params: opts?.params ?? {} },
    node: {
      req,
      res: {
        getHeader: () => undefined,
        setHeader: () => {}
      }
    }
  };
}
```

This is backward compatible: every existing call site (`mockEvent()`, `mockEvent(cookie)`, `mockEvent(cookie, { path, params })`) still works, since `body` is an additional optional key on the same `opts` object.

- [ ] **Step 2: Write the failing tests**

Create `tests/integration/music-track-edit.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import handler from '../../server/api/admin/music/tracks/[id].patch';
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

function eventFor(trackId: string, body: any, cookieHeader?: string) {
  return mockEvent(cookieHeader, { path: `/api/admin/music/tracks/${trackId}`, params: { id: trackId }, body });
}

describe('PATCH /api/admin/music/tracks/[id]', () => {
  it('returns 401 for a guest', async () => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });
    await expect(handler(eventFor('t1', { title: 'New Title' }))).rejects.toMatchObject({ statusCode: 401 });
  });

  it('returns 403 for a logged-in non-admin', async () => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });
    const cookie = loginAs('u1', 'user');
    await expect(handler(eventFor('t1', { title: 'New Title' }, cookie))).rejects.toMatchObject({ statusCode: 403 });
  });

  it('returns 404 for a nonexistent track', async () => {
    const cookie = loginAs('admin1', 'admin');
    await expect(handler(eventFor('missing', { title: 'X' }, cookie))).rejects.toMatchObject({ statusCode: 404 });
  });

  it('updates only the fields provided, leaving others untouched', async () => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', trackNumber: 3, genre: 'Rock', language: 'en' });
    const cookie = loginAs('admin1', 'admin');

    const result: any = await handler(eventFor('t1', { genre: 'Electro' }, cookie));
    expect(result.track.genre).toBe('Electro');
    expect(result.track.track_number).toBe(3);
    expect(result.track.language).toBe('en');
  });

  it('clears an optional field to NULL when submitted empty', async () => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', genre: 'Rock' });
    const cookie = loginAs('admin1', 'admin');

    const result: any = await handler(eventFor('t1', { genre: '' }, cookie));
    expect(result.track.genre).toBeNull();
  });

  it('rejects an empty title', async () => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });
    const cookie = loginAs('admin1', 'admin');

    await expect(handler(eventFor('t1', { title: '   ' }, cookie))).rejects.toMatchObject({ statusCode: 400 });
  });

  it('updates the title when a non-empty value is provided', async () => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });
    const cookie = loginAs('admin1', 'admin');

    const result: any = await handler(eventFor('t1', { title: 'Corrected Title' }, cookie));
    expect(result.track.title).toBe('Corrected Title');
  });

  it('rejects a trackNumber that is not a positive integer', async () => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });
    const cookie = loginAs('admin1', 'admin');

    await expect(handler(eventFor('t1', { trackNumber: -1 }, cookie))).rejects.toMatchObject({ statusCode: 400 });
    await expect(handler(eventFor('t1', { trackNumber: 1.5 }, cookie))).rejects.toMatchObject({ statusCode: 400 });
  });

  it('clears trackNumber to NULL when submitted as an empty string', async () => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', trackNumber: 5 });
    const cookie = loginAs('admin1', 'admin');

    const result: any = await handler(eventFor('t1', { trackNumber: '' }, cookie));
    expect(result.track.track_number).toBeNull();
  });

  it('sets trackNumber when a valid positive integer is provided', async () => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });
    const cookie = loginAs('admin1', 'admin');

    const result: any = await handler(eventFor('t1', { trackNumber: 7 }, cookie));
    expect(result.track.track_number).toBe(7);
  });

  it('returns 400 when the body has no updatable fields', async () => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });
    const cookie = loginAs('admin1', 'admin');

    await expect(handler(eventFor('t1', {}, cookie))).rejects.toMatchObject({ statusCode: 400 });
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/integration/music-track-edit.test.ts`
Expected: FAIL with a module-not-found error for `server/api/admin/music/tracks/[id].patch`.

- [ ] **Step 4: Implement the endpoint**

Create `server/api/admin/music/tracks/[id].patch.ts`:

```ts
import { defineEventHandler, readBody, createError } from 'h3';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);

  const trackId = event.context.params?.id;
  if (!trackId) {
    throw createError({ statusCode: 400, statusMessage: 'Track ID is required.' });
  }

  const db = getDb();

  const existing = db.prepare('SELECT id FROM music_tracks WHERE id = ?').get(trackId);
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Track not found.' });
  }

  const body = await readBody(event);

  const setClauses: string[] = [];
  const params: any[] = [];

  if (Object.prototype.hasOwnProperty.call(body, 'title')) {
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title) {
      throw createError({ statusCode: 400, statusMessage: 'Title cannot be empty.' });
    }
    setClauses.push('title = ?');
    params.push(title);
  }

  if (Object.prototype.hasOwnProperty.call(body, 'genre')) {
    const genre = typeof body.genre === 'string' ? body.genre.trim() : '';
    setClauses.push('genre = ?');
    params.push(genre || null);
  }

  if (Object.prototype.hasOwnProperty.call(body, 'language')) {
    const language = typeof body.language === 'string' ? body.language.trim() : '';
    setClauses.push('language = ?');
    params.push(language || null);
  }

  if (Object.prototype.hasOwnProperty.call(body, 'trackNumber')) {
    const raw = body.trackNumber;
    let trackNumber: number | null = null;
    if (raw !== '' && raw !== null && raw !== undefined) {
      const parsed = Number(raw);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw createError({ statusCode: 400, statusMessage: 'trackNumber must be a positive integer.' });
      }
      trackNumber = parsed;
    }
    setClauses.push('track_number = ?');
    params.push(trackNumber);
  }

  if (setClauses.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'No fields to update.' });
  }

  params.push(trackId);
  db.prepare(`UPDATE music_tracks SET ${setClauses.join(', ')} WHERE id = ?`).run(...params);

  const updated = db.prepare('SELECT id, title, track_number, genre, language FROM music_tracks WHERE id = ?').get(trackId);

  return { track: updated };
});
```

If the test run in Step 3 (once re-run after writing this file) fails with a "not defined" error for `requireAdmin` or `getDb`, add the exact explicit import the error names, matching this file's actual directory depth relative to `server/utils/auth.ts` and `server/utils/db.ts` (follow the same pattern as 3c-i's Tasks 2–4, e.g. `import { requireAdmin } from '../../../../utils/auth';` if that's what the failure demands — count the `../` from this file's real path, don't assume).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/integration/music-track-edit.test.ts`
Expected: PASS (all 10 tests)

- [ ] **Step 6: Run the full suite to confirm no regressions**

Run: `npm test -- --run`
Expected: all existing tests still pass (the `mockEvent` signature change is additive/optional).

- [ ] **Step 7: Commit**

```bash
git add tests/helpers/testDb.ts server/api/admin/music/tracks/\[id\].patch.ts tests/integration/music-track-edit.test.ts
git commit -m "feat: add PATCH /api/admin/music/tracks/[id] endpoint"
```

---

### Task 2: `PATCH /api/admin/music/albums/[id]` + `cover_url` priority fix

**Files:**
- Create: `server/api/admin/music/albums/[id].patch.ts`
- Test: `tests/integration/music-album-edit.test.ts`
- Modify: `server/api/music/artists/[id]/index.get.ts`
- Modify: `tests/integration/music-artist-detail.test.ts`

**Interfaces:**
- Consumes: `requireAdmin`, extended `mockEvent` with `body` support (both from Task 1).
- Produces: `PATCH /api/admin/music/albums/:id` response shape `{ album: { id, title, release_year, cover_url } }`. Not consumed by any other task's tests; Task 4's UI calls it directly.

- [ ] **Step 1: Write the failing tests for the new endpoint**

Create `tests/integration/music-album-edit.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import handler from '../../server/api/admin/music/albums/[id].patch';
import {
  createTestDb,
  insertUser,
  insertSession,
  insertMusicArtist,
  insertMusicAlbum,
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

function eventFor(albumId: string, body: any, cookieHeader?: string) {
  return mockEvent(cookieHeader, { path: `/api/admin/music/albums/${albumId}`, params: { id: albumId }, body });
}

describe('PATCH /api/admin/music/albums/[id]', () => {
  it('returns 401 for a guest', async () => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicAlbum(db, { id: 'al1', artistId: 'a1' });
    await expect(handler(eventFor('al1', { title: 'New Title' }))).rejects.toMatchObject({ statusCode: 401 });
  });

  it('returns 403 for a logged-in non-admin', async () => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicAlbum(db, { id: 'al1', artistId: 'a1' });
    const cookie = loginAs('u1', 'user');
    await expect(handler(eventFor('al1', { title: 'New Title' }, cookie))).rejects.toMatchObject({ statusCode: 403 });
  });

  it('returns 404 for a nonexistent album', async () => {
    const cookie = loginAs('admin1', 'admin');
    await expect(handler(eventFor('missing', { title: 'X' }, cookie))).rejects.toMatchObject({ statusCode: 404 });
  });

  it('updates only the fields provided', async () => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicAlbum(db, { id: 'al1', artistId: 'a1', releaseYear: 2020 });
    const cookie = loginAs('admin1', 'admin');

    const result: any = await handler(eventFor('al1', { title: 'Renamed' }, cookie));
    expect(result.album.title).toBe('Renamed');
    expect(result.album.release_year).toBe(2020);
  });

  it('rejects an empty title', async () => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicAlbum(db, { id: 'al1', artistId: 'a1' });
    const cookie = loginAs('admin1', 'admin');

    await expect(handler(eventFor('al1', { title: '' }, cookie))).rejects.toMatchObject({ statusCode: 400 });
  });

  it('clears releaseYear to NULL when submitted empty', async () => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicAlbum(db, { id: 'al1', artistId: 'a1', releaseYear: 1999 });
    const cookie = loginAs('admin1', 'admin');

    const result: any = await handler(eventFor('al1', { releaseYear: '' }, cookie));
    expect(result.album.release_year).toBeNull();
  });

  it('rejects a releaseYear outside 1900-2100', async () => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicAlbum(db, { id: 'al1', artistId: 'a1' });
    const cookie = loginAs('admin1', 'admin');

    await expect(handler(eventFor('al1', { releaseYear: 1899 }, cookie))).rejects.toMatchObject({ statusCode: 400 });
    await expect(handler(eventFor('al1', { releaseYear: 2101 }, cookie))).rejects.toMatchObject({ statusCode: 400 });
  });

  it('sets and clears coverUrl', async () => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicAlbum(db, { id: 'al1', artistId: 'a1' });
    const cookie = loginAs('admin1', 'admin');

    const setResult: any = await handler(eventFor('al1', { coverUrl: 'https://example.com/cover.jpg' }, cookie));
    expect(setResult.album.cover_url).toBe('https://example.com/cover.jpg');

    const clearResult: any = await handler(eventFor('al1', { coverUrl: '' }, cookie));
    expect(clearResult.album.cover_url).toBeNull();
  });

  it('returns 400 when the body has no updatable fields', async () => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicAlbum(db, { id: 'al1', artistId: 'a1' });
    const cookie = loginAs('admin1', 'admin');

    await expect(handler(eventFor('al1', {}, cookie))).rejects.toMatchObject({ statusCode: 400 });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/integration/music-album-edit.test.ts`
Expected: FAIL with a module-not-found error for `server/api/admin/music/albums/[id].patch`.

- [ ] **Step 3: Implement the endpoint**

Create `server/api/admin/music/albums/[id].patch.ts`:

```ts
import { defineEventHandler, readBody, createError } from 'h3';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);

  const albumId = event.context.params?.id;
  if (!albumId) {
    throw createError({ statusCode: 400, statusMessage: 'Album ID is required.' });
  }

  const db = getDb();

  const existing = db.prepare('SELECT id FROM music_albums WHERE id = ?').get(albumId);
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Album not found.' });
  }

  const body = await readBody(event);

  const setClauses: string[] = [];
  const params: any[] = [];

  if (Object.prototype.hasOwnProperty.call(body, 'title')) {
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title) {
      throw createError({ statusCode: 400, statusMessage: 'Title cannot be empty.' });
    }
    setClauses.push('title = ?');
    params.push(title);
  }

  if (Object.prototype.hasOwnProperty.call(body, 'releaseYear')) {
    const raw = body.releaseYear;
    let releaseYear: number | null = null;
    if (raw !== '' && raw !== null && raw !== undefined) {
      const parsed = Number(raw);
      if (!Number.isInteger(parsed) || parsed < 1900 || parsed > 2100) {
        throw createError({ statusCode: 400, statusMessage: 'releaseYear must be an integer between 1900 and 2100.' });
      }
      releaseYear = parsed;
    }
    setClauses.push('release_year = ?');
    params.push(releaseYear);
  }

  if (Object.prototype.hasOwnProperty.call(body, 'coverUrl')) {
    const coverUrl = typeof body.coverUrl === 'string' ? body.coverUrl.trim() : '';
    setClauses.push('cover_url = ?');
    params.push(coverUrl || null);
  }

  if (setClauses.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'No fields to update.' });
  }

  params.push(albumId);
  db.prepare(`UPDATE music_albums SET ${setClauses.join(', ')} WHERE id = ?`).run(...params);

  const updated = db.prepare('SELECT id, title, release_year, cover_url FROM music_albums WHERE id = ?').get(albumId);

  return { album: updated };
});
```

If the test run fails on a "not defined" error, add the exact explicit import the failure demands (same reasoning as Task 1, Step 4).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/integration/music-album-edit.test.ts`
Expected: PASS (all 9 tests)

- [ ] **Step 5: Write the failing test for the `cover_url` priority fix**

Open `tests/integration/music-artist-detail.test.ts`. Add this test inside the existing `describe('GET /api/music/artists/[id]', ...)` block (after the existing `"computes cover_url as the first completed track's thumbnail..."` test):

```ts
  it('prefers a manually-set cover_url over the computed thumbnail fallback', async () => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicAlbum(db, { id: 'al1', artistId: 'a1' });
    db.prepare('UPDATE music_albums SET cover_url = ? WHERE id = ?').run('https://example.com/manual-cover.jpg', 'al1');
    insertMusicTrack(db, { id: 't1', artistId: 'a1', albumId: 'al1', trackNumber: 1, localThumbnailPath: '/downloads-music/a1/t1.jpg' });

    const result: any = await handler(eventFor('a1'));
    expect(result.albums[0].cover_url).toBe('https://example.com/manual-cover.jpg');
  });
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `npx vitest run tests/integration/music-artist-detail.test.ts -t "prefers a manually-set cover_url"`
Expected: FAIL — the endpoint currently always uses the computed subquery, ignoring any real `cover_url` value.

- [ ] **Step 7: Apply the fix**

Open `server/api/music/artists/[id]/index.get.ts`. In the `albums` query, find:

```sql
      COUNT(t.id) as track_count,
      (
        SELECT t2.local_thumbnail_path
        FROM music_tracks t2
        WHERE t2.album_id = al.id AND t2.download_status = 'completed'
        ORDER BY t2.track_number ASC, t2.created_at ASC
        LIMIT 1
      ) as cover_url
```

Replace with:

```sql
      COUNT(t.id) as track_count,
      COALESCE(
        al.cover_url,
        (
          SELECT t2.local_thumbnail_path
          FROM music_tracks t2
          WHERE t2.album_id = al.id AND t2.download_status = 'completed'
          ORDER BY t2.track_number ASC, t2.created_at ASC
          LIMIT 1
        )
      ) as cover_url
```

- [ ] **Step 8: Run the full detail test file to verify everything passes**

Run: `npx vitest run tests/integration/music-artist-detail.test.ts`
Expected: PASS (all 9 tests, including the new one — the pre-existing "computes cover_url as the first completed track's thumbnail" test still passes since it never sets `al.cover_url`, so `COALESCE` falls through to the same subquery as before).

- [ ] **Step 9: Run the full suite to confirm no regressions**

Run: `npm test -- --run`
Expected: all tests pass.

- [ ] **Step 10: Commit**

```bash
git add server/api/admin/music/albums/\[id\].patch.ts tests/integration/music-album-edit.test.ts server/api/music/artists/\[id\]/index.get.ts tests/integration/music-artist-detail.test.ts
git commit -m "feat: add PATCH /api/admin/music/albums/[id] endpoint and cover_url priority fix"
```

---

### Task 3: Edit modal components

**Files:**
- Create: `app/components/MusicTrackEditModal.vue`
- Create: `app/components/MusicAlbumEditModal.vue`

**Interfaces:**
- Consumes: `BaseModal` (existing, `app/components/BaseModal.vue`, auto-imported), `useToast` (existing, `~/composables/useToast`).
- Produces: `MusicTrackEditModal` — props `{ show: boolean; track: { id: string; title: string; track_number: number | null; genre: string | null; language: string | null } | null }`, emits `close` and `saved` (payload: the endpoint's returned `track` object). `MusicAlbumEditModal` — props `{ show: boolean; album: { id: string; title: string; release_year: number | null; cover_url: string | null } | null }`, emits `close` and `saved` (payload: the endpoint's returned `album` object). Both consumed by Task 4.

- [ ] **Step 1: Create the track edit modal**

Create `app/components/MusicTrackEditModal.vue`:

```vue
<template>
  <BaseModal :show="show" title="Modifier la piste" @close="$emit('close')">
    <form @submit.prevent="handleSubmit">
      <div class="form-group">
        <label for="track-edit-title">Titre *</label>
        <input id="track-edit-title" v-model="form.title" type="text" required class="form-input" />
      </div>
      <div class="form-group" style="margin-top: 16px;">
        <label for="track-edit-number">N° de piste</label>
        <input id="track-edit-number" v-model.number="form.trackNumber" type="number" min="1" class="form-input" />
      </div>
      <div class="form-group" style="margin-top: 16px;">
        <label for="track-edit-genre">Genre</label>
        <input id="track-edit-genre" v-model="form.genre" type="text" class="form-input" />
      </div>
      <div class="form-group" style="margin-top: 16px;">
        <label for="track-edit-language">Langue</label>
        <input id="track-edit-language" v-model="form.language" type="text" class="form-input" />
      </div>
      <div class="modal-footer" style="margin-top: 24px; padding: 0; border: none;">
        <button type="button" class="btn btn-secondary" @click="$emit('close')">Annuler</button>
        <button type="submit" class="btn btn-primary" :disabled="saving">{{ saving ? 'Enregistrement...' : 'Enregistrer' }}</button>
      </div>
    </form>
  </BaseModal>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { useToast } from '~/composables/useToast';

const props = defineProps<{
  show: boolean;
  track: { id: string; title: string; track_number: number | null; genre: string | null; language: string | null } | null;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'saved', track: any): void;
}>();

const toast = useToast();
const saving = ref(false);
const form = ref<{ title: string; trackNumber: number | string; genre: string; language: string }>({
  title: '',
  trackNumber: '',
  genre: '',
  language: ''
});

watch(
  () => props.track,
  (t) => {
    if (t) {
      form.value = {
        title: t.title || '',
        trackNumber: t.track_number ?? '',
        genre: t.genre || '',
        language: t.language || ''
      };
    }
  },
  { immediate: true }
);

async function handleSubmit() {
  if (!props.track) return;
  saving.value = true;
  try {
    const data = await $fetch<any>(`/api/admin/music/tracks/${props.track.id}`, {
      method: 'PATCH',
      body: {
        title: form.value.title,
        trackNumber: form.value.trackNumber,
        genre: form.value.genre,
        language: form.value.language
      }
    });
    toast.success('Piste mise à jour.');
    emit('saved', data.track);
  } catch (e: any) {
    toast.error(e?.data?.statusMessage || 'Erreur lors de la mise à jour de la piste.');
  } finally {
    saving.value = false;
  }
}
</script>
```

- [ ] **Step 2: Create the album edit modal**

Create `app/components/MusicAlbumEditModal.vue`:

```vue
<template>
  <BaseModal :show="show" title="Modifier l'album" @close="$emit('close')">
    <form @submit.prevent="handleSubmit">
      <div class="form-group">
        <label for="album-edit-title">Titre *</label>
        <input id="album-edit-title" v-model="form.title" type="text" required class="form-input" />
      </div>
      <div class="form-group" style="margin-top: 16px;">
        <label for="album-edit-year">Année</label>
        <input id="album-edit-year" v-model.number="form.releaseYear" type="number" min="1900" max="2100" class="form-input" />
      </div>
      <div class="form-group" style="margin-top: 16px;">
        <label for="album-edit-cover">URL de la pochette</label>
        <input id="album-edit-cover" v-model="form.coverUrl" type="text" placeholder="https://..." class="form-input" />
      </div>
      <div class="modal-footer" style="margin-top: 24px; padding: 0; border: none;">
        <button type="button" class="btn btn-secondary" @click="$emit('close')">Annuler</button>
        <button type="submit" class="btn btn-primary" :disabled="saving">{{ saving ? 'Enregistrement...' : 'Enregistrer' }}</button>
      </div>
    </form>
  </BaseModal>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { useToast } from '~/composables/useToast';

const props = defineProps<{
  show: boolean;
  album: { id: string; title: string; release_year: number | null; cover_url: string | null } | null;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'saved', album: any): void;
}>();

const toast = useToast();
const saving = ref(false);
const form = ref<{ title: string; releaseYear: number | string; coverUrl: string }>({
  title: '',
  releaseYear: '',
  coverUrl: ''
});

watch(
  () => props.album,
  (a) => {
    if (a) {
      form.value = {
        title: a.title || '',
        releaseYear: a.release_year ?? '',
        coverUrl: a.cover_url || ''
      };
    }
  },
  { immediate: true }
);

async function handleSubmit() {
  if (!props.album) return;
  saving.value = true;
  try {
    const data = await $fetch<any>(`/api/admin/music/albums/${props.album.id}`, {
      method: 'PATCH',
      body: {
        title: form.value.title,
        releaseYear: form.value.releaseYear,
        coverUrl: form.value.coverUrl
      }
    });
    toast.success('Album mis à jour.');
    emit('saved', data.album);
  } catch (e: any) {
    toast.error(e?.data?.statusMessage || "Erreur lors de la mise à jour de l'album.");
  } finally {
    saving.value = false;
  }
}
</script>
```

- [ ] **Step 3: Type-check**

Run: `npx vue-tsc -b --noEmit`
Expected: no errors beyond the 2 known pre-existing ones (`app/components/VideoPlayer.vue`, `app/pages/subscriptions.vue`, unrelated).

- [ ] **Step 4: Commit**

```bash
git add app/components/MusicTrackEditModal.vue app/components/MusicAlbumEditModal.vue
git commit -m "feat: add music track and album edit modal components"
```

---

### Task 4: Wire admin edit buttons into `/music`

**Files:**
- Modify: `app/pages/music/index.vue`

**Interfaces:**
- Consumes: `MusicTrackEditModal`, `MusicAlbumEditModal` (Task 3, auto-imported), `isAdmin` (already imported in this file via `useAuth()`).
- Produces: nothing consumed by a later task (last task in this plan).

- [ ] **Step 1: Add edit-state and handler functions to the script**

In `app/pages/music/index.vue`'s `<script setup>` block, directly below the existing `function toggleStandalone() { ... }` function (and above `let detailRequestId = 0;`), add:

```ts
const editingTrack = ref<{ track: any; groupKey: string } | null>(null);
const editingAlbum = ref<any | null>(null);

function openTrackEdit(track: any, groupKey: string) {
  editingTrack.value = { track, groupKey };
}

function closeTrackEdit() {
  editingTrack.value = null;
}

function handleTrackSaved(updated: any) {
  if (!editingTrack.value) return;
  const group = trackGroups[editingTrack.value.groupKey];
  if (group) {
    const existing = group.tracks.find((t: any) => t.id === updated.id);
    if (existing) Object.assign(existing, updated);
  }
  closeTrackEdit();
}

function openAlbumEdit(album: any) {
  editingAlbum.value = album;
}

function closeAlbumEdit() {
  editingAlbum.value = null;
}

function handleAlbumSaved(updated: any) {
  const existing = albums.value.find((a: any) => a.id === updated.id);
  if (existing) Object.assign(existing, updated);
  closeAlbumEdit();
}
```

(`Object.assign(existing, updated)` merges only the fields the endpoint returns — `title`/`track_number`/`genre`/`language` for a track, `title`/`release_year`/`cover_url` for an album — into the existing in-memory object, preserving fields the endpoints don't return, like a track's `duration`/`local_thumbnail_path` or an album's `track_count`.)

- [ ] **Step 2: Add the track edit button and modal in the template**

In the per-album track list, find:

```html
            <div v-for="track in trackGroups[album.id]?.tracks || []" :key="track.id" class="track-row">
              <span class="track-number">{{ track.track_number || '–' }}</span>
              <span class="track-title">{{ track.title }}</span>
              <span v-if="track.genre" class="badge badge-pending">{{ track.genre }}</span>
              <span v-if="track.language" class="badge badge-pending">{{ track.language }}</span>
              <span class="track-duration">{{ formatDuration(track.duration) }}</span>
            </div>
```

Replace with:

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

Find the identical block for the standalone group (the one using `trackGroups['none']?.tracks`) and apply the same change, using `openTrackEdit(track, 'none')`:

```html
            <div v-for="track in trackGroups['none']?.tracks || []" :key="track.id" class="track-row">
              <span class="track-number">{{ track.track_number || '–' }}</span>
              <span class="track-title">{{ track.title }}</span>
              <span v-if="track.genre" class="badge badge-pending">{{ track.genre }}</span>
              <span v-if="track.language" class="badge badge-pending">{{ track.language }}</span>
              <span class="track-duration">{{ formatDuration(track.duration) }}</span>
              <button v-if="isAdmin" @click="openTrackEdit(track, 'none')" class="edit-btn" title="Modifier">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"></path></svg>
              </button>
            </div>
```

- [ ] **Step 3: Add the album edit button in the template**

Find:

```html
          <div class="album-header" @click="toggleAlbumExpand(album.id)">
            <img :src="album.cover_url || fallbackCover" class="album-cover" alt="" />
            <div class="album-info">
              <h3 class="album-title">{{ album.title }}</h3>
              <p class="album-meta">{{ album.release_year || 'Année inconnue' }} &bull; {{ album.track_count }} titre(s)</p>
            </div>
          </div>
```

Replace with:

```html
          <div class="album-header" @click="toggleAlbumExpand(album.id)">
            <img :src="album.cover_url || fallbackCover" class="album-cover" alt="" />
            <div class="album-info">
              <h3 class="album-title">{{ album.title }}</h3>
              <p class="album-meta">{{ album.release_year || 'Année inconnue' }} &bull; {{ album.track_count }} titre(s)</p>
            </div>
            <button v-if="isAdmin" @click.stop="openAlbumEdit(album)" class="edit-btn" title="Modifier">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"></path></svg>
            </button>
          </div>
```

(`@click.stop` is required here — `.album-header` already has its own `@click="toggleAlbumExpand(album.id)"`, and without stopping propagation, clicking the pencil button would also toggle the album's expanded state.)

- [ ] **Step 4: Add the two modal instances**

At the end of the template, immediately before the final closing `</div>` of `.music-page` (i.e., right after the closing `</div>` of `.artist-detail-view`), add:

```html
    <MusicTrackEditModal
      :show="!!editingTrack"
      :track="editingTrack?.track ?? null"
      @close="closeTrackEdit"
      @saved="handleTrackSaved"
    />
    <MusicAlbumEditModal
      :show="!!editingAlbum"
      :album="editingAlbum"
      @close="closeAlbumEdit"
      @saved="handleAlbumSaved"
    />
```

- [ ] **Step 5: Add CSS for the edit button**

In the `<style scoped>` block, directly after the existing `.load-more-btn { margin-top: 12px; }` rule, add:

```css
.edit-btn {
  background: none;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 4px;
  display: inline-flex;
  align-items: center;
  transition: color 0.2s;
  flex-shrink: 0;
  margin-left: auto;
}

.edit-btn:hover {
  color: var(--text-primary);
}
```

(`margin-left: auto` pushes the button to the right end of both `.track-row` and `.album-header`, both of which are `display: flex` — matching the existing layout without needing per-context overrides.)

- [ ] **Step 6: Type-check**

Run: `npx vue-tsc -b --noEmit`
Expected: no new errors beyond the 2 known pre-existing ones.

- [ ] **Step 7: Manual verification**

Start the dev server, log in as an admin, navigate to `/music`, open an artist with at least one album and one standalone track, and confirm:
- A pencil button appears on the album header and on each track row.
- Clicking a track's pencil opens `MusicTrackEditModal` pre-filled with that track's current title/track number/genre/language.
- Editing a field and saving updates the row in place (no page reload, no refetch) and shows a success toast.
- Clicking an album's pencil opens `MusicAlbumEditModal` pre-filled with title/year/cover URL; saving updates the album header in place, including re-rendering the cover image if changed.
- Clearing a field (e.g. genre) to empty and saving actually clears it — re-open the same track's edit modal and confirm the field is now empty.
- Log out (or log in as a non-admin user), reload `/music`, open the same artist: no pencil buttons appear anywhere.
- Clicking an album's pencil button does NOT also toggle the album's expanded/collapsed state (confirms the `@click.stop` fix works).

- [ ] **Step 8: Commit**

```bash
git add app/pages/music/index.vue
git commit -m "feat: wire admin metadata editing into music catalog page"
```

---

## Self-Review Notes

- **Spec coverage:** `PATCH /api/admin/music/tracks/[id]` (Task 1) ✓, `PATCH /api/admin/music/albums/[id]` + `cover_url` priority fix (Task 2) ✓, edit modals (Task 3) ✓, admin-only in-context editing UI wired into `/music` with local state patching (Task 4) ✓. The "no keep-current sentinel needed" design rationale is realized by the modals' `watch(..., { immediate: true })` pre-fill from the row passed in as a prop, sourced from the page's own already-loaded state — never a fresh fetch, never a generic default.
- **Placeholder scan:** none found — every step shows complete code, exact file paths, exact commands.
- **Type consistency:** `PATCH .../tracks/:id` returns `{ track: { id, title, track_number, genre, language } }` (Task 1) — matches `MusicTrackEditModal`'s `saved` payload type and `handleTrackSaved`'s usage (Task 3/4). `PATCH .../albums/:id` returns `{ album: { id, title, release_year, cover_url } }` (Task 2) — matches `MusicAlbumEditModal` and `handleAlbumSaved` (Task 3/4). `requireAdmin`/extended `mockEvent` (Task 1) are used identically in Task 2's test file.
