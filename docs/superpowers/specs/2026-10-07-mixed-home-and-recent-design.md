# Mixed Home rows + "Recent" pages for Music and Podcasts — Design

**Status:** Approved in chat (2026-10-07). Builds on unified navigation (2026-10-07-unified-navigation-design.md) and home-feed preferences (2026-10-06-home-feed-preferences-design.md).

## Goal
Make Home a real entry point for all three content types and give Music and Podcasts a second sidebar page, without new data.

## Decisions (user)
- Home gets rows for **recently added music** and **new podcast episodes** (not "Continue listening").
- Music and Podcasts each get a **Recent** page next to **Library** (no History page).

## Home rows
- Two new home section ids in `shared/displayPrefs.ts`: `recentMusic` ("Recently added music") and `newEpisodes` ("New podcast episodes"). Same rules as the existing sections: an ordered list in `homeSections` where absent = hidden; admin default and per-user override work unchanged; the Display preferences form lists and orders them like the others. Default for existing installs: unchanged (new sections not added to stored values, i.e. hidden until chosen) but included in the app default order after the video sections for fresh installs only if that does not alter existing users' effective prefs — otherwise keep them opt-in. Pick the safe option and state it in the commit message.
- `server/api/home/feed.get.ts` returns the new sections (items shaped for the existing music/podcast cards: track id, title, artist, album art / episode id, title, show, artwork, published date) respecting each module's enabled flag and visibility rules (music/podcast visibility helpers). A section whose module is disabled, or that has no items, is omitted. Row size honours the existing `rowSize` pref.
- `app/pages/index.vue` renders them with small row components reusing existing music/podcast card markup; clicking plays/opens exactly like in the Music/Podcasts pages (existing player composables). Guests see them only when the content is public under the existing visibility rules.
- `isHomeFullyHidden` and the empty states account for the new sections.

## Recent pages
- Routes: `/music/recent` (latest tracks across all artists, newest first, paginated "Load more") and `/podcasts/recent` (latest episodes across all shows, newest first, paginated). Data from existing `music/playlists/recently-added` and podcast episode queries (add a small `GET /api/podcasts/episodes/recent` only if none exists), with the same visibility rules.
- Sidebar (`app/spaces/index.ts`): Music = Library, Recent; Podcasts = Library, Recent. Labels English. Module gating, `hiddenNavLinks` (these two links are not hideable) and `resolveActiveSpaceId` (`/music/*`, `/podcasts/*`) keep working; `moduleForPagePath` already covers the prefixes.
- Pages use the same card components, players and responsive rules as the Library pages and English copy; empty state "Nothing here yet".

## Testing
- Unit/integration: feed returns new sections only for enabled modules, respects visibility and rowSize, omits empty ones; displayPrefs validation accepts/rejects the new ids and ordering; recent endpoints paginate and filter by visibility.
- Component: home renders the new rows; sidebar shows Library + Recent per section.
- Real check in Docker + Browser pane: seed a few tracks/episodes (DB inserts), see rows on Home, play one, open both Recent pages, desktop + mobile.
