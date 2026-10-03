// Pure module shared by the Nitro server and the Vue app (app code imports it
// via the `#shared/displayPrefs` alias, server code with relative paths): no Nuxt auto-imports and no I/O in here.

export type Density = 'compact' | 'comfortable' | 'spacious';
export type LandingSpace = 'auto' | 'video' | 'music' | 'podcasts';

export const DENSITIES: readonly Density[] = ['compact', 'comfortable', 'spacious'];
export const LANDING_SPACES: readonly LandingSpace[] = ['auto', 'video', 'music', 'podcasts'];
export const HIDEABLE_NAV_LINKS = ['/shorts', '/channels', '/subscriptions', '/playlists'] as const;

export type HomeSectionId = 'recent' | 'popular' | 'suggested' | 'subscriptions';
export type PopularRanking = 'localViewers' | 'youtubeViews' | 'trending7d' | 'watchTime';

export const HOME_SECTION_IDS: readonly HomeSectionId[] = ['recent', 'popular', 'suggested', 'subscriptions'];
export const POPULAR_RANKINGS: readonly PopularRanking[] = ['localViewers', 'youtubeViews', 'trending7d', 'watchTime'];
export const ROW_SIZES: readonly number[] = [10, 15, 20, 30];
export const SUBSCRIPTION_CHANNEL_COUNTS: readonly number[] = [4, 8, 12, 16];

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

export type PrefsPartial = Partial<DisplayPrefs>;
export type PrefKey = keyof DisplayPrefs;
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

export class InvalidPrefError extends Error {
  key: string;
  constructor(key: string, message: string) {
    super(message);
    this.name = 'InvalidPrefError';
    this.key = key;
  }
}

export interface ValidatedChange {
  set: PrefsPartial;
  remove: PrefKey[];
}

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

// Unknown keys are ignored; an invalid value for a known key throws; null is a
// removal marker (back to the inherited default).
export function validatePartial(input: unknown): ValidatedChange {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new InvalidPrefError('body', 'A JSON object of preferences is required.');
  }
  const set: PrefsPartial = {};
  const remove: PrefKey[] = [];
  for (const key of PREF_KEYS) {
    if (!(key in input)) continue;
    const value = (input as Record<string, unknown>)[key];
    if (value === null) {
      remove.push(key);
      continue;
    }
    (set as Record<string, unknown>)[key] = validateValue(key, value);
  }
  return { set, remove };
}

// Stored JSON that is missing or corrupt is an empty partial; otherwise each
// known key is validated alone so one bad value never discards the others.
// null is a write-time removal marker only and is dropped here.
export function parseStoredPartial(raw: string | null | undefined): PrefsPartial {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const out: PrefsPartial = {};
  for (const key of PREF_KEYS) {
    if (!(key in parsed)) continue;
    const value = (parsed as Record<string, unknown>)[key];
    if (value === null) continue;
    try {
      (out as Record<string, unknown>)[key] = validateValue(key, value);
    } catch {
      // invalid stored value for this key: ignore it
    }
  }
  return out;
}

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

export function applyChange(current: PrefsPartial, change: ValidatedChange): PrefsPartial {
  const next: PrefsPartial = { ...current, ...change.set };
  for (const key of change.remove) delete next[key];
  return next;
}

export interface DisplayView {
  effective: DisplayPrefs;
  defaults: DisplayPrefs;
  overrides: PrefsPartial | null;
  adminDefaults: PrefsPartial;
}

export function buildView(adminDefaults: PrefsPartial, overrides: PrefsPartial | null): DisplayView {
  const defaults = mergePrefs(APP_DEFAULTS, adminDefaults);
  return { effective: mergePrefs(defaults, overrides), defaults, overrides, adminDefaults };
}
