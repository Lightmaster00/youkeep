# Music Ingestion from YouTube Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let YouKeep follow a YouTube channel or single video as music, downloading audio-only into the `music_*` tables via a new, independent pipeline that mirrors the existing video downloader.

**Architecture:** A new module `server/utils/musicDownloader.ts` mirrors `server/utils/downloader.ts`'s three-part shape (ingestion, per-track download, concurrent queue worker) adapted for audio. It shares nothing at runtime with the video pipeline except the already-generic `server/utils/concurrency.ts` helpers — its own settings keys, its own in-memory process map, its own worker loop. New admin API endpoints under `server/api/admin/music/` mirror the existing `server/api/admin/downloader/*` and `channels/[id]/sync.post.ts` endpoints one-for-one.

**Tech Stack:** yt-dlp (audio extraction via `-x`), better-sqlite3, Nitro server routes, Vitest for the one unit-testable piece (metadata parsing).

## Global Constraints

- No UI changes of any kind (sub-project 3's job) — verification is via direct DB inspection and `curl`.
- No automatic feat-artist detection or title/description-based metadata guessing — a field yt-dlp doesn't expose stays `NULL`.
- No re-encoding — best available native audio stream, no format conversion.
- No per-artist custom save path — one fixed directory, `data/downloads-music/` (mirroring the `/downloads/videos`-then-local-fallback pattern of `getDownloadsDir`, but with no settings-based override, since none exists for music yet).
- The music worker is fully independent of the video worker: separate settings (`music_downloader_paused` default `'0'`, `music_max_concurrent_downloads` default `'2'`), separate in-memory state, separate concurrency limit.
- Every ingested track gets exactly one `music_track_artists` row (`role = 'primary'`) — never zero after a successful download, never more than one, never `'feat'`.
- An album is only ever matched-and-reused by `(artist_id, title)` or newly created with `source = 'youtube'` — a `source = 'manual'` album's own fields are never overwritten by ingestion.

---

### Task 1: Fix a gap in the sub-project-1 schema — add file-path columns to `music_tracks`

**Files:**
- Modify: `server/utils/db.ts:270` (end of the existing `ALTER TABLE` migration list, immediately before the blank line and the `// Indexes on frequently filtered/joined columns` comment)

**Interfaces:**
- Consumes: nothing.
- Produces: three new nullable columns on `music_tracks` — `local_file_path TEXT`, `local_thumbnail_path TEXT`, `size_bytes INTEGER` — that Task 5 (the download function) writes to. Without these, there would be nowhere to record where a downloaded audio file lives.

The design spec for the data model (sub-project 1) incorrectly assumed `videos` locates its downloaded file purely "by convention" (`{id}.mp4`), with no DB column for it. That's wrong: `videos` actually stores `local_video_path`, `local_thumbnail_path`, and `size_bytes` as real columns (`server/utils/db.ts:86-87,92`). `music_tracks` needs the same three columns, added now via the standard `ALTER TABLE` migration pattern already used for every other post-creation column addition in this file.

- [ ] **Step 1: Add the three `ALTER TABLE` lines**

In `server/utils/db.ts`, this is the current end of the migration list:

```typescript
  try { db.exec(`ALTER TABLE user_history ADD COLUMN watch_time_seconds INTEGER DEFAULT 0;`); } catch (e) {}

  // Indexes on frequently filtered/joined columns that lack one (primary keys
```

Change it to:

```typescript
  try { db.exec(`ALTER TABLE user_history ADD COLUMN watch_time_seconds INTEGER DEFAULT 0;`); } catch (e) {}
  try { db.exec(`ALTER TABLE music_tracks ADD COLUMN local_file_path TEXT;`); } catch (e) {}
  try { db.exec(`ALTER TABLE music_tracks ADD COLUMN local_thumbnail_path TEXT;`); } catch (e) {}
  try { db.exec(`ALTER TABLE music_tracks ADD COLUMN size_bytes INTEGER;`); } catch (e) {}

  // Indexes on frequently filtered/joined columns that lack one (primary keys
```

- [ ] **Step 2: Verify the columns exist**

```bash
cat > scratch_verify_music_columns.ts <<'EOF'
import { getDb } from './server/utils/db';

const db = getDb();
const cols = db.prepare(`PRAGMA table_info(music_tracks)`).all() as { name: string }[];
const names = cols.map(c => c.name);
console.log('music_tracks columns:', names);
for (const expected of ['local_file_path', 'local_thumbnail_path', 'size_bytes']) {
  console.log(`Has ${expected}:`, names.includes(expected));
}
EOF
npx --yes tsx scratch_verify_music_columns.ts
rm -f scratch_verify_music_columns.ts
```

Expected: `Has local_file_path: true`, `Has local_thumbnail_path: true`, `Has size_bytes: true`.

- [ ] **Step 3: Commit**

```bash
git add server/utils/db.ts
git commit -m "fix: add missing file-path columns to music_tracks

Sub-project 1's design incorrectly assumed videos locates its file
purely by convention. It actually stores local_video_path/
local_thumbnail_path/size_bytes as real columns — music_tracks needs
the same three, added here so ingestion has somewhere to write them."
```

---

### Task 2: Pure music metadata parser

**Files:**
- Create: `server/utils/musicMetadata.ts`
- Test: `tests/unit/musicMetadata.test.ts`

**Interfaces:**
- Produces: `interface ParsedMusicMetadata { album: string | null; genre: string | null; trackNumber: number | null; releaseYear: number | null; }` and `parseMusicMetadataFromInfoData(infoData: any): ParsedMusicMetadata`, consumed by Task 5.

Follows the same extraction pattern as `server/utils/chapters.ts` / `server/utils/concurrency.ts` — pure logic, no DB/network, tested directly with Vitest (see `tests/unit/chapters.test.ts` for the established convention this project uses).

yt-dlp's `--write-info-json` output exposes `album`, `genre`, `track_number`, and `release_year` as top-level fields when a video carries YouTube Music-style Content ID metadata (common on official music uploads/"Topic" channels), and omits them otherwise. **This field-name assumption has not been verified against a real download yet** — Task 8 (end-to-end verification with a real music channel) is where that gets confirmed. If the real yt-dlp output uses different field names, come back and adjust this function then; it won't invalidate the unit tests below, which test the function's own logic against a given (mocked) object, independent of what yt-dlp actually outputs.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/musicMetadata.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseMusicMetadataFromInfoData } from '../../server/utils/musicMetadata';

describe('parseMusicMetadataFromInfoData', () => {
  it('returns all-null when infoData is missing or empty', () => {
    expect(parseMusicMetadataFromInfoData(null)).toEqual({ album: null, genre: null, trackNumber: null, releaseYear: null });
    expect(parseMusicMetadataFromInfoData(undefined)).toEqual({ album: null, genre: null, trackNumber: null, releaseYear: null });
    expect(parseMusicMetadataFromInfoData({})).toEqual({ album: null, genre: null, trackNumber: null, releaseYear: null });
  });

  it('parses all fields when fully present', () => {
    const result = parseMusicMetadataFromInfoData({
      album: 'Test Album',
      genre: 'Electronic',
      track_number: 3,
      release_year: 2024
    });
    expect(result).toEqual({ album: 'Test Album', genre: 'Electronic', trackNumber: 3, releaseYear: 2024 });
  });

  it('leaves individual fields null when only some are present', () => {
    const result = parseMusicMetadataFromInfoData({ album: 'Only Album Known' });
    expect(result).toEqual({ album: 'Only Album Known', genre: null, trackNumber: null, releaseYear: null });
  });

  it('trims whitespace and treats an empty/whitespace-only string as absent', () => {
    expect(parseMusicMetadataFromInfoData({ album: '  Padded Title  ' }).album).toBe('Padded Title');
    expect(parseMusicMetadataFromInfoData({ album: '   ' }).album).toBeNull();
    expect(parseMusicMetadataFromInfoData({ genre: '' }).genre).toBeNull();
  });

  it('ignores fields with the wrong type instead of coercing them', () => {
    const result = parseMusicMetadataFromInfoData({
      album: 12345,
      genre: ['not', 'a', 'string'],
      track_number: '3',
      release_year: '2024'
    });
    expect(result).toEqual({ album: null, genre: null, trackNumber: null, releaseYear: null });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/musicMetadata.test.ts`
Expected: FAIL with "Cannot find module '../../server/utils/musicMetadata'"

- [ ] **Step 3: Write the implementation**

Create `server/utils/musicMetadata.ts`:

```typescript
export interface ParsedMusicMetadata {
  album: string | null;
  genre: string | null;
  trackNumber: number | null;
  releaseYear: number | null;
}

function parseNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseIntegerField(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

export function parseMusicMetadataFromInfoData(infoData: any): ParsedMusicMetadata {
  if (!infoData) {
    return { album: null, genre: null, trackNumber: null, releaseYear: null };
  }
  return {
    album: parseNonEmptyString(infoData.album),
    genre: parseNonEmptyString(infoData.genre),
    trackNumber: parseIntegerField(infoData.track_number),
    releaseYear: parseIntegerField(infoData.release_year),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/musicMetadata.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add server/utils/musicMetadata.ts tests/unit/musicMetadata.test.ts
git commit -m "feat: add pure music metadata parser for yt-dlp info JSON"
```

---

### Task 3: Seed music worker settings

**Files:**
- Modify: `server/utils/db.ts:382` (immediately after the existing `max_concurrent_downloads` seed block, before the `// Backfill size_bytes` comment)

**Interfaces:**
- Produces: two `settings` rows guaranteed to exist after `getDb()` first runs — `music_downloader_paused` (`'0'`) and `music_max_concurrent_downloads` (`'2'`) — read by Task 6's queue worker and written by Task 7's admin endpoints.

Follows the exact seeding pattern already used for `downloader_paused` and `max_concurrent_downloads` in the same file.

- [ ] **Step 1: Add the seed block**

This is the current block to extend:

```typescript
  const maxConcurrentCheck = db.prepare("SELECT COUNT(*) as count FROM settings WHERE key = 'max_concurrent_downloads'").get() as { count: number };
  if (maxConcurrentCheck.count === 0) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('max_concurrent_downloads', '2')").run();
    console.log('Seeded setting max_concurrent_downloads: 2');
  }

  // Backfill size_bytes for completed videos if null
```

Change it to:

```typescript
  const maxConcurrentCheck = db.prepare("SELECT COUNT(*) as count FROM settings WHERE key = 'max_concurrent_downloads'").get() as { count: number };
  if (maxConcurrentCheck.count === 0) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('max_concurrent_downloads', '2')").run();
    console.log('Seeded setting max_concurrent_downloads: 2');
  }

  const musicPausedCheck = db.prepare("SELECT COUNT(*) as count FROM settings WHERE key = 'music_downloader_paused'").get() as { count: number };
  if (musicPausedCheck.count === 0) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('music_downloader_paused', '0')").run();
    console.log('Seeded setting music_downloader_paused: 0');
  }

  const musicMaxConcurrentCheck = db.prepare("SELECT COUNT(*) as count FROM settings WHERE key = 'music_max_concurrent_downloads'").get() as { count: number };
  if (musicMaxConcurrentCheck.count === 0) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('music_max_concurrent_downloads', '2')").run();
    console.log('Seeded setting music_max_concurrent_downloads: 2');
  }

  // Backfill size_bytes for completed videos if null
```

- [ ] **Step 2: Verify both rows exist**

```bash
cat > scratch_verify_music_settings.ts <<'EOF'
import { getDb } from './server/utils/db';

const db = getDb();
const rows = db.prepare(`SELECT key, value FROM settings WHERE key LIKE 'music_%'`).all();
console.log('Music settings:', rows);
EOF
npx --yes tsx scratch_verify_music_settings.ts
rm -f scratch_verify_music_settings.ts
```

Expected: `Music settings: [ { key: 'music_downloader_paused', value: '0' }, { key: 'music_max_concurrent_downloads', value: '2' } ]`

- [ ] **Step 3: Commit**

```bash
git add server/utils/db.ts
git commit -m "feat: seed music worker settings (paused=0, max_concurrent=2)"
```

---

### Task 4: `musicDownloader.ts` part 1 — directory helpers and ingestion

**Files:**
- Create: `server/utils/musicDownloader.ts`

**Interfaces:**
- Consumes: `getDb` (`./db`), `getYtdlPath`, `buildSpawnEnv`, `runProcessAsync`, `addLog`, `sanitizeFolderName`, `isDirWritable` — all already exported from `server/utils/downloader.ts`.
- Produces: `getMusicDownloadsDir(): string`, `cleanupPartialMusicFiles(trackId: string, artistId: string): void`, `ingestMusicUrl(url: string, options?: { sync_status?: string; visibility?: string }): Promise<{ success: boolean; message: string; count: number }>`. Task 5 consumes `getMusicDownloadsDir`/`cleanupPartialMusicFiles`; Task 7's ingest endpoint consumes `ingestMusicUrl`; `ingestMusicUrl` itself calls `startMusicQueueWorker` (Task 6) when an artist that's already `sync_status = 'downloading'` gets new tracks — this call will be a forward reference to a function Task 6 adds later in this same file, which is fine in TypeScript (function declarations are hoisted).

This task starts the new file. It mirrors `ingestUrl` (`server/utils/downloader.ts:996`) and `getDownloadsDir`/`cleanupPartialFiles` (`server/utils/downloader.ts:29-46,142-162`), adapted for the music schema: `music_artists.id` is a generated id, not the YouTube channel id, so artist lookup/upsert is by `channel_id`, not by primary key. There is no videos/shorts tab split — a followed artist's "uploads" are fetched from `{channelUrl}/videos` in one call (music channels don't have the video-specific shorts/lives distinction `ingestUrl` splits on).

- [ ] **Step 1: Write the file**

Create `server/utils/musicDownloader.ts`:

```typescript
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getDb } from './db';
import { getYtdlPath, buildSpawnEnv, runProcessAsync, addLog, sanitizeFolderName, isDirWritable } from './downloader';

export function getMusicDownloadsDir(): string {
  const defaultPath = '/downloads/music';
  if (isDirWritable(defaultPath)) {
    return defaultPath;
  }

  const localFallback = path.resolve(process.cwd(), 'data/downloads-music');
  try { fs.mkdirSync(localFallback, { recursive: true }); } catch (err) {}
  return localFallback;
}

export function cleanupPartialMusicFiles(trackId: string, artistId: string): void {
  const db = getDb();
  const artist = db.prepare('SELECT name FROM music_artists WHERE id = ?').get(artistId) as { name: string } | undefined;
  const basePath = getMusicDownloadsDir();
  const artistDir = path.join(basePath, sanitizeFolderName(artist?.name || artistId));

  const audioExtensions = ['m4a', 'opus', 'webm', 'mp3', 'ogg', 'wav'];
  const filesToRemove = [
    ...audioExtensions.map(ext => path.join(artistDir, `${trackId}.${ext}`)),
    path.join(artistDir, `${trackId}.jpg`),
    path.join(artistDir, `${trackId}.mp4.part`),
    path.join(artistDir, `${trackId}.mp4.ytdl`),
  ];

  filesToRemove.forEach(f => {
    if (fs.existsSync(f)) {
      try { fs.unlinkSync(f); } catch (e) {}
    }
  });
}

/**
 * Metadata Ingestion for music.
 * Fetches channel/video JSON from yt-dlp and writes it to the music_* tables.
 * Mirrors ingestUrl in downloader.ts, adapted for the music schema: music_artists.id
 * is a generated id (not the YouTube channel id), so artist lookup/upsert is always
 * by channel_id. No videos/shorts tab split — music channels don't need it.
 */
export async function ingestMusicUrl(
  url: string,
  options: {
    sync_status?: string;
    visibility?: string;
  } = {}
): Promise<{ success: boolean; message: string; count: number }> {
  const db = getDb();

  const channelPattern = /youtube\.com\/(channel\/[a-zA-Z0-9_-]+|@[a-zA-Z0-9._-]+|c\/[a-zA-Z0-9_-]+|user\/[a-zA-Z0-9_-]+)\/?$/;
  const trimmedUrl = url.trim();
  const isChannelUrl = channelPattern.test(trimmedUrl);
  const fetchUrl = isChannelUrl ? `${trimmedUrl.replace(/\/$/, '')}/videos` : trimmedUrl;

  const ytdlPath = await getYtdlPath();
  const env = buildSpawnEnv();
  const args = ['--dump-single-json', '--flat-playlist', fetchUrl];

  let stdout = '';
  let stderr = '';
  let status: number | null = null;
  try {
    const child = await runProcessAsync(ytdlPath, args, env);
    stdout = child.stdout;
    stderr = child.stderr;
    status = child.status;
  } catch (err: any) {
    return { success: false, message: `yt-dlp execution error: ${err.message || err}`, count: 0 };
  }

  if (status !== 0) {
    return { success: false, message: `yt-dlp metadata fetch failed: ${stderr || 'Unknown error'}`, count: 0 };
  }

  let data: any;
  try {
    data = JSON.parse(stdout);
  } catch (err) {
    return { success: false, message: 'Failed to parse JSON output from yt-dlp', count: 0 };
  }

  // Case A: channel/playlist listing
  if (data._type === 'playlist' || Array.isArray(data.entries)) {
    const channelId = data.channel_id || data.uploader_id || 'unknown-channel';
    const channelTitle = data.channel || data.uploader || data.title || 'Unknown Artist';
    const channelDesc = data.description || '';

    let avatarUrl: string | null = null;
    let bannerUrl: string | null = null;
    if (data.thumbnails && Array.isArray(data.thumbnails)) {
      const avatarObj = data.thumbnails.find((t: any) => t.id === 'avatar_uncropped' || (t.id && String(t.id).includes('avatar')));
      const bannerObj = data.thumbnails.find((t: any) => t.id === 'banner_uncropped' || (t.id && String(t.id).includes('banner')));
      if (avatarObj) avatarUrl = avatarObj.url;
      if (bannerObj) bannerUrl = bannerObj.url;
      if (!avatarUrl && data.thumbnails.length > 0) {
        avatarUrl = data.thumbnails[data.thumbnails.length - 1].url;
      }
    }

    const existingArtist = db.prepare('SELECT id FROM music_artists WHERE channel_id = ?').get(channelId) as { id: string } | undefined;
    const artistId = existingArtist?.id || crypto.randomUUID();
    const initialSyncStatus = options.sync_status || 'paused';
    const initialVisibility = options.visibility || 'public';

    if (existingArtist) {
      db.prepare(`
        UPDATE music_artists
        SET name = ?, description = ?, avatar_url = COALESCE(?, avatar_url), banner_url = COALESCE(?, banner_url),
            sync_status = COALESCE(?, sync_status), visibility = COALESCE(?, visibility)
        WHERE id = ?
      `).run(channelTitle, channelDesc, avatarUrl, bannerUrl, options.sync_status ?? null, options.visibility ?? null, artistId);
    } else {
      db.prepare(`
        INSERT INTO music_artists (id, channel_id, name, description, avatar_url, banner_url, sync_status, visibility, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(artistId, channelId, channelTitle, channelDesc, avatarUrl, bannerUrl, initialSyncStatus, initialVisibility, Date.now());
    }

    const trackEntries: any[] = [];
    function collectEntries(item: any) {
      if (!item) return;
      if (item._type === 'playlist' || Array.isArray(item.entries)) {
        for (const entry of item.entries) collectEntries(entry);
      } else if (item.id && (item._type === 'url' || item._type === 'url_transparent' || !item._type)) {
        if (!trackEntries.some((t: any) => t.id === item.id)) trackEntries.push(item);
      }
    }
    collectEntries(data);

    const upsertTrack = db.prepare(`
      INSERT INTO music_tracks (id, artist_id, title, duration, view_count, upload_date, download_status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        view_count = COALESCE(excluded.view_count, view_count),
        duration = COALESCE(excluded.duration, duration),
        upload_date = COALESCE(excluded.upload_date, upload_date)
    `);
    const checkExists = db.prepare('SELECT 1 FROM music_tracks WHERE id = ?');

    let tracksAdded = 0;
    for (const entry of trackEntries) {
      if (!entry.id || entry.id === channelId) continue;
      const exists = checkExists.get(entry.id);
      upsertTrack.run(entry.id, artistId, entry.title || `Track ${entry.id}`, entry.duration || null, entry.view_count || null, entry.upload_date || null, Date.now());
      if (!exists) tracksAdded++;
    }

    const artistState = db.prepare('SELECT sync_status FROM music_artists WHERE id = ?').get(artistId) as { sync_status: string } | undefined;
    if (artistState?.sync_status === 'downloading') {
      startMusicQueueWorker();
    }

    return {
      success: true,
      message: `Artist "${channelTitle}" ingested. ${tracksAdded} new track(s) added.`,
      count: tracksAdded
    };
  }

  // Case B: single track
  const trackId = data.id;
  const channelId = data.channel_id || data.uploader_id || 'unknown-channel';
  const channelTitle = data.channel || data.uploader || 'Unknown Artist';

  const existingArtist = db.prepare('SELECT id FROM music_artists WHERE channel_id = ?').get(channelId) as { id: string } | undefined;
  let artistId: string;
  if (existingArtist) {
    artistId = existingArtist.id;
  } else {
    artistId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO music_artists (id, channel_id, name, sync_status, visibility, created_at)
      VALUES (?, ?, ?, 'paused', 'public', ?)
    `).run(artistId, channelId, channelTitle, Date.now());
  }

  const exists = db.prepare('SELECT 1 FROM music_tracks WHERE id = ?').get(trackId);
  db.prepare(`
    INSERT INTO music_tracks (id, artist_id, title, duration, view_count, upload_date, download_status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
    ON CONFLICT(id) DO UPDATE SET title = excluded.title
  `).run(trackId, artistId, data.title || `Track ${trackId}`, data.duration || null, data.view_count || null, data.upload_date || null, Date.now());

  return {
    success: true,
    message: `Track "${data.title || trackId}" ingested.`,
    count: exists ? 0 : 1
  };
}
```

Note: this references `startMusicQueueWorker`, which doesn't exist yet — it's added in Task 6, later in this same file. This will not type-check until Task 6 is done. That's expected and fine within this plan (the two tasks build the same file incrementally) — do not skip the type-check step below; it's expected to fail here for this one specific reason, and Task 6's own type-check step is what confirms the whole file is consistent.

- [ ] **Step 2: Confirm the expected, specific type error**

Run: `npx vue-tsc -b --noEmit`
Expected: exactly one error, referencing `startMusicQueueWorker` as not found/not defined in `server/utils/musicDownloader.ts`. If there are other errors, or a different error, stop and report — something else is wrong.

- [ ] **Step 3: Commit**

```bash
git add server/utils/musicDownloader.ts
git commit -m "feat: add music ingestion (channel/track upsert, no worker wiring yet)"
```

---

### Task 5: `musicDownloader.ts` part 2 — audio download

**Files:**
- Modify: `server/utils/musicDownloader.ts` (append; add imports)

**Interfaces:**
- Consumes: `getMusicDownloadsDir`, `cleanupPartialMusicFiles` (Task 4, same file); `parseMusicMetadataFromInfoData` (Task 2, `./musicMetadata`); `getYtdlPath`, `buildSpawnEnv`, `addLog`, `sanitizeFolderName` (already imported in Task 4's import line).
- Produces: `activeMusicProcesses: Map<string, any>` (module-level, exported) and `downloadMusicTrackFile(trackId: string, artistId: string): Promise<void>` (module-private — not exported, matching `downloadVideoFile`'s visibility in `downloader.ts`). Task 6 consumes both. `server/api/admin/music/tracks/[id]/cancel.post.ts` (Task 7) consumes `activeMusicProcesses` indirectly through `cancelMusicDownload`, which Task 6 adds.

Mirrors `downloadVideoFile` (`server/utils/downloader.ts:605-950`) for audio: `-x` (extract), best native audio stream, no format conversion, no merge/convert-thumbnail flags. Simplifications deliberately made here, not present in the video version: no watchdog-timeout constant reuse from `downloader.ts` (that constant isn't exported, so this file declares its own copy — a one-line duplication, not worth modifying `downloader.ts` for), and progress/speed/ETA are passed through from yt-dlp's raw regex captures directly rather than recomputed via a running average — video's smoothing logic depends on three module-private helper functions in `downloader.ts` that aren't exported, and audio downloads are typically much smaller/faster, so the extra smoothing isn't worth the coupling.

- [ ] **Step 1: Add the import and the two new exports**

In `server/utils/musicDownloader.ts`, change the import line from:

```typescript
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getDb } from './db';
import { getYtdlPath, buildSpawnEnv, runProcessAsync, addLog, sanitizeFolderName, isDirWritable } from './downloader';
```

to:

```typescript
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getDb } from './db';
import { getYtdlPath, buildSpawnEnv, runProcessAsync, addLog, sanitizeFolderName, isDirWritable } from './downloader';
import { parseMusicMetadataFromInfoData } from './musicMetadata';

// Maximum time (ms) a single audio download is allowed to run before being killed.
// Duplicated from downloader.ts's DOWNLOAD_TIMEOUT_MS (not exported there) rather
// than exporting it — this is a constant, not logic, so the duplication is cheap
// and avoids coupling this file to an unrelated module's internals.
const MUSIC_DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

export const activeMusicProcesses: Map<string, any> = new Map();
```

- [ ] **Step 2: Append `downloadMusicTrackFile` at the end of the file**

Add this at the end of `server/utils/musicDownloader.ts`, after `ingestMusicUrl`'s closing `}`:

```typescript

/**
 * Downloads a track's audio using the spawned yt-dlp process.
 * Mirrors downloadVideoFile in downloader.ts, adapted for audio-only extraction.
 */
function downloadMusicTrackFile(trackId: string, artistId: string): Promise<void> {
  return new Promise<void>(async (resolve, reject) => {
    try {
      const ytdlPath = await getYtdlPath();
      const db = getDb();

      const artist = db.prepare('SELECT name FROM music_artists WHERE id = ?').get(artistId) as { name: string } | undefined;
      const folderName = sanitizeFolderName(artist?.name || artistId);
      const baseDir = getMusicDownloadsDir();
      const artistDir = path.join(baseDir, folderName);

      if (!fs.existsSync(artistDir)) {
        fs.mkdirSync(artistDir, { recursive: true });
      }

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

      const env = buildSpawnEnv();
      addLog(`Lancement du téléchargement audio : ${ytdlPath} ${args.join(' ')}`);
      const child = spawn(ytdlPath, args, { env });
      activeMusicProcesses.set(trackId, child);

      let settled = false;
      const settle = (fn: () => void) => { if (!settled) { settled = true; fn(); } };

      const watchdog = setTimeout(() => {
        if (!settled) {
          addLog(`yt-dlp [${trackId}] timeout après ${MUSIC_DOWNLOAD_TIMEOUT_MS / 60000} minutes. Annulation.`);
          try { child.kill('SIGKILL'); } catch (e) {}
          activeMusicProcesses.delete(trackId);
          cleanupPartialMusicFiles(trackId, artistId);
          settle(() => reject(new Error(`Timeout: le téléchargement a dépassé ${MUSIC_DOWNLOAD_TIMEOUT_MS / 60000} minutes`)));
        }
      }, MUSIC_DOWNLOAD_TIMEOUT_MS);

      child.on('error', (err) => {
        clearTimeout(watchdog);
        addLog(`yt-dlp [${trackId}] process error : ${err.message || err}`);
        activeMusicProcesses.delete(trackId);
        settle(() => reject(err));
      });

      child.stdout.on('data', (data) => {
        const lines = data.toString().split(/[\r\n]+/);
        for (let i = lines.length - 1; i >= 0; i--) {
          const line = lines[i];
          if (!line) continue;
          // Match progress like: [download]  12.5% of  4.32MiB at  1.10MiB/s ETA 00:03
          const progressMatch = line.match(/\[download\]\s+([0-9.]+)%\s+of\s+~?\s*([0-9.]+)([a-zA-Z]+)\s+at\s+(\S+)\s+ETA\s+(\S+)/);
          if (progressMatch) {
            const progress = Math.round(parseFloat(progressMatch[1]));
            const speed = progressMatch[4];
            const eta = progressMatch[5];
            db.prepare(`
              UPDATE music_tracks
              SET download_progress = ?, download_speed = ?, download_eta = ?
              WHERE id = ?
            `).run(progress, speed, eta, trackId);
            break;
          }
        }
      });

      let lastStderr = '';
      child.stderr.on('data', (data) => {
        const msg = data.toString().trim();
        addLog(`yt-dlp [${trackId}] stderr : ${msg}`);
        if (msg) lastStderr = msg;
      });

      child.on('close', (code) => {
        clearTimeout(watchdog);
        activeMusicProcesses.delete(trackId);
        if (settled) return;

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

          if (!localFilePath) {
            const errorMsg = lastStderr ? `yt-dlp a terminé mais aucun fichier audio n'a été trouvé : ${lastStderr}` : `yt-dlp a terminé mais aucun fichier audio n'a été trouvé`;
            settle(() => reject(new Error(errorMsg)));
            return;
          }

          let thumbnailUrlPath: string | null = null;
          const thumbExtensions = ['jpg', 'jpeg', 'webp', 'png'];
          for (const ext of thumbExtensions) {
            const testPath = path.join(artistDir, `${trackId}.${ext}`);
            if (fs.existsSync(testPath)) {
              thumbnailUrlPath = `/downloads-music/${folderName}/${trackId}.${ext}`;
              break;
            }
          }

          const infoJsonFile = path.join(artistDir, `${trackId}.info.json`);
          let albumId: string | null = null;
          let genre: string | null = null;
          let trackNumber: number | null = null;

          if (fs.existsSync(infoJsonFile)) {
            try {
              const infoData = JSON.parse(fs.readFileSync(infoJsonFile, 'utf8'));
              const parsed = parseMusicMetadataFromInfoData(infoData);
              genre = parsed.genre;
              trackNumber = parsed.trackNumber;

              if (parsed.album) {
                const existingAlbum = db.prepare('SELECT id FROM music_albums WHERE artist_id = ? AND title = ?').get(artistId, parsed.album) as { id: string } | undefined;
                if (existingAlbum) {
                  albumId = existingAlbum.id;
                } else {
                  albumId = crypto.randomUUID();
                  db.prepare(`
                    INSERT INTO music_albums (id, artist_id, title, release_year, source, created_at)
                    VALUES (?, ?, ?, ?, 'youtube', ?)
                  `).run(albumId, artistId, parsed.album, parsed.releaseYear, Date.now());
                }
              }

              fs.unlinkSync(infoJsonFile);
            } catch (err) {
              console.error(`Failed to parse info JSON for track ${trackId}:`, err);
            }
          }

          const fileSize = audioFile && fs.existsSync(audioFile) ? fs.statSync(audioFile).size : null;

          db.prepare(`
            UPDATE music_tracks
            SET local_file_path = ?, local_thumbnail_path = ?, album_id = COALESCE(?, album_id),
                genre = COALESCE(?, genre), track_number = COALESCE(?, track_number), size_bytes = ?
            WHERE id = ?
          `).run(localFilePath, thumbnailUrlPath, albumId, genre, trackNumber, fileSize, trackId);

          db.prepare(`
            INSERT INTO music_track_artists (track_id, artist_id, role)
            VALUES (?, ?, 'primary')
            ON CONFLICT(track_id, artist_id) DO NOTHING
          `).run(trackId, artistId);

          settle(() => resolve());
        } else {
          const errorMsg = lastStderr ? `yt-dlp a échoué (code ${code}) : ${lastStderr}` : `yt-dlp a échoué avec le code ${code}`;
          settle(() => reject(new Error(errorMsg)));
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}
```

- [ ] **Step 3: Confirm the same single expected type error persists**

Run: `npx vue-tsc -b --noEmit`
Expected: still exactly one error, still about `startMusicQueueWorker` not being defined — nothing new. If `downloadMusicTrackFile` or the new imports introduce any other error, stop and fix before proceeding; do not carry a second, different error into Task 6.

- [ ] **Step 4: Commit**

```bash
git add server/utils/musicDownloader.ts
git commit -m "feat: add audio-only track download to musicDownloader.ts"
```

---

### Task 6: `musicDownloader.ts` part 3 — concurrent queue worker and cancel

**Files:**
- Modify: `server/utils/musicDownloader.ts` (append; add import)

**Interfaces:**
- Consumes: `downloadMusicTrackFile`, `activeMusicProcesses`, `cleanupPartialMusicFiles` (Tasks 4/5, same file); `addLog` (already imported); `parseMaxConcurrentDownloads`, `hasCapacityForMoreDownloads` from `./concurrency` (already generic, built in the concurrent-downloads sub-project — no changes needed there).
- Produces: `startMusicQueueWorker(): Promise<void>` (resolves the forward reference from Task 4), `wakeMusicWorker(): void`, `cancelMusicDownload(trackId: string, targetStatus?: 'failed' | 'pending', keepProgressAndFiles?: boolean): boolean` — all exported, consumed by Task 7's endpoints.

Mirrors the concurrent orchestrator built for video downloads (`server/utils/downloader.ts`'s `startQueueWorker`/`runSingleDownload`, from the earlier concurrent-downloads sub-project) exactly in shape — same no-`await`-between-capacity-check-and-launch correctness property, same dedicated active-count symbol pattern — but polling `music_tracks`/`music_artists`, gated by `music_downloader_paused`/`music_max_concurrent_downloads`, with its own `activeMusicProcesses` map (from Task 5) instead of the video pipeline's `activeProcesses`.

The pending-track pick query is simpler than the video one: `music_tracks` has no `priority`, `is_short`, or `is_manually_queued` columns (not part of the sub-project-1 schema), so there's no equivalent priority/shorts-first ordering or manual-queue override — just "resume partial downloads first, then oldest first," gated on the owning artist's `sync_status`.

- [ ] **Step 1: Add the import and global state**

Change the import line (again) from:

```typescript
import { getYtdlPath, buildSpawnEnv, runProcessAsync, addLog, sanitizeFolderName, isDirWritable } from './downloader';
import { parseMusicMetadataFromInfoData } from './musicMetadata';
```

to:

```typescript
import { getYtdlPath, buildSpawnEnv, runProcessAsync, addLog, sanitizeFolderName, isDirWritable } from './downloader';
import { parseMusicMetadataFromInfoData } from './musicMetadata';
import { parseMaxConcurrentDownloads, hasCapacityForMoreDownloads } from './concurrency';

// Define global-backed state to survive development HMR module hot reloads,
// same pattern as downloader.ts's own worker state.
const _g = globalThis as any;
const G_MUSIC_PROCESSING = Symbol.for('YouKeep.isMusicProcessing');
const G_MUSIC_SHOULD_RUN = Symbol.for('YouKeep.musicWorkerShouldRun');
const G_MUSIC_ACTIVE_DOWNLOAD_COUNT = Symbol.for('YouKeep.activeMusicDownloadCount');

if (!(G_MUSIC_PROCESSING in _g)) _g[G_MUSIC_PROCESSING] = false;
if (!(G_MUSIC_SHOULD_RUN in _g)) _g[G_MUSIC_SHOULD_RUN] = false;
if (!(G_MUSIC_ACTIVE_DOWNLOAD_COUNT in _g)) _g[G_MUSIC_ACTIVE_DOWNLOAD_COUNT] = 0;

function getIsMusicProcessing(): boolean { return _g[G_MUSIC_PROCESSING]; }
function setIsMusicProcessing(val: boolean) { _g[G_MUSIC_PROCESSING] = val; }
function getMusicWorkerShouldRun(): boolean { return _g[G_MUSIC_SHOULD_RUN]; }
function setMusicWorkerShouldRun(val: boolean) { _g[G_MUSIC_SHOULD_RUN] = val; }
function getActiveMusicDownloadCount(): number { return _g[G_MUSIC_ACTIVE_DOWNLOAD_COUNT]; }
function incrementActiveMusicDownloadCount() { _g[G_MUSIC_ACTIVE_DOWNLOAD_COUNT]++; }
function decrementActiveMusicDownloadCount() { _g[G_MUSIC_ACTIVE_DOWNLOAD_COUNT] = Math.max(0, _g[G_MUSIC_ACTIVE_DOWNLOAD_COUNT] - 1); }

let musicWorkerWakeResolver: (() => void) | null = null;

function sleepOrWakeableMusic(ms: number) {
  return new Promise<void>(resolve => {
    let timeoutId: any = null;
    const cleanResolve = () => {
      if (timeoutId) clearTimeout(timeoutId);
      musicWorkerWakeResolver = null;
      resolve();
    };
    musicWorkerWakeResolver = cleanResolve;
    timeoutId = setTimeout(cleanResolve, ms);
  });
}

export function wakeMusicWorker() {
  if (musicWorkerWakeResolver) {
    musicWorkerWakeResolver();
  }
}
```

- [ ] **Step 2: Append the orchestrator, the per-track runner, and cancel at the end of the file**

Add this at the end of `server/utils/musicDownloader.ts`, after `downloadMusicTrackFile`'s closing `}`:

```typescript

export async function startMusicQueueWorker() {
  if (getIsMusicProcessing()) {
    addLog('Worker musique déjà en cours d\'exécution. Réveil du worker...');
    wakeMusicWorker();
    return;
  }
  setIsMusicProcessing(true);
  setMusicWorkerShouldRun(true);
  addLog('Démarrage du worker de musique (mode persistant)...');

  try {
    const db = getDb();
    let consecutiveSystemErrors = 0;

    while (getMusicWorkerShouldRun()) {
      try {
        const pausedSetting = db.prepare("SELECT value FROM settings WHERE key = 'music_downloader_paused'").get() as { value: string } | undefined;
        if (pausedSetting?.value === '1') {
          await sleepOrWakeableMusic(5000);
          continue;
        }

        const concurrencySetting = db.prepare("SELECT value FROM settings WHERE key = 'music_max_concurrent_downloads'").get() as { value: string } | undefined;
        const maxConcurrent = parseMaxConcurrentDownloads(concurrencySetting?.value);
        if (!hasCapacityForMoreDownloads(getActiveMusicDownloadCount(), maxConcurrent)) {
          await sleepOrWakeableMusic(1000);
          continue;
        }

        const track = db.prepare(`
          SELECT t.id, t.title, t.artist_id
          FROM music_tracks t
          JOIN music_artists a ON t.artist_id = a.id
          WHERE t.download_status = 'pending' AND a.sync_status = 'downloading'
          ORDER BY
            CASE WHEN t.download_progress > 0 THEN 0 ELSE 1 END,
            t.created_at ASC
          LIMIT 1
        `).get() as { id: string; title: string; artist_id: string } | undefined;

        if (!track) {
          await sleepOrWakeableMusic(3000);
          continue;
        }

        consecutiveSystemErrors = 0;
        addLog(`Lancement du téléchargement audio : "${track.title}" (ID: ${track.id})`);

        db.prepare(`
          UPDATE music_tracks
          SET download_status = 'downloading',
              download_progress = COALESCE(download_progress, 0),
              download_speed = '0KB/s',
              download_eta = '--:--',
              last_error = null
          WHERE id = ?
        `).run(track.id);

        incrementActiveMusicDownloadCount();
        runSingleMusicDownload(track.id, track.title, track.artist_id);
      } catch (loopErr: any) {
        consecutiveSystemErrors++;
        addLog(`Erreur système dans la boucle du worker musique (${consecutiveSystemErrors}/5) : ${loopErr.message || loopErr}`);
        if (consecutiveSystemErrors >= 5) {
          addLog('Trop d\'erreurs système consécutives. Arrêt du worker musique.');
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  } catch (err: any) {
    addLog(`Erreur générale fatale du worker musique : ${err.message || err}`);
  } finally {
    setIsMusicProcessing(false);
    setMusicWorkerShouldRun(false);
    addLog('Worker de musique arrêté.');
  }
}

/**
 * Runs a single track download to completion and updates its DB status accordingly.
 * Not awaited by the orchestrator loop above — mirrors runSingleDownload in downloader.ts.
 */
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
    const errMsg = err.message || String(err);
    addLog(`ÉCHEC du téléchargement audio pour la track "${trackTitle}" (${trackId}) : ${errMsg}`);

    const currentTrack = db.prepare('SELECT download_status FROM music_tracks WHERE id = ?').get(trackId) as { download_status: string } | undefined;
    const pausedSetting = db.prepare("SELECT value FROM settings WHERE key = 'music_downloader_paused'").get() as { value: string } | undefined;
    const isPausedGlobal = pausedSetting?.value === '1';

    if (isPausedGlobal || currentTrack?.download_status === 'pending') {
      addLog(`Téléchargement de la track "${trackTitle}" (${trackId}) interrompu ou mis en pause intentionnellement.`);
      db.prepare(`
        UPDATE music_tracks
        SET download_status = 'pending', download_speed = null, download_eta = null
        WHERE id = ?
      `).run(trackId);
    } else {
      db.prepare(`
        UPDATE music_tracks
        SET download_status = 'pending', download_progress = 0, download_speed = null, download_eta = null, last_error = ?, created_at = ?
        WHERE id = ?
      `).run(errMsg, Date.now(), trackId);
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  } finally {
    decrementActiveMusicDownloadCount();
    wakeMusicWorker();
  }
}

/**
 * Terminates an active music download process and deletes temporary files.
 * Mirrors cancelDownload in downloader.ts.
 */
export function cancelMusicDownload(trackId: string, targetStatus: 'failed' | 'pending' = 'pending', keepProgressAndFiles = false): boolean {
  const child = activeMusicProcesses.get(trackId);
  const db = getDb();

  if (child) {
    try {
      child.kill('SIGKILL');
    } catch (e) {}
    activeMusicProcesses.delete(trackId);
  }

  if (keepProgressAndFiles) {
    db.prepare(`
      UPDATE music_tracks
      SET download_status = ?, download_speed = null, download_eta = null
      WHERE id = ?
    `).run(targetStatus, trackId);
  } else {
    db.prepare(`
      UPDATE music_tracks
      SET download_status = ?, download_progress = 0, download_speed = null, download_eta = null
      WHERE id = ?
    `).run(targetStatus, trackId);
  }

  if (!keepProgressAndFiles) {
    const track = db.prepare('SELECT artist_id FROM music_tracks WHERE id = ?').get(trackId) as { artist_id: string } | undefined;
    if (track) {
      cleanupPartialMusicFiles(trackId, track.artist_id);
    }
  }

  return true;
}
```

- [ ] **Step 3: Full type-check — must now be completely clean**

Run: `npx vue-tsc -b --noEmit`
Expected: no errors at all. The forward reference from Task 4 is now resolved.

- [ ] **Step 4: Run the full test suite**

Run: `npx vitest run`
Expected: all tests pass, including Task 2's `musicMetadata.test.ts` and every pre-existing test (this task doesn't touch any tested code path directly, but confirms nothing broke).

- [ ] **Step 5: Commit**

```bash
git add server/utils/musicDownloader.ts
git commit -m "feat: add concurrent music download queue worker and cancel

Mirrors the video pipeline's orchestrator (dedicated active-count
symbol, no-await-between-claim-and-launch correctness property) but
fully independent: own settings keys, own process map, own worker."
```

---

### Task 7: Admin API endpoints

**Files:**
- Create: `server/api/admin/music/ingest.post.ts`
- Create: `server/api/admin/music/pause.post.ts`
- Create: `server/api/admin/music/resume.post.ts`
- Create: `server/api/admin/music/artists/[id]/sync.post.ts`
- Create: `server/api/admin/music/tracks/[id]/cancel.post.ts`

**Interfaces:**
- Consumes: `ingestMusicUrl` (Task 4), `startMusicQueueWorker`, `cancelMusicDownload` (Task 6) — all from `server/utils/musicDownloader.ts`. `requireAdmin` and `getDb` are Nuxt server auto-imports (no explicit import needed — see how the existing sibling files under `server/api/admin/downloader/` use them without importing).
- Produces: five HTTP routes, consumed by Task 8's verification and eventually by the sub-project-3 UI.

Each mirrors its video-pipeline equivalent one-for-one, adapted to the smaller `ingestMusicUrl` options shape (no `download_videos`/`download_shorts`/`download_lives`/`date_after`/`custom_save_path` — those don't exist for music) and to `music_downloader_paused`/`cancelMusicDownload`/etc.

- [ ] **Step 1: `POST /api/admin/music/ingest`**

Create `server/api/admin/music/ingest.post.ts`:

```typescript
import { defineEventHandler, readBody, createError } from 'h3';
import { ingestMusicUrl } from '../../../utils/musicDownloader';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const body = await readBody(event);
  const { url, sync_status, visibility } = body;

  if (!url) {
    throw createError({ statusCode: 400, statusMessage: 'URL is required.' });
  }

  try {
    const result = await ingestMusicUrl(url, {
      sync_status: sync_status !== undefined ? sync_status : undefined,
      visibility: visibility !== undefined ? visibility : undefined,
    });

    if (!result.success) {
      throw createError({ statusCode: 500, statusMessage: result.message });
    }

    return result;
  } catch (err: any) {
    throw createError({ statusCode: 500, statusMessage: err.message || 'An error occurred during music ingestion.' });
  }
});
```

- [ ] **Step 2: `POST /api/admin/music/pause`**

Create `server/api/admin/music/pause.post.ts`:

```typescript
import { defineEventHandler } from 'h3';
import { cancelMusicDownload } from '../../../utils/musicDownloader';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const db = getDb();

  db.prepare(`
    UPDATE settings
    SET value = '1'
    WHERE key = 'music_downloader_paused'
  `).run();

  const activeDownloads = db.prepare(`
    SELECT id FROM music_tracks
    WHERE download_status = 'downloading'
  `).all() as { id: string }[];

  for (const t of activeDownloads) {
    cancelMusicDownload(t.id, 'pending', true);
  }

  return { success: true };
});
```

- [ ] **Step 3: `POST /api/admin/music/resume`**

Create `server/api/admin/music/resume.post.ts`:

```typescript
import { defineEventHandler } from 'h3';
import { startMusicQueueWorker } from '../../../utils/musicDownloader';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const db = getDb();

  db.prepare(`
    UPDATE settings
    SET value = '0'
    WHERE key = 'music_downloader_paused'
  `).run();

  startMusicQueueWorker();

  return { success: true };
});
```

- [ ] **Step 4: `POST /api/admin/music/artists/[id]/sync`**

Create `server/api/admin/music/artists/[id]/sync.post.ts`:

```typescript
import { defineEventHandler, createError } from 'h3';
import { ingestMusicUrl, startMusicQueueWorker } from '../../../../../utils/musicDownloader';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const artistId = event.context.params?.id;

  if (!artistId) {
    throw createError({ statusCode: 400, statusMessage: 'Artist ID is required.' });
  }

  const db = getDb();
  const artist = db.prepare('SELECT channel_id FROM music_artists WHERE id = ?').get(artistId) as { channel_id: string | null } | undefined;

  if (!artist) {
    throw createError({ statusCode: 404, statusMessage: 'Artist not found.' });
  }
  if (!artist.channel_id) {
    throw createError({ statusCode: 400, statusMessage: 'This artist has no followed channel to sync (feat-only artist).' });
  }

  const res = db.prepare(`
    UPDATE music_artists
    SET sync_status = 'downloading'
    WHERE id = ?
  `).run(artistId);

  if (res.changes === 0) {
    throw createError({ statusCode: 404, statusMessage: 'Artist not found.' });
  }

  const url = `https://www.youtube.com/channel/${artist.channel_id}`;
  setTimeout(async () => {
    try {
      console.log(`Starting background music ingestion for artist ${artistId} triggered by manual sync start`);
      await ingestMusicUrl(url);
    } catch (err) {
      console.error(`Failed background music ingestion for artist ${artistId}:`, err);
    }
  }, 100);

  startMusicQueueWorker();

  return { success: true };
});
```

- [ ] **Step 5: `POST /api/admin/music/tracks/[id]/cancel`**

Create `server/api/admin/music/tracks/[id]/cancel.post.ts`:

```typescript
import { defineEventHandler, createError } from 'h3';
import { cancelMusicDownload } from '../../../../../utils/musicDownloader';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const trackId = event.context.params?.id;

  if (!trackId) {
    throw createError({ statusCode: 400, statusMessage: 'Track ID is required.' });
  }

  const success = cancelMusicDownload(trackId);
  return { success };
});
```

- [ ] **Step 6: Type-check**

Run: `npx vue-tsc -b --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add server/api/admin/music/
git commit -m "feat: add admin API endpoints for music ingestion/pause/resume/sync/cancel"
```

---

### Task 8: End-to-end verification with a real music channel

**Files:** none (verification only, no code changes)

This exercises the full pipeline against real yt-dlp downloads, which unit tests can't meaningfully cover. This is also where Task 2's field-name assumption (`album`/`genre`/`track_number`/`release_year`) gets checked against real data — if wrong, fix `server/utils/musicMetadata.ts` and re-run this task before considering the plan done.

- [ ] **Step 1: Ingest a real music-oriented channel**

With the dev server running and an admin session available (see this project's established technique for creating one directly via the `sessions` table for local verification, used in prior sub-projects' verification passes):

```bash
curl -s -X POST -H "Cookie: youkeep_session=<admin session id>" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.youtube.com/@<a real music channel handle>", "sync_status": "downloading"}' \
  http://localhost:3100/api/admin/music/ingest
```

Expected: `{ "success": true, "message": "Artist \"...\" ingested. N new track(s) added.", "count": N }` with `N > 0`.

- [ ] **Step 2: Confirm at least one track completes**

```bash
sqlite3 data/youkeep.db "SELECT id, title, download_status, local_file_path FROM music_tracks ORDER BY created_at DESC LIMIT 5;"
```

Expected: at least one row with `download_status = 'completed'` and a non-null `local_file_path`. Confirm the file actually exists:

```bash
sqlite3 data/youkeep.db "SELECT local_file_path FROM music_tracks WHERE download_status = 'completed' LIMIT 1;"
# then, stripping the leading /downloads-music/ prefix:
ls -la "data/downloads-music/<artist folder>/"
```

- [ ] **Step 3: Confirm exactly one primary credit per completed track**

```bash
sqlite3 data/youkeep.db "
  SELECT t.id, COUNT(*) as credit_count,
         SUM(CASE WHEN ta.role = 'primary' THEN 1 ELSE 0 END) as primary_count
  FROM music_tracks t
  JOIN music_track_artists ta ON ta.track_id = t.id
  WHERE t.download_status = 'completed'
  GROUP BY t.id;
"
```

Expected: every row has `credit_count = 1` and `primary_count = 1`.

- [ ] **Step 4: Check whether album metadata was found and linked**

```bash
sqlite3 data/youkeep.db "SELECT id, title, genre, track_number, album_id FROM music_tracks WHERE download_status = 'completed';"
sqlite3 data/youkeep.db "SELECT * FROM music_albums;"
```

If `album`/`genre`/`track_number` came through non-null on at least one track and a matching `music_albums` row exists with `source = 'youtube'`, Task 2's field-name assumption was correct — nothing to do. If every completed track has `album_id IS NULL`, `genre IS NULL`, and `track_number IS NULL` even though the source channel is known to tag its uploads with music metadata, the assumed yt-dlp field names were wrong: inspect a real info JSON directly to find the actual field names —

```bash
# Re-run yt-dlp by hand against one of the ingested track URLs to inspect its real info JSON:
./data/bin/yt-dlp --write-info-json --skip-download -o "/tmp/probe.%(ext)s" "https://www.youtube.com/watch?v=<a completed track's id>"
cat /tmp/probe.info.json | python3 -m json.tool | grep -iE "album|genre|track|release"
rm -f /tmp/probe.info.json
```

then update `parseMusicMetadataFromInfoData` in `server/utils/musicMetadata.ts` (and its tests in `tests/unit/musicMetadata.test.ts`, if the field shape differs from what was assumed) to match, re-run `npx vitest run tests/unit/musicMetadata.test.ts`, commit the fix, and re-run this step.

- [ ] **Step 5: Confirm the music worker is independent of the video worker**

While the music ingest from Step 1 is still downloading, check that no video-pipeline state was touched:

```bash
sqlite3 data/youkeep.db "SELECT key, value FROM settings WHERE key IN ('downloader_paused', 'music_downloader_paused');"
```

Expected: `music_downloader_paused` reflects whatever this task's own pause/resume calls set it to; `downloader_paused` is unaffected (still whatever it was before this task started).

- [ ] **Step 6: Pause music mid-download, confirm video is unaffected**

If a video download happens to be running at the same time (or manually trigger one), call:

```bash
curl -s -X POST -H "Cookie: youkeep_session=<admin session id>" http://localhost:3100/api/admin/music/pause
```

Expected: in-flight music downloads revert to `pending`; any concurrently-running video download in `videos` is untouched.

- [ ] **Step 7: Report results**

Summarize pass/fail for each step above, including whether Step 4 required a metadata field-name correction. If any step fails for a reason other than "the test channel simply doesn't tag its uploads with music metadata" (which is an expected, non-error outcome per the spec's Non-Goals), return to the relevant earlier task and fix before considering this plan complete.
