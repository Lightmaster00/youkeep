# Podcast Library UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the already-shipped podcast data model and RSS ingestion pipeline reachable from the UI: a `/podcasts` space in the header space-switcher with a shows-grid ⇄ episode-list catalog page, an admin `Settings > Podcasts` tab wiring the 11 existing admin API routes, a file-serving route so downloaded episode audio can actually be fetched (with HTTP Range support), and per-episode metadata editing.

**Architecture:** Four pieces, each mirroring an existing Music mode equivalent file-for-file:

1. **Auth/visibility layer** — `canAccessPodcastShow` / `canAccessPodcastEpisode` in `server/utils/auth.ts` (mirroring `canAccessMusicArtist` / `canAccessMusicTrack`), plus `server/utils/podcastVisibility.ts` (mirroring `server/utils/musicVisibility.ts`) for the list-filtering WHERE fragment.
2. **Public read routes** — `server/api/podcasts/shows/index.get.ts`, `.../[id]/index.get.ts`, `.../[id]/episodes.get.ts`, mirroring `server/api/music/artists/*`.
3. **File-serving route** — `server/routes/downloads-podcasts/[...path].ts`, mirroring `server/routes/downloads-music/[...path].ts` including its audio Range branch and non-audio `Last-Modified`/304 branch.
4. **UI** — `app/pages/podcasts/index.vue` (grid/detail via `?showId=`, mirroring `/music`'s `?artistId=`), `app/components/PodcastEpisodeEditModal.vue` (mirroring `MusicTrackEditModal.vue`), `app/components/settings/SettingsPodcastsTab.vue` + `app/composables/usePodcastQueue.ts` (mirroring `SettingsMusicTab.vue` + `useMusicQueue.ts`), and a `podcasts` entry in `app/spaces/index.ts`.

Plus one new admin write route: `PATCH /api/admin/podcasts/episodes/[id]`.

**Tech Stack:** Nuxt 4, Nitro, better-sqlite3, TypeScript, Vue 3 `<script setup>`, Vitest + `@nuxt/test-utils` (`mountSuspended`).

## Global Constraints

- No playback UI (an actual audio player, resume-position/speed tracking) — later sub-project.
- No module on/off toggle (podcastModuleGate.ts, podcast_module_enabled setting) — deliberately deferred; the Podcasts space is always visible in this sub-project, no filtering/gating logic.
- No changes to any of the 11 existing admin API routes or to server/utils/podcastDownloader.ts itself — only new UI and new read/write routes on top of what exists.
- No advanced catalog filters (genre/language/year facets) in v1 — title search only.
- Vue component tests (via @nuxt/test-utils/mountSuspended) required for PodcastEpisodeEditModal.vue's form logic and any pure catalog-filtering helper that emerges; NO automated tests for the file-serving route or live API interactions — those get manual live verification in the final task, matching sub-project 2's established convention.
- File-serving route must fail closed on 404/403 exactly like downloads-music's route (a 404 for a missing/wrong-extension file must not reveal whether a differently-extensioned file exists at that path).

---

## Prerequisite context (read once, applies to every task)

### Authoritative schema (`server/utils/db.ts`, already shipped — do not modify)

```
podcast_shows(
  id TEXT PRIMARY KEY,
  feed_url TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  author TEXT,
  cover_url TEXT,
  language TEXT,
  sync_status TEXT DEFAULT 'paused',
  visibility TEXT DEFAULT 'public',
  last_checked_at INTEGER,
  created_at INTEGER NOT NULL
)

podcast_episodes(
  id TEXT PRIMARY KEY,
  show_id TEXT NOT NULL REFERENCES podcast_shows(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  audio_url TEXT NOT NULL,
  local_file_path TEXT,
  local_thumbnail_path TEXT,
  duration INTEGER,
  episode_number INTEGER,
  season_number INTEGER,
  pub_date TEXT,
  download_status TEXT DEFAULT 'pending',
  download_progress INTEGER DEFAULT 0,
  download_speed TEXT,
  download_eta TEXT,
  last_error TEXT,
  share_token TEXT UNIQUE,
  created_at INTEGER NOT NULL,
  retry_count INTEGER DEFAULT 0   -- added by sub-project 2's ALTER migration
)
```

**There is NO `size_bytes` column** on `podcast_episodes`, and no `episode_count` column on `podcast_shows` (it is always computed with `COUNT(...)` in a query). `pub_date` is TEXT, not an integer timestamp. `duration` is INTEGER seconds. Never reference a column not in the lists above.

### Resolved spec/reality discrepancies

These were checked against the real code, not the design spec's sketch. Implement what this section says:

1. **`downloads-music`'s route DOES support HTTP Range requests.** Confirmed in `server/routes/downloads-music/[...path].ts` lines 110-143: the audio branch sets `Accept-Ranges: bytes`, `Cache-Control: private, max-age=31536000, immutable`, parses `bytes=` into start/end, returns `416` with `Content-Range: bytes */<size>` when out of range, and otherwise `206` with `Content-Range` + `Content-Length` over a `fs.createReadStream(path, { start, end })`. The podcast route in Task 3 reproduces this branch verbatim.
2. **`local_file_path` is a URL path, not a filesystem path.** `downloadEpisodeFile` writes `/downloads-podcasts/${sanitizeFolderName(show.title || showId)}/${episodeId}.${ext}` into the DB, while the file lands at `path.join(getPodcastDownloadsDir(), folderName, `${episodeId}.${ext}`)`. So the serving route must resolve the show directory itself from `sanitizeFolderName(show.title || show.id)` — exactly the way the music route resolves `sanitizeFolderName(track.artist_name || track.artist_id)`. Do NOT `path.resolve()` the stored `local_file_path`.
3. **The spec names only `canAccessPodcastEpisode`, but the read routes need a show-level check too.** Music has the pair `canAccessMusicTrack` + `canAccessMusicArtist`; podcasts gets the same pair (`canAccessPodcastEpisode` + `canAccessPodcastShow`). Task 1 adds both.
4. **There is NO admin route to cancel an in-flight podcast download.** Music has `POST /api/admin/music/tracks/[id]/cancel`; the 11 podcast admin routes have no equivalent, and the Global Constraints forbid adding one. Therefore `SettingsPodcastsTab.vue` has NO per-queue-card "Cancel" button (unlike `SettingsMusicTab.vue`). Instead, failed cards get a per-episode **Retry**, using the existing `POST /api/admin/podcasts/retry-failed` with a `{ episodeId }` body — that route already supports the single-episode form.
5. **`GET /api/admin/podcasts/queue` returns `shows`, not `artists`.** Its exact response is `{ queue, history, shows, isPaused, failedCount }`, where `shows` rows are `{ id, title, cover_url, sync_status, visibility, episode_count }` (episode_count counts ALL episodes via LEFT JOIN, not just completed ones). `usePodcastQueue` must read `data.shows`.
6. **Show cover art is a remote URL, and no code writes a local podcast image file today.** `podcast_shows.cover_url` comes straight from the RSS feed, and `podcastDownloader.ts` only ever writes `local_file_path` (never `local_thumbnail_path`). The catalog page therefore renders `show.cover_url` directly with an inline-SVG fallback. The file-serving route still carries the image content-type map + `Last-Modified`/304 branch — the spec asks for it and it costs nothing — but be aware nothing populates those files yet; the route's lookup key is an episode id, so it could only ever serve an episode-level image.
7. **Search is server-side, mirroring `/music`.** `/api/podcasts/shows` takes a `search` query param and does the `title LIKE ?` filtering in SQL. No pure client-side catalog-filtering helper emerges, so the Global Constraints' conditional "any pure catalog-filtering helper that emerges" clause has nothing to attach to. Component tests are therefore required for `PodcastEpisodeEditModal.vue` only.
8. **`app/pages/settings.vue`'s `allowedTabs` array is `['stats', 'downloads', 'users', 'system']` — `'music'` was never added.** That is an existing quirk (the Music tab is clickable but not deep-linkable via `?tab=music`). Task 8 adds `'podcasts'` to `allowedTabs` so `?tab=podcasts` works, and deliberately leaves the pre-existing `'music'` omission alone (out of scope).
9. **`app/layouts/default.vue`'s `activeSpace` computed only distinguishes `/music` from everything-else.** Adding a space to `app/spaces/index.ts` is not sufficient — without a `/podcasts` branch in `activeSpace`, visiting `/podcasts` would show the Vidéo space's label and sidebar links. Task 6 adds that branch. It does NOT add any `visibleSpaces` filtering for podcasts (per the module-toggle constraint) — `visibleSpaces`'s existing `s.id !== 'music' || ...` predicate already lets every non-music space through unconditionally.

### Conventions

- `getDb`, `requireAdmin`, `requireUser`, `getUserFromSession`, `canAccess*`, `sanitizeFolderName`, `getPodcastDownloadsDir` are Nitro server-util auto-imports; existing route files are inconsistent about importing them explicitly. Each new file below matches its direct music precedent's import style file-for-file.
- Formatters (`formatDuration`, `formatVisibility`, `getVisBadgeClass`) are duplicated per-page in this codebase by explicit convention (see the comment at `app/pages/music/index.vue:539-541`). Do not extract a shared util module.
- Test commands: `npm test` (runs `vitest run` over both the `server` and `component` projects) and `npm run test:watch`. Component tests live in `tests/component/**/*.test.ts` and run in the `nuxt` environment.
- Every commit message ends with `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.

---

### Task 1: Podcast visibility helper + `canAccessPodcastShow` / `canAccessPodcastEpisode`

**Files:**
- Create: `server/utils/podcastVisibility.ts`
- Modify: `server/utils/auth.ts`

**Interfaces:**
- Produces:
  - `podcastVisibilityClause(session: SessionForVisibility | null, columnAlias?: string): string` — returns `''` for admins, `"<alias>.visibility IN ('public', 'private')"` for logged-in non-admins, `"<alias>.visibility = 'public'"` for guests. Default alias `'s'`.
  - `canAccessPodcastShow(showId: string, event: any): Promise<boolean>`
  - `canAccessPodcastEpisode(episodeId: string, event: any): Promise<boolean>`
- Consumes: `getUserFromSession` (existing, same file), `getDb` (auto-import).

- [ ] **Step 1: Create `server/utils/podcastVisibility.ts`**

  Create the file with exactly this content:
  ```ts
  export interface SessionForVisibility {
    role: 'admin' | 'user';
  }

  // The three-tier visibility rule used everywhere Podcast mode filters a list
  // of shows/episodes by who's allowed to see them: guest sees only `public`;
  // a logged-in non-admin sees `public` and `private`; an admin sees
  // everything. Extracted here for the same reason musicVisibility.ts exists —
  // a drift between copies of this rule is a data leak (an unintended
  // visibility tier becoming visible), not just a cosmetic bug, so there must
  // be exactly one place this logic lives.
  export function podcastVisibilityClause(session: SessionForVisibility | null, columnAlias: string = 's'): string {
    if (session && session.role === 'admin') {
      return '';
    }
    if (session) {
      return `${columnAlias}.visibility IN ('public', 'private')`;
    }
    return `${columnAlias}.visibility = 'public'`;
  }
  ```

  This mirrors `server/utils/musicVisibility.ts` verbatim except for the default alias (`'s'` for `podcast_shows` instead of `'a'` for `music_artists`).

- [ ] **Step 2: Add `canAccessPodcastShow` to `server/utils/auth.ts`**

  Open `server/utils/auth.ts` and append after `canAccessMusicArtist` (the current last function in the file, ending at line 278):
  ```ts

  export async function canAccessPodcastShow(showId: string, event: any): Promise<boolean> {
    const db = getDb();

    const show = db.prepare('SELECT visibility FROM podcast_shows WHERE id = ?').get(showId) as { visibility: string } | undefined;

    if (!show) return false;

    const user = await getUserFromSession(event);

    const visMap: Record<string, number> = { 'public': 0, 'private': 1, 'ultra_private': 2 };
    // Fail closed, same reasoning as canAccessMusicArtist: podcast_shows.visibility
    // has no CHECK constraint and only the ingest endpoint validates it, so an
    // unrecognized value must never be treated as public.
    const level = visMap[show.visibility] ?? 2;

    if (level === 0) return true; // Public: everyone
    if (!user) return false;      // Guest: no access to restricted content
    if (user.role === 'admin') return true; // Admin sees everything
    if (level === 1) return true; // Private: any logged-in member

    // Ultra Private: admin-only for podcasts — no equivalent of
    // user_channel_access exists for podcast shows.
    return false;
  }
  ```

- [ ] **Step 3: Add `canAccessPodcastEpisode` to `server/utils/auth.ts`**

  Append immediately after `canAccessPodcastShow`:
  ```ts

  export async function canAccessPodcastEpisode(episodeId: string, event: any): Promise<boolean> {
    const db = getDb();

    const episode = db.prepare(`
      SELECT s.visibility as show_visibility
      FROM podcast_episodes e
      JOIN podcast_shows s ON e.show_id = s.id
      WHERE e.id = ?
    `).get(episodeId) as { show_visibility: string } | undefined;

    if (!episode) return false;

    const user = await getUserFromSession(event);

    const visMap: Record<string, number> = { 'public': 0, 'private': 1, 'ultra_private': 2 };
    // Fail closed on an unrecognized visibility value — same reasoning as
    // canAccessMusicTrack. podcast_episodes has no visibility column of its
    // own, so the parent show's value is the only tier that applies.
    const level = visMap[episode.show_visibility] ?? 2;

    if (level === 0) return true; // Public: everyone
    if (!user) return false;      // Guest: no access to restricted content
    if (user.role === 'admin') return true; // Admin sees everything
    if (level === 1) return true; // Private: any logged-in member

    // Ultra Private: admin-only for podcasts.
    return false;
  }
  ```

- [ ] **Step 4: Verify the suite still passes**

  ```bash
  npm test
  ```
  Expect all existing tests to pass (this task adds no tests — these are auth helpers over a live DB, matching the untested-by-convention `canAccessMusicTrack`/`canAccessMusicArtist`).

- [ ] **Step 5: Commit**

  ```bash
  git add server/utils/podcastVisibility.ts server/utils/auth.ts
  git commit -m "$(cat <<'EOF'
  feat: add podcast visibility clause and access-check helpers

  podcastVisibilityClause() mirrors musicVisibilityClause() for list queries;
  canAccessPodcastShow()/canAccessPodcastEpisode() mirror canAccessMusicArtist()/
  canAccessMusicTrack(), including their fail-closed treatment of an
  unrecognized visibility value.

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 2: Public read API routes for shows and episodes

**Files:**
- Create: `server/api/podcasts/shows/index.get.ts`
- Create: `server/api/podcasts/shows/[id]/index.get.ts`
- Create: `server/api/podcasts/shows/[id]/episodes.get.ts`

**Interfaces:**
- Consumes: `podcastVisibilityClause` (Task 1), `canAccessPodcastShow` (Task 1), `getUserFromSession` (existing).
- Produces:
  - `GET /api/podcasts/shows?search=<str>` → `{ shows: Array<{ id, title, author, cover_url, visibility, episode_count, completed_episode_count }> }`
  - `GET /api/podcasts/shows/:id` → `{ show: { id, title, description, author, cover_url, language, visibility } }`; 404 if missing, 403 if not permitted.
  - `GET /api/podcasts/shows/:id/episodes?limit=&offset=` → `{ episodes: Array<{ id, show_id, title, description, episode_number, season_number, duration, pub_date, download_status, local_file_path }>, total: number }`; 404/403 same as above.

- [ ] **Step 1: Create `server/api/podcasts/shows/index.get.ts`**

  ```ts
  import { defineEventHandler, getQuery } from 'h3';
  import { getUserFromSession } from '../../../utils/auth';
  import { podcastVisibilityClause } from '../../../utils/podcastVisibility';

  export default defineEventHandler(async (event) => {
    const session = await getUserFromSession(event);
    const db = getDb();

    const query = getQuery(event);
    const search = query.search ? String(query.search).trim() : null;

    const clauses: string[] = [];
    const params: any[] = [];

    const visClause = podcastVisibilityClause(session);
    if (visClause) {
      clauses.push(visClause);
    }

    if (search) {
      clauses.push('s.title LIKE ?');
      params.push(`%${search}%`);
    }

    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

    // LEFT JOIN (not music's INNER JOIN on completed tracks): a show whose
    // episodes are still downloading must stay visible in the grid, because
    // the episode list intentionally shows pending/downloading/failed rows
    // with a status badge. Both counts are returned so the UI can show the
    // total while still knowing how many are actually playable.
    const shows = db.prepare(`
      SELECT
        s.id,
        s.title,
        s.author,
        s.cover_url,
        s.visibility,
        COUNT(e.id) as episode_count,
        COUNT(CASE WHEN e.download_status = 'completed' THEN 1 END) as completed_episode_count
      FROM podcast_shows s
      LEFT JOIN podcast_episodes e ON e.show_id = s.id
      ${whereSql}
      GROUP BY s.id
      ORDER BY s.title ASC
    `).all(...params);

    return { shows };
  });
  ```

- [ ] **Step 2: Create `server/api/podcasts/shows/[id]/index.get.ts`**

  ```ts
  import { defineEventHandler, createError } from 'h3';
  import { canAccessPodcastShow } from '../../../../utils/auth';

  export default defineEventHandler(async (event) => {
    const showId = event.context.params?.id;

    if (!showId) {
      throw createError({ statusCode: 400, statusMessage: 'Show ID is required.' });
    }

    const db = getDb();

    const show = db.prepare(`
      SELECT id, title, description, author, cover_url, language, visibility
      FROM podcast_shows
      WHERE id = ?
    `).get(showId);

    if (!show) {
      throw createError({ statusCode: 404, statusMessage: 'Show not found.' });
    }

    const hasAccess = await canAccessPodcastShow(showId, event);
    if (!hasAccess) {
      throw createError({
        statusCode: 403,
        statusMessage: 'Access denied. You do not have permission to view this show.'
      });
    }

    return { show };
  });
  ```

- [ ] **Step 3: Create `server/api/podcasts/shows/[id]/episodes.get.ts`**

  ```ts
  import { defineEventHandler, createError, getQuery } from 'h3';
  import { canAccessPodcastShow } from '../../../../utils/auth';

  export default defineEventHandler(async (event) => {
    const showId = event.context.params?.id;

    if (!showId) {
      throw createError({ statusCode: 400, statusMessage: 'Show ID is required.' });
    }

    const db = getDb();

    const showExists = db.prepare('SELECT id FROM podcast_shows WHERE id = ?').get(showId);
    if (!showExists) {
      throw createError({ statusCode: 404, statusMessage: 'Show not found.' });
    }

    const hasAccess = await canAccessPodcastShow(showId, event);
    if (!hasAccess) {
      throw createError({
        statusCode: 403,
        statusMessage: 'Access denied. You do not have permission to view this show.'
      });
    }

    const query = getQuery(event);
    const limit = Math.min(200, Math.max(1, parseInt(String(query.limit ?? '50'), 10) || 50));
    const offset = Math.max(0, parseInt(String(query.offset ?? '0'), 10) || 0);

    const totalRow = db.prepare(`
      SELECT COUNT(*) as cnt FROM podcast_episodes WHERE show_id = ?
    `).get(showId) as { cnt: number };

    // Unlike music's tracks endpoint, this does NOT filter to
    // download_status = 'completed': the episode list deliberately surfaces
    // pending/downloading/failed episodes with a status badge.
    //
    // pub_date is TEXT (the raw RSS date string), so ordering on it directly
    // is unreliable across feeds — order by created_at DESC (ingestion order,
    // which follows feed order, newest first) with episode/season number as a
    // stable tiebreaker. "(x IS NULL) ASC" forces NULLs last regardless of the
    // primary column's sort direction.
    const episodes = db.prepare(`
      SELECT id, show_id, title, description, episode_number, season_number,
             duration, pub_date, download_status, local_file_path
      FROM podcast_episodes
      WHERE show_id = ?
      ORDER BY created_at DESC,
               (season_number IS NULL) ASC, season_number DESC,
               (episode_number IS NULL) ASC, episode_number DESC
      LIMIT ? OFFSET ?
    `).all(showId, limit, offset);

    return { episodes, total: totalRow.cnt };
  });
  ```

- [ ] **Step 4: Type-check and run the suite**

  ```bash
  npm test
  ```
  Expect all existing tests to still pass. (No automated tests for these routes — live API interactions are manually verified in Task 9, per the Global Constraints.)

- [ ] **Step 5: Commit**

  ```bash
  git add server/api/podcasts
  git commit -m "$(cat <<'EOF'
  feat: add public podcast shows/episodes read API routes

  GET /api/podcasts/shows (title search, visibility-filtered, with total and
  completed episode counts), GET /api/podcasts/shows/[id], and
  GET /api/podcasts/shows/[id]/episodes (paginated, all download statuses).
  Mirrors server/api/music/artists/*, minus the genre/language/year facets.

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 3: File-serving route `server/routes/downloads-podcasts/[...path].ts`

**Files:**
- Create: `server/routes/downloads-podcasts/[...path].ts`

**Interfaces:**
- Consumes: `canAccessPodcastEpisode` (Task 1), `getPodcastDownloadsDir` (existing, `server/utils/podcastDownloader.ts`), `sanitizeFolderName` (existing, `server/utils/downloader.ts`), `getDb` (auto-import).
- Produces: `GET /downloads-podcasts/{showDir}/{episodeId}.{ext}` — serves the episode's audio with `Accept-Ranges: bytes` + `206` Range support, or an image with `Last-Modified`/`304` handling. Fails closed with `400`/`403`/`404`.

- [ ] **Step 1: Create the route file**

  Create `server/routes/downloads-podcasts/[...path].ts` with exactly this content. It is a line-for-line adaptation of `server/routes/downloads-music/[...path].ts` — the audio Range branch and the non-audio `Last-Modified`/304 branch are reproduced verbatim; only the content-type maps, the DB lookup, the access check and the directory resolution differ.

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
    '.mp3': 'audio/mpeg',
    '.m4a': 'audio/mp4',
    '.ogg': 'audio/ogg',
    '.wav': 'audio/wav',
    '.opus': 'audio/opus',
    '.webm': 'audio/webm',
  };

  export default defineEventHandler(async (event) => {
    const filePath = event.context.params?.path;
    if (!filePath) {
      throw createError({ statusCode: 400, statusMessage: 'Invalid file path' });
    }

    // Files are always stored flat as {showDir}/{episodeId}.{ext} — exactly two
    // path segments, no nesting. See downloadEpisodeFile in podcastDownloader.ts.
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

    const episodeId = fileName.slice(0, fileName.length - ext.length);
    const db = getDb();

    const episode = db.prepare(`
      SELECT e.id, s.id as show_id, s.title as show_title
      FROM podcast_episodes e
      JOIN podcast_shows s ON e.show_id = s.id
      WHERE e.id = ? AND e.download_status = 'completed'
    `).get(episodeId) as { id: string; show_id: string; show_title: string } | undefined;

    if (!episode) {
      throw createError({ statusCode: 404, statusMessage: 'File not found' });
    }

    const hasAccess = await canAccessPodcastEpisode(episodeId, event);
    if (!hasAccess) {
      throw createError({ statusCode: 403, statusMessage: 'Accès refusé. Ce contenu est restreint.' });
    }

    // Resolve the show directory the same way downloadEpisodeFile built it —
    // sanitizeFolderName(show.title || showId) — rather than trusting the
    // stored local_file_path, which is a URL path, not a filesystem path.
    const downloadsDir = getPodcastDownloadsDir();
    const showDir = path.resolve(downloadsDir, sanitizeFolderName(episode.show_title || episode.show_id));
    const resolvedPath = path.resolve(showDir, fileName);

    // Containment check: resolvedPath must stay inside showDir.
    const relativeToShowDir = path.relative(showDir, resolvedPath);
    if (relativeToShowDir.startsWith('..') || path.isAbsolute(relativeToShowDir)) {
      throw createError({ statusCode: 403, statusMessage: 'Access denied' });
    }

    // Belt-and-braces: resolvedPath must also stay inside the overall podcast downloads dir.
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
      event.node.res.setHeader('Cache-Control', 'private, must-revalidate');
      event.node.res.setHeader('Last-Modified', stat.mtime.toUTCString());

      const ifModifiedSince = event.node.req.headers['if-modified-since'];
      if (ifModifiedSince) {
        const ifModifiedSinceDate = new Date(ifModifiedSince as string);
        if (!isNaN(ifModifiedSinceDate.getTime())) {
          const fileSeconds = Math.floor(stat.mtime.getTime() / 1000);
          const ifModifiedSinceSeconds = Math.floor(ifModifiedSinceDate.getTime() / 1000);
          if (fileSeconds <= ifModifiedSinceSeconds) {
            event.node.res.statusCode = 304;
            event.node.res.removeHeader?.('Content-Type');
            return null;
          }
        }
      }

      event.node.res.setHeader('Content-Length', stat.size);
      event.node.res.statusCode = 200;
      return fs.createReadStream(resolvedPath);
    }

    // Audio: support HTTP Range requests so the <audio> element can seek
    // without downloading the whole file — mirrors downloads-music's audio
    // branch verbatim. Range support matters more here than for music: podcast
    // episodes routinely run an hour or more.
    const fileSize = stat.size;
    const range = event.node.req.headers.range;

    event.node.res.setHeader('Accept-Ranges', 'bytes');
    event.node.res.setHeader('Content-Type', contentType);
    event.node.res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');

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

  Note on imports: `canAccessPodcastEpisode`, `getPodcastDownloadsDir`, `sanitizeFolderName` and `getDb` are all called with no import line — matching `downloads-music/[...path].ts`, which imports only `fs`, `path` and the `h3` helpers and relies on Nitro's server-utils auto-import for the rest.

- [ ] **Step 2: Run the suite**

  ```bash
  npm test
  ```
  Expect all existing tests to pass. No automated tests for this route (Global Constraints); it is verified live in Task 9, including a real Range request.

- [ ] **Step 3: Commit**

  ```bash
  git add server/routes/downloads-podcasts
  git commit -m "$(cat <<'EOF'
  feat: serve downloaded podcast audio with HTTP Range support

  New /downloads-podcasts/{showDir}/{episodeId}.{ext} route mirroring
  downloads-music: same fail-closed 404 for unknown extensions, same
  double path-containment guard, same 206/416 Range handling for audio and
  Last-Modified/304 handling for images. Show directory is re-derived with
  sanitizeFolderName(show.title || show.id) rather than trusting the stored
  local_file_path, which is a URL path.

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 4: `PATCH /api/admin/podcasts/episodes/[id]`

**Files:**
- Create: `server/api/admin/podcasts/episodes/[id].patch.ts`

**Interfaces:**
- Consumes: `requireAdmin` (existing).
- Produces: `PATCH /api/admin/podcasts/episodes/:id` accepting a JSON body with any subset of `{ title: string, description: string, episodeNumber: number | '' | null, seasonNumber: number | '' | null }`, returning `{ episode: { id, title, description, episode_number, season_number } }`.

  Field-name contract that Task 5's modal MUST match exactly: request body keys are camelCase (`title`, `description`, `episodeNumber`, `seasonNumber`); response keys are the raw snake_case DB columns nested under `episode`.

- [ ] **Step 1: Create the route file**

  Create `server/api/admin/podcasts/episodes/[id].patch.ts`, mirroring `server/api/admin/music/tracks/[id].patch.ts`'s structure, validation and auth exactly:
  ```ts
  import { defineEventHandler, readBody, createError } from 'h3';
  import { requireAdmin } from '../../../../utils/auth';

  export default defineEventHandler(async (event) => {
    await requireAdmin(event);

    const episodeId = event.context.params?.id;
    if (!episodeId) {
      throw createError({ statusCode: 400, statusMessage: 'Episode ID is required.' });
    }

    const db = getDb();

    const existing = db.prepare('SELECT id FROM podcast_episodes WHERE id = ?').get(episodeId);
    if (!existing) {
      throw createError({ statusCode: 404, statusMessage: 'Episode not found.' });
    }

    const body = await readBody(event);

    if (!body || typeof body !== 'object') {
      throw createError({ statusCode: 400, statusMessage: 'Request body must be a JSON object.' });
    }

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

    if (Object.prototype.hasOwnProperty.call(body, 'description')) {
      const description = typeof body.description === 'string' ? body.description.trim() : '';
      setClauses.push('description = ?');
      params.push(description || null);
    }

    if (Object.prototype.hasOwnProperty.call(body, 'episodeNumber')) {
      const raw = body.episodeNumber;
      let episodeNumber: number | null = null;
      if (raw !== '' && raw !== null && raw !== undefined) {
        const parsed = Number(raw);
        if (!Number.isInteger(parsed) || parsed <= 0) {
          throw createError({ statusCode: 400, statusMessage: 'episodeNumber must be a positive integer.' });
        }
        episodeNumber = parsed;
      }
      setClauses.push('episode_number = ?');
      params.push(episodeNumber);
    }

    if (Object.prototype.hasOwnProperty.call(body, 'seasonNumber')) {
      const raw = body.seasonNumber;
      let seasonNumber: number | null = null;
      if (raw !== '' && raw !== null && raw !== undefined) {
        const parsed = Number(raw);
        if (!Number.isInteger(parsed) || parsed <= 0) {
          throw createError({ statusCode: 400, statusMessage: 'seasonNumber must be a positive integer.' });
        }
        seasonNumber = parsed;
      }
      setClauses.push('season_number = ?');
      params.push(seasonNumber);
    }

    if (setClauses.length === 0) {
      throw createError({ statusCode: 400, statusMessage: 'No fields to update.' });
    }

    params.push(episodeId);
    db.prepare(`UPDATE podcast_episodes SET ${setClauses.join(', ')} WHERE id = ?`).run(...params);

    const updated = db.prepare('SELECT id, title, description, episode_number, season_number FROM podcast_episodes WHERE id = ?').get(episodeId);

    return { episode: updated };
  });
  ```

- [ ] **Step 2: Run the suite**

  ```bash
  npm test
  ```
  Expect all existing tests to pass.

- [ ] **Step 3: Commit**

  ```bash
  git add server/api/admin/podcasts/episodes
  git commit -m "$(cat <<'EOF'
  feat: add PATCH /api/admin/podcasts/episodes/[id]

  Admin-only per-episode metadata edit for title, description, episode_number
  and season_number. Mirrors admin/music/tracks/[id].patch.ts: hasOwnProperty
  gating so omitted fields are untouched, empty-string clears a nullable
  field, positive-integer validation on the numeric fields, 400 on an empty
  title, 404 on a missing episode.

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 5: `PodcastEpisodeEditModal.vue` + component tests

**Files:**
- Create: `app/components/PodcastEpisodeEditModal.vue`
- Test: `tests/component/PodcastEpisodeEditModal.test.ts`

**Interfaces:**
- Consumes: `PATCH /api/admin/podcasts/episodes/:id` (Task 4) with body `{ title, description, episodeNumber, seasonNumber }`; `BaseModal` (existing, props `show: boolean`, `title: string`, emits `close`); `useToast` (existing).
- Produces: component `PodcastEpisodeEditModal` with
  - props: `show: boolean`, `episode: { id: string; title: string; description: string | null; episode_number: number | null; season_number: number | null } | null`
  - emits: `close` (no payload), `saved` (payload = the updated episode object from the response's `episode` field).

  Task 7's page MUST pass `:episode` (not `:track`) and handle `@saved` with an object carrying snake_case `episode_number` / `season_number`.

- [ ] **Step 1: Write the failing test file**

  Create `tests/component/PodcastEpisodeEditModal.test.ts`:
  ```ts
  import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
  import { mountSuspended } from '@nuxt/test-utils/runtime';
  import PodcastEpisodeEditModal from '../../app/components/PodcastEpisodeEditModal.vue';

  const EPISODE = {
    id: 'ep-1',
    title: 'Pilot',
    description: 'The first one',
    episode_number: 3,
    season_number: 2
  };

  // The component calls the global $fetch that Nuxt injects. Stubbing the
  // global directly (rather than registerEndpoint) keeps the assertion on the
  // request body itself, which is the contract this modal owns.
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => ({
      episode: { id: 'ep-1', title: 'Renamed', description: 'The first one', episode_number: 3, season_number: 2 }
    }));
    vi.stubGlobal('$fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('PodcastEpisodeEditModal', () => {
    it('prefills every form field from the episode prop', async () => {
      const wrapper = await mountSuspended(PodcastEpisodeEditModal, {
        props: { show: true, episode: EPISODE }
      });
      expect((wrapper.find('#episode-edit-title').element as HTMLInputElement).value).toBe('Pilot');
      expect((wrapper.find('#episode-edit-description').element as HTMLTextAreaElement).value).toBe('The first one');
      expect((wrapper.find('#episode-edit-number').element as HTMLInputElement).value).toBe('3');
      expect((wrapper.find('#episode-edit-season').element as HTMLInputElement).value).toBe('2');
    });

    it('renders null episode_number/season_number/description as empty inputs, not "null"', async () => {
      const wrapper = await mountSuspended(PodcastEpisodeEditModal, {
        props: {
          show: true,
          episode: { id: 'ep-2', title: 'Untagged', description: null, episode_number: null, season_number: null }
        }
      });
      expect((wrapper.find('#episode-edit-description').element as HTMLTextAreaElement).value).toBe('');
      expect((wrapper.find('#episode-edit-number').element as HTMLInputElement).value).toBe('');
      expect((wrapper.find('#episode-edit-season').element as HTMLInputElement).value).toBe('');
    });

    it('re-prefills when the episode prop changes to a different episode', async () => {
      const wrapper = await mountSuspended(PodcastEpisodeEditModal, {
        props: { show: true, episode: EPISODE }
      });
      await wrapper.setProps({
        episode: { id: 'ep-9', title: 'Other', description: 'Second', episode_number: 11, season_number: null }
      });
      expect((wrapper.find('#episode-edit-title').element as HTMLInputElement).value).toBe('Other');
      expect((wrapper.find('#episode-edit-number').element as HTMLInputElement).value).toBe('11');
      expect((wrapper.find('#episode-edit-season').element as HTMLInputElement).value).toBe('');
    });

    it('PATCHes the camelCase body to the episode endpoint on submit', async () => {
      const wrapper = await mountSuspended(PodcastEpisodeEditModal, {
        props: { show: true, episode: EPISODE }
      });
      await wrapper.find('#episode-edit-title').setValue('Renamed');
      await wrapper.find('form').trigger('submit');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0]![0]).toBe('/api/admin/podcasts/episodes/ep-1');
      expect(fetchMock.mock.calls[0]![1]).toMatchObject({
        method: 'PATCH',
        body: {
          title: 'Renamed',
          description: 'The first one',
          episodeNumber: 3,
          seasonNumber: 2
        }
      });
    });

    it('emits "saved" with the episode object from the response', async () => {
      const wrapper = await mountSuspended(PodcastEpisodeEditModal, {
        props: { show: true, episode: EPISODE }
      });
      await wrapper.find('form').trigger('submit');
      await new Promise((r) => setTimeout(r, 0));

      const saved = wrapper.emitted('saved');
      expect(saved).toBeTruthy();
      expect(saved![0]![0]).toMatchObject({ id: 'ep-1', title: 'Renamed' });
    });

    it('does not emit "saved" and does not stay disabled when the request fails', async () => {
      fetchMock.mockRejectedValueOnce({ data: { statusMessage: 'Title cannot be empty.' } });
      const wrapper = await mountSuspended(PodcastEpisodeEditModal, {
        props: { show: true, episode: EPISODE }
      });
      await wrapper.find('form').trigger('submit');
      await new Promise((r) => setTimeout(r, 0));

      expect(wrapper.emitted('saved')).toBeFalsy();
      const submitBtn = wrapper.find('button[type="submit"]');
      expect(submitBtn.attributes('disabled')).toBeUndefined();
    });

    it('does nothing when submitted with a null episode prop', async () => {
      const wrapper = await mountSuspended(PodcastEpisodeEditModal, {
        props: { show: true, episode: null }
      });
      // BaseModal still renders its slot when show is true, so the form exists.
      await wrapper.find('form').trigger('submit');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('emits "close" when the Annuler button is clicked', async () => {
      const wrapper = await mountSuspended(PodcastEpisodeEditModal, {
        props: { show: true, episode: EPISODE }
      });
      await wrapper.find('button[type="button"]').trigger('click');
      expect(wrapper.emitted('close')).toBeTruthy();
    });
  });
  ```

- [ ] **Step 2: Verify the test fails for the right reason**

  ```bash
  npx vitest run tests/component/PodcastEpisodeEditModal.test.ts
  ```
  Expect a module-resolution failure (`Cannot find module .../app/components/PodcastEpisodeEditModal.vue`) — the component does not exist yet.

- [ ] **Step 3: Create `app/components/PodcastEpisodeEditModal.vue`**

  ```vue
  <template>
    <BaseModal :show="show" title="Modifier l'épisode" @close="$emit('close')">
      <form @submit.prevent="handleSubmit">
        <div class="form-group">
          <label for="episode-edit-title">Titre *</label>
          <input id="episode-edit-title" v-model="form.title" type="text" required class="form-input" />
        </div>
        <div class="form-group" style="margin-top: 16px;">
          <label for="episode-edit-number">N° d'épisode</label>
          <input id="episode-edit-number" v-model.number="form.episodeNumber" type="number" min="1" class="form-input" />
        </div>
        <div class="form-group" style="margin-top: 16px;">
          <label for="episode-edit-season">N° de saison</label>
          <input id="episode-edit-season" v-model.number="form.seasonNumber" type="number" min="1" class="form-input" />
        </div>
        <div class="form-group" style="margin-top: 16px;">
          <label for="episode-edit-description">Description</label>
          <textarea id="episode-edit-description" v-model="form.description" rows="5" class="form-input"></textarea>
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
    episode: { id: string; title: string; description: string | null; episode_number: number | null; season_number: number | null } | null;
  }>();

  const emit = defineEmits<{
    (e: 'close'): void;
    (e: 'saved', episode: any): void;
  }>();

  const toast = useToast();
  const saving = ref(false);
  const form = ref<{ title: string; description: string; episodeNumber: number | string; seasonNumber: number | string }>({
    title: '',
    description: '',
    episodeNumber: '',
    seasonNumber: ''
  });

  watch(
    () => props.episode,
    (ep) => {
      if (ep) {
        form.value = {
          title: ep.title || '',
          description: ep.description || '',
          episodeNumber: ep.episode_number ?? '',
          seasonNumber: ep.season_number ?? ''
        };
      }
    },
    { immediate: true }
  );

  async function handleSubmit() {
    if (!props.episode) return;
    saving.value = true;
    try {
      const data = await $fetch<any>(`/api/admin/podcasts/episodes/${props.episode.id}`, {
        method: 'PATCH',
        body: {
          title: form.value.title,
          description: form.value.description,
          episodeNumber: form.value.episodeNumber,
          seasonNumber: form.value.seasonNumber
        }
      });
      toast.success('Épisode mis à jour.');
      emit('saved', data.episode);
    } catch (e: any) {
      toast.error(e?.data?.statusMessage || "Erreur lors de la mise à jour de l'épisode.");
    } finally {
      saving.value = false;
    }
  }
  </script>
  ```

- [ ] **Step 4: Verify the tests pass**

  ```bash
  npx vitest run tests/component/PodcastEpisodeEditModal.test.ts
  ```
  Expect all 8 cases green. If the "does nothing when submitted with a null episode prop" case fails because `required` on the title input blocks submission in happy-dom, note that `trigger('submit')` on the `<form>` element bypasses native constraint validation in happy-dom — no change needed; investigate any other failure normally.

- [ ] **Step 5: Run the whole suite and commit**

  ```bash
  npm test
  ```
  Then:
  ```bash
  git add app/components/PodcastEpisodeEditModal.vue tests/component/PodcastEpisodeEditModal.test.ts
  git commit -m "$(cat <<'EOF'
  feat: add PodcastEpisodeEditModal with component tests

  BaseModal-wrapped form for title, episode number, season number and
  description, PATCHing /api/admin/podcasts/episodes/[id] with a camelCase
  body. Mirrors MusicTrackEditModal's watch-prefill/save/toast pattern.
  Eight mountSuspended tests cover prefill (including nulls rendering as
  empty), re-prefill on prop change, the request body shape, the saved
  emission, the failure path, the null-episode no-op and close.

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 6: Space-switcher entry + layout wiring

