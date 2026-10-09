import { describe, it, expect } from 'vitest';
import { buildSidebarGroups, resolveOpenPanel } from '../../app/utils/sidebarGroups';
import { spaces } from '../../app/spaces';

const all = ['video', 'music', 'podcasts'] as const;
const base = { isAdmin: false, enabled: [...all], hiddenNavLinks: [] as string[], mustChangePassword: false };

describe('buildSidebarGroups', () => {
  it('returns Video, Music, Podcasts in order with English labels', () => {
    const groups = buildSidebarGroups(spaces, base);
    expect(groups.map((g) => g.id)).toEqual(['video', 'music', 'podcasts']);
    expect(groups.map((g) => g.label)).toEqual(['Video', 'Music', 'Podcasts']);
    expect(groups[0]!.links.map((l) => l.to)).toEqual(['/', '/shorts', '/channels', '/subscriptions', '/playlists']);
    expect(groups[1]!.links.map((l) => [l.to, l.label])).toEqual([
      ['/music', 'Library'], ['/music/discover', 'Discover'], ['/music/liked', 'Liked songs'], ['/music/playlists', 'Playlists'], ['/music/recent', 'Recent'], ['/music/history', 'History'],
    ]);
    expect(groups[2]!.links.map((l) => [l.to, l.label])).toEqual([['/podcasts', 'Library'], ['/podcasts/discover', 'Discover'], ['/podcasts/subscribed', 'Subscribed'], ['/podcasts/recent', 'Recent'], ['/podcasts/history', 'History']]);
    expect(groups.every((g) => g.enabled)).toBe(true);
  });

  it('gives each group the icon of its space', () => {
    const groups = buildSidebarGroups(spaces, base);
    expect(groups.map((g) => g.icon)).toEqual(spaces.map((s) => s.icon));
    expect(groups.every((g) => g.icon.startsWith('<svg'))).toBe(true);
  });

  it('hides a disabled module from a regular user', () => {
    const groups = buildSidebarGroups(spaces, { ...base, enabled: ['video', 'podcasts'] });
    expect(groups.map((g) => g.id)).toEqual(['video', 'podcasts']);
  });

  it('shows a disabled module to an admin, flagged as not enabled', () => {
    const groups = buildSidebarGroups(spaces, { ...base, isAdmin: true, enabled: ['video', 'podcasts'] });
    expect(groups.map((g) => g.id)).toEqual(['video', 'music', 'podcasts']);
    expect(groups.map((g) => g.enabled)).toEqual([true, false, true]);
  });

  it('drops hidden links but never Home', () => {
    const groups = buildSidebarGroups(spaces, { ...base, hiddenNavLinks: ['/shorts', '/'] });
    expect(groups[0]!.links.map((l) => l.to)).toEqual(['/', '/channels', '/subscriptions', '/playlists']);
  });

  it('never hides the links of Music and Podcasts', () => {
    const groups = buildSidebarGroups(spaces, { ...base, hiddenNavLinks: ['/music', '/music/discover', '/music/liked', '/music/playlists', '/music/recent', '/music/history', '/podcasts/discover', '/podcasts/recent', '/podcasts/history'] });
    expect(groups[1]!.links.map((l) => l.to)).toEqual(['/music', '/music/discover', '/music/liked', '/music/playlists', '/music/recent', '/music/history']);
    expect(groups[2]!.links.map((l) => l.to)).toEqual(['/podcasts', '/podcasts/discover', '/podcasts/subscribed', '/podcasts/recent', '/podcasts/history']);
  });

  it('hides Liked songs, music Playlists, Subscribed and History from guests only', () => {
    const guest = buildSidebarGroups(spaces, { ...base, isGuest: true });
    expect(guest[1]!.links.map((l) => l.to)).toEqual(['/music', '/music/discover', '/music/recent']);
    expect(guest[0]!.links.map((l) => l.to)).toEqual(['/', '/shorts', '/channels', '/subscriptions', '/playlists']);
    const member = buildSidebarGroups(spaces, { ...base, isGuest: false });
    expect(member[1]!.links.map((l) => l.to)).toContain('/music/liked');
    expect(member[1]!.links.map((l) => l.to)).toContain('/music/history');
    expect(guest[2]!.links.map((l) => l.to)).toEqual(['/podcasts', '/podcasts/discover', '/podcasts/recent']);
    expect(member[2]!.links.map((l) => l.to)).toContain('/podcasts/subscribed');
    expect(member[2]!.links.map((l) => l.to)).toContain('/podcasts/history');
  });

  it('yields no groups while a password change is required', () => {
    expect(buildSidebarGroups(spaces, { ...base, mustChangePassword: true })).toEqual([]);
  });

  it('omits a group left without links', () => {
    const only = [{ ...spaces[1]!, navLinks: [] }];
    expect(buildSidebarGroups(only, base)).toEqual([]);
  });
});

describe('resolveOpenPanel', () => {
  const groupIds = ['video', 'music', 'podcasts'];

  it('opens the panel of the route space when nothing was chosen by hand', () => {
    expect(resolveOpenPanel({ activeSpaceId: 'music', manual: undefined, groupIds })).toBe('music');
    expect(resolveOpenPanel({ activeSpaceId: 'video', manual: undefined, groupIds })).toBe('video');
  });

  it('lets a manual choice made in the current space win', () => {
    expect(resolveOpenPanel({ activeSpaceId: 'video', manual: { id: 'podcasts', spaceId: 'video' }, groupIds })).toBe('podcasts');
  });

  it('lets a manual close keep every panel closed in the current space', () => {
    expect(resolveOpenPanel({ activeSpaceId: 'video', manual: { id: null, spaceId: 'video' }, groupIds })).toBeNull();
  });

  it('ignores a manual choice once the route moved to another space', () => {
    expect(resolveOpenPanel({ activeSpaceId: 'music', manual: { id: 'podcasts', spaceId: 'video' }, groupIds })).toBe('music');
    expect(resolveOpenPanel({ activeSpaceId: 'music', manual: { id: null, spaceId: 'video' }, groupIds })).toBe('music');
  });

  it('falls back to the route space when the manual panel no longer exists', () => {
    expect(resolveOpenPanel({ activeSpaceId: 'video', manual: { id: 'music', spaceId: 'video' }, groupIds: ['video', 'podcasts'] })).toBe('video');
  });

  it('opens nothing when the route space has no panel', () => {
    expect(resolveOpenPanel({ activeSpaceId: 'music', manual: undefined, groupIds: ['video', 'podcasts'] })).toBeNull();
    expect(resolveOpenPanel({ activeSpaceId: 'video', manual: undefined, groupIds: [] })).toBeNull();
  });
});
