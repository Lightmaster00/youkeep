# Content Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give music and podcasts real full-text search that finds tracks/episodes directly, and let an admin toggle the header search bar between per-space search (today's behavior) and a global search across all 3 content types via a new `/search` page.

**Architecture:** Two new FTS5 virtual tables (mirroring the existing `videos_fts` trigger-maintained pattern) back two new search endpoints. `/music` and `/podcasts` swap their grid for a flat result list while searching. A new admin setting controls whether the header bar stays space-local or redirects to a new `/search` page that fans out to all 3 search endpoints in parallel.

**Tech Stack:** Nuxt 4, Nitro server routes, better-sqlite3 (FTS5), Vue 3 `<script setup>`, Vitest.

## Global Constraints

- No change to the existing video search (`videos_fts`, the video home page's search behavior) beyond being one of the 3 sources `/search` reads from.
- No per-user search-mode preference — single admin-controlled setting only.
- No advanced genre/tag/faceted search.
- No pagination beyond existing per-page conventions on `/music`/`/podcasts`, and no pagination on `/search` itself beyond the "Voir plus" links (cap each section at 10 results).
- `music_tracks_fts(id UNINDEXED, title, artist_name, album_title, genre, tokenize='porter')` with INSERT/UPDATE/DELETE triggers joining `music_artists.name`/`music_albums.title` at write time (denormalized, not re-synced on artist/album rename — same accepted limitation as `videos_fts`'s `channel_title`).
- `podcast_episodes_fts(id UNINDEXED, title, description, show_title, tokenize='porter')` with the same trigger pattern joining `podcast_shows.title`.
- Both FTS tables get a backfill `INSERT` block at init exactly matching `videos_fts`'s existing backfill pattern.
- `GET /api/music/tracks/search?q=<term>` → `{ tracks: [...] }` with `artist_name`/`album_title` joined in, music visibility respected, only `download_status='completed'` tracks.
- `GET /api/podcasts/episodes/search?q=<term>` → `{ episodes: [...] }` with `show_title`/`show_cover_url` joined in, podcast visibility respected, only `download_status='completed'` episodes.
- Both endpoints use the exact same FTS-query-build + try/MATCH/catch-LIKE-fallback pattern as `server/api/videos/index.get.ts`.
- On `/music` and `/podcasts`, a non-empty local search query calls the new endpoint and replaces the artist/show grid with a flat clickable list (title + artist/show name shown, click starts playback) — the existing local search box itself is otherwise unchanged, and this behavior is NOT affected by the new `content_search_mode` setting.
- New setting `content_search_mode` (`'per_space'` default | `'global'`): `GET /api/settings/content-search-mode` is PUBLIC/unauthenticated, fail-open to `'per_space'` on any error. `POST /api/admin/settings/content-search-mode` is admin-only.
- `app/layouts/default.vue`'s `handleSearch()`: in `per_space` mode, pushes to the active space's `homeRoute` (`/`, `/music`, or `/podcasts`) — this is a genuine new behavior (today it always pushes to `/`, "space-aware" was approved earlier this session but never implemented). In `global` mode, always pushes to `/search?q=<term>` regardless of active space.
- New `app/pages/search.vue`: fires 3 parallel independent fetches (existing `GET /api/videos?q=`, new `GET /api/music/tracks/search?q=`, new `GET /api/podcasts/episodes/search?q=`), each with its own loading/error state (one failing must not block the other 2 sections), renders 3 sections capped at 10 results each with a "Voir plus" link per section to `/?q=`, `/music?q=`, `/podcasts?q=` respectively.
- `SettingsSystemTab.vue` gains the `content_search_mode` toggle.
- New pure/testable logic: the two new endpoints get real integration tests (FTS match with joined names, LIKE fallback, visibility respected, completed-only filter). No test for the FTS5 trigger/table SQL itself (matches `videos_fts`'s own untested convention). No test for the outbound-fetch-heavy `/search` page beyond manual verification.

## File Structure

- Modify: `server/utils/db.ts` — two new FTS5 virtual tables + triggers + backfill (own try/catch blocks, `videos_fts` untouched); `content_search_mode` setting seeding.
- Create: `server/api/music/tracks/search.get.ts`, `tests/integration/music-tracks-search.test.ts`.
- Create: `server/api/podcasts/episodes/search.get.ts`, `tests/integration/podcast-episodes-search.test.ts`.
- Create: `server/api/settings/content-search-mode.get.ts` (public), `server/api/admin/settings/content-search-mode.post.ts` (admin-only).
- Modify: `app/components/settings/SettingsSystemTab.vue` — new "Recherche" panel with the mode toggle.
- Modify: `app/pages/music/index.vue`, `app/pages/podcasts/index.vue` — grid-to-flat-list search behavior.
- Modify: `app/layouts/default.vue` — `content_search_mode`-aware `handleSearch()`.
- Create: `app/pages/search.vue` — the new global-mode results page.

---

### Task 1: FTS5 tables for music tracks and podcast episodes

**Files:**
- Modify: `server/utils/db.ts`

**Interfaces:**
- Produces: `music_tracks_fts` and `podcast_episodes_fts` virtual tables (schema per Global Constraints), kept in sync via triggers. Consumed by Task 2 and Task 3's `MATCH` queries.

- [ ] **Step 1: Add the two FTS5 virtual tables, triggers, and backfills**

In `server/utils/db.ts`, find the existing `videos_fts` setup block — it ends with:

```typescript
    // Backfill any missing entries in FTS index
    db.exec(`
      INSERT INTO videos_fts(rowid, id, title, description, channel_title)
      SELECT rowid, id, title, description, (SELECT title FROM channels WHERE id = channel_id)
      FROM videos
      WHERE rowid NOT IN (SELECT rowid FROM videos_fts);
    `);
  } catch (err) {
    console.error('FTS5 virtual table initialization warning (ensure your SQLite build supports FTS5):', err);
  }
```

Immediately after that closing `}`, add two new, independent try/catch blocks (independent so a failure setting up one doesn't prevent the other from being attempted, and `videos_fts` itself stays completely untouched):

```typescript
  // Setup FTS5 Virtual Table for Music Track Search (if not exists)
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS music_tracks_fts USING fts5(
        id UNINDEXED,
        title,
        artist_name,
        album_title,
        genre,
        tokenize='porter'
      );
    `);

    db.exec(`
      CREATE TRIGGER IF NOT EXISTS music_tracks_ai AFTER INSERT ON music_tracks BEGIN
        INSERT INTO music_tracks_fts(rowid, id, title, artist_name, album_title, genre)
        VALUES (
          new.rowid,
          new.id,
          new.title,
          (SELECT name FROM music_artists WHERE id = new.artist_id),
          (SELECT title FROM music_albums WHERE id = new.album_id),
          new.genre
        );
      END;

      CREATE TRIGGER IF NOT EXISTS music_tracks_ad AFTER DELETE ON music_tracks BEGIN
        DELETE FROM music_tracks_fts WHERE rowid = old.rowid;
      END;

      CREATE TRIGGER IF NOT EXISTS music_tracks_au AFTER UPDATE ON music_tracks BEGIN
        DELETE FROM music_tracks_fts WHERE rowid = old.rowid;

        INSERT INTO music_tracks_fts(rowid, id, title, artist_name, album_title, genre)
        VALUES (
          new.rowid,
          new.id,
          new.title,
          (SELECT name FROM music_artists WHERE id = new.artist_id),
          (SELECT title FROM music_albums WHERE id = new.album_id),
          new.genre
        );
      END;
    `);

    db.exec(`
      INSERT INTO music_tracks_fts(rowid, id, title, artist_name, album_title, genre)
      SELECT rowid, id, title,
        (SELECT name FROM music_artists WHERE id = music_tracks.artist_id),
        (SELECT title FROM music_albums WHERE id = music_tracks.album_id),
        genre
      FROM music_tracks
      WHERE rowid NOT IN (SELECT rowid FROM music_tracks_fts);
    `);
  } catch (err) {
    console.error('FTS5 virtual table initialization warning (music_tracks_fts):', err);
  }

  // Setup FTS5 Virtual Table for Podcast Episode Search (if not exists)
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS podcast_episodes_fts USING fts5(
        id UNINDEXED,
        title,
        description,
        show_title,
        tokenize='porter'
      );
    `);

    db.exec(`
      CREATE TRIGGER IF NOT EXISTS podcast_episodes_ai AFTER INSERT ON podcast_episodes BEGIN
        INSERT INTO podcast_episodes_fts(rowid, id, title, description, show_title)
        VALUES (
          new.rowid,
          new.id,
          new.title,
          new.description,
          (SELECT title FROM podcast_shows WHERE id = new.show_id)
        );
      END;

      CREATE TRIGGER IF NOT EXISTS podcast_episodes_ad AFTER DELETE ON podcast_episodes BEGIN
        DELETE FROM podcast_episodes_fts WHERE rowid = old.rowid;
      END;

      CREATE TRIGGER IF NOT EXISTS podcast_episodes_au AFTER UPDATE ON podcast_episodes BEGIN
        DELETE FROM podcast_episodes_fts WHERE rowid = old.rowid;

        INSERT INTO podcast_episodes_fts(rowid, id, title, description, show_title)
        VALUES (
          new.rowid,
          new.id,
          new.title,
          new.description,
          (SELECT title FROM podcast_shows WHERE id = new.show_id)
        );
      END;
    `);

    db.exec(`
      INSERT INTO podcast_episodes_fts(rowid, id, title, description, show_title)
      SELECT rowid, id, title, description,
        (SELECT title FROM podcast_shows WHERE id = podcast_episodes.show_id)
      FROM podcast_episodes
      WHERE rowid NOT IN (SELECT rowid FROM podcast_episodes_fts);
    `);
  } catch (err) {
    console.error('FTS5 virtual table initialization warning (podcast_episodes_fts):', err);
  }
```

- [ ] **Step 2: Add the `content_search_mode` setting seeding**

In the same file, find the `music_module_enabled` seeding block:

```typescript
  const musicModuleEnabledCheck = db.prepare("SELECT COUNT(*) as count FROM settings WHERE key = 'music_module_enabled'").get() as { count: number };
  if (musicModuleEnabledCheck.count === 0) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('music_module_enabled', '1')").run();
    console.log('Seeded setting music_module_enabled: 1');
  }
```

Immediately after it, add:

```typescript
  const contentSearchModeCheck = db.prepare("SELECT COUNT(*) as count FROM settings WHERE key = 'content_search_mode'").get() as { count: number };
  if (contentSearchModeCheck.count === 0) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('content_search_mode', 'per_space')").run();
    console.log('Seeded setting content_search_mode: per_space');
  }
```

- [ ] **Step 3: Run the full test suite and verify the schema manually**

Run: `npm test`
Expected: PASS — no dedicated test for this table/trigger SQL (matches `videos_fts`'s own established convention). Then, if a local dev DB is available, spot-check the schema: `sqlite3 data/youkeep.db ".schema music_tracks_fts"` and `.schema podcast_episodes_fts"` should each show the virtual table definition. Not required to run in CI, just a sanity check if convenient.

- [ ] **Step 4: Commit**

```bash
git add server/utils/db.ts
git commit -m "feat: add music_tracks_fts/podcast_episodes_fts FTS5 tables and content_search_mode setting"
```

---

### Task 2: `GET /api/music/tracks/search` endpoint

**Files:**
- Create: `server/api/music/tracks/search.get.ts`
- Test: `tests/integration/music-tracks-search.test.ts`

**Interfaces:**
- Consumes: `music_tracks_fts` (Task 1), `musicVisibilityClause(session, columnAlias)` from `server/utils/musicVisibility.ts` (existing, exported signature: `(session: SessionForVisibility | null, columnAlias: string = 'a') => string`).
- Produces: `GET /api/music/tracks/search?q=<term>` → `{ tracks: [{ id, title, track_number, genre, language, duration, local_file_path, local_thumbnail_path, has_clip, artist_id, artist_name, album_title }] }`. Consumed by Task 5 (`/music`'s search UI) and Task 6 (`/search` page).

- [ ] **Step 1: Write the failing tests**

Create `tests/integration/music-tracks-search.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import handler from '../../server/api/music/tracks/search.get';
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

function loginAs(userId: string, role: 'admin' | 'user' = 'user', path = '/api/music/tracks/search') {
  insertUser(db, { id: userId, role });
  const sessionId = `sess-${userId}`;
  insertSession(db, { id: sessionId, userId });
  return mockEvent(sessionCookie(sessionId), { path });
}

const guestEvent = (path = '/api/music/tracks/search') => mockEvent(undefined, { path });

describe('GET /api/music/tracks/search', () => {
  it('finds a track by its own title via the LIKE fallback (no FTS table exists in the test DB, so this always exercises the fallback path)', async () => {
    insertMusicArtist(db, { id: 'a1', name: 'Daft Punk' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });
    db.prepare("UPDATE music_tracks SET title = 'Get Lucky' WHERE id = 't1'").run();
    insertMusicTrack(db, { id: 't2', artistId: 'a1' });
    db.prepare("UPDATE music_tracks SET title = 'Around The World' WHERE id = 't2'").run();

    const result: any = await handler(guestEvent('/api/music/tracks/search?q=Lucky'));
    expect(result.tracks.map((t: any) => t.id)).toEqual(['t1']);
  });

  it('includes the joined artist_name and album_title', async () => {
    insertMusicArtist(db, { id: 'a1', name: 'Daft Punk' });
    insertMusicAlbum(db, { id: 'al1', artistId: 'a1', title: 'Random Access Memories' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', albumId: 'al1' });
    db.prepare("UPDATE music_tracks SET title = 'Get Lucky' WHERE id = 't1'").run();

    const result: any = await handler(guestEvent('/api/music/tracks/search?q=Lucky'));
    expect(result.tracks[0].artist_name).toBe('Daft Punk');
    expect(result.tracks[0].album_title).toBe('Random Access Memories');
  });

  it('returns null album_title for a standalone track with no album', async () => {
    insertMusicArtist(db, { id: 'a1', name: 'Daft Punk' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });
    db.prepare("UPDATE music_tracks SET title = 'One More Time' WHERE id = 't1'").run();

    const result: any = await handler(guestEvent('/api/music/tracks/search?q=Time'));
    expect(result.tracks[0].album_title).toBeNull();
  });

  it('excludes a track whose artist is private, for a guest', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'private' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });
    db.prepare("UPDATE music_tracks SET title = 'Secret Song' WHERE id = 't1'").run();

    const result: any = await handler(guestEvent('/api/music/tracks/search?q=Secret'));
    expect(result.tracks).toEqual([]);
  });

  it('includes a track whose artist is private, for a logged-in non-admin user', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'private' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });
    db.prepare("UPDATE music_tracks SET title = 'Secret Song' WHERE id = 't1'").run();

    const result: any = await handler(loginAs('u1', 'user', '/api/music/tracks/search?q=Secret'));
    expect(result.tracks.map((t: any) => t.id)).toEqual(['t1']);
  });

  it('excludes a track whose artist is ultra_private, for a logged-in non-admin user', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'ultra_private' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });
    db.prepare("UPDATE music_tracks SET title = 'Ultra Secret' WHERE id = 't1'").run();

    const result: any = await handler(loginAs('u1', 'user', '/api/music/tracks/search?q=Ultra'));
    expect(result.tracks).toEqual([]);
  });

  it('includes an ultra_private track for an admin', async () => {
    insertMusicArtist(db, { id: 'a1', visibility: 'ultra_private' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });
    db.prepare("UPDATE music_tracks SET title = 'Ultra Secret' WHERE id = 't1'").run();

    const result: any = await handler(loginAs('admin1', 'admin', '/api/music/tracks/search?q=Ultra'));
    expect(result.tracks.map((t: any) => t.id)).toEqual(['t1']);
  });

  it('excludes a track that is not yet completed', async () => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', downloadStatus: 'downloading' });
    db.prepare("UPDATE music_tracks SET title = 'Still Downloading' WHERE id = 't1'").run();

    const result: any = await handler(guestEvent('/api/music/tracks/search?q=Downloading'));
    expect(result.tracks).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- music-tracks-search`
Expected: FAIL — `Cannot find module '../../server/api/music/tracks/search.get'`

- [ ] **Step 3: Write the implementation**

Create `server/api/music/tracks/search.get.ts`:

```typescript
import { defineEventHandler, getQuery } from 'h3';
import { getUserFromSession } from '../../../utils/auth';
import { musicVisibilityClause } from '../../../utils/musicVisibility';

export default defineEventHandler(async (event) => {
  const session = await getUserFromSession(event);
  const db = getDb();

  const query = getQuery(event);
  const search = query.q ? String(query.q).trim() : '';

  const whereClauses: string[] = ["t.download_status = 'completed'"];
  const params: any[] = [];

  const visClause = musicVisibilityClause(session, 'a');
  if (visClause) {
    whereClauses.push(visClause);
  }

  if (search) {
    try {
      const ftsQuery = search.split(/\s+/).filter(Boolean).map(word => `"${word.replace(/"/g, '""')}"*`).join(' AND ');
      if (ftsQuery) {
        db.prepare('SELECT 1 FROM music_tracks_fts WHERE music_tracks_fts MATCH ? LIMIT 1').get(ftsQuery);
        whereClauses.push('t.id IN (SELECT id FROM music_tracks_fts WHERE music_tracks_fts MATCH ?)');
        params.push(ftsQuery);
      }
    } catch (e) {
      whereClauses.push('(t.title LIKE ? OR a.name LIKE ? OR al.title LIKE ?)');
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  const tracks = db.prepare(`
    SELECT t.id, t.title, t.track_number, t.genre, t.language, t.duration,
           t.local_file_path, t.local_thumbnail_path, t.has_clip, t.artist_id,
           a.name as artist_name, al.title as album_title
    FROM music_tracks t
    JOIN music_artists a ON t.artist_id = a.id
    LEFT JOIN music_albums al ON t.album_id = al.id
    ${whereSql}
    ORDER BY t.title ASC
    LIMIT 200
  `).all(...params);

  return { tracks };
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- music-tracks-search`
Expected: PASS, all 8 tests green.

- [ ] **Step 5: Run the full suite to confirm no regressions**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/api/music/tracks/search.get.ts tests/integration/music-tracks-search.test.ts
git commit -m "feat: add GET /api/music/tracks/search"
```

---

### Task 3: `GET /api/podcasts/episodes/search` endpoint

**Files:**
- Create: `server/api/podcasts/episodes/search.get.ts`
- Test: `tests/integration/podcast-episodes-search.test.ts`

**Interfaces:**
- Consumes: `podcast_episodes_fts` (Task 1), `podcastVisibilityClause(session, columnAlias)` from `server/utils/podcastVisibility.ts` (existing, exported signature: `(session: SessionForVisibility | null, columnAlias: string = 's') => string`).
- Produces: `GET /api/podcasts/episodes/search?q=<term>` → `{ episodes: [{ id, title, duration, episode_number, season_number, pub_date, local_file_path, local_thumbnail_path, show_id, show_title, show_cover_url }] }`. Consumed by Task 5 (`/podcasts`'s search UI) and Task 6 (`/search` page).

- [ ] **Step 1: Write the failing tests**

Create `tests/integration/podcast-episodes-search.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import handler from '../../server/api/podcasts/episodes/search.get';
import {
  createTestDb,
  insertUser,
  insertSession,
  insertPodcastShow,
  insertPodcastEpisode,
  mockEvent,
  sessionCookie
} from '../helpers/testDb';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
});

function loginAs(userId: string, role: 'admin' | 'user' = 'user', path = '/api/podcasts/episodes/search') {
  insertUser(db, { id: userId, role });
  const sessionId = `sess-${userId}`;
  insertSession(db, { id: sessionId, userId });
  return mockEvent(sessionCookie(sessionId), { path });
}

const guestEvent = (path = '/api/podcasts/episodes/search') => mockEvent(undefined, { path });

describe('GET /api/podcasts/episodes/search', () => {
  it('finds an episode by its own title via the LIKE fallback (no FTS table exists in the test DB, so this always exercises the fallback path)', async () => {
    insertPodcastShow(db, { id: 's1', title: 'Planet Money' });
    insertPodcastEpisode(db, { id: 'e1', showId: 's1' });
    db.prepare("UPDATE podcast_episodes SET title = 'The Big Short Story' WHERE id = 'e1'").run();
    insertPodcastEpisode(db, { id: 'e2', showId: 's1' });
    db.prepare("UPDATE podcast_episodes SET title = 'Unrelated Episode' WHERE id = 'e2'").run();

    const result: any = await handler(guestEvent('/api/podcasts/episodes/search?q=Short'));
    expect(result.episodes.map((e: any) => e.id)).toEqual(['e1']);
  });

  it('includes the joined show_title and show_cover_url', async () => {
    insertPodcastShow(db, { id: 's1', title: 'Planet Money' });
    db.prepare("UPDATE podcast_shows SET cover_url = 'https://example.com/cover.jpg' WHERE id = 's1'").run();
    insertPodcastEpisode(db, { id: 'e1', showId: 's1' });
    db.prepare("UPDATE podcast_episodes SET title = 'The Big Short Story' WHERE id = 'e1'").run();

    const result: any = await handler(guestEvent('/api/podcasts/episodes/search?q=Short'));
    expect(result.episodes[0].show_title).toBe('Planet Money');
    expect(result.episodes[0].show_cover_url).toBe('https://example.com/cover.jpg');
  });

  it('excludes an episode whose show is private, for a guest', async () => {
    insertPodcastShow(db, { id: 's1', visibility: 'private' });
    insertPodcastEpisode(db, { id: 'e1', showId: 's1' });
    db.prepare("UPDATE podcast_episodes SET title = 'Secret Episode' WHERE id = 'e1'").run();

    const result: any = await handler(guestEvent('/api/podcasts/episodes/search?q=Secret'));
    expect(result.episodes).toEqual([]);
  });

  it('includes an episode whose show is private, for a logged-in non-admin user', async () => {
    insertPodcastShow(db, { id: 's1', visibility: 'private' });
    insertPodcastEpisode(db, { id: 'e1', showId: 's1' });
    db.prepare("UPDATE podcast_episodes SET title = 'Secret Episode' WHERE id = 'e1'").run();

    const result: any = await handler(loginAs('u1', 'user', '/api/podcasts/episodes/search?q=Secret'));
    expect(result.episodes.map((e: any) => e.id)).toEqual(['e1']);
  });

  it('excludes an episode whose show is ultra_private, for a logged-in non-admin user', async () => {
    insertPodcastShow(db, { id: 's1', visibility: 'ultra_private' });
    insertPodcastEpisode(db, { id: 'e1', showId: 's1' });
    db.prepare("UPDATE podcast_episodes SET title = 'Ultra Secret Episode' WHERE id = 'e1'").run();

    const result: any = await handler(loginAs('u1', 'user', '/api/podcasts/episodes/search?q=Ultra'));
    expect(result.episodes).toEqual([]);
  });

  it('includes an ultra_private show episode for an admin', async () => {
    insertPodcastShow(db, { id: 's1', visibility: 'ultra_private' });
    insertPodcastEpisode(db, { id: 'e1', showId: 's1' });
    db.prepare("UPDATE podcast_episodes SET title = 'Ultra Secret Episode' WHERE id = 'e1'").run();

    const result: any = await handler(loginAs('admin1', 'admin', '/api/podcasts/episodes/search?q=Ultra'));
    expect(result.episodes.map((e: any) => e.id)).toEqual(['e1']);
  });

  it('excludes an episode that is not yet completed', async () => {
    insertPodcastShow(db, { id: 's1' });
    insertPodcastEpisode(db, { id: 'e1', showId: 's1', downloadStatus: 'downloading' });
    db.prepare("UPDATE podcast_episodes SET title = 'Still Downloading Episode' WHERE id = 'e1'").run();

    const result: any = await handler(guestEvent('/api/podcasts/episodes/search?q=Downloading'));
    expect(result.episodes).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- podcast-episodes-search`
Expected: FAIL — `Cannot find module '../../server/api/podcasts/episodes/search.get'`

- [ ] **Step 3: Write the implementation**

Create `server/api/podcasts/episodes/search.get.ts`:

```typescript
import { defineEventHandler, getQuery } from 'h3';
import { getUserFromSession } from '../../../utils/auth';
import { podcastVisibilityClause } from '../../../utils/podcastVisibility';

export default defineEventHandler(async (event) => {
  const session = await getUserFromSession(event);
  const db = getDb();

  const query = getQuery(event);
  const search = query.q ? String(query.q).trim() : '';

  const whereClauses: string[] = ["e.download_status = 'completed'"];
  const params: any[] = [];

  const visClause = podcastVisibilityClause(session, 's');
  if (visClause) {
    whereClauses.push(visClause);
  }

  if (search) {
    try {
      const ftsQuery = search.split(/\s+/).filter(Boolean).map(word => `"${word.replace(/"/g, '""')}"*`).join(' AND ');
      if (ftsQuery) {
        db.prepare('SELECT 1 FROM podcast_episodes_fts WHERE podcast_episodes_fts MATCH ? LIMIT 1').get(ftsQuery);
        whereClauses.push('e.id IN (SELECT id FROM podcast_episodes_fts WHERE podcast_episodes_fts MATCH ?)');
        params.push(ftsQuery);
      }
    } catch (e) {
      whereClauses.push('(e.title LIKE ? OR e.description LIKE ? OR s.title LIKE ?)');
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  const episodes = db.prepare(`
    SELECT e.id, e.title, e.duration, e.episode_number, e.season_number, e.pub_date,
           e.local_file_path, e.local_thumbnail_path, e.show_id,
           s.title as show_title, s.cover_url as show_cover_url
    FROM podcast_episodes e
    JOIN podcast_shows s ON e.show_id = s.id
    ${whereSql}
    ORDER BY e.title ASC
    LIMIT 200
  `).all(...params);

  return { episodes };
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- podcast-episodes-search`
Expected: PASS, all 7 tests green.

- [ ] **Step 5: Run the full suite to confirm no regressions**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/api/podcasts/episodes/search.get.ts tests/integration/podcast-episodes-search.test.ts
git commit -m "feat: add GET /api/podcasts/episodes/search"
```

---

### Task 4: `content_search_mode` setting routes + Settings UI toggle

**Files:**
- Create: `server/api/settings/content-search-mode.get.ts`
- Create: `server/api/admin/settings/content-search-mode.post.ts`
- Modify: `app/components/settings/SettingsSystemTab.vue`

**Interfaces:**
- Consumes: the `content_search_mode` setting row (Task 1).
- Produces: `GET /api/settings/content-search-mode` (public) → `{ mode: 'per_space' | 'global' }`; `POST /api/admin/settings/content-search-mode` (admin-only) with body `{ mode: 'per_space' | 'global' }` → `{ mode }`. Consumed by Task 6 (`default.vue`'s `handleSearch()`).

- [ ] **Step 1: Create the public GET route**

Create `server/api/settings/content-search-mode.get.ts`:

```typescript
import { defineEventHandler } from 'h3';

export default defineEventHandler(async () => {
  try {
    const db = getDb();
    const row = db.prepare("SELECT value FROM settings WHERE key = 'content_search_mode'").get() as { value: string } | undefined;
    return { mode: row?.value === 'global' ? 'global' : 'per_space' };
  } catch {
    return { mode: 'per_space' };
  }
});
```

- [ ] **Step 2: Create the admin-only POST route**

Create `server/api/admin/settings/content-search-mode.post.ts`:

```typescript
import { defineEventHandler, readBody, createError } from 'h3';
import { requireAdmin } from '../../../utils/auth';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);

  const body = await readBody(event);
  if (!body || typeof body !== 'object' || (body.mode !== 'per_space' && body.mode !== 'global')) {
    throw createError({ statusCode: 400, statusMessage: "mode must be 'per_space' or 'global'." });
  }

  const db = getDb();
  db.prepare("INSERT INTO settings (key, value) VALUES ('content_search_mode', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(body.mode);

  return { mode: body.mode };
});
```

- [ ] **Step 3: Add the toggle panel to `SettingsSystemTab.vue`**

In `app/components/settings/SettingsSystemTab.vue`, find the end of the "Search Platforms" panel — its closing tags look like:

```html
            <button type="submit" class="btn btn-secondary-dark" :disabled="savingPlatformId === platform.id">
              {{ savingPlatformId === platform.id ? 'Saving...' : 'Save' }}
            </button>
          </form>
        </div>
      </div>
    </div>
  </div>
</template>
```

Insert a new panel between the Search Platforms panel's closing `</div>` (the one closing `class="config-section glass-panel"`) and the `</div>` that closes `system-dashboard-layout`, so it reads:

```html
            <button type="submit" class="btn btn-secondary-dark" :disabled="savingPlatformId === platform.id">
              {{ savingPlatformId === platform.id ? 'Saving...' : 'Save' }}
            </button>
          </form>
        </div>
      </div>

      <div class="config-section glass-panel">
        <div class="section-title-row">
          <div class="icon-orb bg-pink">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          </div>
          <div>
            <h3>Recherche</h3>
            <p class="section-desc">Contrôle la barre de recherche du header : recherche isolée par espace, ou recherche globale sur une page dédiée regroupant vidéos, musique et podcasts.</p>
          </div>
        </div>

        <div class="mt-3">
          <select v-model="contentSearchMode" @change="handleSaveContentSearchMode" class="form-select" :disabled="savingContentSearchMode">
            <option value="per_space">Par espace</option>
            <option value="global">Globale</option>
          </select>
        </div>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 4: Add the state and handlers to the script**

At the end of the `<script setup>` block (after the existing `handleSaveSearchPlatform` function, before `onMounted`), add:

```typescript
const contentSearchMode = ref('per_space');
const savingContentSearchMode = ref(false);

const fetchContentSearchMode = async () => {
  try {
    const data = await $fetch<any>('/api/settings/content-search-mode');
    contentSearchMode.value = data.mode || 'per_space';
  } catch (err) {
    console.error('Failed to fetch content search mode:', err);
  }
};

const handleSaveContentSearchMode = async () => {
  savingContentSearchMode.value = true;
  try {
    await $fetch('/api/admin/settings/content-search-mode', {
      method: 'POST',
      body: { mode: contentSearchMode.value }
    });
    toast.success('Mode de recherche mis à jour.');
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Échec de la mise à jour du mode de recherche.');
  } finally {
    savingContentSearchMode.value = false;
  }
};
```

Then find the existing `onMounted` block:

```typescript
onMounted(() => {
  fetchSearchPlatforms();
});
```

Replace it with:

```typescript
onMounted(() => {
  fetchSearchPlatforms();
  fetchContentSearchMode();
});
```

- [ ] **Step 5: Run the full test suite to confirm no regressions**

Run: `npm test`
Expected: PASS — no dedicated test for these two thin settings routes (matches `music-module.get.ts`/`.post.ts`'s own lack of dedicated tests) or for this Vue change (matches this codebase's established convention for this class of Settings UI change).

- [ ] **Step 6: Run a full build**

Run: `npx nuxt build`
Expected: builds cleanly with no errors.

- [ ] **Step 7: Commit**

```bash
git add server/api/settings/content-search-mode.get.ts server/api/admin/settings/content-search-mode.post.ts app/components/settings/SettingsSystemTab.vue
git commit -m "feat: add content_search_mode setting routes and Settings toggle"
```

---

### Task 5: `/music` and `/podcasts` grid-to-list search UI

**Files:**
- Modify: `app/pages/music/index.vue`
- Modify: `app/pages/podcasts/index.vue`

**Interfaces:**
- Consumes: `GET /api/music/tracks/search` (Task 2), `GET /api/podcasts/episodes/search` (Task 3).

- [ ] **Step 1: Restructure `/music`'s grid view template**

In `app/pages/music/index.vue`, find the entire GRID VIEW block — from `<div v-if="!artistId">` through its matching closing `</div>` (the one immediately before `<!-- DETAIL VIEW -->`). Its current content is:

```html
    <div v-if="!artistId">
      <div class="music-filters-bar">
        <input
          v-model="search"
          type="text"
          placeholder="Rechercher un artiste..."
          class="form-input music-search-input"
        />
        <select v-model="genre" class="form-input">
          <option value="">Tous les genres</option>
          <option v-for="g in facets.genres" :key="g" :value="g">{{ g }}</option>
        </select>
        <select v-model="language" class="form-input">
          <option value="">Toutes les langues</option>
          <option v-for="l in facets.languages" :key="l" :value="l">{{ l }}</option>
        </select>
        <select v-model="year" class="form-input">
          <option value="">Toutes les années</option>
          <option v-for="y in facets.years" :key="y" :value="y">{{ y }}</option>
        </select>
      </div>

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

      <div v-else-if="gridError" class="music-error">Erreur lors du chargement des artistes.</div>

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
```

Replace it with:

```html
    <div v-if="!artistId">
      <div class="music-filters-bar">
        <input
          v-model="search"
          type="text"
          placeholder="Rechercher un artiste ou un titre..."
          class="form-input music-search-input"
        />
        <template v-if="!search">
          <select v-model="genre" class="form-input">
            <option value="">Tous les genres</option>
            <option v-for="g in facets.genres" :key="g" :value="g">{{ g }}</option>
          </select>
          <select v-model="language" class="form-input">
            <option value="">Toutes les langues</option>
            <option v-for="l in facets.languages" :key="l" :value="l">{{ l }}</option>
          </select>
          <select v-model="year" class="form-input">
            <option value="">Toutes les années</option>
            <option v-for="y in facets.years" :key="y" :value="y">{{ y }}</option>
          </select>
        </template>
      </div>

      <template v-if="search">
        <div v-if="trackSearchPending" class="music-loading">Chargement...</div>
        <div v-else-if="trackSearchError" class="music-error">Erreur lors de la recherche.</div>
        <EmptyState
          v-else-if="trackSearchResults.length === 0"
          icon="music"
          title="Aucun résultat"
          description="Aucun titre ne correspond à cette recherche."
        />
        <div v-else class="track-search-results">
          <div
            v-for="track in trackSearchResults"
            :key="track.id"
            class="track-row"
            :class="{ 'now-playing': currentTrack?.id === track.id }"
            @click="playTrackSearchResult(track)"
          >
            <span class="track-row-title">{{ track.title }}</span>
            <span class="track-row-artist">{{ track.artist_name }}</span>
          </div>
        </div>
      </template>

      <template v-else>
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

        <div v-else-if="gridError" class="music-error">Erreur lors du chargement des artistes.</div>

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
      </template>
    </div>
```

- [ ] **Step 2: Add the track-search state, fetch function, and debounce branch**

Find this existing block:

```typescript
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
watch(search, () => {
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => fetchArtists(), 300);
});
watch([genre, language, year], () => fetchArtists());
```

Replace it with:

```typescript
const trackSearchResults = ref<any[]>([]);
const trackSearchPending = ref(false);
const trackSearchError = ref(false);
let trackSearchRequestId = 0;

async function fetchTrackSearch() {
  const requestId = ++trackSearchRequestId;
  trackSearchPending.value = true;
  trackSearchError.value = false;
  try {
    const data = await $fetch<any>('/api/music/tracks/search', { params: { q: search.value } });
    if (requestId !== trackSearchRequestId) return;
    trackSearchResults.value = data.tracks || [];
  } catch (e) {
    if (requestId !== trackSearchRequestId) return;
    trackSearchResults.value = [];
    trackSearchError.value = true;
  } finally {
    if (requestId !== trackSearchRequestId) return;
    trackSearchPending.value = false;
  }
}

function playTrackSearchResult(track: any) {
  playMusicTrack(track, trackSearchResults.value);
}

let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
watch(search, () => {
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    if (search.value) {
      fetchTrackSearch();
    } else {
      fetchArtists();
    }
  }, 300);
});
watch([genre, language, year], () => fetchArtists());
```

- [ ] **Step 3: Add CSS for the new flat list**

In the same file's `<style scoped>` block, find the existing `.track-row` rules (used by the artist detail view) and add these new rules right after them — reusing `.track-row`'s look for consistency, with one new wrapper class:

```css
.track-search-results {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.track-row-title {
  font-weight: 500;
}

.track-row-artist {
  color: var(--text-secondary);
  margin-left: 8px;
  font-size: 13px;
}
```

- [ ] **Step 4: Repeat the same restructuring for `/podcasts`**

In `app/pages/podcasts/index.vue`, find the GRID VIEW block:

```html
    <div v-if="!showId">
      <div class="podcast-filters-bar">
        <input
          v-model="search"
          type="text"
          placeholder="Rechercher un podcast..."
          class="form-input podcast-search-input"
        />
      </div>

      <div v-if="gridPending" class="podcast-loading">Chargement...</div>

      <div v-else-if="gridError" class="podcast-error">Erreur lors du chargement des podcasts.</div>

      <EmptyState
        v-else-if="shows.length === 0"
        icon="music"
        :title="search ? 'Aucun résultat' : 'Aucun podcast archivé'"
        :description="search ? 'Aucun résultat pour cette recherche.' : 'Aucun podcast archivé pour l\'instant.'"
      />

      <div v-else class="show-grid">
        <div
          v-for="s in shows"
          :key="s.id"
          class="show-card"
          @click="router.push({ path: '/podcasts', query: { showId: s.id } })"
        >
          <img :src="s.cover_url || fallbackCover" @error="handleCoverError" class="show-card-cover" alt="" />
          <div class="show-card-body">
            <h3 class="show-card-title">{{ s.title }}</h3>
            <p class="show-card-meta">{{ s.episode_count }} épisode(s)</p>
            <span v-if="isAdmin" class="badge" :class="getVisBadgeClass(s.visibility)">{{ formatVisibility(s.visibility) }}</span>
          </div>
        </div>
      </div>
    </div>
```

Replace it with:

```html
    <div v-if="!showId">
      <div class="podcast-filters-bar">
        <input
          v-model="search"
          type="text"
          placeholder="Rechercher un podcast ou un épisode..."
          class="form-input podcast-search-input"
        />
      </div>

      <template v-if="search">
        <div v-if="episodeSearchPending" class="podcast-loading">Chargement...</div>
        <div v-else-if="episodeSearchError" class="podcast-error">Erreur lors de la recherche.</div>
        <EmptyState
          v-else-if="episodeSearchResults.length === 0"
          icon="music"
          title="Aucun résultat"
          description="Aucun épisode ne correspond à cette recherche."
        />
        <div v-else class="episode-search-results">
          <div
            v-for="episode in episodeSearchResults"
            :key="episode.id"
            class="episode-search-row"
            @click="playEpisodeSearchResult(episode)"
          >
            <span class="episode-search-title">{{ episode.title }}</span>
            <span class="episode-search-show">{{ episode.show_title }}</span>
          </div>
        </div>
      </template>

      <template v-else>
        <div v-if="gridPending" class="podcast-loading">Chargement...</div>

        <div v-else-if="gridError" class="podcast-error">Erreur lors du chargement des podcasts.</div>

        <EmptyState
          v-else-if="shows.length === 0"
          icon="music"
          title="Aucun podcast archivé"
          description="Aucun podcast archivé pour l'instant."
        />

        <div v-else class="show-grid">
          <div
            v-for="s in shows"
            :key="s.id"
            class="show-card"
            @click="router.push({ path: '/podcasts', query: { showId: s.id } })"
          >
            <img :src="s.cover_url || fallbackCover" @error="handleCoverError" class="show-card-cover" alt="" />
            <div class="show-card-body">
              <h3 class="show-card-title">{{ s.title }}</h3>
              <p class="show-card-meta">{{ s.episode_count }} épisode(s)</p>
              <span v-if="isAdmin" class="badge" :class="getVisBadgeClass(s.visibility)">{{ formatVisibility(s.visibility) }}</span>
            </div>
          </div>
        </div>
      </template>
    </div>
```

Note: the `EmptyState` for the empty grid no longer needs the `search`-conditional title/description, since the grid is now only ever shown when `search` is empty (the search-result `EmptyState` above handles the searching-with-no-results case instead).

- [ ] **Step 5: Add the episode-search state, fetch function, and debounce branch**

Find this existing block:

```typescript
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
watch(search, () => {
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => fetchShows(), 300);
});
```

Replace it with:

```typescript
const episodeSearchResults = ref<any[]>([]);
const episodeSearchPending = ref(false);
const episodeSearchError = ref(false);
let episodeSearchRequestId = 0;

