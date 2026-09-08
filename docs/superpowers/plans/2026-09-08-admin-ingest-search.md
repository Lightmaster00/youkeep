# Admin Ingest Search (Music & Podcasts) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin search for a music artist (by name, via YouTube) or a podcast show (by name, via iTunes Search + PodcastIndex.org merged) instead of pasting an exact channel URL/handle or RSS feed URL, mirroring the search-then-pick flow the video channel tracker already has.

**Architecture:** Music search reuses the existing `GET /api/admin/downloader/search-channels` endpoint unchanged. Podcast search adds a new pure-logic module (`server/utils/podcastSearch.ts`) for normalizing/merging/signing, a new endpoint (`server/api/admin/podcasts/search-shows.get.ts`) that calls iTunes Search and PodcastIndex.org in parallel and merges results (iTunes wins on a feed-URL duplicate), and two new admin settings for optional PodcastIndex credentials. Both Settings tabs (Music, Podcasts) gain a search box + results grid; clicking "Suivre" fills the existing manual-entry field rather than auto-submitting.

**Tech Stack:** Nuxt 4, Nitro server routes, better-sqlite3, Vue 3 `<script setup>`, Vitest.

## Global Constraints

- No change to the existing video channel search/ingest flow.
- No unified cross-media-type search UI — each tab (Music, Podcasts) keeps its own independent search box.
- Only iTunes Search + PodcastIndex.org as podcast directory sources — no Listen Notes or others.
- No "already followed" detection/flagging in search results (matches existing video search behavior — no regression, no new capability expected).
- No pagination of search results.
- The existing manual raw-URL/raw-feed-URL entry paths in both Music and Podcasts tabs must remain fully functional and untouched — search is purely additive.
- Music search reuses `GET /api/admin/downloader/search-channels` UNCHANGED — no backend changes for music.
- Podcast search: iTunes results always take priority over PodcastIndex on a feed-URL duplicate (case/trailing-slash-insensitive match).
- PodcastIndex requests need `X-Auth-Date`/`X-Auth-Key`/`Authorization` (`sha1(apiKey+apiSecret+timestamp)`)/`User-Agent` (`'YouKeep/1.0'`) headers; if `podcastindex_api_key`/`podcastindex_api_secret` aren't both configured, skip PodcastIndex silently (no error).
- Any search failure (either source down, or an unexpected exception) must return `{ shows: [] }` / normal empty-result shape, never a 500 — search is a discovery aid, never a hard dependency (manual feed-URL entry always remains available).
- New pure logic (result normalization, merge/dedup, PodcastIndex signature calc) gets real unit tests; no test coverage needed for the outbound HTTP calls themselves or for the existing unchanged `search-channels.get.ts`.

## File Structure

- Create: `server/utils/podcastSearch.ts` — pure functions: normalize an iTunes result, normalize a PodcastIndex result, merge/dedup two candidate lists, compute PodcastIndex auth headers. No I/O.
- Create: `tests/unit/podcastSearch.test.ts` — unit tests for the above.
- Create: `server/api/admin/podcasts/search-shows.get.ts` — the search endpoint; does the actual outbound HTTP calls, delegates pure logic to `podcastSearch.ts`.
- Create: `server/api/admin/podcasts/podcastindex-credentials.get.ts` / `.post.ts` — read/write the two new settings.
- Modify: `server/utils/db.ts` — seed `podcastindex_api_key` / `podcastindex_api_secret` settings rows (both default `''`).
- Modify: `app/components/settings/SettingsMusicTab.vue` — add a search box + results grid, reusing the existing search-channels endpoint.
- Modify: `app/components/settings/SettingsPodcastsTab.vue` — add a search box + results grid (new endpoint) and a small PodcastIndex credentials form.

---

### Task 1: Podcast search pure logic + unit tests

**Files:**
- Create: `server/utils/podcastSearch.ts`
- Test: `tests/unit/podcastSearch.test.ts`

