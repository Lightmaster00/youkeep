# Cache-Control Headers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `Cache-Control` headers to YouKeep's two file-serving routes so browsers stop re-fetching media/thumbnails on every page load, without risking stale thumbnails after a legitimate edit or leaking access-gated content into a shared cache.

**Architecture:** Both routes already classify served files into two categories via existing content-type logic (video route: `.mp4` vs image/subtitle extensions; music route: `AUDIO_CONTENT_TYPES` map vs `IMAGE_CONTENT_TYPES` map). Media files (never modified after `download_status = 'completed'`) get a long-lived immutable cache header. Image/subtitle files (can be re-downloaded or manually edited) get a conditional-revalidation header (`Last-Modified` + honoring `If-Modified-Since`, replying `304` when unchanged). Everything is marked `private` since access is visibility-gated per request.

**Tech Stack:** Nuxt 4 / Nitro (H3), raw Node `event.node.req`/`event.node.res`, Vitest.

## Global Constraints

- `private` on every `Cache-Control` value — never `public` — since served content is gated by per-track/per-video visibility checks that must not be bypassable via a shared cache.
- Media files (`.mp4` on the video route; every extension in the music route's `AUDIO_CONTENT_TYPES` map, which includes `.mp4` for clips): `Cache-Control: private, max-age=31536000, immutable`, no `Last-Modified`.
- Image/subtitle files (`.jpg`/`.jpeg`/`.png`/`.webp`/`.vtt` on the video route; everything in the music route's `IMAGE_CONTENT_TYPES` map): `Cache-Control: private, must-revalidate` + `Last-Modified` (from `fs.statSync(...).mtime`), honoring `If-Modified-Since` with a `304` reply (no body) when the file hasn't changed. Compare at one-second granularity (HTTP dates have no sub-second precision) — truncate both the file's mtime and the parsed `If-Modified-Since` value to whole seconds before comparing, or a valid revalidation can spuriously miss due to millisecond drift.
- No change to existing access control (`canAccessVideo`/`canAccessMusicTrack`), Range-request behavior (200/206/416), or Content-Type detection in either route — this plan only adds header logic, placed after the existing access check and before the existing Range-handling branch.
- Production endpoint/route files call project-local utilities (`getDb`, `canAccessVideo`, `canAccessMusicTrack`, `getDownloadsDir`, `getMusicDownloadsDir`, `sanitizeFolderName`, etc.) as bare ambient identifiers via Nitro's runtime auto-import. Vitest's direct-handler-import tests don't get that transform — write the failing test first and let the failure name the exact relative import path; never pre-guess it.
- Tests that need real files on disk should use the real `getDownloadsDir()`/`getMusicDownloadsDir()` functions (not a mocked path) and a unique, throwaway channel/artist folder name, cleaned up in `afterEach` — this matches the precedent already established in `tests/unit/musicDownloaderCleanup.test.ts`.

---

### Task 1: Extend `mockEvent` to support request headers and inspectable response headers

**Files:**
- Modify: `tests/helpers/testDb.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `mockEvent(cookieHeader?, opts?: { path?, params?, body?, headers?: Record<string, string> })` — new optional `headers` field merged into the mocked request's headers (alongside `cookie`). The returned mock event's `node.res` now has a functioning `setHeader`/`getHeader` pair backed by a real object (instead of no-op stubs) and a mutable `statusCode` (already present as a plain property, unchanged) — tests can read `event.node.res.headers['cache-control']` etc. after calling a handler. Consumed by Task 2 and Task 3.

- [ ] **Step 1: Read the current `mockEvent` implementation**

Open `tests/helpers/testDb.ts` and find:

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

- [ ] **Step 2: Replace it with a version supporting request headers and real response-header capture**

Replace the whole function with:

```ts
export function mockEvent(cookieHeader?: string, opts?: { path?: string; params?: Record<string, string>; body?: any; headers?: Record<string, string> }): any {
  const req: any = {
    headers: { cookie: cookieHeader || '', ...(opts?.headers ?? {}) }
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
  const resHeaders: Record<string, any> = {};
  return {
    path: opts?.path ?? '/',
    context: { params: opts?.params ?? {} },
    node: {
      req,
      res: {
        statusCode: 200,
        headers: resHeaders,
        getHeader: (name: string) => resHeaders[name.toLowerCase()],
        setHeader: (name: string, value: any) => { resHeaders[name.toLowerCase()] = value; }
      }
    }
  };
}
```

This is backward compatible: `headers` is optional (existing callers without it get the same empty-cookie-only request headers as before), and `node.res` gaining real `statusCode`/`headers` storage only adds capability — no existing test reads `getHeader`/`setHeader` today, so nothing that currently passes can start failing.

- [ ] **Step 3: Run the full suite to confirm no regressions**

Run: `npm test -- --run`
Expected: all existing tests still pass (this is a pure extension of an unused-capability stub — no existing test exercises `setHeader`/`getHeader`/custom `headers`).

- [ ] **Step 4: Commit**

```bash
git add tests/helpers/testDb.ts
git commit -m "test: extend mockEvent with request headers and inspectable response headers"
```

---

### Task 2: Cache-Control headers on the video file-serving route

**Files:**
- Modify: `server/routes/downloads/[...path].ts`
- Test: `tests/integration/downloads-cache-control.test.ts`

**Interfaces:**
- Consumes: `mockEvent` with `headers` support (Task 1), `insertChannel`/`insertVideo` (existing, `tests/helpers/testDb.ts`), `getDownloadsDir` (existing, `server/utils/downloader.ts`), `canAccessVideo` (existing, `server/utils/auth.ts`).
- Produces: nothing consumed by a later task (Task 3 mirrors this pattern independently, not via a shared import).

- [ ] **Step 1: Write the failing tests**

Create `tests/integration/downloads-cache-control.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import handler from '../../server/routes/downloads/[...path]';
import { createTestDb, insertChannel, insertVideo, mockEvent } from '../helpers/testDb';
import { getDownloadsDir, sanitizeFolderName } from '../../server/utils/downloader';

let db: Database.Database;
const channelId = 'cache-control-test-channel';
let channelDir: string;

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
  insertChannel(db, { id: channelId, visibility: 'public' });
  channelDir = path.join(getDownloadsDir(), sanitizeFolderName(`Channel ${channelId}`));
  fs.mkdirSync(channelDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(channelDir, { recursive: true, force: true });
});

function writeFile(videoId: string, ext: string, mtime?: Date) {
  const filePath = path.join(channelDir, `${videoId}.${ext}`);
  fs.writeFileSync(filePath, 'x');
  if (mtime) fs.utimesSync(filePath, mtime, mtime);
  return filePath;
}

function eventFor(videoId: string, ext: string, headers?: Record<string, string>) {
  return mockEvent(undefined, { path: `/downloads/${channelId}/${videoId}.${ext}`, params: { path: `${channelId}/${videoId}.${ext}` }, headers });
}

describe('GET /downloads/[...path] — Cache-Control', () => {
  it('sets an immutable long-lived Cache-Control on a video file, with no Last-Modified', async () => {
    insertVideo(db, { id: 'v1', channelId, downloadStatus: 'completed' });
    writeFile('v1', 'mp4');
    const event = eventFor('v1', 'mp4');

    await handler(event);

    expect(event.node.res.headers['cache-control']).toBe('private, max-age=31536000, immutable');
    expect(event.node.res.headers['last-modified']).toBeUndefined();
  });

  it('sets a must-revalidate Cache-Control and Last-Modified on a thumbnail', async () => {
    insertVideo(db, { id: 'v2', channelId, downloadStatus: 'completed' });
    writeFile('v2', 'jpg');
    const event = eventFor('v2', 'jpg');

    await handler(event);

    expect(event.node.res.headers['cache-control']).toBe('private, must-revalidate');
    expect(event.node.res.headers['last-modified']).toBeDefined();
  });

  it('returns 304 with no body when If-Modified-Since is at or after the file mtime', async () => {
    insertVideo(db, { id: 'v3', channelId, downloadStatus: 'completed' });
    const mtime = new Date('2026-01-01T00:00:00Z');
    writeFile('v3', 'jpg', mtime);
    const event = eventFor('v3', 'jpg', { 'if-modified-since': new Date('2026-01-01T00:00:00Z').toUTCString() });

    const result = await handler(event);

    expect(event.node.res.statusCode).toBe(304);
    expect(result).toBeFalsy();
  });

  it('returns 200 with content when If-Modified-Since predates the file mtime', async () => {
    insertVideo(db, { id: 'v4', channelId, downloadStatus: 'completed' });
    const mtime = new Date('2026-01-01T00:00:00Z');
    writeFile('v4', 'jpg', mtime);
    const event = eventFor('v4', 'jpg', { 'if-modified-since': new Date('2025-01-01T00:00:00Z').toUTCString() });

    const result = await handler(event);

    expect(event.node.res.statusCode).toBe(200);
    expect(result).toBeTruthy();
  });

  it('still returns 403 for a private channel without access (regression)', async () => {
    const privateChannelId = 'cache-control-private-channel';
    insertChannel(db, { id: privateChannelId, visibility: 'private' });
    const privateDir = path.join(getDownloadsDir(), sanitizeFolderName(`Channel ${privateChannelId}`));
    fs.mkdirSync(privateDir, { recursive: true });
    fs.writeFileSync(path.join(privateDir, 'v5.mp4'), 'x');
    insertVideo(db, { id: 'v5', channelId: privateChannelId, visibility: 'private', downloadStatus: 'completed' });

    try {
      await expect(handler(mockEvent(undefined, { path: `/downloads/${privateChannelId}/v5.mp4`, params: { path: `${privateChannelId}/v5.mp4` } }))).rejects.toMatchObject({ statusCode: 403 });
    } finally {
      fs.rmSync(privateDir, { recursive: true, force: true });
    }
  });

  it('still returns 404 for a missing file (regression)', async () => {
    insertVideo(db, { id: 'v6', channelId, downloadStatus: 'completed' });
    await expect(handler(eventFor('v6', 'mp4'))).rejects.toMatchObject({ statusCode: 404 });
  });

  it('still supports Range requests with 206 (regression)', async () => {
    insertVideo(db, { id: 'v7', channelId, downloadStatus: 'completed' });
    writeFile('v7', 'mp4');
    const event = eventFor('v7', 'mp4', { range: 'bytes=0-0' });

    await handler(event);

    expect(event.node.res.statusCode).toBe(206);
    expect(event.node.res.headers['content-range']).toBe('bytes 0-0/1');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/integration/downloads-cache-control.test.ts`
Expected: FAIL — no `Cache-Control`/`Last-Modified` headers are set yet, and the 304 test fails since nothing short-circuits on `If-Modified-Since`.

- [ ] **Step 3: Implement the headers**

Open `server/routes/downloads/[...path].ts`. Find:

```ts
  event.node.res.setHeader('Accept-Ranges', 'bytes');
  event.node.res.setHeader('Content-Type', contentType);

  if (range) {
```

Replace with:

```ts
  event.node.res.setHeader('Accept-Ranges', 'bytes');
  event.node.res.setHeader('Content-Type', contentType);

  const isImmutableMedia = ext === '.mp4';
  if (isImmutableMedia) {
    event.node.res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  } else {
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
          return null;
        }
      }
    }
  }

  if (range) {
```

If the test run fails with a "not defined" error for `getDb`, `canAccessVideo`, or any other bare identifier already used elsewhere in this file, that means this specific test path reaches a code line that wasn't reached by any pre-existing test — add the exact explicit relative import the failure demands.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/integration/downloads-cache-control.test.ts`
Expected: PASS (all 7 tests).

- [ ] **Step 5: Run the full suite to confirm no regressions**

Run: `npm test -- --run`

- [ ] **Step 6: Commit**

```bash
git add server/routes/downloads/\[...path\].ts tests/integration/downloads-cache-control.test.ts
git commit -m "feat: add Cache-Control headers to the video file-serving route"
```

---

### Task 3: Cache-Control headers on the music file-serving route

**Files:**
- Modify: `server/routes/downloads-music/[...path].ts`
- Test: `tests/integration/downloads-music-cache-control.test.ts`

**Interfaces:**
- Consumes: `mockEvent` with `headers` support (Task 1), `insertMusicArtist`/`insertMusicTrack` (existing, `tests/helpers/testDb.ts`), `getMusicDownloadsDir` (existing, `server/utils/musicDownloader.ts`), `canAccessMusicTrack` (existing, `server/utils/auth.ts`).
- Produces: nothing consumed by a later task (last task in this plan).

- [ ] **Step 1: Write the failing tests**

Create `tests/integration/downloads-music-cache-control.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import handler from '../../server/routes/downloads-music/[...path]';
import { createTestDb, insertMusicArtist, insertMusicTrack, mockEvent } from '../helpers/testDb';
import { getMusicDownloadsDir } from '../../server/utils/musicDownloader';
import { sanitizeFolderName } from '../../server/utils/downloader';

let db: Database.Database;
const artistId = 'cache-control-test-artist';
let artistDir: string;

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
  insertMusicArtist(db, { id: artistId, name: `Artist ${artistId}`, visibility: 'public' });
  artistDir = path.join(getMusicDownloadsDir(), sanitizeFolderName(`Artist ${artistId}`));
  fs.mkdirSync(artistDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(artistDir, { recursive: true, force: true });
});

function writeFile(trackId: string, ext: string, mtime?: Date) {
  const filePath = path.join(artistDir, `${trackId}.${ext}`);
  fs.writeFileSync(filePath, 'x');
  if (mtime) fs.utimesSync(filePath, mtime, mtime);
  return filePath;
}

function eventFor(trackId: string, ext: string, headers?: Record<string, string>) {
  return mockEvent(undefined, { path: `/downloads-music/${artistId}/${trackId}.${ext}`, params: { path: `${artistId}/${trackId}.${ext}` }, headers });
}

describe('GET /downloads-music/[...path] — Cache-Control', () => {
  it('sets an immutable long-lived Cache-Control on an audio file, with no Last-Modified', async () => {
    insertMusicTrack(db, { id: 't1', artistId, downloadStatus: 'completed' });
    writeFile('t1', 'opus');
    const event = eventFor('t1', 'opus');

    await handler(event);

    expect(event.node.res.headers['cache-control']).toBe('private, max-age=31536000, immutable');
    expect(event.node.res.headers['last-modified']).toBeUndefined();
  });

  it('sets an immutable Cache-Control on a clip (.mp4) file too', async () => {
    insertMusicTrack(db, { id: 't2', artistId, downloadStatus: 'completed', hasClip: true });
    writeFile('t2', 'mp4');
    const event = eventFor('t2', 'mp4');

    await handler(event);

    expect(event.node.res.headers['cache-control']).toBe('private, max-age=31536000, immutable');
  });

  it('sets a must-revalidate Cache-Control and Last-Modified on a cover image', async () => {
    insertMusicTrack(db, { id: 't3', artistId, downloadStatus: 'completed' });
    writeFile('t3', 'jpg');
    const event = eventFor('t3', 'jpg');

    await handler(event);

    expect(event.node.res.headers['cache-control']).toBe('private, must-revalidate');
    expect(event.node.res.headers['last-modified']).toBeDefined();
  });

  it('returns 304 with no body when If-Modified-Since is at or after the file mtime', async () => {
    insertMusicTrack(db, { id: 't4', artistId, downloadStatus: 'completed' });
    const mtime = new Date('2026-01-01T00:00:00Z');
    writeFile('t4', 'jpg', mtime);
    const event = eventFor('t4', 'jpg', { 'if-modified-since': new Date('2026-01-01T00:00:00Z').toUTCString() });

    const result = await handler(event);

    expect(event.node.res.statusCode).toBe(304);
    expect(result).toBeFalsy();
  });

  it('returns 200 with content when If-Modified-Since predates the file mtime', async () => {
    insertMusicTrack(db, { id: 't5', artistId, downloadStatus: 'completed' });
    const mtime = new Date('2026-01-01T00:00:00Z');
    writeFile('t5', 'jpg', mtime);
    const event = eventFor('t5', 'jpg', { 'if-modified-since': new Date('2025-01-01T00:00:00Z').toUTCString() });

    const result = await handler(event);

    expect(event.node.res.statusCode).toBe(200);
    expect(result).toBeTruthy();
  });

  it('still returns 403 for a private artist without access (regression)', async () => {
    const privateArtistId = 'cache-control-private-artist';
    insertMusicArtist(db, { id: privateArtistId, name: `Artist ${privateArtistId}`, visibility: 'private' });
    const privateDir = path.join(getMusicDownloadsDir(), sanitizeFolderName(`Artist ${privateArtistId}`));
    fs.mkdirSync(privateDir, { recursive: true });
    fs.writeFileSync(path.join(privateDir, 't6.opus'), 'x');
    insertMusicTrack(db, { id: 't6', artistId: privateArtistId, downloadStatus: 'completed' });

    try {
      await expect(handler(mockEvent(undefined, { path: `/downloads-music/${privateArtistId}/t6.opus`, params: { path: `${privateArtistId}/t6.opus` } }))).rejects.toMatchObject({ statusCode: 403 });
    } finally {
      fs.rmSync(privateDir, { recursive: true, force: true });
    }
  });

  it('still returns 404 for a missing file (regression)', async () => {
    insertMusicTrack(db, { id: 't7', artistId, downloadStatus: 'completed' });
    await expect(handler(eventFor('t7', 'opus'))).rejects.toMatchObject({ statusCode: 404 });
  });

  it('still supports Range requests with 206 on audio (regression)', async () => {
    insertMusicTrack(db, { id: 't8', artistId, downloadStatus: 'completed' });
    writeFile('t8', 'opus');
    const event = eventFor('t8', 'opus', { range: 'bytes=0-0' });

    await handler(event);

    expect(event.node.res.statusCode).toBe(206);
    expect(event.node.res.headers['content-range']).toBe('bytes 0-0/1');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/integration/downloads-music-cache-control.test.ts`
Expected: FAIL — no `Cache-Control`/`Last-Modified` headers set yet, image branch has no revalidation short-circuit.

- [ ] **Step 3: Implement the headers**

Open `server/routes/downloads-music/[...path].ts`.

First, the image/subtitle branch. Find:

```ts
  const stat = fs.statSync(resolvedPath);

  if (!isAudio) {
    event.node.res.setHeader('Content-Type', contentType);
    event.node.res.setHeader('Content-Length', stat.size);
    event.node.res.statusCode = 200;
    return fs.createReadStream(resolvedPath);
  }
```

Replace with:

```ts
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
          return null;
        }
      }
    }

    event.node.res.setHeader('Content-Length', stat.size);
    event.node.res.statusCode = 200;
    return fs.createReadStream(resolvedPath);
  }
```

Then, the audio/clip branch. Find:

```ts
  event.node.res.setHeader('Accept-Ranges', 'bytes');
  event.node.res.setHeader('Content-Type', contentType);

  if (range) {
```

Replace with:

```ts
  event.node.res.setHeader('Accept-Ranges', 'bytes');
  event.node.res.setHeader('Content-Type', contentType);
  event.node.res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');

  if (range) {
```

If the test run fails with a "not defined" error for `getDb`, `canAccessMusicTrack`, or any other bare identifier already used elsewhere in this file, add the exact explicit relative import the failure demands.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/integration/downloads-music-cache-control.test.ts`
Expected: PASS (all 8 tests).

- [ ] **Step 5: Run the full suite to confirm no regressions**

Run: `npm test -- --run`

- [ ] **Step 6: Commit**

```bash
git add server/routes/downloads-music/\[...path\].ts tests/integration/downloads-music-cache-control.test.ts
git commit -m "feat: add Cache-Control headers to the music file-serving route"
```
