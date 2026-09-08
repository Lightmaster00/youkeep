# Search UX Enhancements (Autocomplete, Highlighting, Recent History) — Design

**Status:** Approved

## Goal

Make the search experience built in the just-shipped Content Search feature feel faster and more discoverable: suggestions while typing, the matched term visually highlighted in results, and quick access to recent searches.

## Context

The Content Search feature (`docs/superpowers/specs/2026-09-08-content-search-design.md`, merged to `main`) added real FTS5 search for music tracks (`GET /api/music/tracks/search`) and podcast episodes (`GET /api/podcasts/episodes/search`), matching video's existing FTS5 search (`GET /api/videos?q=`). The header search bar (`app/layouts/default.vue`, `searchQuery` ref, `handleSearch()`) behaves differently depending on the admin-controlled `content_search_mode` setting: in `per_space` mode (default) it searches within the active space (`/`, `/music`, or `/podcasts`); in `global` mode it always navigates to `/search?q=`, a page showing 3 capped, FTS-relevance-ordered sections. `/music` and `/podcasts` also have their own local search inputs (independent of `content_search_mode`) that already replace the artist/show grid with a flat result list when searching.

Today, none of this has: suggestions before pressing Enter, any visual indication of *why* a result matched, or a way to quickly repeat a recent search.

## Scope

**In scope:**
- **Autocomplete**: typing ≥2 characters into the header search bar shows a dropdown of live suggestions, debounced. In `per_space` mode, suggestions come only from the active space (up to 5). In `global` mode, suggestions mix all 3 content types (up to 3 each). Keyboard navigation (Up/Down/Enter/Escape) supported. Clicking or Enter-selecting a suggestion fills the search bar and triggers the exact same `handleSearch()` flow as pressing Enter directly — no per-type navigation logic.
- **Match highlighting**: the substring of a result's title matching the search term is rendered in `<mark>`, applied everywhere search results currently render: `/music`'s and `/podcasts`' flat result lists, `/search`'s 3 sections, and the video home page's (`/`) existing search results.
- **Recent search history**: shown in the header search bar's dropdown when the input is empty and focused. Stored in `localStorage` only (no backend), capped at 8 entries, deduplicated, most-recent-first, with a "Clear" affordance. Selecting a history entry behaves exactly like selecting an autocomplete suggestion.

**Out of scope:**
- Recent-search history on `/music`'s or `/podcasts`' own local search inputs — header bar only.
- Autocomplete suggestions navigating directly to an item (playing a track, opening a video) — every suggestion/history click always triggers a full search via `handleSearch()`.
- Ranking history by frequency/popularity — plain most-recent-first.
- Any change to the underlying FTS5 search logic itself (relevance ordering, visibility rules) — this project only adds a UI layer on top of the existing, already-shipped search endpoints.

## Architecture

### Suggestion sourcing

No new endpoints. `GET /api/music/tracks/search` and `GET /api/podcasts/episodes/search` each gain an optional `limit` query param (defaults to the existing `200` when omitted, still capped at `200` max) — a small, additive, non-breaking change. `GET /api/videos` already supports `limit`.

A new composable, `app/composables/useSearchSuggestions.ts`, exposes a debounced (250ms) `fetchSuggestions(term, mode, activeSpaceId)` that:
- In `per_space` mode: calls only the active space's search endpoint with `limit=5`.
- In `global` mode: calls all 3 endpoints in parallel, each with `limit=3`.
- Normalizes every result into `{ type: 'video' | 'track' | 'episode', title: string, subtitle: string }` (`subtitle` = channel title / artist name / show title respectively).

`app/layouts/default.vue` owns the dropdown UI: a `<div class="search-suggestions">` positioned under `.search-form`, shown when the input has focus and either has ≥2 characters (suggestions) or is empty (history, see below). Keyboard state is a simple `selectedIndex` ref; `ArrowDown`/`ArrowUp` move it (wrapping), `Enter` selects the highlighted item (or submits the raw typed text if nothing is highlighted, i.e. today's behavior is preserved), `Escape` closes the dropdown without submitting.

### Match highlighting

A new pure utility, `app/utils/highlightMatch.ts`:

```typescript
export function highlightMatch(text: string, query: string): string
```

HTML-escapes `text` first (titles can originate from external, untrusted sources — podcast titles come from RSS feeds), then case-insensitively wraps the first matching substring of the escaped `query` in `<mark>...</mark>`, returning a string meant for `v-html`. No match → the escaped text unchanged.

Applied at 4 render sites, each passing its own `searchQuery`/`search` value already in scope:
- `app/pages/music/index.vue`'s flat track-search-results list.
- `app/pages/podcasts/index.vue`'s flat episode-search-results list.
- `app/pages/search.vue`'s 3 sections (video/music/podcast rows).
- `app/components/VideoCard.vue` gains a new optional prop `searchQuery?: string` (default `''` → today's unchanged rendering, a plain title with no `v-html`); `app/pages/index.vue` passes its current search query only when one is active.

### Recent search history

A new composable, `app/composables/useSearchHistory.ts`:

```typescript
export function useSearchHistory() {
  function get(): string[]
  function add(term: string): void   // dedupes, moves to front, caps at 8
  function clear(): void
}
```

Backed by a single `localStorage` key, wrapped in try/catch (never throws — see Error Handling). `handleSearch()` in `default.vue` calls `add(searchQuery.value)` right before navigating (only for a non-empty query). The same dropdown used for autocomplete renders history entries instead of live suggestions when the input is empty and focused; a small "Effacer" link at the bottom of that state calls `clear()`.

## Error Handling

- A failed suggestion fetch (network error, timeout) leaves the dropdown showing no results (or its previous state cleared) — never an error message, never blocks typing.
- `localStorage` unavailable or throwing (private browsing, quota) — `useSearchHistory`'s every method is wrapped in try/catch and fails silently to an empty list; the search bar itself is completely unaffected.
- `highlightMatch` always HTML-escapes the source text before inserting `<mark>` tags, so no external title/description can inject markup — this applies even when there's no match (the escape happens unconditionally, the highlight wrap is the only conditional part).

## Testing

- Unit tests for `highlightMatch`: correct escaping of `<`/`>`/`&` in the source text, case-insensitive matching, no-match passthrough, a query containing regex-special characters (e.g. `.`, `*`) matched literally not as a pattern.
- Unit tests for `useSearchHistory`: add/dedupe/cap-at-8/most-recent-first ordering, `clear()`, and a simulated `localStorage` failure on each method.
- No test for the suggestion-fetching debounce logic itself (component-level async behavior, matches this codebase's established convention) — manual browser verification instead, covering: the dropdown's live suggestions in both `content_search_mode`s, keyboard navigation, the recent-history state and its "Effacer" link, and highlighted matches rendering correctly (and safely, for a title containing `&`/`<`) in all 4 target locations.