**Interfaces:**
- Produces: `interface ShowCandidate { title: string; author: string; description: string; artworkUrl: string; feedUrl: string }`, `normalizeItunesResult(raw: any): ShowCandidate | null`, `normalizePodcastIndexResult(raw: any): ShowCandidate | null`, `mergeShowCandidates(itunesResults: ShowCandidate[], podcastIndexResults: ShowCandidate[]): ShowCandidate[]`, `computePodcastIndexAuthHeaders(apiKey: string, apiSecret: string, unixTimestamp: number): Record<string, string>` — all consumed by Task 3.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/podcastSearch.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import {
  normalizeItunesResult,
  normalizePodcastIndexResult,
  mergeShowCandidates,
  computePodcastIndexAuthHeaders,
} from '../../server/utils/podcastSearch';

describe('normalizeItunesResult', () => {
  it('maps an iTunes podcast result to a ShowCandidate', () => {
    const result = normalizeItunesResult({
      collectionName: 'Planet Money',
      artistName: 'NPR',
      artworkUrl600: 'https://example.com/art.jpg',
      feedUrl: 'https://feeds.npr.org/510289/podcast.xml',
    });
    expect(result).toEqual({
      title: 'Planet Money',
      author: 'NPR',
      description: '',
      artworkUrl: 'https://example.com/art.jpg',
      feedUrl: 'https://feeds.npr.org/510289/podcast.xml',
    });
  });

  it('returns null when feedUrl is missing or empty', () => {
    expect(normalizeItunesResult({ collectionName: 'No Feed' })).toBeNull();
    expect(normalizeItunesResult({ collectionName: 'Empty Feed', feedUrl: '   ' })).toBeNull();
  });

  it('falls back to trackName when collectionName is missing, and empty author when artistName is missing', () => {
    const result = normalizeItunesResult({ trackName: 'Fallback Title', feedUrl: 'https://a.com/feed.xml' });
    expect(result?.title).toBe('Fallback Title');
    expect(result?.author).toBe('');
  });

  it('falls back to "Sans nom" when no title field is present at all', () => {
    const result = normalizeItunesResult({ feedUrl: 'https://a.com/feed.xml' });
    expect(result?.title).toBe('Sans nom');
  });

  it('falls back to artworkUrl100 when artworkUrl600 is missing', () => {
    const result = normalizeItunesResult({ feedUrl: 'https://a.com/feed.xml', artworkUrl100: 'https://a.com/small.jpg' });
    expect(result?.artworkUrl).toBe('https://a.com/small.jpg');
  });
});

describe('normalizePodcastIndexResult', () => {
  it('maps a PodcastIndex feed result to a ShowCandidate', () => {
    const result = normalizePodcastIndexResult({
      title: 'Planet Money',
      author: 'NPR',
      description: 'The economy explained.',
      image: 'https://example.com/art2.jpg',
      url: 'https://feeds.npr.org/510289/podcast.xml',
    });
    expect(result).toEqual({
      title: 'Planet Money',
      author: 'NPR',
      description: 'The economy explained.',
      artworkUrl: 'https://example.com/art2.jpg',
      feedUrl: 'https://feeds.npr.org/510289/podcast.xml',
    });
  });

  it('returns null when url is missing or empty', () => {
    expect(normalizePodcastIndexResult({ title: 'No Feed' })).toBeNull();
    expect(normalizePodcastIndexResult({ title: 'Empty Feed', url: '  ' })).toBeNull();
  });

  it('falls back to the artwork field when image is missing, and empty author/description when missing', () => {
    const result = normalizePodcastIndexResult({ artwork: 'https://example.com/fallback.jpg', url: 'https://a.com/feed.xml' });
    expect(result?.artworkUrl).toBe('https://example.com/fallback.jpg');
    expect(result?.author).toBe('');
    expect(result?.description).toBe('');
  });

  it('falls back to "Sans nom" when no title field is present at all', () => {
    const result = normalizePodcastIndexResult({ url: 'https://a.com/feed.xml' });
    expect(result?.title).toBe('Sans nom');
  });
});

