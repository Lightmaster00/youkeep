# Search UX Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add autocomplete suggestions, matched-term highlighting, and recent search history to YouKeep's header search bar and search result rendering.

**Architecture:** Two new pure/composable frontend units (`app/utils/highlightMatch.ts`, `app/composables/useSearchHistory.ts`, `app/composables/useSearchSuggestions.ts`) feed a dropdown UI added to `app/layouts/default.vue`'s existing search form. Two existing search endpoints gain an optional `limit` query param (additive, non-breaking). `highlightMatch` is wired into 4 existing result-rendering call sites. No new backend endpoints, no schema changes.

**Tech Stack:** Nuxt 4, Vue 3 `<script setup>`, TypeScript, Vitest (`server` project for `tests/unit/`, `component` project via `@nuxt/test-utils` for `tests/component/`), better-sqlite3 FTS5 (unchanged).

## Global Constraints

- Autocomplete: ≥2 characters triggers debounced (250ms) suggestions. `per_space` mode → active space only, limit 5. `global` mode → all 3 types in parallel, limit 3 each. Keyboard nav (ArrowUp/ArrowDown wrapping, Enter selects highlighted or submits raw text if none highlighted, Escape closes without submitting). Clicking/selecting a suggestion fills the bar and calls the existing `handleSearch()` — no per-type navigation logic.
- No new backend endpoints — `GET /api/music/tracks/search` and `GET /api/podcasts/episodes/search` each gain an optional `limit` query param (default unchanged at 200, still capped at 200 max if a caller requests more). `GET /api/videos` already supports `limit`, unchanged.
- `useSearchSuggestions` composable normalizes results into `{ type: 'video'|'track'|'episode', title: string, subtitle: string }`.
- `highlightMatch(text: string, query: string): string` — HTML-escapes `text` first, then case-insensitively wraps the first matching substring in `<mark>...</mark>`; a query with regex-special characters (`.`, `*`, etc.) must match literally, not as a pattern; no match → escaped text unchanged, still safe.
- `highlightMatch` applied at exactly 4 sites: `/music`'s and `/podcasts`' flat result lists, `/search`'s 3 sections, and `VideoCard.vue` via a new optional `searchQuery?: string` prop (default `''` → today's unchanged plain-text rendering), passed from `app/pages/index.vue` only when a search is active.
- `useSearchHistory` composable: `get()`/`add(term)`/`clear()`, backed by one `localStorage` key, deduped, most-recent-first, capped at 8, every method wrapped in try/catch and fails silently to an empty list/no-op on any `localStorage` error.
- `handleSearch()` in `default.vue` calls `add(searchQuery.value)` before navigating, only for a non-empty query.
- The dropdown shows live suggestions when focused with ≥2 characters, shows recent history when focused with an empty input (with an "Effacer" link calling `clear()`), and is hidden otherwise.
- Recent-search history is header-bar-only — no history on `/music`'s or `/podcasts`' own local search inputs.
- No suggestion/history click ever navigates directly to an item — always triggers `handleSearch()`'s existing full-search flow.

---

## Task 1: `highlightMatch` utility

**Files:**
- Create: `app/utils/highlightMatch.ts` (first file in a new `app/utils/` directory)
- Test: `tests/unit/highlightMatch.test.ts`

**Interfaces:**
- Produces: `highlightMatch(text: string, query: string): string` — used by Task 6 in 4 render sites.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/highlightMatch.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { highlightMatch } from '../../app/utils/highlightMatch';

describe('highlightMatch', () => {
  it('wraps a case-insensitive match in <mark>', () => {
    expect(highlightMatch('Hello World', 'world')).toBe('Hello <mark>World</mark>');
  });

  it('escapes HTML in the source text before highlighting', () => {
    expect(highlightMatch('<script>alert(1)</script> World', 'world')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt; <mark>World</mark>'
    );
  });

  it('escapes HTML in the source text even when there is no match', () => {
    expect(highlightMatch('<b>Bold</b> & stuff', 'zzz')).toBe('&lt;b&gt;Bold&lt;/b&gt; &amp; stuff');
  });

  it('escapes &, <, > in both matched and unmatched portions', () => {
    expect(highlightMatch('A & B < C', 'b')).toBe('A &amp; <mark>B</mark> &lt; C');
  });

  it('returns the escaped text unchanged when there is no match', () => {
    expect(highlightMatch('Nothing matches here', 'zzz')).toBe('Nothing matches here');
  });

  it('returns the escaped text unchanged when the query is empty', () => {
    expect(highlightMatch('Some Title', '')).toBe('Some Title');
  });

  it('treats regex-special characters in the query as literal text', () => {
    expect(highlightMatch('Price: $5.00 (each)', '$5.00')).toBe('Price: <mark>$5.00</mark> (each)');
  });

  it('matches a literal "." character only, not as a wildcard', () => {
    expect(highlightMatch('a.b.c', '.')).toBe('a<mark>.</mark>b.c');
    expect(highlightMatch('axbxc', '.')).toBe('axbxc');
  });

  it('matches a literal "*" character only, not as a repetition operator', () => {
    expect(highlightMatch('3 * 4 = 12', '*')).toBe('3 <mark>*</mark> 4 = 12');
  });

  it('only wraps the first matching occurrence', () => {
    expect(highlightMatch('cat cat cat', 'cat')).toBe('<mark>cat</mark> cat cat');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/highlightMatch.test.ts`
Expected: FAIL — `Cannot find module '../../app/utils/highlightMatch'`

- [ ] **Step 3: Implement `highlightMatch`**

Create `app/utils/highlightMatch.ts`:

```typescript
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function highlightMatch(text: string, query: string): string {
  const escapedText = escapeHtml(text);
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return escapedText;

  const pattern = new RegExp(escapeRegExp(escapeHtml(trimmedQuery)), 'i');
  const match = escapedText.match(pattern);
  if (!match || match.index === undefined) return escapedText;

  const start = match.index;
  const end = start + match[0].length;
  return `${escapedText.slice(0, start)}<mark>${escapedText.slice(start, end)}</mark>${escapedText.slice(end)}`;
}
```

Note: the query is HTML-escaped too (via `escapeHtml`) before building the match pattern, so a query containing `&`, `<`, or `>` still matches correctly against the already-escaped source text.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/highlightMatch.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add app/utils/highlightMatch.ts tests/unit/highlightMatch.test.ts
git commit -m "feat: add highlightMatch utility for search term highlighting"
```

---

## Task 2: `useSearchHistory` composable

**Files:**
- Create: `app/composables/useSearchHistory.ts`
- Test: `tests/component/useSearchHistory.test.ts`

**Interfaces:**
- Produces: `useSearchHistory()` returning `{ get(): string[], add(term: string): void, clear(): void }` — used by Task 5 (`default.vue`'s `handleSearch()` and dropdown history rendering).

- [ ] **Step 1: Write the failing tests**

Create `tests/component/useSearchHistory.test.ts`. This follows the exact `window.localStorage`-swap pattern already used in `tests/component/useActiveMiniPlayer.test.ts` (NOT `vi.spyOn(Storage.prototype, ...)`, which does not work in this project's happy-dom setup):

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useSearchHistory } from '../../app/composables/useSearchHistory';

const realLocalStorage = window.localStorage;

function installFakeStorage(overrides: Partial<Storage> = {}) {
  const store = new Map<string, string>();
  const fake: Storage = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() { return store.size; },
    ...overrides,
  };
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    writable: true,
    value: fake,
  });
  return fake;
}

function restoreRealStorage() {
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    writable: true,
    value: realLocalStorage,
  });
}

