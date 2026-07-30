# Music Clips (Sub-project 6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins optionally keep the video stream of a music track's source YouTube video (its "clip"/official music video) alongside the audio, and let users switch a track's playback to inline video in the persistent mini-player without losing queue/shuffle/repeat/position state.

**Architecture:** One new boolean column (`music_tracks.has_clip`) and one new global setting (`music_download_clips`) drive whether new track downloads fetch a merged video+audio mp4 (reusing the video module's exact format string) instead of today's audio-only extraction. The same physical file serves both plain listening and clip playback — no second file, no second download for the common case. Client-side, the persistent mini-player's `<audio>` element becomes a `<video>` element (a superset capability — `<video>` plays audio-only files identically to `<audio>`), toggled visually via `v-show` rather than swapped in/out of the DOM, directly avoiding the exact "element unmounted via `v-if`" bug class that caused a CRITICAL playback failure in sub-project 4.

**Tech Stack:** Nuxt 4 / Nitro (H3), better-sqlite3, Vue 3 Composition API, yt-dlp (spawned child process), Vitest.

## Global Constraints

- Admin-only for every write/trigger surface: `POST /api/admin/settings/music-clips` and `POST /api/admin/music/tracks/[id]/download-clip` both `requireAdmin`, matching every other music admin endpoint.
- `GET /api/settings/music-clips` never throws; on any error it defaults to `enabled: false` — the OPPOSITE fail-open direction from sub-project 5's `GET /api/settings/music-module` (which defaults `true`). This is intentional per spec §6: a read glitch should never cause the client to show clip UI or trigger clip downloads based on wrong state.
- Any settings write endpoint for a boolean value MUST use `INSERT ... ON CONFLICT(key) DO UPDATE`, never a bare `UPDATE` (sub-project 5's Task 3 review caught this exact bug class in a bare-`UPDATE` write endpoint — a missing row would silently no-op while still reporting success).
- The existing audio-only file must never be deleted until the new clip file has been fully and successfully written to disk — no destructive operation before success is confirmed.
- No re-encoding, no quality picker — the video format string is always exactly `bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best` with `--merge-output-format mp4`, copied verbatim from `server/utils/downloader.ts:674` (the video module's own format selection).
- `music_tracks.id` IS the source YouTube video id (`data.id` from yt-dlp) — every task that needs "the clip's source URL" builds it as `https://www.youtube.com/watch?v=${trackId}`, no separate video-id column.
- Production endpoint files call project-local utilities (`getDb`, `requireAdmin`, `getUserFromSession`, `canAccessMusicTrack`, etc.) as bare ambient identifiers via Nitro's runtime auto-import. Vitest's direct-handler-import tests never get that transform — write the failing test first and let the failure name the exact relative import path; never pre-guess it.
- The only command that actually type-checks this repo is `npx vue-tsc -b --noEmit` (plain `vue-tsc --noEmit -p .` is a silent no-op here due to a solution-style tsconfig). Two pre-existing, unrelated errors always appear and must be distinguished from new ones: `app/components/VideoPlayer.vue(276,43)` TS2532 and `app/pages/subscriptions.vue(17,21)` TS2339.
- `tests/helpers/testDb.ts`'s `mockEvent(cookieHeader?, {path?, params?, body?})` stores `body` under `Symbol.for('h3ParsedBody')`, matching h3's internal `ParsedBodySymbol`, so `readBody(event)` returns it directly — no raw HTTP stream simulation needed.
- This repo has no automated test infrastructure for Vue components/composables (server endpoints are Vitest-tested; `server/utils/musicDownloader.ts`'s spawn-based download functions also have zero existing test coverage and this plan does not introduce any — see each task's Testing section for what's actually verifiable). Any task touching `app/composables/useMusicPlayer.ts`, `app/components/MusicMiniPlayer.vue`, or `server/utils/musicDownloader.ts` needs careful manual hand-tracing during review plus live verification by the controller — the same class of file that shipped a CRITICAL bug in sub-project 4 (an `<audio>` element nested inside `v-if`, silently non-functional from first mount).
- All new UI copy is in French, matching every existing Music-tab/space-switcher string.

---

### Task 1: Data model — `has_clip` column and `music_download_clips` setting

**Files:**
- Modify: `server/utils/db.ts`
- Modify: `tests/helpers/testDb.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `music_tracks.has_clip` column (real + test schema, `INTEGER DEFAULT 0`). `music_download_clips` setting (real DB seed `'0'`; test schema has no seed — tests use `insertSetting` explicitly, as established by every prior music setting). `insertMusicTrack` test helper gains an optional `hasClip?: boolean` param. Consumed by every later task.

- [ ] **Step 1: Add the real schema column**

Open `server/utils/db.ts`. Find this line (in the "Run schema updates if columns are missing" migration block):

```ts
  try { db.exec(`ALTER TABLE music_tracks ADD COLUMN size_bytes INTEGER;`); } catch (e) {}
```

Add immediately after it:

```ts
  try { db.exec(`ALTER TABLE music_tracks ADD COLUMN size_bytes INTEGER;`); } catch (e) {}
  try { db.exec(`ALTER TABLE music_tracks ADD COLUMN has_clip INTEGER DEFAULT 0;`); } catch (e) {}
```

- [ ] **Step 2: Seed the real setting**

Find this block:

```ts
  const musicModuleEnabledCheck = db.prepare("SELECT COUNT(*) as count FROM settings WHERE key = 'music_module_enabled'").get() as { count: number };
  if (musicModuleEnabledCheck.count === 0) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('music_module_enabled', '1')").run();
    console.log('Seeded setting music_module_enabled: 1');
  }
```

Add immediately after it:

```ts
  const musicModuleEnabledCheck = db.prepare("SELECT COUNT(*) as count FROM settings WHERE key = 'music_module_enabled'").get() as { count: number };
  if (musicModuleEnabledCheck.count === 0) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('music_module_enabled', '1')").run();
    console.log('Seeded setting music_module_enabled: 1');
  }

  const musicDownloadClipsCheck = db.prepare("SELECT COUNT(*) as count FROM settings WHERE key = 'music_download_clips'").get() as { count: number };
  if (musicDownloadClipsCheck.count === 0) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('music_download_clips', '0')").run();
    console.log('Seeded setting music_download_clips: 0');
  }
```

- [ ] **Step 3: Add `has_clip` to the test schema**

Open `tests/helpers/testDb.ts`. Find the `music_tracks` table definition:

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
```

Replace with:

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
      has_clip INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (artist_id) REFERENCES music_artists(id) ON DELETE CASCADE,
      FOREIGN KEY (album_id) REFERENCES music_albums(id) ON DELETE SET NULL
    );
```

- [ ] **Step 4: Extend the `insertMusicTrack` test helper**

Find:

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
  hasClip?: boolean;
  createdAt?: number;
}) {
  db.prepare(`
    INSERT INTO music_tracks (id, artist_id, album_id, title, track_number, genre, language, duration, download_status, local_file_path, local_thumbnail_path, has_clip, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    opts.hasClip ? 1 : 0,
    opts.createdAt ?? Date.now()
  );
}
```

- [ ] **Step 5: Run the full suite to confirm no regressions**

Run: `npm test -- --run`
Expected: all existing tests still pass (this task only adds a column with a default and an optional param — no existing call site breaks).

- [ ] **Step 6: Commit**

```bash
git add server/utils/db.ts tests/helpers/testDb.ts
git commit -m "feat: add music_tracks.has_clip column and music_download_clips setting"
```

---

### Task 2: Settings endpoints — `GET /api/settings/music-clips`, `POST /api/admin/settings/music-clips`

**Files:**
- Create: `server/api/settings/music-clips.get.ts`
- Create: `server/api/admin/settings/music-clips.post.ts`
- Test: `tests/integration/music-clips-settings.test.ts`

**Interfaces:**
- Consumes: `requireAdmin` (`server/utils/auth.ts`), `insertSetting`/`insertUser`/`insertSession`/`sessionCookie`/`mockEvent` (`tests/helpers/testDb.ts`, all from Task 1 or earlier sub-projects).
- Produces: `GET /api/settings/music-clips` → `{ enabled: boolean }` (fail-open to `false`). `POST /api/admin/settings/music-clips` → `{ enabled: boolean }`. Consumed by Task 8 (client UI).

- [ ] **Step 1: Write the failing tests**

Create `tests/integration/music-clips-settings.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import getHandler from '../../server/api/settings/music-clips.get';
import postHandler from '../../server/api/admin/settings/music-clips.post';
import { createTestDb, insertSetting, insertUser, insertSession, mockEvent, sessionCookie } from '../helpers/testDb';

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