describe('mergeShowCandidates', () => {
  const itunesShow = {
    title: 'Planet Money (iTunes)',
    author: 'NPR',
    description: '',
    artworkUrl: 'https://itunes.example.com/art.jpg',
    feedUrl: 'https://feeds.npr.org/510289/podcast.xml',
  };
  const podcastIndexDuplicate = {
    title: 'Planet Money (PodcastIndex)',
    author: 'NPR',
    description: 'The economy explained.',
    artworkUrl: 'https://podcastindex.example.com/art.jpg',
    feedUrl: 'https://feeds.npr.org/510289/podcast.xml/',
  };
  const podcastIndexUnique = {
    title: 'Indie Show',
    author: 'Someone',
    description: 'An indie podcast.',
    artworkUrl: 'https://podcastindex.example.com/indie.jpg',
    feedUrl: 'https://example.com/indie-feed.xml',
  };

  it('keeps the iTunes version when the same feed URL is on both sources', () => {
    const result = mergeShowCandidates([itunesShow], [podcastIndexDuplicate]);
    expect(result).toEqual([itunesShow]);
  });

  it('is case- and trailing-slash-insensitive when matching feed URLs', () => {
    const itunesUpper = { ...itunesShow, feedUrl: 'HTTPS://FEEDS.NPR.ORG/510289/PODCAST.XML' };
    const result = mergeShowCandidates([itunesUpper], [podcastIndexDuplicate]);
    expect(result).toEqual([itunesUpper]);
  });

  it('includes a PodcastIndex-only show not present in iTunes results', () => {
    const result = mergeShowCandidates([itunesShow], [podcastIndexUnique]);
    expect(result).toEqual([itunesShow, podcastIndexUnique]);
  });

  it('returns an empty array when both sources are empty', () => {
    expect(mergeShowCandidates([], [])).toEqual([]);
  });

  it('returns iTunes-only results unchanged when PodcastIndex has nothing', () => {
    expect(mergeShowCandidates([itunesShow], [])).toEqual([itunesShow]);
  });

  it('returns PodcastIndex-only results unchanged when iTunes has nothing', () => {
    expect(mergeShowCandidates([], [podcastIndexUnique])).toEqual([podcastIndexUnique]);
  });
});

