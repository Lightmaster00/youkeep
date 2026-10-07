import { GUEST_HOME_SECTIONS, HIDEABLE_NAV_LINKS, MEDIA_HOME_SECTION_MODULE } from '#shared/displayPrefs';
import type { DisplayPrefs, LandingSpace } from '#shared/displayPrefs';
import type { ModuleId } from './moduleRouting';

// The landing redirect applies only to a plain '/' entry: '/?q=...' (search)
// and '/?page=...' (pagination) are deliberate navigations and must be kept.
export function shouldApplyLanding(path: string, query: Record<string, unknown>): boolean {
  return path === '/' && Object.keys(query).length === 0;
}

// A link is dropped only if it is hideable AND listed as hidden, so Home ('/')
// and the single library link of the music/podcasts spaces can never disappear.
export function filterNavLinks<T extends { to: string }>(links: T[], hidden: string[]): T[] {
  const hideable = HIDEABLE_NAV_LINKS as readonly string[];
  return links.filter((link) => !(hideable.includes(link.to) && hidden.includes(link.to)));
}

const HOMES: Record<ModuleId, string> = { video: '/', music: '/music', podcasts: '/podcasts' };
const ORDER: ModuleId[] = ['video', 'music', 'podcasts'];

// Route to start on, or null when no redirect is needed (the Video home is
// '/', which is where an entry to the app already lands).
export function resolveLandingTarget(landing: LandingSpace, enabled: ModuleId[]): string | null {
  const target: ModuleId | undefined =
    landing !== 'auto' && enabled.includes(landing) ? landing : ORDER.find((id) => enabled.includes(id));
  if (!target) return null;
  const home = HOMES[target];
  return home === '/' ? null : home;
}

// True when nothing at all is configured to appear on the home for this viewer.
// When `enabled` is given, the music/podcast rows of a module that is off do not count.
export function isHomeFullyHidden(
  prefs: Pick<DisplayPrefs, 'homeHero' | 'homeSections'>,
  loggedIn: boolean,
  enabled?: ModuleId[]
): boolean {
  if (prefs.homeHero) return false;
  const visible = prefs.homeSections.filter((id) => {
    if (!loggedIn && !GUEST_HOME_SECTIONS.includes(id)) return false;
    const module = MEDIA_HOME_SECTION_MODULE[id];
    return !(module && enabled && !enabled.includes(module));
  });
  return visible.length === 0;
}
