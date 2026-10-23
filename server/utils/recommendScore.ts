// Pure scoring of the video recommendations (no I/O, no Math.random): the
// database side lives in recommend.ts. Everything here is deterministic for
// a given seed, so a page refresh within the same seed shows the same order.

export interface ScoreCandidate {
  id: string;
  title: string;
  channel_id: string;
  duration: number | null;
  view_count: number | null;
  /** YYYYMMDD (YouTube upload date), or null. */
  upload_date: string | null;
  /** When the video was added to the library (ms), used when upload_date is unknown. */
  created_at: number | null;
  categories: string[];
  tags: string[];
  /** Distinct local viewers (user_history rows). */
  local_viewers: number;
}

export interface HistoryItem {
  videoId: string;
  title: string;
  channelId: string;
  watchSeconds: number;
  /** What the player reported, else the stored video duration. */
  durationSeconds: number | null;
  positionSeconds: number;
  watchedAt: number;
  categories: string[];
  tags: string[];
}

export interface ReasonRef { videoId?: string; channelId?: string; category?: string }
export interface Reason {
  kind: 'subscription' | 'because-watched' | 'category' | 'popular' | 'new';
  label: string;
  ref?: ReasonRef;
}

interface SeedVideo { videoId: string; title: string; weight: number }

export interface UserProfile {
  /** 0..1, relative to the most watched channel. */
  channelAffinity: Map<string, number>;
  categoryAffinity: Map<string, number>;
  tagAffinity: Map<string, number>;
  subscribed: Set<string>;
  /** Watched, started or finished videos, plus hidden ones: never recommended. */
  excluded: Set<string>;
  /** The most weighted watched video of each channel (for "Because you watched"). */
  channelSeed: Map<string, SeedVideo>;
  /** True when there is any history weight or subscription (else: cold start). */
  hasSignal: boolean;
}

export interface Ranked<T> {
  video: T;
  score: number;
  reason: Reason;
  /** Picked by the exploration slots (an unseen channel and category). */
  exploration: boolean;
}

export interface RankOptions {
  now: number;
  seed: string;
  limit: number;
  /** Ids to leave out on top of the profile's (videos already on the page). */
  exclude?: Set<string>;
  maxPerChannel?: number;
  explorationRatio?: number;
}

const DAY_MS = 86_400_000;
export const AFFINITY_HALF_LIFE_DAYS = 30;
export const FRESHNESS_HALF_LIFE_DAYS = 14;
export const JITTER = 0.08;
export const DEFAULT_MAX_PER_CHANNEL = 2;
export const DEFAULT_EXPLORATION_RATIO = 0.1;
/** Without a duration, this many watched seconds count as one full video. */
const NO_DURATION_FULL_SECONDS = 600;
/** Below this position nothing was really started. */
const STARTED_MIN_SECONDS = 10;

export const WEIGHTS = { channel: 0.35, category: 0.2, tag: 0.1, subscription: 0.15, freshness: 0.1, popularity: 0.1 } as const;
export const COLD_WEIGHTS = { popularity: 0.5, freshness: 0.3, diversity: 0.2 } as const;

/** FNV-1a 32-bit hash: a stable number for (seed, id). */
function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic jitter in [-JITTER, +JITTER] for a video under a seed. */
export function seedJitter(seed: string, id: string): number {
  return ((hash32(`${seed}\u0000${id}`) / 0xffffffff) * 2 - 1) * JITTER;
}

/** Days since the upload (or since it was added); null when unknown. */
function ageDays(c: Pick<ScoreCandidate, 'upload_date' | 'created_at'>, now: number): number | null {
  if (c.upload_date && /^\d{8}$/.test(c.upload_date)) {
    const t = Date.UTC(+c.upload_date.slice(0, 4), +c.upload_date.slice(4, 6) - 1, +c.upload_date.slice(6, 8));
    return Math.max(0, (now - t) / DAY_MS);
  }
  if (typeof c.created_at === 'number' && c.created_at > 0) return Math.max(0, (now - c.created_at) / DAY_MS);
  return null;
}

