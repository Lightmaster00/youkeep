// Pure module shared by the Nitro server and the Vue app (imported with
// relative paths): no Nuxt auto-imports and no I/O in here.

export type Density = 'compact' | 'comfortable' | 'spacious';
export type LandingSpace = 'auto' | 'video' | 'music' | 'podcasts';

export const DENSITIES: readonly Density[] = ['compact', 'comfortable', 'spacious'];
export const LANDING_SPACES: readonly LandingSpace[] = ['auto', 'video', 'music', 'podcasts'];
export const HIDEABLE_NAV_LINKS = ['/shorts', '/channels', '/subscriptions', '/playlists'] as const;

export interface DisplayPrefs {
  density: Density;
  hiddenNavLinks: string[];
  landingSpace: LandingSpace;
}

export type PrefsPartial = Partial<DisplayPrefs>;
export type PrefKey = keyof DisplayPrefs;
export const PREF_KEYS: readonly PrefKey[] = ['density', 'hiddenNavLinks', 'landingSpace'];

export const APP_DEFAULTS: DisplayPrefs = {
  density: 'comfortable',
  hiddenNavLinks: [],
  landingSpace: 'auto',
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

// Stored JSON that is missing, corrupt or no longer valid is an empty partial.
export function parseStoredPartial(raw: string | null | undefined): PrefsPartial {
  if (!raw) return {};
  try {
    return validatePartial(JSON.parse(raw)).set;
  } catch {
    return {};
  }
}

export function mergePrefs(base: DisplayPrefs, partial: PrefsPartial | null | undefined): DisplayPrefs {
  return {
    density: partial?.density ?? base.density,
    hiddenNavLinks: [...(partial?.hiddenNavLinks ?? base.hiddenNavLinks)],
    landingSpace: partial?.landingSpace ?? base.landingSpace,
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
