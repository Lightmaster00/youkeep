import { describe, it, expect } from 'vitest';
import { buildSidebarGroups } from '../../app/utils/sidebarGroups';
import { spaces } from '../../app/spaces';

const all = ['video', 'music', 'podcasts'] as const;
const base = { isAdmin: false, enabled: [...all], hiddenNavLinks: [] as string[], mustChangePassword: false };

describe('buildSidebarGroups', () => {
  it('returns Video, Music, Podcasts in order with English labels', () => {
    const groups = buildSidebarGroups(spaces, base);
    expect(groups.map((g) => g.id)).toEqual(['video', 'music', 'podcasts']);
    expect(groups.map((g) => g.label)).toEqual(['Video', 'Music', 'Podcasts']);
    expect(groups[0]!.links.map((l) => l.to)).toEqual(['/', '/shorts', '/channels', '/subscriptions', '/playlists']);
    expect(groups[1]!.links.map((l) => [l.to, l.label])).toEqual([['/music', 'Library'], ['/music/recent', 'Recent']]);
    expect(groups[2]!.links.map((l) => [l.to, l.label])).toEqual([['/podcasts', 'Library'], ['/podcasts/recent', 'Recent']]);
    expect(groups.every((g) => g.enabled)).toBe(true);
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

  it('never hides the Library and Recent links of Music and Podcasts', () => {
    const groups = buildSidebarGroups(spaces, { ...base, hiddenNavLinks: ['/music', '/music/recent', '/podcasts/recent'] });
    expect(groups[1]!.links.map((l) => l.to)).toEqual(['/music', '/music/recent']);
    expect(groups[2]!.links.map((l) => l.to)).toEqual(['/podcasts', '/podcasts/recent']);
  });

  it('yields no groups while a password change is required', () => {
    expect(buildSidebarGroups(spaces, { ...base, mustChangePassword: true })).toEqual([]);
  });

  it('omits a group left without links', () => {
    const only = [{ ...spaces[1]!, navLinks: [] }];
    expect(buildSidebarGroups(only, base)).toEqual([]);
  });
});
