# Search Platforms Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generalize the admin ingest-search feature's API-key storage into an extensible `search_platforms` table, migrate PodcastIndex into it, and add two new concrete platforms: Listen Notes (3rd podcast source) and the official YouTube Data API (optional replacement for the current HTML-scraping channel search).

**Architecture:** A new generic settings table + GET/POST route pair replaces the old two-named-settings-rows PodcastIndex pattern. `search-shows.get.ts` extends from a 2-source to a 3-source parallel fetch/merge. `search-channels.get.ts` gains an optional YouTube Data API attempt that runs before (and can fall back to) its existing, untouched scraping code. A single new Settings → System panel replaces the old Podcasts-tab-only PodcastIndex form.

**Tech Stack:** Nuxt 4, Nitro server routes, better-sqlite3, Vue 3 `<script setup>`, Vitest.

## Global Constraints

- No platform beyond PodcastIndex, Listen Notes, and YouTube Data API in this project (the table/route design is extensible to more later, but none are built now).
- No quota/rate-limit tracking or warnings for YouTube Data API or Listen Notes — any failure (including a quota error) is treated as an ordinary failure and falls back silently.
- No use of YouTube Data API's richer data via a follow-up `channels.list` call — `search.list`'s response is enough; `subscriberCount`/`videoCount`/`handle` are left as empty strings when the API path is used.
- No change to the content-search-for-already-archived-media feature (separate sub-project).
- `search_platforms` table: `id TEXT PRIMARY KEY, api_key TEXT NOT NULL DEFAULT '', api_secret TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL`. Seeded with exactly 3 rows: `'podcastindex'`, `'listennotes'`, `'youtube_data_api'`.
- One-time, idempotent migration: copy old `podcastindex_api_key`/`podcastindex_api_secret` settings values into the new `podcastindex` row ONLY if the new row's values are still empty AND the old values are non-empty. Old settings rows are never deleted.
- `GET /api/admin/system/search-platforms` → `{ platforms: [{ id, apiKey, apiSecret }] }` for all 3 rows. `POST /api/admin/system/search-platforms` with `{ id, apiKey, apiSecret }` → validates `id` is one of the 3 known values (400 otherwise), updates that row, returns `{ success: true }`.
- Podcast merge priority on a feed-URL duplicate: iTunes > PodcastIndex > Listen Notes (each source only fills keys not already claimed by an earlier one in that exact order).
- Listen Notes: `GET https://listen-api.listennotes.com/api/v2/search?type=podcast&q=<q>`, auth via `X-ListenAPI-Key` header, response fields `title`/`publisher`/`description`/`image`/`rss` (`rss` = feed URL, skip any result missing it).
- YouTube Data API: `GET https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&q=<q>&key=<apiKey>&maxResults=25`, maps each result into the existing `{id,title,description,avatarUrl,subscriberCount,videoCount,handle}` shape (`subscriberCount`/`videoCount`/`handle` as empty strings). Used INSTEAD of scraping when `api_key` is configured (not merged) — falls back to scraping on empty key OR any API call failure.
- All new/changed external calls follow the established fail-silent convention: missing key → skip/fall back silently, call failure → caught, logged server-side only, never a 500, never surfaced to the admin.
- New pure logic gets real unit tests (`normalizeListenNotesResult`, 3-source `mergeShowCandidates`, YouTube Data API response mapping function). No test coverage for the actual outbound HTTP calls themselves or the existing scraping fallback path.

## File Structure

- Modify: `server/utils/db.ts` — new `search_platforms` table (CREATE TABLE), seeding (3 rows), one-time PodcastIndex migration.
- Create: `server/api/admin/system/search-platforms.get.ts` / `.post.ts` — generic platform credentials routes.
- Modify: `server/utils/podcastSearch.ts` — add `normalizeListenNotesResult`, extend `mergeShowCandidates` to a 3rd optional source.
- Modify: `tests/unit/podcastSearch.test.ts` — tests for the above.
- Create: `server/utils/youtubeSearch.ts` — pure `normalizeYoutubeDataApiChannel` mapping function.
- Create: `tests/unit/youtubeSearch.test.ts` — tests for the above.
- Modify: `server/api/admin/podcasts/search-shows.get.ts` — read from `search_platforms`, 3-way fetch/merge.
- Modify: `server/api/admin/downloader/search-channels.get.ts` — optional YouTube Data API path before the existing (unchanged) scraping fallback.
- Modify: `app/components/settings/SettingsSystemTab.vue` — new "Search Platforms" panel.
- Modify: `app/components/settings/SettingsPodcastsTab.vue` — remove the PodcastIndex-only credentials form (search box itself untouched).
- Delete: `server/api/admin/podcasts/podcastindex-credentials.get.ts` / `.post.ts` — retired once nothing calls them (end of Task 5).

---

### Task 1: `search_platforms` table, migration, and generic settings routes

**Files:**
- Modify: `server/utils/db.ts`
- Create: `server/api/admin/system/search-platforms.get.ts`
- Create: `server/api/admin/system/search-platforms.post.ts`

**Interfaces:**
- Produces: the `search_platforms` table (schema above, 3 seeded rows); `GET`/`POST /api/admin/system/search-platforms` as specified in Global Constraints. Consumed by Task 3 (search-shows.get.ts reads the table directly via `getDb()`), Task 4 (search-channels.get.ts reads the table directly), and Task 5 (the new Settings UI calls these two routes).