async function fetchEpisodeSearch() {
  const requestId = ++episodeSearchRequestId;
  episodeSearchPending.value = true;
  episodeSearchError.value = false;
  try {
    const data = await $fetch<any>('/api/podcasts/episodes/search', { params: { q: search.value } });
    if (requestId !== episodeSearchRequestId) return;
    episodeSearchResults.value = data.episodes || [];
  } catch (e) {
    if (requestId !== episodeSearchRequestId) return;
    episodeSearchResults.value = [];
    episodeSearchError.value = true;
  } finally {
    if (requestId !== episodeSearchRequestId) return;
    episodeSearchPending.value = false;
  }
}

// The episodes-search endpoint carries the show's cover art, so it's passed
// through directly to the mini-player — matches how playEpisode() below
// (the detail view's own click handler) sources show_cover_url from the
// already-loaded show, just from the search result row instead.
function playEpisodeSearchResult(ep: any) {
  if (!ep.local_file_path) return;
  playPodcastEpisode({
    id: ep.id,
    title: ep.title,
    show_title: ep.show_title,
    show_cover_url: ep.show_cover_url ?? null,
    duration: ep.duration ?? null,
    local_file_path: ep.local_file_path,
  });
}

let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
watch(search, () => {
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    if (search.value) {
      fetchEpisodeSearch();
    } else {
      fetchShows();
    }
  }, 300);
});
```

- [ ] **Step 6: Add CSS for the new flat list**

In the same file's `<style scoped>` block, find the existing `.episode-row` rules (used by the show detail view) and add these new rules right after them:

```css
.episode-search-results {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.episode-search-row {
  padding: 10px 12px;
  border-radius: 8px;
  cursor: pointer;
}

.episode-search-row:hover {
  background: var(--surface-hover);
}

.episode-search-title {
  font-weight: 500;
}

.episode-search-show {
  color: var(--text-secondary);
  margin-left: 8px;
  font-size: 13px;
}
```

- [ ] **Step 7: Run the full test suite to confirm no regressions**

Run: `npm test`
Expected: PASS — no dedicated test file targets either page component (matches this codebase's established convention for this class of catalog-page UI change).

- [ ] **Step 8: Run a full build**

Run: `npx nuxt build`
Expected: builds cleanly with no errors.

- [ ] **Step 9: Commit**

```bash
git add app/pages/music/index.vue app/pages/podcasts/index.vue
git commit -m "feat: replace artist/show grid with a flat search-result list on /music and /podcasts"
```

---

### Task 6: Header bar `content_search_mode` branching + new `/search` page

**Files:**
- Modify: `app/layouts/default.vue`
- Create: `app/pages/search.vue`

**Interfaces:**
- Consumes: `GET /api/settings/content-search-mode` (Task 4), `GET /api/videos` (existing), `GET /api/music/tracks/search` (Task 2), `GET /api/podcasts/episodes/search` (Task 3).

- [ ] **Step 1: Make `handleSearch()` mode-aware**

In `app/layouts/default.vue`, find:

```typescript
const handleSearch = () => {
  router.push({ path: '/', query: { ...route.query, q: searchQuery.value || undefined, page: undefined } });
};
```

Replace it with:

```typescript
const contentSearchMode = ref('per_space');

async function fetchContentSearchMode() {
  try {
    const data = await $fetch<{ mode: string }>('/api/settings/content-search-mode');
    contentSearchMode.value = data.mode === 'global' ? 'global' : 'per_space';
  } catch (e) {
    contentSearchMode.value = 'per_space';
  }
}

const handleSearch = () => {
  if (contentSearchMode.value === 'global') {
    router.push({ path: '/search', query: { q: searchQuery.value || undefined } });
    return;
  }
  router.push({ path: activeSpace.value.homeRoute, query: { ...route.query, q: searchQuery.value || undefined, page: undefined } });
};
```

- [ ] **Step 2: Fetch the mode on mount**

Find the existing `onMounted` block:

```typescript
onMounted(() => {
  if (route.query.q) {
    searchQuery.value = String(route.query.q);
  }
  checkPasswordEnforcement();
  // Runs after both mini-players' own onMounted restores (Vue mounts children
  // before parents), so by now each player has kicked off its own restore.
  restoreActiveType();
});
```

Replace it with:

```typescript
onMounted(() => {
  if (route.query.q) {
    searchQuery.value = String(route.query.q);
  }
  checkPasswordEnforcement();
  // Runs after both mini-players' own onMounted restores (Vue mounts children
  // before parents), so by now each player has kicked off its own restore.
  restoreActiveType();
  fetchContentSearchMode();
});
```

- [ ] **Step 3: Create the `/search` page**

Create `app/pages/search.vue`:

```vue
<template>
  <div class="search-page">
    <h1 class="search-page-title">Résultats pour "{{ query }}"</h1>

    <section class="search-section">
      <h2 class="search-section-title">Vidéos</h2>
      <div v-if="videosPending" class="search-loading">Chargement...</div>
      <div v-else-if="videosError" class="search-error">Erreur lors du chargement des vidéos.</div>
      <EmptyState
        v-else-if="videos.length === 0"
        icon="video"
        title="Aucune vidéo"
        description="Aucune vidéo ne correspond à cette recherche."
      />
      <template v-else>
        <div class="video-grid stagger-in">
          <VideoCard v-for="video in videos" :key="video.id" :video="video" />
        </div>
        <NuxtLink :to="{ path: '/', query: { q: query } }" class="search-see-more">Voir plus de vidéos</NuxtLink>
      </template>
    </section>

    <section class="search-section">
      <h2 class="search-section-title">Musique</h2>
      <div v-if="tracksPending" class="search-loading">Chargement...</div>
      <div v-else-if="tracksError" class="search-error">Erreur lors du chargement de la musique.</div>
      <EmptyState
        v-else-if="tracks.length === 0"
        icon="music"
        title="Aucun titre"
        description="Aucun titre ne correspond à cette recherche."
      />
      <template v-else>
        <div class="search-result-rows">
          <div
            v-for="track in tracks"
            :key="track.id"
            class="search-result-row"
            @click="playTrack(track)"
          >
            <span class="search-result-title">{{ track.title }}</span>
            <span class="search-result-subtitle">{{ track.artist_name }}</span>
          </div>
        </div>
        <NuxtLink :to="{ path: '/music', query: { q: query } }" class="search-see-more">Voir plus de musique</NuxtLink>
      </template>
    </section>

    <section class="search-section">
      <h2 class="search-section-title">Podcasts</h2>
      <div v-if="episodesPending" class="search-loading">Chargement...</div>
      <div v-else-if="episodesError" class="search-error">Erreur lors du chargement des podcasts.</div>
      <EmptyState
        v-else-if="episodes.length === 0"
        icon="music"
        title="Aucun épisode"
        description="Aucun épisode ne correspond à cette recherche."
      />
      <template v-else>
        <div class="search-result-rows">
          <div
            v-for="episode in episodes"
            :key="episode.id"
            class="search-result-row"
            @click="playEpisode(episode)"
          >
            <span class="search-result-title">{{ episode.title }}</span>
            <span class="search-result-subtitle">{{ episode.show_title }}</span>
          </div>
        </div>
        <NuxtLink :to="{ path: '/podcasts', query: { q: query } }" class="search-see-more">Voir plus de podcasts</NuxtLink>
      </template>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useMusicPlayer } from '~/composables/useMusicPlayer';
