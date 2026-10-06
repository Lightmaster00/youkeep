# Video Storage Layout + Tidy Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store every newly downloaded video in its own folder (`<base>/<Channel>/<Title> [<id>]/`) holding the video, thumbnail and subtitles named after the title, stop the Follow flow from creating a doubled channel folder, and give the admin a manual, previewable, resumable "Tidy library files" tool that moves existing (legacy) files into the new layout without ever losing a file.

**Architecture:** A new `server/utils/videoPaths.ts` module owns naming, folder/URL building, URL parsing and the "stored path → disk" mapping; the downloader, the `/downloads` file route, the subtitle scan, video delete, cancel cleanup and the duration backfill all go through it, while legacy videos (files directly in the channel folder) keep working unchanged. A new `server/utils/videoTidy.ts` holds a pure planner (injectable sync fs) and a batched runner (injectable async fs, move → verify → compare-and-set DB update per video, revert on failure) with globalThis-backed status, exposed through four admin routes and a panel in Settings → System → Tools & logs.

**Tech Stack:** Nuxt 4, Nitro (h3 1.15), better-sqlite3, Vue 3, Vitest (`server` and `component` projects), yt-dlp, Docker (node:24-alpine with ffmpeg) for the final real verification.

## Global Constraints

Copied from the approved spec (`docs/superpowers/specs/2026-10-06-video-storage-layout-design.md`); these are binding for every task.

- **Layout (new downloads):** `<base>/<Channel>/<Title> [<id>]/` containing `<Title> [<id>].mp4` (or the extension yt-dlp produced), `<Title> [<id>].jpg` (thumbnail), `<Title> [<id>].<lang>.vtt` for each subtitle language. The `.info.json` is still deleted after being read. `<Channel>` is `sanitizeFolderName(channel.title || channelId)` as today. `<base>` is the channel's base folder (custom save path, or the downloads dir), exactly as today.
- **Naming rules (one pure function, unit-tested):** `<Title>` is the video title with path-forbidden characters (`\ / : * ? " < > |` and control characters) replaced, whitespace collapsed, leading/trailing dots and spaces removed, and truncated so that the whole base name (`<Title> [<id>]`) stays within **120 bytes** of UTF-8; truncation never cuts inside a multi-byte character. An empty title falls back to the identifier. The identifier in brackets is mandatory and guarantees uniqueness.
- **Database is the source of truth for stored paths:** `videos.local_video_path` / `local_thumbnail_path` keep the web shape `/downloads/...`. For a video that has a stored path, its on-disk folder is derived from that stored path (mapped exactly like the file route does); only a video without a stored path yet (download in progress) gets its folder computed from title + id. A video is "new layout" when its stored path has the extra folder level whose name ends with `[<id>]`.
- **Legacy layout keeps working until tidied:** URLs `/downloads/<channelFolder>/<id>.<ext>` with files directly in the channel folder must keep being served, scanned for subtitles, deleted and probed exactly as today. Never break a legacy video in any task: the app must work after every single commit.
- **Tidy tool:** manual only (never at start-up), preview first (no disk change), batched (25 per batch with a short yield), resumable (re-running the preview shows what remains), one run at a time, refuses while a library wipe runs, skips any video whose `download_status` is not `completed` or whose download process is active. Per video: move → verify (exists + size) → update `local_video_path` / `local_thumbnail_path` in one transaction (compare-and-set on the old path) → on any failure restore every moved file and record the error (with both paths when the restore also fails). Never delete a file that was not verified elsewhere; never delete anything outside the video's own files; leftover folders are removed only when completely empty. Cross-device moves fall back to copy → verify size → remove source.
- **Duplicate folder repair:** `<base>/<Channel>/<Channel>/<id>.*` (custom save path ending in the channel folder name) is planned to `<root>/<Channel>/<Title> [<id>]/` where `<root>` is the parent of the custom save path; the channel's `custom_save_path` is corrected to `<root>` only once every video of that channel sits at its final place and none is downloading.
- **Follow flow:** the `custom_save_path` sent on ingest is the chosen base folder only (no channel title appended), because the downloader appends the channel folder. Hint text under the field: "YouKeep adds a folder per channel and per video inside this folder." Existing channels are not silently rewritten (the tidy tool repairs them).
- **Out of scope:** music and podcast layouts; renaming folders when a title later changes; moving files between different base folders / custom save paths; any change to how videos are listed or played; `server/utils/db.ts` size backfill (it reads a long-dead `data/downloads/<channel_id>/<id>.mp4` path and is left untouched); channel delete and library wipe (they remove the whole channel folder recursively, which already covers both layouts).
- **Admin UI and admin API messages: English only.** `tests/unit/adminEnglishOnly.test.ts` scans `app/components/settings/*.vue`, `app/utils/librarySources.ts` and `server/api/admin/**/*.ts` for accented characters and French words (including substrings like `requis`, `invalide`, `introuvable`, `Aucun`): write no French and no accented characters in those files, comments included.
- **Code conventions:** `getDb`, `requireAdmin`, `getDownloadsDir`, `sanitizeFolderName`, `cancelDownload`, `canAccessVideo`, `getQuery`, `getUserFromSession` are ambient Nitro auto-imports in routes (never import them in route files). `server/utils/downloader.ts` imports `getDb` from `./db` explicitly (keep it). New util code imports shared helpers with relative paths. New exported names must not collide with existing server util exports (verified: none of the names in this plan exist yet).
- **Test conventions:** `createTestDb` / `mockEvent` from `tests/helpers/testDb.ts`, with `(globalThis as any).getDb = () => db` (and the other ambient functions a route uses set on `globalThis` the same way). Code that calls the downloader's own `getDb` needs `vi.mock('../../server/utils/db', () => ({ getDb: () => (globalThis as any).getDb() }))` (pattern from `tests/integration/account-password-revokes-tokens.test.ts`). Component tests: `mountSuspended` from `@nuxt/test-utils/runtime` with `vi.stubGlobal('$fetch', fetchMock)` and `vi.unstubAllGlobals()` in `afterEach`. Use temporary directories (`fs.mkdtempSync(path.join(os.tmpdir(), ...))`) for every disk test and remove them in `afterEach`.
- **The suite was just consolidated (751 tests):** write FEW, high-value tests (behaviour and boundaries, not copy or DOM shape), no `it.each` explosions, no source-grepping tests. Mutation-check every test that claims to prove a fix or a guard (temporarily break the code, see the test fail, restore).
- **Every task ends with** the focused test, then the full `npx vitest run` and `npx nuxt build 2>&1 | tail -5` (both must pass), then a commit whose message ends with the exact last line `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Commit only the files the task lists. Work on branch `feature/video-storage-layout` (already checked out); never work on `main`; never push.

---

### Task 1: Pure naming and URL module (`videoPaths.ts`)

**Files:**
- Create `server/utils/videoPaths.ts`
- Create `tests/unit/videoPaths.test.ts`

**Interfaces:**
- Consumes: nothing (pure module; only `path` from Node).
- Produces (exact signatures, used by Tasks 2-8):
  - `export const VIDEO_BASENAME_MAX_BYTES = 120`
  - `export const VIDEO_EXTENSIONS: string[]` = `['mp4', 'webm', 'mkv', '3gp', 'flv']`
  - `export const THUMB_EXTENSIONS: string[]` = `['jpg', 'jpeg', 'webp', 'png']`
  - `export function videoBaseName(title: string | null | undefined, id: string): string`
  - `export function videoFolderName(title: string | null | undefined, id: string): string` (same value)
  - `export interface VideoPaths { dir: string; baseName: string; urlDir: string; outputTemplate: string; subtitleGlob: string; videoUrlFor(ext: string): string; thumbUrlFor(ext: string): string; subtitleUrlFor(fileName: string): string }` (`ext` without the dot)
  - `export function buildVideoPaths(opts: { baseDir: string; channelFolder: string; title: string | null | undefined; id: string }): VideoPaths`
  - `export function decodeUrlSegments(rawSegments: string[]): string[] | null`
  - `export function storedUrlSegments(url: string | null | undefined): [string, string, string] | null`
  - `export function idFromVideoFolder(folder: string): string | null`
  - `export function isNewLayoutUrl(url: string | null | undefined, id: string): boolean`
  - `export function channelReadBaseDir(customSavePath: string | null | undefined, downloadsDir: string): string`
  - `export function candidateVideoDirs(baseDir: string, channelFolder: string, videoFolder: string): string[]`
  - `export function isContained(parent: string, child: string): boolean`

Notes for the implementer: stored new-layout URLs are percent-encoded per segment (`encodeURIComponent`), because titles may contain `#` or `%`, which would break a raw URL in `<video src>`. h3 does not decode router params, so the file route receives these encoded segments and decodes them with `decodeUrlSegments`. Legacy URLs stay raw and are never decoded. yt-dlp treats `%` in `-o` as a template field, so `outputTemplate` doubles every `%` in the literal folder/file part.

- [ ] **Step 1: Write the failing test** `tests/unit/videoPaths.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import path from 'path';
import {
  videoBaseName, buildVideoPaths, isNewLayoutUrl, decodeUrlSegments, candidateVideoDirs, VIDEO_BASENAME_MAX_BYTES,
} from '../../server/utils/videoPaths';

const bytes = (s: string) => Buffer.byteLength(s, 'utf8');

describe('videoBaseName', () => {
  it('cleans the title and always ends with the bracketed id', () => {
    expect(videoBaseName('  Pourquoi le ciel / la mer: "bleus"?  ', 'abc')).toBe('Pourquoi le ciel _ la mer_ _bleus__ [abc]');
    expect(videoBaseName('a\tb\n\nc\u0007d', 'x')).toBe('a b c_d [x]');
    expect(videoBaseName('...hidden. ', 'x')).toBe('hidden [x]');
    expect(videoBaseName('', 'x')).toBe('x [x]');
    expect(videoBaseName(null, 'x')).toBe('x [x]');
    expect(videoBaseName(' .. ', 'x')).toBe('x [x]');
    expect(videoBaseName('Same', 'a')).not.toBe(videoBaseName('Same', 'b'));
  });

  it('truncates to 120 bytes without splitting a multi-byte character', () => {
    const id = 'dQw4w9WgXcQ';
    for (const title of ['a'.repeat(300), 'é'.repeat(300), '😀'.repeat(100), 'ab' + '😀'.repeat(100)]) {
      const name = videoBaseName(title, id);
      expect(bytes(name)).toBeLessThanOrEqual(VIDEO_BASENAME_MAX_BYTES);
      expect(name.endsWith(` [${id}]`)).toBe(true);
      // A split surrogate pair would not survive a UTF-8 round trip.
      expect(Buffer.from(name, 'utf8').toString('utf8')).toBe(name);
    }
    expect(bytes(videoBaseName('é'.repeat(300), id))).toBe(120);
  });
});

describe('buildVideoPaths', () => {
  it('builds the folder, an escaped yt-dlp template and percent-encoded URLs', () => {
    const p = buildVideoPaths({ baseDir: '/data/videos', channelFolder: 'My Chan', title: 'Ep #3: 100% [live]', id: 'id1' });
    expect(p.baseName).toBe('Ep #3_ 100% [live] [id1]');
    expect(p.dir).toBe(path.join('/data/videos', 'My Chan', 'Ep #3_ 100% [live] [id1]'));
    expect(p.outputTemplate).toBe(path.join('/data/videos', 'My Chan', 'Ep #3_ 100%% [live] [id1]', 'Ep #3_ 100%% [live] [id1]') + '.%(ext)s');
    const folder = 'Ep%20%233_%20100%25%20%5Blive%5D%20%5Bid1%5D';
    expect(p.videoUrlFor('mp4')).toBe(`/downloads/My%20Chan/${folder}/${folder}.mp4`);
    expect(p.thumbUrlFor('jpg')).toBe(`/downloads/My%20Chan/${folder}/${folder}.jpg`);
    expect(isNewLayoutUrl(p.videoUrlFor('mp4'), 'id1')).toBe(true);
    expect(isNewLayoutUrl(p.videoUrlFor('mp4'), 'other')).toBe(false);
    expect(isNewLayoutUrl('/downloads/My Chan/id1.mp4', 'id1')).toBe(false);
    expect(isNewLayoutUrl(null, 'id1')).toBe(false);
  });

  it('rejects unsafe or malformed URL segments', () => {
    expect(decodeUrlSegments(['My%20Chan', 'a%20%5Bx%5D', 'f.mp4'])).toEqual(['My Chan', 'a [x]', 'f.mp4']);
    for (const bad of [['..', 'b', 'c'], ['a', '..%2Fb', 'c'], ['a', 'b%5Cc', 'd'], ['a', '%E0%A4%A', 'c'], ['a', '', 'c'], ['a', 'b%00', 'c']]) {
      expect(decodeUrlSegments(bad)).toBeNull();
    }
  });

  it('also looks directly in the base folder when it is named like the channel (doubled folder)', () => {
    expect(candidateVideoDirs('/m/Dup', 'Dup', 'T [1]')).toEqual([path.resolve('/m/Dup/Dup/T [1]'), path.resolve('/m/Dup/T [1]')]);
    expect(candidateVideoDirs('/m/videos', 'Dup', 'T [1]')).toEqual([path.resolve('/m/videos/Dup/T [1]')]);
  });
});
```

- [ ] **Step 2: Run it and see it fail:** `npx vitest run tests/unit/videoPaths.test.ts` → fails with "Failed to load url ../../server/utils/videoPaths" (module does not exist).

- [ ] **Step 3: Implement** `server/utils/videoPaths.ts` (complete file for this task; Tasks 3 and 4 append to it):

```ts
import path from 'path';

// One folder per video: <base>/<Channel>/<Title> [<id>]/<Title> [<id>].<ext>
// (spec docs/superpowers/specs/2026-10-06-video-storage-layout-design.md).

export const VIDEO_BASENAME_MAX_BYTES = 120;
export const VIDEO_EXTENSIONS = ['mp4', 'webm', 'mkv', '3gp', 'flv'];
export const THUMB_EXTENSIONS = ['jpg', 'jpeg', 'webp', 'png'];

// Path-forbidden characters on common filesystems (incl. SMB shares) and control characters.
const FORBIDDEN_CHARS = /[\\/:*?"<>|\u0000-\u001f\u007f]/g;

function cleanName(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .replace(FORBIDDEN_CHARS, '_')
    .replace(/^[\s.]+|[\s.]+$/g, '');
}

// Iterates by code point, so a multi-byte character is either kept whole or dropped.
function truncateToBytes(value: string, maxBytes: number): string {
  let out = '';
  let used = 0;
  for (const ch of value) {
    const size = Buffer.byteLength(ch, 'utf8');
    if (used + size > maxBytes) break;
    out += ch;
    used += size;
  }
  return out;
}

export function videoBaseName(title: string | null | undefined, id: string): string {
  const safeId = cleanName(id) || '_';
  const suffix = ` [${safeId}]`;
  const budget = Math.max(0, VIDEO_BASENAME_MAX_BYTES - Buffer.byteLength(suffix, 'utf8'));
  let name = cleanName(truncateToBytes(cleanName(title ?? ''), budget));
  if (!name) name = cleanName(truncateToBytes(safeId, budget)) || '_';
  return `${name}${suffix}`;
}

export function videoFolderName(title: string | null | undefined, id: string): string {
  return videoBaseName(title, id);
}

export interface VideoPaths {
  /** Absolute folder holding every file of the video. */
  dir: string;
  /** File-name stem shared by every file of the video; equals the folder name. */
  baseName: string;
  /** Web folder, `/downloads/<channel>/<video folder>`, each segment percent-encoded. */
  urlDir: string;
  /** yt-dlp `-o` value; literal `%` doubled so yt-dlp does not read it as a field. */
  outputTemplate: string;
  subtitleGlob: string;
  videoUrlFor(ext: string): string;
  thumbUrlFor(ext: string): string;
  subtitleUrlFor(fileName: string): string;
}

export function buildVideoPaths(opts: { baseDir: string; channelFolder: string; title: string | null | undefined; id: string }): VideoPaths {
  const channelFolder = !opts.channelFolder || opts.channelFolder === '.' || opts.channelFolder === '..' ? '_' : opts.channelFolder;
  const baseName = videoBaseName(opts.title, opts.id);
  const dir = path.join(opts.baseDir, channelFolder, baseName);
  const urlDir = `/downloads/${encodeURIComponent(channelFolder)}/${encodeURIComponent(baseName)}`;
  const fileUrl = (fileName: string) => `${urlDir}/${encodeURIComponent(fileName)}`;
  return {
    dir,
    baseName,
    urlDir,
    outputTemplate: `${path.join(dir, baseName).replace(/%/g, '%%')}.%(ext)s`,
    subtitleGlob: `${baseName}.*.vtt`,
    videoUrlFor: (ext) => fileUrl(`${baseName}.${ext}`),
    thumbUrlFor: (ext) => fileUrl(`${baseName}.${ext}`),
    subtitleUrlFor: (fileName) => fileUrl(fileName),
  };
}

/** Decodes URL path segments; null when one is malformed or could escape its folder. */
export function decodeUrlSegments(rawSegments: string[]): string[] | null {
  const out: string[] = [];
  for (const raw of rawSegments) {
    let segment: string;
    try {
      segment = decodeURIComponent(raw);
    } catch {
      return null;
    }
    if (!segment || segment === '.' || segment === '..' || /[\\/\u0000]/.test(segment)) return null;
    out.push(segment);
  }
  return out;
}

/** `[channel folder, video folder, file]` (decoded) for a new-layout stored URL, else null. */
export function storedUrlSegments(url: string | null | undefined): [string, string, string] | null {
  if (!url || !url.startsWith('/downloads/')) return null;
  const raw = url.slice('/downloads/'.length).split('/');
  if (raw.length !== 3) return null;
  const segments = decodeUrlSegments(raw);
  return segments ? [segments[0]!, segments[1]!, segments[2]!] : null;
}

/** The id between the last brackets of a video folder name (`<Title> [<id>]`). */
export function idFromVideoFolder(folder: string): string | null {
  const match = folder.match(/\[([^[\]]+)\]$/);
  return match ? match[1]! : null;
}

export function isNewLayoutUrl(url: string | null | undefined, id: string): boolean {
  const segments = storedUrlSegments(url);
  return !!segments && segments[1].endsWith(`[${id}]`);
}

/** Base folder used to READ a channel's files (same rule the file route has always used). */
export function channelReadBaseDir(customSavePath: string | null | undefined, downloadsDir: string): string {
  return customSavePath && customSavePath.trim().length > 0 ? customSavePath : downloadsDir;
}

/**
 * Folders where a new-layout video may live, in lookup order. The second entry
 * covers a channel whose custom save path already ends with the channel folder
 * name (the doubled-folder case) once the tidy tool has moved its videos up.
 */
export function candidateVideoDirs(baseDir: string, channelFolder: string, videoFolder: string): string[] {
  const resolvedBase = path.resolve(baseDir);
  const dirs = [path.resolve(resolvedBase, channelFolder, videoFolder)];
  if (path.basename(resolvedBase) === channelFolder) dirs.push(path.resolve(resolvedBase, videoFolder));
  return dirs;
}

/** True when `child` is strictly inside `parent`. */
export function isContained(parent: string, child: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}
```