- [ ] **Step 1: Add the `search_platforms` table**

In `server/utils/db.ts`, find the `CREATE TABLE IF NOT EXISTS podcast_episodes (...)` block — it ends with:

```typescript
      FOREIGN KEY (show_id) REFERENCES podcast_shows(id) ON DELETE CASCADE
    );
  `);
```

Immediately before the closing `` `); `` (i.e. right after the `podcast_episodes` table's closing `);`), add a new table definition so the block reads:

```typescript
      FOREIGN KEY (show_id) REFERENCES podcast_shows(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS search_platforms (
      id TEXT PRIMARY KEY,
      api_key TEXT NOT NULL DEFAULT '',
      api_secret TEXT NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL
    );
  `);
```

- [ ] **Step 2: Seed the 3 platform rows and run the one-time PodcastIndex migration**

Find the existing PodcastIndex settings-seeding block in `server/utils/db.ts`:

```typescript
  const podcastIndexKeyCheck = db.prepare("SELECT COUNT(*) as count FROM settings WHERE key = 'podcastindex_api_key'").get() as { count: number };
  if (podcastIndexKeyCheck.count === 0) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('podcastindex_api_key', '')").run();
  }

  const podcastIndexSecretCheck = db.prepare("SELECT COUNT(*) as count FROM settings WHERE key = 'podcastindex_api_secret'").get() as { count: number };
  if (podcastIndexSecretCheck.count === 0) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('podcastindex_api_secret', '')").run();
  }
```

Immediately after it, add:

```typescript
  const searchPlatformIds = ['podcastindex', 'listennotes', 'youtube_data_api'];
  for (const platformId of searchPlatformIds) {
    const platformCheck = db.prepare('SELECT COUNT(*) as count FROM search_platforms WHERE id = ?').get(platformId) as { count: number };
    if (platformCheck.count === 0) {
      db.prepare('INSERT INTO search_platforms (id, api_key, api_secret, updated_at) VALUES (?, ?, ?, ?)').run(platformId, '', '', Date.now());
    }
  }

  // One-time migration: carry forward any previously-saved PodcastIndex
  // credentials from the old named settings rows into the new generic
  // search_platforms table. Idempotent — only copies when the new row is
  // still empty and the old values are non-empty, so this is safe to run
  // on every server start.
  const oldPodcastIndexKeyRow = db.prepare("SELECT value FROM settings WHERE key = 'podcastindex_api_key'").get() as { value: string } | undefined;
  const oldPodcastIndexSecretRow = db.prepare("SELECT value FROM settings WHERE key = 'podcastindex_api_secret'").get() as { value: string } | undefined;
  const newPodcastIndexRow = db.prepare("SELECT api_key, api_secret FROM search_platforms WHERE id = 'podcastindex'").get() as { api_key: string; api_secret: string } | undefined;
  const hasOldPodcastIndexValue = !!(oldPodcastIndexKeyRow?.value || oldPodcastIndexSecretRow?.value);
  const newPodcastIndexRowIsEmpty = !!newPodcastIndexRow && !newPodcastIndexRow.api_key && !newPodcastIndexRow.api_secret;
  if (newPodcastIndexRowIsEmpty && hasOldPodcastIndexValue) {
    db.prepare("UPDATE search_platforms SET api_key = ?, api_secret = ?, updated_at = ? WHERE id = 'podcastindex'")
      .run(oldPodcastIndexKeyRow?.value || '', oldPodcastIndexSecretRow?.value || '', Date.now());
  }
```

- [ ] **Step 3: Create the GET route**

Create `server/api/admin/system/search-platforms.get.ts`:

```typescript
import { defineEventHandler } from 'h3';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const db = getDb();

  const rows = db.prepare('SELECT id, api_key, api_secret FROM search_platforms').all() as { id: string; api_key: string; api_secret: string }[];

  return {
    platforms: rows.map((row) => ({
      id: row.id,
      apiKey: row.api_key,
      apiSecret: row.api_secret
    }))
  };
});
```

- [ ] **Step 4: Create the POST route**

Create `server/api/admin/system/search-platforms.post.ts`:

```typescript
import { defineEventHandler, readBody, createError } from 'h3';