import { usePodcastPlayer } from '~/composables/usePodcastPlayer';

const route = useRoute();
const query = computed(() => (route.query.q ? String(route.query.q) : ''));

const { play: playMusicTrack } = useMusicPlayer();
const { play: playPodcastEpisode } = usePodcastPlayer();

const videos = ref<any[]>([]);
const videosPending = ref(false);
const videosError = ref(false);

const tracks = ref<any[]>([]);
const tracksPending = ref(false);
const tracksError = ref(false);

const episodes = ref<any[]>([]);
const episodesPending = ref(false);
const episodesError = ref(false);

function playTrack(track: any) {
  playMusicTrack(track, tracks.value);
}

function playEpisode(ep: any) {
  if (!ep.local_file_path) return;
  playPodcastEpisode({
    id: ep.id,
    title: ep.title,
    show_title: ep.show_title,
    show_cover_url: ep.show_cover_url ?? null,
    duration: ep.duration ?? null,
    local_file_path: ep.local_file_path,
  });
}

async function fetchVideos() {
  videosPending.value = true;
  videosError.value = false;
  try {
    const data = await $fetch<any>('/api/videos', { params: { q: query.value, status: 'completed', limit: 10 } });
    videos.value = data.videos || [];
  } catch (e) {
    videos.value = [];
    videosError.value = true;
  } finally {
    videosPending.value = false;
  }
}