describe('computePodcastIndexAuthHeaders', () => {
  it('computes the sha1(apiKey + apiSecret + timestamp) Authorization header', () => {
    const apiKey = 'MYKEY123';
    const apiSecret = 'MYSECRET456';
    const timestamp = 1700000000;
    const expectedHash = crypto.createHash('sha1').update(apiKey + apiSecret + timestamp).digest('hex');

    const headers = computePodcastIndexAuthHeaders(apiKey, apiSecret, timestamp);

    expect(headers).toEqual({
      'X-Auth-Date': String(timestamp),
      'X-Auth-Key': apiKey,
      'Authorization': expectedHash,
      'User-Agent': 'YouKeep/1.0',
    });
  });

  it('produces a different hash for a different timestamp', () => {
    const h1 = computePodcastIndexAuthHeaders('k', 's', 1700000000);
    const h2 = computePodcastIndexAuthHeaders('k', 's', 1700000001);
    expect(h1['Authorization']).not.toBe(h2['Authorization']);
  });

  it('produces a different hash for a different apiKey/apiSecret', () => {
    const h1 = computePodcastIndexAuthHeaders('k1', 's', 1700000000);
    const h2 = computePodcastIndexAuthHeaders('k2', 's', 1700000000);
    expect(h1['Authorization']).not.toBe(h2['Authorization']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- podcastSearch`
Expected: FAIL — `Cannot find module '../../server/utils/podcastSearch'`

- [ ] **Step 3: Write the implementation**

Create `server/utils/podcastSearch.ts`:

```typescript
import crypto from 'crypto';

export interface ShowCandidate {
  title: string;
  author: string;
  description: string;
  artworkUrl: string;
  feedUrl: string;
}

export function normalizeItunesResult(raw: any): ShowCandidate | null {
  const feedUrl = typeof raw?.feedUrl === 'string' ? raw.feedUrl.trim() : '';
  if (!feedUrl) return null;

  return {
    title: raw.collectionName || raw.trackName || 'Sans nom',
    author: raw.artistName || '',
    description: '',
    artworkUrl: raw.artworkUrl600 || raw.artworkUrl100 || '',
    feedUrl,
  };
}

export function normalizePodcastIndexResult(raw: any): ShowCandidate | null {
  const feedUrl = typeof raw?.url === 'string' ? raw.url.trim() : '';
  if (!feedUrl) return null;

  return {
    title: raw.title || 'Sans nom',
    author: raw.author || '',
    description: raw.description || '',
    artworkUrl: raw.image || raw.artwork || '',
    feedUrl,
  };
}

function normalizeFeedUrlKey(feedUrl: string): string {
  return feedUrl.trim().toLowerCase().replace(/\/+$/, '');
}

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

export function computePodcastIndexAuthHeaders(apiKey: string, apiSecret: string, unixTimestamp: number): Record<string, string> {
  const hash = crypto.createHash('sha1').update(apiKey + apiSecret + unixTimestamp).digest('hex');
  return {
    'X-Auth-Date': String(unixTimestamp),
    'X-Auth-Key': apiKey,
    'Authorization': hash,
    'User-Agent': 'YouKeep/1.0',
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- podcastSearch`
Expected: PASS, all tests green

- [ ] **Step 5: Commit**

```bash
git add server/utils/podcastSearch.ts tests/unit/podcastSearch.test.ts
git commit -m "feat: add podcast search normalization/merge/auth pure logic"
```

---

### Task 2: PodcastIndex credentials settings

**Files:**
- Modify: `server/utils/db.ts` (seed two new settings rows, near the existing `default_downloads_dir` seeding block)
- Create: `server/api/admin/podcasts/podcastindex-credentials.get.ts`
- Create: `server/api/admin/podcasts/podcastindex-credentials.post.ts`

**Interfaces:**
- Produces: `GET /api/admin/podcasts/podcastindex-credentials` → `{ apiKey: string, apiSecret: string }`; `POST /api/admin/podcasts/podcastindex-credentials` with body `{ apiKey: string, apiSecret: string }` → `{ success: true }`. Consumed by Task 3 (endpoint reads the settings directly via `getDb()`, not via these routes) and Task 5 (UI).

- [ ] **Step 1: Add settings seeding**

In `server/utils/db.ts`, find this existing block (seeds `default_downloads_dir`):

```typescript
  const defaultDirCheck = db.prepare("SELECT COUNT(*) as count FROM settings WHERE key = 'default_downloads_dir'").get() as { count: number };
  if (defaultDirCheck.count === 0) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('default_downloads_dir', '')").run();
    console.log('Seeded setting default_downloads_dir: empty');
  }
```

Immediately after it, add:

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

- [ ] **Step 2: Create the GET route**

Create `server/api/admin/podcasts/podcastindex-credentials.get.ts`:

```typescript
import { defineEventHandler } from 'h3';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const db = getDb();

  const keyRow = db.prepare("SELECT value FROM settings WHERE key = 'podcastindex_api_key'").get() as { value: string } | undefined;
  const secretRow = db.prepare("SELECT value FROM settings WHERE key = 'podcastindex_api_secret'").get() as { value: string } | undefined;

  return {
    apiKey: keyRow?.value || '',
    apiSecret: secretRow?.value || ''
  };
});
```

- [ ] **Step 3: Create the POST route**

Create `server/api/admin/podcasts/podcastindex-credentials.post.ts`:

```typescript
import { defineEventHandler, readBody } from 'h3';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const body = await readBody(event);
  const apiKey = typeof body?.apiKey === 'string' ? body.apiKey.trim() : '';
  const apiSecret = typeof body?.apiSecret === 'string' ? body.apiSecret.trim() : '';

  const db = getDb();
  db.prepare("UPDATE settings SET value = ? WHERE key = 'podcastindex_api_key'").run(apiKey);
  db.prepare("UPDATE settings SET value = ? WHERE key = 'podcastindex_api_secret'").run(apiSecret);

  return { success: true };
});
```

- [ ] **Step 4: Verify the dev DB seeds the new settings**

Run: `npm test`
Expected: PASS (423+ tests, no regressions — this step doesn't add tests since it's a settings-plumbing mirror of an already-established, untested pattern, matching `default-dir.get.ts`/`default-dir.post.ts`'s own lack of dedicated tests)

- [ ] **Step 5: Commit**

```bash
git add server/utils/db.ts server/api/admin/podcasts/podcastindex-credentials.get.ts server/api/admin/podcasts/podcastindex-credentials.post.ts
git commit -m "feat: add podcastindex_api_key/secret settings and admin routes"
```

---

### Task 3: Podcast search endpoint

**Files:**
- Create: `server/api/admin/podcasts/search-shows.get.ts`

**Interfaces:**
- Consumes: `normalizeItunesResult`, `normalizePodcastIndexResult`, `mergeShowCandidates`, `computePodcastIndexAuthHeaders` from `server/utils/podcastSearch.ts` (Task 1); reads `podcastindex_api_key`/`podcastindex_api_secret` settings directly via `getDb()` (seeded by Task 2).
- Produces: `GET /api/admin/podcasts/search-shows?q=<term>` → `{ shows: ShowCandidate[] }`, consumed by Task 5 (Podcasts tab UI).

- [ ] **Step 1: Write the implementation**

Create `server/api/admin/podcasts/search-shows.get.ts`:

```typescript
import { defineEventHandler, getQuery, createError } from 'h3';
import {
  normalizeItunesResult,
  normalizePodcastIndexResult,
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
    const keyRow = db.prepare("SELECT value FROM settings WHERE key = 'podcastindex_api_key'").get() as { value: string } | undefined;
    const secretRow = db.prepare("SELECT value FROM settings WHERE key = 'podcastindex_api_secret'").get() as { value: string } | undefined;
    const apiKey = keyRow?.value || '';
    const apiSecret = secretRow?.value || '';

    const fetchItunes = async (): Promise<any[]> => {
      const data = await globalThis.$fetch<any>('https://itunes.apple.com/search', {
        params: { media: 'podcast', term: q, limit: 25 }
      });
      return Array.isArray(data?.results) ? data.results : [];
    };

    const fetchPodcastIndex = async (): Promise<any[]> => {
      if (!apiKey || !apiSecret) return [];
      const unixTimestamp = Math.floor(Date.now() / 1000);
      const headers = computePodcastIndexAuthHeaders(apiKey, apiSecret, unixTimestamp);
      const data = await globalThis.$fetch<any>('https://api.podcastindex.org/api/1.0/search/byterm', {
        params: { q },
        headers
      });
      return Array.isArray(data?.feeds) ? data.feeds : [];
    };

    const [itunesResult, podcastIndexResult] = await Promise.allSettled([fetchItunes(), fetchPodcastIndex()]);

    if (itunesResult.status === 'rejected') {
      console.error('[admin/podcasts/search-shows] iTunes fetch failed', itunesResult.reason);
    }
    if (podcastIndexResult.status === 'rejected') {
      console.error('[admin/podcasts/search-shows] PodcastIndex fetch failed', podcastIndexResult.reason);
    }

    const itunesRaw = itunesResult.status === 'fulfilled' ? itunesResult.value : [];
    const podcastIndexRaw = podcastIndexResult.status === 'fulfilled' ? podcastIndexResult.value : [];

    const itunesCandidates = itunesRaw
      .map(normalizeItunesResult)
      .filter((c: any): c is NonNullable<typeof c> => c !== null);
    const podcastIndexCandidates = podcastIndexRaw
      .map(normalizePodcastIndexResult)
      .filter((c: any): c is NonNullable<typeof c> => c !== null);

    return { shows: mergeShowCandidates(itunesCandidates, podcastIndexCandidates) };
  } catch (err) {
    console.error('[admin/podcasts/search-shows]', err);
    return { shows: [] };
  }
});
```

- [ ] **Step 2: Run the full test suite to confirm no regressions**

Run: `npm test`
Expected: PASS — this file has no dedicated tests of its own (matches `search-channels.get.ts`'s established convention: the outbound-HTTP-calling endpoint itself is untested, only the pure logic it delegates to is tested, per Task 1)

- [ ] **Step 3: Commit**

```bash
git add server/api/admin/podcasts/search-shows.get.ts
git commit -m "feat: add GET /api/admin/podcasts/search-shows (iTunes + PodcastIndex)"
```

---

### Task 4: Music tab search UI

**Files:**
- Modify: `app/components/settings/SettingsMusicTab.vue`

**Interfaces:**
- Consumes: existing `GET /api/admin/downloader/search-channels?q=<term>` → `{ channels: [{ id, title, description, avatarUrl, subscriberCount, videoCount, handle }] }` (unchanged, no backend work in this task).
- Produces: fills the existing `musicArtistInput` ref (defined at `SettingsMusicTab.vue:333`) when a search result is picked — Task 5 does the same shape of change to the Podcasts tab, no shared code between them (each tab keeps its own independent search box, per Global Constraints).

- [ ] **Step 1: Add the search UI to the template**

In `app/components/settings/SettingsMusicTab.vue`, find the "Track a Music Artist" ingest box (starts at line 106: `<div class="ingest-box glass-panel">`). Immediately after its `section-title-row` div (ends at line 115) and before the existing manual-entry `<form @submit.prevent="handleAddMusicArtist" ...>` (line 117), insert:

```html
          <form @submit.prevent="handleSearchMusicArtist" class="ingest-form mt-3">
            <div class="search-input-wrapper">
              <input
                type="text"
                v-model="musicArtistSearchInput"
                placeholder="Artist or channel name (e.g. Stromae, Angèle...)"
                class="form-input settings-search-input"
                required
                :disabled="searchingMusicArtist"
              />
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="search-icon"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
            </div>
            <button type="submit" class="btn btn-primary" :disabled="searchingMusicArtist">
              <span v-if="searchingMusicArtist">Searching...</span>
              <span v-else>Search Artist</span>
            </button>
          </form>

          <div v-if="musicArtistSearchResults.length > 0" class="search-results-list mt-4">
            <h4 class="results-header">Matching Channels :</h4>
            <div class="search-results-grid">
              <div v-for="ch in musicArtistSearchResults" :key="ch.id" class="search-channel-card">
                <img
                  :src="ch.avatarUrl || '/img/default-avatar.png'"
                  class="channel-avatar-thumb"
                  referrerpolicy="no-referrer"
                  @error="($event) => { const target = $event.target as HTMLImageElement; if (target) { target.src = '/img/default-avatar.png'; } }"
                />
                <div class="channel-search-info">
                  <h5>{{ ch.title }}</h5>
                  <p class="channel-search-meta">
                    <span class="subscribers">{{ ch.subscriberCount }} subs</span>
                    <span class="meta-dot">•</span>
                    <span class="videos-count">{{ ch.videoCount }} videos</span>
                  </p>
                  <p class="channel-search-desc" v-if="ch.description">{{ ch.description }}</p>
                </div>
                <button @click="selectMusicArtistCandidate(ch)" class="btn btn-primary btn-xs">
                  Suivre
                </button>
              </div>
            </div>
          </div>

          <p class="section-desc mt-3">Or paste the URL/handle directly:</p>