const KNOWN_PLATFORM_IDS = ['podcastindex', 'listennotes', 'youtube_data_api'];

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const body = await readBody(event);
  const id = typeof body?.id === 'string' ? body.id.trim() : '';

  if (!KNOWN_PLATFORM_IDS.includes(id)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Unknown search platform id.'
    });
  }

  const apiKey = typeof body?.apiKey === 'string' ? body.apiKey.trim() : '';
  const apiSecret = typeof body?.apiSecret === 'string' ? body.apiSecret.trim() : '';

  const db = getDb();
  db.prepare('UPDATE search_platforms SET api_key = ?, api_secret = ?, updated_at = ? WHERE id = ?')
    .run(apiKey, apiSecret, Date.now(), id);

  return { success: true };
});
```

- [ ] **Step 5: Run the full test suite to confirm no regressions**

Run: `npm test`
Expected: PASS — no dedicated test file for this task's DB seeding/migration or its thin settings routes (matches this codebase's established convention for this class of settings-plumbing code, e.g. `default-dir.get.ts`/`.post.ts` have none either).

- [ ] **Step 6: Commit**

```bash
git add server/utils/db.ts server/api/admin/system/search-platforms.get.ts server/api/admin/system/search-platforms.post.ts
git commit -m "feat: add search_platforms table, PodcastIndex migration, generic settings routes"
```

---

### Task 2: Podcast pure-logic extension — Listen Notes normalizer + 3-source merge

**Files:**
- Modify: `server/utils/podcastSearch.ts`
- Modify: `tests/unit/podcastSearch.test.ts`

**Interfaces:**
- Produces: `normalizeListenNotesResult(raw: any): ShowCandidate | null`; `mergeShowCandidates(itunesResults: ShowCandidate[], podcastIndexResults: ShowCandidate[], listenNotesResults: ShowCandidate[] = [])` (3rd parameter added, optional/defaulted so the existing 2-argument call sites — including this file's own pre-existing tests — remain valid without modification). Consumed by Task 3.

- [ ] **Step 1: Write the failing tests**

In `tests/unit/podcastSearch.test.ts`, update the import line at the top:

```typescript
import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import {
  normalizeItunesResult,
  normalizePodcastIndexResult,
  normalizeListenNotesResult,
  mergeShowCandidates,
  computePodcastIndexAuthHeaders,
} from '../../server/utils/podcastSearch';
```

Then add these new `describe` blocks at the end of the file (after the existing `computePodcastIndexAuthHeaders` block, before the final closing of the file):

```typescript
describe('normalizeListenNotesResult', () => {
  it('maps a Listen Notes result to a ShowCandidate', () => {
    const result = normalizeListenNotesResult({
      title: 'Planet Money',
      publisher: 'NPR',
      description: 'The economy explained.',
      image: 'https://example.com/art3.jpg',
      rss: 'https://feeds.npr.org/510289/podcast.xml',
    });
    expect(result).toEqual({
      title: 'Planet Money',
      author: 'NPR',
      description: 'The economy explained.',
      artworkUrl: 'https://example.com/art3.jpg',
      feedUrl: 'https://feeds.npr.org/510289/podcast.xml',
    });
  });

  it('returns null when rss is missing or empty', () => {
    expect(normalizeListenNotesResult({ title: 'No Feed' })).toBeNull();
    expect(normalizeListenNotesResult({ title: 'Empty Feed', rss: '   ' })).toBeNull();
  });

  it('falls back to empty author/description/artworkUrl when those fields are missing', () => {
    const result = normalizeListenNotesResult({ rss: 'https://a.com/feed.xml' });
    expect(result?.author).toBe('');
    expect(result?.description).toBe('');
    expect(result?.artworkUrl).toBe('');
  });

  it('falls back to "Sans nom" when title is missing', () => {
    const result = normalizeListenNotesResult({ rss: 'https://a.com/feed.xml' });
    expect(result?.title).toBe('Sans nom');
  });
});