async function fetchTracks() {
  tracksPending.value = true;
  tracksError.value = false;
  try {
    const data = await $fetch<any>('/api/music/tracks/search', { params: { q: query.value } });
    tracks.value = (data.tracks || []).slice(0, 10);
  } catch (e) {
    tracks.value = [];
    tracksError.value = true;
  } finally {
    tracksPending.value = false;
  }
}

async function fetchEpisodes() {
  episodesPending.value = true;
  episodesError.value = false;
  try {
    const data = await $fetch<any>('/api/podcasts/episodes/search', { params: { q: query.value } });
    episodes.value = (data.episodes || []).slice(0, 10);
  } catch (e) {
    episodes.value = [];
    episodesError.value = true;
  } finally {
    episodesPending.value = false;
  }
}

function fetchAll() {
  if (!query.value) {
    videos.value = [];
    tracks.value = [];
    episodes.value = [];
    return;
  }
  // Independent fetches: one section's failure must not block the others.
  fetchVideos();
  fetchTracks();
  fetchEpisodes();
}

watch(query, fetchAll, { immediate: true });
</script>

<style scoped>
.search-page {
  padding: 24px;
}

.search-page-title {
  margin-bottom: 24px;
}

.search-section {
  margin-bottom: 32px;
}

.search-section-title {
  margin-bottom: 12px;
}