```

This lands right before the existing `<form @submit.prevent="handleAddMusicArtist" ...>` form, which stays completely unchanged below it.

- [ ] **Step 2: Add the search state and handlers to the script**

In the same file's `<script setup>`, find this line (around line 333):

```typescript
const musicArtistInput = ref('');
```

Immediately after the existing music-artist-form refs block (ends at `const pausingArtistId = ref<string | null>(null);`), add:

```typescript
const musicArtistSearchInput = ref('');
const searchingMusicArtist = ref(false);
const musicArtistSearchResults = ref<any[]>([]);

const handleSearchMusicArtist = async () => {
  const q = musicArtistSearchInput.value.trim();
  if (!q) return;

  searchingMusicArtist.value = true;
  musicArtistSearchResults.value = [];
  try {
    const data = await $fetch<any>('/api/admin/downloader/search-channels', {
      params: { q }
    });
    musicArtistSearchResults.value = data.channels || [];
    if (musicArtistSearchResults.value.length === 0) {
      toast.info('No channels found for this search.');
    }
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Search failed.');
  } finally {
    searchingMusicArtist.value = false;
  }
};

const selectMusicArtistCandidate = (channel: any) => {
  musicArtistInput.value = channel.handle || channel.id || '';
  musicArtistSearchResults.value = [];
};
```

- [ ] **Step 3: Run the full test suite to confirm no regressions**

Run: `npm test`
Expected: PASS — no test file targets this component (matches this codebase's established convention: Vue admin-tab interaction changes of this shape get manual verification, not component tests)

- [ ] **Step 4: Commit**

```bash
git add app/components/settings/SettingsMusicTab.vue
git commit -m "feat: add artist search to the Music settings tab"
```

---

### Task 5: Podcasts tab search UI + PodcastIndex credentials form

**Files:**
- Modify: `app/components/settings/SettingsPodcastsTab.vue`

**Interfaces:**
- Consumes: `GET /api/admin/podcasts/search-shows?q=<term>` → `{ shows: ShowCandidate[] }` (Task 3), `GET`/`POST /api/admin/podcasts/podcastindex-credentials` (Task 2).
- Produces: fills the existing `podcastFeedInput` ref (`SettingsPodcastsTab.vue:262`) when a search result is picked.

- [ ] **Step 1: Add the search UI to the template**

In `app/components/settings/SettingsPodcastsTab.vue`, find the "Track a Podcast" ingest box (starts at line 84). Immediately after its `section-title-row` div (ends at line 93) and before the existing manual-entry `<form @submit.prevent="handleAddPodcastShow" ...>` (line 95), insert:

```html
          <form @submit.prevent="handleSearchPodcastShow" class="ingest-form mt-3">
            <div class="search-input-wrapper">
              <input
                type="text"
                v-model="podcastShowSearchInput"
                placeholder="Podcast show name (e.g. Planet Money...)"
                class="form-input settings-search-input"
                required
                :disabled="searchingPodcastShow"
              />
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="search-icon"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
            </div>
            <button type="submit" class="btn btn-primary" :disabled="searchingPodcastShow">
              <span v-if="searchingPodcastShow">Searching...</span>
              <span v-else>Search Podcast</span>
            </button>
          </form>

          <div v-if="podcastShowSearchResults.length > 0" class="search-results-list mt-4">
            <h4 class="results-header">Matching Podcasts :</h4>
            <div class="search-results-grid">
              <div v-for="s in podcastShowSearchResults" :key="s.feedUrl" class="search-channel-card">
                <img
                  :src="s.artworkUrl || '/img/default-avatar.png'"
                  class="channel-avatar-thumb"
                  referrerpolicy="no-referrer"
                  @error="($event) => { const target = $event.target as HTMLImageElement; if (target) { target.src = '/img/default-avatar.png'; } }"
                />
                <div class="channel-search-info">
                  <h5>{{ s.title }}</h5>
                  <p class="channel-search-meta">
                    <span>{{ s.author }}</span>
                  </p>
                  <p class="channel-search-desc" v-if="s.description">{{ s.description }}</p>
                </div>
                <button @click="selectPodcastShowCandidate(s)" class="btn btn-primary btn-xs">
                  Suivre
                </button>
              </div>
            </div>
          </div>

          <p class="section-desc mt-3">Or paste the RSS feed URL directly:</p>
