# Home Feed Preferences (B2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each user (with admin defaults) choose which home-feed sections appear and in what order, show/hide the hero, pick the "Populaires" ranking, and set row sizes.

**Architecture:** Extend the merged B1 display-preferences foundation (`shared/displayPrefs.ts` schema, `displayPrefsStore`, existing routes, `DisplayPrefsForm.vue`) with five new keys. `server/api/home/feed.get.ts` reads the caller's effective prefs and builds hero/sections accordingly; the response shape is unchanged. The home page only needs an empty-state fix.

**Tech Stack:** Nuxt 4, Nitro, better-sqlite3, Vue 3, Vitest (projects `server` and `component`).

## Global Constraints

Spec: `docs/superpowers/specs/2026-10-03-home-feed-preferences-design.md`. Branch: `feature/home-feed-preferences` (already created; never work on `main`). Commit trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

Schema additions (verbatim from the spec):

| Key | Values | Default |
|---|---|---|
| `homeSections` | ordered array of `recent`, `popular`, `suggested`, `subscriptions`; no duplicates, no unknown ids | `['recent','popular','suggested','subscriptions']` |
| `homeHero` | boolean | `true` |
| `popularRanking` | `localViewers` \| `youtubeViews` \| `trending7d` \| `watchTime` | `localViewers` |
| `rowSize` | `10` \| `15` \| `20` \| `30` | `15` |
| `subscriptionChannels` | `4` \| `8` \| `12` \| `16` | `8` |

- A section absent from `homeSections` is hidden. An array replaces, never merges. An empty array is valid. `suggested` and `subscriptions` are ignored for guests (no error).
- Same B1 semantics: unknown keys ignored; invalid value → `InvalidPrefError` → 400 with nothing written; `null` removes a key; corrupt stored JSON = empty partial; resolution `APP_DEFAULTS → admin defaults → user overrides`. API shapes unchanged.
- Ranking definitions: `localViewers`: distinct viewers DESC, `view_count` DESC (current behaviour); `youtubeViews`: `view_count` DESC; `trending7d`: distinct viewers with `watched_at` in the last 7 days DESC, then `view_count` DESC; `watchTime`: `SUM(watch_time_seconds)` over the instance DESC, then `view_count` DESC. The ranking also picks the hero's large video.
- Hero hidden: `featured` is `{ large: null, small: [] }` and reserves no videos. Recent and popular pools grow from 30 to 60. Response shape stays `{ featured, sections }`.
- Preferences unreadable → feed uses `APP_DEFAULTS`; the feed never fails because of preferences.
- App code imports shared code via `#shared/displayPrefs`; server code uses relative paths. Form controls bound one-way (`:checked`, `:value`) must be force-resynced from state in a `finally` after any failed save. Tests follow repo conventions (`createTestDb`, `mockEvent`, `(globalThis as any).getDb = () => db`; loginAs helpers called at most once per userId per test).

---

### Task 1: Schema keys (shared/displayPrefs.ts)

**Files:**
- Modify: `shared/displayPrefs.ts`
- Modify: `server/utils/displayPrefsStore.ts:72` (error message)
- Modify (expectations): `tests/unit/displayPrefs.test.ts:15,95,129,130`, `tests/integration/display-preferences.test.ts:48`, `tests/component/useDisplayPrefs.test.ts:22`
- Test: `tests/unit/displayPrefs.test.ts`

**Interfaces:**
- Produces (exports from `shared/displayPrefs.ts`): `HomeSectionId`, `HOME_SECTION_IDS`, `PopularRanking`, `POPULAR_RANKINGS`, `ROW_SIZES`, `SUBSCRIPTION_CHANNEL_COUNTS`; `DisplayPrefs` gains `homeSections: HomeSectionId[]`, `homeHero: boolean`, `popularRanking: PopularRanking`, `rowSize: number`, `subscriptionChannels: number`; `PREF_KEYS` lists all eight keys; `APP_DEFAULTS` as in the table.

- [ ] **Step 1: Add failing tests** to `tests/unit/displayPrefs.test.ts` (append, importing the new names from `../../shared/displayPrefs` alongside the existing imports):

```typescript
describe('home feed keys', () => {
  it('has the documented home feed defaults', () => {
    expect(APP_DEFAULTS.homeSections).toEqual(['recent', 'popular', 'suggested', 'subscriptions']);
    expect(APP_DEFAULTS.homeHero).toBe(true);
    expect(APP_DEFAULTS.popularRanking).toBe('localViewers');
    expect(APP_DEFAULTS.rowSize).toBe(15);
    expect(APP_DEFAULTS.subscriptionChannels).toBe(8);
  });

  it('accepts valid values', () => {
    const r = validatePartial({
      homeSections: ['popular', 'recent'], homeHero: false, popularRanking: 'watchTime', rowSize: 30, subscriptionChannels: 16,
    });
    expect(r.set).toEqual({
      homeSections: ['popular', 'recent'], homeHero: false, popularRanking: 'watchTime', rowSize: 30, subscriptionChannels: 16,
    });
  });

  it('accepts an empty homeSections array (all hidden)', () => {
    expect(validatePartial({ homeSections: [] }).set).toEqual({ homeSections: [] });
  });

  it.each([
    [{ homeSections: ['recent', 'recent'] }],
    [{ homeSections: ['recent', 'bogus'] }],
    [{ homeSections: 'recent' }],
    [{ homeHero: 'yes' }],
    [{ popularRanking: 'random' }],
    [{ rowSize: 12 }],
    [{ rowSize: '15' }],
    [{ subscriptionChannels: 7 }],
  ])('rejects invalid value %j', (input) => {
    expect(() => validatePartial(input)).toThrow(InvalidPrefError);
  });

  it('treats null as removal for the new keys', () => {
    expect(validatePartial({ rowSize: null, homeSections: null }).remove).toEqual(['homeSections', 'rowSize']);
  });

  it('mergePrefs replaces homeSections instead of merging', () => {
    expect(mergePrefs(APP_DEFAULTS, { homeSections: ['popular'] }).homeSections).toEqual(['popular']);
  });

  it('mergePrefs copies homeSections so callers cannot mutate the defaults', () => {
    const merged = mergePrefs(APP_DEFAULTS, null);
    merged.homeSections.push('recent');
    expect(APP_DEFAULTS.homeSections).toEqual(['recent', 'popular', 'suggested', 'subscriptions']);
  });

  it('parseStoredPartial drops a stored row holding an invalid new value', () => {
    expect(parseStoredPartial(JSON.stringify({ rowSize: 99 }))).toEqual({});
  });

  it('buildView resolves the new keys admin → user', () => {
    const view = buildView({ popularRanking: 'youtubeViews', rowSize: 10 }, { rowSize: 20 });
    expect(view.defaults.rowSize).toBe(10);
    expect(view.effective.rowSize).toBe(20);
    expect(view.effective.popularRanking).toBe('youtubeViews');
  });
});
```