describe('useSearchHistory', () => {
  beforeEach(() => {
    installFakeStorage();
  });

  afterEach(() => {
    restoreRealStorage();
  });

  it('returns an empty list when nothing has been added', () => {
    const { get } = useSearchHistory();
    expect(get()).toEqual([]);
  });

  it('adds a term and returns it most-recent-first', () => {
    const { add, get } = useSearchHistory();
    add('foo');
    add('bar');
    expect(get()).toEqual(['bar', 'foo']);
  });

  it('dedupes a re-added term, moving it to the front', () => {
    const { add, get } = useSearchHistory();
    add('foo');
    add('bar');
    add('foo');
    expect(get()).toEqual(['foo', 'bar']);
  });

  it('caps the history at 8 entries, dropping the oldest', () => {
    const { add, get } = useSearchHistory();
    for (let i = 1; i <= 9; i++) add(`term${i}`);
    const result = get();
    expect(result).toHaveLength(8);
    expect(result[0]).toBe('term9');
    expect(result).not.toContain('term1');
  });

  it('ignores an empty or whitespace-only term', () => {
    const { add, get } = useSearchHistory();
    add('');
    add('   ');
    expect(get()).toEqual([]);
  });

  it('clears the history', () => {
    const { add, get, clear } = useSearchHistory();
    add('foo');
    clear();
    expect(get()).toEqual([]);
  });

  it('get() fails silently to an empty array when localStorage.getItem throws', () => {
    installFakeStorage({
      getItem: () => { throw new Error('quota exceeded'); },
    });
    const { get } = useSearchHistory();
    expect(get()).toEqual([]);
  });

  it('add() fails silently (no throw) when localStorage.setItem throws', () => {
    installFakeStorage({
      setItem: () => { throw new Error('quota exceeded'); },
    });
    const { add } = useSearchHistory();
    expect(() => add('foo')).not.toThrow();
  });

  it('clear() fails silently (no throw) when localStorage.removeItem throws', () => {
    installFakeStorage({
      removeItem: () => { throw new Error('quota exceeded'); },
    });
    const { clear } = useSearchHistory();
    expect(() => clear()).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/component/useSearchHistory.test.ts`
Expected: FAIL — `Cannot find module '../../app/composables/useSearchHistory'`

- [ ] **Step 3: Implement `useSearchHistory`**

Create `app/composables/useSearchHistory.ts`:

```typescript
const STORAGE_KEY = 'youkeep:search-history';
const MAX_ENTRIES = 8;

export function useSearchHistory() {
  function get(): string[] {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : [];
    } catch (e) {
      return [];
    }
  }

  function add(term: string): void {
    const trimmed = term.trim();
    if (!trimmed) return;
    try {
      const current = get();
      const deduped = current.filter((t) => t !== trimmed);
      const next = [trimmed, ...deduped].slice(0, MAX_ENTRIES);
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (e) {
      // localStorage unavailable or full — history is best-effort, fail silently
    }
  }

  function clear(): void {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      // fail silently
    }
  }

  return { get, add, clear };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/component/useSearchHistory.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add app/composables/useSearchHistory.ts tests/component/useSearchHistory.test.ts
git commit -m "feat: add useSearchHistory composable for recent-search persistence"
```

---

## Task 3: Backend `limit` param on music/podcast search endpoints

**Files:**
- Modify: `server/api/music/tracks/search.get.ts:10,56` (add limit parsing after the existing `const search = ...` line; the hardcoded `LIMIT 200`)
- Modify: `server/api/podcasts/episodes/search.get.ts:10,52` (same two spots)
- Modify: `tests/integration/music-tracks-search.test.ts` (append new tests to the existing describe block)
- Modify: `tests/integration/podcast-episodes-search.test.ts` (append new tests to the existing describe block)

**Interfaces:**
- Produces: both endpoints now accept an optional `?limit=` query param, capped at 200, defaulting to 200 when omitted — consumed by Task 4's `useSearchSuggestions` composable (`limit=5` in `per_space` mode, `limit=3` in `global` mode).

Both endpoints already have real integration test files that exercise the handler directly against an in-memory `better-sqlite3` DB via `createTestDb()`/`mockEvent()`/`insertMusicTrack()` etc. (`tests/integration/music-tracks-search.test.ts`, `tests/integration/podcast-episodes-search.test.ts` — both already read in full during plan research). This task appends new `it()` blocks to those existing files rather than creating new ones, so the new tests exercise the real route handler end-to-end, not a duplicated helper function.

- [ ] **Step 1: Write the failing tests**

In `tests/integration/music-tracks-search.test.ts`, add these two tests inside the existing `describe('GET /api/music/tracks/search', ...)` block (after the last existing `it(...)`):

```typescript
  it('caps results at the requested limit', async () => {
    insertMusicArtist(db, { id: 'a1', name: 'Prolific Artist' });
    for (let i = 1; i <= 5; i++) {
      insertMusicTrack(db, { id: `t${i}`, artistId: 'a1' });
      db.prepare("UPDATE music_tracks SET title = ? WHERE id = ?").run(`Limit Test ${i}`, `t${i}`);
    }

    const result: any = await handler(guestEvent('/api/music/tracks/search?q=Limit&limit=2'));
    expect(result.tracks).toHaveLength(2);
  });

  it('clamps a requested limit above 200 down to 200', async () => {
    insertMusicArtist(db, { id: 'a1', name: 'Prolific Artist' });
    for (let i = 1; i <= 3; i++) {
      insertMusicTrack(db, { id: `t${i}`, artistId: 'a1' });
      db.prepare("UPDATE music_tracks SET title = ? WHERE id = ?").run(`Clamp Test ${i}`, `t${i}`);
    }

    const result: any = await handler(guestEvent('/api/music/tracks/search?q=Clamp&limit=500'));
    expect(result.tracks).toHaveLength(3);
  });
```

In `tests/integration/podcast-episodes-search.test.ts`, add the identical two tests (adapted to episodes) inside its existing `describe('GET /api/podcasts/episodes/search', ...)` block:

```typescript
  it('caps results at the requested limit', async () => {
    insertPodcastShow(db, { id: 's1', title: 'Prolific Show' });
    for (let i = 1; i <= 5; i++) {
      insertPodcastEpisode(db, { id: `e${i}`, showId: 's1' });
      db.prepare("UPDATE podcast_episodes SET title = ? WHERE id = ?").run(`Limit Test ${i}`, `e${i}`);
    }

    const result: any = await handler(guestEvent('/api/podcasts/episodes/search?q=Limit&limit=2'));
    expect(result.episodes).toHaveLength(2);
  });

  it('clamps a requested limit above 200 down to 200', async () => {
    insertPodcastShow(db, { id: 's1', title: 'Prolific Show' });
    for (let i = 1; i <= 3; i++) {
      insertPodcastEpisode(db, { id: `e${i}`, showId: 's1' });
      db.prepare("UPDATE podcast_episodes SET title = ? WHERE id = ?").run(`Clamp Test ${i}`, `e${i}`);
    }

    const result: any = await handler(guestEvent('/api/podcasts/episodes/search?q=Clamp&limit=500'));
    expect(result.episodes).toHaveLength(3);
  });
```

Both new episode-insert calls need `downloadStatus: 'completed'` if `insertPodcastEpisode`'s default isn't already `'completed'` — check the helper's default in `tests/helpers/testDb.ts` before running; if its default status would exclude these rows from the endpoint's `download_status = 'completed'` filter, add `downloadStatus: 'completed'` explicitly to each `insertPodcastEpisode(...)` call above (matching how the existing `it('excludes a track that is not yet completed', ...)` test in the same file already demonstrates the filter exists). Apply the same check to `insertMusicTrack`'s default for the music-side tests.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/integration/music-tracks-search.test.ts tests/integration/podcast-episodes-search.test.ts`
Expected: FAIL — both new tests in each file get back all matching rows (5 and 3 respectively) instead of the requested/clamped count, because `?limit=` is not yet read by either route (both still hardcode `LIMIT 200`).

- [ ] **Step 3: Wire the real `limit` param into both routes**

In `server/api/music/tracks/search.get.ts`, add after the existing `const search = ...` line (currently line 10):

```typescript
  const rawLimit = parseInt(String(query.limit ?? '200'), 10);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 200) : 200;
```

Then change the final query's `LIMIT 200` (currently line 56) to `LIMIT ?` and append `limit` to the params passed to `.all(...params, limit)`:

```typescript
  const tracks = db.prepare(`
    SELECT t.id, t.title, t.track_number, t.genre, t.language, t.duration,
           t.local_file_path, t.local_thumbnail_path, t.has_clip, t.artist_id,
           a.name as artist_name, al.title as album_title
    FROM music_tracks t
    JOIN music_artists a ON t.artist_id = a.id
    LEFT JOIN music_albums al ON t.album_id = al.id
    ${joinFtsSql}
    ${whereSql}
    ${orderBySql}
    LIMIT ?
  `).all(...params, limit);
```

Apply the identical change to `server/api/podcasts/episodes/search.get.ts`: add the same `rawLimit`/`limit` block after its `const search = ...` line (currently line 10), change `LIMIT 200` (currently line 52) to `LIMIT ?`, and append `limit` to `.all(...params, limit)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/integration/music-tracks-search.test.ts tests/integration/podcast-episodes-search.test.ts`
Expected: PASS — all pre-existing tests in both files still pass (confirming the default/omitted-limit behavior is unchanged) plus the 2 new tests in each file (4 new total)

- [ ] **Step 5: Commit**

```bash
git add server/api/music/tracks/search.get.ts server/api/podcasts/episodes/search.get.ts tests/integration/music-tracks-search.test.ts tests/integration/podcast-episodes-search.test.ts
git commit -m "feat: add optional limit param to music/podcast search endpoints"
```

---

## Task 4: `useSearchSuggestions` composable

**Files:**
- Create: `app/composables/useSearchSuggestions.ts`
- Test: `tests/component/useSearchSuggestions.test.ts`

**Interfaces:**
- Consumes: `GET /api/videos?q=&limit=` (existing, unchanged), `GET /api/music/tracks/search?q=&limit=` and `GET /api/podcasts/episodes/search?q=&limit=` (Task 3's new `limit` param).
- Produces: `useSearchSuggestions()` returning `{ suggestions: Ref<Suggestion[]>, loading: Ref<boolean>, fetchSuggestions(term: string, mode: 'per_space' | 'global', activeSpaceId: 'video' | 'music' | 'podcasts'): void }` where `Suggestion = { type: 'video' | 'track' | 'episode', title: string, subtitle: string }`. `fetchSuggestions` is internally debounced (250ms) — callers invoke it on every keystroke without debouncing themselves. Used by Task 5 (`default.vue`'s dropdown).

- [ ] **Step 1: Write the failing tests**

Create `tests/component/useSearchSuggestions.test.ts`. Per the spec's Testing section, no test covers the debounce timing itself (manual browser verification instead, matching this codebase's established convention) — these tests cover only the pure normalization and mode-branching logic, using `$fetch` mocked via Nuxt's auto-import.

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useSearchSuggestions } from '../../app/composables/useSearchSuggestions';

const fetchMock = vi.fn();
vi.stubGlobal('$fetch', fetchMock);

describe('useSearchSuggestions', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it('normalizes video results with type "video"', async () => {
    fetchMock.mockResolvedValueOnce({
      videos: [{ id: '1', title: 'My Video', channel_title: 'My Channel' }],
    });
    const { suggestions, fetchSuggestions } = useSearchSuggestions();
    fetchSuggestions('foo', 'per_space', 'video');
    await vi.waitFor(() => expect(suggestions.value).toHaveLength(1));
    expect(suggestions.value[0]).toEqual({ type: 'video', title: 'My Video', subtitle: 'My Channel' });
  });

  it('normalizes track results with type "track"', async () => {
    fetchMock.mockResolvedValueOnce({
      tracks: [{ id: '1', title: 'My Track', artist_name: 'My Artist' }],
    });
    const { suggestions, fetchSuggestions } = useSearchSuggestions();
    fetchSuggestions('foo', 'per_space', 'music');
    await vi.waitFor(() => expect(suggestions.value).toHaveLength(1));
    expect(suggestions.value[0]).toEqual({ type: 'track', title: 'My Track', subtitle: 'My Artist' });
  });

  it('normalizes episode results with type "episode"', async () => {
    fetchMock.mockResolvedValueOnce({
      episodes: [{ id: '1', title: 'My Episode', show_title: 'My Show' }],
    });
    const { suggestions, fetchSuggestions } = useSearchSuggestions();
    fetchSuggestions('foo', 'per_space', 'podcasts');
    await vi.waitFor(() => expect(suggestions.value).toHaveLength(1));
    expect(suggestions.value[0]).toEqual({ type: 'episode', title: 'My Episode', subtitle: 'My Show' });
  });

  it('in per_space mode, calls only the active space endpoint with limit=5', async () => {
    fetchMock.mockResolvedValueOnce({ tracks: [] });
    const { fetchSuggestions } = useSearchSuggestions();
    fetchSuggestions('foo', 'per_space', 'music');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/music/tracks/search', { params: { q: 'foo', limit: 5 } });
  });

  it('in global mode, calls all 3 endpoints in parallel with limit=3 each', async () => {
    fetchMock.mockResolvedValue({ videos: [], tracks: [], episodes: [] });
    const { fetchSuggestions } = useSearchSuggestions();
    fetchSuggestions('foo', 'global', 'video');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock).toHaveBeenCalledWith('/api/videos', { params: { q: 'foo', limit: 3 } });
    expect(fetchMock).toHaveBeenCalledWith('/api/music/tracks/search', { params: { q: 'foo', limit: 3 } });
    expect(fetchMock).toHaveBeenCalledWith('/api/podcasts/episodes/search', { params: { q: 'foo', limit: 3 } });
  });

  it('clears suggestions and does not fetch when the term is under 2 characters', async () => {
    const { suggestions, fetchSuggestions } = useSearchSuggestions();
    fetchSuggestions('a', 'per_space', 'video');
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(suggestions.value).toEqual([]);
  });

  it('leaves suggestions empty (no throw) when a fetch fails', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network error'));
    const { suggestions, fetchSuggestions } = useSearchSuggestions();
    fetchSuggestions('foo', 'per_space', 'video');
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(suggestions.value).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/component/useSearchSuggestions.test.ts`
Expected: FAIL — `Cannot find module '../../app/composables/useSearchSuggestions'`

- [ ] **Step 3: Implement `useSearchSuggestions`**

Create `app/composables/useSearchSuggestions.ts`:

```typescript
import { ref } from 'vue';

export interface Suggestion {
  type: 'video' | 'track' | 'episode';
  title: string;
  subtitle: string;
}

type SpaceId = 'video' | 'music' | 'podcasts';
type SearchMode = 'per_space' | 'global';

const DEBOUNCE_MS = 250;

function normalizeVideo(v: any): Suggestion {
  return { type: 'video', title: v.title, subtitle: v.channel_title || '' };
}
function normalizeTrack(t: any): Suggestion {
  return { type: 'track', title: t.title, subtitle: t.artist_name || '' };
}
function normalizeEpisode(e: any): Suggestion {
  return { type: 'episode', title: e.title, subtitle: e.show_title || '' };
}

async function fetchVideos(term: string, limit: number): Promise<Suggestion[]> {
  const data = await $fetch<{ videos: any[] }>('/api/videos', { params: { q: term, limit } });
  return (data.videos || []).map(normalizeVideo);
}
async function fetchTracks(term: string, limit: number): Promise<Suggestion[]> {
  const data = await $fetch<{ tracks: any[] }>('/api/music/tracks/search', { params: { q: term, limit } });
  return (data.tracks || []).map(normalizeTrack);
}
async function fetchEpisodes(term: string, limit: number): Promise<Suggestion[]> {
  const data = await $fetch<{ episodes: any[] }>('/api/podcasts/episodes/search', { params: { q: term, limit } });
  return (data.episodes || []).map(normalizeEpisode);
}

export function useSearchSuggestions() {
  const suggestions = ref<Suggestion[]>([]);
  const loading = ref(false);
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let requestId = 0;

  async function runFetch(term: string, mode: SearchMode, activeSpaceId: SpaceId) {
    const thisRequestId = ++requestId;
    loading.value = true;
    try {
      let results: Suggestion[];
      if (mode === 'global') {
        const [videos, tracks, episodes] = await Promise.all([
          fetchVideos(term, 3),
          fetchTracks(term, 3),
          fetchEpisodes(term, 3),
        ]);
        results = [...videos, ...tracks, ...episodes];
      } else if (activeSpaceId === 'music') {
        results = await fetchTracks(term, 5);
      } else if (activeSpaceId === 'podcasts') {
        results = await fetchEpisodes(term, 5);
      } else {
        results = await fetchVideos(term, 5);
      }
      if (thisRequestId !== requestId) return;
      suggestions.value = results;
    } catch (e) {
      if (thisRequestId !== requestId) return;
      suggestions.value = [];
    } finally {
      if (thisRequestId === requestId) loading.value = false;
    }
  }

  function fetchSuggestions(term: string, mode: SearchMode, activeSpaceId: SpaceId) {
    if (debounceTimer) clearTimeout(debounceTimer);
    const trimmed = term.trim();
    if (trimmed.length < 2) {
      requestId++;
      suggestions.value = [];
      loading.value = false;
      return;
    }
    debounceTimer = setTimeout(() => runFetch(trimmed, mode, activeSpaceId), DEBOUNCE_MS);
  }

  return { suggestions, loading, fetchSuggestions };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/component/useSearchSuggestions.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add app/composables/useSearchSuggestions.ts tests/component/useSearchSuggestions.test.ts
git commit -m "feat: add useSearchSuggestions composable for debounced autocomplete"
```

---

## Task 5: Dropdown UI in `default.vue` (suggestions + history + keyboard nav)

**Files:**
- Modify: `app/layouts/default.vue`

**Interfaces:**
- Consumes: `useSearchHistory()` (Task 2), `useSearchSuggestions()` (Task 4), the existing `searchQuery` ref, `contentSearchMode` ref, `activeSpace` computed, and `handleSearch()` (all already in this file, lines 147-240).
- Produces: nothing new consumed elsewhere — this is the top-level UI task.

This task modifies the existing `.search-form` block (template lines 32-43) and its surrounding `<script setup>` state (lines 140-240) and CSS (lines 391-430).

- [ ] **Step 1: Add composable imports and dropdown state**

In `app/layouts/default.vue`, after the existing line `const searchQuery = ref('');` (line 147), add:

```typescript
const { get: getSearchHistory, add: addSearchHistory, clear: clearSearchHistory } = useSearchHistory();
const { suggestions, fetchSuggestions } = useSearchSuggestions();

const searchFocused = ref(false);
const selectedIndex = ref(-1);
const historyEntries = ref<string[]>([]);

const dropdownItems = computed<{ label: string; sublabel: string }[]>(() => {
  if (searchQuery.value.trim().length === 0) {
    return historyEntries.value.map((term) => ({ label: term, sublabel: '' }));
  }
  return suggestions.value.map((s) => ({ label: s.title, sublabel: s.subtitle }));
});

const showDropdown = computed(() => {
  if (!searchFocused.value) return false;
  if (searchQuery.value.trim().length === 0) return historyEntries.value.length > 0;
  return searchQuery.value.trim().length >= 2;
});

function refreshHistoryEntries() {
  historyEntries.value = getSearchHistory();
}

function onSearchInput() {
  selectedIndex.value = -1;
  const term = searchQuery.value;
  if (term.trim().length === 0) {
    refreshHistoryEntries();
  } else {
    fetchSuggestions(term, contentSearchMode.value as 'per_space' | 'global', activeSpace.value.id as 'video' | 'music' | 'podcasts');
  }
}

function onSearchFocus() {
  searchFocused.value = true;
  if (searchQuery.value.trim().length === 0) {
    refreshHistoryEntries();
  }
}

function onSearchBlur() {
  // Delay so a click on a dropdown item registers before the dropdown hides.
  setTimeout(() => {
    searchFocused.value = false;
    selectedIndex.value = -1;
  }, 150);
}

function selectDropdownItem(label: string) {
  searchQuery.value = label;
  searchFocused.value = false;
  selectedIndex.value = -1;
  handleSearch();
}

function onSearchKeydown(e: KeyboardEvent) {
  if (!showDropdown.value || dropdownItems.value.length === 0) return;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    selectedIndex.value = (selectedIndex.value + 1) % dropdownItems.value.length;
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    selectedIndex.value = selectedIndex.value <= 0 ? dropdownItems.value.length - 1 : selectedIndex.value - 1;
  } else if (e.key === 'Escape') {
    searchFocused.value = false;
    selectedIndex.value = -1;
  } else if (e.key === 'Enter' && selectedIndex.value >= 0) {
    e.preventDefault();
    selectDropdownItem(dropdownItems.value[selectedIndex.value]!.label);
  }
}

function onClearHistory() {
  clearSearchHistory();
  refreshHistoryEntries();
}
```

`activeSpace.value.id` must exist already for this to compile — confirm the `spaces` array (defined earlier in this file, outside the excerpted range) has an `id` field of `'video' | 'music' | 'podcasts'` per space; this is already used at line 151-153 (`spaces.find((s) => s.id === 'music')`) so it's confirmed present.

- [ ] **Step 2: Wire `handleSearch()` to record history**

Modify the existing `handleSearch` function (currently lines 234-240) to call `addSearchHistory` before navigating, for a non-empty query only:

```typescript
const handleSearch = () => {
  if (searchQuery.value.trim()) {
    addSearchHistory(searchQuery.value.trim());
  }
  if (contentSearchMode.value === 'global') {
    router.push({ path: '/search', query: { q: searchQuery.value || undefined } });
    return;
  }
  router.push({ path: activeSpace.value.homeRoute, query: { ...route.query, q: searchQuery.value || undefined, page: undefined, artistId: undefined, showId: undefined } });
};
```

- [ ] **Step 3: Update the search form template**

Replace the existing `.search-form` block (template lines 32-43):

```html
        <form @submit.prevent="handleSearch" class="search-form">
          <input 
            type="text" 
            v-model="searchQuery" 
            placeholder="Search videos, channels..." 
            class="search-input"
          />
          <button type="submit" class="search-btn">
            <!-- Search SVG -->
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          </button>
        </form>
```

with:

```html
        <form @submit.prevent="handleSearch" class="search-form">
          <input 
            type="text" 
            v-model="searchQuery" 
            placeholder="Search videos, channels..." 
            class="search-input"
            @input="onSearchInput"
            @focus="onSearchFocus"
            @blur="onSearchBlur"
            @keydown="onSearchKeydown"
          />
          <button type="submit" class="search-btn">
            <!-- Search SVG -->
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          </button>

          <div v-if="showDropdown" class="search-dropdown">
            <div
              v-for="(item, index) in dropdownItems"
              :key="`${item.label}-${index}`"
              class="search-dropdown-item"
              :class="{ 'is-selected': index === selectedIndex }"
              @mousedown.prevent="selectDropdownItem(item.label)"
            >
              <span class="search-dropdown-label">{{ item.label }}</span>
              <span v-if="item.sublabel" class="search-dropdown-sublabel">{{ item.sublabel }}</span>
            </div>
            <div
              v-if="searchQuery.trim().length === 0 && historyEntries.length > 0"
              class="search-dropdown-clear"
              @mousedown.prevent="onClearHistory"
            >
              Effacer
            </div>
          </div>
        </form>
```

`@mousedown.prevent` (not `@click`) is used on dropdown items so the click registers before the input's `blur` handler fires and hides the dropdown — `.prevent` stops the mousedown from stealing focus/triggering blur in a way that would race the click.

- [ ] **Step 4: Add dropdown CSS**

After the existing `.search-btn:hover` block (currently ending at line 430), add:

```css
.search-form {
  position: relative;
}

.search-dropdown {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  right: 0;
  background: var(--bg-secondary, #1a1a1a);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  overflow: hidden;
  z-index: 50;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
}

.search-dropdown-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  cursor: pointer;
  font-size: 14px;
}

.search-dropdown-item:hover,
.search-dropdown-item.is-selected {
  background: rgba(255, 255, 255, 0.06);
}

.search-dropdown-label {
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.search-dropdown-sublabel {
  color: var(--text-secondary);
  font-size: 12.5px;
  flex-shrink: 0;
}

.search-dropdown-clear {
  padding: 8px 16px;
  text-align: center;
  font-size: 13px;
  color: var(--accent-primary);
  cursor: pointer;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.search-dropdown-clear:hover {
  background: rgba(255, 255, 255, 0.04);
}
```

Note the pre-existing `.search-form { display: flex; width: 500px; max-width: 100%; }` rule (line 391-395) is not removed — this step adds `position: relative` as a second declaration block; Vue/Vite's `<style>` block allows multiple selectors targeting the same class, and CSS cascades them, so both rules apply together (flex layout + positioning context for the absolutely-positioned dropdown).

- [ ] **Step 5: Manual verification (component test skipped per spec)**

Per the spec's Testing section, the suggestion-fetch debounce and dropdown UI behavior is verified manually in Task 7, not via a component test — there is no Step 5 automated test for this task. Confirm the file still type-checks and the existing test suite has no regressions:

Run: `npx vitest run`
Expected: All existing tests still PASS (this task adds no new test files, so the count should match Task 4's post-commit total)

Run: `npx nuxt build`
Expected: Clean build, no TypeScript errors

- [ ] **Step 6: Commit**

```bash
git add app/layouts/default.vue
git commit -m "feat: add autocomplete/history dropdown with keyboard nav to header search"
```

---

## Task 6: Wire `highlightMatch` into the 4 render sites

**Files:**
- Modify: `app/pages/music/index.vue:37-47` (flat track-search-results list)
- Modify: `app/pages/podcasts/index.vue:23-32` (flat episode-search-results list)
- Modify: `app/pages/search.vue:34-44,60-70` (both result sections)
- Modify: `app/components/VideoCard.vue:40,71-90` (new `searchQuery` prop)
- Modify: `app/pages/index.vue:43` (pass `searchQuery` to `VideoCard`)

**Interfaces:**
- Consumes: `highlightMatch(text: string, query: string): string` (Task 1).

- [ ] **Step 1: `app/pages/music/index.vue` — highlight track titles**

Find the existing block (currently lines 37-47):

```html
        <div v-else class="track-search-results">
          <div 
            v-for="track in trackSearchResults" 
            :key="track.id" 
            ...
          >
            <span class="track-row-title">{{ track.title }}</span>
            <span class="track-row-artist">{{ track.artist_name }}</span>
          </div>
        </div>
```

Change the title span to:

```html
            <span class="track-row-title" v-html="highlightMatch(track.title, search)"></span>
```

Leave `track-row-artist` unchanged (highlighting applies to titles only, per spec — subtitle/secondary fields are not in scope). Add the import in the `<script setup>` block, alongside this file's other imports:

```typescript
import { highlightMatch } from '../../utils/highlightMatch';
```

- [ ] **Step 2: `app/pages/podcasts/index.vue` — highlight episode titles**

Find the existing block (currently lines 23-32):

```html
        <div v-else class="episode-search-results">
          <div 
            v-for="episode in episodeSearchResults" 
            :key="episode.id" 
            ...
          >
            <span class="episode-search-title">{{ episode.title }}</span>
            <span class="episode-search-show">{{ episode.show_title }}</span>
          </div>
        </div>
```

Change the title span to:

```html
            <span class="episode-search-title" v-html="highlightMatch(episode.title, search)"></span>
```

Add the same import:

```typescript
import { highlightMatch } from '../../utils/highlightMatch';
```

- [ ] **Step 3: `app/pages/search.vue` — highlight both sections' row titles**

Find the two existing `search-result-title` spans (currently lines 41 and 67):

```html
            <span class="search-result-title">{{ track.title }}</span>
```
```html
            <span class="search-result-title">{{ episode.title }}</span>
```

There is also a video section in this file (the 3rd of the "3 sections" the spec describes) — locate its equivalent `search-result-title` span rendering `video.title` (search this file for a third `v-for` block over a `videos` array near the top of the results template, structurally identical to the track/episode ones) and apply the same change there too. All three become:

```html
            <span class="search-result-title" v-html="highlightMatch(track.title, query)"></span>
```
```html
            <span class="search-result-title" v-html="highlightMatch(episode.title, query)"></span>
```
```html
            <span class="search-result-title" v-html="highlightMatch(video.title, query)"></span>
```

(Using the existing `query` computed, currently defined at line 84: `const query = computed(() => (route.query.q ? String(route.query.q) : ''));` — pass `query.value` if `highlightMatch` requires a plain string in this file's binding context; Vue template expressions unwrap `computed` refs automatically, so `query` alone is correct here, matching how `query` is presumably already used elsewhere in this same template.)

Add the import in this file's `<script setup>` block:

```typescript
import { highlightMatch } from '../utils/highlightMatch';
```

- [ ] **Step 4: `app/components/VideoCard.vue` — new optional `searchQuery` prop**

Modify the `defineProps` block (currently lines 71-90):

```typescript
const props = withDefaults(defineProps<{
  video: {
    id: string;
    title: string;
    duration: number | null;
    channel_title?: string;
    channel_avatar?: string;
    view_count: number | null;
    upload_date: string | null;
    local_thumbnail_path?: string;
    local_video_path?: string;
    was_live?: number;
  };
  showChannelInfo?: boolean;
  clickable?: boolean;
  to?: string;
  searchQuery?: string;
}>(), {
  showChannelInfo: true,
  clickable: true,
  searchQuery: ''
});
```

Modify the title element (currently line 40):

```html
      <h4 class="video-title" :title="video.title">{{ video.title }}</h4>
```

to:

```html
      <h4 v-if="props.searchQuery" class="video-title" :title="video.title" v-html="highlightMatch(video.title, props.searchQuery)"></h4>
      <h4 v-else class="video-title" :title="video.title">{{ video.title }}</h4>
```

Add the import to this file's `<script setup>` block:

```typescript
import { highlightMatch } from '../utils/highlightMatch';
```

This preserves today's exact plain-text rendering (no `v-html`, no highlighting) for every existing `VideoCard` call site that doesn't pass `searchQuery` — the prop defaults to `''`, which is falsy, so the `v-else` branch renders unchanged.

- [ ] **Step 5: `app/pages/index.vue` — pass `searchQuery` through for the video-grid search results**

Modify the existing line (currently line 43):

```html
        <VideoCard v-for="video in allVideos" :key="video.id" :video="video" @hidden="onVideoHidden" />
```

to:

```html
        <VideoCard v-for="video in allVideos" :key="video.id" :video="video" :search-query="searchQuery" @hidden="onVideoHidden" />
```

This line lives inside the `v-else-if="searchQuery"` block (template line 21), so `searchQuery` is guaranteed non-empty here — confirm `searchQuery` is the exact ref/computed name already in scope in this file's `<script setup>` (used at line 21's `v-else-if` and in the "Videos matching" heading at line 38); if this file's local search state uses a different variable name than `searchQuery` (verify via `grep -n "const searchQuery" app/pages/index.vue` before making this edit), substitute the actual name — do not introduce a new one.

Do NOT modify the other 3 `VideoCard` usages in this file (currently lines 93, 104, 119) — those render the Netflix-style home feed rows, not search results, and must keep their default unhighlighted rendering per the spec's scope (highlighting applies only where search results render).

- [ ] **Step 6: Manual verification of all 4 sites**

Run: `npx vitest run`
Expected: All tests still PASS (no new test files added in this task — highlighting in Vue templates is verified manually in Task 7 per the spec's Testing section, since `highlightMatch` itself is already fully unit-tested in Task 1)

Run: `npx nuxt build`
Expected: Clean build, no TypeScript errors, no unresolved imports

- [ ] **Step 7: Commit**

```bash
git add app/pages/music/index.vue app/pages/podcasts/index.vue app/pages/search.vue app/components/VideoCard.vue app/pages/index.vue
git commit -m "feat: wire highlightMatch into all 4 search-result render sites"
```

---

## Task 7: Manual end-to-end verification

**Files:** None (no code changes — verification only).

Per this codebase's established convention (documented in project memory), the Browser pane cannot reach a locally-started dev server in this environment. Use the `ALLOW_DEV_LOGIN=1 npm run dev` + `POST /api/dev/login` + `curl` workaround for API-level checks, and — since this task specifically verifies interactive UI behavior (dropdown, keyboard nav, `<mark>` rendering) that `curl` cannot exercise — note in the final report which checks were done via `curl` (API responses only) versus which are visual/interactive checks that could not be automated in this environment and were instead verified by reading the rendered component output/HTML directly.

- [ ] **Step 1: Start the dev server and authenticate**

```bash
ALLOW_DEV_LOGIN=1 npm run dev &
sleep 3
curl -s -c /tmp/youkeep-cookies.txt -X POST http://localhost:3000/api/dev/login -H "Content-Type: application/json" -d '{}'
```

Expected: a session cookie is written to `/tmp/youkeep-cookies.txt` and the login response confirms a user session.

- [ ] **Step 2: Verify the `limit` param on both search endpoints**

If the dev DB has fewer than 3 completed music tracks or podcast episodes matching a common term, seed a few rows directly via `better-sqlite3` first (matching the seeding approach used in prior sub-projects' verification tasks), then:

```bash
curl -s -b /tmp/youkeep-cookies.txt "http://localhost:3000/api/music/tracks/search?q=a&limit=2" | head -c 500
curl -s -b /tmp/youkeep-cookies.txt "http://localhost:3000/api/podcasts/episodes/search?q=a&limit=2" | head -c 500
```

Expected: each response's `tracks`/`episodes` array has at most 2 entries. Then confirm omitting `limit` still returns up to 200 (unchanged default):

```bash
curl -s -b /tmp/youkeep-cookies.txt "http://localhost:3000/api/music/tracks/search?q=a" | python3 -c "import json,sys; print(len(json.load(sys.stdin)['tracks']))"
```

Expected: a count consistent with the pre-change behavior (not artificially truncated to 2).

- [ ] **Step 3: Verify `content_search_mode` in both modes still works with the new dropdown present**

```bash
curl -s -b /tmp/youkeep-cookies.txt "http://localhost:3000/api/settings/content-search-mode"
```

Confirm the mode reported matches the admin-configured value (from the prior Content Search sub-project — do not change this setting as part of this verification unless it's currently unset).

- [ ] **Step 4: Verify highlighting renders correctly and safely**

Seed one music track and one podcast episode whose titles contain `&` and `<` characters (to confirm `highlightMatch`'s escaping holds end-to-end, not just in the Task 1 unit tests), e.g. titles like `Rock & Roll <Live>` and `News <Update> & Weather`. Then:

```bash
curl -s -b /tmp/youkeep-cookies.txt "http://localhost:3000/api/music/tracks/search?q=rock" | head -c 500
```

This confirms the API still returns the raw (unescaped) title — `highlightMatch` runs client-side in the Vue template, so the API response itself should NOT contain `<mark>` or escaped entities. To verify the actual rendered HTML, use `curl` against the server-rendered page (Nuxt SSR) for `/music?q=rock` and grep for `<mark>` in the output:

```bash
curl -s -b /tmp/youkeep-cookies.txt "http://localhost:3000/music?q=rock" | grep -o '<mark>[^<]*</mark>' | head -5
```

Expected: at least one `<mark>...</mark>` wrapping the matched substring, and no unescaped `<script>`/`<Live>` literal tag anywhere in the surrounding output (confirms the escape-then-highlight order held in the real SSR render, not just in the unit-tested function in isolation).

Repeat the same `grep -o '<mark>[^<]*</mark>'` check against `/podcasts?q=news`, `/search?q=rock` (all 3 sections), and `/?q=<a video title fragment>` (home page video search) to confirm all 4 sites render highlighting.

- [ ] **Step 5: Verify recent search history persistence**

This step is inherently interactive (browser `localStorage`) and cannot be verified via `curl`. Read `app/composables/useSearchHistory.ts` and `app/layouts/default.vue`'s `handleSearch()`/dropdown-rendering code (both already fully unit/component-tested in Tasks 2 and partially in Task 5) and confirm by code inspection that:
- `handleSearch()` calls `addSearchHistory(searchQuery.value.trim())` only when `searchQuery.value.trim()` is non-empty (matches Task 5 Step 2's exact code).
- The dropdown's history branch (`dropdownItems` computed, Task 5 Step 1) only activates when `searchQuery.value.trim().length === 0`, matching the spec's "shown when empty and focused" requirement.
- The "Effacer" link calls `onClearHistory` which calls `clearSearchHistory()` then `refreshHistoryEntries()` — confirming the UI updates immediately after clearing, not just on next focus.

Report this step's result as a code-inspection confirmation, explicitly distinguished from the `curl`-verified steps above, in the final summary.

- [ ] **Step 6: Stop the dev server**

```bash
kill %1 2>/dev/null || true
```

- [ ] **Step 7: Run the full test suite one final time**

```bash
npx vitest run
```

Expected: all tests pass, including every test file added in Tasks 1-4 (`tests/unit/highlightMatch.test.ts`, `tests/component/useSearchHistory.test.ts`, `tests/integration/musicTrackSearchLimit.test.ts`, `tests/integration/podcastEpisodeSearchLimit.test.ts`, `tests/component/useSearchSuggestions.test.ts`) alongside the full pre-existing suite.

No commit for this task — it is verification only. If any check in Steps 2-5 reveals a bug, fix it in the relevant task's files, re-run the full suite, and commit the fix with a message describing the bug found during manual verification (matching this session's established pattern from every prior sub-project).
