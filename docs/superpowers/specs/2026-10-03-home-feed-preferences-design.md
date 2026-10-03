# Home Feed Preferences (B2: sections, hero, popular ranking, sizes) — Design

**Status:** Approved (design sections 1–4 approved in chat)

## Goal

Let each user shape the video home page: which sections appear and in what order, whether the hero block is shown, how "Populaires" is ranked, and how many items each row holds. The administrator sets instance defaults; users override. This is sub-project B2 and builds directly on the B1 preferences foundation (merged): same schema module, same storage, same routes, same form.

## Context

- `server/api/home/feed.get.ts` returns `{ featured: { large, small }, sections }`. Sections are built in a fixed order: `recent` (15, `created_at DESC`), `popular` (15), then for logged-in users `suggested` (15, `getRecommendedVideos`) and `subscriptions` (up to 8 channels × up to 12 videos, only channels with ≥ 2 unseen videos). Every video used by an earlier block is excluded from later ones (`usedIds` / `claim`). Pools are `LIMIT 30` (popular and recent).
- The hero: `featured.large` is `popularPool[0]`; `featured.small` is up to 4 videos (one personalised suggestion for logged-in users, then recents from channels the user is not subscribed to).
- `app/pages/index.vue` renders `feedSections` with a `v-for` in received order, so order needs no client change. **But** its empty state is `v-else-if="!featuredLarge && !searchQuery"`: with the hero hidden it would show "No videos found". This must change.
- B1 foundation: `shared/displayPrefs.ts` (schema, `validatePartial`, `mergePrefs`, `buildView`), `server/utils/displayPrefsStore.ts` (`getDisplayView`, `saveUserOverrides`, `saveAdminDefaults`), `user_preferences` table, `display_defaults` setting, `GET /api/settings/display`, `PUT /api/account/preferences`, `POST /api/admin/settings/display-defaults`, `useDisplayPrefs`, shared `DisplayPrefsForm.vue` (modes `user`/`admin`, force-resync after failed save).
- `user_history(user_id, video_id, watched_at, watch_time_seconds)` provides the data for the trending and watch-time rankings.

## Scope

**In scope:** five new preference keys; the feed honouring them; the form's "Accueil" subsection (account page and admin defaults panel); home empty-state fix.

**Out of scope:** weighting of "Suggéré pour toi", the source of the hero's large video beyond using the chosen popular ranking, hero small-slot content, theme/language, other pages' feeds.

## Schema additions (shared/displayPrefs.ts)

| Key | Values | Default |
|---|---|---|
| `homeSections` | ordered array of `recent`, `popular`, `suggested`, `subscriptions`; no duplicates, no unknown ids | `['recent','popular','suggested','subscriptions']` |
| `homeHero` | boolean | `true` |
| `popularRanking` | `localViewers` \| `youtubeViews` \| `trending7d` \| `watchTime` | `localViewers` |
| `rowSize` | `10` \| `15` \| `20` \| `30` | `15` |
| `subscriptionChannels` | `4` \| `8` \| `12` \| `16` | `8` |

- A section absent from `homeSections` is hidden. An array replaces, never merges (B1 rule). An empty array is valid (all sections hidden).
- Same semantics as B1: unknown keys ignored, invalid value → `InvalidPrefError` → 400 with nothing written, `null` removes a key, corrupt stored JSON = empty partial, resolution `APP_DEFAULTS → admin defaults → user overrides`.
- `suggested` and `subscriptions` are ignored for guests (no error).
- API shapes are unchanged; the new keys simply appear in `effective`, `defaults`, `overrides`, `adminDefaults`.

## Feed behaviour (server/api/home/feed.get.ts)

- Resolve the caller's effective prefs once via `getDisplayView` (guest → instance defaults). Any failure falls back to `APP_DEFAULTS`; the feed never fails because of preferences.
- With default preferences the feed is equivalent in shape and section order to the previous one but not byte-identical: pools are larger, the suggested candidate limit is `max(20, rowSize + 10)`, and suggestions are randomised.
- Build order: hero first (if `homeHero`), then sections in `homeSections` order, each excluding videos already claimed. Hidden hero: `featured` is `{ large: null, small: [] }` and reserves no videos.
- `popularRanking` changes only the popular pool's `ORDER BY` (also used to pick the hero's large video):
  - `localViewers`: distinct viewers DESC, `view_count` DESC (current behaviour);
  - `youtubeViews`: `view_count` DESC;
  - `trending7d`: distinct viewers with `watched_at` in the last 7 days DESC, then `view_count` DESC;
  - `watchTime`: `SUM(watch_time_seconds)` over the instance DESC, then `view_count` DESC.
- Row length is `rowSize`; subscriptions section shows up to `subscriptionChannels` channels (still ≥ 2 unseen videos each, up to 12 videos per channel as today).
- Recent and popular pools grow from 30 to 100 (60 proved too small: the hero, its 4 small slots and a 30-video recent row leave only 25 for popular) so `rowSize` 30 stays filled after exclusions.
- Response shape is unchanged: `{ featured, sections }`, each section `{ id, title, videos }` or `{ id, title, channels }`. Authentication (cookie or Bearer) and `moduleGate` behaviour are unchanged.

## Client

- `app/pages/index.vue`: empty state becomes "no hero **and** no sections"; when the library has videos but the user hid every block, show a dedicated message ("Ton accueil est vide : réactive des sections dans ton compte") instead of "No videos found". Section rendering order follows the response.
- `DisplayPrefsForm.vue` gains an "Accueil" subsection: one row per section (checkbox "afficher", label, ↑ / ↓ buttons; first cannot go up, last cannot go down), a "bloc vedette" checkbox, a popular-ranking select (Spectateurs locaux / Vues YouTube / Tendance 7 jours / Temps de visionnage), a row-size select, a subscription-channels select. Same behaviour as B1: save on change with toast, controls disabled while saving, force DOM resync from server state after any failed save, per-setting "Rétablir le défaut" link, admin mode edits instance defaults. Hiding/reordering sends the full `homeSections` array.
- The home page refetches the feed after preferences change (the feed's fetch key depends on the relevant preferences).

## Error handling

- Preferences unreadable: feed uses app defaults.
- Invalid write: 400, nothing written, form resyncs and shows the message.
- Every section hidden and hero off: valid; dedicated empty message.

## Testing

- Unit: schema validation of the five keys (invalid values, duplicates and unknown ids in `homeSections`, `null` removal, array replacement, empty array valid, corrupt JSON), including through `buildView`.
- Integration (`createTestDb` + `mockEvent`): feed with default prefs equals today's output; section order honoured; hidden section absent; hidden hero (no `large`/`small`, no reserved ids so videos fall into sections); a dataset where the four popular rankings give four different orders; `rowSize` and `subscriptionChannels` limits (including `rowSize` 30 with exclusions); guest with `suggested`/`subscriptions` configured; no video appears twice; admin defaults reach guests and users; user override wins; Bearer-token caller.
- Component: form (↑/↓ boundaries, checkbox, resync after failed save, reset links); home empty-state logic.
- Manual verification in a real Docker container with the Browser pane on the Mac's LAN IP, real clicks: reorder, hide, change ranking and sizes, check the home page, force a failed save (stop the container), admin defaults reaching a new user and a guest, hide everything.
