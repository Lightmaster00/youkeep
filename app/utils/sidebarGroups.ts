import type { Space, SpaceNavLink } from '~/spaces';
import type { ModuleId } from './moduleRouting';
import { filterNavLinks } from './displayPrefs';

export interface SidebarGroup {
  id: string;
  label: string;
  enabled: boolean;
  links: SpaceNavLink[];
}

interface Options {
  isAdmin: boolean;
  enabled: ModuleId[];
  hiddenNavLinks: string[];
  mustChangePassword: boolean;
  isGuest?: boolean;
}

// One sidebar group per space. Disabled modules are hidden from regular users;
// admins still see them (flagged enabled:false). Links that need an account
// (Liked songs, music Playlists) are hidden from guests. Empty groups are omitted.
export function buildSidebarGroups(spaces: Space[], opts: Options): SidebarGroup[] {
  const groups: SidebarGroup[] = [];
  for (const space of spaces) {
    const enabled = opts.enabled.includes(space.id as ModuleId);
    if (!opts.isAdmin && !enabled) continue;
    const links = filterNavLinks(space.navLinks, opts.hiddenNavLinks).filter(
      (l) => !(opts.mustChangePassword && l.hideWhenMustChangePassword) && !(opts.isGuest && l.requiresUser)
    );
    if (links.length === 0) continue;
    groups.push({ id: space.id, label: space.label, enabled, links });
  }
  return groups;
}
