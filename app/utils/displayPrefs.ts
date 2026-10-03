import { HIDEABLE_NAV_LINKS } from '../../shared/displayPrefs';
import type { LandingSpace } from '../../shared/displayPrefs';
import type { ModuleId } from './moduleRouting';

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