export function freshness(c: Pick<ScoreCandidate, 'upload_date' | 'created_at'>, now: number): number {
  const age = ageDays(c, now);
  return age === null ? 0 : 0.5 ** (age / FRESHNESS_HALF_LIFE_DAYS);
}

/** How much one history row says about the viewer's taste (0..1, recency-weighted). */
function historyWeight(h: HistoryItem, now: number): number {
  const seconds = h.watchSeconds > 0 ? h.watchSeconds : 0;
  if (seconds <= 0) return 0;
  const share = h.durationSeconds && h.durationSeconds > 0
    ? Math.min(seconds / h.durationSeconds, 1)
    : Math.min(seconds / NO_DURATION_FULL_SECONDS, 1);
  const days = Math.max(0, (now - h.watchedAt) / DAY_MS);
  return share * 0.5 ** (days / AFFINITY_HALF_LIFE_DAYS);
}

function normalise(map: Map<string, number>): Map<string, number> {
  let max = 0;
  for (const v of map.values()) if (v > max) max = v;
  if (max <= 0) return new Map();
  const out = new Map<string, number>();
  for (const [k, v] of map) if (v > 0) out.set(k, v / max);
  return out;
}

const add = (map: Map<string, number>, key: string, value: number) => map.set(key, (map.get(key) ?? 0) + value);

export function buildProfile(history: HistoryItem[], subscribed: Iterable<string>, now: number, hidden: Iterable<string> = []): UserProfile {
  const channels = new Map<string, number>();
  const categories = new Map<string, number>();
  const tags = new Map<string, number>();
  const channelSeed = new Map<string, SeedVideo>();
  const excluded = new Set<string>(hidden);
  for (const h of history) {
    if (h.watchSeconds > 0 || h.positionSeconds >= STARTED_MIN_SECONDS) excluded.add(h.videoId);
    const w = historyWeight(h, now);
    if (w <= 0) continue;
    add(channels, h.channelId, w);
    for (const c of h.categories) add(categories, c, w);
    for (const t of h.tags) add(tags, t, w);
    const seed = channelSeed.get(h.channelId);
    if (!seed || w > seed.weight || (w === seed.weight && h.videoId < seed.videoId)) {
      channelSeed.set(h.channelId, { videoId: h.videoId, title: h.title, weight: w });
    }
  }
  const subs = new Set(subscribed);
  return {
    channelAffinity: normalise(channels),
    categoryAffinity: normalise(categories),
    tagAffinity: normalise(tags),
    subscribed: subs,
    excluded,
    channelSeed,
    hasSignal: channels.size > 0 || subs.size > 0,
  };
}

function popularityOf(c: ScoreCandidate, logMax: number): number {
  const views = Math.max(0, c.view_count ?? 0);
  const base = logMax > 0 ? Math.log10(1 + views) / logMax : 0;
  // Local viewers: a small bump on top of the YouTube views (still 0..1).
  const local = Math.min(1, Math.max(0, c.local_viewers) / 5);
  return 0.85 * base + 0.15 * local;
}

/** The best matching category of a candidate in the profile, if any. */
function topCategory(c: ScoreCandidate, profile: UserProfile): { category: string; affinity: number } | null {
  let best: { category: string; affinity: number } | null = null;
  for (const cat of c.categories) {
    const a = profile.categoryAffinity.get(cat) ?? 0;
    if (a > 0 && (!best || a > best.affinity)) best = { category: cat, affinity: a };
  }
  return best;
}

/** Mean of the candidate's three best tag affinities. */
function tagOverlap(c: ScoreCandidate, profile: UserProfile): number {
  if (c.tags.length === 0 || profile.tagAffinity.size === 0) return 0;
  const values = c.tags.map((t) => profile.tagAffinity.get(t) ?? 0).sort((a, b) => b - a).slice(0, 3);
  return values.reduce((s, v) => s + v, 0) / 3;
}

function genericReason(c: ScoreCandidate, now: number): Reason {
  if (freshness(c, now) >= 0.5) return { kind: 'new', label: 'New' };
  return { kind: 'popular', label: 'Popular on your server' };
}