describe('mergeShowCandidates with a 3rd Listen Notes source', () => {
  const itunesShow = {
    title: 'Planet Money (iTunes)',
    author: 'NPR',
    description: '',
    artworkUrl: 'https://itunes.example.com/art.jpg',
    feedUrl: 'https://feeds.npr.org/510289/podcast.xml',
  };
  const podcastIndexShow = {
    title: 'Planet Money (PodcastIndex)',
    author: 'NPR',
    description: 'The economy explained.',
    artworkUrl: 'https://podcastindex.example.com/art.jpg',
    feedUrl: 'https://feeds.npr.org/510289/podcast.xml',
  };
  const listenNotesShow = {
    title: 'Planet Money (Listen Notes)',
    author: 'NPR',
    description: 'The economy explained differently.',
    artworkUrl: 'https://listennotes.example.com/art.jpg',
    feedUrl: 'https://feeds.npr.org/510289/podcast.xml',
  };
  const listenNotesUnique = {
    title: 'Obscure Indie Show',
    author: 'Someone Else',
    description: 'A very indie podcast.',
    artworkUrl: 'https://listennotes.example.com/indie.jpg',
    feedUrl: 'https://example.com/obscure-feed.xml',
  };

  it('keeps iTunes when the same feed URL is on all 3 sources', () => {
    const result = mergeShowCandidates([itunesShow], [podcastIndexShow], [listenNotesShow]);
    expect(result).toEqual([itunesShow]);
  });

  it('keeps PodcastIndex over Listen Notes when only those two share a feed URL', () => {
    const result = mergeShowCandidates([], [podcastIndexShow], [listenNotesShow]);
    expect(result).toEqual([podcastIndexShow]);
  });

  it('includes a Listen-Notes-only show not present in either other source', () => {
    const result = mergeShowCandidates([itunesShow], [], [listenNotesUnique]);
    expect(result).toEqual([itunesShow, listenNotesUnique]);
  });

  it('defaults the 3rd argument to an empty array when omitted (backward compatible with 2-source calls)', () => {
    const result = mergeShowCandidates([itunesShow], []);
    expect(result).toEqual([itunesShow]);
  });

  it('returns an empty array when all 3 sources are empty', () => {
    expect(mergeShowCandidates([], [], [])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- podcastSearch`
Expected: FAIL — `normalizeListenNotesResult` is not exported yet.

- [ ] **Step 3: Write the implementation**

In `server/utils/podcastSearch.ts`, add this new function after `normalizePodcastIndexResult` and before `normalizeFeedUrlKey`:

```typescript
export function normalizeListenNotesResult(raw: any): ShowCandidate | null {
  const feedUrl = typeof raw?.rss === 'string' ? raw.rss.trim() : '';
  if (!feedUrl) return null;

  return {
    title: raw.title || 'Sans nom',
    author: raw.publisher || '',
    description: raw.description || '',
    artworkUrl: raw.image || '',
    feedUrl,
  };
}
```

Then replace the existing `mergeShowCandidates` function:

```typescript
export function mergeShowCandidates(itunesResults: ShowCandidate[], podcastIndexResults: ShowCandidate[]): ShowCandidate[] {
  const merged = new Map<string, ShowCandidate>();

  for (const candidate of itunesResults) {
    merged.set(normalizeFeedUrlKey(candidate.feedUrl), candidate);
  }
  for (const candidate of podcastIndexResults) {
    const key = normalizeFeedUrlKey(candidate.feedUrl);
    if (!merged.has(key)) {
      merged.set(key, candidate);
    }
  }

  return Array.from(merged.values());
}
```

with:

```typescript
export function mergeShowCandidates(
  itunesResults: ShowCandidate[],
  podcastIndexResults: ShowCandidate[],
  listenNotesResults: ShowCandidate[] = []
): ShowCandidate[] {
  const merged = new Map<string, ShowCandidate>();

  for (const candidate of itunesResults) {
    merged.set(normalizeFeedUrlKey(candidate.feedUrl), candidate);
  }
  for (const candidate of podcastIndexResults) {
    const key = normalizeFeedUrlKey(candidate.feedUrl);
    if (!merged.has(key)) {
      merged.set(key, candidate);
    }
  }
  for (const candidate of listenNotesResults) {
    const key = normalizeFeedUrlKey(candidate.feedUrl);
    if (!merged.has(key)) {
      merged.set(key, candidate);
    }
  }

  return Array.from(merged.values());
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- podcastSearch`
Expected: PASS, all tests green (including the pre-existing 2-source tests, unmodified — confirming the 3rd parameter's default keeps them working).

- [ ] **Step 5: Commit**

```bash
git add server/utils/podcastSearch.ts tests/unit/podcastSearch.test.ts
git commit -m "feat: add Listen Notes normalizer and extend mergeShowCandidates to 3 sources"
```

---

### Task 3: `search-shows.get.ts` — read from `search_platforms`, 3-way fetch/merge

**Files:**
- Modify: `server/api/admin/podcasts/search-shows.get.ts`

**Interfaces:**
- Consumes: `search_platforms` table (Task 1, rows `podcastindex` and `listennotes`); `normalizeItunesResult`, `normalizePodcastIndexResult`, `normalizeListenNotesResult`, `mergeShowCandidates`, `computePodcastIndexAuthHeaders` from `server/utils/podcastSearch.ts` (Task 1 + Task 2).
- Produces: `GET /api/admin/podcasts/search-shows?q=<term>` → `{ shows: ShowCandidate[] }` (unchanged response shape — Task 5's frontend consumer needs no changes).

- [ ] **Step 1: Replace the file's content**

Replace the entire content of `server/api/admin/podcasts/search-shows.get.ts` with:

```typescript
import { defineEventHandler, getQuery, createError } from 'h3';
import {
  normalizeItunesResult,
  normalizePodcastIndexResult,
  normalizeListenNotesResult,
  mergeShowCandidates,
  computePodcastIndexAuthHeaders,
} from '../../../utils/podcastSearch';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const query = getQuery(event);
  const q = query.q ? String(query.q).trim() : '';

  if (!q) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Search query is required.'
    });
  }

  try {
    const db = getDb();
    const platformRows = db.prepare("SELECT id, api_key, api_secret FROM search_platforms WHERE id IN ('podcastindex', 'listennotes')").all() as { id: string; api_key: string; api_secret: string }[];
    const podcastIndexRow = platformRows.find((p) => p.id === 'podcastindex');
    const listenNotesRow = platformRows.find((p) => p.id === 'listennotes');
    const podcastIndexApiKey = podcastIndexRow?.api_key || '';
    const podcastIndexApiSecret = podcastIndexRow?.api_secret || '';
    const listenNotesApiKey = listenNotesRow?.api_key || '';

    const fetchItunes = async (): Promise<any[]> => {
      const data = await globalThis.$fetch<any>('https://itunes.apple.com/search', {
        params: { media: 'podcast', term: q, limit: 25 },
        parseResponse: JSON.parse,
        timeout: 8000,
      });
      return Array.isArray(data?.results) ? data.results : [];
    };

    const fetchPodcastIndex = async (): Promise<any[]> => {
      if (!podcastIndexApiKey || !podcastIndexApiSecret) return [];
      const unixTimestamp = Math.floor(Date.now() / 1000);
      const headers = computePodcastIndexAuthHeaders(podcastIndexApiKey, podcastIndexApiSecret, unixTimestamp);
      const data = await globalThis.$fetch<any>('https://api.podcastindex.org/api/1.0/search/byterm', {
        params: { q },
        headers,
        timeout: 8000,
      });
      return Array.isArray(data?.feeds) ? data.feeds : [];
    };

    const fetchListenNotes = async (): Promise<any[]> => {
      if (!listenNotesApiKey) return [];
      const data = await globalThis.$fetch<any>('https://listen-api.listennotes.com/api/v2/search', {
        params: { type: 'podcast', q },
        headers: { 'X-ListenAPI-Key': listenNotesApiKey },
        timeout: 8000,
      });
      return Array.isArray(data?.results) ? data.results : [];
    };

    const [itunesResult, podcastIndexResult, listenNotesResult] = await Promise.allSettled([
      fetchItunes(),
      fetchPodcastIndex(),
      fetchListenNotes(),
    ]);

    if (itunesResult.status === 'rejected') {
      console.error('[admin/podcasts/search-shows] iTunes fetch failed', itunesResult.reason);
    }
    if (podcastIndexResult.status === 'rejected') {
      console.error('[admin/podcasts/search-shows] PodcastIndex fetch failed', podcastIndexResult.reason);
    }
    if (listenNotesResult.status === 'rejected') {
      console.error('[admin/podcasts/search-shows] Listen Notes fetch failed', listenNotesResult.reason);
    }

    const itunesRaw = itunesResult.status === 'fulfilled' ? itunesResult.value : [];
    const podcastIndexRaw = podcastIndexResult.status === 'fulfilled' ? podcastIndexResult.value : [];
    const listenNotesRaw = listenNotesResult.status === 'fulfilled' ? listenNotesResult.value : [];

    const itunesCandidates = itunesRaw
      .map(normalizeItunesResult)
      .filter((c: any): c is NonNullable<typeof c> => c !== null);
    const podcastIndexCandidates = podcastIndexRaw
      .map(normalizePodcastIndexResult)
      .filter((c: any): c is NonNullable<typeof c> => c !== null);
    const listenNotesCandidates = listenNotesRaw
      .map(normalizeListenNotesResult)
      .filter((c: any): c is NonNullable<typeof c> => c !== null);

    return { shows: mergeShowCandidates(itunesCandidates, podcastIndexCandidates, listenNotesCandidates) };
  } catch (err) {
    console.error('[admin/podcasts/search-shows]', err);
    return { shows: [] };
  }
});
```

Note: this file no longer reads the old named `podcastindex_api_key`/`podcastindex_api_secret` settings rows at all — it reads exclusively from `search_platforms`, which Task 1's migration guarantees carries forward any previously-saved values.

- [ ] **Step 2: Run the full test suite to confirm no regressions**

Run: `npm test`
Expected: PASS — this file has no dedicated tests of its own (matches its pre-existing convention; the pure logic it delegates to is tested in Task 2).

- [ ] **Step 3: Commit**

```bash
git add server/api/admin/podcasts/search-shows.get.ts
git commit -m "feat: extend search-shows.get.ts to a 3-source merge reading from search_platforms"
```

---

### Task 4: `search-channels.get.ts` — optional YouTube Data API path

**Files:**
- Create: `server/utils/youtubeSearch.ts`
- Test: `tests/unit/youtubeSearch.test.ts`
- Modify: `server/api/admin/downloader/search-channels.get.ts`

**Interfaces:**
- Produces: `interface ChannelCandidate { id: string; title: string; description: string; avatarUrl: string; subscriberCount: string; videoCount: string; handle: string }`, `normalizeYoutubeDataApiChannel(raw: any): ChannelCandidate | null`.
- Consumes (in `search-channels.get.ts`): `search_platforms` table (Task 1, row `youtube_data_api`).

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/youtubeSearch.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { normalizeYoutubeDataApiChannel } from '../../server/utils/youtubeSearch';

describe('normalizeYoutubeDataApiChannel', () => {
  it('maps a YouTube Data API search result to a ChannelCandidate, preferring id.channelId', () => {
    const result = normalizeYoutubeDataApiChannel({
      id: { kind: 'youtube#channel', channelId: 'UCXXXXXX' },
      snippet: {
        channelId: 'UCXXXXXX',
        title: 'Stromae',
        description: 'Official channel',
        thumbnails: { default: { url: 'https://example.com/thumb.jpg' } }
      }
    });
    expect(result).toEqual({
      id: 'UCXXXXXX',
      title: 'Stromae',
      description: 'Official channel',
      avatarUrl: 'https://example.com/thumb.jpg',
      subscriberCount: '',
      videoCount: '',
      handle: ''
    });
  });

  it('falls back to snippet.channelId when id.channelId is missing', () => {
    const result = normalizeYoutubeDataApiChannel({
      snippet: { channelId: 'UCYYYYYY', title: 'Fallback Channel' }
    });
    expect(result?.id).toBe('UCYYYYYY');
  });

  it('returns null when neither id.channelId nor snippet.channelId is present', () => {
    expect(normalizeYoutubeDataApiChannel({ snippet: { title: 'No ID' } })).toBeNull();
    expect(normalizeYoutubeDataApiChannel({})).toBeNull();
  });

  it('falls back to "Sans nom" for a missing title, and empty strings for description/avatarUrl when missing', () => {
    const result = normalizeYoutubeDataApiChannel({ id: { channelId: 'UCZZZZZZ' } });
    expect(result?.title).toBe('Sans nom');
    expect(result?.description).toBe('');
    expect(result?.avatarUrl).toBe('');
  });

  it('always returns empty strings for subscriberCount/videoCount/handle (not provided by this API endpoint)', () => {
    const result = normalizeYoutubeDataApiChannel({ id: { channelId: 'UCAAAAAA' }, snippet: { title: 'X' } });
    expect(result?.subscriberCount).toBe('');
    expect(result?.videoCount).toBe('');
    expect(result?.handle).toBe('');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- youtubeSearch`
Expected: FAIL — `Cannot find module '../../server/utils/youtubeSearch'`

- [ ] **Step 3: Write the implementation**

Create `server/utils/youtubeSearch.ts`:

```typescript
export interface ChannelCandidate {
  id: string;
  title: string;
  description: string;
  avatarUrl: string;
  subscriberCount: string;
  videoCount: string;
  handle: string;
}

export function normalizeYoutubeDataApiChannel(raw: any): ChannelCandidate | null {
  const id = raw?.id?.channelId || raw?.snippet?.channelId || '';
  if (!id) return null;

  return {
    id,
    title: raw.snippet?.title || 'Sans nom',
    description: raw.snippet?.description || '',
    avatarUrl: raw.snippet?.thumbnails?.default?.url || '',
    subscriberCount: '',
    videoCount: '',
    handle: '',
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- youtubeSearch`
Expected: PASS, all tests green.

- [ ] **Step 5: Add the YouTube Data API path to `search-channels.get.ts`**

Replace the entire content of `server/api/admin/downloader/search-channels.get.ts` with:

```typescript
import { defineEventHandler, getQuery, createError } from 'h3';
import { normalizeYoutubeDataApiChannel } from '../../../utils/youtubeSearch';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const query = getQuery(event);
  const q = query.q ? String(query.q).trim() : '';

  if (!q) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Search query is required.'
    });
  }

  const db = getDb();
  const platformRow = db.prepare("SELECT api_key FROM search_platforms WHERE id = 'youtube_data_api'").get() as { api_key: string } | undefined;
  const youtubeApiKey = platformRow?.api_key || '';

  if (youtubeApiKey) {
    try {
      const data = await globalThis.$fetch<any>('https://www.googleapis.com/youtube/v3/search', {
        params: { part: 'snippet', type: 'channel', q, key: youtubeApiKey, maxResults: 25 },
        parseResponse: JSON.parse,
        timeout: 8000,
      });
      const items = Array.isArray(data?.items) ? data.items : [];
      const channels = items
        .map(normalizeYoutubeDataApiChannel)
        .filter((c: any): c is NonNullable<typeof c> => c !== null);
      return { channels };
    } catch (err) {
      console.error('[admin/downloader/search-channels] YouTube Data API failed, falling back to scraping', err);
    }
  }

  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&sp=EgIQAg%253D%253D`;

  try {
    const response = await globalThis.$fetch<string>(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7'
      }
    });

    const match = response.match(/var ytInitialData = ({.*?});/s) || response.match(/window\["ytInitialData"\] = ({.*?});/s);
    if (!match || !match[1]) {
      return { channels: [] };
    }

    const data = JSON.parse(match[1]);
    const contents = data.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents;
    if (!contents || !Array.isArray(contents)) {
      return { channels: [] };
    }

    const channels: any[] = [];
    for (const item of contents) {
      if (item.channelRenderer) {
        const cr = item.channelRenderer;

        let avatarUrl = cr.thumbnail?.thumbnails?.[cr.thumbnail.thumbnails.length - 1]?.url || cr.thumbnail?.thumbnails?.[0]?.url;
        if (avatarUrl && avatarUrl.startsWith('//')) {
          avatarUrl = 'https:' + avatarUrl;
        }

        channels.push({
          id: cr.channelId,
          title: cr.title?.simpleText || cr.title?.runs?.[0]?.text || 'Sans nom',
          description: cr.descriptionSnippet?.runs?.[0]?.text || '',
          avatarUrl,
          subscriberCount: cr.subscriberCountText?.simpleText || cr.subscriberCountText?.runs?.[0]?.text || '',
          videoCount: cr.videoCountText?.simpleText || cr.videoCountText?.runs?.[0]?.text || '',
          handle: cr.canonicalBaseUrl || ''
        });
      }
    }

    return { channels };
  } catch (err: any) {
    console.error('[admin/downloader/search-channels]', err);
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to search YouTube channels. Check the server logs for details.'
    });
  }
});
```

The scraping code below the YouTube Data API block is byte-for-byte identical to the pre-existing file — only reformatted whitespace inside the loop was normalized, no logic changed. This preserves the existing fallback behavior and its existing (unrelated to this plan) 500-on-scrape-failure behavior exactly.

- [ ] **Step 6: Run the full test suite to confirm no regressions**

Run: `npm test`
Expected: PASS — no dedicated test for the endpoint itself (matches its pre-existing, and `search-shows.get.ts`'s, established convention).

- [ ] **Step 7: Commit**

```bash
git add server/utils/youtubeSearch.ts tests/unit/youtubeSearch.test.ts server/api/admin/downloader/search-channels.get.ts
git commit -m "feat: add optional YouTube Data API path to search-channels.get.ts"
```

---

### Task 5: Settings UI — Search Platforms panel, retire the old PodcastIndex form

**Files:**
- Modify: `app/components/settings/SettingsSystemTab.vue`
- Modify: `app/components/settings/SettingsPodcastsTab.vue`
- Delete: `server/api/admin/podcasts/podcastindex-credentials.get.ts`
- Delete: `server/api/admin/podcasts/podcastindex-credentials.post.ts`

**Interfaces:**
- Consumes: `GET`/`POST /api/admin/system/search-platforms` (Task 1).

- [ ] **Step 1: Add the Search Platforms panel to `SettingsSystemTab.vue`**

In `app/components/settings/SettingsSystemTab.vue`, find the end of the Danger Zone panel — its closing tags look like:

```html
          <button
            @click="handleStartWipe"
            class="btn btn-danger mt-3"
            :disabled="wipeConfirmText !== 'SUPPRIMER' || startingWipe"
          >
            {{ startingWipe ? 'Starting...' : 'Wipe everything' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
```

Insert a new panel between the Danger Zone panel's closing `</div>` (the one that closes `class="config-section glass-panel danger-zone-panel"`) and the `</div>` that closes `system-dashboard-layout`, so the end of the file's template reads:

```html
          <button
            @click="handleStartWipe"
            class="btn btn-danger mt-3"
            :disabled="wipeConfirmText !== 'SUPPRIMER' || startingWipe"
          >
            {{ startingWipe ? 'Starting...' : 'Wipe everything' }}
          </button>
        </div>
      </div>

      <div class="config-section glass-panel">
        <div class="section-title-row">
          <div class="icon-orb bg-pink">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          </div>
          <div>
            <h3>Search Platforms</h3>
            <p class="section-desc">Optional API keys that improve admin ingest-search results for podcasts and YouTube channels.</p>
          </div>
        </div>

        <div v-for="platform in searchPlatforms" :key="platform.id" class="mt-3 pt-3 border-t">
          <h4 class="results-header">{{ platformLabels[platform.id] }}</h4>
          <form @submit.prevent="handleSaveSearchPlatform(platform.id)" class="ingest-form mt-2">
            <div class="search-input-wrapper">
              <input
                type="text"
                v-model="platform.apiKey"
                placeholder="API Key"
                class="form-input settings-search-input"
                :disabled="savingPlatformId === platform.id"
              />
            </div>
            <div class="search-input-wrapper" v-if="platform.id === 'podcastindex'">
              <input
                type="password"
                v-model="platform.apiSecret"
                placeholder="API Secret"
                class="form-input settings-search-input"
                :disabled="savingPlatformId === platform.id"
              />
            </div>
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

- [ ] **Step 2: Add the Search Platforms state and handlers to the script**

In the same file's `<script setup>`, change the import line:

```typescript
import { ref, watch, onUnmounted } from 'vue';
```

to:

```typescript
import { ref, watch, onUnmounted, onMounted } from 'vue';
```

Then, at the end of the script (after the existing `formatBytes` function, before the closing `</script>`), add:

```typescript
const searchPlatforms = ref<{ id: string; apiKey: string; apiSecret: string }[]>([]);
const savingPlatformId = ref<string | null>(null);
const platformLabels: Record<string, string> = {
  podcastindex: 'PodcastIndex',
  listennotes: 'Listen Notes',
  youtube_data_api: 'YouTube Data API'
};

const fetchSearchPlatforms = async () => {
  try {
    const data = await $fetch<any>('/api/admin/system/search-platforms');
    searchPlatforms.value = data.platforms || [];
  } catch (err) {
    console.error('Failed to fetch search platforms:', err);
  }
};

const handleSaveSearchPlatform = async (id: string) => {
  const platform = searchPlatforms.value.find((p) => p.id === id);
  if (!platform) return;

  savingPlatformId.value = id;
  try {
    await $fetch('/api/admin/system/search-platforms', {
      method: 'POST',
      body: { id: platform.id, apiKey: platform.apiKey, apiSecret: platform.apiSecret }
    });
    toast.success(`${platformLabels[id]} credentials saved.`);
  } catch (err: any) {
    toast.error(err.data?.statusMessage || `Failed to save ${platformLabels[id]} credentials.`);
  } finally {
    savingPlatformId.value = null;
  }
};

onMounted(() => {
  fetchSearchPlatforms();
});
```

- [ ] **Step 3: Remove the PodcastIndex credentials form from `SettingsPodcastsTab.vue`**

In `app/components/settings/SettingsPodcastsTab.vue`, delete this entire `<div>` block from the template (it's the ingest-box immediately after "Followed Podcasts", right before the `<!-- Right Side: Queue -->` comment):

```html
        <div class="ingest-box glass-panel mt-4">
          <div class="section-title-row">
            <div class="icon-orb bg-blue">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
            </div>
            <div>
              <h3>PodcastIndex API (optional)</h3>
              <p class="section-desc">Improves search coverage for independent/less mainstream podcasts. Free key at podcastindex.org.</p>
            </div>
          </div>

          <form @submit.prevent="handleSavePodcastIndexCredentials" class="ingest-form mt-3">
            <div class="search-input-wrapper">
              <input
                type="text"
                v-model="podcastIndexApiKey"
                placeholder="API Key"
                class="form-input settings-search-input"
                :disabled="savingPodcastIndexCredentials"
              />
            </div>
            <div class="search-input-wrapper">
              <input
                type="password"
                v-model="podcastIndexApiSecret"
                placeholder="API Secret"
                class="form-input settings-search-input"
                :disabled="savingPodcastIndexCredentials"
              />
            </div>
            <button type="submit" class="btn btn-secondary-dark" :disabled="savingPodcastIndexCredentials">
              {{ savingPodcastIndexCredentials ? 'Saving...' : 'Save' }}
            </button>
          </form>
        </div>
```

- [ ] **Step 4: Remove the now-unused script code from `SettingsPodcastsTab.vue`**

Delete these 3 blocks from the `<script setup>`:

```typescript
const podcastIndexApiKey = ref('');
const podcastIndexApiSecret = ref('');
const savingPodcastIndexCredentials = ref(false);

const fetchPodcastIndexCredentials = async () => {
  try {
    const data = await $fetch<any>('/api/admin/podcasts/podcastindex-credentials');
    podcastIndexApiKey.value = data.apiKey || '';
    podcastIndexApiSecret.value = data.apiSecret || '';
  } catch (err) {
    console.error('Failed to fetch PodcastIndex credentials:', err);
  }
};

const handleSavePodcastIndexCredentials = async () => {
  savingPodcastIndexCredentials.value = true;
  try {
    await $fetch('/api/admin/podcasts/podcastindex-credentials', {
      method: 'POST',
      body: {
        apiKey: podcastIndexApiKey.value,
        apiSecret: podcastIndexApiSecret.value
      }
    });
    toast.success('PodcastIndex credentials saved.');
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Failed to save PodcastIndex credentials.');
  } finally {
    savingPodcastIndexCredentials.value = false;
  }
};
```

And remove the call to it in `onMounted`, changing:

```typescript
onMounted(() => {
  fetchPodcastConcurrency();
  fetchPodcastSchedule();
  fetchPodcastIndexCredentials();
});
```

to:

```typescript
onMounted(() => {
  fetchPodcastConcurrency();
  fetchPodcastSchedule();
});
```

The podcast search box itself (`podcastShowSearchInput`, `handleSearchPodcastShow`, `selectPodcastShowCandidate`, the results grid) is untouched — only the credentials form and its dedicated state/handlers are removed.

- [ ] **Step 5: Delete the now-unused PodcastIndex credentials routes**

```bash
rm server/api/admin/podcasts/podcastindex-credentials.get.ts
rm server/api/admin/podcasts/podcastindex-credentials.post.ts
```

Nothing calls these anymore: Task 3 moved `search-shows.get.ts` off the old settings keys onto `search_platforms`, and Step 3/4 of this task just removed their only frontend caller.

- [ ] **Step 6: Run the full test suite to confirm no regressions**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Run a full build to catch any template/script mistakes**

Run: `npx nuxt build`
Expected: builds cleanly with no errors.

- [ ] **Step 8: Commit**

```bash
git add app/components/settings/SettingsSystemTab.vue app/components/settings/SettingsPodcastsTab.vue
git rm server/api/admin/podcasts/podcastindex-credentials.get.ts server/api/admin/podcasts/podcastindex-credentials.post.ts
git commit -m "feat: add Search Platforms panel to Settings, retire the Podcasts-tab PodcastIndex form"
```

---

### Task 6: Manual end-to-end verification

No code changes — this task is a live verification pass, matching this codebase's established convention (and this exact sub-project's own history: the prior Admin Ingest Search sub-project found 2 real bugs in exactly this way, both response-shape assumptions that looked correct on paper).

**Files:** none.

- [ ] **Step 1: Verify the PodcastIndex migration**

Using the dev-login fixture (`ALLOW_DEV_LOGIN=1 npm run dev`, `POST /api/dev/login`), if the dev database already has a saved PodcastIndex key/secret from the prior sub-project's testing, confirm `GET /api/admin/system/search-platforms` returns it under the `podcastindex` entry (migrated forward, not lost). If the dev database has no prior PodcastIndex value, confirm the `podcastindex` row still comes back with empty strings (no crash, no missing row).

- [ ] **Step 2: Verify the Search Platforms panel end-to-end**

In Settings → System, confirm the new panel renders all 3 platforms, saving a test value for each round-trips correctly (reload the page, confirm the saved value is pre-filled) — mirroring the same round-trip check the prior sub-project did for the single PodcastIndex form. Reset any test values back to empty afterward.

- [ ] **Step 3: Verify podcast search still returns correct results with only iTunes configured (no keys)**

`curl` (or browser) `GET /api/admin/podcasts/search-shows?q=Planet+Money` with no PodcastIndex/Listen Notes keys configured — confirm real iTunes results still come back (regression check against the fix from the prior sub-project — this task's rewrite of the file must not reintroduce the iTunes `Content-Type` parsing bug or lose the `parseResponse: JSON.parse` fix).

- [ ] **Step 4: If a real Listen Notes API key is available, verify it live**

Configure a real Listen Notes key via the new panel, search for a real show, and confirm real Listen Notes results are actually returned and correctly normalized (title/author/description/artworkUrl/feedUrl all populated, not silently empty) — this is the exact class of bug (an assumed external response shape that's actually wrong) that bit the iTunes integration in the prior sub-project. If no real key is available in this environment, explicitly note this as a known, undocumented-until-now residual limitation (same as the already-documented PodcastIndex-success-path gap) rather than silently skipping it.

- [ ] **Step 5: If a real YouTube Data API key is available, verify it live**

Configure a real YouTube Data API key via the new panel, search for a well-known channel by name via `GET /api/admin/downloader/search-channels?q=<name>`, and confirm real API results come back in the correct `{channels:[...]}` shape (not scraped results — check the response looks like the API path, e.g. real `id`/`title`/`avatarUrl` populated, `subscriberCount`/`videoCount`/`handle` empty as expected) — again, confirm `id.channelId` vs `snippet.channelId` in the real response to settle which the mapping function's preference should have been. If no real key is available, note as a residual limitation, same as Step 4.

- [ ] **Step 6: Verify the scraping fallback still works unmodified**

With the `youtube_data_api` row's key left empty, confirm `GET /api/admin/downloader/search-channels?q=<name>` still returns real scraped results exactly as before this plan (regression check — the fallback path must be byte-identical in behavior to the pre-existing, already-shipped scraping code).

- [ ] **Step 7: Run the full test suite one final time**

Run: `npm test`
Expected: PASS, no regressions across the whole suite.
