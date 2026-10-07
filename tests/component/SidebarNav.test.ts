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
    expect(hrefs).toEqual(['/', '/shorts', '/channels', '/subscriptions', '/playlists', '/music', '/podcasts']);
    expect(w.find('.space-switcher').exists()).toBe(false);
  });

  it('removes a link hidden in the display preferences', async () => {
    setUp('user', { video: true, music: true, podcasts: true }, ['/shorts']);
    const w = await mountLayout();
    const hrefs = w.findAll('.sidebar-link').map((a) => a.attributes('href'));
    expect(hrefs).not.toContain('/shorts');
    expect(hrefs).toContain('/channels');
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