function personalReason(c: ScoreCandidate, profile: UserProfile, now: number): Reason {
  if (profile.subscribed.has(c.channel_id)) {
    return { kind: 'subscription', label: 'From a channel you follow', ref: { channelId: c.channel_id } };
  }
  const seed = profile.channelSeed.get(c.channel_id);
  if (seed && (profile.channelAffinity.get(c.channel_id) ?? 0) > 0) {
    return { kind: 'because-watched', label: `Because you watched ${seed.title}`, ref: { videoId: seed.videoId, channelId: c.channel_id } };
  }
  const cat = topCategory(c, profile);
  if (cat) return { kind: 'category', label: `Popular in ${cat.category}`, ref: { category: cat.category } };
  return genericReason(c, now);
}

function explorationReason(c: ScoreCandidate, now: number): Reason {
  const category = c.categories[0];
  if (category) return { kind: 'category', label: `Popular in ${category}`, ref: { category } };
  return genericReason(c, now);
}

const byScore = <T extends { id: string }>(a: { score: number; video: T }, b: { score: number; video: T }) =>
  b.score - a.score || (a.video.id < b.video.id ? -1 : a.video.id > b.video.id ? 1 : 0);

/**
 * Greedy re-ranking: at most `maxPerChannel` videos of one channel, unless
 * nothing else is left to fill the page.
 */
function diversify<T extends ScoreCandidate>(sorted: Ranked<T>[], limit: number, maxPerChannel: number): Ranked<T>[] {
  const picked: Ranked<T>[] = [];
  const skipped: Ranked<T>[] = [];
  const perChannel = new Map<string, number>();
  for (const r of sorted) {
    if (picked.length >= limit) break;
    const n = perChannel.get(r.video.channel_id) ?? 0;
    if (n >= maxPerChannel) {
      skipped.push(r);
      continue;
    }
    perChannel.set(r.video.channel_id, n + 1);
    picked.push(r);
  }
  for (const r of skipped) {
    if (picked.length >= limit) break;
    picked.push(r);
  }
  return picked;
}

/** Ranks candidates for the viewer: personalised, or the cold-start mix without any signal. */
export function rankCandidates<T extends ScoreCandidate>(candidates: T[], profile: UserProfile, opts: RankOptions): Ranked<T>[] {
  const limit = Math.max(0, Math.trunc(opts.limit));
  if (limit === 0) return [];
  const maxPerChannel = opts.maxPerChannel ?? DEFAULT_MAX_PER_CHANNEL;
  const seen = new Set<string>();
  const eligible: T[] = [];
  for (const c of candidates) {
    if (seen.has(c.id) || profile.excluded.has(c.id) || opts.exclude?.has(c.id)) continue;
    seen.add(c.id);
    eligible.push(c);
  }
  if (eligible.length === 0) return [];
  let maxViews = 0;
  for (const c of eligible) maxViews = Math.max(maxViews, c.view_count ?? 0);
  const logMax = Math.log10(1 + maxViews);
  const pop = new Map(eligible.map((c) => [c.id, popularityOf(c, logMax)]));
  const jitter = (c: T) => 1 + seedJitter(opts.seed, c.id);

  if (!profile.hasSignal) {
    // Cold start: popularity and freshness, with categories taking turns.
    const base = eligible
      .map((c) => ({ c, s: (COLD_WEIGHTS.popularity * pop.get(c.id)! + COLD_WEIGHTS.freshness * freshness(c, opts.now)) * jitter(c) }))
      .sort((a, b) => b.s - a.s || (a.c.id < b.c.id ? -1 : 1));
    const rankInCategory = new Map<string, number>();
    const ranked: Ranked<T>[] = base.map(({ c, s }) => {
      const key = c.categories[0] ?? '';
      const r = rankInCategory.get(key) ?? 0;
      rankInCategory.set(key, r + 1);
      return { video: c, score: s + COLD_WEIGHTS.diversity * 0.5 ** r, reason: genericReason(c, opts.now), exploration: false };
    }).sort(byScore);
    return diversify(ranked, limit, maxPerChannel);
  }

  const ranked: Ranked<T>[] = eligible.map((c) => {
    const score =
      WEIGHTS.channel * (profile.channelAffinity.get(c.channel_id) ?? 0)
      + WEIGHTS.category * (topCategory(c, profile)?.affinity ?? 0)
      + WEIGHTS.tag * tagOverlap(c, profile)
      + WEIGHTS.subscription * (profile.subscribed.has(c.channel_id) ? 1 : 0)
      + WEIGHTS.freshness * freshness(c, opts.now)
      + WEIGHTS.popularity * pop.get(c.id)!;
    return { video: c, score: score * jitter(c), reason: personalReason(c, profile, opts.now), exploration: false };
  }).sort(byScore);

  // Exploration: a share of the slots goes to unseen channels and categories
  // with a decent popularity (at least the median of the pool).
  const ratio = opts.explorationRatio ?? DEFAULT_EXPLORATION_RATIO;
  const exploreCount = limit >= 5 ? Math.max(1, Math.floor(limit * ratio)) : 0;
  const pops = [...pop.values()].sort((a, b) => a - b);
  const median = pops[Math.floor(pops.length / 2)] ?? 0;
  const isUnseen = (c: T) => !profile.channelAffinity.has(c.channel_id)
    && !profile.subscribed.has(c.channel_id)
    && c.categories.every((cat) => !profile.categoryAffinity.has(cat));
  const explorePool = exploreCount > 0
    ? ranked
      .filter((r) => isUnseen(r.video) && pop.get(r.video.id)! >= median && pop.get(r.video.id)! > 0)
      .map((r) => ({ ...r, score: pop.get(r.video.id)! * jitter(r.video), exploration: true, reason: explorationReason(r.video, opts.now) }))
      .sort(byScore)
    : [];
  const explore: Ranked<T>[] = [];
  const exploreChannels = new Set<string>();
  for (const r of explorePool) {
    if (explore.length >= exploreCount) break;
    if (exploreChannels.has(r.video.channel_id)) continue;
    exploreChannels.add(r.video.channel_id);
    explore.push(r);
  }
  const exploreIds = new Set(explore.map((r) => r.video.id));
  const main = diversify(ranked.filter((r) => !exploreIds.has(r.video.id)), limit - explore.length, maxPerChannel);
  // Spread the exploration picks through the page instead of at its end.
  const out = [...main];
  explore.forEach((r, i) => {
    const at = Math.min(out.length, Math.floor(((i + 1) * limit) / (explore.length + 1)));
    out.splice(at, 0, r);
  });
  return out.slice(0, limit);
}

