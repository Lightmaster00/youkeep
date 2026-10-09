import type { Space, SpaceNavLink } from '~/spaces';
import type { ModuleId } from './moduleRouting';
import { filterNavLinks } from './displayPrefs';

export interface SidebarGroup {
  id: string;
  label: string;
  icon: string; // raw inline-SVG markup of the space, rendered via v-html
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
// (Liked songs, music Playlists, podcast Subscribed, both History pages) are
// hidden from guests. Empty groups are omitted.
export function buildSidebarGroups(spaces: Space[], opts: Options): SidebarGroup[] {
  const groups: SidebarGroup[] = [];
  for (const space of spaces) {
    const enabled = opts.enabled.includes(space.id as ModuleId);
    if (!opts.isAdmin && !enabled) continue;
    const links = filterNavLinks(space.navLinks, opts.hiddenNavLinks).filter(
      (l) => !(opts.mustChangePassword && l.hideWhenMustChangePassword) && !(opts.isGuest && l.requiresUser)
    );
    if (links.length === 0) continue;
    groups.push({ id: space.id, label: space.label, icon: space.icon, enabled, links });
  }
  return groups;
}

// A panel choice made by hand: the panel id (null = all closed) and the space
// the route was in when the choice was made.
export interface ManualPanelChoice {
  id: string | null;
  spaceId: string;
}

interface OpenPanelInput {
  activeSpaceId: string;
  manual: ManualPanelChoice | undefined;
  groupIds: string[];
}

// Which sidebar panel is open (null = none). A manual choice wins only while the
// route is still in the space it was made in; otherwise the route space opens.
export function resolveOpenPanel({ activeSpaceId, manual, groupIds }: OpenPanelInput): string | null {
  if (manual && manual.spaceId === activeSpaceId) {
    if (manual.id === null) return null;
    if (groupIds.includes(manual.id)) return manual.id;
  }
  return groupIds.includes(activeSpaceId) ? activeSpaceId : null;
}
