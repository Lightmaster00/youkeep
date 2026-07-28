# Music Catalog Browsing UI (3c-i) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static "coming soon" placeholder at `/music` with a real, regular-user-facing catalog: a filterable artist grid and a per-artist detail view (albums + standalone tracks, paginated), backed by three new read-only endpoints.

**Architecture:** Three new GET endpoints under `server/api/music/artists/` (list with facets, detail, paginated tracks-per-group) sit behind a new `canAccessMusicArtist` helper that mirrors the existing `canAccessMusicTrack`/`canAccessChannel` visibility logic. `app/pages/music/index.vue` is rewritten to a `channels.vue`-style single-page grid/detail split, driven entirely by the `artistId` query param (no new route).

**Tech Stack:** Nuxt 4 / Nitro (H3) server routes, better-sqlite3, Vue 3 Composition API, Vitest.

## Global Constraints

- Only `download_status = 'completed'` tracks are ever shown or counted in any of this plan's endpoints or UI.
- Visibility filtering has three tiers, no per-user grant table for music (unlike video's `user_channel_access`): guest sees `public` only; logged-in non-admin sees `public` + `private`; admin sees everything, including `ultra_private`.
- `music_artists.visibility` and any music visibility check must fail closed on an unrecognized value (default to the most restrictive level), exactly like the existing `canAccessMusicTrack`.
- No new database columns or migrations. `music_albums.cover_url` stays `NULL` from ingestion — album art is a server-computed fallback (first completed track's `local_thumbnail_path`), never written back to the column.
- Route stays `/music` for both grid and detail views — detail is `?artistId=X` on the same page, never a new route. No changes to `app/spaces.ts`.
- No editing endpoints or UI (that is a separate future sub-project). No audio playback.
- Type-checking requires `npx vue-tsc -b --noEmit` — plain `vue-tsc --noEmit -p .` is a silent no-op and must never be used as a verification step.
- All new user-facing UI copy is in French, matching the existing precedent ("Vidéo", "Musique", "Bibliothèque").

---

### Task 1: Test fixtures and `canAccessMusicArtist`

**Files:**
- Modify: `tests/helpers/testDb.ts`
- Modify: `server/utils/auth.ts`
- Modify: `tests/integration/access-control.test.ts`

**Interfaces:**
- Consumes: nothing new (extends existing `createTestDb`/`insertMusicArtist`/`insertMusicTrack`/`mockEvent` helpers and `getUserFromSession` from `server/utils/auth.ts`).
- Produces: `canAccessMusicArtist(artistId: string, event: any): Promise<boolean>` (used by Tasks 3 and 4). Extended test schema: `music_albums` table, `music_tracks` gains `album_id`, `track_number`, `genre`, `language`, `duration`, `download_status`. New helper `insertMusicAlbum(db, opts)`. Extended `insertMusicArtist(db, opts)` accepts an optional `name`. Extended `insertMusicTrack(db, opts)` accepts `albumId`, `trackNumber`, `genre`, `language`, `duration`, `downloadStatus`. Extended `mockEvent(cookieHeader?, opts?)` accepts `{ path?: string; params?: Record<string, string> }` for query-string and route-param testing (used by Tasks 2–4's endpoint tests).

- [ ] **Step 1: Extend the test database schema**

Open `tests/helpers/testDb.ts`. Replace the `music_tracks` table definition and add a `music_albums` table. Find:

```sql
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

Replace with:

```sql
    CREATE TABLE music_artists (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      avatar_url TEXT,
      banner_url TEXT,
      visibility TEXT DEFAULT 'public',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE music_albums (
      id TEXT PRIMARY KEY,
      artist_id TEXT NOT NULL,
      title TEXT NOT NULL,
      release_year INTEGER,
      source TEXT NOT NULL DEFAULT 'youtube',
      created_at INTEGER NOT NULL,
      FOREIGN KEY (artist_id) REFERENCES music_artists(id) ON DELETE CASCADE
    );

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
```

(`download_status` defaults to `'completed'` in this test schema — unlike the real schema's `'pending'` default — because every test fixture in this plan wants a visible/completed track unless a test explicitly overrides it, mirroring how `insertVideo`'s test helper already defaults `downloadStatus` to `'completed'` for the same reason.)

- [ ] **Step 2: Extend `insertMusicArtist` and `insertMusicTrack`, add `insertMusicAlbum`**

Replace the existing `insertMusicArtist` and `insertMusicTrack` functions at the bottom of `tests/helpers/testDb.ts`:

```ts
export function insertMusicArtist(db: Database.Database, opts: { id: string; name?: string; visibility?: string }) {
  db.prepare(`
    INSERT INTO music_artists (id, name, visibility, created_at)
    VALUES (?, ?, ?, ?)
  `).run(opts.id, opts.name ?? `Artist ${opts.id}`, opts.visibility ?? 'public', Date.now());
}

export function insertMusicAlbum(db: Database.Database, opts: {
  id: string;
  artistId: string;
  title?: string;
  releaseYear?: number | null;
  source?: string;
  createdAt?: number;
}) {
  db.prepare(`
    INSERT INTO music_albums (id, artist_id, title, release_year, source, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    opts.id,
    opts.artistId,
    opts.title ?? `Album ${opts.id}`,
    opts.releaseYear ?? null,
    opts.source ?? 'youtube',
    opts.createdAt ?? Date.now()
  );
}

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

- [ ] **Step 3: Extend `mockEvent` to support `path` and route `params`**

Replace the existing `mockEvent` function:

```ts
export function mockEvent(cookieHeader?: string, opts?: { path?: string; params?: Record<string, string> }): any {
  return {
    path: opts?.path ?? '/',
    context: { params: opts?.params ?? {} },
    node: {
      req: { headers: { cookie: cookieHeader || '' } },
      res: {
        getHeader: () => undefined,
        setHeader: () => {}
      }
    }
  };
}
```

This is backward compatible: every existing call site (`mockEvent()`, `mockEvent(sessionCookie(sessionId))`) still works because `opts` is optional. `event.path` is what H3's `getQuery(event)` reads (it does not read `event.node.req.url`); `event.context.params` is what `event.context.params?.id` reads in `[id]`-style route handlers.

- [ ] **Step 4: Write the failing tests for `canAccessMusicArtist`**

Open `tests/integration/access-control.test.ts`. Add `insertMusicAlbum` to the existing import from `'../helpers/testDb'` (alongside `insertMusicArtist`, `insertMusicTrack`, etc.), and add `canAccessMusicArtist` to the existing import from `'../../server/utils/auth'` (alongside `canAccessVideo`, `canAccessChannel`, `canAccessMusicTrack`). Then add a new `describe` block after the existing `describe('canAccessMusicTrack', ...)` block (before the file's closing):

```ts
describe('canAccessMusicArtist', () => {
  it('is accessible to a guest when the artist is public', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'public' });
    expect(await canAccessMusicArtist('a1', guestEvent())).toBe(true);
  });

  it('denies a guest access to a private artist', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'private' });
    expect(await canAccessMusicArtist('a1', guestEvent())).toBe(false);
  });

  it('allows any logged-in user to access a private artist', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'private' });
    const event = loginAs('u1', 'user');
    expect(await canAccessMusicArtist('a1', event)).toBe(true);
  });

  it('is not accessible to a regular user when the artist is ultra_private', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'ultra_private' });
    const event = loginAs('u1', 'user');
    expect(await canAccessMusicArtist('a1', event)).toBe(false);
  });

  it('is always accessible to an admin regardless of visibility', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'ultra_private' });
    const event = loginAs('admin1', 'admin');
    expect(await canAccessMusicArtist('a1', event)).toBe(true);
  });

  it('returns false for an artist that does not exist', async () => {
    expect(await canAccessMusicArtist('missing', guestEvent())).toBe(false);
  });

  it('fails closed for an unrecognized visibility value', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'oops-a-typo' });
    const event = loginAs('u1', 'user');
    expect(await canAccessMusicArtist('a1', event)).toBe(false);
  });
});
```

- [ ] **Step 5: Run the tests to verify they fail**

Run: `npx vitest run tests/integration/access-control.test.ts`
Expected: FAIL — `canAccessMusicArtist` is not exported from `server/utils/auth.ts` yet, and `insertMusicAlbum` is not exported from `tests/helpers/testDb.ts` yet.

- [ ] **Step 6: Implement `canAccessMusicArtist`**

Open `server/utils/auth.ts`. Add this function immediately after the existing `canAccessMusicTrack` function (end of file):

```ts
export async function canAccessMusicArtist(artistId: string, event: any): Promise<boolean> {
  const db = getDb();

  const artist = db.prepare('SELECT visibility FROM music_artists WHERE id = ?').get(artistId) as { visibility: string } | undefined;

  if (!artist) return false;

  const user = await getUserFromSession(event);

  const visMap: Record<string, number> = { 'public': 0, 'private': 1, 'ultra_private': 2 };
  // Same fail-closed reasoning as canAccessMusicTrack: music_artists.visibility
  // has no CHECK constraint, so an unrecognized value must never be treated
  // as public.
  const level = visMap[artist.visibility] ?? 2;

  if (level === 0) return true; // Public: everyone
  if (!user) return false;      // Guest: no access to restricted content
  if (user.role === 'admin') return true; // Admin sees everything
  if (level === 1) return true; // Private: any logged-in member

  // Ultra Private: admin-only for music today — no equivalent of
  // user_channel_access exists for music artists yet.
  return false;
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run tests/integration/access-control.test.ts`
Expected: PASS (all tests, including the new `canAccessMusicArtist` block)

- [ ] **Step 8: Run the full test suite to confirm no regressions**

Run: `npm test -- --run`
Expected: all existing tests still pass (the `mockEvent`/`insertMusicArtist`/`insertMusicTrack` signature changes are additive/optional, so no existing call site should break).

- [ ] **Step 9: Commit**

```bash
git add tests/helpers/testDb.ts server/utils/auth.ts tests/integration/access-control.test.ts
git commit -m "feat: add canAccessMusicArtist and extend music test fixtures"
```

---

### Task 2: `GET /api/music/artists` (list + facets)

**Files:**
- Create: `server/api/music/artists/index.get.ts`
- Test: `tests/integration/music-artists-list.test.ts`

**Interfaces:**
- Consumes: `getDb()` (Nitro global), `getUserFromSession` from `server/utils/auth.ts`.
- Produces: `GET /api/music/artists` response shape `{ artists: Array<{ id, name, avatar_url, visibility, track_count }>, facets: { genres: string[], languages: string[], years: number[] } }`. Consumed by Task 5's grid view.

- [ ] **Step 1: Write the failing tests**

Create `tests/integration/music-artists-list.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import handler from '../../server/api/music/artists/index.get';
import {
  createTestDb,
  insertUser,
  insertSession,
  insertMusicArtist,
  insertMusicAlbum,
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
  return mockEvent(sessionCookie(sessionId), { path: '/api/music/artists' });
}

const guestEvent = (path = '/api/music/artists') => mockEvent(undefined, { path });

describe('GET /api/music/artists', () => {
  it('only includes public artists for a guest', async () => {
    insertMusicArtist(db, { id: 'pub', name: 'Public Artist', visibility: 'public' });
    insertMusicTrack(db, { id: 't1', artistId: 'pub' });
    insertMusicArtist(db, { id: 'priv', name: 'Private Artist', visibility: 'private' });
    insertMusicTrack(db, { id: 't2', artistId: 'priv' });

    const result: any = await handler(guestEvent());
    const ids = result.artists.map((a: any) => a.id);
    expect(ids).toContain('pub');
    expect(ids).not.toContain('priv');
  });

  it('includes private artists for a logged-in user but not ultra_private', async () => {
    insertMusicArtist(db, { id: 'priv', visibility: 'private' });
    insertMusicTrack(db, { id: 't1', artistId: 'priv' });
    insertMusicArtist(db, { id: 'ultra', visibility: 'ultra_private' });
    insertMusicTrack(db, { id: 't2', artistId: 'ultra' });

    const result: any = await handler(loginAs('u1'));
    const ids = result.artists.map((a: any) => a.id);
    expect(ids).toContain('priv');
    expect(ids).not.toContain('ultra');
  });

  it('includes ultra_private artists for an admin', async () => {
    insertMusicArtist(db, { id: 'ultra', visibility: 'ultra_private' });
    insertMusicTrack(db, { id: 't1', artistId: 'ultra' });

    const result: any = await handler(loginAs('admin1', 'admin'));
    expect(result.artists.map((a: any) => a.id)).toContain('ultra');
  });

  it('excludes an artist with zero completed tracks', async () => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', downloadStatus: 'downloading' });

    const result: any = await handler(guestEvent());
    expect(result.artists.map((a: any) => a.id)).not.toContain('a1');
  });

  it('counts only completed tracks in track_count', async () => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', downloadStatus: 'completed' });
    insertMusicTrack(db, { id: 't2', artistId: 'a1', downloadStatus: 'completed' });
    insertMusicTrack(db, { id: 't3', artistId: 'a1', downloadStatus: 'pending' });

    const result: any = await handler(guestEvent());
    const artist = result.artists.find((a: any) => a.id === 'a1');
    expect(artist.track_count).toBe(2);
  });

  it('filters by search (case-insensitive substring of name)', async () => {
    insertMusicArtist(db, { id: 'a1', name: 'Daft Punk' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });
    insertMusicArtist(db, { id: 'a2', name: 'Justice' });
    insertMusicTrack(db, { id: 't2', artistId: 'a2' });

    const result: any = await handler(guestEvent('/api/music/artists?search=daft'));
    expect(result.artists.map((a: any) => a.id)).toEqual(['a1']);
  });

  it('filters by genre and language', async () => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', genre: 'Electro', language: 'fr' });
    insertMusicArtist(db, { id: 'a2' });
    insertMusicTrack(db, { id: 't2', artistId: 'a2', genre: 'Rock', language: 'en' });

    const byGenre: any = await handler(guestEvent('/api/music/artists?genre=Electro'));
    expect(byGenre.artists.map((a: any) => a.id)).toEqual(['a1']);

    const byLanguage: any = await handler(guestEvent('/api/music/artists?language=en'));
    expect(byLanguage.artists.map((a: any) => a.id)).toEqual(['a2']);
  });

  it('filters by release year via the album join', async () => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicAlbum(db, { id: 'al1', artistId: 'a1', releaseYear: 2020 });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', albumId: 'al1' });
    insertMusicArtist(db, { id: 'a2' });
    insertMusicAlbum(db, { id: 'al2', artistId: 'a2', releaseYear: 1999 });
    insertMusicTrack(db, { id: 't2', artistId: 'a2', albumId: 'al2' });

    const result: any = await handler(guestEvent('/api/music/artists?year=2020'));
    expect(result.artists.map((a: any) => a.id)).toEqual(['a1']);
  });

  it('returns facets unaffected by the currently applied filters', async () => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', genre: 'Electro', language: 'fr' });
    insertMusicArtist(db, { id: 'a2' });
    insertMusicTrack(db, { id: 't2', artistId: 'a2', genre: 'Rock', language: 'en' });

    // Filtering to genre=Electro should still report Rock as an available facet value.
    const result: any = await handler(guestEvent('/api/music/artists?genre=Electro'));
    expect(result.facets.genres.sort()).toEqual(['Electro', 'Rock']);
    expect(result.facets.languages.sort()).toEqual(['en', 'fr']);
  });

  it('excludes facet values that only exist behind visibility the requester cannot see', async () => {
    insertMusicArtist(db, { id: 'pub', visibility: 'public' });
    insertMusicTrack(db, { id: 't1', artistId: 'pub', genre: 'Electro' });
    insertMusicArtist(db, { id: 'ultra', visibility: 'ultra_private' });
    insertMusicTrack(db, { id: 't2', artistId: 'ultra', genre: 'SecretGenre' });

    const result: any = await handler(guestEvent());
    expect(result.facets.genres).not.toContain('SecretGenre');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/integration/music-artists-list.test.ts`
Expected: FAIL with a module-not-found error for `server/api/music/artists/index.get`.

- [ ] **Step 3: Implement the endpoint**

Create `server/api/music/artists/index.get.ts`:

```ts
import { defineEventHandler, getQuery } from 'h3';

export default defineEventHandler(async (event) => {
  const session = await getUserFromSession(event);
  const db = getDb();

  const query = getQuery(event);
  const search = query.search ? String(query.search).trim() : null;
  const genre = query.genre ? String(query.genre) : null;
  const language = query.language ? String(query.language) : null;
  const year = query.year ? Number(query.year) : null;

  // Visibility clause, shared between the main list query and the facets
  // queries below — facets must reflect only what the requester can see,
  // but must NOT be narrowed by the requester's currently applied filters
  // (search/genre/language/year), so it's built once and reused separately
  // from the filter-specific clauses.
  const visClauses: string[] = [];
  const visParams: any[] = [];
  if (session && session.role === 'admin') {
    // Admins see everything, no visibility clause.
  } else if (session) {
    visClauses.push(`a.visibility IN ('public', 'private')`);
  } else {
    visClauses.push(`a.visibility = 'public'`);
  }

  const listClauses = [...visClauses];
  const listParams = [...visParams];

  if (search) {
    listClauses.push('a.name LIKE ?');
    listParams.push(`%${search}%`);
  }
  if (genre) {
    listClauses.push('t.genre = ?');
    listParams.push(genre);
  }
  if (language) {
    listClauses.push('t.language = ?');
    listParams.push(language);
  }
  if (year) {
    listClauses.push('al.release_year = ?');
    listParams.push(year);
  }

  const listWhereSql = listClauses.length > 0 ? `WHERE ${listClauses.join(' AND ')}` : '';

  const artistsQuery = `
    SELECT
      a.id,
      a.name,
      a.avatar_url,
      a.visibility,
      COUNT(DISTINCT t.id) as track_count
    FROM music_artists a
    JOIN music_tracks t ON t.artist_id = a.id AND t.download_status = 'completed'
    LEFT JOIN music_albums al ON t.album_id = al.id
    ${listWhereSql}
    GROUP BY a.id
    ORDER BY a.name ASC
  `;

  const artists = db.prepare(artistsQuery).all(...listParams);

  const facetsWhereSql = visClauses.length > 0 ? `WHERE ${visClauses.join(' AND ')} AND` : 'WHERE';

  const genres = db.prepare(`
    SELECT DISTINCT t.genre as value
    FROM music_tracks t
    JOIN music_artists a ON t.artist_id = a.id
    ${facetsWhereSql} t.download_status = 'completed' AND t.genre IS NOT NULL
  `).all(...visParams).map((r: any) => r.value);

  const languages = db.prepare(`
    SELECT DISTINCT t.language as value
    FROM music_tracks t
    JOIN music_artists a ON t.artist_id = a.id
    ${facetsWhereSql} t.download_status = 'completed' AND t.language IS NOT NULL
  `).all(...visParams).map((r: any) => r.value);

  const years = db.prepare(`
    SELECT DISTINCT al.release_year as value
    FROM music_albums al
    JOIN music_tracks t ON t.album_id = al.id AND t.download_status = 'completed'
    JOIN music_artists a ON t.artist_id = a.id
    ${facetsWhereSql} al.release_year IS NOT NULL
  `).all(...visParams).map((r: any) => r.value);

  return {
    artists,
    facets: { genres, languages, years }
  };
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/integration/music-artists-list.test.ts`
Expected: PASS (all 10 tests)

- [ ] **Step 5: Commit**

```bash
git add server/api/music/artists/index.get.ts tests/integration/music-artists-list.test.ts
git commit -m "feat: add GET /api/music/artists list endpoint with facets"
```

---

### Task 3: `GET /api/music/artists/[id]` (detail + albums)

**Files:**
- Create: `server/api/music/artists/[id]/index.get.ts`
- Test: `tests/integration/music-artist-detail.test.ts`

**Interfaces:**
- Consumes: `canAccessMusicArtist` from Task 1.
- Produces: `GET /api/music/artists/:id` response shape `{ artist: { id, name, description, avatar_url, banner_url, visibility }, albums: Array<{ id, title, release_year, track_count, cover_url }>, standaloneTrackCount: number }`. Consumed by Task 5's detail view.

- [ ] **Step 1: Write the failing tests**

Create `tests/integration/music-artist-detail.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import handler from '../../server/api/music/artists/[id]/index.get';
import {
  createTestDb,
  insertUser,
  insertSession,
  insertMusicArtist,
  insertMusicAlbum,
  insertMusicTrack,
  mockEvent,
  sessionCookie
} from '../helpers/testDb';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
});

function eventFor(artistId: string, cookieHeader?: string) {
  return mockEvent(cookieHeader, { path: `/api/music/artists/${artistId}`, params: { id: artistId } });
}

function loginAs(userId: string, role: 'admin' | 'user' = 'user') {
  insertUser(db, { id: userId, role });
  const sessionId = `sess-${userId}`;
  insertSession(db, { id: sessionId, userId });
  return sessionCookie(sessionId);
}

describe('GET /api/music/artists/[id]', () => {
  it('returns 404 for a nonexistent artist', async () => {
    await expect(handler(eventFor('missing'))).rejects.toMatchObject({ statusCode: 404 });
  });

  it('returns 403 for a private artist requested by a guest', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'private' });
    await expect(handler(eventFor('a1'))).rejects.toMatchObject({ statusCode: 403 });
  });

  it('returns the artist and groups albums correctly for an accessible artist', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'public' });
    insertMusicAlbum(db, { id: 'al1', artistId: 'a1', releaseYear: 2020 });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', albumId: 'al1' });
    insertMusicTrack(db, { id: 't2', artistId: 'a1', albumId: 'al1' });
    insertMusicTrack(db, { id: 't3', artistId: 'a1', albumId: null }); // standalone

    const result: any = await handler(eventFor('a1'));
    expect(result.artist.id).toBe('a1');
    expect(result.albums).toHaveLength(1);
    expect(result.albums[0].id).toBe('al1');
    expect(result.albums[0].track_count).toBe(2);
    expect(result.standaloneTrackCount).toBe(1);
  });

  it('only counts completed tracks in album track_count and standaloneTrackCount', async () => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicAlbum(db, { id: 'al1', artistId: 'a1' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', albumId: 'al1', downloadStatus: 'completed' });
    insertMusicTrack(db, { id: 't2', artistId: 'a1', albumId: 'al1', downloadStatus: 'pending' });
    insertMusicTrack(db, { id: 't3', artistId: 'a1', albumId: null, downloadStatus: 'failed' });

    const result: any = await handler(eventFor('a1'));
    expect(result.albums[0].track_count).toBe(1);
    expect(result.standaloneTrackCount).toBe(0);
  });

  it('omits an album with zero completed tracks entirely', async () => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicAlbum(db, { id: 'al1', artistId: 'a1' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', albumId: 'al1', downloadStatus: 'pending' });

    const result: any = await handler(eventFor('a1'));
    expect(result.albums).toHaveLength(0);
  });

  it('orders albums by release_year descending with nulls last', async () => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicAlbum(db, { id: 'old', artistId: 'a1', releaseYear: 2000 });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', albumId: 'old' });
    insertMusicAlbum(db, { id: 'new', artistId: 'a1', releaseYear: 2020 });
    insertMusicTrack(db, { id: 't2', artistId: 'a1', albumId: 'new' });
    insertMusicAlbum(db, { id: 'unknown', artistId: 'a1', releaseYear: null });
    insertMusicTrack(db, { id: 't3', artistId: 'a1', albumId: 'unknown' });

    const result: any = await handler(eventFor('a1'));
    expect(result.albums.map((al: any) => al.id)).toEqual(['new', 'old', 'unknown']);
  });

  it("computes cover_url as the first completed track's thumbnail, ordered by track_number", async () => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicAlbum(db, { id: 'al1', artistId: 'a1' });
    insertMusicTrack(db, { id: 't2', artistId: 'a1', albumId: 'al1', trackNumber: 2, localThumbnailPath: '/downloads-music/a1/t2.jpg' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', albumId: 'al1', trackNumber: 1, localThumbnailPath: '/downloads-music/a1/t1.jpg' });

    const result: any = await handler(eventFor('a1'));
    expect(result.albums[0].cover_url).toBe('/downloads-music/a1/t1.jpg');
  });

  it('is accessible to an admin even for an ultra_private artist', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'ultra_private' });
    const cookie = loginAs('admin1', 'admin');
    const result: any = await handler(eventFor('a1', cookie));
    expect(result.artist.id).toBe('a1');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/integration/music-artist-detail.test.ts`
Expected: FAIL with a module-not-found error for `server/api/music/artists/[id]/index.get`.

- [ ] **Step 3: Implement the endpoint**

Create `server/api/music/artists/[id]/index.get.ts`:

```ts
import { defineEventHandler, createError } from 'h3';

export default defineEventHandler(async (event) => {
  const artistId = event.context.params?.id;

  if (!artistId) {
    throw createError({ statusCode: 400, statusMessage: 'Artist ID is required.' });
  }

  const db = getDb();

  const artist = db.prepare(`
    SELECT id, name, description, avatar_url, banner_url, visibility
    FROM music_artists
    WHERE id = ?
  `).get(artistId);

  if (!artist) {
    throw createError({ statusCode: 404, statusMessage: 'Artist not found.' });
  }

  const hasAccess = await canAccessMusicArtist(artistId, event);
  if (!hasAccess) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Access denied. You do not have permission to view this artist.'
    });
  }

  // SQLite sorts NULLs first in ascending order, which means they sort last
  // in descending order — so plain "DESC" here already puts unknown release
  // years at the end without a separate CASE expression.
  const albums = db.prepare(`
    SELECT
      al.id,
      al.title,
      al.release_year,
      COUNT(t.id) as track_count,
      (
        SELECT t2.local_thumbnail_path
        FROM music_tracks t2
        WHERE t2.album_id = al.id AND t2.download_status = 'completed'
        ORDER BY t2.track_number ASC, t2.created_at ASC
        LIMIT 1
      ) as cover_url
    FROM music_albums al
    JOIN music_tracks t ON t.album_id = al.id AND t.download_status = 'completed'
    WHERE al.artist_id = ?
    GROUP BY al.id
    ORDER BY al.release_year DESC, al.title ASC
  `).all(artistId);

  const standaloneRow = db.prepare(`
    SELECT COUNT(*) as cnt
    FROM music_tracks
    WHERE artist_id = ? AND album_id IS NULL AND download_status = 'completed'
  `).get(artistId) as { cnt: number };

  return {
    artist,
    albums,
    standaloneTrackCount: standaloneRow.cnt
  };
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/integration/music-artist-detail.test.ts`
Expected: PASS (all 8 tests)

- [ ] **Step 5: Commit**

```bash
git add server/api/music/artists/\[id\]/index.get.ts tests/integration/music-artist-detail.test.ts
git commit -m "feat: add GET /api/music/artists/[id] detail endpoint"
```

---

### Task 4: `GET /api/music/artists/[id]/tracks` (paginated tracks per group)

**Files:**
- Create: `server/api/music/artists/[id]/tracks.get.ts`
- Test: `tests/integration/music-artist-tracks.test.ts`

**Interfaces:**
- Consumes: `canAccessMusicArtist` from Task 1.
- Produces: `GET /api/music/artists/:id/tracks?albumId=&limit=&offset=` response shape `{ tracks: Array<{ id, title, track_number, genre, language, duration, local_thumbnail_path }>, total: number }`. Consumed by Task 5's detail view (one call per expanded album, plus one for the "sans album" group using `albumId=none`).

- [ ] **Step 1: Write the failing tests**

Create `tests/integration/music-artist-tracks.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import handler from '../../server/api/music/artists/[id]/tracks.get';
import {
  createTestDb,
  insertUser,
  insertSession,
  insertMusicArtist,
  insertMusicAlbum,
  insertMusicTrack,
  mockEvent,
  sessionCookie
} from '../helpers/testDb';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
});