- [ ] **Step 4: Run the test to pass:** `npx vitest run tests/unit/videoPaths.test.ts` → 5 passed.
- [ ] **Step 5: Mutation-check:** in `truncateToBytes` replace the code-point loop with `return value.slice(0, maxBytes / 2)` → the round-trip / 120-byte assertions fail; restore. Remove `.replace(/%/g, '%%')` → the template assertion fails; restore. Remove the `'..'` check in `decodeUrlSegments` → the unsafe-segment test fails; restore.
- [ ] **Step 6: Full suite and build:** `npx vitest run` (all pass) and `npx nuxt build 2>&1 | tail -5` (build succeeds).
- [ ] **Step 7: Commit:**

```bash
git add server/utils/videoPaths.ts tests/unit/videoPaths.test.ts
git commit -m "feat: video folder naming and URL helpers for the one-folder-per-video layout

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: File route serves nested new-layout paths

**Files:**
- Modify `server/routes/downloads/[...path].ts` (imports L1-3; path-resolution block L16-57; everything from L59 to the end stays byte-for-byte unchanged: belt-and-braces containment, 404, `canAccessVideo`, Content-Type, Cache-Control, If-Modified-Since, Range)
- Modify `tests/helpers/testDb.ts` (`insertChannel` L232-237, `insertVideo` L239-272: add optional fields; defaults unchanged)
- Create `tests/integration/downloads-video-layout.test.ts`

**Interfaces:**
- Consumes (Task 1, `server/utils/videoPaths.ts`): `decodeUrlSegments(rawSegments: string[]): string[] | null`, `idFromVideoFolder(folder: string): string | null`, `storedUrlSegments(url): [string, string, string] | null`, `channelReadBaseDir(customSavePath, downloadsDir): string`, `candidateVideoDirs(baseDir, channelFolder, videoFolder): string[]`, `isContained(parent, child): boolean`, `buildVideoPaths(...)` (tests only).
- Produces:
  - Route behaviour: a request with exactly 3 segments `/<channel folder>/<Title [id]>/<file>` (segments may be percent-encoded) is served when the video `id` exists, its stored `local_video_path` (or, if absent, `local_thumbnail_path`) points at the same channel + video folder, and the file exists in one of `candidateVideoDirs(channelReadBaseDir(custom_save_path, getDownloadsDir()), channelSegment, videoFolder)`. 400 for malformed/unsafe segments or a folder without `[id]`; 404 when the folder is not the video's stored folder or the file is missing; 403 when a candidate escapes the base folder or the viewer may not access the video. 2-segment (legacy) requests behave exactly as before; any other segment count is 400 as before.
  - Test helpers: `insertChannel(db, opts: { id: string; visibility?: string; title?: string; customSavePath?: string | null })`, `insertVideo(db, opts: { ...existing; title?: string })`.

- [ ] **Step 1: Extend the test helpers** in `tests/helpers/testDb.ts`. Replace `insertChannel` (L232-237) with:

```ts
export function insertChannel(db: Database.Database, opts: { id: string; visibility?: string; title?: string; customSavePath?: string | null }) {
  db.prepare(`
    INSERT INTO channels (id, title, visibility, custom_save_path, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(opts.id, opts.title ?? `Channel ${opts.id}`, opts.visibility ?? 'public', opts.customSavePath ?? null, Date.now());
}
```

In `insertVideo` add `title?: string;` to the options type (after `channelId: string;`) and replace the `` `Video ${opts.id}` `` argument (L258) with `opts.title ?? \`Video ${opts.id}\``. Nothing else changes, so every existing test keeps its data.

- [ ] **Step 2: Write the failing test** `tests/integration/downloads-video-layout.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import handler from '../../server/routes/downloads/[...path]';
import { createTestDb, insertChannel, insertVideo, mockEvent } from '../helpers/testDb';
import { sanitizeFolderName } from '../../server/utils/downloader';
import { canAccessVideo } from '../../server/utils/auth';
import { buildVideoPaths } from '../../server/utils/videoPaths';

let db: Database.Database;
let dir: string;

beforeEach(() => {
  db = createTestDb();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yk-route-'));
  (globalThis as any).getDb = () => db;
  (globalThis as any).getDownloadsDir = () => dir;
  (globalThis as any).sanitizeFolderName = sanitizeFolderName;
  (globalThis as any).canAccessVideo = canAccessVideo;
  (globalThis as any).getQuery = () => ({});
});

afterEach(async () => {
  // Let any lazily-opened read stream settle before removing its file.
  await new Promise((resolve) => setImmediate(resolve));
  fs.rmSync(dir, { recursive: true, force: true });
});

function closeIfStream(result: any) {
  if (result && typeof result.destroy === 'function') {
    result.on?.('error', () => {});
    result.destroy();
  }
}

function seed(opts: { id: string; channelId: string; channelTitle: string; title: string; baseDir: string; visibility?: string; customSavePath?: string }) {
  insertChannel(db, { id: opts.channelId, title: opts.channelTitle, visibility: opts.visibility, customSavePath: opts.customSavePath ?? null });
  const p = buildVideoPaths({ baseDir: opts.baseDir, channelFolder: opts.channelTitle, title: opts.title, id: opts.id });
  insertVideo(db, { id: opts.id, channelId: opts.channelId, title: opts.title, visibility: opts.visibility, localVideoPath: p.videoUrlFor('mp4'), localThumbnailPath: p.thumbUrlFor('jpg') });
  fs.mkdirSync(p.dir, { recursive: true });
  fs.writeFileSync(path.join(p.dir, `${p.baseName}.mp4`), '0123456789');
  return p;
}

// The stored (percent-encoded) URL is what the browser requests; h3 hands the
// route the raw remainder of the path, still encoded.
const eventFor = (url: string, headers?: Record<string, string>) =>
  mockEvent(undefined, { path: url, params: { path: url.slice('/downloads/'.length) }, headers });

describe('GET /downloads/<channel>/<Title [id]>/<file>', () => {
  it('serves a file from the video folder, with Range support', async () => {
    const p = seed({ id: 'v1', channelId: 'c1', channelTitle: 'My Chan', title: 'Episode #3: 100% done?', baseDir: dir });
    const event = eventFor(p.videoUrlFor('mp4'), { range: 'bytes=0-3' });
    closeIfStream(await handler(event));
    expect(event.node.res.statusCode).toBe(206);
    expect(event.node.res.headers['content-range']).toBe('bytes 0-3/10');
    expect(event.node.res.headers['content-type']).toBe('video/mp4');
  });

  it('finds a video already moved up out of a doubled channel folder', async () => {
    const custom = path.join(dir, 'Dup');
    const p = seed({ id: 'd1', channelId: 'c2', channelTitle: 'Dup', title: 'Clip', baseDir: custom, customSavePath: custom });
    fs.renameSync(p.dir, path.join(custom, p.baseName));
    const event = eventFor(p.videoUrlFor('mp4'));
    closeIfStream(await handler(event));
    expect(event.node.res.statusCode).toBe(200);
  });

  it('refuses traversal, folders that are not the video\'s own, and private videos', async () => {
    const p = seed({ id: 'v1', channelId: 'c1', channelTitle: 'My Chan', title: 'Clip', baseDir: dir });
    const folder = encodeURIComponent(p.baseName);
    await expect(handler(eventFor('/downloads/My%20Chan/..%2F..%2Fetc/passwd'))).rejects.toMatchObject({ statusCode: 400 });
    await expect(handler(eventFor(`/downloads/My%20Chan/${folder}/..`))).rejects.toMatchObject({ statusCode: 400 });
    await expect(handler(eventFor('/downloads/My%20Chan/No%20id%20here/x.mp4'))).rejects.toMatchObject({ statusCode: 400 });
    // Same video folder name copied under another channel folder: not the stored folder.
    fs.mkdirSync(path.join(dir, 'Other', p.baseName), { recursive: true });
    fs.writeFileSync(path.join(dir, 'Other', p.baseName, `${p.baseName}.mp4`), 'x');
    await expect(handler(eventFor(`/downloads/Other/${folder}/${encodeURIComponent(`${p.baseName}.mp4`)}`))).rejects.toMatchObject({ statusCode: 404 });

    const secret = seed({ id: 'v2', channelId: 'c3', channelTitle: 'Secret', title: 'Hidden', baseDir: dir, visibility: 'private' });
    await expect(handler(eventFor(secret.videoUrlFor('mp4')))).rejects.toMatchObject({ statusCode: 403 });
  });
});
```

- [ ] **Step 3: Run it and see it fail:** `npx vitest run tests/integration/downloads-video-layout.test.ts` → the first two tests fail with a 400 "Invalid file path" (3-segment paths are rejected today).

- [ ] **Step 4: Implement.** In `server/routes/downloads/[...path].ts` add after L3:

```ts
import { candidateVideoDirs, channelReadBaseDir, decodeUrlSegments, idFromVideoFolder, isContained, storedUrlSegments } from '../../utils/videoPaths';
```

Replace L16-57 (from `const parts = filePath.split('/');` through the closing `}` of the legacy block) with the following. The `else` branch is the current L17-57 moved verbatim (no logic change; the only edit allowed is the comment wording noted below):

```ts
  const parts = filePath.split('/');
  if (parts.length === 3) {
    // One folder per video: <channel folder>/<Title [id]>/<file>, percent-encoded.
    // The id comes from the folder name, and the folder must be the one stored
    // for that video (the database is the source of truth for file locations).
    const segments = decodeUrlSegments(parts);
    const videoId = segments ? idFromVideoFolder(segments[1]!) : null;
    if (!segments || !videoId) {
      throw createError({ statusCode: 400, statusMessage: 'Invalid file path' });
    }
    const [channelSegment, videoFolder, fileName] = segments as [string, string, string];
    const db = getDb();
    const video = db.prepare(`
      SELECT v.id, v.local_video_path, v.local_thumbnail_path, c.custom_save_path
      FROM videos v JOIN channels c ON c.id = v.channel_id
      WHERE v.id = ?
    `).get(videoId) as { id: string; local_video_path: string | null; local_thumbnail_path: string | null; custom_save_path: string | null } | undefined;
    const stored = storedUrlSegments(video?.local_video_path) ?? storedUrlSegments(video?.local_thumbnail_path);
    if (!video || !stored || stored[0] !== channelSegment || stored[1] !== videoFolder) {
      throw createError({ statusCode: 404, statusMessage: 'File not found' });
    }
    const baseDir = path.resolve(channelReadBaseDir(video.custom_save_path, downloadsDir));
    const candidates = candidateVideoDirs(baseDir, channelSegment, videoFolder).map((dir) => path.resolve(dir, fileName));
    if (candidates.some((candidate) => !isContained(baseDir, candidate))) {
      throw createError({ statusCode: 403, statusMessage: 'Access denied' });
    }
    absolutePath = candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0]!;
    matchedVideoId = video.id;
  } else {
    if (parts.length < 2) {
      throw createError({ statusCode: 400, statusMessage: 'Invalid file path' });
    }
    {
      // ... current L21-56 unchanged (legacy: flat <channelDir>/<videoId>.<ext>) ...
    }
  }
```

(The comment line above stands for the existing L21-56 copied verbatim; keep the existing comment "Files are always stored flat..." and rephrase only its first sentence to "Legacy files are stored flat as {channelDir}/{videoId}.{ext}".) What must keep working: `tests/integration/downloads-cache-control.test.ts` (legacy 200/304/403/404/206) passes unchanged.

- [ ] **Step 5: Run the tests to pass:** `npx vitest run tests/integration/downloads-video-layout.test.ts tests/integration/downloads-cache-control.test.ts` → all pass.
- [ ] **Step 6: Mutation-check:** delete `stored[0] !== channelSegment || ` → the "Other" assertion fails (file served); restore. Replace `candidates.find(...) ?? candidates[0]!` with `candidates[0]!` → the doubled-folder test fails; restore.
- [ ] **Step 7: Full suite and build:** `npx vitest run` and `npx nuxt build 2>&1 | tail -5`.
- [ ] **Step 8: Commit:**

```bash
git add "server/routes/downloads/[...path].ts" tests/helpers/testDb.ts tests/integration/downloads-video-layout.test.ts
git commit -m "feat: serve videos stored one folder per video

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Downloader writes new downloads in the new layout

**Files:**
- Modify `server/utils/videoPaths.ts` (append `locateDownloadedFiles`, `StoredVideoLocation`, `removeVideoFiles`; add `import fs from 'fs';` at the top)
- Modify `server/utils/downloader.ts`: imports L1-11; `cleanupPartialFiles` L28-46; `downloadVideoFile` setup L685-697; post-download lookup L846-880 (L881-1000 unchanged: info JSON parsing, comments, chapters, `fs.unlinkSync(infoJsonFile)`, size, DB update, error paths)
- Create `tests/integration/downloader-video-layout.test.ts`

**Interfaces:**
- Consumes (Task 1): `buildVideoPaths`, `VideoPaths`, `VIDEO_EXTENSIONS`, `THUMB_EXTENSIONS`, `isContained`.
- Produces (in `server/utils/videoPaths.ts`):
  - `export function locateDownloadedFiles(p: VideoPaths): { videoFile: string | null; videoUrl: string | null; thumbnailUrl: string | null; infoJsonFile: string }`
  - `export interface StoredVideoLocation { layout: 'new' | 'legacy'; baseDir: string; dir: string; baseName: string; urlDir: string; videoFile: string | null }`
  - `export function removeVideoFiles(loc: StoredVideoLocation): void` — new layout only (no-op for legacy): removes the whole folder when every entry starts with `<baseName>.`, otherwise removes only those entries and keeps the folder; does nothing when the folder is missing or not strictly inside `baseDir`.
  - Downloader behaviour: yt-dlp `-o` is `buildVideoPaths(...).outputTemplate` with the video's title from `videos.title`; stored URLs are `videoUrlFor(ext)` / `thumbUrlFor(ext)`; `cleanupPartialFiles(videoId, channelId)` (signature unchanged) removes legacy leftovers as before and the new-layout folder's own files.

- [ ] **Step 1: Write the failing test** `tests/integration/downloader-video-layout.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../server/utils/db', () => ({ getDb: () => (globalThis as any).getDb() }));

import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { cleanupPartialFiles } from '../../server/utils/downloader';
import { buildVideoPaths, locateDownloadedFiles } from '../../server/utils/videoPaths';
import { createTestDb, insertChannel, insertVideo } from '../helpers/testDb';

let db: Database.Database;
let dir: string;

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yk-dl-'));
  insertChannel(db, { id: 'c1', title: 'Chan', customSavePath: dir });
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('downloader, one folder per video', () => {
  it('finds what yt-dlp wrote in the video folder and builds the stored URLs', () => {
    const p = buildVideoPaths({ baseDir: dir, channelFolder: 'Chan', title: 'Hello World', id: 'abc' });
    fs.mkdirSync(p.dir, { recursive: true });
    fs.writeFileSync(path.join(p.dir, 'Hello World [abc].mp4.part'), 'x');
    expect(locateDownloadedFiles(p).videoUrl).toBeNull();

    for (const f of ['Hello World [abc].webm', 'Hello World [abc].webp', 'Hello World [abc].fr.vtt']) fs.writeFileSync(path.join(p.dir, f), 'x');
    const found = locateDownloadedFiles(p);
    const folder = 'Hello%20World%20%5Babc%5D';
    expect(found.videoFile).toBe(path.join(dir, 'Chan', 'Hello World [abc]', 'Hello World [abc].webm'));
    expect(found.videoUrl).toBe(`/downloads/Chan/${folder}/${folder}.webm`);
    expect(found.thumbnailUrl).toBe(`/downloads/Chan/${folder}/${folder}.webp`);
    expect(found.infoJsonFile).toBe(path.join(p.dir, 'Hello World [abc].info.json'));
  });

  it('cleanup after a failed or cancelled download removes only that video\'s files', () => {
    insertVideo(db, { id: 'abc', channelId: 'c1', title: 'Hello World', downloadStatus: 'downloading' });
    insertVideo(db, { id: 'def', channelId: 'c1', title: 'Other', downloadStatus: 'downloading' });
    const a = buildVideoPaths({ baseDir: dir, channelFolder: 'Chan', title: 'Hello World', id: 'abc' });
    const b = buildVideoPaths({ baseDir: dir, channelFolder: 'Chan', title: 'Other', id: 'def' });
    fs.mkdirSync(a.dir, { recursive: true });
    fs.mkdirSync(b.dir, { recursive: true });
    fs.writeFileSync(path.join(a.dir, `${a.baseName}.f137.mp4.part`), 'x');
    fs.writeFileSync(path.join(a.dir, `${a.baseName}.webp`), 'x');
    fs.writeFileSync(path.join(b.dir, `${b.baseName}.mp4.part`), 'x');
    fs.writeFileSync(path.join(b.dir, 'notes.txt'), 'x');
    fs.writeFileSync(path.join(dir, 'Chan', 'abc.mp4.part'), 'x'); // legacy leftover

    cleanupPartialFiles('abc', 'c1');
    cleanupPartialFiles('def', 'c1');

    expect(fs.existsSync(a.dir)).toBe(false);
    expect(fs.readdirSync(b.dir)).toEqual(['notes.txt']);
    expect(fs.existsSync(path.join(dir, 'Chan', 'abc.mp4.part'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and see it fail:** `npx vitest run tests/integration/downloader-video-layout.test.ts` → fails: `locateDownloadedFiles` is not exported.

- [ ] **Step 3: Implement the helpers.** In `server/utils/videoPaths.ts` add `import fs from 'fs';` as the first import, then append:

```ts
/** Locates the files yt-dlp produced for a video (any container / thumbnail extension). */
export function locateDownloadedFiles(p: VideoPaths): { videoFile: string | null; videoUrl: string | null; thumbnailUrl: string | null; infoJsonFile: string } {
  let videoFile: string | null = null;
  let videoUrl: string | null = null;
  for (const ext of VIDEO_EXTENSIONS) {
    const candidate = path.join(p.dir, `${p.baseName}.${ext}`);
    if (fs.existsSync(candidate)) {
      videoFile = candidate;
      videoUrl = p.videoUrlFor(ext);
      break;
    }
  }
  let thumbnailUrl: string | null = null;
  for (const ext of THUMB_EXTENSIONS) {
    if (fs.existsSync(path.join(p.dir, `${p.baseName}.${ext}`))) {
      thumbnailUrl = p.thumbUrlFor(ext);
      break;
    }
  }
  return { videoFile, videoUrl, thumbnailUrl, infoJsonFile: path.join(p.dir, `${p.baseName}.info.json`) };
}

export interface StoredVideoLocation {
  layout: 'new' | 'legacy';
  /** Absolute channel base folder (custom save path or downloads dir). */
  baseDir: string;
  /** Absolute folder holding the video's files. */
  dir: string;
  /** File-name stem: '<Title> [<id>]' (new layout) or '<id>' (legacy). */
  baseName: string;
  /** Web folder: percent-encoded for the new layout, raw (as always) for legacy. */
  urlDir: string;
  /** Absolute path of the stored video file, when a path is stored. */
  videoFile: string | null;
}

/**
 * Removes a new-layout video's files: the whole folder when it holds nothing
 * else, otherwise only the entries named after the video. Legacy locations are
 * left to their callers' existing file lists.
 */
export function removeVideoFiles(loc: StoredVideoLocation): void {
  if (loc.layout !== 'new') return;
  if (!isContained(loc.baseDir, loc.dir) || !fs.existsSync(loc.dir)) return;
  const prefix = `${loc.baseName}.`;
  const entries = fs.readdirSync(loc.dir);
  const own = entries.filter((entry) => entry.startsWith(prefix));
  if (own.length === entries.length) {
    fs.rmSync(loc.dir, { recursive: true, force: true });
    return;
  }
  for (const entry of own) {
    try {
      fs.rmSync(path.join(loc.dir, entry), { recursive: true, force: true });
    } catch (err) {
      console.error(`Failed to delete video file ${path.join(loc.dir, entry)}:`, err);
    }
  }
}
```

- [ ] **Step 4: Wire the downloader.** In `server/utils/downloader.ts`:
  - After L11 add `import { buildVideoPaths, locateDownloadedFiles, removeVideoFiles } from './videoPaths';`
  - Replace `cleanupPartialFiles` (L28-46) with:

```ts
// Removes a video's downloaded/partial files from disk, honoring the
// channel's custom_save_path if set. Used both on explicit cancel and on
// watchdog timeout so partial downloads never linger indefinitely.
// Covers both layouts: legacy files directly in the channel folder, and the
// video's own folder (one folder per video, named from its title).
export function cleanupPartialFiles(videoId: string, channelId: string): void {
  const db = getDb();
  const channel = db.prepare('SELECT title, custom_save_path FROM channels WHERE id = ?').get(channelId) as { title: string; custom_save_path: string | null } | undefined;
  const basePath = resolveChannelBaseDir(channel?.custom_save_path);
  const channelFolder = sanitizeFolderName(channel?.title || channelId);
  const channelDir = path.join(basePath, channelFolder);
  const mp4File = path.join(channelDir, `${videoId}.mp4`);
  const jpgFile = path.join(channelDir, `${videoId}.jpg`);
  const partFile = path.join(channelDir, `${videoId}.mp4.part`);
  const ytdlPartFile = path.join(channelDir, `${videoId}.mp4.ytdl`);

  [mp4File, jpgFile, partFile, ytdlPartFile].forEach(f => {
    if (fs.existsSync(f)) {
      try { fs.unlinkSync(f); } catch (e) {}
    }
  });

  const video = db.prepare('SELECT title FROM videos WHERE id = ?').get(videoId) as { title: string } | undefined;
  if (video) {
    const paths = buildVideoPaths({ baseDir: basePath, channelFolder, title: video.title, id: videoId });
    try {
      removeVideoFiles({ layout: 'new', baseDir: basePath, dir: paths.dir, baseName: paths.baseName, urlDir: paths.urlDir, videoFile: null });
    } catch (e) {}
  }
}
```

  - In `downloadVideoFile` replace L687-697 (from `const channelDir = ...` through `const isShort = isShortRecord?.is_short === 1;`; L685-686 stay) with:

```ts
    const videoRow = db.prepare('SELECT is_short, title FROM videos WHERE id = ?').get(videoId) as { is_short: number; title: string } | undefined;
    // One folder per video: <base>/<Channel>/<Title> [<id>]/<Title> [<id>].<ext>
    const paths = buildVideoPaths({
      baseDir: basePath,
      channelFolder: sanitizeFolderName(channel?.title || channelId),
      title: videoRow?.title,
      id: videoId,
    });
    const outputTemplate = paths.outputTemplate;

    // Ensure directory exists
    if (!fs.existsSync(paths.dir)) {
      fs.mkdirSync(paths.dir, { recursive: true });
    }

    const isShort = videoRow?.is_short === 1;
```

  - In the `close` handler replace L846-880 (from `const folderName = ...` through `const infoJsonFile = path.join(channelDir, \`${videoId}.info.json\`);`) with:

```ts
        // Locate what yt-dlp wrote in the video's own folder (mp4, webm, mkv, ...
        // and jpg, webp, png, ... thumbnails).
        const found = locateDownloadedFiles(paths);
        const videoFile = found.videoFile;
        const videoUrlPath = found.videoUrl;

        if (!videoFile || !videoUrlPath) {
          const errorMsg = lastStderr ? `yt-dlp a terminé mais aucun fichier vidéo n'a été trouvé : ${lastStderr}` : `yt-dlp a terminé mais aucun fichier vidéo n'a été trouvé`;
          settle(() => reject(new Error(errorMsg)));
          return;
        }

        const thumbnailUrlPath = found.thumbnailUrl;
        const infoJsonFile = found.infoJsonFile;
```

  (The French error string is the existing one, kept as is; `downloader.ts` is not scanned by the English-only guard.) Verify with `grep -n "channelDir\|folderName\|isShortRecord\|thumbnailFile" server/utils/downloader.ts` that no reference remains inside `downloadVideoFile` (L668-1000); `channelDir` remains only in `cleanupPartialFiles`. L953 `const fileSize = videoUrlPath && fs.existsSync(videoFile) ? ...` keeps working (`videoFile` is now a non-null string at that point).

- [ ] **Step 5: Run the tests to pass:** `npx vitest run tests/integration/downloader-video-layout.test.ts` → 2 passed.
- [ ] **Step 6: Mutation-check:** in `removeVideoFiles` replace `own.length === entries.length` with `true` → the `notes.txt` assertion fails; restore. Remove the new-layout block from `cleanupPartialFiles` → `a.dir` still exists, test fails; restore.
- [ ] **Step 7: Full suite and build:** `npx vitest run` and `npx nuxt build 2>&1 | tail -5`.
- [ ] **Step 8: Commit:**

```bash
git add server/utils/videoPaths.ts server/utils/downloader.ts tests/integration/downloader-video-layout.test.ts
git commit -m "feat: download each video into its own folder named after its title

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Subtitle scan, video delete and duration backfill use the stored path

**Files:**
- Modify `server/utils/videoPaths.ts` (append `resolveStoredPath`, `listSubtitleFiles`; add imports)
- Modify `server/api/videos/[id].get.ts` (L5 import; subtitle block L77-121)
- Modify `server/api/admin/videos/[id].delete.ts` (L1-3 imports; L16-20 select; insert location before L37; L41-43)
- Modify `server/utils/videoDurations.ts` (L5 import; L94-102)
- Create `tests/integration/video-files-layout.test.ts`
- Modify `tests/unit/videoDurations.test.ts` (add one test at the end of the `describe`)

Unchanged on purpose (both layouts already handled): `server/api/admin/channels/[id].delete.ts` and `server/utils/libraryWipe.ts` remove the whole channel folder recursively; `server/plugins/scheduler.ts` only calls `backfillMissingVideoDurations`; client components (`VideoCard.vue`, `VideoPlayer.vue`, `pages/index.vue`, `pages/shorts.vue`, `pages/watch/[id].vue`, playlists) use the stored URLs opaquely; `server/utils/db.ts` size backfill (dead path, out of scope).

**Interfaces:**
- Consumes (Tasks 1 and 3): `buildVideoPaths`, `storedUrlSegments`, `isNewLayoutUrl`, `channelReadBaseDir`, `candidateVideoDirs`, `isContained`, `StoredVideoLocation`, `removeVideoFiles`; from `server/utils/downloader.ts`: `getDownloadsDir(): string`, `sanitizeFolderName(name: string): string`.
- Produces (in `server/utils/videoPaths.ts`):
  - `export function resolveStoredPath(db: Database.Database, row: { id: string; channel_id: string; title?: string | null; local_video_path: string | null }, opts?: { downloadsDir?: string }): StoredVideoLocation` — new layout: folder from the stored URL (first existing of `candidateVideoDirs`), `urlDir` re-encoded from the stored segments; legacy: `<base>/<sanitizeFolderName(channel title || channel id)>` with raw `urlDir` `/downloads/<channelFolder>` (identical to today's scan); no stored path: the computed new-layout folder.
  - `export function listSubtitleFiles(loc: StoredVideoLocation): { code: string; fileName: string; url: string }[]` — entries of `loc.dir` named `<baseName>.<code>.vtt` (non-empty code); `[]` when the folder is missing or not inside `loc.baseDir`.

Note: `videoPaths.ts` now imports `getDownloadsDir` and `sanitizeFolderName` from `./downloader`, which imports `videoPaths.ts` (Task 3). This cycle is safe because neither module uses the other's exports at module top level, only inside functions; do not add top-level calls across it.

- [ ] **Step 1: Write the failing tests.** Create `tests/integration/video-files-layout.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import deleteHandler from '../../server/api/admin/videos/[id].delete';
import { requireAdmin } from '../../server/utils/auth';
import { sanitizeFolderName } from '../../server/utils/downloader';
import { buildVideoPaths, listSubtitleFiles, resolveStoredPath } from '../../server/utils/videoPaths';
import { createTestDb, insertChannel, insertSession, insertUser, insertVideo, mockEvent, sessionCookie } from '../helpers/testDb';

let db: Database.Database;
let dir: string;

beforeEach(() => {
  db = createTestDb();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yk-files-'));
  (globalThis as any).getDb = () => db;
  (globalThis as any).getDownloadsDir = () => dir;
  (globalThis as any).requireAdmin = requireAdmin;
  (globalThis as any).sanitizeFolderName = sanitizeFolderName;
  // The real cancelDownload also deletes files; stub it so these tests prove the route's own removal.
  (globalThis as any).cancelDownload = () => true;
  insertChannel(db, { id: 'c1', title: 'Chan' });
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function newLayout(id: string, title: string, suffixes: string[]) {
  const p = buildVideoPaths({ baseDir: dir, channelFolder: 'Chan', title, id });
  insertVideo(db, { id, channelId: 'c1', title, localVideoPath: p.videoUrlFor('mp4'), localThumbnailPath: p.thumbUrlFor('jpg') });
  fs.mkdirSync(p.dir, { recursive: true });
  for (const s of suffixes) fs.writeFileSync(path.join(p.dir, `${p.baseName}${s}`), 'x');
  return p;
}

function legacy(id: string, suffixes: string[]) {
  insertVideo(db, { id, channelId: 'c1', localVideoPath: `/downloads/Chan/${id}.mp4`, localThumbnailPath: `/downloads/Chan/${id}.jpg` });
  fs.mkdirSync(path.join(dir, 'Chan'), { recursive: true });
  for (const s of suffixes) fs.writeFileSync(path.join(dir, 'Chan', `${id}${s}`), 'x');
}

const row = (id: string) => db.prepare('SELECT id, channel_id, title, local_video_path FROM videos WHERE id = ?').get(id) as any;

function adminCookie() {
  insertUser(db, { id: 'admin1', role: 'admin' });
  insertSession(db, { id: 'sess-admin1', userId: 'admin1' });
  return sessionCookie('sess-admin1');
}

describe('video files in both layouts', () => {
  it('finds subtitles in the video folder (new layout) and in the channel folder (legacy)', () => {
    const p = newLayout('n1', 'New One', ['.mp4', '.fr.vtt', '.en-US.vtt']);
    legacy('l1', ['.mp4', '.jpg', '.es.vtt']);

    const n = resolveStoredPath(db, row('n1'), { downloadsDir: dir });
    expect(n).toMatchObject({ layout: 'new', dir: p.dir, baseName: p.baseName });
    expect(listSubtitleFiles(n).map((s) => [s.code, s.url]).sort()).toEqual([
      ['en-US', p.subtitleUrlFor(`${p.baseName}.en-US.vtt`)],
      ['fr', p.subtitleUrlFor(`${p.baseName}.fr.vtt`)],
    ]);

    const l = resolveStoredPath(db, row('l1'), { downloadsDir: dir });
    expect(l.layout).toBe('legacy');
    expect(listSubtitleFiles(l)).toEqual([{ code: 'es', fileName: 'l1.es.vtt', url: '/downloads/Chan/l1.es.vtt' }]);
  });

  it('deleting a new-layout video removes its folder only when nothing else is in it', async () => {
    const cookie = adminCookie();
    const alone = newLayout('n1', 'Alone', ['.mp4', '.jpg', '.fr.vtt']);
    const shared = newLayout('n2', 'Shared', ['.mp4']);
    fs.writeFileSync(path.join(shared.dir, 'keep-me.txt'), 'x');

    await deleteHandler(mockEvent(cookie, { method: 'DELETE', params: { id: 'n1' } }));
    await deleteHandler(mockEvent(cookie, { method: 'DELETE', params: { id: 'n2' } }));

    expect(fs.existsSync(alone.dir)).toBe(false);
    expect(fs.readdirSync(shared.dir)).toEqual(['keep-me.txt']);
    expect(fs.existsSync(path.join(dir, 'Chan'))).toBe(true);
  });

  it('deleting a legacy video still removes its files from the channel folder', async () => {
    const cookie = adminCookie();
    legacy('l1', ['.mp4', '.jpg']);
    legacy('l2', ['.mp4']);
    await deleteHandler(mockEvent(cookie, { method: 'DELETE', params: { id: 'l1' } }));
    expect(fs.readdirSync(path.join(dir, 'Chan'))).toEqual(['l2.mp4']);
  });
});
```

Append inside the `describe('backfillMissingVideoDurations', ...)` block of `tests/unit/videoDurations.test.ts` (and add `import { buildVideoPaths } from '../../server/utils/videoPaths';` to its imports):

```ts
  it('probes a new-layout video inside its own folder', async () => {
    const p = buildVideoPaths({ baseDir: dir, channelFolder: 'Channel c1', title: 'Clip: one', id: 'nl' });
    insertVideo(db, { id: 'nl', channelId: 'c1', localVideoPath: p.videoUrlFor('mp4') });
    fs.mkdirSync(p.dir, { recursive: true });
    fs.writeFileSync(path.join(p.dir, `${p.baseName}.mp4`), 'x');
    const probe = vi.fn(async () => 12);
    expect((await backfillMissingVideoDurations(db, probe, { downloadsDir: dir })).updated).toBe(1);
    expect(probe).toHaveBeenCalledWith(path.join(p.dir, `${p.baseName}.mp4`));
  });
```

- [ ] **Step 2: Run them and see them fail:** `npx vitest run tests/integration/video-files-layout.test.ts tests/unit/videoDurations.test.ts` → `resolveStoredPath`/`listSubtitleFiles` are not exported; the new-layout delete leaves the folder; the duration probe is never called for the new layout.

- [ ] **Step 3: Implement the helpers.** In `server/utils/videoPaths.ts` add to the imports:

```ts
import type Database from 'better-sqlite3';
import { getDownloadsDir, sanitizeFolderName } from './downloader';
```

and append:

```ts
/**
 * Where a video's files are on disk. The stored path is the source of truth:
 * a new-layout URL maps to its own folder (looked up the same way the file
 * route does), a legacy URL to the channel folder; only a video without a
 * stored path yet gets its folder computed from title + id.
 */
export function resolveStoredPath(
  db: Database.Database,
  row: { id: string; channel_id: string; title?: string | null; local_video_path: string | null },
  opts: { downloadsDir?: string } = {},
): StoredVideoLocation {
  const channel = db.prepare('SELECT title, custom_save_path FROM channels WHERE id = ?').get(row.channel_id) as
    { title: string | null; custom_save_path: string | null } | undefined;
  const downloadsDir = opts.downloadsDir ?? getDownloadsDir();
  const baseDir = path.resolve(channelReadBaseDir(channel?.custom_save_path, downloadsDir));
  const channelFolder = sanitizeFolderName(channel?.title || row.channel_id);

  const stored = isNewLayoutUrl(row.local_video_path, row.id) ? storedUrlSegments(row.local_video_path) : null;
  if (stored) {
    const [channelSegment, videoFolder, fileName] = stored;
    const candidates = candidateVideoDirs(baseDir, channelSegment, videoFolder);
    const dir = candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0]!;
    return {
      layout: 'new',
      baseDir,
      dir,
      baseName: videoFolder,
      urlDir: `/downloads/${encodeURIComponent(channelSegment)}/${encodeURIComponent(videoFolder)}`,
      videoFile: path.join(dir, fileName),
    };
  }
  if (row.local_video_path) {
    const dir = path.resolve(baseDir, channelFolder);
    return {
      layout: 'legacy',
      baseDir,
      dir,
      baseName: row.id,
      urlDir: `/downloads/${channelFolder}`,
      videoFile: path.resolve(dir, path.posix.basename(row.local_video_path)),
    };
  }
  const p = buildVideoPaths({ baseDir, channelFolder, title: row.title, id: row.id });
  return { layout: 'new', baseDir, dir: p.dir, baseName: p.baseName, urlDir: p.urlDir, videoFile: null };
}

/** Subtitle files `<baseName>.<code>.vtt` next to the video. */
export function listSubtitleFiles(loc: StoredVideoLocation): { code: string; fileName: string; url: string }[] {
  if (!isContained(loc.baseDir, loc.dir) || !fs.existsSync(loc.dir)) return [];
  const prefix = `${loc.baseName}.`;
  return fs.readdirSync(loc.dir)
    .filter((file) => file.startsWith(prefix) && file.endsWith('.vtt'))
    .map((file) => ({
      code: file.slice(prefix.length, file.length - '.vtt'.length),
      fileName: file,
      url: loc.layout === 'new' ? `${loc.urlDir}/${encodeURIComponent(file)}` : `${loc.urlDir}/${file}`,
    }))
    .filter((sub) => sub.code.length > 0);
}
```

- [ ] **Step 4: Subtitle scan.** In `server/api/videos/[id].get.ts` replace L5 (`import { getDownloadsDir } from '../../utils/downloader';`) with `import { listSubtitleFiles, resolveStoredPath } from '../../utils/videoPaths';` (`getDownloadsDir` becomes the ambient auto-import like in the other routes; drop the now-unused `fs`/`path` imports at L3-4 only if nothing else in the file uses them — check with grep). Replace L77-121 with:

```ts
  // Local subtitles (.vtt) next to the video: in its own folder (one folder per
  // video) or, for legacy videos, in the channel folder as <id>.<lang>.vtt.
  const subtitles: { code: string; label: string; url: string }[] = [];
  if (video.local_video_path && video.local_video_path.startsWith('/downloads/')) {
    try {
      const labelMap: Record<string, string> = {
        en: 'English',
        fr: 'French',
        es: 'Spanish',
        de: 'German',
        it: 'Italian',
        ja: 'Japanese',
        zh: 'Chinese',
        ru: 'Russian',
        pt: 'Portuguese',
      };
      const location = resolveStoredPath(db, video, { downloadsDir: getDownloadsDir() });
      for (const sub of listSubtitleFiles(location)) {
        // Match codes like en-US, fr-FR, etc.
        const cleanCode = sub.code.split('-')[0]?.toLowerCase() || sub.code.toLowerCase();
        subtitles.push({ code: sub.code, label: labelMap[cleanCode] || sub.code.toUpperCase(), url: sub.url });
      }
    } catch (e) {
      console.error('Error scanning subtitles:', e);
    }
  }
```

- [ ] **Step 5: Video delete.** In `server/api/admin/videos/[id].delete.ts`:
  - After L3 add `import { removeVideoFiles, resolveStoredPath } from '../../../utils/videoPaths';`
  - Replace the select L16-20 with:

```ts
  const video = db.prepare('SELECT id, title, channel_id, local_video_path, local_thumbnail_path FROM videos WHERE id = ?').get(videoId) as {
    id: string;
    title: string;
    channel_id: string;
    local_video_path: string | null;
    local_thumbnail_path: string | null;
  } | undefined;
```

  - Just before `// 2. Kill the download if it's running` (L37) insert:

```ts
  // Where this video's files are, resolved before its row is deleted: its own
  // folder (one folder per video) or, for legacy videos, the channel folder.
  const location = resolveStoredPath(db, video, { downloadsDir: getDownloadsDir() });
```

  - Right after `db.prepare('DELETE FROM videos WHERE id = ?').run(videoId);` (L41) insert:

```ts
  if (location.layout === 'new') {
    // Removes the folder only when it holds nothing but this video's files.
    removeVideoFiles(location);
    return { success: true };
  }
```

  L26-35 and L43-65 stay unchanged (legacy deletion list).

- [ ] **Step 6: Duration backfill.** In `server/utils/videoDurations.ts` change L5 to `import { buildSpawnEnv, getDownloadsDir } from './downloader';`, add `import { isContained, resolveStoredPath } from './videoPaths';`, and replace L94-102 (from `const fileName = path.basename(row.localPath);` through `if (!fs.existsSync(filePath)) continue;`) with:

```ts
          // Same mapping as server/routes/downloads: the stored path decides the
          // folder (one folder per video, or the channel folder for legacy rows).
          const location = resolveStoredPath(db, { id: row.id, channel_id: row.channelId, local_video_path: row.localPath }, { downloadsDir });
          const filePath = location.videoFile;
          if (!filePath || !isContained(location.baseDir, filePath)) continue;
          if (!fs.existsSync(filePath)) continue;
```

  Update the JSDoc above `backfillMissingVideoDurations` ("File path mirrors server/routes/downloads: ...") to "File path comes from resolveStoredPath (same mapping as server/routes/downloads)." Remove the `path` import only if it is now unused. Every existing test in `tests/unit/videoDurations.test.ts` must pass unchanged (custom save path, empty title fallback, `..` escape refused).

- [ ] **Step 7: Run the tests to pass:** `npx vitest run tests/integration/video-files-layout.test.ts tests/unit/videoDurations.test.ts` → all pass.
- [ ] **Step 8: Mutation-check:** in the delete route remove the `if (location.layout === 'new') { ... }` block → the new-layout delete test fails; restore. In `resolveStoredPath` force the legacy branch for every stored path → the subtitle and duration tests fail; restore.
- [ ] **Step 9: Full suite and build:** `npx vitest run` and `npx nuxt build 2>&1 | tail -5`.
- [ ] **Step 10: Commit:**

```bash
git add server/utils/videoPaths.ts "server/api/videos/[id].get.ts" "server/api/admin/videos/[id].delete.ts" server/utils/videoDurations.ts tests/integration/video-files-layout.test.ts tests/unit/videoDurations.test.ts
git commit -m "feat: subtitles, delete and duration backfill follow the stored video path

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Follow flow no longer appends the channel folder

**Files:**
- Modify `app/utils/librarySources.ts` (remove `channelSavePath` L212-217; `buildIngestBody` in `videosSource` L232-244)
- Modify `app/components/settings/LibrarySourceSection.vue` (hint L97)
- Modify `app/components/settings/ChannelOptionsModal.vue` (after the folder input L21, add the same hint)
- Modify `tests/unit/librarySources.test.ts` (import L4; delete the `channelSavePath` describe L100-107; expectations L117-138)
- Modify `tests/component/LibraryVideosSection.test.ts` (expectations L80 and L106)

**Interfaces:**
- Consumes: nothing new.
- Produces: `videosSource.buildIngestBody(target, options, raw)` returns `custom_save_path: options.saveFolder.trim()` whenever that is non-empty (for search results and pasted URLs alike), and no `custom_save_path` key when it is empty. `channelSavePath` no longer exists (it had no other caller: verified by `grep -rn channelSavePath app server tests`).

Decision recorded here: the folder is now also sent for a pasted URL (before, it was omitted only because the channel title needed for the old path was unknown). The ingest keeps `COALESCE(?, custom_save_path)`, so re-following an existing channel never rewrites its path; existing doubled paths are repaired only by the tidy tool.

- [ ] **Step 1: Update the tests first (they now fail).** In `tests/unit/librarySources.test.ts`: remove `channelSavePath` from the import list (L4), delete the whole `describe('channelSavePath', ...)` block (L100-107), change the expected `custom_save_path` in "builds the ingest body with today's defaults" from `'/data/videos/My Channel'` to `'/data/videos'`, and replace the pasted-URL test with:

```ts
  it('passes every option, and the chosen folder as is, for a pasted URL', () => {
    const o = { ...defaultFollowOptions('videos'), autoSync: false, visibility: 'ultra_private' as const, downloadShorts: true, downloadLives: true, dateAfter: '2024-01-31', saveFolder: ' /mnt/yt ' };
    expect(videosSource.buildIngestBody('https://www.youtube.com/@x', o, null)).toEqual({
      url: 'https://www.youtube.com/@x',
      download_videos: true,
      download_shorts: true,
      download_lives: true,
      date_after: '20240131',
      sync_status: 'paused',
      visibility: 'ultra_private',
      custom_save_path: '/mnt/yt',
    });
    expect(videosSource.buildIngestBody('https://www.youtube.com/@x', { ...o, saveFolder: '  ' }, null)).not.toHaveProperty('custom_save_path');
  });
```

In `tests/component/LibraryVideosSection.test.ts` change `custom_save_path: '/data/videos/My Channel'` (L80) to `'/data/videos'` and `custom_save_path: '/mnt/yt/My Channel'` (L106) to `'/mnt/yt'`.

- [ ] **Step 2: Run and see them fail:** `npx vitest run tests/unit/librarySources.test.ts tests/component/LibraryVideosSection.test.ts` → the body still contains `/My Channel`.

- [ ] **Step 3: Implement.** In `app/utils/librarySources.ts` delete `channelSavePath` (L212-217) and replace `buildIngestBody` (L232-244) with:

```ts
  buildIngestBody: (target, options) => {
    // The base folder only: the downloader adds the channel folder and one
    // folder per video inside it.
    const savePath = options.saveFolder.trim();
    return {
      url: target,
      download_videos: options.downloadVideos,
      download_shorts: options.downloadShorts,
      download_lives: options.downloadLives,
      ...(options.dateAfter ? { date_after: options.dateAfter.replace(/-/g, '') } : {}),
      sync_status: options.autoSync ? 'downloading' : 'paused',
      visibility: options.visibility || 'public',
      ...(savePath ? { custom_save_path: savePath } : {}),
    };
  },
```

In `app/components/settings/LibrarySourceSection.vue` L97 replace the hint text with `YouKeep adds a folder per channel and per video inside this folder.` In `app/components/settings/ChannelOptionsModal.vue` add after the folder `<input ... data-testid="opt-folder" />` (L21), inside the same `form-group`:

```html
        <p class="section-desc">YouKeep adds a folder per channel and per video inside this folder.</p>
```

- [ ] **Step 4: Run to pass:** `npx vitest run tests/unit/librarySources.test.ts tests/component/LibraryVideosSection.test.ts tests/component/ChannelOptionsModal.test.ts tests/unit/adminEnglishOnly.test.ts` → all pass.
- [ ] **Step 5: Mutation-check:** append `+ '/X'` to `savePath` in `buildIngestBody` → both updated tests fail; restore.
- [ ] **Step 6: Full suite and build:** `npx vitest run` and `npx nuxt build 2>&1 | tail -5`.
- [ ] **Step 7: Commit:**

```bash
git add app/utils/librarySources.ts app/components/settings/LibrarySourceSection.vue app/components/settings/ChannelOptionsModal.vue tests/unit/librarySources.test.ts tests/component/LibraryVideosSection.test.ts
git commit -m "fix: following a channel no longer creates a doubled channel folder

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Tidy planner (preview, no disk change)

**Files:**
- Create `server/utils/videoTidy.ts` (planner part)
- Create `tests/unit/videoTidyPlan.test.ts`

**Interfaces:**
- Consumes: Task 1 `buildVideoPaths`, `channelReadBaseDir`, `isNewLayoutUrl`, `storedUrlSegments`; `sanitizeFolderName` from `./downloader`.
- Produces (exact, used by Tasks 7-9):

```ts
export interface PlannerFs {
  existsSync(p: string): boolean;
  statSync(p: string): { size: number; isDirectory(): boolean };
  readdirSync(p: string): string[];
  accessSync(p: string, mode?: number): void;
}
export const nodePlannerFs: PlannerFs;
export interface TidyMove { from: string; to: string; size: number | null }
export interface TidyPlanItem {
  id: string; title: string; channelId: string; channelTitle: string;
  kind: 'legacy' | 'duplicate';
  fromDir: string; toDir: string;
  moves: TidyMove[];
  cleanupDirs: string[];
  oldVideoUrl: string; oldThumbUrl: string | null;
  newVideoUrl: string; newThumbUrl: string | null;
}
export interface TidyChannelFix { channelId: string; from: string; to: string }
export interface TidyPreview {
  total: number; toMove: number; alreadyTidy: number; conflicts: number; missingFiles: number; notWritable: number; duplicateFolders: number;
  samples: { id: string; title: string; from: string; to: string }[];
  channels: { channelId: string; channel: string; toMove: number }[];
}
export interface TidyPlan { preview: TidyPreview; items: TidyPlanItem[]; channelFixes: TidyChannelFix[] }
export function planTidy(db: Database.Database, opts: { downloadsDir: string; fs?: PlannerFs }): TidyPlan
```

Planning rules (all from the spec): only `videos` rows with `download_status = 'completed'` and a non-empty `local_video_path` (videos and shorts) are counted in `total`. Per row, with `baseDir = path.resolve(channelReadBaseDir(custom_save_path, downloadsDir))` and `channelFolder = sanitizeFolderName(channel.title || channel.id)`:
- **New layout, normal channel** → `alreadyTidy` (renamed titles/channels are out of scope).
- **New layout in a doubled channel** (custom path set and `basename(baseDir) === url channel segment`): already at `<baseDir>/<video folder>/<file>` → `alreadyTidy`; at `<baseDir>/<channel>/<video folder>/` → `duplicate` move of every entry named `<video folder>.*` up one level, URLs unchanged; otherwise `missingFiles`.
- **Legacy** (`/downloads/<x>/<id>.<ext>`): source folder `<baseDir>/<channelFolder>` (where the route serves it from); target `buildVideoPaths({ baseDir: doubled ? dirname(baseDir) : baseDir, channelFolder, title, id })`; moves = the video file, the thumbnail (if its file exists; otherwise the new thumbnail URL is `null`) and every `<id>.vtt` / `<id>.<lang>.vtt` in the source folder, each renamed `<baseName><suffix>`. A move whose source is gone but whose destination exists (interrupted earlier run) is kept as "already moved". Video file found in neither place → `missingFiles`. A stored file name not starting with `<id>.` → `conflicts`.
- **Conflict:** the target folder exists and holds anything not named `<baseName>.*` (or is a file).
- **Not writable:** `accessSync(W_OK)` fails on the source folder or on the target folder (or its nearest existing ancestor).
- **Doubled channels** (custom path set and its basename equals the channel folder) each yield one `TidyChannelFix { from: custom_save_path, to: dirname(resolved custom path) }`; `duplicateFolders` = number of such channels.
- `samples`: the first 10 planned items, `{ id, title, from: moves[0].from, to: moves[0].to }`; `channels`: per channel with at least one planned item, in query order (`ORDER BY v.channel_id, v.id`).

- [ ] **Step 1: Write the failing test** `tests/unit/videoTidyPlan.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { planTidy, nodePlannerFs } from '../../server/utils/videoTidy';
import { buildVideoPaths } from '../../server/utils/videoPaths';
import { createTestDb, insertChannel, insertVideo } from '../helpers/testDb';

let db: Database.Database;
let dir: string;

beforeEach(() => {
  db = createTestDb();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yk-plan-'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function write(rel: string, content = 'x') {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

function legacyRow(channelId: string, channelFolder: string, id: string, title: string) {
  insertVideo(db, { id, channelId, title, localVideoPath: `/downloads/${channelFolder}/${id}.mp4`, localThumbnailPath: `/downloads/${channelFolder}/${id}.jpg` });
}

function tree(root: string): string[] {
  return fs.readdirSync(root, { recursive: true }).map(String).sort();
}

describe('planTidy', () => {
  it('counts every case without touching the disk', () => {
    insertChannel(db, { id: 'c1', title: 'Chan' });
    insertChannel(db, { id: 'c2', title: 'Dup', customSavePath: path.join(dir, 'Dup') });
    insertChannel(db, { id: 'c3', title: 'Locked' });

    const tidy = buildVideoPaths({ baseDir: dir, channelFolder: 'Chan', title: 'Tidy', id: 'v-tidy' });
    insertVideo(db, { id: 'v-tidy', channelId: 'c1', title: 'Tidy', localVideoPath: tidy.videoUrlFor('mp4') });
    write(path.join('Chan', tidy.baseName, `${tidy.baseName}.mp4`));

    legacyRow('c1', 'Chan', 'v-move', 'Move Me');
    write('Chan/v-move.mp4'); write('Chan/v-move.jpg');
    legacyRow('c1', 'Chan', 'v-missing', 'Gone');
    legacyRow('c1', 'Chan', 'v-conflict', 'Conflict');
    write('Chan/v-conflict.mp4'); write('Chan/Conflict [v-conflict]/foreign.txt');
    insertVideo(db, { id: 'v-pending', channelId: 'c1', downloadStatus: 'pending' });
    legacyRow('c2', 'Dup', 'd1', 'Dup Clip');
    write('Dup/Dup/d1.mp4');
    legacyRow('c3', 'Locked', 'v-locked', 'Locked Clip');
    write('Locked/v-locked.mp4');

    const locked = path.join(dir, 'Locked');
    const plannerFs = { ...nodePlannerFs, accessSync: (p: string, mode?: number) => { if (p === locked) throw new Error('EACCES'); fs.accessSync(p, mode); } };
    const before = tree(dir);

    const plan = planTidy(db, { downloadsDir: dir, fs: plannerFs });

    expect(tree(dir)).toEqual(before);
    expect(plan.preview).toMatchObject({ total: 6, toMove: 2, alreadyTidy: 1, missingFiles: 1, conflicts: 1, notWritable: 1, duplicateFolders: 1 });
    expect(plan.preview.samples).toEqual([
      { id: 'v-move', title: 'Move Me', from: path.join(dir, 'Chan', 'v-move.mp4'), to: path.join(dir, 'Chan', 'Move Me [v-move]', 'Move Me [v-move].mp4') },
      { id: 'd1', title: 'Dup Clip', from: path.join(dir, 'Dup', 'Dup', 'd1.mp4'), to: path.join(dir, 'Dup', 'Dup Clip [d1]', 'Dup Clip [d1].mp4') },
    ]);
    expect(plan.preview.channels).toEqual([
      { channelId: 'c1', channel: 'Chan', toMove: 1 },
      { channelId: 'c2', channel: 'Dup', toMove: 1 },
    ]);
    expect(plan.channelFixes).toEqual([{ channelId: 'c2', from: path.join(dir, 'Dup'), to: dir }]);
  });

  it('plans the video, its thumbnail and every subtitle under the new names and URLs', () => {
    insertChannel(db, { id: 'c1', title: 'Chan' });
    legacyRow('c1', 'Chan', 'v1', 'Ep #1: what?');
    for (const f of ['v1.mp4', 'v1.jpg', 'v1.fr.vtt', 'v1.en-US.vtt', 'v10.mp4']) write(`Chan/${f}`);

    const [item] = planTidy(db, { downloadsDir: dir }).items;

    const base = 'Ep #1_ what_ [v1]';
    expect(item!.toDir).toBe(path.join(dir, 'Chan', base));
    expect(item!.moves.map((m) => path.basename(m.to)).sort()).toEqual([`${base}.en-US.vtt`, `${base}.fr.vtt`, `${base}.jpg`, `${base}.mp4`]);
    const folder = encodeURIComponent(base);
    expect(item!.newVideoUrl).toBe(`/downloads/Chan/${folder}/${folder}.mp4`);
    expect(item!.newThumbUrl).toBe(`/downloads/Chan/${folder}/${folder}.jpg`);
  });
});
```

- [ ] **Step 2: Run it and see it fail:** `npx vitest run tests/unit/videoTidyPlan.test.ts` → module `server/utils/videoTidy` not found.

- [ ] **Step 3: Implement** `server/utils/videoTidy.ts` (planner; Task 7 appends the runner):

```ts
import fs from 'fs';
import path from 'path';
import type Database from 'better-sqlite3';
import { buildVideoPaths, channelReadBaseDir, isNewLayoutUrl, storedUrlSegments } from './videoPaths';
import { sanitizeFolderName } from './downloader';

// "Tidy library files": moves legacy video files (flat <channel>/<id>.*) into
// one folder per video, and repairs doubled channel folders. Planning never
// touches the disk; see runTidy below for the move itself.

export interface PlannerFs {
  existsSync(p: string): boolean;
  statSync(p: string): { size: number; isDirectory(): boolean };
  readdirSync(p: string): string[];
  accessSync(p: string, mode?: number): void;
}

export const nodePlannerFs: PlannerFs = {
  existsSync: (p) => fs.existsSync(p),
  statSync: (p) => fs.statSync(p),
  readdirSync: (p) => fs.readdirSync(p),
  accessSync: (p, mode) => fs.accessSync(p, mode),
};

export interface TidyMove { from: string; to: string; size: number | null }

export interface TidyPlanItem {
  id: string;
  title: string;
  channelId: string;
  channelTitle: string;
  kind: 'legacy' | 'duplicate';
  fromDir: string;
  toDir: string;
  moves: TidyMove[];
  /** Folders removed after a successful move, only if empty (deepest first). */
  cleanupDirs: string[];
  oldVideoUrl: string;
  oldThumbUrl: string | null;
  newVideoUrl: string;
  newThumbUrl: string | null;
}

export interface TidyChannelFix { channelId: string; from: string; to: string }

export interface TidyPreview {
  total: number;
  toMove: number;
  alreadyTidy: number;
  conflicts: number;
  missingFiles: number;
  notWritable: number;
  duplicateFolders: number;
  samples: { id: string; title: string; from: string; to: string }[];
  channels: { channelId: string; channel: string; toMove: number }[];
}

export interface TidyPlan { preview: TidyPreview; items: TidyPlanItem[]; channelFixes: TidyChannelFix[] }

const SAMPLE_LIMIT = 10;

interface TidyRow {
  id: string;
  title: string;
  channelId: string;
  videoUrl: string;
  thumbUrl: string | null;
  channelTitle: string | null;
  customPath: string | null;
}

type Classified =
  | { status: 'tidy' | 'missing' | 'conflict' | 'notWritable' }
  | { status: 'move'; item: TidyPlanItem };

function sizeOf(fsx: PlannerFs, p: string): number | null {
  try {
    const stat = fsx.statSync(p);
    return stat.isDirectory() ? null : stat.size;
  } catch {
    return null;
  }
}

function isWritable(fsx: PlannerFs, dir: string): boolean {
  let probe = dir;
  while (!fsx.existsSync(probe)) {
    const parent = path.dirname(probe);
    if (parent === probe) return false;
    probe = parent;
  }
  try {
    fsx.accessSync(probe, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/** The target folder may only hold this video's own files (from an earlier, interrupted run). */
function targetHasForeignContent(fsx: PlannerFs, dir: string, baseName: string): boolean {
  if (!fsx.existsSync(dir)) return false;
  try {
    if (!fsx.statSync(dir).isDirectory()) return true;
  } catch {
    return true;
  }
  return fsx.readdirSync(dir).some((entry) => !entry.startsWith(`${baseName}.`));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isDoubled(customPath: string | null, baseDir: string, channelFolder: string): boolean {
  return !!(customPath && customPath.trim()) && path.basename(baseDir) === channelFolder;
}

function classify(row: TidyRow, downloadsDir: string, fsx: PlannerFs): Classified {
  const baseDir = path.resolve(channelReadBaseDir(row.customPath, downloadsDir));
  const channelFolder = sanitizeFolderName(row.channelTitle || row.channelId);
  const common = { id: row.id, title: row.title, channelId: row.channelId, channelTitle: row.channelTitle || row.channelId, oldVideoUrl: row.videoUrl, oldThumbUrl: row.thumbUrl };

  if (isNewLayoutUrl(row.videoUrl, row.id)) {
    const [channelSegment, videoFolder, fileName] = storedUrlSegments(row.videoUrl)!;
    if (!isDoubled(row.customPath, baseDir, channelSegment)) return { status: 'tidy' };
    const finalDir = path.join(baseDir, videoFolder);
    if (fsx.existsSync(path.join(finalDir, fileName))) return { status: 'tidy' };
    const nestedDir = path.join(baseDir, channelSegment, videoFolder);
    if (!fsx.existsSync(path.join(nestedDir, fileName))) return { status: 'missing' };
    if (targetHasForeignContent(fsx, finalDir, videoFolder)) return { status: 'conflict' };
    if (!isWritable(fsx, nestedDir) || !isWritable(fsx, finalDir)) return { status: 'notWritable' };
    const moves = fsx.readdirSync(nestedDir)
      .filter((entry) => entry.startsWith(`${videoFolder}.`))
      .map((entry) => ({ from: path.join(nestedDir, entry), to: path.join(finalDir, entry), size: sizeOf(fsx, path.join(nestedDir, entry)) }));
    return {
      status: 'move',
      item: {
        ...common,
        kind: 'duplicate',
        fromDir: nestedDir,
        toDir: finalDir,
        moves,
        cleanupDirs: [nestedDir, path.join(baseDir, channelSegment)],
        newVideoUrl: row.videoUrl,
        newThumbUrl: row.thumbUrl,
      },
    };
  }

  const fileName = path.posix.basename(row.videoUrl);
  if (!fileName.startsWith(`${row.id}.`)) return { status: 'conflict' };
  const srcDir = path.join(baseDir, channelFolder);
  const doubled = isDoubled(row.customPath, baseDir, channelFolder);
  const target = buildVideoPaths({ baseDir: doubled ? path.dirname(baseDir) : baseDir, channelFolder, title: row.title, id: row.id });
  const moves: TidyMove[] = [];
  const addMove = (sourceName: string): boolean => {
    const from = path.join(srcDir, sourceName);
    const to = path.join(target.dir, `${target.baseName}${sourceName.slice(row.id.length)}`);
    const size = sizeOf(fsx, from) ?? sizeOf(fsx, to);
    if (size === null) return false;
    moves.push({ from, to, size });
    return true;
  };

  if (!addMove(fileName)) return { status: 'missing' };
  let newThumbUrl: string | null = null;
  const thumbName = row.thumbUrl ? path.posix.basename(row.thumbUrl) : '';
  if (thumbName.startsWith(`${row.id}.`) && addMove(thumbName)) {
    newThumbUrl = target.thumbUrlFor(thumbName.slice(row.id.length + 1));
  }
  const subtitlePattern = new RegExp(`^${escapeRegExp(row.id)}(\\..+)?\\.vtt$`);
  if (fsx.existsSync(srcDir)) {
    for (const entry of fsx.readdirSync(srcDir)) {
      if (subtitlePattern.test(entry)) addMove(entry);
    }
  }
  if (targetHasForeignContent(fsx, target.dir, target.baseName)) return { status: 'conflict' };
  if (!isWritable(fsx, srcDir) || !isWritable(fsx, target.dir)) return { status: 'notWritable' };

  return {
    status: 'move',
    item: {
      ...common,
      kind: doubled ? 'duplicate' : 'legacy',
      fromDir: srcDir,
      toDir: target.dir,
      moves,
      // A normal channel folder now holds the new video folders: never empty.
      cleanupDirs: doubled ? [srcDir] : [],
      newVideoUrl: target.videoUrlFor(fileName.slice(row.id.length + 1)),
      newThumbUrl,
    },
  };
}

export function planTidy(db: Database.Database, opts: { downloadsDir: string; fs?: PlannerFs }): TidyPlan {
  const fsx = opts.fs ?? nodePlannerFs;
  const rows = db.prepare(`
    SELECT v.id AS id, v.title AS title, v.channel_id AS channelId,
           v.local_video_path AS videoUrl, v.local_thumbnail_path AS thumbUrl,
           c.title AS channelTitle, c.custom_save_path AS customPath
    FROM videos v JOIN channels c ON c.id = v.channel_id
    WHERE v.download_status = 'completed' AND v.local_video_path IS NOT NULL AND v.local_video_path != ''
    ORDER BY v.channel_id, v.id
  `).all() as TidyRow[];

  const preview: TidyPreview = {
    total: rows.length, toMove: 0, alreadyTidy: 0, conflicts: 0, missingFiles: 0, notWritable: 0, duplicateFolders: 0,
    samples: [], channels: [],
  };
  const items: TidyPlanItem[] = [];
  const perChannel = new Map<string, { channelId: string; channel: string; toMove: number }>();
  const fixes = new Map<string, TidyChannelFix>();

  for (const row of rows) {
    const baseDir = path.resolve(channelReadBaseDir(row.customPath, opts.downloadsDir));
    if (isDoubled(row.customPath, baseDir, sanitizeFolderName(row.channelTitle || row.channelId)) && !fixes.has(row.channelId)) {
      fixes.set(row.channelId, { channelId: row.channelId, from: row.customPath as string, to: path.dirname(baseDir) });
    }

    const result = classify(row, opts.downloadsDir, fsx);
    if (result.status === 'tidy') preview.alreadyTidy++;
    else if (result.status === 'missing') preview.missingFiles++;
    else if (result.status === 'conflict') preview.conflicts++;
    else if (result.status === 'notWritable') preview.notWritable++;
    else {
      const item = result.item;
      items.push(item);
      preview.toMove++;
      const entry = perChannel.get(item.channelId) ?? { channelId: item.channelId, channel: item.channelTitle, toMove: 0 };
      entry.toMove++;
      perChannel.set(item.channelId, entry);
      if (preview.samples.length < SAMPLE_LIMIT && item.moves[0]) {
        preview.samples.push({ id: item.id, title: item.title, from: item.moves[0].from, to: item.moves[0].to });
      }
    }
  }

  preview.duplicateFolders = fixes.size;
  preview.channels = [...perChannel.values()];
  return { preview, items, channelFixes: [...fixes.values()] };
}
```

- [ ] **Step 4: Run to pass:** `npx vitest run tests/unit/videoTidyPlan.test.ts` → 2 passed.
- [ ] **Step 5: Mutation-check:** make `targetHasForeignContent` return `false` → `conflicts` count fails; restore. Remove the `isDoubled(...) ? path.dirname(baseDir)` choice (always `baseDir`) → the `d1` sample `to` fails; restore. Drop the subtitle loop → the second test fails; restore.
- [ ] **Step 6: Full suite and build:** `npx vitest run` and `npx nuxt build 2>&1 | tail -5`.
- [ ] **Step 7: Commit:**

```bash
git add server/utils/videoTidy.ts tests/unit/videoTidyPlan.test.ts
git commit -m "feat: plan tidying legacy video files into one folder per video

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Tidy runner (batched, verified, reversible, resumable, cancellable)

**Files:**
- Modify `server/utils/videoTidy.ts` (append the runner; extend imports)
- Create `tests/integration/videoTidyRun.test.ts`

**Interfaces:**
- Consumes: Task 6 `planTidy`, `nodePlannerFs`, `PlannerFs`, `TidyPlanItem`, `TidyMove`, `TidyChannelFix`; Task 1 `isNewLayoutUrl`, `storedUrlSegments`; `activeProcesses: Map<string, any>` and `addLog(msg: string)` from `./downloader`; `isWipeInProgress(): boolean` from `./libraryWipe`.
- Produces (exact):

```ts
export type TidyState = 'idle' | 'running' | 'done' | 'failed' | 'cancelled';
export interface TidyStatus {
  state: TidyState; processed: number; total: number; moved: number; skipped: number;
  errors: number; lastError: string | null;
  errorDetails: { id: string; title: string; message: string }[];   // capped at 50
  channelsFixed: number;
}
export interface RunnerFs {
  rename(from: string, to: string): Promise<void>;
  copyFile(from: string, to: string): Promise<void>;
  unlink(p: string): Promise<void>;
  stat(p: string): Promise<{ size: number; isDirectory(): boolean }>;
  mkdir(p: string, opts: { recursive: true }): Promise<unknown>;
  rmdir(p: string): Promise<void>;
}
export interface TidyRunDeps {
  db: Database.Database; downloadsDir: string;
  plannerFs?: PlannerFs; fsp?: RunnerFs;
  batchSize?: number; batchPauseMs?: number;
  isVideoBusy?: (id: string) => boolean;
}
export async function moveFileVerified(fsp: RunnerFs, from: string, to: string): Promise<void>
export async function runTidy(deps: TidyRunDeps): Promise<TidyStatus>
export function startTidyRun(deps: TidyRunDeps): { started: true } | { started: false; error: string }
export function getTidyStatus(): TidyStatus
export function isTidyRunning(): boolean
export function cancelTidyRun(): boolean
```

Behaviour: `runTidy` plans fresh (never trusts an old preview), then per item: re-reads the row and skips it (`skipped`) unless `download_status = 'completed'`, the stored path still equals the planned old path, and `isVideoBusy(id)` is false (default `activeProcesses.has(id)`); creates the target folder; moves each file with `moveFileVerified`; re-verifies every destination (exists, size equals the planned size); updates both paths in one transaction with `WHERE id = ? AND local_video_path = ?` (0 changes = failure); on any failure moves every already-moved file back (reporting `<to> -> <from>` for each that cannot be moved back), removes the target folder only if it created it and it is empty, records the error and continues. After success it removes `cleanupDirs` with `rmdir` (which only removes empty folders). Cancel is checked before each item (the current video always finishes). After the last item (not after a cancel) each channel fix is applied when every video of the channel is either without a stored path or new-layout and present at `<custom>/<video folder>/<file>`, and none is downloading; the update is compare-and-set on the old `custom_save_path`. Yields with `setImmediate` after each item and pauses `batchPauseMs` (default 50) after every `batchSize` (default 25) items. `moveFileVerified`: source missing and destination present → nothing to do; destination present with the source's size → earlier complete copy, remove the source; destination present with another size → partial copy from an interrupted cross-device move, remove it (the source is intact) and move again; `rename`, and on `EXDEV` copy → compare sizes → remove the source only after a verified copy (a failed verification removes the copy and throws, leaving the source).

- [ ] **Step 1: Write the failing test** `tests/integration/videoTidyRun.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { cancelTidyRun, planTidy, runTidy, type RunnerFs } from '../../server/utils/videoTidy';
import { resolveStoredPath } from '../../server/utils/videoPaths';
import { createTestDb, insertChannel, insertVideo } from '../helpers/testDb';

let db: Database.Database;
let dir: string;
const realFsp: RunnerFs = {
  rename: (a, b) => fs.promises.rename(a, b),
  copyFile: (a, b) => fs.promises.copyFile(a, b),
  unlink: (p) => fs.promises.unlink(p),
  stat: (p) => fs.promises.stat(p),
  mkdir: (p, o) => fs.promises.mkdir(p, o),
  rmdir: (p) => fs.promises.rmdir(p),
};

beforeEach(() => {
  db = createTestDb();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yk-tidy-'));
  insertChannel(db, { id: 'c1', title: 'Chan' });
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function legacy(id: string, title: string, suffixes = ['.mp4', '.jpg', '.fr.vtt', '.en.vtt']) {
  insertVideo(db, { id, channelId: 'c1', title, localVideoPath: `/downloads/Chan/${id}.mp4`, localThumbnailPath: `/downloads/Chan/${id}.jpg` });
  fs.mkdirSync(path.join(dir, 'Chan'), { recursive: true });
  for (const s of suffixes) fs.writeFileSync(path.join(dir, 'Chan', `${id}${s}`), `${id}${s}`);
}
const paths = (id: string) => db.prepare('SELECT id, channel_id, title, local_video_path, local_thumbnail_path FROM videos WHERE id = ?').get(id) as any;

describe('runTidy', () => {
  it('moves and renames a legacy video, its thumbnail and subtitles, then updates the database', async () => {
    legacy('v1', 'Hello: World?');
    fs.writeFileSync(path.join(dir, 'Chan', 'other.txt'), 'keep');

    const status = await runTidy({ db, downloadsDir: dir, fsp: realFsp });

    expect(status).toMatchObject({ state: 'done', total: 1, processed: 1, moved: 1, errors: 0 });
    const base = 'Hello_ World_ [v1]';
    const folder = path.join(dir, 'Chan', base);
    expect(fs.readdirSync(folder).sort()).toEqual([`${base}.en.vtt`, `${base}.fr.vtt`, `${base}.jpg`, `${base}.mp4`]);
    expect(fs.readFileSync(path.join(folder, `${base}.mp4`), 'utf8')).toBe('v1.mp4');
    expect(fs.readdirSync(path.join(dir, 'Chan')).sort()).toEqual([base, 'other.txt']);
    const row = paths('v1');
    expect(row.local_video_path).toBe(`/downloads/Chan/${encodeURIComponent(base)}/${encodeURIComponent(`${base}.mp4`)}`);
    expect(row.local_thumbnail_path).toBe(`/downloads/Chan/${encodeURIComponent(base)}/${encodeURIComponent(`${base}.jpg`)}`);
    expect(fs.existsSync(resolveStoredPath(db, row, { downloadsDir: dir }).videoFile!)).toBe(true);
    expect(planTidy(db, { downloadsDir: dir }).preview).toMatchObject({ toMove: 0, alreadyTidy: 1 });
  });

  it('puts every file back when the database update fails', async () => {
    legacy('v1', 'Clip', ['.mp4', '.jpg', '.fr.vtt']);
    db.exec(`CREATE TRIGGER no_update BEFORE UPDATE OF local_video_path ON videos BEGIN SELECT RAISE(ABORT, 'database is locked'); END;`);

    const status = await runTidy({ db, downloadsDir: dir, fsp: realFsp });

    expect(status).toMatchObject({ state: 'done', moved: 0, errors: 1 });
    expect(status.lastError).toContain('database is locked');
    expect(fs.readdirSync(path.join(dir, 'Chan')).sort()).toEqual(['v1.fr.vtt', 'v1.jpg', 'v1.mp4']);
    expect(paths('v1').local_video_path).toBe('/downloads/Chan/v1.mp4');
  });

  it('falls back to copy + verify across devices and never deletes an unverified source', async () => {
    legacy('v1', 'Good', ['.mp4']);
    legacy('v2', 'Bad', ['.mp4']);
    const crossDevice: RunnerFs = {
      ...realFsp,
      rename: async () => { throw Object.assign(new Error('cross-device link not permitted'), { code: 'EXDEV' }); },
      copyFile: async (a, b) => {
        if (a.endsWith('v2.mp4')) { await fs.promises.writeFile(b, 'trunc'); return; }
        await fs.promises.copyFile(a, b);
      },
    };

    const status = await runTidy({ db, downloadsDir: dir, fsp: crossDevice });

    expect(status).toMatchObject({ moved: 1, errors: 1 });
    expect(fs.readFileSync(path.join(dir, 'Chan', 'Good [v1]', 'Good [v1].mp4'), 'utf8')).toBe('v1.mp4');
    expect(fs.existsSync(path.join(dir, 'Chan', 'v1.mp4'))).toBe(false);
    expect(fs.readFileSync(path.join(dir, 'Chan', 'v2.mp4'), 'utf8')).toBe('v2.mp4');
    expect(fs.existsSync(path.join(dir, 'Chan', 'Bad [v2]'))).toBe(false);
    expect(paths('v2').local_video_path).toBe('/downloads/Chan/v2.mp4');
  });

  it('stops after the current video when cancelled, and a new run finishes the rest', async () => {
    legacy('v1', 'One', ['.mp4']);
    legacy('v2', 'Two', ['.mp4']);
    let renames = 0;
    const cancelling: RunnerFs = { ...realFsp, rename: async (a, b) => { if (++renames === 1) cancelTidyRun(); await fs.promises.rename(a, b); } };

    const first = await runTidy({ db, downloadsDir: dir, fsp: cancelling });
    expect(first).toMatchObject({ state: 'cancelled', processed: 1, moved: 1 });
    expect(planTidy(db, { downloadsDir: dir }).preview).toMatchObject({ toMove: 1, alreadyTidy: 1 });

    const second = await runTidy({ db, downloadsDir: dir, fsp: realFsp });
    expect(second).toMatchObject({ state: 'done', moved: 1 });
  });

  it('repairs a doubled channel folder and corrects the channel save path', async () => {
    const custom = path.join(dir, 'Dup');
    insertChannel(db, { id: 'c2', title: 'Dup', customSavePath: custom });
    insertVideo(db, { id: 'd1', channelId: 'c2', title: 'Dup Clip', localVideoPath: '/downloads/Dup/d1.mp4', localThumbnailPath: '/downloads/Dup/d1.jpg' });
    fs.mkdirSync(path.join(custom, 'Dup'), { recursive: true });
    fs.writeFileSync(path.join(custom, 'Dup', 'd1.mp4'), 'd1');
    fs.writeFileSync(path.join(custom, 'Dup', 'd1.jpg'), 'd1j');

    const status = await runTidy({ db, downloadsDir: dir, fsp: realFsp });

    expect(status).toMatchObject({ state: 'done', moved: 1, channelsFixed: 1 });
    expect(fs.readdirSync(custom)).toEqual(['Dup Clip [d1]']);
    expect(fs.readdirSync(path.join(custom, 'Dup Clip [d1]')).sort()).toEqual(['Dup Clip [d1].jpg', 'Dup Clip [d1].mp4']);
    expect((db.prepare('SELECT custom_save_path FROM channels WHERE id = ?').get('c2') as any).custom_save_path).toBe(dir);
    expect(fs.existsSync(resolveStoredPath(db, paths('d1'), { downloadsDir: dir }).videoFile!)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and see it fail:** `npx vitest run tests/integration/videoTidyRun.test.ts` → `runTidy` / `cancelTidyRun` are not exported.

- [ ] **Step 3: Implement.** In `server/utils/videoTidy.ts` change the imports to:

```ts
import fs from 'fs';
import path from 'path';
import type Database from 'better-sqlite3';
import { buildVideoPaths, channelReadBaseDir, isNewLayoutUrl, storedUrlSegments } from './videoPaths';
import { activeProcesses, addLog, sanitizeFolderName } from './downloader';
import { isWipeInProgress } from './libraryWipe';
```

and append:

```ts
export type TidyState = 'idle' | 'running' | 'done' | 'failed' | 'cancelled';

export interface TidyStatus {
  state: TidyState;
  processed: number;
  total: number;
  moved: number;
  skipped: number;
  errors: number;
  lastError: string | null;
  errorDetails: { id: string; title: string; message: string }[];
  channelsFixed: number;
}

export interface RunnerFs {
  rename(from: string, to: string): Promise<void>;
  copyFile(from: string, to: string): Promise<void>;
  unlink(p: string): Promise<void>;
  stat(p: string): Promise<{ size: number; isDirectory(): boolean }>;
  mkdir(p: string, opts: { recursive: true }): Promise<unknown>;
  rmdir(p: string): Promise<void>;
}

export interface TidyRunDeps {
  db: Database.Database;
  downloadsDir: string;
  plannerFs?: PlannerFs;
  fsp?: RunnerFs;
  batchSize?: number;
  batchPauseMs?: number;
  isVideoBusy?: (id: string) => boolean;
}

const ERROR_DETAILS_LIMIT = 50;

// globalThis-backed, like libraryWipe.ts, so the state survives Nitro dev reloads.
const G_TIDY_STATUS = Symbol.for('YouKeep.videoTidyStatus');
const G_TIDY_CANCEL = Symbol.for('YouKeep.videoTidyCancel');
const _g = globalThis as any;

function idleStatus(): TidyStatus {
  return { state: 'idle', processed: 0, total: 0, moved: 0, skipped: 0, errors: 0, lastError: null, errorDetails: [], channelsFixed: 0 };
}
if (!_g[G_TIDY_STATUS]) _g[G_TIDY_STATUS] = idleStatus();
if (_g[G_TIDY_CANCEL] === undefined) _g[G_TIDY_CANCEL] = false;

export function getTidyStatus(): TidyStatus {
  const status = _g[G_TIDY_STATUS] as TidyStatus;
  return { ...status, errorDetails: [...status.errorDetails] };
}

export function isTidyRunning(): boolean {
  return (_g[G_TIDY_STATUS] as TidyStatus).state === 'running';
}

/** Asks the running tidy to stop after the current video. */
export function cancelTidyRun(): boolean {
  if (!isTidyRunning()) return false;
  _g[G_TIDY_CANCEL] = true;
  return true;
}

const nodeRunnerFs: RunnerFs = {
  rename: (from, to) => fs.promises.rename(from, to),
  copyFile: (from, to) => fs.promises.copyFile(from, to),
  unlink: (p) => fs.promises.unlink(p),
  stat: (p) => fs.promises.stat(p),
  mkdir: (p, opts) => fs.promises.mkdir(p, opts),
  rmdir: (p) => fs.promises.rmdir(p),
};

async function statOrNull(fsp: RunnerFs, p: string): Promise<{ size: number; isDirectory(): boolean } | null> {
  try {
    return await fsp.stat(p);
  } catch {
    return null;
  }
}

/**
 * Moves one file. Same filesystem: rename. Across devices: copy, check the
 * size, and only then remove the source, so a file is never deleted before a
 * verified copy exists elsewhere.
 */
export async function moveFileVerified(fsp: RunnerFs, from: string, to: string): Promise<void> {
  const source = await statOrNull(fsp, from);
  const existing = await statOrNull(fsp, to);
  if (!source) {
    if (existing) return; // already moved by an earlier, interrupted run
    throw new Error(`Source file is missing: ${from}`);
  }
  if (existing) {
    if (existing.size === source.size) {
      await fsp.unlink(from); // complete copy left by an interrupted cross-device move
      return;
    }
    await fsp.unlink(to); // partial copy from an interrupted cross-device move; the source is intact
  }
  try {
    await fsp.rename(from, to);
    return;
  } catch (err: any) {
    if (err?.code !== 'EXDEV') throw err;
  }
  await fsp.copyFile(from, to);
  const copied = await statOrNull(fsp, to);
  if (!copied || copied.size !== source.size) {
    try { await fsp.unlink(to); } catch {}
    throw new Error(`The copy of ${from} could not be verified.`);
  }
  await fsp.unlink(from);
}

type ItemOutcome = { result: 'moved' | 'skipped' } | { result: 'error'; message: string };

async function tidyOne(db: Database.Database, item: TidyPlanItem, fsp: RunnerFs, isBusy: (id: string) => boolean): Promise<ItemOutcome> {
  const row = db.prepare('SELECT download_status AS status, local_video_path AS url FROM videos WHERE id = ?').get(item.id) as
    { status: string; url: string | null } | undefined;
  if (!row || row.status !== 'completed' || row.url !== item.oldVideoUrl || isBusy(item.id)) return { result: 'skipped' };

  const createdDir = !(await statOrNull(fsp, item.toDir));
  const done: TidyMove[] = [];
  try {
    if (createdDir) await fsp.mkdir(item.toDir, { recursive: true });
    for (const move of item.moves) {
      await moveFileVerified(fsp, move.from, move.to);
      done.push(move);
    }
    for (const move of item.moves) {
      const stat = await statOrNull(fsp, move.to);
      if (!stat || (move.size !== null && stat.size !== move.size)) throw new Error(`Moved file could not be verified: ${move.to}`);
    }
    db.transaction(() => {
      const result = db.prepare('UPDATE videos SET local_video_path = ?, local_thumbnail_path = ? WHERE id = ? AND local_video_path = ?')
        .run(item.newVideoUrl, item.newThumbUrl, item.id, item.oldVideoUrl);
      if (result.changes !== 1) throw new Error('The video changed while its files were being moved.');
    })();
  } catch (err: any) {
    const notRestored: string[] = [];
    for (const move of [...done].reverse()) {
      try {
        await moveFileVerified(fsp, move.to, move.from);
      } catch {
        notRestored.push(`${move.to} -> ${move.from}`);
      }
    }
    if (createdDir) {
      try { await fsp.rmdir(item.toDir); } catch {}
    }
    const message = err?.message || String(err);
    return { result: 'error', message: notRestored.length ? `${message} Could not move back: ${notRestored.join('; ')}` : message };
  }

  for (const dir of item.cleanupDirs) {
    try { await fsp.rmdir(dir); } catch {} // only succeeds on an empty folder
  }
  return { result: 'moved' };
}

/** Corrects a doubled custom save path once every video of the channel sits at its final place. */
function applyChannelFix(db: Database.Database, fix: TidyChannelFix, fsx: PlannerFs): boolean {
  const channel = db.prepare('SELECT custom_save_path FROM channels WHERE id = ?').get(fix.channelId) as { custom_save_path: string | null } | undefined;
  if (!channel || channel.custom_save_path !== fix.from) return false;
  const base = path.resolve(fix.from);
  const channelFolder = path.basename(base);
  const rows = db.prepare('SELECT id, download_status AS status, local_video_path AS url FROM videos WHERE channel_id = ?').all(fix.channelId) as
    { id: string; status: string; url: string | null }[];
  const ready = rows.every((r) => {
    if (r.status === 'downloading') return false;
    if (!r.url) return true;
    if (!isNewLayoutUrl(r.url, r.id)) return false;
    const [channelSegment, videoFolder, fileName] = storedUrlSegments(r.url)!;
    return channelSegment === channelFolder && fsx.existsSync(path.join(base, videoFolder, fileName));
  });
  if (!ready) return false;
  return db.prepare('UPDATE channels SET custom_save_path = ? WHERE id = ? AND custom_save_path = ?').run(fix.to, fix.channelId, fix.from).changes === 1;
}

export async function runTidy(deps: TidyRunDeps): Promise<TidyStatus> {
  const status: TidyStatus = { ...idleStatus(), state: 'running' };
  _g[G_TIDY_STATUS] = status;
  _g[G_TIDY_CANCEL] = false;
  const plannerFs = deps.plannerFs ?? nodePlannerFs;
  const fsp = deps.fsp ?? nodeRunnerFs;
  const isBusy = deps.isVideoBusy ?? ((id: string) => activeProcesses.has(id));
  const batchSize = deps.batchSize ?? 25;
  const batchPauseMs = deps.batchPauseMs ?? 50;

  try {
    const plan = planTidy(deps.db, { downloadsDir: deps.downloadsDir, fs: plannerFs });
    status.total = plan.items.length;
    for (let i = 0; i < plan.items.length; i++) {
      if (_g[G_TIDY_CANCEL]) {
        status.state = 'cancelled';
        break;
      }
      const item = plan.items[i]!;
      const outcome = await tidyOne(deps.db, item, fsp, isBusy);
      status.processed++;
      if (outcome.result === 'moved') status.moved++;
      else if (outcome.result === 'skipped') status.skipped++;
      else {
        status.errors++;
        status.lastError = outcome.message;
        if (status.errorDetails.length < ERROR_DETAILS_LIMIT) status.errorDetails.push({ id: item.id, title: item.title, message: outcome.message });
        addLog(`Tidy library files: "${item.title}" (${item.id}) was left in place: ${outcome.message}`);
      }
      // Moves are async, but planning/DB work is sync: yield every item, pause every batch.
      await new Promise((resolve) => ((i + 1) % batchSize === 0 ? setTimeout(resolve, batchPauseMs) : setImmediate(resolve)));
    }
    if (status.state === 'running') {
      for (const fix of plan.channelFixes) {
        if (applyChannelFix(deps.db, fix, plannerFs)) status.channelsFixed++;
      }
      status.state = 'done';
    }
  } catch (err: any) {
    status.state = 'failed';
    status.lastError = err?.message || String(err);
  }
  return getTidyStatus();
}

/** Starts a background run (one at a time, never during a library wipe). */
export function startTidyRun(deps: TidyRunDeps): { started: true } | { started: false; error: string } {
  if (isTidyRunning()) return { started: false, error: 'Tidying is already running.' };
  if (isWipeInProgress()) return { started: false, error: 'A library wipe is in progress. Try again when it has finished.' };
  _g[G_TIDY_STATUS] = { ...idleStatus(), state: 'running' };
  runTidy(deps).catch((err) => {
    _g[G_TIDY_STATUS] = { ...(_g[G_TIDY_STATUS] as TidyStatus), state: 'failed', lastError: err?.message || String(err) };
  });
  return { started: true };
}
```

- [ ] **Step 4: Run to pass:** `npx vitest run tests/integration/videoTidyRun.test.ts tests/unit/videoTidyPlan.test.ts` → all pass.
- [ ] **Step 5: Mutation-check (each must make a test fail, then restore):** remove the revert loop in `tidyOne` (DB-failure test); in `moveFileVerified` delete the size comparison after `copyFile` (cross-device test: `v2.mp4` disappears); remove the `if (_g[G_TIDY_CANCEL])` check (cancel test); make `applyChannelFix` return `false` (doubled-folder test).
- [ ] **Step 6: Full suite and build:** `npx vitest run` and `npx nuxt build 2>&1 | tail -5`.
- [ ] **Step 7: Commit:**

```bash
git add server/utils/videoTidy.ts tests/integration/videoTidyRun.test.ts
git commit -m "feat: tidy runner moves, verifies and records each video, reverting on failure

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Admin API routes for the tidy tool

**Files:**
- Create `server/api/admin/library/tidy/preview.post.ts`
- Create `server/api/admin/library/tidy/start.post.ts`
- Create `server/api/admin/library/tidy/status.get.ts`
- Create `server/api/admin/library/tidy/cancel.post.ts`
- Create `tests/integration/tidy-routes.test.ts`

**Interfaces:**
- Consumes (Tasks 6-7, imported with `../../../../utils/videoTidy`): `planTidy`, `startTidyRun`, `getTidyStatus`, `cancelTidyRun`, `isTidyRunning`; ambient `requireAdmin`, `getDb`, `getDownloadsDir`.
- Produces (all admin only; POSTs go through the existing CSRF middleware):
  - `POST /api/admin/library/tidy/preview` → `TidyPreview`
  - `POST /api/admin/library/tidy/start` → `{ started: true }`, or 409 with `statusMessage` = the refusal (`'Tidying is already running.'` / `'A library wipe is in progress. Try again when it has finished.'`)
  - `GET /api/admin/library/tidy/status` → `TidyStatus`
  - `POST /api/admin/library/tidy/cancel` → `{ cancelling: boolean }`

- [ ] **Step 1: Write the failing test** `tests/integration/tidy-routes.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const wipe = vi.hoisted(() => ({ on: false }));
vi.mock('../../server/utils/libraryWipe', () => ({ isWipeInProgress: () => wipe.on }));

import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import previewHandler from '../../server/api/admin/library/tidy/preview.post';
import startHandler from '../../server/api/admin/library/tidy/start.post';
import statusHandler from '../../server/api/admin/library/tidy/status.get';
import { requireAdmin } from '../../server/utils/auth';
import { createTestDb, insertChannel, insertSession, insertUser, insertVideo, mockEvent, sessionCookie } from '../helpers/testDb';

let db: Database.Database;
let dir: string;

beforeEach(() => {
  db = createTestDb();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yk-tidy-api-'));
  (globalThis as any).getDb = () => db;
  (globalThis as any).getDownloadsDir = () => dir;
  (globalThis as any).requireAdmin = requireAdmin;
  wipe.on = false;
  insertChannel(db, { id: 'c1', title: 'Chan' });
  insertVideo(db, { id: 'v1', channelId: 'c1', title: 'One', localVideoPath: '/downloads/Chan/v1.mp4' });
  fs.mkdirSync(path.join(dir, 'Chan'));
  fs.writeFileSync(path.join(dir, 'Chan', 'v1.mp4'), 'x');
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function login(id: string, role: 'admin' | 'user') {
  insertUser(db, { id, role });
  insertSession(db, { id: `sess-${id}`, userId: id });
  return sessionCookie(`sess-${id}`);
}
const post = (cookie?: string) => mockEvent(cookie, { method: 'POST', body: {} });

async function waitUntilIdle(cookie: string) {
  for (let i = 0; i < 200; i++) {
    const s = await statusHandler(mockEvent(cookie));
    if (s.state !== 'running') return s;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('tidy run did not finish');
}

describe('/api/admin/library/tidy', () => {
  it('is admin only', async () => {
    await expect(previewHandler(post())).rejects.toMatchObject({ statusCode: 401 });
    const user = login('u1', 'user');
    await expect(previewHandler(post(user))).rejects.toMatchObject({ statusCode: 403 });
    await expect(startHandler(post(user))).rejects.toMatchObject({ statusCode: 403 });
  });

  it('previews, runs once at a time, reports, and refuses during a library wipe', async () => {
    const admin = login('a1', 'admin');
    expect(await previewHandler(post(admin))).toMatchObject({ total: 1, toMove: 1 });

    expect(await startHandler(post(admin))).toEqual({ started: true });
    await expect(startHandler(post(admin))).rejects.toMatchObject({ statusCode: 409 });
    expect(await waitUntilIdle(admin)).toMatchObject({ state: 'done', moved: 1 });
    expect(fs.existsSync(path.join(dir, 'Chan', 'One [v1]', 'One [v1].mp4'))).toBe(true);

    wipe.on = true;
    await expect(startHandler(post(admin))).rejects.toMatchObject({ statusCode: 409, statusMessage: expect.stringContaining('library wipe') });
  });
});
```

- [ ] **Step 2: Run it and see it fail:** `npx vitest run tests/integration/tidy-routes.test.ts` → the route modules do not exist.

- [ ] **Step 3: Implement the four routes.**

`server/api/admin/library/tidy/preview.post.ts`:

```ts
import { defineEventHandler } from 'h3';
import { planTidy } from '../../../../utils/videoTidy';

// Read-only: computes what "Tidy library files" would move. Nothing on disk changes.
export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  return planTidy(getDb(), { downloadsDir: getDownloadsDir() }).preview;
});
```

`server/api/admin/library/tidy/start.post.ts`:

```ts
import { defineEventHandler, createError } from 'h3';
import { startTidyRun } from '../../../../utils/videoTidy';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const result = startTidyRun({ db: getDb(), downloadsDir: getDownloadsDir() });
  if (!result.started) {
    throw createError({ statusCode: 409, statusMessage: result.error });
  }
  return { started: true };
});
```

`server/api/admin/library/tidy/status.get.ts`:

```ts
import { defineEventHandler } from 'h3';
import { getTidyStatus } from '../../../../utils/videoTidy';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  return getTidyStatus();
});
```

`server/api/admin/library/tidy/cancel.post.ts`:

```ts
import { defineEventHandler } from 'h3';
import { cancelTidyRun } from '../../../../utils/videoTidy';

// Stops the run after the video currently being moved.
export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  return { cancelling: cancelTidyRun() };
});
```

- [ ] **Step 4: Run to pass:** `npx vitest run tests/integration/tidy-routes.test.ts tests/unit/adminEnglishOnly.test.ts` → all pass.
- [ ] **Step 5: Mutation-check:** remove the `isTidyRunning()` guard in `startTidyRun` → the second start no longer gets 409; restore.
- [ ] **Step 6: Full suite and build:** `npx vitest run` and `npx nuxt build 2>&1 | tail -5` (the build must list the four new routes without auto-import warnings).
- [ ] **Step 7: Commit:**

```bash
git add server/api/admin/library/tidy tests/integration/tidy-routes.test.ts
git commit -m "feat: admin API to preview, start, follow and cancel library tidying

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: "Tidy library files" panel in System → Tools & logs

**Files:**
- Create `app/components/settings/TidyLibraryPanel.vue`
- Modify `app/components/settings/SettingsSystemTab.vue` (summary text L105; insert the panel after the "Update output" box that ends at L159, before `<div class="logs-container glass-panel">` at L160; import in `<script setup>` after L250)
- Create `tests/component/TidyLibraryPanel.test.ts`

**Interfaces:**
- Consumes (Task 8): the four `/api/admin/library/tidy/*` endpoints and the `TidyPreview` / `TidyStatus` JSON shapes (redeclared as local TS interfaces in the component).
- Produces: `<TidyLibraryPanel />` (no props, no emits). Test ids: `tidy-panel`, `tidy-preview-btn`, `tidy-start`, `tidy-preview`, `tidy-progress`, `tidy-cancel`, `tidy-report`, `tidy-done`, `tidy-error`. None starts with `system-` (the SettingsSystemTab test lists `[data-testid^="system-"]` and must keep seeing exactly five sections). On mount it fetches the status once and resumes the progress view only if a run is `running` (a finished earlier run is not shown again).

- [ ] **Step 1: Write the failing test** `tests/component/TidyLibraryPanel.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import TidyLibraryPanel from '../../app/components/settings/TidyLibraryPanel.vue';

const PREVIEW = {
  total: 3, toMove: 2, alreadyTidy: 1, conflicts: 0, missingFiles: 0, notWritable: 0, duplicateFolders: 0,
  samples: [{ id: 'a', title: 'A', from: '/v/Chan/a.mp4', to: '/v/Chan/A [a]/A [a].mp4' }],
  channels: [{ channelId: 'c1', channel: 'Chan', toMove: 2 }],
};
const STATUS = { state: 'idle', processed: 0, total: 0, moved: 0, skipped: 0, errors: 0, lastError: null, errorDetails: [], channelsFixed: 0 };

let fetchMock: ReturnType<typeof vi.fn>;
let statusReplies: any[];
let previewReply: () => any;
let startReply: () => any;

beforeEach(() => {
  statusReplies = [STATUS];
  previewReply = () => PREVIEW;
  startReply = () => ({ started: true });
  fetchMock = vi.fn(async (url: string) => {
    if (url === '/api/admin/library/tidy/preview') return previewReply();
    if (url === '/api/admin/library/tidy/start') return startReply();
    if (url === '/api/admin/library/tidy/status') return statusReplies.length > 1 ? statusReplies.shift() : statusReplies[0];
    if (url === '/api/admin/library/tidy/cancel') return { cancelling: true };
    return {};
  });
  vi.stubGlobal('$fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const mountPanel = async () => {
  const w = await mountSuspended(TidyLibraryPanel);
  await flushPromises();
  return w;
};
const startButton = (w: any) => w.find('[data-testid="tidy-start"]').element as HTMLButtonElement;

describe('TidyLibraryPanel', () => {
  it('needs a preview before starting, then shows the report', async () => {
    statusReplies = [STATUS, { ...STATUS, state: 'done', processed: 2, total: 2, moved: 2 }];
    const w = await mountPanel();
    expect(startButton(w).disabled).toBe(true);

    await w.find('[data-testid="tidy-preview-btn"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="tidy-preview"]').text()).toContain('/v/Chan/A [a]/A [a].mp4');
    expect(startButton(w).disabled).toBe(false);

    await w.find('[data-testid="tidy-start"]').trigger('click');
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/library/tidy/start', expect.objectContaining({ method: 'POST' }));
    expect(w.find('[data-testid="tidy-report"]').text()).toContain('Tidying finished.');
    expect(w.find('[data-testid="tidy-report"]').text()).toContain('2 moved');
  });

  it('resumes the progress bar of a running tidy and can cancel it', async () => {
    statusReplies = [{ ...STATUS, state: 'running', processed: 1, total: 4, moved: 1 }];
    const w = await mountPanel();
    expect(w.find('[data-testid="tidy-progress"]').text()).toContain('1 of 4');
    await w.find('[data-testid="tidy-cancel"]').trigger('click');
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/library/tidy/cancel', expect.objectContaining({ method: 'POST' }));
    w.unmount();
  });

  it('shows failures: preview error, refused start, failed run', async () => {
    previewReply = () => { throw { data: { statusMessage: 'Disk unavailable' } }; };
    const w = await mountPanel();
    await w.find('[data-testid="tidy-preview-btn"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="tidy-error"]').text()).toContain('Disk unavailable');
    expect(startButton(w).disabled).toBe(true);

    previewReply = () => PREVIEW;
    startReply = () => { throw { data: { statusMessage: 'A library wipe is in progress. Try again when it has finished.' } }; };
    await w.find('[data-testid="tidy-preview-btn"]').trigger('click');
    await flushPromises();
    await w.find('[data-testid="tidy-start"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="tidy-error"]').text()).toContain('library wipe');
    expect(w.find('[data-testid="tidy-report"]').exists()).toBe(false);

    startReply = () => ({ started: true });
    statusReplies = [{ ...STATUS, state: 'failed', errors: 1, lastError: 'Disk full', errorDetails: [{ id: 'a', title: 'A', message: 'Moved file could not be verified' }] }];
    await w.find('[data-testid="tidy-start"]').trigger('click');
    await flushPromises();
    const report = w.find('[data-testid="tidy-report"]').text();
    expect(report).toContain('stopped because of an error');
    expect(report).toContain('Disk full');
    expect(report).toContain('Moved file could not be verified');
  });
});
```

- [ ] **Step 2: Run it and see it fail:** `npx vitest run tests/component/TidyLibraryPanel.test.ts` → the component file does not exist.

- [ ] **Step 3: Implement** `app/components/settings/TidyLibraryPanel.vue`:

```vue
<template>
  <div class="tidy-panel" data-testid="tidy-panel">
    <h4 class="results-header">Tidy library files</h4>
    <p class="section-desc">
      Moves each downloaded video into its own folder named after its title, together with its thumbnail and subtitles.
      Nothing moves until you start it, and you can run it again to finish whatever is left.
    </p>

    <p v-if="errorMessage" class="settings-error-msg" data-testid="tidy-error">{{ errorMessage }}</p>

    <div v-if="status && status.state === 'running'" class="tidy-progress" data-testid="tidy-progress">
      <div class="tidy-bar" role="progressbar" :aria-valuenow="progressPercent" aria-valuemin="0" aria-valuemax="100">
        <div class="tidy-bar-fill" :style="{ width: `${progressPercent}%` }"></div>
      </div>
      <p class="section-desc">{{ status.processed }} of {{ status.total }} videos processed, {{ status.moved }} moved.</p>
      <button type="button" class="btn btn-secondary-dark" :disabled="cancelling" data-testid="tidy-cancel" @click="cancelRun">
        {{ cancelling ? 'Cancelling...' : 'Cancel' }}
      </button>
    </div>

    <div v-else-if="report" class="tidy-report" data-testid="tidy-report">
      <p :class="report.state === 'done' && report.errors === 0 ? 'settings-success-msg' : 'settings-error-msg'">{{ reportTitle }}</p>
      <p class="section-desc">
        {{ report.moved }} moved, {{ report.skipped }} skipped, {{ report.errors }} failed<span v-if="report.channelsFixed">, {{ report.channelsFixed }} channel folder(s) repaired</span>.
      </p>
      <p v-if="report.state === 'failed' && report.lastError" class="settings-error-msg">{{ report.lastError }}</p>
      <ul v-if="report.errorDetails.length" class="tidy-list">
        <li v-for="item in report.errorDetails" :key="item.id">"{{ item.title }}": {{ item.message }}</li>
      </ul>
      <button type="button" class="btn btn-secondary-dark" data-testid="tidy-done" @click="report = null">Done</button>
    </div>

    <template v-else>
      <div v-if="preview" class="tidy-preview" data-testid="tidy-preview">
        <p><strong>{{ preview.toMove }}</strong> of {{ preview.total }} video(s) will be moved. {{ preview.alreadyTidy }} already tidy.</p>
        <p v-if="hasProblems" class="section-desc">
          Left as they are: {{ preview.conflicts }} name conflict(s), {{ preview.missingFiles }} missing file(s),
          {{ preview.notWritable }} in folders YouKeep cannot write to.
        </p>
        <p v-if="preview.duplicateFolders" class="section-desc">
          {{ preview.duplicateFolders }} channel(s) saved in a doubled folder (like "Channel/Channel") will be repaired.
        </p>
        <ul v-if="preview.samples.length" class="tidy-list">
          <li v-for="sample in preview.samples" :key="sample.id"><code>{{ sample.from }}</code> &rarr; <code>{{ sample.to }}</code></li>
        </ul>
      </div>
      <div class="tidy-actions">
        <button type="button" class="btn btn-secondary-dark" :disabled="loadingPreview" data-testid="tidy-preview-btn" @click="loadPreview">
          {{ loadingPreview ? 'Checking...' : preview ? 'Check again' : 'Show what will change' }}
        </button>
        <button type="button" class="btn btn-primary" :disabled="!canStart" data-testid="tidy-start" @click="startRun">
          {{ starting ? 'Starting...' : 'Start tidying' }}
        </button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';

interface TidyPreview {
  total: number; toMove: number; alreadyTidy: number; conflicts: number; missingFiles: number; notWritable: number; duplicateFolders: number;
  samples: { id: string; title: string; from: string; to: string }[];
  channels: { channelId: string; channel: string; toMove: number }[];
}
interface TidyStatus {
  state: 'idle' | 'running' | 'done' | 'failed' | 'cancelled';
  processed: number; total: number; moved: number; skipped: number; errors: number;
  lastError: string | null;
  errorDetails: { id: string; title: string; message: string }[];
  channelsFixed: number;
}

const preview = ref<TidyPreview | null>(null);
const status = ref<TidyStatus | null>(null);
const report = ref<TidyStatus | null>(null);
const loadingPreview = ref(false);
const starting = ref(false);
const cancelling = ref(false);
const errorMessage = ref('');
let pollTimer: ReturnType<typeof setTimeout> | null = null;

const canStart = computed(() => !!preview.value && (preview.value.toMove > 0 || preview.value.duplicateFolders > 0) && !starting.value);
const hasProblems = computed(() => !!preview.value && preview.value.conflicts + preview.value.missingFiles + preview.value.notWritable > 0);
const progressPercent = computed(() => {
  const s = status.value;
  return s && s.total > 0 ? Math.round((s.processed / s.total) * 100) : 0;
});
const reportTitle = computed(() => {
  const r = report.value;
  if (!r) return '';
  if (r.state === 'cancelled') return 'Tidying was cancelled. Run it again to finish the rest.';
  if (r.state === 'failed') return 'Tidying stopped because of an error.';
  return r.errors > 0 ? 'Tidying finished with errors.' : 'Tidying finished.';
});

function messageOf(err: any, fallback: string): string {
  return err?.data?.statusMessage || fallback;
}

async function loadPreview() {
  loadingPreview.value = true;
  errorMessage.value = '';
  try {
    preview.value = await $fetch<TidyPreview>('/api/admin/library/tidy/preview', { method: 'POST' });
  } catch (err) {
    preview.value = null;
    errorMessage.value = messageOf(err, 'Could not check the library files.');
  } finally {
    loadingPreview.value = false;
  }
}

async function pollStatus() {
  pollTimer = null;
  try {
    const s = await $fetch<TidyStatus>('/api/admin/library/tidy/status');
    if (s?.state === 'running') {
      status.value = s;
      pollTimer = setTimeout(pollStatus, 1000);
      return;
    }
    status.value = null;
    cancelling.value = false;
    if (s && (s.state === 'done' || s.state === 'failed' || s.state === 'cancelled')) {
      report.value = s;
      preview.value = null; // stale once files have moved
    }
  } catch {
    // A single failed request must not freeze the progress view.
    pollTimer = setTimeout(pollStatus, 1000);
  }
}

async function startRun() {
  if (!canStart.value) return;
  starting.value = true;
  errorMessage.value = '';
  try {
    await $fetch('/api/admin/library/tidy/start', { method: 'POST' });
  } catch (err) {
    errorMessage.value = messageOf(err, 'Could not start tidying.');
    starting.value = false;
    return;
  }
  starting.value = false;
  await pollStatus();
}

async function cancelRun() {
  cancelling.value = true;
  try {
    await $fetch('/api/admin/library/tidy/cancel', { method: 'POST' });
  } catch (err) {
    cancelling.value = false;
    errorMessage.value = messageOf(err, 'Could not cancel tidying.');
  }
}

onMounted(async () => {
  try {
    const s = await $fetch<TidyStatus>('/api/admin/library/tidy/status');
    if (s?.state === 'running') {
      status.value = s;
      pollTimer = setTimeout(pollStatus, 1000);
    }
  } catch {
    // The panel still works from a fresh preview.
  }
});

onUnmounted(() => {
  if (pollTimer) clearTimeout(pollTimer);
});
</script>

<style scoped>
.tidy-panel { display: flex; flex-direction: column; gap: 10px; }
.tidy-actions { display: flex; flex-wrap: wrap; gap: 10px; }
.tidy-bar { width: 100%; height: 8px; border-radius: 4px; background: rgba(255, 255, 255, 0.1); overflow: hidden; }
.tidy-bar-fill { height: 100%; background: var(--primary-color, #3ea6ff); transition: width 0.3s; }
.tidy-list { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 4px; font-size: 13px; overflow-wrap: anywhere; }
.tidy-list code { word-break: break-all; }
</style>
```

(Check the variable name used for the accent colour in `app/assets` — `grep -rn "\-\-primary" app/assets | head` — and use the existing one instead of `--primary-color` if it differs.)

- [ ] **Step 4: Insert it into the System tab.** In `app/components/settings/SettingsSystemTab.vue`:
  - L105: change the summary description to `Check and update the download engine (yt-dlp and FFmpeg), tidy the video files on disk and read the server's recent log.`
  - Between the end of the "Update output" box (L159, `</div>`) and `<div class="logs-container glass-panel">` (L160) insert `    <TidyLibraryPanel class="mt-3" />`.
  - After `import { useDownloadsQueue } from '~/composables/useDownloadsQueue';` (L250) add `import TidyLibraryPanel from '~/components/settings/TidyLibraryPanel.vue';`.

- [ ] **Step 5: Run to pass:** `npx vitest run tests/component/TidyLibraryPanel.test.ts tests/component/SettingsSystemTab.test.ts tests/unit/adminEnglishOnly.test.ts` → all pass (the System tab test still sees exactly five `system-*` sections).
- [ ] **Step 6: Mutation-check:** change `canStart` to `computed(() => !starting.value)` → the first test fails (start enabled before a preview); restore. Remove `report.value = s` in `pollStatus` → the report assertions fail; restore.
- [ ] **Step 7: Full suite and build:** `npx vitest run` and `npx nuxt build 2>&1 | tail -5`.
- [ ] **Step 8: Commit:**

```bash
git add app/components/settings/TidyLibraryPanel.vue app/components/settings/SettingsSystemTab.vue tests/component/TidyLibraryPanel.test.ts
git commit -m "feat: Tidy library files panel in Settings > System > Tools & logs

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Real verification in Docker with the Browser pane (controller)

Run by the controller, not a subagent. Nothing is committed unless a bug is found; any bug gets a failing test first, a fix, the full suite + build, and its own commit (same trailer). zsh does not word-split unquoted variables: always quote paths, and never rely on `$VAR` splitting into several arguments.

**Files:** none (scratch only: use the session scratchpad directory for every temporary file; record the test admin password in a scratch file, never in chat).

- [ ] **Step 1: Build and start a throwaway container from the branch.**

```bash
cd /Users/light/Git/youkeep
docker build -t youkeep:tidy-verify .
V="$(mktemp -d "$SCRATCH/yk-verify-XXXX")"   # $SCRATCH = the session scratchpad directory
mkdir -p "$V/data" "$V/videos"
docker run -d --name youkeep-tidy -p 3077:3000 -e COOKIE_SECURE=false \
  -v "$V/data:/app/data" -v "$V/videos:/downloads/videos" youkeep:tidy-verify
docker logs youkeep-tidy 2>&1 | tail -5
```

- [ ] **Step 2: Create the admin.** Open `http://127.0.0.1:3077` in the Browser pane (`resize_window` preset `desktop`; the pane reaches Docker via `127.0.0.1`), complete the first-run setup with a generated test password saved to a scratch file, and log in. Logging in with `fetch('/api/auth/login', ...)` from the page is acceptable if the form misbehaves.

- [ ] **Step 3: Seed legacy videos with real small files.** Generate files inside the container as the app's runtime user (default PUID:PGID 99:100), so the app can move them:

```bash
docker exec -u 99:100 youkeep-tidy sh -c '
set -e
mk() { d="$1"; id="$2"
  mkdir -p "$d"
  ffmpeg -loglevel error -y -f lavfi -i testsrc=duration=4:size=320x240:rate=25 -f lavfi -i sine=frequency=440:duration=4 -shortest -c:v libx264 -pix_fmt yuv420p -c:a aac "$d/$id.mp4"
  ffmpeg -loglevel error -y -f lavfi -i color=c=blue:s=320x180 -frames:v 1 "$d/$id.jpg"
  printf "WEBVTT\n\n00:00.000 --> 00:03.000\nBonjour %s\n" "$id" > "$d/$id.fr.vtt"
  printf "WEBVTT\n\n00:00.000 --> 00:03.000\nHello %s\n" "$id" > "$d/$id.en.vtt"
}
mk "/downloads/videos/Legacy Chan" LEGACYVID01
mk "/downloads/videos/Legacy Chan" LEGACYVID02
mk "/downloads/videos/Dup Chan/Dup Chan" DUPVIDEO001
ls -R /downloads/videos'
docker exec youkeep-tidy sh -c 'ls /app/.output/server/node_modules | grep -i sqlite'
```

Then insert the rows (adjust the `require` path to what the previous `ls` printed):

```bash
docker exec -u 99:100 youkeep-tidy node -e '
const Database = require("/app/.output/server/node_modules/better-sqlite3");
const db = new Database("/app/data/youkeep.db");
const now = Date.now();
db.prepare("INSERT INTO channels (id, title, created_at) VALUES (?, ?, ?)").run("UCLEGACY", "Legacy Chan", now);
db.prepare("INSERT INTO channels (id, title, custom_save_path, created_at) VALUES (?, ?, ?, ?)").run("UCDUP", "Dup Chan", "/downloads/videos/Dup Chan", now);
const v = db.prepare("INSERT INTO videos (id, title, channel_id, download_status, local_video_path, local_thumbnail_path, created_at) VALUES (?, ?, ?, \x27completed\x27, ?, ?, ?)");
v.run("LEGACYVID01", "Pourquoi le ciel est bleu ? #3 100% vrai", "UCLEGACY", "/downloads/Legacy Chan/LEGACYVID01.mp4", "/downloads/Legacy Chan/LEGACYVID01.jpg", now);
v.run("LEGACYVID02", "Second clip", "UCLEGACY", "/downloads/Legacy Chan/LEGACYVID02.mp4", "/downloads/Legacy Chan/LEGACYVID02.jpg", now);
v.run("DUPVIDEO001", "Doubled folder clip", "UCDUP", "/downloads/Dup Chan/DUPVIDEO001.mp4", "/downloads/Dup Chan/DUPVIDEO001.jpg", now);
console.log("seeded");'
```

Confirm the legacy videos play before tidying: open `/watch/LEGACYVID01` (video plays, French/English subtitles listed).

- [ ] **Step 4: Preview and run the tool in the browser.** Settings → System → Tools & logs → "Tidy library files" → "Show what will change". Expect `3 of 3 video(s) will be moved`, the doubled-folder line (1 channel), and samples whose targets are `/downloads/videos/Legacy Chan/Pourquoi le ciel est bleu _ #3 100% vrai [LEGACYVID01]/...` and `/downloads/videos/Dup Chan/Doubled folder clip [DUPVIDEO001]/...`. "Start tidying" → progress → report "Tidying finished." with `3 moved` and `1 channel folder(s) repaired`. Check the browser console has no errors.

- [ ] **Step 5: Check the disk and the database.**

```bash
docker exec youkeep-tidy ls -R /downloads/videos
docker exec -u 99:100 youkeep-tidy node -e '
const db = new (require("/app/.output/server/node_modules/better-sqlite3"))("/app/data/youkeep.db");
console.log(db.prepare("SELECT id, local_video_path, local_thumbnail_path FROM videos").all());
console.log(db.prepare("SELECT id, custom_save_path FROM channels").all());'
```

Expect one folder per video with `.mp4`, `.jpg`, `.fr.vtt`, `.en.vtt` named after the title; no `Dup Chan/Dup Chan` folder left; `UCDUP.custom_save_path` = `/downloads/videos`; stored URLs percent-encoded.

- [ ] **Step 6: Play a tidied video with subtitles.** Open `/watch/LEGACYVID01` (the title contains `?`, `#` and `%`): the video plays (in `javascript_tool`, `document.querySelector('video').readyState >= 2` and `currentTime` advances after `play()`), the subtitle menu lists French and English, and `fetch` of each subtitle URL returned by `/api/videos/LEGACYVID01` answers 200 `text/vtt`. Same check for `/watch/DUPVIDEO001`. Re-run "Check again": `0 of 3 video(s) will be moved. 3 already tidy.`

- [ ] **Step 7: Delete a tidied video.** From the page: `fetch('/api/admin/videos/LEGACYVID02', { method: 'DELETE', headers: { 'x-csrf-token': document.cookie.match(/csrf_token=([^;]+)/)[1] } })` → `{ success: true }`; `docker exec youkeep-tidy ls "/downloads/videos/Legacy Chan"` no longer lists `Second clip [LEGACYVID02]`.

- [ ] **Step 8: A new download lands in the new layout.** Ingest a very short public video (needs network): `fetch('/api/admin/downloader/ingest', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': ... }, body: JSON.stringify({ url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw' }) })`; wait until the video is `completed` (Settings → Downloads, or poll `/api/videos/jNQXAC9IVRw`), then `docker exec youkeep-tidy ls -R /downloads/videos` shows `<channel>/<Title> [jNQXAC9IVRw]/<Title> [jNQXAC9IVRw].mp4` + `.jpg` (+ `.vtt` when YouTube provides subtitles) and no `.info.json`; the watch page plays it. If the network or YouTube blocks the download, report this step as not verified (do not fake it).

- [ ] **Step 9: Clean up.**

```bash
docker rm -f youkeep-tidy
docker rmi youkeep:tidy-verify
rm -rf "$V"
```

Report every check with its observed result; list anything that could not be verified.

---

## Self-Review

**Spec coverage**

| Spec requirement | Task |
|---|---|
| Layout `<base>/<Channel>/<Title> [<id>]/` with `.mp4`/`.jpg`/`.<lang>.vtt`, `.info.json` deleted | 3 (downloader; info JSON deletion kept at L947) |
| Naming rules (forbidden + control chars, whitespace, dots/spaces, 120 bytes, no multi-byte split, empty → id, mandatory `[id]`) | 1 |
| `videoBaseName`, `videoFolderName`, `buildVideoPaths` → `{ dir, baseName, outputTemplate, videoUrlFor, thumbUrlFor, subtitleGlob }` | 1 |
| `resolveStoredPath(db, videoRow)`, DB as source of truth, URL mapped like the file route | 4 (shared helpers from 1, used by 2) |
| File route serves nested paths, keeps containment/traversal protection and Range | 2 |
| Subtitle scan: own folder for new layout, `<id>.*` for legacy | 4 |
| Video delete: folder only when it holds only that video's files; legacy deletion kept | 3 (`removeVideoFiles`), 4 (route) |
| Cancel cleanup | 3 |
| Duration backfill | 4 |
| New-layout detection (extra folder ending with `[<id>]`) | 1 (`isNewLayoutUrl`) |
| Legacy keeps working until tidied | 2, 3, 4 (legacy branches unchanged, existing tests kept) |
| Follow flow: base folder only, hint text, Edit options / Save as default same rule | 5 (Edit options and Save as default already send the folder as typed; hint added to both forms) |
| Tidy preview `{ total, toMove, alreadyTidy, conflicts, missingFiles, notWritable, duplicateFolders, samples (10), per channel }` | 6 |
| Start (one at a time, refuses during wipe), status, cancel after current video | 7, 8 |
| Skip non-completed / actively downloading videos | 7 |
| Move → verify → DB update in one transaction; revert on failure; both paths reported if revert fails | 7 |
| Cross-device copy + verify + remove source after verification | 7 |
| Empty leftover folders removed only when empty | 7 (`rmdir`) |
| Resumable (re-run preview shows the rest) | 7 (cancel/resume test) |
| Duplicate-folder repair + `custom_save_path` corrected after all videos moved | 6, 7 |
| Missing file / not writable / conflict counted and skipped | 6 |
| Interrupted run leaves no half DB state; next run completes or cleans | 7 (`moveFileVerified` partial/complete copy handling, per-video DB update after verification) |
| UI: preview, Start enabled only after preview, progress bar, report, Cancel, English | 9 |
| Tests: unit, integration (route, downloader pieces, both layouts, planner/runner incl. DB failure, cancel/resume, duplicate, cross-device), component, Docker | 1-10 |

**Placeholder scan:** every step contains the complete code or the exact command. The only "copy verbatim" instruction is Task 2's legacy branch (existing L17-56 moved unchanged into an `else`), with the exact line range and the test that must keep passing.

**Name and type consistency across tasks:** `buildVideoPaths` / `VideoPaths` (1) are used with the same fields in 3, 4, 6; `StoredVideoLocation` is defined in 3 and returned by `resolveStoredPath` in 4 with the same six fields (`layout, baseDir, dir, baseName, urlDir, videoFile`); `removeVideoFiles(loc)` (3) is called in 3 and 4 with full objects; `planTidy(db, { downloadsDir, fs? })` (6) is called the same way in 7 and 8; `TidyStatus` fields (`state, processed, total, moved, skipped, errors, lastError, errorDetails, channelsFixed`) match between 7, 8 and the component interface in 9; route paths `/api/admin/library/tidy/{preview,start,status,cancel}` match between 8 and 9; test helper options `title` / `customSavePath` (2) are used in 2-8.

**Ambiguities resolved in this plan:** forbidden characters are replaced with `_` (same as `sanitizeFolderName`); new-layout URLs are percent-encoded per segment (titles may contain `#`/`%`) and decoded by the route; `outputTemplate` doubles `%` for yt-dlp; `duplicateFolders` counts channels, not videos; the Follow flow now also sends the folder for a pasted URL; a doubled channel's moved videos are served through a second lookup folder until its `custom_save_path` is corrected; a missing legacy thumbnail becomes `null` after tidying (the UI falls back to the YouTube thumbnail); a new-layout folder whose channel was renamed later counts as already tidy (renames are out of scope).