describe('GET /api/settings/music-clips', () => {
  it('defaults to false when the row is missing', async () => {
    const result: any = await getHandler(mockEvent(undefined, { path: '/api/settings/music-clips' }));
    expect(result.enabled).toBe(false);
  });

  it('reflects enabled: true', async () => {
    insertSetting(db, { key: 'music_download_clips', value: '1' });
    const result: any = await getHandler(mockEvent(undefined, { path: '/api/settings/music-clips' }));
    expect(result.enabled).toBe(true);
  });

  it('reflects enabled: false', async () => {
    insertSetting(db, { key: 'music_download_clips', value: '0' });
    const result: any = await getHandler(mockEvent(undefined, { path: '/api/settings/music-clips' }));
    expect(result.enabled).toBe(false);
  });

  it('fails open to false (not true) when the DB read throws', async () => {
    (globalThis as any).getDb = () => {
      return {
        prepare: () => {
          throw new Error('Database is locked or unavailable');
        }
      };
    };
    const result: any = await getHandler(mockEvent(undefined, { path: '/api/settings/music-clips' }));
    expect(result.enabled).toBe(false);
  });
});

describe('POST /api/admin/settings/music-clips', () => {
  it('returns 401 for a guest', async () => {
    await expect(postHandler(mockEvent(undefined, { path: '/api/admin/settings/music-clips', body: { enabled: true } }))).rejects.toMatchObject({ statusCode: 401 });
  });

  it('returns 403 for a logged-in non-admin', async () => {
    const cookie = loginAs('u1', 'user');
    await expect(postHandler(mockEvent(cookie, { path: '/api/admin/settings/music-clips', body: { enabled: true } }))).rejects.toMatchObject({ statusCode: 403 });
  });

  it('returns 400 when enabled is missing or not a boolean', async () => {
    const cookie = loginAs('admin1', 'admin');
    await expect(postHandler(mockEvent(cookie, { path: '/api/admin/settings/music-clips', body: {} }))).rejects.toMatchObject({ statusCode: 400 });
    await expect(postHandler(mockEvent(cookie, { path: '/api/admin/settings/music-clips', body: { enabled: 'yes' } }))).rejects.toMatchObject({ statusCode: 400 });
  });

  it('persists enabled: true for an admin even when the row does not exist yet', async () => {
    const cookie = loginAs('admin1', 'admin');
    const result: any = await postHandler(mockEvent(cookie, { path: '/api/admin/settings/music-clips', body: { enabled: true } }));
    expect(result.enabled).toBe(true);
    const row = db.prepare("SELECT value FROM settings WHERE key = 'music_download_clips'").get() as { value: string };
    expect(row.value).toBe('1');
  });

  it('persists enabled: false for an admin, overwriting an existing row', async () => {
    insertSetting(db, { key: 'music_download_clips', value: '1' });
    const cookie = loginAs('admin1', 'admin');
    const result: any = await postHandler(mockEvent(cookie, { path: '/api/admin/settings/music-clips', body: { enabled: false } }));
    expect(result.enabled).toBe(false);
    const row = db.prepare("SELECT value FROM settings WHERE key = 'music_download_clips'").get() as { value: string };
    expect(row.value).toBe('0');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/integration/music-clips-settings.test.ts`
Expected: FAIL with module-not-found errors for both handler imports.

- [ ] **Step 3: Implement the read endpoint**

Create `server/api/settings/music-clips.get.ts`:

```ts
import { defineEventHandler } from 'h3';

export default defineEventHandler(async () => {
  try {
    const db = getDb();
    const row = db.prepare("SELECT value FROM settings WHERE key = 'music_download_clips'").get() as { value: string } | undefined;
    return { enabled: row?.value === '1' };
  } catch {
    return { enabled: false };
  }
});
```

- [ ] **Step 4: Implement the write endpoint**

Create `server/api/admin/settings/music-clips.post.ts`:

```ts
import { defineEventHandler, readBody, createError } from 'h3';
import { requireAdmin } from '../../../utils/auth';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);

  const body = await readBody(event);
  if (!body || typeof body !== 'object' || typeof body.enabled !== 'boolean') {
    throw createError({ statusCode: 400, statusMessage: 'enabled (boolean) is required.' });
  }

  const db = getDb();
  db.prepare("INSERT INTO settings (key, value) VALUES ('music_download_clips', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(body.enabled ? '1' : '0');

  return { enabled: body.enabled };
});
```

If the test run fails with a "not defined" error for `getDb` or `requireAdmin`, add the exact explicit relative import the failure demands.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/integration/music-clips-settings.test.ts`
Expected: PASS (all 9 tests: 4 GET + 5 POST).

- [ ] **Step 6: Run the full suite to confirm no regressions**

Run: `npm test -- --run`

- [ ] **Step 7: Commit**

```bash
git add server/api/settings/music-clips.get.ts server/api/admin/settings/music-clips.post.ts tests/integration/music-clips-settings.test.ts
git commit -m "feat: add music_download_clips public read and admin write endpoints"
```

---

### Task 3: Ingestion pipeline — clip-mode download with audio-only fallback

**Files:**
- Modify: `server/utils/musicDownloader.ts`

**Interfaces:**
- Consumes: `music_download_clips` setting (Task 1), `has_clip` column (Task 1), `parseMaxConcurrentDownloads`/`hasCapacityForMoreDownloads` (existing, `server/utils/concurrency.ts`), `isFfmpegAvailable` (existing, `server/utils/downloader.ts`).
- Produces: `downloadMusicTrackFile(trackId, artistId, opts?: { wantClip?: boolean }): Promise<{ hasClip: boolean }>` — the return type changes from `Promise<void>` to `Promise<{ hasClip: boolean }>`; every existing call site must be updated in this task. Consumed by Task 4 (manual backfill).

**Testing note:** `server/utils/musicDownloader.ts` has zero existing Vitest coverage — it spawns real `yt-dlp` child processes, which prior sub-projects have never unit-tested (the video module's equivalent `downloader.ts` has none either). This task has no automated tests; verify manually per Step 5 below, and flag this file for extra reviewer hand-tracing per the plan's Global Constraints.

- [ ] **Step 1: Extend `downloadMusicTrackFile` to accept a clip-mode option**

Open `server/utils/musicDownloader.ts`. Find the function signature:

```ts
function downloadMusicTrackFile(trackId: string, artistId: string): Promise<void> {
  return new Promise<void>(async (resolve, reject) => {
```

Replace with:

```ts
function downloadMusicTrackFile(trackId: string, artistId: string, opts: { wantClip?: boolean } = {}): Promise<{ hasClip: boolean }> {
  const wantClip = opts.wantClip === true;
  return new Promise<{ hasClip: boolean }>(async (resolve, reject) => {
```

- [ ] **Step 2: Build clip-mode yt-dlp args instead of audio-only args when requested**

Find:

```ts
      const outputTemplate = path.join(artistDir, `${trackId}.%(ext)s`);
      const targetUrl = `https://www.youtube.com/watch?v=${trackId}`;

      const args = [
        '-x',
        '-f', 'bestaudio/best',
        '-o', outputTemplate,
        '--write-thumbnail',
        '--write-info-json',
        '--no-playlist',
        targetUrl
      ];
```

Replace with:

```ts
      const outputTemplate = path.join(artistDir, `${trackId}.%(ext)s`);
      const targetUrl = `https://www.youtube.com/watch?v=${trackId}`;

      const args = wantClip
        ? [
            '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
            '--merge-output-format', 'mp4',
            '-o', outputTemplate,
            '--write-thumbnail',
            '--write-info-json',
            '--no-playlist',
            targetUrl
          ]
        : [
            '-x',
            '-f', 'bestaudio/best',
            '-o', outputTemplate,
            '--write-thumbnail',
            '--write-info-json',
            '--no-playlist',
            targetUrl
          ];
```

- [ ] **Step 3: Scan for the merged mp4 (not the audio-extension list) when in clip mode, and write `has_clip`**

Find:

```ts
        if (code === 0) {
          const audioExtensions = ['m4a', 'opus', 'webm', 'mp3', 'ogg', 'wav'];
          let audioFile: string | null = null;
          let localFilePath: string | null = null;
          for (const ext of audioExtensions) {
            const testPath = path.join(artistDir, `${trackId}.${ext}`);
            if (fs.existsSync(testPath)) {
              audioFile = testPath;
              localFilePath = `/downloads-music/${folderName}/${trackId}.${ext}`;
              break;
            }
          }
```

Replace with:

```ts
        if (code === 0) {
          const scanExtensions = wantClip ? ['mp4'] : ['m4a', 'opus', 'webm', 'mp3', 'ogg', 'wav'];
          let audioFile: string | null = null;
          let localFilePath: string | null = null;
          for (const ext of scanExtensions) {
            const testPath = path.join(artistDir, `${trackId}.${ext}`);
            if (fs.existsSync(testPath)) {
              audioFile = testPath;
              localFilePath = `/downloads-music/${folderName}/${trackId}.${ext}`;
              break;
            }
          }
```

Find (a few lines further down, the final DB write and resolve):

```ts
          db.prepare(`
            UPDATE music_tracks
            SET local_file_path = ?, local_thumbnail_path = ?, album_id = COALESCE(?, album_id),
                genre = COALESCE(?, genre), track_number = COALESCE(?, track_number), size_bytes = ?
            WHERE id = ?
          `).run(localFilePath, thumbnailUrlPath, albumId, genre, trackNumber, fileSize, trackId);
```

Replace with:

```ts
          db.prepare(`
            UPDATE music_tracks
            SET local_file_path = ?, local_thumbnail_path = ?, album_id = COALESCE(?, album_id),
                genre = COALESCE(?, genre), track_number = COALESCE(?, track_number), size_bytes = ?, has_clip = ?
            WHERE id = ?
          `).run(localFilePath, thumbnailUrlPath, albumId, genre, trackNumber, fileSize, wantClip ? 1 : 0, trackId);
```

Find, a few lines further (the resolve call at the end of the success branch):

```ts
          settle(() => resolve());
        } else {
          const errorMsg = lastStderr ? `yt-dlp a échoué (code ${code}) : ${lastStderr}` : `yt-dlp a échoué avec le code ${code}`;
          settle(() => reject(new Error(errorMsg)));
        }
```

Replace with:

```ts
          settle(() => resolve({ hasClip: wantClip }));
        } else {
          const errorMsg = lastStderr ? `yt-dlp a échoué (code ${code}) : ${lastStderr}` : `yt-dlp a échoué avec le code ${code}`;
          settle(() => reject(new Error(errorMsg)));
        }
```

- [ ] **Step 4: Wire the setting into the automatic queue worker, with audio-only fallback on clip failure**

Find `runSingleMusicDownload`:

```ts
async function runSingleMusicDownload(trackId: string, trackTitle: string, artistId: string): Promise<void> {
  const db = getDb();
  try {
    await downloadMusicTrackFile(trackId, artistId);

    db.prepare(`
      UPDATE music_tracks
      SET download_status = 'completed', download_progress = 100, download_speed = null, download_eta = null, last_error = null
      WHERE id = ?
    `).run(trackId);
    addLog(`Téléchargement audio RÉUSSI : "${trackTitle}"`);
  } catch (err: any) {
```

Replace with:

```ts
async function runSingleMusicDownload(trackId: string, trackTitle: string, artistId: string): Promise<void> {
  const db = getDb();
  try {
    const clipsSetting = db.prepare("SELECT value FROM settings WHERE key = 'music_download_clips'").get() as { value: string } | undefined;
    const wantClip = clipsSetting?.value === '1';

    let result: { hasClip: boolean };
    if (wantClip) {
      try {
        result = await downloadMusicTrackFile(trackId, artistId, { wantClip: true });
      } catch (clipErr: any) {
        addLog(`Échec du téléchargement du clip pour "${trackTitle}" (${trackId}), repli sur l'audio seul : ${clipErr.message || clipErr}`);
        result = await downloadMusicTrackFile(trackId, artistId, { wantClip: false });
      }
    } else {
      result = await downloadMusicTrackFile(trackId, artistId, { wantClip: false });
    }

    db.prepare(`
      UPDATE music_tracks
      SET download_status = 'completed', download_progress = 100, download_speed = null, download_eta = null, last_error = null
      WHERE id = ?
    `).run(trackId);
    addLog(`Téléchargement ${result.hasClip ? 'du clip' : 'audio'} RÉUSSI : "${trackTitle}"`);
  } catch (err: any) {
```

Note: `errMsg`/`err` handling below this block (the `catch` body) is unchanged — it already correctly handles whichever error propagates out (either the plain audio failure, or the audio-only fallback's own failure after a clip failure).

- [ ] **Step 5: Extend `cleanupPartialMusicFiles` to also remove partial mp4 clip downloads**

Find:

```ts
  const audioExtensions = ['m4a', 'opus', 'webm', 'mp3', 'ogg', 'wav'];
  const thumbExtensions = ['jpg', 'jpeg', 'webp', 'png'];
  const filesToRemove = [
    ...audioExtensions.map(ext => path.join(artistDir, `${trackId}.${ext}`)),
    ...audioExtensions.flatMap(ext => [
      path.join(artistDir, `${trackId}.${ext}.part`),
      path.join(artistDir, `${trackId}.${ext}.ytdl`),
    ]),
    ...thumbExtensions.map(ext => path.join(artistDir, `${trackId}.${ext}`)),
  ];
```

Replace with:

```ts
  const audioExtensions = ['m4a', 'opus', 'webm', 'mp3', 'ogg', 'wav', 'mp4'];
  const thumbExtensions = ['jpg', 'jpeg', 'webp', 'png'];
  const filesToRemove = [
    ...audioExtensions.map(ext => path.join(artistDir, `${trackId}.${ext}`)),
    ...audioExtensions.flatMap(ext => [
      path.join(artistDir, `${trackId}.${ext}.part`),
      path.join(artistDir, `${trackId}.${ext}.ytdl`),
    ]),
    ...thumbExtensions.map(ext => path.join(artistDir, `${trackId}.${ext}`)),
  ];
```

(This is the cancel/timeout cleanup path only — it is safe to include `mp4` here unconditionally: for a plain audio-only download, no `.mp4`/`.mp4.part` file was ever created, so these extra glob entries just never match anything.)

- [ ] **Step 6: Run the full suite to confirm no regressions**

Run: `npm test -- --run`
Expected: all existing tests pass unchanged (this task touches no Vitest-covered file).

- [ ] **Step 7: Manual verification**

With a real, writable `ffmpeg`/`yt-dlp` environment (skip this step and note it explicitly in your report if the sandbox has neither available — do not fabricate results):
1. `sqlite3 data/youkeep.db "UPDATE settings SET value='1' WHERE key='music_download_clips';"`.
2. Trigger a fresh track ingestion for a followed artist with `sync_status='downloading'` (or manually call `ingestUrl` on a single short real YouTube music video, then flip its artist to `downloading` and call `startMusicQueueWorker()`).
3. Confirm the resulting `music_tracks` row has `has_clip = 1` and `local_file_path` ending in `.mp4`, and that the file exists on disk and is playable (has both audio and video streams — check with `ffprobe` if available).
4. Set `music_download_clips` back to `'0'` and confirm a new track ingested afterward gets `has_clip = 0` and an audio-only file, exactly as before this task.

- [ ] **Step 8: Commit**

```bash
git add server/utils/musicDownloader.ts
git commit -m "feat: download merged video+audio clip when music_download_clips is enabled"
```

---

### Task 4: Admin manual backfill — download a clip for an existing track

**Files:**
- Modify: `server/utils/musicDownloader.ts`
- Create: `server/api/admin/music/tracks/[id]/download-clip.post.ts`
- Test: `tests/integration/music-download-clip.test.ts`

**Interfaces:**
- Consumes: `downloadMusicTrackFile` (Task 3, `{ wantClip?: boolean }` signature), `getActiveMusicDownloadCount`/`incrementActiveMusicDownloadCount`/`decrementActiveMusicDownloadCount`/`wakeMusicWorker`/`sleepOrWakeableMusic` (existing module-level state in `musicDownloader.ts`), `parseMaxConcurrentDownloads`/`hasCapacityForMoreDownloads` (existing, `server/utils/concurrency.ts`), `requireAdmin` (`server/utils/auth.ts`).
- Produces: exported `downloadTrackClip(trackId: string): Promise<void>` (throws on track-not-found or already-has-clip; resolves once the download attempt finishes, success or failure, updating the DB and file on success, leaving everything untouched on failure). `POST /api/admin/music/tracks/[id]/download-clip` → `{ success: true, queued: true }` on 200 (fire-and-forget — does not await the download). Not consumed by any later task.

**Testing note:** the endpoint's validation logic (auth, 404, 409) is fully testable by stubbing `downloadTrackClip` via the module import — see Step 1. The actual download-and-atomic-replace behavior inside `downloadTrackClip` itself has no automated coverage, same rationale as Task 3; verify manually per Step 5.

- [ ] **Step 1: Write the failing tests**

Create `tests/integration/music-download-clip.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import handler from '../../server/api/admin/music/tracks/[id]/download-clip.post';
import * as musicDownloader from '../../server/utils/musicDownloader';
import { createTestDb, insertUser, insertSession, insertMusicArtist, insertMusicTrack, mockEvent, sessionCookie } from '../helpers/testDb';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
  vi.restoreAllMocks();
});

function loginAs(userId: string, role: 'admin' | 'user' = 'user') {
  insertUser(db, { id: userId, role });
  const sessionId = `sess-${userId}`;
  insertSession(db, { id: sessionId, userId });
  return sessionCookie(sessionId);
}

function eventFor(trackId: string, cookieHeader?: string) {
  return mockEvent(cookieHeader, { path: `/api/admin/music/tracks/${trackId}/download-clip`, params: { id: trackId } });
}

describe('POST /api/admin/music/tracks/[id]/download-clip', () => {
  it('returns 401 for a guest', async () => {
    await expect(handler(eventFor('t1'))).rejects.toMatchObject({ statusCode: 401 });
  });

  it('returns 403 for a logged-in non-admin', async () => {
    const cookie = loginAs('u1', 'user');
    await expect(handler(eventFor('t1', cookie))).rejects.toMatchObject({ statusCode: 403 });
  });

  it('returns 404 for a nonexistent track', async () => {
    const cookie = loginAs('admin1', 'admin');
    await expect(handler(eventFor('missing', cookie))).rejects.toMatchObject({ statusCode: 404 });
  });

  it('returns 409 when the track already has a clip', async () => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', hasClip: true });
    const cookie = loginAs('admin1', 'admin');
    await expect(handler(eventFor('t1', cookie))).rejects.toMatchObject({ statusCode: 409 });
  });

  it('returns 200 and queues the download without awaiting it, for an admin', async () => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', hasClip: false });
    const cookie = loginAs('admin1', 'admin');

    const spy = vi.spyOn(musicDownloader, 'downloadTrackClip').mockImplementation(() => new Promise(() => {}));

    const result: any = await handler(eventFor('t1', cookie));
    expect(result).toEqual({ success: true, queued: true });
    expect(spy).toHaveBeenCalledWith('t1');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/integration/music-download-clip.test.ts`
Expected: FAIL — module-not-found for the handler import, and `insertMusicTrack`'s `hasClip` option not yet recognized as a meaningful column (it is from Task 1, so this failure should specifically be the missing handler file).

- [ ] **Step 3: Implement `downloadTrackClip` in `musicDownloader.ts`**

Open `server/utils/musicDownloader.ts`. Add this new exported function after `downloadMusicTrackFile` (which Task 3 already modified):

```ts
/**
 * Manually back-fills a clip for a track that was already ingested audio-only.
 * Unlike the automatic queue path, there is no audio-only fallback here — the
 * track already has working audio, so a failed clip attempt just leaves it
 * untouched. The pre-existing audio file (a different extension than the new
 * .mp4, so yt-dlp cannot clobber it) is only deleted after the new clip file
 * is confirmed on disk and the DB row is updated.
 */
export async function downloadTrackClip(trackId: string): Promise<void> {
  const db = getDb();
  const track = db.prepare('SELECT id, artist_id, local_file_path, has_clip FROM music_tracks WHERE id = ?').get(trackId) as
    { id: string; artist_id: string; local_file_path: string | null; has_clip: number } | undefined;
  if (!track) {
    throw new Error('Track not found');
  }
  if (track.has_clip === 1) {
    throw new Error('Track already has a clip');
  }

  const concurrencySetting = db.prepare("SELECT value FROM settings WHERE key = 'music_max_concurrent_downloads'").get() as { value: string } | undefined;
  const maxConcurrent = parseMaxConcurrentDownloads(concurrencySetting?.value);
  while (!hasCapacityForMoreDownloads(getActiveMusicDownloadCount(), maxConcurrent)) {
    await sleepOrWakeableMusic(1000);
  }

  incrementActiveMusicDownloadCount();
  const previousFilePath = track.local_file_path;
  try {
    await downloadMusicTrackFile(trackId, track.artist_id, { wantClip: true });

    if (previousFilePath) {
      const artist = db.prepare('SELECT name FROM music_artists WHERE id = ?').get(track.artist_id) as { name: string } | undefined;
      const folderName = sanitizeFolderName(artist?.name || track.artist_id);
      const artistDir = path.join(getMusicDownloadsDir(), folderName);
      const previousAudioExtensions = ['m4a', 'opus', 'webm', 'mp3', 'ogg', 'wav'];
      for (const ext of previousAudioExtensions) {
        const oldFile = path.join(artistDir, `${trackId}.${ext}`);
        if (fs.existsSync(oldFile)) {
          try { fs.unlinkSync(oldFile); } catch (e) {}
        }
      }
    }
    addLog(`Clip téléchargé avec succès pour la track ${trackId}.`);
  } catch (err: any) {
    addLog(`Échec du téléchargement du clip pour la track ${trackId} : ${err.message || err}`);
    throw err;
  } finally {
    decrementActiveMusicDownloadCount();
    wakeMusicWorker();
  }
}
```

If the file fails to compile because `parseMaxConcurrentDownloads`/`hasCapacityForMoreDownloads` aren't already imported at the top of `musicDownloader.ts`, check the existing import line — they are already imported (used by `startMusicQueueWorker`), so no new import should be needed for those two. `sanitizeFolderName` and `getMusicDownloadsDir` are likewise already available in this file.

- [ ] **Step 4: Implement the endpoint**

Create `server/api/admin/music/tracks/[id]/download-clip.post.ts`:

```ts
import { defineEventHandler, createError } from 'h3';
import { requireAdmin } from '../../../../../utils/auth';
import { downloadTrackClip } from '../../../../../utils/musicDownloader';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const trackId = event.context.params?.id;

  if (!trackId) {
    throw createError({ statusCode: 400, statusMessage: 'Track ID is required.' });
  }

  const db = getDb();
  const track = db.prepare('SELECT id, has_clip FROM music_tracks WHERE id = ?').get(trackId) as { id: string; has_clip: number } | undefined;
  if (!track) {
    throw createError({ statusCode: 404, statusMessage: 'Track not found.' });
  }
  if (track.has_clip === 1) {
    throw createError({ statusCode: 409, statusMessage: 'Track already has a clip.' });
  }

  // Fire-and-forget: this is ingestion, not a synchronous action — the client
  // polls the track's has_clip field afterward rather than waiting on this request.
  downloadTrackClip(trackId).catch(() => {});

  return { success: true, queued: true };
});
```

If the test run fails with a "not defined" error for `getDb`, add the exact explicit relative import the failure demands.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/integration/music-download-clip.test.ts`
Expected: PASS (all 5 tests).

- [ ] **Step 6: Run the full suite to confirm no regressions**

Run: `npm test -- --run`

- [ ] **Step 7: Manual verification**

Same environment caveat as Task 3 Step 7 — skip and note explicitly if `yt-dlp`/`ffmpeg` aren't available:
1. Pick an existing audio-only track (`has_clip = 0`) with a real `local_file_path`.
2. `curl -X POST http://localhost:PORT/api/admin/music/tracks/{id}/download-clip -H "Cookie: youkeep_session=..."` with an admin session.
3. Confirm the response is `{"success":true,"queued":true}` immediately (not blocked on the download).
4. Poll `sqlite3 data/youkeep.db "SELECT has_clip, local_file_path FROM music_tracks WHERE id='{id}';"` until `has_clip` flips to `1` and `local_file_path` ends in `.mp4`.
5. Confirm the old audio-only file (e.g. `.opus`) has been deleted and the new `.mp4` exists and plays.
6. Repeat the same `curl` call again on the now-clipped track and confirm it returns 409.

- [ ] **Step 8: Commit**

```bash
git add server/utils/musicDownloader.ts server/api/admin/music/tracks/\[id\]/download-clip.post.ts tests/integration/music-download-clip.test.ts
git commit -m "feat: add admin endpoint to manually back-fill a track's clip"
```

---

### Task 5: Serve mp4 clips from the existing downloads-music route

**Files:**
- Modify: `server/routes/downloads-music/[...path].ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `.mp4` files under `/downloads-music/` now serve with `Content-Type: video/mp4` and the existing Range-request support. Not consumed by any later task (client tasks just point `<video src>` at the existing URL scheme).

**Testing note:** no existing test file covers this route (it was verified live in sub-project 4, not via Vitest, because it deals with real file streaming/Range headers). This task follows the same convention — no new test, manual verification only.

- [ ] **Step 1: Add mp4 to the content-type map**

Open `server/routes/downloads-music/[...path].ts`. Find:

```ts
const AUDIO_CONTENT_TYPES: Record<string, string> = {
  '.m4a': 'audio/mp4',
  '.opus': 'audio/opus',
  '.webm': 'audio/webm',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
};
```

Replace with:

```ts
const AUDIO_CONTENT_TYPES: Record<string, string> = {
  '.m4a': 'audio/mp4',
  '.opus': 'audio/opus',
  '.webm': 'audio/webm',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
};
```

(The variable is still named `AUDIO_CONTENT_TYPES` and the route's internal `isAudio` check — do not rename either; this map's real purpose is "non-image, streamable media with Range support," which mp4 fits exactly the same way the existing audio formats do. Renaming would be a cosmetic-only change outside this task's scope.)

- [ ] **Step 2: Run the full suite to confirm no regressions**

Run: `npm test -- --run`

- [ ] **Step 3: Manual verification**

After Task 3 or Task 4 has produced at least one real `.mp4` clip file on disk:
1. `curl -I http://localhost:PORT/downloads-music/{artistFolder}/{trackId}.mp4` and confirm `Content-Type: video/mp4`.
2. `curl -H "Range: bytes=0-1023" -I http://localhost:PORT/downloads-music/{artistFolder}/{trackId}.mp4` and confirm `206 Partial Content` with a `Content-Range` header, matching the existing behavior already proven for audio files.

- [ ] **Step 4: Commit**

```bash
git add server/routes/downloads-music/\[...path\].ts
git commit -m "feat: serve mp4 clips with Range support from downloads-music"
```

---

### Task 6: Expose `has_clip` across every track-reading endpoint

**Files:**
- Modify: `server/api/music/artists/[id]/tracks.get.ts`
- Modify: `server/api/music/tracks/by-ids.post.ts`
- Modify: `server/api/music/playlists/most-played.get.ts`
- Modify: `server/api/music/playlists/recently-added.get.ts`
- Modify: `server/api/music/playlists/rediscover.get.ts`
- Modify: `server/api/music/playlists/genre-mix.get.ts`
- Test: `tests/integration/music-artist-tracks.test.ts` (extend)
- Test: `tests/integration/music-tracks-by-ids.test.ts` (extend)
- Test: `tests/integration/music-playlists.test.ts` (extend)

**Interfaces:**
- Consumes: `has_clip` column (Task 1).
- Produces: every track object returned by any of these six endpoints now includes `has_clip: 0 | 1`. Consumed by Task 7/8 (client — the pill and clip-mode gating need this field on every code path that can hand a track to the player, not just the ones this plan's author happened to think of first).

**Why this task exists as its own unit:** sub-project 4 shipped a real cross-branch bug precisely from this pattern — a pre-existing, unmodified endpoint (`artists/[id]/tracks.get.ts`) didn't select a field the new client code needed, so playback silently failed for that one entry point while working fine everywhere else. This task explicitly audits and fixes all six track-shaped read paths at once, rather than discovering the gaps one broken pill at a time.

- [ ] **Step 1: `artists/[id]/tracks.get.ts` — add `has_clip` to the SELECT and a regression test**

Open `server/api/music/artists/[id]/tracks.get.ts`. Find:

```ts
  const tracks = db.prepare(`
    SELECT t.id, t.title, t.track_number, t.genre, t.language, t.duration,
           t.local_file_path, t.local_thumbnail_path, t.artist_id, a.name as artist_name
    FROM music_tracks t
```

Replace with:

```ts
  const tracks = db.prepare(`
    SELECT t.id, t.title, t.track_number, t.genre, t.language, t.duration,
           t.local_file_path, t.local_thumbnail_path, t.has_clip, t.artist_id, a.name as artist_name
    FROM music_tracks t
```

Open `tests/integration/music-artist-tracks.test.ts`. Find:

```ts
  it('includes local_file_path and artist_name needed for playback', async () => {
    insertMusicArtist(db, { id: 'a1', name: 'Test Artist' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', albumId: null, localFilePath: '/downloads-music/a1/t1.opus' });

    const result: any = await handler(eventFor('a1', '?albumId=none'));
    expect(result.tracks[0].local_file_path).toBe('/downloads-music/a1/t1.opus');
    expect(result.tracks[0].artist_name).toBe('Test Artist');
  });
```

Add immediately after it:

```ts
  it('includes has_clip', async () => {
    insertMusicArtist(db, { id: 'a1', name: 'Test Artist' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', albumId: null, hasClip: true });
    insertMusicTrack(db, { id: 't2', artistId: 'a1', albumId: null, hasClip: false });

    const result: any = await handler(eventFor('a1', '?albumId=none'));
    const byId = Object.fromEntries(result.tracks.map((t: any) => [t.id, t.has_clip]));
    expect(byId['t1']).toBe(1);
    expect(byId['t2']).toBe(0);
  });
```

- [ ] **Step 2: `tracks/by-ids.post.ts` — same change**

Open `server/api/music/tracks/by-ids.post.ts`. Find:

```ts
  const rows = db.prepare(`
    SELECT t.id, t.title, t.track_number, t.genre, t.language, t.duration,
           t.local_file_path, t.local_thumbnail_path, t.artist_id, a.name as artist_name
    FROM music_tracks t
```

Replace with:

```ts
  const rows = db.prepare(`
    SELECT t.id, t.title, t.track_number, t.genre, t.language, t.duration,
           t.local_file_path, t.local_thumbnail_path, t.has_clip, t.artist_id, a.name as artist_name
    FROM music_tracks t
```

Open `tests/integration/music-tracks-by-ids.test.ts` and read it fully to find its existing test-setup pattern (artist/track insertion, endpoint call, assertion style). Add a new test in the same file, following that exact pattern, asserting a track inserted with `hasClip: true` comes back with `has_clip === 1` and one inserted with `hasClip: false` (or omitted) comes back with `has_clip === 0`.

- [ ] **Step 3: The four playlist endpoints — same change**

Each of these four files has the identical SELECT shape. In each, find:

```sql
    SELECT t.id, t.title, t.track_number, t.genre, t.language, t.duration,
           t.local_file_path, t.local_thumbnail_path, t.artist_id, a.name as artist_name
```

Replace with:

```sql
    SELECT t.id, t.title, t.track_number, t.genre, t.language, t.duration,
           t.local_file_path, t.local_thumbnail_path, t.has_clip, t.artist_id, a.name as artist_name
```

Apply this in:
- `server/api/music/playlists/most-played.get.ts`
- `server/api/music/playlists/recently-added.get.ts`
- `server/api/music/playlists/rediscover.get.ts`
- `server/api/music/playlists/genre-mix.get.ts`

Open `tests/integration/music-playlists.test.ts` and read it fully. Add one test per endpoint's existing `describe` block asserting a track inserted with `hasClip: true` shows up with `has_clip === 1` in that endpoint's response — following the file's existing setup pattern for each endpoint (each already has helpers for inserting a play-history row or setting genre, etc.; reuse those).

- [ ] **Step 4: Run all the extended test files to verify they pass**

Run: `npx vitest run tests/integration/music-artist-tracks.test.ts tests/integration/music-tracks-by-ids.test.ts tests/integration/music-playlists.test.ts`
Expected: PASS, including the new tests.

- [ ] **Step 5: Run the full suite to confirm no regressions**

Run: `npm test -- --run`

- [ ] **Step 6: Commit**

```bash
git add server/api/music/artists/\[id\]/tracks.get.ts server/api/music/tracks/by-ids.post.ts server/api/music/playlists/most-played.get.ts server/api/music/playlists/recently-added.get.ts server/api/music/playlists/rediscover.get.ts server/api/music/playlists/genre-mix.get.ts tests/integration/music-artist-tracks.test.ts tests/integration/music-tracks-by-ids.test.ts tests/integration/music-playlists.test.ts
git commit -m "feat: expose has_clip on every track-reading endpoint"
```

---

### Task 7: Player clip-mode support — composable and mini-player

**Files:**
- Modify: `app/composables/useMusicPlayer.ts`
- Modify: `app/components/MusicMiniPlayer.vue`

**Interfaces:**
- Consumes: `has_clip` field on `PlayableTrack` objects (Task 6).
- Produces: `useMusicPlayer()` gains `clipMode: Ref<boolean>` and `setClipMode(on: boolean): void` in its returned object. `audioEl`'s type changes from `Ref<HTMLAudioElement | null>` to `Ref<HTMLMediaElement | null>`. Consumed by Task 8 (the pill button calls `setClipMode`).

**No automated tests for this task** — this repo has no test infrastructure for Vue composables/components, and this is exactly the class of file (stateful playback logic, DOM element lifecycle) that shipped a CRITICAL bug in sub-project 4. Verification is manual hand-tracing during review plus live browser verification by the controller after this task lands (see Step 7).

**Design decision locked in here (resolves an intentional ambiguity in the spec):** the spec describes "the mini-player displays a `<video>` instead of `<audio>`." The safe implementation is a **single, always-mounted `<video>` element** (never `<audio>` at all — `<video>` plays audio-only files identically), toggled only via `v-show` between "hidden, cover art shown" and "visible, video shown." This avoids ever having two competing media elements and avoids the exact `v-if`-unmounts-the-active-element bug class from sub-project 4. Do not implement this as two separate elements that get swapped.

- [ ] **Step 1: Add `has_clip` to `PlayableTrack` and add clip-mode state**

Open `app/composables/useMusicPlayer.ts`. Find:

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
```

Replace with:

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
  has_clip?: number;
}
```

- [ ] **Step 2: Retype `audioEl` and add `clipMode`**

Find:

```ts
  const audioEl = useState<HTMLAudioElement | null>('music_player_audio_el', () => null);
  const shuffleOn = useState<boolean>('music_player_shuffle', () => false);
```

Replace with:

```ts
  const audioEl = useState<HTMLMediaElement | null>('music_player_audio_el', () => null);
  const shuffleOn = useState<boolean>('music_player_shuffle', () => false);
  const clipMode = useState<boolean>('music_player_clip_mode', () => false);
```

- [ ] **Step 3: Reset `clipMode` in `loadTrack` when the new track has no clip, and add `setClipMode`**

Find:

```ts
  function loadTrack(track: PlayableTrack, index: number) {
    currentTrack.value = track;
    currentIndex.value = index;
    hasCountedThisPlay.value = false;
    currentTime.value = 0;
    duration.value = 0;
    if (audioEl.value) {
      audioEl.value.src = track.local_file_path;
      audioEl.value.currentTime = 0;
    }
  }
```

Replace with:

```ts
  function loadTrack(track: PlayableTrack, index: number) {
    currentTrack.value = track;
    currentIndex.value = index;
    hasCountedThisPlay.value = false;
    currentTime.value = 0;
    duration.value = 0;
    if (!track.has_clip) {
      clipMode.value = false;
    }
    if (audioEl.value) {
      audioEl.value.src = track.local_file_path;
      audioEl.value.currentTime = 0;
    }
  }

  function setClipMode(on: boolean) {
    if (on && !currentTrack.value?.has_clip) return;
    clipMode.value = on;
  }
```

- [ ] **Step 4: Export the new state and function**

Find the `return` statement at the end of the file:

```ts
  return {
    currentTrack, queue, currentIndex, isPlaying, currentTime, duration, audioEl,
    shuffleOn, repeatMode,
    play, togglePlay, seek, next, prev, toggleShuffle, cycleRepeat,
    recordPlayIfThresholdReached, saveToLocalStorage, restoreFromLocalStorage,
  };
```

Replace with:

```ts
  return {
    currentTrack, queue, currentIndex, isPlaying, currentTime, duration, audioEl,
    shuffleOn, repeatMode, clipMode,
    play, togglePlay, seek, next, prev, toggleShuffle, cycleRepeat, setClipMode,
    recordPlayIfThresholdReached, saveToLocalStorage, restoreFromLocalStorage,
  };
```

- [ ] **Step 5: Swap `<audio>` for a single always-mounted `<video>` in the mini-player, add the pill/toggle UI hooks**

Open `app/components/MusicMiniPlayer.vue`. Find the template's media element:

```html
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
```

Replace with:

```html
  <video
    ref="audioElRef"
    v-show="clipMode"
    class="mini-player-video"
    @timeupdate="onTimeUpdate"
    @loadedmetadata="onLoadedMetadata"
    @durationchange="onLoadedMetadata"
    @ended="onEnded"
    @play="isPlaying = true"
    @pause="isPlaying = false"
    @error="onAudioError"
  ></video>
```

Find the cover art `<img>`:

```html
    <img :src="currentTrack.local_thumbnail_path || fallbackCover" class="mini-player-cover" alt="" />
```

Replace with:

```html
    <img v-if="!clipMode" :src="currentTrack.local_thumbnail_path || fallbackCover" class="mini-player-cover" alt="" />
```

Find the info block (title/artist), and add a clip toggle button right after it:

```html
    <div class="mini-player-info">
      <span class="mini-player-title">{{ currentTrack.title }}</span>
      <span class="mini-player-artist">{{ currentTrack.artist_name || '' }}</span>
    </div>
```

Replace with:

```html
    <div class="mini-player-info">
      <span class="mini-player-title">{{ currentTrack.title }}</span>
      <span class="mini-player-artist">{{ currentTrack.artist_name || '' }}</span>
    </div>

    <button
      v-if="currentTrack.has_clip"
      @click="setClipMode(!clipMode)"
      class="mini-player-btn mini-player-clip-toggle"
      :class="{ active: clipMode }"
      :title="clipMode ? 'Repasser en mode audio' : 'Voir le clip'"
    >
      🎬
    </button>
```

- [ ] **Step 6: Update the script — import `clipMode`/`setClipMode`, retype the ref, reset `clipMode` on error**

Find:

```ts
const {
  currentTrack, isPlaying, currentTime, duration,
  audioEl, shuffleOn, repeatMode,
  togglePlay, seek, next, prev, toggleShuffle, cycleRepeat,
  recordPlayIfThresholdReached, saveToLocalStorage, restoreFromLocalStorage,
} = useMusicPlayer();

const toast = useToast();
const audioElRef = ref<HTMLAudioElement | null>(null);
```

Replace with:

```ts
const {
  currentTrack, isPlaying, currentTime, duration,
  audioEl, shuffleOn, repeatMode, clipMode,
  togglePlay, seek, next, prev, toggleShuffle, cycleRepeat, setClipMode,
  recordPlayIfThresholdReached, saveToLocalStorage, restoreFromLocalStorage,
} = useMusicPlayer();

const toast = useToast();
const audioElRef = ref<HTMLVideoElement | null>(null);
```

Find `onAudioError`:

```ts
function onAudioError() {
  toast.error('Erreur de lecture audio.');
  isPlaying.value = false;
}
```

Replace with:

```ts
function onAudioError() {
  toast.error('Erreur de lecture audio.');
  isPlaying.value = false;
  setClipMode(false);
}
```

- [ ] **Step 7: Add a small style rule for the inline video and the clip toggle button**

Open the `<style scoped>` block. Find:

```css
.mini-player-cover {
  width: 48px;
  height: 48px;
  border-radius: var(--border-radius-md);
  object-fit: cover;
  flex-shrink: 0;
}
```

Add immediately after it:

```css
.mini-player-video {
  width: 48px;
  height: 48px;
  border-radius: var(--border-radius-md);
  object-fit: cover;
  flex-shrink: 0;
  background: #000;
}

.mini-player-clip-toggle {
  font-size: 16px;
}

.mini-player-clip-toggle.active {
  color: var(--accent-primary);
}
```

- [ ] **Step 8: Type-check**

Run: `npx vue-tsc -b --noEmit`
Expected: no new errors beyond the 2 known pre-existing ones (`VideoPlayer.vue`, `subscriptions.vue`).

- [ ] **Step 9: Commit**

```bash
git add app/composables/useMusicPlayer.ts app/components/MusicMiniPlayer.vue
git commit -m "feat: add clip-mode playback to the music player (single video element, v-show toggle)"
```

---

### Task 8: Client UI — clip pill, admin backfill button, settings toggle

**Files:**
- Modify: `app/pages/music/index.vue`
- Modify: `app/pages/settings.vue`

**Interfaces:**
- Consumes: `has_clip` on track objects (Task 6), `clipMode`/`setClipMode` from `useMusicPlayer()` (Task 7), `GET /api/settings/music-clips` / `POST /api/admin/settings/music-clips` (Task 2), `POST /api/admin/music/tracks/[id]/download-clip` (Task 4).
- Produces: nothing consumed by a later task (last task in this plan).

**No automated tests for this task** — same rationale as Task 7 (no Vue component test infra). Verify manually per Step 6.

- [ ] **Step 1: Add `useToast` and read `clipMode`/`setClipMode` in `app/pages/music/index.vue`**

Open `app/pages/music/index.vue`. Find:

```ts
import { ref, reactive, computed, watch, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuth } from '~/composables/useAuth';
import { useMusicPlayer } from '~/composables/useMusicPlayer';

const { isAdmin } = useAuth();
const { currentTrack, play: playMusicTrack } = useMusicPlayer();
```

Replace with:

```ts
import { ref, reactive, computed, watch, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuth } from '~/composables/useAuth';
import { useMusicPlayer } from '~/composables/useMusicPlayer';
import { useToast } from '~/composables/useToast';

const { isAdmin } = useAuth();
const { currentTrack, clipMode, play: playMusicTrack, setClipMode } = useMusicPlayer();
const toast = useToast();
```

- [ ] **Step 2: Add a `downloadingClip` tracking set and the trigger function**

Find `playTrack`:

```ts
function playTrack(track: any, groupKey: string) {
  if (!track.local_file_path) return;
  const group = trackGroups[groupKey];
  if (!group) return;
  playMusicTrack(track, group.tracks);
}
```

Add immediately after it:

```ts
const downloadingClipIds = ref<Set<string>>(new Set());

async function downloadClip(track: any) {
  if (downloadingClipIds.value.has(track.id)) return;
  downloadingClipIds.value = new Set([...downloadingClipIds.value, track.id]);
  try {
    await $fetch(`/api/admin/music/tracks/${track.id}/download-clip`, { method: 'POST' });
    toast.success('Téléchargement du clip lancé — la pastille apparaîtra une fois terminé.');
  } catch (e: any) {
    toast.error(e?.data?.statusMessage || 'Erreur lors du lancement du téléchargement du clip.');
    downloadingClipIds.value = new Set([...downloadingClipIds.value].filter((id) => id !== track.id));
  }
}

function toggleTrackClipMode(e: Event, track: any) {
  e.stopPropagation();
  setClipMode(!(clipMode.value && currentTrack.value?.id === track.id));
}
```

- [ ] **Step 3: Add the pill and admin backfill button to both track-row blocks**

Open the template. Find (this block appears twice — once for album tracks, once for standalone tracks; the album-tracks copy is shown here):

```html
              <span class="track-number">{{ track.track_number || '–' }}</span>
              <span class="track-title">{{ track.title }}</span>
              <span v-if="track.genre" class="badge badge-pending">{{ track.genre }}</span>
              <span v-if="track.language" class="badge badge-pending">{{ track.language }}</span>
              <span class="track-duration">{{ formatDuration(track.duration) }}</span>
              <button v-if="isAdmin" @click.stop="openTrackEdit(track, album.id)" class="edit-btn" title="Modifier">
```

Replace with:

```html
              <span class="track-number">{{ track.track_number || '–' }}</span>
              <span class="track-title">{{ track.title }}</span>
              <span v-if="track.genre" class="badge badge-pending">{{ track.genre }}</span>
              <span v-if="track.language" class="badge badge-pending">{{ track.language }}</span>
              <button
                v-if="track.has_clip"
                @click="toggleTrackClipMode($event, track)"
                class="badge badge-clip"
                title="Voir le clip"
              >
                🎬 Clip
              </button>
              <button
                v-else-if="isAdmin"
                @click.stop="downloadClip(track)"
                :disabled="downloadingClipIds.has(track.id)"
                class="btn btn-secondary load-more-btn"
              >
                {{ downloadingClipIds.has(track.id) ? 'Téléchargement…' : 'Télécharger le clip' }}
              </button>
              <span class="track-duration">{{ formatDuration(track.duration) }}</span>
              <button v-if="isAdmin" @click.stop="openTrackEdit(track, album.id)" class="edit-btn" title="Modifier">
```

Then find the second, near-identical copy (standalone tracks — note `album.id` becomes `'none'`):

```html
              <span class="track-number">{{ track.track_number || '–' }}</span>
              <span class="track-title">{{ track.title }}</span>
              <span v-if="track.genre" class="badge badge-pending">{{ track.genre }}</span>
              <span v-if="track.language" class="badge badge-pending">{{ track.language }}</span>
              <span class="track-duration">{{ formatDuration(track.duration) }}</span>
              <button v-if="isAdmin" @click.stop="openTrackEdit(track, 'none')" class="edit-btn" title="Modifier">
```

Replace with:

```html
              <span class="track-number">{{ track.track_number || '–' }}</span>
              <span class="track-title">{{ track.title }}</span>
              <span v-if="track.genre" class="badge badge-pending">{{ track.genre }}</span>
              <span v-if="track.language" class="badge badge-pending">{{ track.language }}</span>
              <button
                v-if="track.has_clip"
                @click="toggleTrackClipMode($event, track)"
                class="badge badge-clip"
                title="Voir le clip"
              >
                🎬 Clip
              </button>
              <button
                v-else-if="isAdmin"
                @click.stop="downloadClip(track)"
                :disabled="downloadingClipIds.has(track.id)"
                class="btn btn-secondary load-more-btn"
              >
                {{ downloadingClipIds.has(track.id) ? 'Téléchargement…' : 'Télécharger le clip' }}
              </button>
              <span class="track-duration">{{ formatDuration(track.duration) }}</span>
              <button v-if="isAdmin" @click.stop="openTrackEdit(track, 'none')" class="edit-btn" title="Modifier">
```

- [ ] **Step 4: Add the `.badge-clip` style**

Find the `<style scoped>` block's existing badge rules (search for `.badge-pending` inside this file) and add immediately after that rule:

```css
.badge-clip {
  cursor: pointer;
  border: none;
  background: rgba(139, 92, 246, 0.15);
  color: var(--accent-primary);
}

.badge-clip:hover {
  background: rgba(139, 92, 246, 0.25);
}
```

- [ ] **Step 5: Add the Settings toggle**

Open `app/pages/settings.vue`. Find:

```html
        <!-- ================= MUSIC TAB ================= -->
        <div v-if="activeTab === 'music' && isAdmin" class="tab-pane">
          <div class="downloads-header-panel glass-panel" style="margin-bottom: 16px;">
            <div class="header-text">
              <h2>Module Musique</h2>
              <p>Active ou désactive tout l'espace Musique pour les utilisateurs non-admin (navigation, lecture, API). Les administrateurs gardent toujours accès.</p>
            </div>
            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
              <input type="checkbox" v-model="musicModuleEnabled" @change="toggleMusicModule" :disabled="togglingMusicModule" />
              <span>{{ musicModuleEnabled ? 'Activé' : 'Désactivé' }}</span>
            </label>
          </div>

          <div class="downloads-header-panel glass-panel">
            <div class="header-text">
              <h2>Music Ingestion</h2>
```

Replace with:

```html
        <!-- ================= MUSIC TAB ================= -->
        <div v-if="activeTab === 'music' && isAdmin" class="tab-pane">
          <div class="downloads-header-panel glass-panel" style="margin-bottom: 16px;">
            <div class="header-text">
              <h2>Module Musique</h2>
              <p>Active ou désactive tout l'espace Musique pour les utilisateurs non-admin (navigation, lecture, API). Les administrateurs gardent toujours accès.</p>
            </div>
            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
              <input type="checkbox" v-model="musicModuleEnabled" @change="toggleMusicModule" :disabled="togglingMusicModule" />
              <span>{{ musicModuleEnabled ? 'Activé' : 'Désactivé' }}</span>
            </label>
          </div>

          <div class="downloads-header-panel glass-panel" style="margin-bottom: 16px;">
            <div class="header-text">
              <h2>Clips vidéo</h2>
              <p>Télécharge aussi la vidéo (clip officiel) pour chaque nouvelle piste ingérée, en plus de l'audio. Les pistes déjà téléchargées ne sont pas affectées automatiquement — utilise le bouton « Télécharger le clip » sur une piste existante pour la rattraper manuellement.</p>
            </div>
            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
              <input type="checkbox" v-model="musicDownloadClipsEnabled" @change="toggleMusicDownloadClips" :disabled="togglingMusicDownloadClips" />
              <span>{{ musicDownloadClipsEnabled ? 'Activé' : 'Désactivé' }}</span>
            </label>
          </div>

          <div class="downloads-header-panel glass-panel">
            <div class="header-text">
              <h2>Music Ingestion</h2>
```

- [ ] **Step 6: Add the corresponding script state and fetch/toggle functions**

Find:

```ts
const musicModuleEnabled = ref(true);
const togglingMusicModule = ref(false);

async function fetchMusicModuleEnabled() {
  try {
    const data = await $fetch<{ enabled: boolean }>('/api/settings/music-module');
    musicModuleEnabled.value = data.enabled;
  } catch (e) {
    // leave the default
  }
}

async function toggleMusicModule() {
  togglingMusicModule.value = true;
  const desired = musicModuleEnabled.value;
  try {
    await $fetch('/api/admin/settings/music-module', { method: 'POST', body: { enabled: desired } });
    toast.success(desired ? 'Module Musique activé.' : 'Module Musique désactivé.');
  } catch (e: any) {
    musicModuleEnabled.value = !desired;
    toast.error(e?.data?.statusMessage || 'Erreur lors de la mise à jour du module Musique.');
  } finally {
    togglingMusicModule.value = false;
  }
}
```

Add immediately after it:

```ts
const musicDownloadClipsEnabled = ref(false);
const togglingMusicDownloadClips = ref(false);

async function fetchMusicDownloadClipsEnabled() {
  try {
    const data = await $fetch<{ enabled: boolean }>('/api/settings/music-clips');
    musicDownloadClipsEnabled.value = data.enabled;
  } catch (e) {
    // leave the default
  }
}

async function toggleMusicDownloadClips() {
  togglingMusicDownloadClips.value = true;
  const desired = musicDownloadClipsEnabled.value;
  try {
    await $fetch('/api/admin/settings/music-clips', { method: 'POST', body: { enabled: desired } });
    toast.success(desired ? 'Téléchargement des clips activé.' : 'Téléchargement des clips désactivé.');
  } catch (e: any) {
    musicDownloadClipsEnabled.value = !desired;
    toast.error(e?.data?.statusMessage || 'Erreur lors de la mise à jour du réglage des clips.');
  } finally {
    togglingMusicDownloadClips.value = false;
  }
}
```

Find the `onMounted` block:

```ts
onMounted(() => {
  if (isAdmin.value) {
    fetchSchedule();
    fetchDefaultDir();
    fetchSponsorBlockSettings();
    fetchConcurrency();
    runPolling();
    fetchMusicConcurrency();
    runMusicPolling();
    fetchMusicModuleEnabled();
  }
});
```

Replace with:

```ts
onMounted(() => {
  if (isAdmin.value) {
    fetchSchedule();
    fetchDefaultDir();
    fetchSponsorBlockSettings();
    fetchConcurrency();
    runPolling();
    fetchMusicConcurrency();
    runMusicPolling();
    fetchMusicModuleEnabled();
    fetchMusicDownloadClipsEnabled();
  }
});
```

- [ ] **Step 7: Type-check**

Run: `npx vue-tsc -b --noEmit`
Expected: no new errors beyond the 2 known pre-existing ones.

- [ ] **Step 8: Manual verification**

1. Start the dev server, log in as admin, go to Settings → Music, confirm the new "Clips vidéo" panel shows "Désactivé" by default; toggle it, confirm a success toast and that the checkbox state persists across a page reload.
2. On `/music`, find a track with `has_clip = 1` (from Task 3/4's manual verification) and confirm the "🎬 Clip" pill appears; click it, confirm the mini-player shows video at the correct playback position; click again, confirm it reverts to cover art without losing position or pausing playback.
3. Confirm next/prev/shuffle/repeat all keep working while in clip mode, and that advancing to a track without a clip automatically drops back to cover-art mode.
4. As admin, find a track without a clip and confirm the "Télécharger le clip" button appears and is absent for a non-admin session on the same track.
5. Confirm `npx vue-tsc -b --noEmit` stays clean and `npm test -- --run` still passes in full.

- [ ] **Step 9: Commit**

```bash
git add app/pages/music/index.vue app/pages/settings.vue
git commit -m "feat: add clip pill, admin backfill button, and clips setting toggle to the UI"
```