```

This lands right before the existing `<form @submit.prevent="handleAddPodcastShow" ...>` form, which stays completely unchanged below it.

- [ ] **Step 2: Add the PodcastIndex credentials form**

In the same file's `<template>`, immediately after the closing `</div>` of the "Followed Podcasts" ingest box (the one ending right before `<!-- Right Side: Queue -->`, around line 180), insert a new sibling ingest box inside `downloads-main-col`:

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

- [ ] **Step 3: Add the search + credentials state and handlers to the script**

In the same file's `<script setup>`, find this block (around line 262-269):

```typescript
const podcastFeedInput = ref('');
const podcastShowVisibility = ref('');
const podcastAutoSync = ref(true);
const addingPodcastShow = ref(false);
const podcastIngestMessage = ref('');
const podcastIngestSuccess = ref(false);
const syncingShowId = ref<string | null>(null);
const pausingShowId = ref<string | null>(null);
```

Immediately after it, add:

```typescript
const podcastShowSearchInput = ref('');
const searchingPodcastShow = ref(false);
const podcastShowSearchResults = ref<any[]>([]);

const handleSearchPodcastShow = async () => {
  const q = podcastShowSearchInput.value.trim();
  if (!q) return;

  searchingPodcastShow.value = true;
  podcastShowSearchResults.value = [];
  try {
    const data = await $fetch<any>('/api/admin/podcasts/search-shows', {
      params: { q }
    });
    podcastShowSearchResults.value = data.shows || [];
    if (podcastShowSearchResults.value.length === 0) {
      toast.info('No podcasts found for this search.');
    }
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Search failed.');
  } finally {
    searchingPodcastShow.value = false;
  }
};