- [ ] **Step 2: Run:** `npx vitest run tests/unit/displayPrefs.test.ts` — Expected: the new tests FAIL (names undefined / defaults missing).

- [ ] **Step 3: Implement** in `shared/displayPrefs.ts`. Add after `HIDEABLE_NAV_LINKS`:

```typescript
export type HomeSectionId = 'recent' | 'popular' | 'suggested' | 'subscriptions';
export type PopularRanking = 'localViewers' | 'youtubeViews' | 'trending7d' | 'watchTime';

export const HOME_SECTION_IDS: readonly HomeSectionId[] = ['recent', 'popular', 'suggested', 'subscriptions'];
export const POPULAR_RANKINGS: readonly PopularRanking[] = ['localViewers', 'youtubeViews', 'trending7d', 'watchTime'];
export const ROW_SIZES: readonly number[] = [10, 15, 20, 30];
export const SUBSCRIPTION_CHANNEL_COUNTS: readonly number[] = [4, 8, 12, 16];
```

Extend the interface, keys and defaults:

```typescript
export interface DisplayPrefs {
  density: Density;
  hiddenNavLinks: string[];
  landingSpace: LandingSpace;
  homeSections: HomeSectionId[];
  homeHero: boolean;
  popularRanking: PopularRanking;
  rowSize: number;
  subscriptionChannels: number;
}
export const PREF_KEYS: readonly PrefKey[] = [
  'density', 'hiddenNavLinks', 'landingSpace',
  'homeSections', 'homeHero', 'popularRanking', 'rowSize', 'subscriptionChannels',
];
export const APP_DEFAULTS: DisplayPrefs = {
  density: 'comfortable',
  hiddenNavLinks: [],
  landingSpace: 'auto',
  homeSections: ['recent', 'popular', 'suggested', 'subscriptions'],
  homeHero: true,
  popularRanking: 'localViewers',
  rowSize: 15,
  subscriptionChannels: 8,
};
```

Replace `validateValue` with a version that handles every key (keep the existing density/landingSpace/hiddenNavLinks logic unchanged, but order the checks as separate `if (key === …)` branches — the final unguarded array code must become the explicit `hiddenNavLinks` branch):

```typescript
function validateValue(key: PrefKey, value: unknown): DisplayPrefs[PrefKey] {
  if (key === 'density') {
    if (typeof value === 'string' && (DENSITIES as readonly string[]).includes(value)) return value as Density;
    throw new InvalidPrefError(key, `density must be one of: ${DENSITIES.join(', ')}.`);
  }
  if (key === 'landingSpace') {
    if (typeof value === 'string' && (LANDING_SPACES as readonly string[]).includes(value)) return value as LandingSpace;
    throw new InvalidPrefError(key, `landingSpace must be one of: ${LANDING_SPACES.join(', ')}.`);
  }
  if (key === 'homeHero') {
    if (typeof value === 'boolean') return value;
    throw new InvalidPrefError(key, 'homeHero must be a boolean.');
  }
  if (key === 'popularRanking') {
    if (typeof value === 'string' && (POPULAR_RANKINGS as readonly string[]).includes(value)) return value as PopularRanking;
    throw new InvalidPrefError(key, `popularRanking must be one of: ${POPULAR_RANKINGS.join(', ')}.`);
  }
  if (key === 'rowSize') {
    if (typeof value === 'number' && ROW_SIZES.includes(value)) return value;
    throw new InvalidPrefError(key, `rowSize must be one of: ${ROW_SIZES.join(', ')}.`);
  }
  if (key === 'subscriptionChannels') {
    if (typeof value === 'number' && SUBSCRIPTION_CHANNEL_COUNTS.includes(value)) return value;
    throw new InvalidPrefError(key, `subscriptionChannels must be one of: ${SUBSCRIPTION_CHANNEL_COUNTS.join(', ')}.`);
  }
  if (key === 'homeSections') {
    if (!Array.isArray(value)) throw new InvalidPrefError(key, 'homeSections must be an array.');
    const seen = new Set<string>();
    for (const item of value) {
      if (typeof item !== 'string' || !(HOME_SECTION_IDS as readonly string[]).includes(item)) {
        throw new InvalidPrefError(key, `homeSections may only contain: ${HOME_SECTION_IDS.join(', ')}.`);
      }
      if (seen.has(item)) throw new InvalidPrefError(key, 'homeSections must not contain duplicates.');
      seen.add(item);
    }
    return [...value] as HomeSectionId[];
  }
  // hiddenNavLinks
  if (!Array.isArray(value)) {
    throw new InvalidPrefError(key, 'hiddenNavLinks must be an array.');
  }
  const allowed = HIDEABLE_NAV_LINKS as readonly string[];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string' || !allowed.includes(item)) {
      throw new InvalidPrefError(key, `hiddenNavLinks may only contain: ${allowed.join(', ')}.`);
    }
    if (seen.has(item)) {
      throw new InvalidPrefError(key, 'hiddenNavLinks must not contain duplicates.');
    }
    seen.add(item);
  }
  return [...value] as string[];
}
```

Replace `mergePrefs`:

```typescript
export function mergePrefs(base: DisplayPrefs, partial: PrefsPartial | null | undefined): DisplayPrefs {
  return {
    density: partial?.density ?? base.density,
    hiddenNavLinks: [...(partial?.hiddenNavLinks ?? base.hiddenNavLinks)],
    landingSpace: partial?.landingSpace ?? base.landingSpace,
    homeSections: [...(partial?.homeSections ?? base.homeSections)],
    homeHero: partial?.homeHero ?? base.homeHero,
    popularRanking: partial?.popularRanking ?? base.popularRanking,
    rowSize: partial?.rowSize ?? base.rowSize,
    subscriptionChannels: partial?.subscriptionChannels ?? base.subscriptionChannels,
  };
}
```