**Files:**
- Modify: `app/spaces/index.ts`
- Modify: `app/layouts/default.vue`

**Interfaces:**
- Consumes: the existing `Space` / `SpaceNavLink` interfaces (unchanged).
- Produces: a `podcasts` space with `homeRoute: '/podcasts'` and one nav link to `/podcasts`, always visible; `activeSpace` resolves to it for any route under `/podcasts`.

- [ ] **Step 1: Add the podcasts space to `app/spaces/index.ts`**

  Open `app/spaces/index.ts`. The `spaces` array currently ends with the `music` entry and its closing `},` at line 68, followed by `];`. Insert a third entry between them, so the array reads `[video, music, podcasts]`:
  ```ts
    {
      id: 'podcasts',
      label: 'Podcasts',
      icon: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>',
      homeRoute: '/podcasts',
      navLinks: [
        {
          to: '/podcasts',
          label: 'Bibliothèque',
          icon: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>',
          hideWhenMustChangePassword: true,
        },
      ],
    },
  ```
  (The icon is a Feather-style microphone, matching the stroke/width conventions of every other icon in this file.)

- [ ] **Step 2: Teach `activeSpace` about `/podcasts`**

  Open `app/layouts/default.vue`. Replace this block (lines 145-147):
  ```ts
  const activeSpace = computed(() =>
    (route.path.startsWith('/music') ? spaces.find((s) => s.id === 'music') : spaces.find((s) => s.id === 'video')) ?? spaces[0]!
  );
  ```
  with:
  ```ts
  const activeSpace = computed(() => {
    if (route.path.startsWith('/music')) return spaces.find((s) => s.id === 'music') ?? spaces[0]!;
    if (route.path.startsWith('/podcasts')) return spaces.find((s) => s.id === 'podcasts') ?? spaces[0]!;
    return spaces.find((s) => s.id === 'video') ?? spaces[0]!;
  });
  ```
  Without this, `/podcasts` would render with the Vidéo space's label and sidebar links — adding the space to the array alone is not enough.

  **Do not touch `visibleSpaces`.** Its existing predicate (`s.id !== 'music' || musicModuleEnabled.value || isAdmin.value`) already lets every non-music space through unconditionally, which is exactly the "always visible, no gate" behavior the Global Constraints require. Adding no podcast branch there is the correct, deliberate outcome.