.search-see-more {
  display: inline-block;
  margin-top: 12px;
  color: var(--accent-primary);
}

.search-loading,
.search-error {
  color: var(--text-secondary);
  padding: 12px 0;
}

.search-result-rows {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.search-result-row {
  padding: 10px 12px;
  border-radius: 8px;
  cursor: pointer;
}

.search-result-row:hover {
  background: var(--surface-hover);
}

.search-result-title {
  font-weight: 500;
}

.search-result-subtitle {
  color: var(--text-secondary);
  margin-left: 8px;
  font-size: 13px;
}
</style>
```

- [ ] **Step 4: Run the full test suite to confirm no regressions**

Run: `npm test`
Expected: PASS — no dedicated test for `default.vue`'s change or the new `/search` page (matches this codebase's established convention: no component-test coverage for this interaction shape, manual verification instead).

- [ ] **Step 5: Run a full build**

Run: `npx nuxt build`
Expected: builds cleanly with no errors.

- [ ] **Step 6: Commit**

```bash
git add app/layouts/default.vue app/pages/search.vue
git commit -m "feat: add content_search_mode-aware header search and the /search page"
```

---

### Task 7: Manual end-to-end verification

No code changes — this task is a live verification pass, matching this codebase's established convention (using `curl` with the dev-login fixture rather than the Browser pane tool, which cannot reach a locally-started dev server in this environment — see the residual-limitations notes in prior sub-projects this session for the exact workaround: `ALLOW_DEV_LOGIN=1 npm run dev`, then `POST /api/dev/login` for a session cookie).

**Files:** none.

- [ ] **Step 1: Verify music track search end-to-end**

`GET /api/music/tracks/search?q=<a real track title from the dev DB, or a real artist name>` — confirm real matching tracks come back with `artist_name`/`album_title` populated. On `/music`, type the same query into the search box and confirm the grid is replaced by a flat list showing the same results, and that clicking a result starts playback.

- [ ] **Step 2: Verify podcast episode search end-to-end**

Same check against `GET /api/podcasts/episodes/search?q=<term>` and the `/podcasts` page's search box.

- [ ] **Step 3: Verify the `content_search_mode` toggle and its two behaviors**

In Settings → System, toggle to `global`, confirm `GET /api/settings/content-search-mode` reflects it. Using the header search bar from each of the 3 spaces (Video/Music/Podcasts), confirm every search now navigates to `/search?q=...` regardless of which space was active, and that page shows 3 populated (or correctly empty) sections with working "Voir plus" links. Toggle back to `per_space`, confirm the header bar now navigates to `/`, `/music`, or `/podcasts` depending on the active space (this is the first time this "space-aware" behavior — approved earlier this session — is actually live; confirm it genuinely works, not just that the toggle round-trips).

- [ ] **Step 4: Verify one of the 3 `/search` sections failing doesn't block the others**

If feasible, force one endpoint to fail (e.g. temporarily point the browser at a query that 500s, or simulate via devtools network throttling/blocking one request) and confirm the other 2 sections still render their results — this is the exact class of resilience requirement most likely to have a subtle bug (per Global Constraints: "one failing must not block the other 2 sections"). If not feasible to force a real failure, at minimum confirm via code trace that the 3 fetch functions are genuinely independent (no shared try/catch, no `await`ing one before starting another).

- [ ] **Step 5: Run the full test suite one final time**

Run: `npm test`
Expected: PASS, no regressions across the whole suite.