In `server/utils/displayPrefsStore.ts` change the message to `'At least one display preference (density, hiddenNavLinks, landingSpace, homeSections, homeHero, popularRanking, rowSize, subscriptionChannels) is required.'`.

- [ ] **Step 4: Update existing literal expectations** for the widened defaults. The five `toEqual({ density…, hiddenNavLinks…, landingSpace… })` assertions listed under **Files** now also contain the five new keys at their defaults; rewrite each as `{ ...APP_DEFAULTS, density: 'compact', … }`-style (import `APP_DEFAULTS` where missing) so they keep asserting only what they mean to. Run `npx vitest run` and fix any other failure caused by the widened shape (grep for `hiddenNavLinks:` in `tests/`).

- [ ] **Step 5: Run:** `npx vitest run` — Expected: all pass.

- [ ] **Step 6: Mutation check.** Temporarily change `ROW_SIZES` to include `12`; confirm the `rejects invalid value {"rowSize":12}` test fails; revert.

- [ ] **Step 7: Commit**

```bash
git add shared/displayPrefs.ts server/utils/displayPrefsStore.ts tests
git commit -m "feat: home feed preference keys in the display prefs schema

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Feed honours preferences (server)

**Files:**
- Modify: `server/api/home/feed.get.ts`
- Create: `tests/integration/home-feed-prefs.test.ts`

**Interfaces:**
- Consumes: `getDisplayView(db, userId | null): DisplayView` from `server/utils/displayPrefsStore.ts`; `APP_DEFAULTS`, `HomeSectionId`, `PopularRanking`, `DisplayPrefs` from `../../../shared/displayPrefs`; test helpers `insertSetting`, `insertUserPreferences`, `insertUserHistory`, `insertSubscription`.
- Produces: unchanged response shape `{ featured: { large, small }, sections }`.

- [ ] **Step 1: Write the failing tests** — create `tests/integration/home-feed-prefs.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import handler from '../../server/api/home/feed.get';
import {
  createTestDb, insertUser, insertSession, insertChannel, insertVideo, insertUserHistory,
  insertSubscription, insertSetting, insertUserPreferences, mockEvent, sessionCookie,
} from '../helpers/testDb';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
});

function loginAs(userId: string) {
  insertUser(db, { id: userId, role: 'user' });
  insertSession(db, { id: `sess-${userId}`, userId });
  return mockEvent(sessionCookie(`sess-${userId}`));
}
const guestEvent = () => mockEvent();
const setAdminDefaults = (prefs: object) => insertSetting(db, { key: 'display_defaults', value: JSON.stringify(prefs) });
const ids = (section: any) => section.videos.map((v: any) => v.id);
const sectionIds = (r: any) => r.sections.map((s: any) => s.id);

function seedVideos(n: number, channelId = 'c1') {
  insertChannel(db, { id: channelId });
  for (let i = 0; i < n; i++) {
    insertVideo(db, { id: `${channelId}v${i}`, channelId, uploadDate: '20260101', viewCount: 1000 - i, createdAt: Date.now() - i * 1000 });
  }
}

describe('feed with default preferences', () => {
  it('keeps the historical order recent → popular for a guest', async () => {
    seedVideos(40);
    const r: any = await handler(guestEvent());
    expect(sectionIds(r)).toEqual(['recent', 'popular']);
    expect(r.featured.large).not.toBeNull();
  });
});