- [ ] **Step 3: Run the suite**

  ```bash
  npm test
  ```
  Expect all existing tests to pass.

- [ ] **Step 4: Commit**

  ```bash
  git add app/spaces/index.ts app/layouts/default.vue
  git commit -m "$(cat <<'EOF'
  feat: add the Podcasts space to the header space-switcher

  New spaces[] entry (mic icon, homeRoute /podcasts, one "Bibliothèque" nav
  link) plus a /podcasts branch in the layout's activeSpace computed, so the
  sidebar and switcher label follow the route. No module gate — the space is
  unconditionally visible, per this sub-project's scope.

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 7: Catalog page `app/pages/podcasts/index.vue`

**Files:**
- Create: `app/pages/podcasts/index.vue`

**Interfaces:**
- Consumes: `GET /api/podcasts/shows` (+ `search`), `GET /api/podcasts/shows/:id`, `GET /api/podcasts/shows/:id/episodes` (Task 2); `PodcastEpisodeEditModal` props `show` / `episode` and its `saved` payload (Task 5); `EmptyState` (existing); `useAuth().isAdmin` (existing).
- Produces: the `/podcasts` route — grid view when there is no `?showId=`, episode-list detail view when there is.

- [ ] **Step 1: Create the page**

  Create `app/pages/podcasts/index.vue`. It mirrors `app/pages/music/index.vue`'s grid/detail-via-query-param structure, request-id guards on every async fetch, and per-page formatter convention — minus the facets, playlists, player and album grouping.

  ```vue
  <template>
    <div class="podcasts-page">
      <!-- GRID VIEW -->
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

      <!-- DETAIL VIEW -->
      <div v-else class="show-detail-view">
        <button @click="goBack" class="btn btn-secondary back-btn">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
          Podcasts
        </button>

        <div v-if="detailPending" class="podcast-loading">Chargement...</div>
        <div v-else-if="detailError" class="podcast-error">Podcast introuvable ou accès refusé.</div>

        <template v-else-if="show">
          <div class="show-detail-header">
            <img :src="show.cover_url || fallbackCover" @error="handleCoverError" class="show-detail-cover" alt="" />
            <div class="show-detail-info">
              <div class="title-row" style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
                <h1 class="show-detail-title">{{ show.title }}</h1>
                <span v-if="isAdmin" class="badge" :class="getVisBadgeClass(show.visibility)">{{ formatVisibility(show.visibility) }}</span>
              </div>
              <p v-if="show.author" class="show-detail-author">{{ show.author }}</p>
              <p v-if="show.description" class="show-detail-desc">{{ show.description }}</p>
            </div>
          </div>

          <EmptyState
            v-if="episodes.length === 0 && !episodesLoading"
            icon="music"
            title="Aucun épisode"
            description="Aucun épisode pour ce podcast pour l'instant."
          />

          <div v-else class="episode-list">
            <div v-for="ep in episodes" :key="ep.id" class="episode-row">
              <div class="episode-main">
                <h4 class="episode-title">{{ ep.title }}</h4>
                <p class="episode-meta">
                  <span v-if="ep.season_number">S{{ ep.season_number }}</span>
                  <span v-if="ep.episode_number">E{{ ep.episode_number }}</span>
                  <span v-if="ep.pub_date">{{ formatPubDate(ep.pub_date) }}</span>
                  <span>{{ formatDuration(ep.duration) }}</span>
                </p>
              </div>
              <span class="badge" :class="getStatusBadgeClass(ep.download_status)">{{ formatStatus(ep.download_status) }}</span>
              <button v-if="isAdmin" @click.stop="openEpisodeEdit(ep)" class="edit-btn" title="Modifier">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"></path></svg>
              </button>
            </div>

            <div v-if="episodesLoading" class="podcast-loading">Chargement...</div>
            <div v-if="episodesError" class="podcast-error">
              Erreur lors du chargement des épisodes.
              <button @click="loadEpisodes" class="btn btn-secondary load-more-btn">Réessayer</button>
            </div>
            <button
              v-if="episodes.length < episodesTotal"
              @click="loadEpisodes"
              :disabled="episodesLoading"
              class="btn btn-secondary load-more-btn"
            >
              Charger plus
            </button>
          </div>
        </template>
      </div>

      <PodcastEpisodeEditModal
        :show="!!editingEpisode"
        :episode="editingEpisode"
        @close="closeEpisodeEdit"
        @saved="handleEpisodeSaved"
      />
    </div>
  </template>

  <script setup lang="ts">
  import { ref, computed, watch, onMounted } from 'vue';
  import { useRoute, useRouter } from 'vue-router';
  import { useAuth } from '~/composables/useAuth';

  const { isAdmin } = useAuth();
  const route = useRoute();
  const router = useRouter();

  const showId = computed(() => (route.query.showId ? String(route.query.showId) : ''));

  // --- Grid view state ---
  const search = ref('');
  const shows = ref<any[]>([]);
  const gridPending = ref(true);
  const gridError = ref(false);

  let showsRequestId = 0;

  async function fetchShows() {
    const requestId = ++showsRequestId;
    gridPending.value = true;
    gridError.value = false;
    try {
      const params: Record<string, string> = {};
      if (search.value) params.search = search.value;
      const data = await $fetch<any>('/api/podcasts/shows', { params });
      if (requestId !== showsRequestId) return;
      shows.value = data.shows || [];
    } catch (e) {
      if (requestId !== showsRequestId) return;
      shows.value = [];
      gridError.value = true;
    } finally {
      if (requestId !== showsRequestId) return;
      gridPending.value = false;
    }
  }

  let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  watch(search, () => {
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => fetchShows(), 300);
  });

  // --- Detail view state ---
  const show = ref<any>(null);
  const episodes = ref<any[]>([]);
  const episodesTotal = ref(0);
  const episodesLoading = ref(false);
  const episodesError = ref(false);
  const detailPending = ref(false);
  const detailError = ref(false);

  let detailRequestId = 0;

  async function fetchShowDetail() {
    const requestId = ++detailRequestId;
    detailPending.value = true;
    detailError.value = false;
    show.value = null;
    episodes.value = [];
    episodesTotal.value = 0;
    episodesError.value = false;
    try {
      const data = await $fetch<any>(`/api/podcasts/shows/${showId.value}`);
      if (requestId !== detailRequestId) return;
      show.value = data.show;
    } catch (e) {
      if (requestId !== detailRequestId) return;
      detailError.value = true;
      detailPending.value = false;
      return;
    }
    detailPending.value = false;
    await loadEpisodes();
  }

  async function loadEpisodes() {
    if (!showId.value) return;
    const requestId = detailRequestId;
    episodesLoading.value = true;
    episodesError.value = false;
    try {
      const data = await $fetch<any>(`/api/podcasts/shows/${showId.value}/episodes`, {
        params: { limit: 50, offset: episodes.value.length }
      });
      if (requestId !== detailRequestId) return;
      episodes.value.push(...(data.episodes || []));
      episodesTotal.value = data.total || 0;
    } catch (e) {
      if (requestId !== detailRequestId) return;
      episodesError.value = true;
    } finally {
      if (requestId !== detailRequestId) return;
      episodesLoading.value = false;
    }
  }

  function goBack() {
    router.push('/podcasts');
  }

  // --- Episode editing ---
  const editingEpisode = ref<any | null>(null);

  function openEpisodeEdit(episode: any) {
    editingEpisode.value = episode;
  }

  function closeEpisodeEdit() {
    editingEpisode.value = null;
  }

  function handleEpisodeSaved(updated: any) {
    const existing = episodes.value.find((e: any) => e.id === updated.id);
    if (existing) Object.assign(existing, updated);
    closeEpisodeEdit();
  }

  watch(showId, (newId, oldId) => {
    if (newId && newId !== oldId) {
      fetchShowDetail();
    } else if (!newId && oldId) {
      fetchShows();
    }
  });

  onMounted(() => {
    if (showId.value) {
      fetchShowDetail();
    } else {
      fetchShows();
    }
  });

  // --- Shared formatters (duplicated per-page, matching this codebase's
  // existing convention — see music/index.vue, channels.vue, watch/[id].vue,
  // none of which share a formatting util module) ---
  const fallbackCover = 'data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%23666\' stroke-width=\'1.5\'><path d=\'M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z\'></path><path d=\'M19 10v2a7 7 0 0 1-14 0v-2\'></path><line x1=\'12\' y1=\'19\' x2=\'12\' y2=\'23\'></line><line x1=\'8\' y1=\'23\' x2=\'16\' y2=\'23\'></line></svg>';

  const handleCoverError = (event: Event) => {
    const target = event.target as HTMLImageElement;
    if (target && target.src !== fallbackCover) {
      target.src = fallbackCover;
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

  // pub_date is the raw RSS date string (TEXT), so it may be unparseable —
  // fall back to showing it verbatim rather than "Invalid Date".
  const formatPubDate = (raw: string | null): string => {
    if (!raw) return '';
    const d = new Date(raw);
    if (isNaN(d.getTime())) return raw;
    return d.toLocaleDateString('fr-FR', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  const formatStatus = (status: string): string => {
    switch (status) {
      case 'completed': return 'Téléchargé';
      case 'downloading': return 'En cours';
      case 'pending': return 'En attente';
      case 'failed': return 'Échec';
      default: return status || 'En attente';
    }
  };

  const getStatusBadgeClass = (status: string): string => {
    switch (status) {
      case 'completed': return 'badge-completed';
      case 'downloading': return 'badge-downloading';
      case 'failed': return 'badge-failed';
      default: return 'badge-pending';
    }
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
  .podcast-filters-bar {
    display: flex;
    gap: 12px;
    margin-bottom: 24px;
    flex-wrap: wrap;
  }

  .podcast-search-input {
    flex: 1;
    min-width: 200px;
  }

  .podcast-loading,
  .podcast-error {
    padding: 40px;
    text-align: center;
    color: var(--text-secondary);
  }

  .show-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 20px;
  }

  .show-card {
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

  .show-card:hover {
    transform: translateY(-4px);
    border-color: rgba(139, 92, 246, 0.3);
    box-shadow: 0 12px 32px rgba(139, 92, 246, 0.15);
  }

  .show-card-cover {
    width: 120px;
    height: 120px;
    border-radius: var(--border-radius-md);
    object-fit: cover;
    margin-bottom: 12px;
  }

  .show-card-title {
    font-size: 15px;
    font-weight: 600;
    margin-bottom: 4px;
  }

  .show-card-meta {
    font-size: 13px;
    color: var(--text-secondary);
    margin-bottom: 8px;
  }

  .back-btn {
    margin-bottom: 20px;
  }

  .show-detail-header {
    display: flex;
    gap: 20px;
    align-items: flex-start;
    margin-bottom: 32px;
  }

  .show-detail-cover {
    width: 140px;
    height: 140px;
    border-radius: var(--border-radius-md);
    object-fit: cover;
    flex-shrink: 0;
  }

  .show-detail-title {
    font-size: 24px;
    font-weight: 700;
  }

  .show-detail-author {
    color: var(--text-secondary);
    font-size: 14px;
    margin-top: 2px;
  }

  .show-detail-desc {
    color: var(--text-secondary);
    margin-top: 8px;
    max-width: 720px;
    line-height: 1.5;
  }

  .episode-list {
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-lg);
    padding: 8px 16px 16px;
  }

  .episode-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    font-size: 14px;
  }

  .episode-row:last-child {
    border-bottom: none;
  }

  .episode-main {
    flex: 1;
    min-width: 0;
  }

  .episode-title {
    font-size: 14px;
    font-weight: 600;
  }

  .episode-meta {
    display: flex;
    gap: 10px;
    font-size: 12px;
    color: var(--text-secondary);
    margin-top: 2px;
  }

  .load-more-btn {
    margin-top: 12px;
  }

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
  }

  .edit-btn:hover {
    color: var(--text-primary);
  }
  </style>
  ```

  Note: `EmptyState`'s `icon` prop has no `podcast` variant and adding one would mean touching `EmptyState.vue` and its existing tests — out of scope, so `icon="music"` is used (the closest audio variant).

- [ ] **Step 2: Run the suite**

  ```bash
  npm test
  ```
  Expect all existing tests (including Task 5's) to pass. This page has no automated tests: its logic is entirely live-API-driven, which the Global Constraints route to Task 9's manual verification.

- [ ] **Step 3: Commit**

  ```bash
  git add app/pages/podcasts
  git commit -m "$(cat <<'EOF'
  feat: add the /podcasts catalog page

  Shows grid with debounced server-side title search, swapping to an
  episode-list detail view via ?showId= — the same query-param pattern
  /music uses for ?artistId=, with the same request-id guards on every
  async fetch. Episode rows carry a download-status badge and, for admins,
  an edit affordance opening PodcastEpisodeEditModal.

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 8: `usePodcastQueue` + `SettingsPodcastsTab.vue` + settings wiring

**Files:**
- Create: `app/composables/usePodcastQueue.ts`
- Create: `app/components/settings/SettingsPodcastsTab.vue`
- Modify: `app/pages/settings.vue`

**Interfaces:**
- Consumes (all 11 pre-existing admin routes, unchanged):
  - `GET /api/admin/podcasts/queue` → `{ queue, history, shows, isPaused, failedCount }`
  - `POST /api/admin/podcasts/ingest` body `{ feedUrl, sync_status?, visibility? }` → `{ success, message, count }`
  - `POST /api/admin/podcasts/pause` / `POST /api/admin/podcasts/resume` → `{ success: true }`
  - `GET /api/admin/podcasts/concurrency` → `{ maxConcurrentDownloads }`; `POST` same path, body `{ maxConcurrentDownloads }`
  - `GET /api/admin/podcasts/schedule` → `{ enabled, schedule }`; `POST` same path, body `{ enabled, schedule }`
  - `POST /api/admin/podcasts/retry-failed`, optional body `{ episodeId }`
  - `POST /api/admin/podcasts/shows/:id/sync`, `POST /api/admin/podcasts/shows/:id/pause`
- Produces: `usePodcastQueue()` returning `{ podcastQueue, podcastHistory, podcastShows, podcastIsPaused, podcastFailedCount, podcastActiveDownloadCount, fetchPodcastQueue }`.

- [ ] **Step 1: Create `app/composables/usePodcastQueue.ts`**

  Mirrors `useMusicQueue.ts`, with `data.shows` instead of `data.artists` (the podcast queue route returns `shows`):
  ```ts
  export function usePodcastQueue() {
    const podcastQueue = useState<any[]>('settings_podcast_queue', () => []);
    const podcastHistory = useState<any[]>('settings_podcast_history', () => []);
    const podcastShows = useState<any[]>('settings_podcast_shows', () => []);
    const podcastIsPaused = useState<boolean>('settings_podcast_is_paused', () => false);
    const podcastFailedCount = useState<number>('settings_podcast_failed_count', () => 0);

    const podcastActiveDownloadCount = computed(() => {
      return podcastQueue.value.filter((e: any) => e.download_status === 'downloading').length;
    });

    const fetchPodcastQueue = async () => {
      try {
        const data = await $fetch<any>('/api/admin/podcasts/queue');
        podcastQueue.value = data.queue || [];
        podcastHistory.value = data.history || [];
        podcastShows.value = data.shows || [];
        podcastIsPaused.value = data.isPaused || false;
        podcastFailedCount.value = data.failedCount || 0;
      } catch (err) {
        console.error('Failed to fetch podcast queue:', err);
      }
    };

    return {
      podcastQueue, podcastHistory, podcastShows, podcastIsPaused, podcastFailedCount, podcastActiveDownloadCount,
      fetchPodcastQueue,
    };
  }
  ```

- [ ] **Step 2: Create `app/components/settings/SettingsPodcastsTab.vue`**

  Mirrors `SettingsMusicTab.vue` minus the two module/clips toggle panels (no module gate in this sub-project, no clips concept for podcasts) and minus the per-card Cancel button (no cancel route exists — see Prerequisite discrepancy #4).

  ```vue
  <template>
    <div class="tab-pane">
      <div class="downloads-header-panel glass-panel">
        <div class="header-text">
          <h2>Podcast Ingestion</h2>
          <p>Follow podcast RSS feeds. Episode audio is downloaded straight from each item's enclosure — no re-encoding.</p>
        </div>

        <div class="queue-actions-row">
          <button
            @click="togglePodcastPause"
            class="btn"
            :class="podcastIsPaused ? 'btn-primary-glow' : 'btn-secondary-dark'"
            :disabled="pausingOrResumingPodcast"
          >
            <svg v-if="podcastIsPaused" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
            <svg v-else xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-2"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>
            <span>{{ podcastIsPaused ? 'Resume Podcast Sync' : 'Pause Podcast Sync' }}</span>
          </button>

          <div class="concurrency-control" style="display: inline-flex; align-items: center; gap: 8px;">
            <label for="max-concurrent-podcast-downloads" style="font-size: 13px; color: var(--text-secondary);">Max concurrent downloads</label>
            <input
              id="max-concurrent-podcast-downloads"
              type="number"
              min="1"
              v-model.number="maxConcurrentPodcastDownloads"
              class="form-input"
              style="width: 64px;"
            />
            <button @click="handleSavePodcastConcurrency" class="btn btn-secondary-dark btn-sm" :disabled="savingPodcastConcurrency">
              {{ savingPodcastConcurrency ? 'Saving...' : 'Save' }}
            </button>
          </div>

          <button v-if="podcastFailedCount > 0" @click="handleRetryAllPodcastFailed" class="btn btn-secondary-dark" :disabled="retryingPodcastFailed">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"></path></svg>
            <span>Retry {{ podcastFailedCount }} Failed</span>
          </button>
        </div>

        <form @submit.prevent="handleSavePodcastSchedule" class="policy-form-block mt-3 pt-3 border-t">
          <div class="form-group">
            <label class="checkbox-container">
              <input type="checkbox" v-model="podcastScheduleForm.enabled" />
              <span class="checkmark"></span>
              Enable background feed resync automation
            </label>
          </div>

          <div v-if="podcastScheduleForm.enabled" class="schedule-settings-row mt-2">
            <div class="form-group flex-1">
              <label class="form-label" for="podcast-preset">Preset Interval</label>
              <select id="podcast-preset" v-model="podcastScheduleForm.preset" @change="applyPodcastPreset" class="form-select">
                <option value="hourly">Hourly (Every hour)</option>
                <option value="twelve_hours">Every 12 hours</option>
                <option value="daily">Daily (resync at 4:00 AM)</option>
                <option value="weekly">Weekly (Sunday at 4:00 AM)</option>
                <option value="custom">Custom Cron Expression</option>
              </select>
            </div>

            <div class="form-group flex-1" v-if="podcastScheduleForm.preset === 'custom'">
              <label class="form-label" for="podcast-cron">Cron Expression</label>
              <input type="text" id="podcast-cron" v-model="podcastScheduleForm.schedule" class="form-input" placeholder="*/30 * * * *" required />
            </div>
          </div>

          <div class="form-actions mt-3">
            <button type="submit" class="btn btn-secondary-dark" :disabled="savingPodcastSchedule">
              {{ savingPodcastSchedule ? 'Saving...' : 'Save Sync Trigger' }}
            </button>
          </div>
        </form>
        <div v-if="podcastScheduleMessage" class="settings-form-msg mt-3 settings-success-msg">
          {{ podcastScheduleMessage }}
        </div>
      </div>

      <div class="downloads-dashboard-layout">
        <!-- Left Side: Add feed + followed shows -->
        <div class="downloads-main-col">
          <div class="ingest-box glass-panel">
            <div class="section-title-row">
              <div class="icon-orb bg-purple">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>
              </div>
              <div>
                <h3>Track a Podcast</h3>
                <p class="section-desc">Paste an RSS feed URL.</p>
              </div>
            </div>

            <form @submit.prevent="handleAddPodcastShow" class="ingest-form mt-3">
              <div class="search-input-wrapper">
                <input
                  type="text"
                  v-model="podcastFeedInput"
                  placeholder="https://example.com/feed.xml"
                  class="form-input settings-search-input"
                  required
                  :disabled="addingPodcastShow"
                />
              </div>
              <select v-model="podcastShowVisibility" class="form-select" :disabled="addingPodcastShow">
                <option value="">Keep current (Public if new)</option>
                <option value="public">Public</option>
                <option value="private">Private</option>
                <option value="ultra_private">Ultra Private</option>
              </select>
              <button type="submit" class="btn btn-primary" :disabled="addingPodcastShow">
                <span v-if="addingPodcastShow">Adding...</span>
                <span v-else>Add Podcast</span>
              </button>
            </form>

            <div class="form-group mt-2">
              <label class="checkbox-container">
                <input type="checkbox" v-model="podcastAutoSync" :disabled="addingPodcastShow" />
                <span class="checkmark"></span>
                Sync automatically (start downloading right away)
              </label>
            </div>

            <div v-if="podcastIngestMessage" class="settings-form-msg mt-3" :class="podcastIngestSuccess ? 'settings-success-msg' : 'settings-error-msg'">
              {{ podcastIngestMessage }}
            </div>
          </div>

          <div class="ingest-box glass-panel mt-4">
            <div class="section-title-row">
              <div class="icon-orb bg-blue">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>
              </div>
              <div>
                <h3>Followed Podcasts</h3>
                <p class="section-desc">{{ podcastShows.length }} show(s) tracked.</p>
              </div>
            </div>

            <div v-if="podcastShows.length === 0" class="mt-3">
              <p class="section-desc">No podcasts followed yet.</p>
            </div>
            <div v-else class="search-results-grid mt-3">
              <div v-for="s in podcastShows" :key="s.id" class="search-channel-card">
                <img
                  :src="s.cover_url || '/img/default-avatar.png'"
                  class="channel-avatar-thumb"
                  referrerpolicy="no-referrer"
                  @error="($event) => { const target = $event.target as HTMLImageElement; if (target) { target.src = '/img/default-avatar.png'; } }"
                />
                <div class="channel-search-info">
                  <h5>{{ s.title }}</h5>
                  <p class="channel-search-meta">
                    <span>{{ formatStatus(s.sync_status) }}</span>
                    <span class="meta-dot">•</span>
                    <span>{{ s.visibility }}</span>
                    <span class="meta-dot">•</span>
                    <span>{{ s.episode_count }} episode(s)</span>
                  </p>
                </div>
                <button
                  @click="handleSyncPodcastShow(s.id)"
                  class="btn btn-primary btn-xs"
                  :disabled="syncingShowId === s.id"
                >
                  {{ syncingShowId === s.id ? 'Syncing...' : 'Sync' }}
                </button>
                <button
                  v-if="s.sync_status === 'downloading'"
                  @click="handlePausePodcastShow(s.id)"
                  class="btn btn-secondary btn-xs"
                  :disabled="pausingShowId === s.id"
                >
                  {{ pausingShowId === s.id ? 'Pausing...' : 'Pause' }}
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Right Side: Queue -->
        <div class="downloads-side-col">
          <div class="queue-box glass-panel">
            <div class="queue-header-row">
              <div class="flex-align-center gap-10">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--accent-secondary);"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>
                <h3 style="margin: 0; font-size: 15px; font-weight: 700;">Podcast Queue</h3>
              </div>
              <span :class="podcastIsPaused ? 'badge-paused-global' : 'badge-active-global'">
                {{ podcastIsPaused ? 'Suspended' : 'Active' }}
              </span>
            </div>

            <div v-if="podcastQueue.length === 0" class="queue-empty-state">
              <h4>Podcast Pipeline Idle</h4>
              <p>Queue is empty.</p>
            </div>
            <div v-else class="queue-list-premium">
              <div v-for="ep in podcastQueue" :key="ep.id" class="queue-card-premium">
                <div class="queue-card-details">
                  <div class="queue-card-meta-main">
                    <h4 class="queue-card-title" :title="ep.title">{{ ep.title }}</h4>
                    <span class="queue-card-channel-name">{{ ep.show_title }}</span>
                  </div>
                  <span class="status-badge" :class="`status-${ep.download_status}`">
                    {{ formatStatus(ep.download_status) }}
                  </span>
                </div>

                <div class="queue-progress-container">
                  <div class="progress-bar-glow-bg">
                    <div
                      class="progress-bar-glow-fill"
                      :style="{ width: (ep.download_progress || 0) + '%' }"
                    ></div>
                  </div>
                  <span class="progress-percent-text">{{ Math.round(ep.download_progress || 0) }}%</span>
                </div>

                <div class="queue-diagnostics-row" v-if="ep.download_status === 'downloading'">
                  <span v-if="ep.download_speed" class="diag-meta-spec">Speed: {{ ep.download_speed }}</span>
                  <span v-if="ep.download_eta" class="diag-meta-spec">ETA: {{ ep.download_eta }}</span>
                </div>

                <div class="queue-error-box" v-if="ep.download_status === 'failed' && ep.last_error">
                  <strong>Log:</strong> {{ ep.last_error }}
                </div>

                <!-- No Cancel action: unlike music, the podcast admin API has no
                     per-episode cancel route, and adding one is out of scope for
                     this sub-project. Failed episodes get a single-episode retry. -->
                <div class="queue-card-action-bar" v-if="ep.download_status === 'failed'">
                  <button
                    @click="handleRetryPodcastEpisode(ep.id)"
                    class="btn-action-premium"
                  >
                    Retry
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </template>

  <script setup lang="ts">
  import { ref, reactive, onMounted } from 'vue';
  import { useToast } from '~/composables/useToast';
  import { usePodcastQueue } from '~/composables/usePodcastQueue';

  const toast = useToast();
  const { podcastQueue, podcastShows, podcastIsPaused, podcastFailedCount, fetchPodcastQueue } = usePodcastQueue();

  const retryingPodcastFailed = ref(false);
  const pausingOrResumingPodcast = ref(false);
  const maxConcurrentPodcastDownloads = ref(2);
  const savingPodcastConcurrency = ref(false);
  const podcastFeedInput = ref('');
  const podcastShowVisibility = ref('');
  const podcastAutoSync = ref(true);
  const addingPodcastShow = ref(false);
  const podcastIngestMessage = ref('');
  const podcastIngestSuccess = ref(false);
  const syncingShowId = ref<string | null>(null);
  const pausingShowId = ref<string | null>(null);

  const togglePodcastPause = async () => {
    pausingOrResumingPodcast.value = true;
    try {
      const endpoint = podcastIsPaused.value ? '/api/admin/podcasts/resume' : '/api/admin/podcasts/pause';
      await $fetch(endpoint, { method: 'POST' });
      podcastIsPaused.value = !podcastIsPaused.value;
      toast.success(podcastIsPaused.value ? 'Podcast downloads paused.' : 'Podcast downloads resumed.');
      fetchPodcastQueue();
    } catch (err: any) {
      toast.error(err.data?.statusMessage || 'An error occurred.');
    } finally {
      pausingOrResumingPodcast.value = false;
    }
  };

  const fetchPodcastConcurrency = async () => {
    try {
      const data = await $fetch<any>('/api/admin/podcasts/concurrency');
      maxConcurrentPodcastDownloads.value = data.maxConcurrentDownloads ?? 2;
    } catch (err) {
      console.error('Failed to fetch podcast concurrency setting:', err);
    }
  };

  const handleSavePodcastConcurrency = async () => {
    savingPodcastConcurrency.value = true;
    try {
      await $fetch('/api/admin/podcasts/concurrency', {
        method: 'POST',
        body: { maxConcurrentDownloads: maxConcurrentPodcastDownloads.value }
      });
      toast.success('Podcast concurrency setting saved.');
    } catch (err: any) {
      toast.error(err.data?.statusMessage || 'Failed to save podcast concurrency setting.');
    } finally {
      savingPodcastConcurrency.value = false;
    }
  };

  const savingPodcastSchedule = ref(false);
  const podcastScheduleMessage = ref('');

  const podcastScheduleForm = reactive({
    enabled: false,
    preset: 'daily',
    schedule: '0 4 * * *'
  });

  // 'daily'/'weekly' use 4:00 AM here (not music's 3:30 AM) to match the
  // podcast_sync_cron_schedule default already seeded in db.ts: '0 4 * * *'.
  const podcastPresets: Record<string, string> = {
    hourly: '0 * * * *',
    twelve_hours: '0 */12 * * *',
    daily: '0 4 * * *',
    weekly: '0 4 * * 0'
  };

  const applyPodcastPreset = () => {
    if (podcastScheduleForm.preset !== 'custom') {
      podcastScheduleForm.schedule = podcastPresets[podcastScheduleForm.preset] || '0 4 * * *';
    }
  };

  const fetchPodcastSchedule = async () => {
    try {
      const data = await $fetch<any>('/api/admin/podcasts/schedule');
      podcastScheduleForm.enabled = data.enabled;
      podcastScheduleForm.schedule = data.schedule || '0 4 * * *';

      const foundPreset = Object.keys(podcastPresets).find(k => podcastPresets[k] === podcastScheduleForm.schedule);
      podcastScheduleForm.preset = foundPreset || 'custom';
    } catch (err) {
      console.error('Failed to fetch podcast schedule:', err);
    }
  };

  const handleSavePodcastSchedule = async () => {
    savingPodcastSchedule.value = true;
    podcastScheduleMessage.value = '';
    try {
      await $fetch('/api/admin/podcasts/schedule', {
        method: 'POST',
        body: {
          enabled: podcastScheduleForm.enabled,
          schedule: podcastScheduleForm.schedule
        }
      });
      podcastScheduleMessage.value = 'Podcast synchronization frequency saved successfully.';
    } catch (err: any) {
      toast.error(err.data?.statusMessage || 'Save failed.');
    } finally {
      savingPodcastSchedule.value = false;
    }
  };

  const handleAddPodcastShow = async () => {
    const feedUrl = podcastFeedInput.value.trim();
    if (!feedUrl) return;

    addingPodcastShow.value = true;
    podcastIngestMessage.value = '';
    try {
      const res = await $fetch<any>('/api/admin/podcasts/ingest', {
        method: 'POST',
        body: {
          feedUrl,
          sync_status: podcastAutoSync.value ? 'downloading' : 'paused',
          ...(podcastShowVisibility.value ? { visibility: podcastShowVisibility.value } : {})
        }
      });
      podcastIngestSuccess.value = res.success;
      podcastIngestMessage.value = res.message;
      podcastFeedInput.value = '';
      toast.success('Podcast added.');
      fetchPodcastQueue();
    } catch (err: any) {
      // ingest.post.ts deliberately returns a single generic message for every
      // failure (sub-project 2's error-message-leakage fix) — surface it as-is.
      podcastIngestSuccess.value = false;
      podcastIngestMessage.value = err.data?.statusMessage || 'Failed to add podcast.';
      toast.error('Error adding podcast.');
    } finally {
      addingPodcastShow.value = false;
    }
  };

  const handleSyncPodcastShow = async (showId: string) => {
    syncingShowId.value = showId;
    try {
      await $fetch(`/api/admin/podcasts/shows/${showId}/sync`, { method: 'POST' });
      toast.success('Podcast sync started.');
      setTimeout(() => fetchPodcastQueue(), 3000);
    } catch (err: any) {
      toast.error(err.data?.statusMessage || 'Failed to sync podcast.');
    } finally {
      syncingShowId.value = null;
    }
  };

  const handlePausePodcastShow = async (showId: string) => {
    pausingShowId.value = showId;
    try {
      await $fetch(`/api/admin/podcasts/shows/${showId}/pause`, { method: 'POST' });
      toast.success('Podcast sync paused.');
      fetchPodcastQueue();
    } catch (err: any) {
      toast.error(err.data?.statusMessage || 'Failed to pause podcast.');
    } finally {
      pausingShowId.value = null;
    }
  };

  const handleRetryPodcastEpisode = async (episodeId: string) => {
    try {
      await $fetch('/api/admin/podcasts/retry-failed', { method: 'POST', body: { episodeId } });
      toast.success('Episode retried.');
      fetchPodcastQueue();
    } catch (err: any) {
      toast.error(err.data?.statusMessage || 'Retry failed.');
    }
  };

  const handleRetryAllPodcastFailed = async () => {
    retryingPodcastFailed.value = true;
    try {
      await $fetch('/api/admin/podcasts/retry-failed', { method: 'POST' });
      fetchPodcastQueue();
      toast.success('Failed downloads retried.');
    } catch (err: any) {
      toast.error(err.data?.statusMessage || 'Retry failed.');
    } finally {
      retryingPodcastFailed.value = false;
    }
  };

  const formatStatus = (status: string) => {
    const s: Record<string, string> = {
      pending: 'Pending',
      downloading: 'Downloading',
      failed: 'Failed',
      completed: 'Completed',
      paused: 'Paused'
    };
    return s[status] || status;
  };

  onMounted(() => {
    fetchPodcastConcurrency();
    fetchPodcastSchedule();
  });
  </script>
  ```

- [ ] **Step 3: Register the tab in `app/pages/settings.vue` — template**

  Open `app/pages/settings.vue`. After the Music tab button (the `<button>` block ending at line 38, just before the Users tab button), insert:
  ```vue
        <button
          v-if="isAdmin && !currentUser?.mustChangePassword"
          class="tab-btn"
          :class="{ active: activeTab === 'podcasts' }"
          @click="activeTab = 'podcasts'"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>
          <span>Podcasts</span>
          <span v-if="podcastActiveDownloadCount > 0" class="tab-badge">{{ podcastActiveDownloadCount }}</span>
        </button>
  ```

  Then, in the tab content area, after the `<SettingsMusicTab ... />` line:
  ```vue
          <SettingsPodcastsTab v-if="activeTab === 'podcasts' && isAdmin" />
  ```

- [ ] **Step 4: Register the tab in `app/pages/settings.vue` — script**

  In the same file's `<script setup>`:

  1. Add the import after the `useMusicQueue` import (line 78):
     ```ts
     import { usePodcastQueue } from '~/composables/usePodcastQueue';
     ```
  2. Replace the `allowedTabs` line (line 83):
     ```ts
     const allowedTabs = ['stats', 'downloads', 'users', 'system'];
     ```
     with:
     ```ts
     const allowedTabs = ['stats', 'downloads', 'podcasts', 'users', 'system'];
     ```
     (This makes `?tab=podcasts` deep-linkable. The pre-existing omission of `'music'` from this array is a separate, unrelated quirk — leave it alone.)
  3. Add the composable destructure after the `useMusicQueue` destructure (line 99):
     ```ts
     const { podcastQueue, podcastActiveDownloadCount, fetchPodcastQueue } = usePodcastQueue();
     ```
  4. Add a podcast polling loop after `runMusicPolling` (after line 128), mirroring it exactly:
     ```ts
     let podcastPollingTimeout: any = null;

     const runPodcastPolling = async () => {
       if (!isAdmin.value || activeTab.value !== 'podcasts') {
         podcastPollingTimeout = setTimeout(runPodcastPolling, 3000);
         return;
       }
       await fetchPodcastQueue();
       const hasActivePodcastDownload = podcastQueue.value.some(e => e.download_status === 'downloading');
       const nextPollDelay = hasActivePodcastDownload ? 500 : 3000;
       podcastPollingTimeout = setTimeout(runPodcastPolling, nextPollDelay);
     };
     ```
  5. In `onMounted`, add `runPodcastPolling();` after `runMusicPolling();`.
  6. In `onUnmounted`, add after the music clear:
     ```ts
     if (podcastPollingTimeout) clearTimeout(podcastPollingTimeout);
     ```

  Note: `SettingsPodcastsTab` needs no explicit import — `app/components/settings/` is auto-imported by Nuxt, exactly as `SettingsMusicTab` is.

- [ ] **Step 5: Run the suite**

  ```bash
  npm test
  ```
  Expect all existing tests to pass.

- [ ] **Step 6: Commit**

  ```bash
  git add app/composables/usePodcastQueue.ts app/components/settings/SettingsPodcastsTab.vue app/pages/settings.vue
  git commit -m "$(cat <<'EOF'
  feat: add the Settings > Podcasts admin tab

  Wires all 11 existing podcast admin routes into a tab mirroring
  SettingsMusicTab: add-feed form (with visibility + auto-sync), followed-shows
  list with per-show sync/pause, concurrency setting, cron schedule with
  presets defaulting to the seeded '0 4 * * *', global pause/resume, and the
  download queue with per-episode and bulk retry. No Cancel action — the
  podcast admin API has no per-episode cancel route and adding one is out of
  scope. usePodcastQueue mirrors useMusicQueue (reading data.shows, which is
  what queue.get returns) and drives the tab badge and polling.

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 9: Manual end-to-end verification

**Files:**
- Modify: none (verification only; any bug found here is fixed in the file that owns it, then re-verified).

**Interfaces:**
- Consumes: everything from Tasks 1-8. Nothing depends on this task, so it is correctly last.
- Produces: nothing new.

- [ ] **Step 1: Automated safety net**

  ```bash
  npm test
  ```
  Expect the full suite green, including `tests/component/PodcastEpisodeEditModal.test.ts`.

- [ ] **Step 2: Start the dev server with the dev-login fixture enabled**

  ```bash
  ALLOW_DEV_LOGIN=1 npm run dev
  ```
  Note the port (typically `http://localhost:3000`). In a second terminal:
  ```bash
  curl -i -c /tmp/youkeep-podcast-ui-cookies.txt -X POST http://localhost:3000/api/dev/login
  ```
  Confirm `200` with a `Set-Cookie: youkeep_session=...` header.

- [ ] **Step 3: Verify the space-switcher entry and empty catalog**

  In a browser logged in as admin (or by inspecting the served HTML), open `http://localhost:3000/podcasts`. Confirm:
  - The header space-switcher label reads **Podcasts** (not Vidéo) — this is the `activeSpace` branch from Task 6.
  - Opening the switcher dropdown lists three spaces: Vidéo, Musique, Podcasts, with Podcasts highlighted and **no "Désactivé" badge** on it.
  - The sidebar shows exactly one link, "Bibliothèque", pointing at `/podcasts`.
  - With no shows ingested yet, the `EmptyState` reads "Aucun podcast archivé".

- [ ] **Step 4: Add a feed through the new Settings tab**

  Open `http://localhost:3000/settings?tab=podcasts`. Confirm the Podcasts tab is selected (proving the `allowedTabs` change). In the "Track a Podcast" form, paste a real, currently-live public RSS feed (e.g. `https://feeds.npr.org/510289/podcast.xml`), leave "Sync automatically" checked, and submit. Confirm:
  - A green message appears reading `Podcast "<name>" ingested. N new episode(s) added.`
  - The show appears under "Followed Podcasts" with a cover thumbnail, `Downloading` status, its visibility, and a non-zero episode count.
  - The "Podcast Queue" panel fills with episode cards whose progress bars climb, `download_speed`/`ETA` appear on the downloading one, and the tab badge shows the active-download count.

  Also verify a bad feed fails cleanly: submit `https://example.com/not-a-feed` and confirm a red message with the generic server-side text (no stack trace, no internal path).

- [ ] **Step 5: Verify concurrency, schedule, and pause/resume from the tab**

  - Change "Max concurrent downloads" to `1`, click Save, confirm the success toast; reload the page and confirm it still reads `1`. Set it back to `2`.
  - Tick "Enable background feed resync automation", pick the `Daily` preset, save, confirm the success message; reload and confirm the checkbox and preset survive (proving `schedule.get` round-trips and the preset-matching logic finds `0 4 * * *`).
  - Click "Pause Podcast Sync": confirm the queue header badge flips to `Suspended` and progress stops. Click "Resume Podcast Sync": confirm it flips back to `Active` and downloads continue.
  - Use the per-show **Pause** then **Sync** buttons; confirm the show's status text changes accordingly on the next poll.

- [ ] **Step 6: Verify the catalog page grid and detail view**

  Return to `http://localhost:3000/podcasts`. Confirm:
  - The show appears in the grid with its remote cover art, title, and episode count, plus a visibility badge (admin-only).
  - Typing part of the title in the search box filters the grid after ~300ms; typing gibberish shows the "Aucun résultat" empty state.
  - Clicking the show navigates to `/podcasts?showId=<id>` and renders the detail header (cover, title, author, description) plus the episode list, with each row showing season/episode numbers where present, a formatted pub date, a duration, and a download-status badge (`Téléchargé` / `En cours` / `En attente` / `Échec`).
  - If the show has more than 50 episodes, "Charger plus" appends the next page without duplicating rows.
  - The back button returns to the grid and the grid reloads.

- [ ] **Step 7: Verify the file-serving route, including Range**

  Pick one episode whose badge reads `Téléchargé` and get its stored path:
  ```bash
  sqlite3 <path-to-youkeep.db> "SELECT id, local_file_path FROM podcast_episodes WHERE download_status='completed' LIMIT 1;"
  ```
  (If `sqlite3` isn't handy, read `local_file_path` from the `/api/podcasts/shows/<id>/episodes` JSON instead.) Then:
  ```bash
  # Full request: expect 200, the right audio content-type, Accept-Ranges: bytes
  curl -s -o /dev/null -D - -b /tmp/youkeep-podcast-ui-cookies.txt \
    "http://localhost:3000<local_file_path>"

  # Range request: expect 206 + Content-Range: bytes 0-99/<size> + Content-Length: 100
  curl -s -o /dev/null -D - -b /tmp/youkeep-podcast-ui-cookies.txt \
    -H 'Range: bytes=0-99' "http://localhost:3000<local_file_path>"

  # Unsatisfiable range: expect 416 + Content-Range: bytes */<size>
  curl -s -o /dev/null -D - -b /tmp/youkeep-podcast-ui-cookies.txt \
    -H 'Range: bytes=999999999-' "http://localhost:3000<local_file_path>"
  ```
  Then verify it fails closed:
  ```bash
  # Wrong extension on a real episode id: must be 404, NOT 403 or 200
  curl -s -o /dev/null -w '%{http_code}\n' -b /tmp/youkeep-podcast-ui-cookies.txt \
    "http://localhost:3000/downloads-podcasts/<showDir>/<episodeId>.txt"

  # Unknown episode id: 404
  curl -s -o /dev/null -w '%{http_code}\n' -b /tmp/youkeep-podcast-ui-cookies.txt \
    "http://localhost:3000/downloads-podcasts/<showDir>/does-not-exist.mp3"

  # Traversal attempt / wrong segment count: 400 or 403, never file content
  curl -s -o /dev/null -w '%{http_code}\n' -b /tmp/youkeep-podcast-ui-cookies.txt \
    "http://localhost:3000/downloads-podcasts/a/b/c.mp3"

  # Unauthenticated request on a private/ultra_private show: 403
  # (set the show's visibility to 'ultra_private' via the add-feed form's
  #  visibility select re-ingesting the same feed, then retry with no -b flag)
  curl -s -o /dev/null -w '%{http_code}\n' "http://localhost:3000<local_file_path>"
  ```
  Reset the show back to `public` afterwards if you changed it.

- [ ] **Step 8: Verify episode editing end-to-end**

  On `/podcasts?showId=<id>` as admin, click the pencil icon on an episode row. Confirm:
  - The modal opens titled "Modifier l'épisode" with all four fields prefilled (null numbers render as empty inputs, not `null`).
  - Changing the title and saving shows the "Épisode mis à jour." toast, closes the modal, and updates the row in place with no page reload.
  - Reloading the page shows the persisted title.
  - Clearing the episode number and saving persists `NULL` (the row's `E<n>` marker disappears).
  - Clearing the title and saving surfaces the server's "Title cannot be empty." error toast and leaves the modal open.
  - Logged in as a non-admin (or logged out), no pencil icon renders on any episode row.

- [ ] **Step 9: Stop the dev server**

  Ctrl-C the `npm run dev` process. Restarting without `ALLOW_DEV_LOGIN` makes `/api/dev/login` return `404` again — no cleanup needed.

- [ ] **Step 10: Commit the verification record**

  If Steps 3-8 required no code changes, there is nothing to commit and this task is complete. If any step exposed a bug, fix it in the owning file, re-run `npm test`, re-verify the failing step, and commit:
  ```bash
  git commit -am "$(cat <<'EOF'
  fix: address findings from podcast library UI end-to-end verification

  Manually verified end-to-end against a live public RSS feed: the Podcasts
  space renders with its own sidebar, the Settings > Podcasts tab ingests a
  feed and drives concurrency/schedule/pause/resume/retry, the catalog page's
  grid, search, detail view and pagination work, the file-serving route
  returns 200/206/416 correctly and fails closed with 404/403, and per-episode
  editing persists.

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Self-review

### Spec coverage

| Spec requirement | Task |
| --- | --- |
| `/podcasts` space reachable from the header space-switcher | Task 6 (spaces entry + `activeSpace` branch) |
| Shows grid ⇄ episode-list detail via `?showId=` | Task 7 |
| Title-search-only filtering | Task 2 (`search` param) + Task 7 (debounced input) |
| `GET /api/podcasts/shows` | Task 2 Step 1 |
| `GET /api/podcasts/shows/[id]` | Task 2 Step 2 |
| `GET /api/podcasts/shows/[id]/episodes` | Task 2 Step 3 |
| `PATCH /api/admin/podcasts/episodes/[id]` | Task 4 |
| `canAccessPodcastEpisode` in `server/utils/auth.ts` | Task 1 Step 3 (plus `canAccessPodcastShow`, Step 2) |
| File-serving route with audio + image content-type maps | Task 3 |
| Two-segment flat path shape, episode-id lookup, `download_status = 'completed'` | Task 3 Step 1 |
| Double path-containment guard | Task 3 Step 1 |
| `Last-Modified`/`If-Modified-Since` 304 for non-audio | Task 3 Step 1 |
| Range requests (confirmed present in `downloads-music`) | Task 3 Step 1 + Task 9 Step 7 |
| `PodcastEpisodeEditModal.vue` (title/episode/season/description, `BaseModal`, toast) | Task 5 |
| Admin-only edit affordance on each episode row | Task 7 (`v-if="isAdmin"`) |
| `SettingsPodcastsTab.vue`: add-feed form | Task 8 |
| ... per-show sync/pause | Task 8 |
| ... concurrency | Task 8 |
| ... cron schedule | Task 8 |
| ... global pause/resume | Task 8 |
| ... download queue view | Task 8 |
| `EmptyState` reuse ("Aucun podcast archivé" / "Aucun résultat") | Task 7 |
| `download_status` badges reusing music's badge classes | Task 7 (`badge-completed`/`-downloading`/`-pending`/`-failed`) |
| Broken-feed generic error surfaced by the add-feed form | Task 8 + Task 9 Step 4 |
| Fail-closed 404/403 on the file route | Task 3 + Task 9 Step 7 |
| Component tests for the edit modal's form logic | Task 5 |
| No automated tests for file-serving / live API; manual verification instead | Task 9 |
| Non-goal: no playback UI | Nothing in any task creates a player; the episodes route returns `local_file_path` for the later player but nothing plays it. |
| Non-goal: no module toggle | Task 6 Step 2 explicitly leaves `visibleSpaces` untouched; no `podcastModuleGate.ts`, no `podcast_module_enabled` setting, no gate fetch in the page's `onMounted` (unlike `/music`'s). |
| Non-goal: no changes to the 11 admin routes or `podcastDownloader.ts` | No task's Files list includes any of them. |
| Non-goal: no genre/language/year facets | Task 2's shows route has a `search` param and nothing else. |

### Placeholder scan

Every code block in this plan is complete and runnable — no "similar to Task N", no "add appropriate error handling", no `...`, no TODO. Verified by re-reading each of the 9 tasks: Tasks 1-4 and 8's composable contain whole files; Tasks 5, 7, 8's component contain whole `.vue` files including `<style>`; Task 6 and Task 8 Steps 3-4 are the only edit-in-place steps and each quotes the exact existing text being replaced with its line number.

### Type/signature consistency (checked across tasks)

Findings from this pass, all already corrected inline above:

1. **Modal prop name.** `MusicTrackEditModal` takes a `track` prop; a mechanical copy would have left `:track` in Task 7's template while Task 5 declared `episode`. Task 5's Interfaces block now pins the prop as `episode`, Task 7's template passes `:episode="editingEpisode"`, and Task 5's tests mount with `props: { show, episode }`. Consistent.
2. **PATCH body casing.** Task 4 accepts `episodeNumber`/`seasonNumber` (camelCase, matching `admin/music/tracks/[id].patch.ts`'s `trackNumber`) and returns snake_case `episode_number`/`season_number` nested under `episode`. Task 5's `handleSubmit` sends exactly those camelCase keys and emits `data.episode`; Task 5's test asserts both halves; Task 7's `handleEpisodeSaved` `Object.assign`s the snake_case object onto the row it renders. Consistent.
3. **Response envelope names.** Task 4 returns `{ episode }` (not `{ track }`); Task 5 reads `data.episode`. Task 2 returns `{ shows }`, `{ show }`, `{ episodes, total }`; Task 7 reads `data.shows`, `data.show`, `data.episodes`/`data.total`. Consistent.
4. **Queue envelope.** The pre-existing `queue.get` returns `shows`, not `artists` — a mechanical copy of `useMusicQueue` would have read `data.artists` and silently rendered an empty followed-shows list. Task 8's composable reads `data.shows`, and `SettingsPodcastsTab` iterates `podcastShows` with `s.title`/`s.cover_url`/`s.sync_status`/`s.visibility`/`s.episode_count` — the exact columns that route selects. Consistent.
5. **Queue card fields.** `queue.get` selects `e.id, e.title, e.download_status, e.download_progress, e.download_speed, e.download_eta, e.last_error, s.title as show_title`. Task 8's queue cards reference exactly those; in particular `ep.show_title` (not `ep.show_name` or `ep.artist_name`). Consistent.
6. **Cron default.** `db.ts` seeds `podcast_sync_cron_schedule` as `'0 4 * * *'` and `schedule.get.ts` falls back to the same. Task 8's `podcastPresets.daily`/`.weekly` therefore use `0 4 * * *` / `0 4 * * 0` rather than music's 3:30 AM values — otherwise the preset-matching `Object.keys(...).find(...)` would classify a freshly-seeded install as `custom`. The UI labels say "4:00 AM" to match. Consistent.
7. **`canAccessPodcastShow` vs `canAccessPodcastEpisode` usage.** The two read routes that gate on a show use `canAccessPodcastShow`; the file-serving route, which is keyed by an episode id, uses `canAccessPodcastEpisode`. Both are produced by Task 1 with the exact signatures Tasks 2 and 3 consume (`(id: string, event: any) => Promise<boolean>`). Consistent.
8. **`podcastVisibilityClause` default alias.** Declared with default `'s'` in Task 1 and called with no alias argument in Task 2, whose query aliases `podcast_shows` as `s`. Consistent.
9. **Column names against the live schema.** Every column referenced across Tasks 2, 3, 4 and 7 was checked against the `CREATE TABLE` text in `server/utils/db.ts`. No task references `size_bytes` (does not exist), an `episode_count` column (always computed), or a numeric `pub_date` (it is TEXT — hence Task 7's `formatPubDate` fallback and Task 2's `created_at DESC` ordering rather than ordering on `pub_date`).
10. **Space id string.** `'podcasts'` in Task 6's `spaces` entry, in the `activeSpace` branch, and (independently) as the settings tab key in Task 8. The route prefix `/podcasts` matches `homeRoute` and the nav link `to`. Consistent.
