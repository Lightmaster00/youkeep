import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import DefaultLayout from '../../app/layouts/default.vue';
import { buildView } from '../../shared/displayPrefs';

const fetchMock = vi.fn();
let modulesResponse = { video: true, music: true, podcasts: true };

function setUp(role: 'admin' | 'user', modules = { video: true, music: true, podcasts: true }, hidden: string[] = []) {
  useState('auth_loading').value = false;
  useState('auth_user').value = { id: 'u1', username: 'tester', role };
  modulesResponse = modules;
  useState('modules').value = modules;
  useState('modules_loaded').value = true;
  useState('display_prefs').value = buildView({ hiddenNavLinks: hidden } as any, null);
  useState('display_prefs_for').value = 'u1';
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) => {
    if (url === '/api/settings/content-search-mode') return { mode: 'per_space' };
    if (url === '/api/settings/modules') return modulesResponse;
    return {};
  });
  vi.stubGlobal('$fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

async function mountLayout() {
  const w = await mountSuspended(DefaultLayout);
  await flushPromises();
  return w;
}

describe('default layout sidebar', () => {
  it('renders Video, Music and Podcasts groups in order with their links and no space switcher', async () => {
    setUp('user');
    const w = await mountLayout();
    expect(w.findAll('.sidebar-divider-title').map((t) => t.text())).toEqual(['Video', 'Music', 'Podcasts']);
    const hrefs = w.findAll('.sidebar-link').map((a) => a.attributes('href'));
    expect(hrefs).toEqual([
      '/', '/shorts', '/channels', '/subscriptions', '/playlists',
      '/music', '/music/discover', '/music/liked', '/music/playlists', '/music/recent', '/music/history',
      '/podcasts', '/podcasts/discover', '/podcasts/subscribed', '/podcasts/recent', '/podcasts/history',
    ]);
    const music = w.findAll('.sidebar-group')[1]!;
    expect(music.findAll('.sidebar-link').map((a) => a.text())).toEqual(['Library', 'Discover', 'Liked songs', 'Playlists', 'Recent', 'History']);
    expect(w.find('.space-switcher').exists()).toBe(false);
  });

  it('removes a link hidden in the display preferences', async () => {
    setUp('user', { video: true, music: true, podcasts: true }, ['/shorts']);
    const w = await mountLayout();
    const hrefs = w.findAll('.sidebar-link').map((a) => a.attributes('href'));
    expect(hrefs).not.toContain('/shorts');
    expect(hrefs).toContain('/channels');
  });

  it('hides Liked songs, music Playlists, Subscribed and History from a guest', async () => {
    setUp('user');
    useState('auth_user').value = null;
    const w = await mountLayout();
    const hrefs = w.findAll('.sidebar-link').map((a) => a.attributes('href'));
    expect(hrefs).toContain('/music');
    expect(hrefs).toContain('/music/recent');
    expect(hrefs).toContain('/music/discover');
    expect(hrefs).toContain('/podcasts/discover');
    expect(hrefs).not.toContain('/music/liked');
    expect(hrefs).not.toContain('/music/playlists');
    expect(hrefs).not.toContain('/podcasts/subscribed');
    expect(hrefs).not.toContain('/music/history');
    expect(hrefs).not.toContain('/podcasts/history');
    expect(hrefs).toContain('/podcasts/recent');
  });

  it('hides a disabled module from a user', async () => {
    setUp('user', { video: true, music: false, podcasts: true });
    const w = await mountLayout();
    expect(w.findAll('.sidebar-divider-title').map((t) => t.text())).toEqual(['Video', 'Podcasts']);
  });

  it('shows a disabled module dimmed with an Off badge to an admin', async () => {
    setUp('admin', { video: true, music: false, podcasts: true });
    const w = await mountLayout();
    const groups = w.findAll('.sidebar-group');
    expect(groups).toHaveLength(3);
    expect(groups[1]!.classes()).toContain('is-off');
    expect(groups[1]!.find('.badge').text()).toBe('Off');
    expect(groups[0]!.classes()).not.toContain('is-off');
  });
});