/** Jaccard index of two label lists. */
function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setB = new Set(b);
  let inter = 0;
  for (const x of new Set(a)) if (setB.has(x)) inter++;
  return inter / (new Set([...a, ...b]).size);
}

/**
 * "Because you watched <seed>": same channel, then shared categories and
 * tags, never the seed itself nor anything the profile excludes.
 */
export function rankSimilar<T extends ScoreCandidate>(
  candidates: T[],
  seedVideo: { id: string; title: string; channel_id: string; categories: string[]; tags: string[] },
  profile: UserProfile,
  opts: RankOptions,
): Ranked<T>[] {
  const limit = Math.max(0, Math.trunc(opts.limit));
  let maxViews = 0;
  for (const c of candidates) maxViews = Math.max(maxViews, c.view_count ?? 0);
  const logMax = Math.log10(1 + maxViews);
  const reason: Reason = { kind: 'because-watched', label: `Because you watched ${seedVideo.title}`, ref: { videoId: seedVideo.id } };
  const seen = new Set<string>();
  const ranked: Ranked<T>[] = [];
  for (const c of candidates) {
    if (c.id === seedVideo.id || seen.has(c.id) || profile.excluded.has(c.id) || opts.exclude?.has(c.id)) continue;
    seen.add(c.id);
    const similarity = 0.4 * (c.channel_id === seedVideo.channel_id ? 1 : 0)
      + 0.35 * jaccard(c.categories, seedVideo.categories)
      + 0.25 * jaccard(c.tags, seedVideo.tags);
    if (similarity <= 0) continue;
    const score = (similarity + 0.05 * popularityOf(c, logMax)) * (1 + seedJitter(opts.seed, c.id));
    ranked.push({ video: c, score, reason, exploration: false });
  }
  ranked.sort(byScore);
  return diversify(ranked, limit, opts.maxPerChannel ?? DEFAULT_MAX_PER_CHANNEL);
}
