import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import SettingsPage from '../../app/pages/settings.vue';

const COUNTS_URL = '/api/admin/downloader/active-counts';
const counts = {
  video: { downloading: 2, pending: 0 }, music: { downloading: 1, pending: 0 }, podcasts: { downloading: 0, pending: 0 },
  total: 3, current: { kind: null, progress: null, speed: null },
};

// The tab bodies are covered by their own tests; here only the shell matters.
const stubs = {
  SettingsStatsTab: { template: '<div data-testid="pane-overview" />' },
  LibraryTab: { props: ['section'], template: '<div data-testid="pane-library" :data-section="section" />' },
  DownloadsTab: { template: '<div data-testid="pane-downloads" />' },
  SettingsSystemTab: { template: '<div data-testid="pane-system" />' },
  SettingsUsersTab: { template: '<div data-testid="pane-users" />' },
};

let fetchMock: ReturnType<typeof vi.fn>;
let wrapper: any;

const setRole = (role: 'admin' | 'user') => {
  // loading=false keeps the global auth middleware from re-fetching the session.
  useState('auth_loading').value = false;
  useState('auth_user').value = { id: 'u1', username: 'u', role };
};
const mountPage = async (query: Record<string, string> = {}) => {
  // mountSuspended resets the route to '/' unless told otherwise.
  wrapper = await mountSuspended(SettingsPage, { route: { path: '/settings', query }, global: { stubs } });
  await flushPromises();
  return wrapper;
};
const countsCalls = () => fetchMock.mock.calls.filter(([u]) => u === COUNTS_URL).length;

beforeEach(() => {
  setRole('admin');
  // Marks the one-off landing redirect as already applied for this user.
  window.sessionStorage.setItem('landing_applied', 'u1');
  useState('admin_active_counts').value = null;
  fetchMock = vi.fn(async () => counts);
  vi.stubGlobal('$fetch', fetchMock);
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('settings page shell', () => {
  it('opens the tab named in the query and re-normalises on a later query change', async () => {
    const w = await mountPage({ tab: 'users' });
    expect(w.find('[data-testid="pane-users"]').exists()).toBe(true);
    expect(w.find('[data-testid="pane-downloads"]').exists()).toBe(false);
    await useRouter().push({ path: '/settings', query: { tab: 'system' } });
    await flushPromises();
    expect(w.find('[data-testid="pane-system"]').exists()).toBe(true);
    expect(w.find('[data-testid="pane-users"]').exists()).toBe(false);
    await useRouter().push({ path: '/settings', query: { tab: 'bogus' } });
    await flushPromises();
    expect(w.find('[data-testid="pane-overview"]').exists()).toBe(true);
    expect(w.find('[data-testid="pane-downloads"]').exists()).toBe(false);
  });

  it('selecting a tab shows it and updates the query', async () => {
    const w = await mountPage({ tab: 'library', section: 'music' });
    await w.find('[data-testid="settings-tab-downloads"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="pane-downloads"]').exists()).toBe(true);
    await vi.waitFor(() => expect(useRouter().currentRoute.value.query.tab).toBe('downloads'));
    expect(useRouter().currentRoute.value.query.section).toBeUndefined();
  });

  it('renders a legacy ?tab=music link as the Library pane on the music section', async () => {
    const w = await mountPage({ tab: 'music' });
    const pane = w.find('[data-testid="pane-library"]');
    expect(pane.exists()).toBe(true);
    expect(pane.attributes('data-section')).toBe('music');
  });

  it('shows the active download total as a badge on the Downloads tab', async () => {
    const w = await mountPage();
    expect(w.find('[data-testid="downloads-tab-badge"]').text()).toBe('3');
  });

  it('polls the badge for admins and stops on unmount', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    await mountPage();
    const before = countsCalls();
    expect(before).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(5000);
    expect(countsCalls()).toBe(before + 1);
    wrapper.unmount();
    wrapper = null;
    await vi.advanceTimersByTimeAsync(20000);
    expect(countsCalls()).toBe(before + 1);
  });

  it('starts no polling for non-admins', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    setRole('user');
    await mountPage();
    await vi.advanceTimersByTimeAsync(20000);
    expect(countsCalls()).toBe(0);
  });
});