const selectPodcastShowCandidate = (show: any) => {
  podcastFeedInput.value = show.feedUrl || '';
  podcastShowSearchResults.value = [];
};

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

- [ ] **Step 4: Fetch credentials on mount**

Find the `onMounted` block at the end of the script:

```typescript
onMounted(() => {
  fetchPodcastConcurrency();
  fetchPodcastSchedule();
});
```

Replace it with:

```typescript
onMounted(() => {
  fetchPodcastConcurrency();
  fetchPodcastSchedule();
  fetchPodcastIndexCredentials();
});
```

- [ ] **Step 5: Run the full test suite to confirm no regressions**

Run: `npm test`
Expected: PASS — no test file targets this component (matches this codebase's established convention)

- [ ] **Step 6: Commit**

```bash
git add app/components/settings/SettingsPodcastsTab.vue
git commit -m "feat: add podcast search + PodcastIndex credentials to the Podcasts settings tab"
```

---

### Task 6: Manual end-to-end verification

No code changes — this task is a live verification pass, matching this codebase's established convention for Vue UI changes with no component-test coverage.

**Files:** none.

- [ ] **Step 1: Verify Music artist search**

Using the dev-login fixture (or a real admin session), open Settings → Music. Search for a well-known artist (e.g. "Stromae"). Confirm: results appear with avatar/title/subscriber/video count; clicking "Suivre" on a candidate fills the "Track a Music Artist" input with a channel handle/id and does NOT auto-submit; the existing "Add Artist" button still works from that filled value.

- [ ] **Step 2: Verify the existing manual music entry path still works**

In the same tab, paste a raw YouTube channel URL directly into "Track a Music Artist" (without using search) and confirm "Add Artist" still works exactly as before this plan's changes.

- [ ] **Step 3: Verify Podcast search (iTunes only, no PodcastIndex key configured)**

With `podcastindex_api_key`/`podcastindex_api_secret` left empty (the default), open Settings → Podcasts, search for a well-known show (e.g. "Planet Money"). Confirm results appear (from iTunes only) with artwork/title/author; clicking "Suivre" fills "Track a Podcast"'s feed URL input and does NOT auto-submit; "Add Podcast" still works from that filled value.

- [ ] **Step 4: Verify PodcastIndex credentials form and merged search**

Enter a real (or intentionally invalid, to test the failure path) PodcastIndex API key/secret pair in the new form, click Save, reload the page, and confirm the fields are pre-filled from the saved settings. Search again for the same show and confirm the search still returns results (either merged with PodcastIndex, or iTunes-only if the credentials are invalid/PodcastIndex is unreachable — no error should be surfaced to the admin either way, per the Global Constraints).

- [ ] **Step 5: Verify the existing manual podcast entry path still works**

Paste a raw RSS feed URL directly into "Track a Podcast" (without using search) and confirm "Add Podcast" still works exactly as before this plan's changes.

- [ ] **Step 6: Run the full test suite one final time**

Run: `npm test`
Expected: PASS, no regressions across the whole suite.