function eventFor(artistId: string, query: string, cookieHeader?: string) {
  return mockEvent(cookieHeader, { path: `/api/music/artists/${artistId}/tracks${query}`, params: { id: artistId } });
}

function loginAs(userId: string, role: 'admin' | 'user' = 'user') {
  insertUser(db, { id: userId, role });
  const sessionId = `sess-${userId}`;
  insertSession(db, { id: sessionId, userId });
  return sessionCookie(sessionId);
}

describe('GET /api/music/artists/[id]/tracks', () => {
  it('returns 404 for a nonexistent artist', async () => {
    await expect(handler(eventFor('missing', '?albumId=none'))).rejects.toMatchObject({ statusCode: 404 });
  });

  it('returns 403 for a private artist requested by a guest', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'private' });
    await expect(handler(eventFor('a1', '?albumId=none'))).rejects.toMatchObject({ statusCode: 403 });
  });

  it('returns 400 when albumId is missing', async () => {
    insertMusicArtist(db, { id: 'a1' });
    await expect(handler(eventFor('a1', ''))).rejects.toMatchObject({ statusCode: 400 });
  });

  it('returns tracks scoped to one album', async () => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicAlbum(db, { id: 'al1', artistId: 'a1' });
    insertMusicAlbum(db, { id: 'al2', artistId: 'a1' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', albumId: 'al1' });
    insertMusicTrack(db, { id: 't2', artistId: 'a1', albumId: 'al2' });

    const result: any = await handler(eventFor('a1', '?albumId=al1'));
    expect(result.tracks.map((t: any) => t.id)).toEqual(['t1']);
    expect(result.total).toBe(1);
  });

  it("returns album-less tracks when albumId=none", async () => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicAlbum(db, { id: 'al1', artistId: 'a1' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', albumId: 'al1' });
    insertMusicTrack(db, { id: 't2', artistId: 'a1', albumId: null });

    const result: any = await handler(eventFor('a1', '?albumId=none'));
    expect(result.tracks.map((t: any) => t.id)).toEqual(['t2']);
  });

  it('only returns completed tracks', async () => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', albumId: null, downloadStatus: 'completed' });
    insertMusicTrack(db, { id: 't2', artistId: 'a1', albumId: null, downloadStatus: 'pending' });

    const result: any = await handler(eventFor('a1', '?albumId=none'));
    expect(result.tracks.map((t: any) => t.id)).toEqual(['t1']);
    expect(result.total).toBe(1);
  });

  it('returns empty results for an albumId that does not belong to the artist, without erroring', async () => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicArtist(db, { id: 'a2' });
    insertMusicAlbum(db, { id: 'al-of-a2', artistId: 'a2' });
    insertMusicTrack(db, { id: 't1', artistId: 'a2', albumId: 'al-of-a2' });

    const result: any = await handler(eventFor('a1', '?albumId=al-of-a2'));
    expect(result.tracks).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('orders by track_number ascending with nulls last, then title', async () => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicTrack(db, { id: 'no-number', artistId: 'a1', albumId: null, trackNumber: null });
    insertMusicTrack(db, { id: 'two', artistId: 'a1', albumId: null, trackNumber: 2 });
    insertMusicTrack(db, { id: 'one', artistId: 'a1', albumId: null, trackNumber: 1 });

    const result: any = await handler(eventFor('a1', '?albumId=none'));
    expect(result.tracks.map((t: any) => t.id)).toEqual(['one', 'two', 'no-number']);
  });

  it('paginates with limit and offset, respecting total across pages', async () => {
    insertMusicArtist(db, { id: 'a1' });
    for (let i = 1; i <= 5; i++) {
      insertMusicTrack(db, { id: `t${i}`, artistId: 'a1', albumId: null, trackNumber: i });
    }

    const page1: any = await handler(eventFor('a1', '?albumId=none&limit=2&offset=0'));
    expect(page1.tracks.map((t: any) => t.id)).toEqual(['t1', 't2']);
    expect(page1.total).toBe(5);

    const page2: any = await handler(eventFor('a1', '?albumId=none&limit=2&offset=2'));
    expect(page2.tracks.map((t: any) => t.id)).toEqual(['t3', 't4']);
    expect(page2.total).toBe(5);
  });

  it('defaults to limit=50 when not provided', async () => {
    insertMusicArtist(db, { id: 'a1' });
    for (let i = 1; i <= 60; i++) {
      insertMusicTrack(db, { id: `t${i}`, artistId: 'a1', albumId: null, trackNumber: i });
    }

    const result: any = await handler(eventFor('a1', '?albumId=none'));
    expect(result.tracks).toHaveLength(50);
    expect(result.total).toBe(60);
  });

  it('is accessible to an admin even for an ultra_private artist', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'ultra_private' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', albumId: null });
    const cookie = loginAs('admin1', 'admin');

    const result: any = await handler(eventFor('a1', '?albumId=none', cookie));
    expect(result.tracks).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/integration/music-artist-tracks.test.ts`
Expected: FAIL with a module-not-found error for `server/api/music/artists/[id]/tracks.get`.

- [ ] **Step 3: Implement the endpoint**

Create `server/api/music/artists/[id]/tracks.get.ts`:

```ts
import { defineEventHandler, createError, getQuery } from 'h3';

export default defineEventHandler(async (event) => {
  const artistId = event.context.params?.id;

  if (!artistId) {
    throw createError({ statusCode: 400, statusMessage: 'Artist ID is required.' });
  }

  const db = getDb();

  const artistExists = db.prepare('SELECT id FROM music_artists WHERE id = ?').get(artistId);
  if (!artistExists) {
    throw createError({ statusCode: 404, statusMessage: 'Artist not found.' });
  }

  const hasAccess = await canAccessMusicArtist(artistId, event);
  if (!hasAccess) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Access denied. You do not have permission to view this artist.'
    });
  }

  const query = getQuery(event);
  const albumIdParam = query.albumId ? String(query.albumId) : null;

  if (!albumIdParam) {
    throw createError({ statusCode: 400, statusMessage: 'albumId is required (use "none" for tracks without an album).' });
  }

  const limit = Math.max(1, parseInt(String(query.limit ?? '50'), 10) || 50);
  const offset = Math.max(0, parseInt(String(query.offset ?? '0'), 10) || 0);

  const isStandalone = albumIdParam === 'none';
  const albumClauseSql = isStandalone ? 'album_id IS NULL' : 'album_id = ?';
  const params: any[] = [artistId];
  if (!isStandalone) params.push(albumIdParam);

  const totalRow = db.prepare(`
    SELECT COUNT(*) as cnt
    FROM music_tracks
    WHERE artist_id = ? AND ${albumClauseSql} AND download_status = 'completed'
  `).get(...params) as { cnt: number };

  // "(track_number IS NULL) ASC" forces NULLs to the end regardless of the
  // primary column's own sort direction — SQLite's default NULL-sorts-first
  // behavior would otherwise put untagged tracks before numbered ones.
  const tracks = db.prepare(`
    SELECT id, title, track_number, genre, language, duration, local_thumbnail_path
    FROM music_tracks
    WHERE artist_id = ? AND ${albumClauseSql} AND download_status = 'completed'
    ORDER BY (track_number IS NULL) ASC, track_number ASC, title ASC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  return { tracks, total: totalRow.cnt };
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/integration/music-artist-tracks.test.ts`
Expected: PASS (all 11 tests)

- [ ] **Step 5: Commit**

```bash
git add server/api/music/artists/\[id\]/tracks.get.ts tests/integration/music-artist-tracks.test.ts
git commit -m "feat: add GET /api/music/artists/[id]/tracks paginated endpoint"
```

---

### Task 5: Replace `/music` placeholder with the grid + detail catalog UI

**Files:**
- Modify: `app/pages/music/index.vue`

**Interfaces:**
- Consumes: `GET /api/music/artists` (Task 2), `GET /api/music/artists/[id]` (Task 3), `GET /api/music/artists/[id]/tracks` (Task 4), `useAuth()` (`~/composables/useAuth`, existing), `EmptyState` component (existing, `icon="music"` variant added by the space-switcher sub-project).
- Produces: nothing consumed by a later task (this is the last task in the plan).

- [ ] **Step 1: Replace the file content**

Read the current file first (`app/pages/music/index.vue` — currently a 7-line placeholder using `EmptyState`) then replace its entire content with:

```vue
<template>
  <div class="music-page">
    <!-- GRID VIEW -->
    <div v-if="!artistId">
      <div class="music-filters-bar">
        <input
          v-model="search"
          type="text"
          placeholder="Rechercher un artiste..."
          class="search-input music-search-input"
        />
        <select v-model="genre" class="form-select">
          <option value="">Tous les genres</option>
          <option v-for="g in facets.genres" :key="g" :value="g">{{ g }}</option>
        </select>
        <select v-model="language" class="form-select">
          <option value="">Toutes les langues</option>
          <option v-for="l in facets.languages" :key="l" :value="l">{{ l }}</option>
        </select>
        <select v-model="year" class="form-select">
          <option value="">Toutes les années</option>
          <option v-for="y in facets.years" :key="y" :value="y">{{ y }}</option>
        </select>
      </div>

      <div v-if="gridPending" class="music-loading">Chargement...</div>

      <EmptyState
        v-else-if="artists.length === 0"
        icon="music"
        :title="hasActiveFilters ? 'Aucun résultat' : 'Aucun artiste archivé'"
        :description="hasActiveFilters ? 'Aucun résultat pour ces filtres.' : 'Aucun artiste archivé pour l\'instant.'"
      />

      <div v-else class="artist-grid">
        <div
          v-for="a in artists"
          :key="a.id"
          class="artist-card"
          @click="router.push({ path: '/music', query: { artistId: a.id } })"
        >
          <img :src="a.avatar_url || fallbackAvatar" @error="handleAvatarError" class="artist-card-avatar" alt="" />
          <div class="artist-card-body">
            <h3 class="artist-card-name">{{ a.name }}</h3>
            <p class="artist-card-meta">{{ a.track_count }} titre(s)</p>
            <span v-if="isAdmin" class="badge" :class="getVisBadgeClass(a.visibility)">{{ formatVisibility(a.visibility) }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- DETAIL VIEW -->
    <div v-else class="artist-detail-view">
      <button @click="goBack" class="btn btn-secondary back-btn">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
        Musique
      </button>

      <div v-if="detailPending" class="music-loading">Chargement...</div>
      <div v-else-if="detailError" class="music-error">Artiste introuvable ou accès refusé.</div>

      <template v-else-if="artist">
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

        <EmptyState
          v-if="albums.length === 0 && standaloneTrackCount === 0"
          icon="music"
          title="Aucun titre archivé"
          description="Aucun titre complété pour cet artiste pour l'instant."
        />

        <div v-for="album in albums" :key="album.id" class="album-group">
          <div class="album-header" @click="toggleAlbumExpand(album.id)">
            <img :src="album.cover_url || fallbackCover" class="album-cover" alt="" />
            <div class="album-info">
              <h3 class="album-title">{{ album.title }}</h3>
              <p class="album-meta">{{ album.release_year || 'Année inconnue' }} &bull; {{ album.track_count }} titre(s)</p>
            </div>
          </div>
          <div v-if="expandedAlbums[album.id]" class="album-tracks">
            <div v-for="track in trackGroups[album.id]?.tracks || []" :key="track.id" class="track-row">
              <span class="track-number">{{ track.track_number || '–' }}</span>
              <span class="track-title">{{ track.title }}</span>
              <span v-if="track.genre" class="badge badge-pending">{{ track.genre }}</span>
              <span v-if="track.language" class="badge badge-pending">{{ track.language }}</span>
              <span class="track-duration">{{ formatDuration(track.duration) }}</span>
            </div>
            <div v-if="trackGroups[album.id]?.loading" class="music-loading">Chargement...</div>
            <button
              v-if="(trackGroups[album.id]?.tracks.length || 0) < (trackGroups[album.id]?.total || 0)"
              @click="loadTracks(album.id)"
              :disabled="trackGroups[album.id]?.loading"
              class="btn btn-secondary load-more-btn"
            >
              Charger plus
            </button>
          </div>
        </div>

        <div v-if="standaloneTrackCount > 0" class="album-group">
          <div class="album-header" @click="toggleStandalone">
            <div class="album-cover album-cover-placeholder"></div>
            <div class="album-info">
              <h3 class="album-title">Titres sans album</h3>
              <p class="album-meta">{{ standaloneTrackCount }} titre(s)</p>
            </div>
          </div>
          <div v-if="standaloneExpanded" class="album-tracks">
            <div v-for="track in trackGroups['none']?.tracks || []" :key="track.id" class="track-row">
              <span class="track-number">{{ track.track_number || '–' }}</span>
              <span class="track-title">{{ track.title }}</span>
              <span v-if="track.genre" class="badge badge-pending">{{ track.genre }}</span>
              <span v-if="track.language" class="badge badge-pending">{{ track.language }}</span>
              <span class="track-duration">{{ formatDuration(track.duration) }}</span>
            </div>
            <div v-if="trackGroups['none']?.loading" class="music-loading">Chargement...</div>
            <button
              v-if="(trackGroups['none']?.tracks.length || 0) < (trackGroups['none']?.total || 0)"
              @click="loadTracks('none')"
              :disabled="trackGroups['none']?.loading"
              class="btn btn-secondary load-more-btn"
            >
              Charger plus
            </button>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuth } from '~/composables/useAuth';

const { isAdmin } = useAuth();
const route = useRoute();
const router = useRouter();

const artistId = computed(() => (route.query.artistId ? String(route.query.artistId) : ''));

// --- Grid view state ---
const search = ref('');
const genre = ref('');
const language = ref('');
const year = ref('');
const artists = ref<any[]>([]);
const facets = ref<{ genres: string[]; languages: string[]; years: number[] }>({ genres: [], languages: [], years: [] });
const gridPending = ref(true);

const hasActiveFilters = computed(() => !!(search.value || genre.value || language.value || year.value));

async function fetchArtists() {
  gridPending.value = true;
  try {
    const params: Record<string, string> = {};
    if (search.value) params.search = search.value;
    if (genre.value) params.genre = genre.value;
    if (language.value) params.language = language.value;
    if (year.value) params.year = year.value;
    const data = await $fetch<any>('/api/music/artists', { params });
    artists.value = data.artists || [];
    facets.value = data.facets || { genres: [], languages: [], years: [] };
  } catch (e) {
    artists.value = [];
  } finally {
    gridPending.value = false;
  }
}

let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
watch(search, () => {
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => fetchArtists(), 300);
});
watch([genre, language, year], () => fetchArtists());

// --- Detail view state ---
const artist = ref<any>(null);
const albums = ref<any[]>([]);
const standaloneTrackCount = ref(0);
const detailPending = ref(false);
const detailError = ref(false);

const expandedAlbums = reactive<Record<string, boolean>>({});
const standaloneExpanded = ref(false);
const trackGroups = reactive<Record<string, { tracks: any[]; total: number; loaded: boolean; loading: boolean }>>({});

function ensureGroup(key: string) {
  if (!trackGroups[key]) {
    trackGroups[key] = { tracks: [], total: 0, loaded: false, loading: false };
  }
  return trackGroups[key];
}

async function loadTracks(albumIdKey: string) {
  const group = ensureGroup(albumIdKey);
  group.loading = true;
  try {
    const data = await $fetch<any>(`/api/music/artists/${artistId.value}/tracks`, {
      params: { albumId: albumIdKey, limit: 50, offset: group.tracks.length }
    });
    group.tracks.push(...(data.tracks || []));
    group.total = data.total || 0;
    group.loaded = true;
  } finally {
    group.loading = false;
  }
}

function toggleAlbumExpand(albumId: string) {
  expandedAlbums[albumId] = !expandedAlbums[albumId];
  if (expandedAlbums[albumId]) {
    const group = ensureGroup(albumId);
    if (!group.loaded && !group.loading) loadTracks(albumId);
  }
}

function toggleStandalone() {
  standaloneExpanded.value = !standaloneExpanded.value;
  if (standaloneExpanded.value) {
    const group = ensureGroup('none');
    if (!group.loaded && !group.loading) loadTracks('none');
  }
}

async function fetchArtistDetail() {
  detailPending.value = true;
  detailError.value = false;
  artist.value = null;
  albums.value = [];
  standaloneTrackCount.value = 0;
  Object.keys(expandedAlbums).forEach((k) => delete expandedAlbums[k]);
  Object.keys(trackGroups).forEach((k) => delete trackGroups[k]);
  standaloneExpanded.value = false;
  try {
    const data = await $fetch<any>(`/api/music/artists/${artistId.value}`);
    artist.value = data.artist;
    albums.value = data.albums || [];
    standaloneTrackCount.value = data.standaloneTrackCount || 0;
  } catch (e) {
    detailError.value = true;
  } finally {
    detailPending.value = false;
  }
}

function goBack() {
  router.push('/music');
}

watch(artistId, (newId, oldId) => {
  if (newId && newId !== oldId) {
    fetchArtistDetail();
  } else if (!newId && oldId) {
    fetchArtists();
  }
});

onMounted(() => {
  if (artistId.value) {
    fetchArtistDetail();
  } else {
    fetchArtists();
  }
});

// --- Shared formatters (duplicated per-page, matching this codebase's
// existing convention — see channels.vue / watch/[id].vue / index.vue,
// none of which share a formatting util module) ---
const fallbackAvatar = 'data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 24 24\' fill=\'%23666\'><circle cx=\'12\' cy=\'12\' r=\'10\'></circle><path d=\'M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-3.33 0-10 1.67-10 5v2h20v-2c0-3.33-6.67-5-10-5z\'></path></svg>';
const fallbackCover = 'data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%23666\' stroke-width=\'1.5\'><path d=\'M9 18V5l12-2v13\'></path><circle cx=\'6\' cy=\'18\' r=\'3\'></circle><circle cx=\'18\' cy=\'16\' r=\'3\'></circle></svg>';

const handleAvatarError = (event: Event) => {
  const target = event.target as HTMLImageElement;
  if (target && target.src !== fallbackAvatar) {
    target.src = fallbackAvatar;
  }
};

const formatDuration = (seconds: number | null): string => {
  if (!seconds) return '--:--';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

const formatVisibility = (vis: string): string => {
  switch (vis) {
    case 'public': return 'Public';
    case 'private': return 'Private';
    case 'ultra_private': return 'Ultra Private';
    default: return vis || 'Public';
  }
};

const getVisBadgeClass = (vis: string): string => {
  switch (vis) {
    case 'public': return 'badge-completed';
    case 'private': return 'badge-downloading';
    case 'ultra_private': return 'badge-failed';
    default: return 'badge-completed';
  }
};
</script>

<style scoped>
.music-filters-bar {
  display: flex;
  gap: 12px;
  margin-bottom: 24px;
  flex-wrap: wrap;
}

.music-search-input {
  flex: 1;
  min-width: 200px;
}

.music-loading,
.music-error {
  padding: 40px;
  text-align: center;
  color: var(--text-secondary);
}

.artist-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 20px;
}

.artist-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 20px;
  border-radius: var(--border-radius-lg);
  cursor: pointer;
  border: 1px solid var(--border-color);
  background: rgba(17, 17, 34, 0.4);
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), border-color 0.3s ease, box-shadow 0.3s ease;
}

.artist-card:hover {
  transform: translateY(-4px);
  border-color: rgba(139, 92, 246, 0.3);
  box-shadow: 0 12px 32px rgba(139, 92, 246, 0.15);
}

.artist-card-avatar {
  width: 96px;
  height: 96px;
  border-radius: 50%;
  object-fit: cover;
  margin-bottom: 12px;
}

.artist-card-name {
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 4px;
}

.artist-card-meta {
  font-size: 13px;
  color: var(--text-secondary);
  margin-bottom: 8px;
}

.back-btn {
  margin-bottom: 20px;
}

.artist-detail-header {
  display: flex;
  gap: 20px;
  align-items: center;
  margin-bottom: 32px;
}

.artist-detail-avatar {
  width: 96px;
  height: 96px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
}

.artist-detail-name {
  font-size: 24px;
  font-weight: 700;
}

.artist-detail-desc {
  color: var(--text-secondary);
  margin-top: 4px;
}

.album-group {
  margin-bottom: 16px;
  border: 1px solid var(--border-color);
  border-radius: var(--border-radius-lg);
  overflow: hidden;
}

.album-header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px;
  cursor: pointer;
  background: rgba(17, 17, 34, 0.4);
}

.album-header:hover {
  background: rgba(17, 17, 34, 0.6);
}

.album-cover {
  width: 56px;
  height: 56px;
  border-radius: var(--border-radius-md);
  object-fit: cover;
  flex-shrink: 0;
}

.album-cover-placeholder {
  background: rgba(255, 255, 255, 0.05);
}

.album-title {
  font-size: 16px;
  font-weight: 600;
}

.album-meta {
  font-size: 13px;
  color: var(--text-secondary);
}

.album-tracks {
  padding: 8px 16px 16px;
}

.track-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  font-size: 14px;
}

.track-row:last-child {
  border-bottom: none;
}

.track-number {
  width: 24px;
  text-align: right;
  color: var(--text-secondary);
  flex-shrink: 0;
}

.track-title {
  flex: 1;
}

.track-duration {
  color: var(--text-secondary);
  flex-shrink: 0;
}

.load-more-btn {
  margin-top: 12px;
}
</style>
```

- [ ] **Step 2: Type-check**

Run: `npx vue-tsc -b --noEmit`
Expected: no new errors beyond the 2 known pre-existing ones (`app/components/VideoPlayer.vue`, `app/pages/subscriptions.vue`, unrelated to this branch).

- [ ] **Step 3: Manual verification**

Start the dev server, log in, navigate to `/music`, and confirm:
- The grid loads and shows artist cards (using data from prior sub-projects' live tests, e.g. the GIMS artist if still present with completed tracks).
- Typing in the search box filters the grid after a short debounce; selecting a genre/language/year filter narrows the grid immediately.
- Filter `<select>` options are populated from real data and do NOT shrink when another filter is applied (per the facets design).
- Clicking an artist card navigates to `/music?artistId=<id>` and shows the detail view: albums collapsed by default, standalone-tracks section shown only if `standaloneTrackCount > 0`.
- Expanding an album triggers a network request to `.../tracks?albumId=<id>` and renders its tracks; if the artist has more than 50 tracks in a group, a "Charger plus" button appears and loads the next page on click.
- Clicking the back button returns to the grid view and clears `artistId` from the URL.
- Navigating directly to a URL like `/music?artistId=<id>` (not via a click) still renders the detail view correctly (proves the view is derived from the query param, not click state).

- [ ] **Step 4: Commit**

```bash
git add app/pages/music/index.vue
git commit -m "feat: replace music placeholder with catalog browsing UI"
```

---

## Self-Review Notes

- **Spec coverage:** `canAccessMusicArtist` (Task 1) ✓, `GET /api/music/artists` + facets (Task 2) ✓, `GET /api/music/artists/[id]` + album grouping + cover fallback (Task 3) ✓, `GET /api/music/artists/[id]/tracks` pagination + `albumId=none` (Task 4) ✓, grid/detail UI on the same `/music` route with query-param-driven detail, filters, expand/paginate, back button (Task 5) ✓. Verification section's bullets are each covered by a manual-verification step in Task 5 or an automated test in Tasks 1–4.
- **Placeholder scan:** none found — every step shows complete code, exact file paths, and exact commands.
- **Type consistency:** endpoint response field names (`track_count`, `release_year`, `cover_url`, `standaloneTrackCount`, `local_thumbnail_path`, `track_number`) are used identically in Task 5's fetch calls and template bindings. `canAccessMusicArtist(artistId: string, event: any): Promise<boolean>` (Task 1) is called identically in Tasks 3 and 4. `mockEvent`'s extended signature (Task 1) is used consistently across Tasks 2–4's test files.