describe('homeSections', () => {
  it('honours the configured order', async () => {
    seedVideos(40);
    setAdminDefaults({ homeSections: ['popular', 'recent'] });
    const r: any = await handler(guestEvent());
    expect(sectionIds(r)).toEqual(['popular', 'recent']);
  });

  it('omits a section that is not listed', async () => {
    seedVideos(40);
    setAdminDefaults({ homeSections: ['recent'] });
    const r: any = await handler(guestEvent());
    expect(sectionIds(r)).toEqual(['recent']);
  });

  it('returns no sections but still a hero when the list is empty', async () => {
    seedVideos(10);
    setAdminDefaults({ homeSections: [] });
    const r: any = await handler(guestEvent());
    expect(r.sections).toEqual([]);
    expect(r.featured.large).not.toBeNull();
  });

  it('ignores suggested and subscriptions for a guest without failing', async () => {
    seedVideos(40);
    setAdminDefaults({ homeSections: ['suggested', 'subscriptions', 'recent'] });
    const r: any = await handler(guestEvent());
    expect(sectionIds(r)).toEqual(['recent']);
  });

  it('never repeats a video across hero and sections whatever the order', async () => {
    seedVideos(60);
    setAdminDefaults({ homeSections: ['popular', 'recent'] });
    const r: any = await handler(guestEvent());
    const all = [r.featured.large?.id, ...r.featured.small.map((v: any) => v.id), ...r.sections.flatMap(ids)].filter(Boolean);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('homeHero', () => {
  it('returns an empty hero and reserves no video when hidden', async () => {
    seedVideos(5);
    setAdminDefaults({ homeHero: false, homeSections: ['popular'] });
    const r: any = await handler(guestEvent());
    expect(r.featured).toEqual({ large: null, small: [] });
    // c1v0 has the highest view_count: with the hero on it would be the hero; hidden, it leads the popular row.
    expect(ids(r.sections[0])[0]).toBe('c1v0');
    expect(ids(r.sections[0])).toHaveLength(5);
  });
});

describe('popularRanking', () => {
  function seedRankingDataset() {
    insertChannel(db, { id: 'c1' });
    const now = Date.now();
    const old = now - 30 * 24 * 3600 * 1000;
    for (const [id, views] of [['A', 1000], ['B', 10], ['C', 500], ['D', 1]] as const) {
      insertVideo(db, { id, channelId: 'c1', viewCount: views, createdAt: now });
    }
    for (const u of ['u1', 'u2', 'u3']) insertUser(db, { id: u, role: 'user' });
    insertUserHistory(db, { userId: 'u1', videoId: 'B', watchTimeSeconds: 5, watchedAt: old });
    insertUserHistory(db, { userId: 'u2', videoId: 'B', watchTimeSeconds: 5, watchedAt: old });
    insertUserHistory(db, { userId: 'u1', videoId: 'C', watchTimeSeconds: 100, watchedAt: now });
    insertUserHistory(db, { userId: 'u1', videoId: 'D', watchTimeSeconds: 1, watchedAt: old });
    insertUserHistory(db, { userId: 'u2', videoId: 'D', watchTimeSeconds: 1, watchedAt: old });
    insertUserHistory(db, { userId: 'u3', videoId: 'D', watchTimeSeconds: 1, watchedAt: old });
  }

  it.each([
    ['localViewers', ['D', 'B', 'C', 'A']],
    ['youtubeViews', ['A', 'C', 'B', 'D']],
    ['trending7d', ['C', 'A', 'B', 'D']],
    ['watchTime', ['C', 'B', 'D', 'A']],
  ])('%s orders the popular row as %j', async (ranking, expected) => {
    seedRankingDataset();
    setAdminDefaults({ homeHero: false, homeSections: ['popular'], popularRanking: ranking });
    const r: any = await handler(guestEvent());
    expect(ids(r.sections[0])).toEqual(expected);
  });

  it('also uses the ranking to choose the hero large video', async () => {
    seedRankingDataset();
    setAdminDefaults({ popularRanking: 'youtubeViews' });
    const r: any = await handler(guestEvent());
    expect(r.featured.large.id).toBe('A');
  });
});

describe('sizes', () => {
  it('limits a row to rowSize', async () => {
    seedVideos(40);
    setAdminDefaults({ homeHero: false, homeSections: ['popular'], rowSize: 10 });
    const r: any = await handler(guestEvent());
    expect(ids(r.sections[0])).toHaveLength(10);
  });

  it('fills a 30-video row even after the hero and earlier sections claimed videos', async () => {
    seedVideos(80);
    setAdminDefaults({ homeSections: ['recent', 'popular'], rowSize: 30 });
    const r: any = await handler(guestEvent());
    expect(ids(r.sections.find((s: any) => s.id === 'recent'))).toHaveLength(30);
    expect(ids(r.sections.find((s: any) => s.id === 'popular'))).toHaveLength(30);
  });

  it('limits the subscription channels to subscriptionChannels', async () => {
    const event = loginAs('u1');
    for (let c = 0; c < 6; c++) {
      seedVideos(3, `ch${c}`);
      insertSubscription(db, { userId: 'u1', channelId: `ch${c}` });
    }
    setAdminDefaults({ homeHero: false, homeSections: ['subscriptions'], subscriptionChannels: 4 });
    const r: any = await handler(event);
    expect(r.sections[0].channels).toHaveLength(4);
  });
});

describe('preference sources', () => {
  it('a user override wins over the admin default', async () => {
    seedVideos(40);
    const event = loginAs('u1');
    setAdminDefaults({ homeSections: ['recent'] });
    insertUserPreferences(db, { userId: 'u1', data: JSON.stringify({ homeSections: ['popular'] }) });
    const r: any = await handler(event);
    expect(sectionIds(r)).toEqual(['popular']);
  });

  it('a corrupt stored row falls back to defaults without failing', async () => {
    seedVideos(40);
    const event = loginAs('u1');
    insertUserPreferences(db, { userId: 'u1', data: '{not json' });
    const r: any = await handler(event);
    expect(sectionIds(r)).toContain('recent');
  });
});
```

Also add one Bearer-token case: open `tests/integration/apiTokenAuth.test.ts`, copy how it builds a caller with `createApiToken` + `mockEvent(undefined, { headers: { authorization: 'Bearer …' } })`, and add a test here that such a caller with `insertUserPreferences({ homeSections: ['popular'] })` gets `['popular']`.

- [ ] **Step 2: Run:** `npx vitest run tests/integration/home-feed-prefs.test.ts` — Expected: FAIL (order/hero/ranking/sizes not honoured).

- [ ] **Step 3: Implement.** In `server/api/home/feed.get.ts`:

Add imports:

```typescript
import { getDisplayView } from '../../utils/displayPrefsStore';
import { APP_DEFAULTS } from '../../../shared/displayPrefs';
import type { DisplayPrefs, HomeSectionId, PopularRanking } from '../../../shared/displayPrefs';
```

Add above the handler (the map values are constants, never user input; `cutoff` is a number computed here):

```typescript
const SECTION_TITLES: Record<HomeSectionId, string> = {
  recent: 'Ajoutés récemment',
  popular: 'Populaires',
  suggested: 'Suggéré pour toi',
  subscriptions: 'Par chaîne suivie',
};

const POPULAR_ORDER: Record<PopularRanking, string> = {
  localViewers: 'local_viewers DESC, v.view_count DESC',
  youtubeViews: 'v.view_count DESC',
  trending7d: 'recent_viewers DESC, v.view_count DESC',
  watchTime: 'watch_total DESC, v.view_count DESC',
};

const POOL_SIZE = 60;
const TRENDING_WINDOW_MS = 7 * 24 * 3600 * 1000;

function readPrefs(db: any, userId: string | null): DisplayPrefs {
  try {
    return getDisplayView(db, userId).effective;
  } catch {
    return APP_DEFAULTS;
  }
}
```

In the handler: after `const hidden = …` add `const prefs = readPrefs(db, session?.id ?? null);` and `const cutoff = Date.now() - TRENDING_WINDOW_MS;`. Replace the popular pool query so it selects the three metric columns and uses the ranking, and raise both pools to `POOL_SIZE`:

```typescript
  const popularPool = db.prepare(`
    SELECT ${FEED_VIDEO_COLUMNS},
           (SELECT COUNT(DISTINCT user_id) FROM user_history WHERE video_id = v.id) as local_viewers,
           (SELECT COUNT(DISTINCT user_id) FROM user_history WHERE video_id = v.id AND watched_at >= ${cutoff}) as recent_viewers,
           (SELECT COALESCE(SUM(watch_time_seconds), 0) FROM user_history WHERE video_id = v.id) as watch_total
    FROM videos v
    JOIN channels c ON v.channel_id = c.id
    WHERE v.download_status = 'completed'
      AND ${visibility.sql}
      ${hidden.sql}
    ORDER BY ${POPULAR_ORDER[prefs.popularRanking] ?? POPULAR_ORDER.localViewers}
    LIMIT ${POOL_SIZE}
  `).all(...visibility.params, ...hidden.params) as FeedVideo[];
```

(and `LIMIT ${POOL_SIZE}` in `recentPool`). Replace the "Featured block" and "Sections" code with:

```typescript
  // --- Featured block ---
  let large: FeedVideo | null = null;
  const small: FeedVideo[] = [];

  // Videos from channels the user is subscribed to are reserved for the
  // dedicated "subscriptions" section and are not spent filling the generic
  // featured "small" slots, which draw from unsubscribed content.
  let subscribedChannelIds: Set<string> = new Set();
  if (session) {
    const subRows = db.prepare(`
      SELECT channel_id FROM user_subscriptions WHERE user_id = ?
    `).all(session.id) as { channel_id: string }[];
    subscribedChannelIds = new Set(subRows.map(r => r.channel_id));
  }

  if (prefs.homeHero) {
    large = popularPool[0] ?? null;
    if (large) usedIds.add(large.id);

    if (session) {
      const suggestions = getRecommendedVideos(db, session.id, { type: 'all', limit: 10 }) as unknown as FeedVideo[];
      const suggestion = suggestions.find(v => !usedIds.has(v.id) && !subscribedChannelIds.has(v.channel_id));
      if (suggestion) {
        small.push(suggestion);
        usedIds.add(suggestion.id);
      }
    }
    for (const v of recentPool) {
      if (small.length >= 4) break;
      if (usedIds.has(v.id)) continue;
      if (subscribedChannelIds.has(v.channel_id)) continue;
      small.push(v);
      usedIds.add(v.id);
    }
  }

  // --- Sections, built in the configured order ---
  const sections: any[] = [];
  const rowSize = prefs.rowSize;

  const builders: Record<HomeSectionId, () => any | null> = {
    recent: () => {
      const videos = claim(recentPool.filter(v => !usedIds.has(v.id)).slice(0, rowSize));
      return videos.length > 0 ? { id: 'recent', title: SECTION_TITLES.recent, videos } : null;
    },
    popular: () => {
      const videos = claim(popularPool.filter(v => !usedIds.has(v.id)).slice(0, rowSize));
      return videos.length > 0 ? { id: 'popular', title: SECTION_TITLES.popular, videos } : null;
    },
    suggested: () => {
      if (!session) return null;
      const suggestions = getRecommendedVideos(db, session.id, { type: 'all', limit: Math.max(20, rowSize + 10) }) as unknown as FeedVideo[];
      const videos = claim(suggestions.filter(v => !usedIds.has(v.id)).slice(0, rowSize));
      return videos.length > 0 ? { id: 'suggested', title: SECTION_TITLES.suggested, videos } : null;
    },
    subscriptions: () => {
      if (!session) return null;
      const subChannels = db.prepare(`
        SELECT c.id, c.title, c.avatar_url
        FROM channels c
        JOIN user_subscriptions us ON us.channel_id = c.id
        WHERE us.user_id = ?
        ORDER BY us.created_at DESC
      `).all(session.id) as { id: string; title: string; avatar_url: string | null }[];

      const subscriptionChannels: any[] = [];
      for (const ch of subChannels) {
        if (subscriptionChannels.length >= prefs.subscriptionChannels) break;
        const chVideos = db.prepare(`
          SELECT ${FEED_VIDEO_COLUMNS}
          FROM videos v
          JOIN channels c ON v.channel_id = c.id
          WHERE v.channel_id = ?
            AND v.download_status = 'completed'
            AND ${visibility.sql}
            ${hidden.sql}
          ORDER BY v.created_at DESC
          LIMIT 20
        `).all(ch.id, ...visibility.params, ...hidden.params) as FeedVideo[];
        const filtered = chVideos.filter(v => !usedIds.has(v.id));
        if (filtered.length >= 2) {
          subscriptionChannels.push({
            channelId: ch.id,
            channelTitle: ch.title,
            channelAvatar: ch.avatar_url,
            videos: claim(filtered.slice(0, 12))
          });
        }
      }
      return subscriptionChannels.length > 0
        ? { id: 'subscriptions', title: SECTION_TITLES.subscriptions, channels: subscriptionChannels }
        : null;
    },
  };

  for (const sectionId of prefs.homeSections) {
    const section = builders[sectionId]?.();
    if (section) sections.push(section);
  }

  return {
    featured: { large, small },
    sections
  };
```

Remove the old "Featured block"/"Sections" code and the old trailing `return` so only the new code remains. Keep the existing `claim`/`usedIds` helpers above it.

- [ ] **Step 4: Run:** `npx vitest run tests/integration/home-feed-prefs.test.ts tests/integration/home-feed.test.ts` — Expected: all pass (the pre-existing feed tests must still pass unchanged).

- [ ] **Step 5: Mutation checks.** (a) Change `POPULAR_ORDER.watchTime` to the `youtubeViews` string: the `watchTime` ranking case must fail. (b) Make `hero` ignore `prefs.homeHero` (always true): the hidden-hero test must fail. (c) Change `slice(0, rowSize)` in `popular` to `slice(0, 15)`: the `rowSize 10` test must fail. Revert each.

- [ ] **Step 6: Full suite** `npx vitest run`, then commit:

```bash
git add server/api/home/feed.get.ts tests/integration/home-feed-prefs.test.ts
git commit -m "feat: home feed honours section order, hero, popular ranking and sizes

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Home page empty states

**Files:**
- Modify: `app/utils/displayPrefs.ts` (add `isHomeFullyHidden`)
- Modify: `app/pages/index.vue` (template lines ~10-20, script near line 196)
- Test: `tests/unit/displayPrefsClient.test.ts`

**Interfaces:**
- Produces: `isHomeFullyHidden(prefs: Pick<DisplayPrefs, 'homeHero' | 'homeSections'>, loggedIn: boolean): boolean` — true when the hero is off and no section the viewer can see is listed (guests cannot see `suggested`/`subscriptions`).

- [ ] **Step 1: Failing tests** — append to `tests/unit/displayPrefsClient.test.ts` (import `isHomeFullyHidden` from `../../app/utils/displayPrefs`):

```typescript
describe('isHomeFullyHidden', () => {
  it('is false while the hero is shown', () => {
    expect(isHomeFullyHidden({ homeHero: true, homeSections: [] }, true)).toBe(false);
  });
  it('is true with no hero and no sections', () => {
    expect(isHomeFullyHidden({ homeHero: false, homeSections: [] }, true)).toBe(true);
  });
  it('is false with no hero but a visible section', () => {
    expect(isHomeFullyHidden({ homeHero: false, homeSections: ['recent'] }, false)).toBe(false);
  });
  it('treats suggested/subscriptions as invisible to a guest', () => {
    expect(isHomeFullyHidden({ homeHero: false, homeSections: ['suggested', 'subscriptions'] }, false)).toBe(true);
    expect(isHomeFullyHidden({ homeHero: false, homeSections: ['suggested'] }, true)).toBe(false);
  });
});
```

- [ ] **Step 2:** `npx vitest run tests/unit/displayPrefsClient.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement** in `app/utils/displayPrefs.ts` (extend the type import to include `DisplayPrefs`):

```typescript
const GUEST_SECTIONS = ['recent', 'popular'];

// True when nothing at all is configured to appear on the video home for this viewer.
export function isHomeFullyHidden(
  prefs: Pick<DisplayPrefs, 'homeHero' | 'homeSections'>,
  loggedIn: boolean
): boolean {
  if (prefs.homeHero) return false;
  const visible = loggedIn ? prefs.homeSections : prefs.homeSections.filter((id) => GUEST_SECTIONS.includes(id));
  return visible.length === 0;
}
```

In `app/pages/index.vue` script, near the other computeds (needs `useDisplayPrefs` and `useAuth`, both auto-imported):

```typescript
const { effective: displayPrefs } = useDisplayPrefs();
const auth = useAuth();
const homeFullyHidden = computed(() => isHomeFullyHidden(displayPrefs.value, auth.isLoggedIn.value));
```

(import `isHomeFullyHidden` from `~/utils/displayPrefs` if utils are not auto-imported — mirror how `layouts/default.vue` imports `filterNavLinks`.) Template: replace the existing Empty block with two blocks:

```vue
    <!-- Home deliberately emptied by the viewer's preferences -->
    <EmptyState
      v-else-if="!searchQuery && homeFullyHidden"
      title="Ton accueil est vide"
      description="Tu as masqué le bloc vedette et toutes les sections. Réactive-en dans les préférences d'affichage de ton compte."
      icon="video"
      :action-text="auth.isLoggedIn.value ? 'Ouvrir mon compte' : undefined"
      action-route="/account"
    />

    <!-- Empty library -->
    <EmptyState
      v-else-if="!featuredLarge && feedSections.length === 0 && !searchQuery"
      title="No videos found"
      description="Your archive is empty. Log in as administrator to add channels or videos."
      icon="video"
      :action-text="isAdmin ? 'Go to downloads' : undefined"
      action-route="/settings?tab=downloads"
    />
```

- [ ] **Step 4:** `npx vitest run tests/unit/displayPrefsClient.test.ts` then `npx vitest run` — Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add app/utils/displayPrefs.ts app/pages/index.vue tests/unit/displayPrefsClient.test.ts
git commit -m "feat: home empty states account for a hidden hero and hidden sections

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

Note: no client-side feed refetch is added. Nuxt 4's `useFetch` refetches on each page mount; the preferences are edited on `/account` (or Settings), so the home always refetches when revisited. Task 5 verifies this in a real browser.

---

### Task 4: Form "Accueil" subsection

**Files:**
- Modify: `app/components/DisplayPrefsForm.vue`
- Create: `tests/component/DisplayPrefsForm.test.ts`

**Interfaces:**
- Consumes: `useDisplayPrefs()` → `{ view, saveOverrides, saveAdminDefaults, refresh }` (existing); `HOME_SECTION_IDS`, `POPULAR_RANKINGS`, `ROW_SIZES`, `SUBSCRIPTION_CHANNEL_COUNTS`, `HomeSectionId` from `#shared/displayPrefs`.
- Produces: a block at the end of the template with: per-section rows (`data-testid="section-row-<id>"`, checkbox, ↑ button `data-testid="up-<id>"`, ↓ button `data-testid="down-<id>"`), a hero checkbox `data-testid="hero-toggle"`, selects with ids `${uid}-ranking`, `${uid}-rowsize`, `${uid}-subchannels`.

- [ ] **Step 1: Failing component tests** — create `tests/component/DisplayPrefsForm.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import DisplayPrefsForm from '../../app/components/DisplayPrefsForm.vue';
import { buildView } from '../../shared/displayPrefs';

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('$fetch', fetchMock);
  useState<any>('display_prefs').value = buildView({}, {});
  useState<any>('display_prefs_for').value = undefined;
});
afterEach(() => vi.unstubAllGlobals());

const rowOrder = (w: any) =>
  w.findAll('[data-testid^="section-row-"]').map((r: any) => r.attributes('data-testid').replace('section-row-', ''));

describe('DisplayPrefsForm — home section', () => {
  it('lists visible sections in order, then hidden ones', async () => {
    useState<any>('display_prefs').value = buildView({}, { homeSections: ['popular', 'recent'] });
    const w = await mountSuspended(DisplayPrefsForm, { props: { mode: 'user' } });
    expect(rowOrder(w)).toEqual(['popular', 'recent', 'suggested', 'subscriptions']);
  });

  it('disables ↑ on the first visible row and ↓ on the last visible row', async () => {
    const w = await mountSuspended(DisplayPrefsForm, { props: { mode: 'user' } });
    expect(w.find('[data-testid="up-recent"]').attributes('disabled')).toBeDefined();
    expect(w.find('[data-testid="down-subscriptions"]').attributes('disabled')).toBeDefined();
    expect(w.find('[data-testid="down-recent"]').attributes('disabled')).toBeUndefined();
  });

  it('sends the swapped array when ↓ is clicked', async () => {
    fetchMock.mockResolvedValue(buildView({}, { homeSections: ['popular', 'recent', 'suggested', 'subscriptions'] }));
    const w = await mountSuspended(DisplayPrefsForm, { props: { mode: 'user' } });
    await w.find('[data-testid="down-recent"]').trigger('click');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/account/preferences');
    expect(opts.body).toEqual({ homeSections: ['popular', 'recent', 'suggested', 'subscriptions'] });
  });

  it('removes a section from the array when its checkbox is unticked', async () => {
    fetchMock.mockResolvedValue(buildView({}, { homeSections: ['recent', 'suggested', 'subscriptions'] }));
    const w = await mountSuspended(DisplayPrefsForm, { props: { mode: 'user' } });
    const box = w.find('[data-testid="section-row-popular"] input[type="checkbox"]');
    await box.setValue(false);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][1].body).toEqual({ homeSections: ['recent', 'suggested', 'subscriptions'] });
  });

  it('appends a re-enabled section at the end', async () => {
    useState<any>('display_prefs').value = buildView({}, { homeSections: ['recent'] });
    fetchMock.mockResolvedValue(buildView({}, { homeSections: ['recent', 'popular'] }));
    const w = await mountSuspended(DisplayPrefsForm, { props: { mode: 'user' } });
    await w.find('[data-testid="section-row-popular"] input[type="checkbox"]').setValue(true);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][1].body).toEqual({ homeSections: ['recent', 'popular'] });
  });

  it('snaps the hero checkbox back after a failed save', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/settings/display') return buildView({}, {});
      throw { data: { statusMessage: 'nope' } };
    });
    const w = await mountSuspended(DisplayPrefsForm, { props: { mode: 'user' } });
    const box = w.find('[data-testid="hero-toggle"]');
    expect((box.element as HTMLInputElement).checked).toBe(true);
    await box.setValue(false);
    await vi.waitFor(() => expect((box.element as HTMLInputElement).checked).toBe(true));
  });

  it('sends numbers (not strings) for the size selects', async () => {
    fetchMock.mockResolvedValue(buildView({}, { rowSize: 20 }));
    const w = await mountSuspended(DisplayPrefsForm, { props: { mode: 'user' } });
    await w.find('select[id$="-rowsize"]').setValue('20');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][1].body).toEqual({ rowSize: 20 });
  });
});
```

Before relying on the call shape, read `app/composables/useDisplayPrefs.ts` `saveOverrides`/`saveAdminDefaults` (lines ~32-44) and adjust the `fetchMock.mock.calls[0]` assertions (`url`, `opts.body`, method) to exactly what those functions pass to `$fetch`; the ordering/boundary/resync assertions stay as written.

- [ ] **Step 2:** `npx vitest run tests/component/DisplayPrefsForm.test.ts` — Expected: FAIL (no such elements).

- [ ] **Step 3: Implement.** In the template, after the Landing space block, add:

```vue
    <!-- Home page -->
    <div class="pref-block">
      <div class="pref-head">
        <span class="form-label">Sections de l'accueil</span>
        <a v-if="isOverridden('homeSections')" href="#" class="reset-link" @click.prevent="resetKey('homeSections')">Rétablir le défaut{{ mode === 'user' ? " de l'instance" : '' }}</a>
      </div>
      <div v-for="(row, index) in sectionRows" :key="row.id" class="section-row" :data-testid="`section-row-${row.id}`">
        <label class="check-row">
          <input type="checkbox" :checked="row.visible" :disabled="saving" @change="onSectionToggle(row.id, $event)" />
          <span>{{ SECTION_LABELS[row.id] }}</span>
        </label>
        <span class="move-buttons">
          <button type="button" class="move-btn" :data-testid="`up-${row.id}`" :disabled="saving || !row.visible || index === 0" aria-label="Monter" @click="moveSection(row.id, -1)">↑</button>
          <button type="button" class="move-btn" :data-testid="`down-${row.id}`" :disabled="saving || !row.visible || index === visibleCount - 1" aria-label="Descendre" @click="moveSection(row.id, 1)">↓</button>
        </span>
      </div>
      <p class="pref-hint">« Suggéré pour toi » et « Par chaîne suivie » ne s'affichent que pour les comptes connectés.</p>
    </div>

    <div class="pref-block">
      <div class="pref-head">
        <span class="form-label">Bloc vedette</span>
        <a v-if="isOverridden('homeHero')" href="#" class="reset-link" @click.prevent="resetKey('homeHero')">Rétablir le défaut{{ mode === 'user' ? " de l'instance" : '' }}</a>
      </div>
      <label class="check-row">
        <input type="checkbox" data-testid="hero-toggle" :checked="shown.homeHero" :disabled="saving" @change="onHeroChange" />
        <span>Afficher le grand bloc en haut de l'accueil</span>
      </label>
    </div>

    <div class="pref-block">
      <div class="pref-head">
        <label class="form-label" :for="`${uid}-ranking`">Classement de « Populaires »</label>
        <a v-if="isOverridden('popularRanking')" href="#" class="reset-link" @click.prevent="resetKey('popularRanking')">Rétablir le défaut{{ mode === 'user' ? " de l'instance" : '' }}</a>
      </div>
      <select :id="`${uid}-ranking`" class="form-input" :value="shown.popularRanking" :disabled="saving" @change="onRankingChange">
        <option v-for="opt in RANKING_OPTIONS" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
      </select>
    </div>

    <div class="pref-block">
      <div class="pref-head">
        <label class="form-label" :for="`${uid}-rowsize`">Vidéos par rangée</label>
        <a v-if="isOverridden('rowSize')" href="#" class="reset-link" @click.prevent="resetKey('rowSize')">Rétablir le défaut{{ mode === 'user' ? " de l'instance" : '' }}</a>
      </div>
      <select :id="`${uid}-rowsize`" class="form-input" :value="String(shown.rowSize)" :disabled="saving" @change="onNumberChange('rowSize', $event)">
        <option v-for="n in ROW_SIZES" :key="n" :value="String(n)">{{ n }}</option>
      </select>
    </div>

    <div class="pref-block">
      <div class="pref-head">
        <label class="form-label" :for="`${uid}-subchannels`">Chaînes suivies affichées</label>
        <a v-if="isOverridden('subscriptionChannels')" href="#" class="reset-link" @click.prevent="resetKey('subscriptionChannels')">Rétablir le défaut{{ mode === 'user' ? " de l'instance" : '' }}</a>
      </div>
      <select :id="`${uid}-subchannels`" class="form-input" :value="String(shown.subscriptionChannels)" :disabled="saving" @change="onNumberChange('subscriptionChannels', $event)">
        <option v-for="n in SUBSCRIPTION_CHANNEL_COUNTS" :key="n" :value="String(n)">{{ n }}</option>
      </select>
    </div>
```

Script: extend the `#shared/displayPrefs` import (`import { HOME_SECTION_IDS, ROW_SIZES, SUBSCRIPTION_CHANNEL_COUNTS } from '#shared/displayPrefs'; import type { DisplayPrefs, HomeSectionId, PrefKey } from '#shared/displayPrefs';`) and add:

```typescript
const SECTION_LABELS: Record<HomeSectionId, string> = {
  recent: 'Ajoutés récemment',
  popular: 'Populaires',
  suggested: 'Suggéré pour toi',
  subscriptions: 'Par chaîne suivie',
};
const RANKING_OPTIONS = [
  { value: 'localViewers', label: 'Spectateurs de l’instance' },
  { value: 'youtubeViews', label: 'Vues YouTube' },
  { value: 'trending7d', label: 'Tendance des 7 derniers jours' },
  { value: 'watchTime', label: 'Temps de visionnage cumulé' },
];

// Visible sections in their configured order, then the hidden ones.
const sectionRows = computed(() => {
  const visible = shown.value.homeSections;
  const hidden = HOME_SECTION_IDS.filter((id) => !visible.includes(id));
  return [
    ...visible.map((id) => ({ id, visible: true })),
    ...hidden.map((id) => ({ id, visible: false })),
  ];
});
const visibleCount = computed(() => shown.value.homeSections.length);

function moveSection(id: HomeSectionId, delta: number) {
  const list = [...shown.value.homeSections];
  const i = list.indexOf(id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  commit({ homeSections: list }, () => {});
}

function onSectionToggle(id: HomeSectionId, event: Event) {
  const el = event.target as HTMLInputElement;
  const list = shown.value.homeSections.filter((x) => x !== id);
  if (el.checked) list.push(id);
  commit({ homeSections: list }, () => { el.checked = shown.value.homeSections.includes(id); });
}

function onHeroChange(event: Event) {
  const el = event.target as HTMLInputElement;
  commit({ homeHero: el.checked }, () => { el.checked = shown.value.homeHero; });
}

function onRankingChange(event: Event) {
  const el = event.target as HTMLSelectElement;
  commit({ popularRanking: el.value }, () => { el.value = shown.value.popularRanking; });
}

function onNumberChange(key: 'rowSize' | 'subscriptionChannels', event: Event) {
  const el = event.target as HTMLSelectElement;
  commit({ [key]: Number(el.value) }, () => { el.value = String(shown.value[key]); });
}
```

Add styles to the scoped block:

```css
.section-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.move-buttons {
  display: flex;
  gap: 6px;
}

.move-btn {
  min-width: 32px;
  padding: 4px 8px;
  border-radius: 8px;
  border: 1px solid var(--border-color, rgba(255, 255, 255, 0.15));
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.move-btn:disabled {
  opacity: 0.35;
  cursor: default;
}
```

(If the file's CSS uses different variable names, reuse the ones already used by `.reset-link`/`.pref-hint`.)

- [ ] **Step 4:** `npx vitest run tests/component/DisplayPrefsForm.test.ts` then full `npx vitest run` — Expected: all pass.

- [ ] **Step 5: Mutation check.** Remove the `el.checked = shown.value.homeHero` resync from `onHeroChange`; the "snaps the hero checkbox back" test must fail. Restore it.

- [ ] **Step 6: Build check:** `npx nuxt build 2>&1 | tail -5` — Expected: build completes with no errors.

- [ ] **Step 7: Commit**

```bash
git add app/components/DisplayPrefsForm.vue tests/component/DisplayPrefsForm.test.ts
git commit -m "feat: Accueil section in the display preferences form

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Real verification (controller-run; not delegated)

Done by the controller in a real Docker container with the Browser pane on the Mac's LAN IP (`ipconfig getifaddr en0`), real clicks, not curl alone.

- [ ] **Step 1:** `docker build -t youkeep-test .` then `docker run -d --name ykt -p 3999:3000 -e PUID=99 -e PGID=100 -v ykd8:/app/data youkeep-test`. Create the admin with `POST /api/auth/setup`, log in via the real login form in the Browser pane (use the LAN IP, not localhost). Seed a few channels/videos and a normal user (`POST /api/admin/users`, then clear must-change-password via `PUT /api/account/password`). zsh does not word-split unquoted variables; do not build curl option strings in variables.
- [ ] **Step 2:** On `/account`, in the form: untick "Populaires"; click ↓ on "Ajoutés récemment"; confirm the row order in the form; open `/` and confirm the sections follow (and the home refetched without a manual reload).
- [ ] **Step 3:** Change "Classement de Populaires" and "Vidéos par rangée" and confirm the home reflects them; hide the hero and confirm the large block disappears and its video appears in a row.
- [ ] **Step 4:** Hide the hero and every section: confirm the "Ton accueil est vide" message (not "No videos found") with the working account link.
- [ ] **Step 5:** Force a failed save (`docker stop ykt`, click a checkbox, read the control state, `docker start ykt`): the control snaps back; check `docker logs ykt` for errors.
- [ ] **Step 6:** As admin set instance defaults in Settings → System (e.g. rowSize 10, no "Populaires"); confirm a brand-new user and a logged-out guest see them; a personal override wins; "Rétablir le défaut" returns to the instance value.
- [ ] **Step 7:** Clean up (`docker rm -f ykt`, `docker rmi youkeep-test`, `docker volume rm ykd8`, temp cookie files) and run `npx vitest run`. Record Task 5 in `.superpowers/sdd/progress.md`.

---

## Self-Review

- **Spec coverage:** five schema keys + semantics → Task 1; feed order/hero/rankings/sizes/pool 60/guest handling/fallback/Bearer → Task 2; empty-state fix and hidden-everything message → Task 3; form subsection (↑↓ boundaries, hero, selects, reset links, resync, admin mode via the shared `mode` prop) → Task 4; real-browser plan from the spec → Task 5. The spec's "feed refetches after preference change" is satisfied by Nuxt 4 `useFetch` refetching on mount and is verified in Task 5 Step 2.
- **Placeholders:** none; every code step shows its code. The only read-then-adjust instruction (Task 4 Step 1, `$fetch` call shape; Task 2 Step 1, Bearer helper) points at an exact file to read.
- **Type consistency:** `HomeSectionId`, `PopularRanking`, `HOME_SECTION_IDS`, `ROW_SIZES`, `SUBSCRIPTION_CHANNEL_COUNTS` are defined in Task 1 and used with the same names in Tasks 2-4; `isHomeFullyHidden` defined and used in Task 3 only.
