export type SettingsTab = 'overview' | 'library' | 'downloads' | 'users' | 'system';
export type LibrarySection = 'videos' | 'music' | 'podcasts';

export const SETTINGS_TABS: readonly SettingsTab[] = ['overview', 'library', 'downloads', 'users', 'system'];
export const LIBRARY_SECTIONS: readonly LibrarySection[] = ['videos', 'music', 'podcasts'];

// Old ?tab= values still used by bookmarks and in-app links.
const LEGACY_TABS: Record<string, { tab: SettingsTab; section: LibrarySection | null }> = {
  stats: { tab: 'overview', section: null },
  music: { tab: 'library', section: 'music' },
  podcasts: { tab: 'library', section: 'podcasts' },
};

function firstString(value: unknown): string {
  const v = Array.isArray(value) ? value[0] : value;
  return typeof v === 'string' ? v : '';
}

export function normalizeSettingsTab(query: { tab?: unknown; section?: unknown }): { tab: SettingsTab; section: LibrarySection | null } {
  const rawTab = firstString(query.tab);
  // hasOwnProperty, not `in`/indexing: '__proto__' or 'constructor' must not match.
  if (Object.prototype.hasOwnProperty.call(LEGACY_TABS, rawTab)) {
    return { ...LEGACY_TABS[rawTab]! };
  }
  if (!(SETTINGS_TABS as readonly string[]).includes(rawTab)) {
    return { tab: 'overview', section: null };
  }
  const tab = rawTab as SettingsTab;
  if (tab !== 'library') return { tab, section: null };
  const rawSection = firstString(query.section);
  const section = (LIBRARY_SECTIONS as readonly string[]).includes(rawSection) ? (rawSection as LibrarySection) : null;
  return { tab, section };
}
