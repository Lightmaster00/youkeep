import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import DefaultLayout from '../../app/layouts/default.vue';
import { buildView } from '../../shared/displayPrefs';

const fetchMock = vi.fn();

function setUp(user: any) {
  useState('auth_loading').value = false;
  useState('auth_user').value = user;
  useState('modules').value = { video: true, music: true, podcasts: true };
  useState('modules_loaded').value = true;
  useState('display_prefs').value = buildView({} as any, null);
  useState('display_prefs_for').value = user?.id ?? null;
}

beforeEach(() => {
  useState('admin_active_counts').value = null;
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) => {
    if (url === '/api/settings/content-search-mode') return { mode: 'per_space' };
    if (url === '/api/settings/modules') return { video: true, music: true, podcasts: true };
    if (url === '/api/admin/downloader/active-counts') {
      return {
        video: { downloading: 1, pending: 2, pausedPending: 110 }, music: { downloading: 0, pending: 0, pausedPending: 0 },
        podcasts: { downloading: 0, pending: 0, pausedPending: 0 }, total: 3, current: { kind: null, progress: null, speed: null },
      };
    }
    return {};
  });
  vi.stubGlobal('$fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  useState('auth_user').value = null;
});

const mountLayout = async () => {
  const w = await mountSuspended(DefaultLayout, { attachTo: document.body });
  await flushPromises();
  return w;
};

describe('header account menu (#9)', () => {
  it('is a real button that opens a keyboard-operable menu', async () => {
    setUp({ id: 'u1', username: 'alice', role: 'user' });
    const w = await mountLayout();
    const btn = w.find('[data-testid="user-menu-button"]');
    expect(btn.element.tagName).toBe('BUTTON');
    expect(btn.attributes('aria-haspopup')).toBe('menu');
    expect(btn.attributes('aria-expanded')).toBe('false');

    (btn.element as HTMLElement).focus();
    await btn.trigger('keydown', { key: 'ArrowDown' });
    await flushPromises();
    expect(btn.attributes('aria-expanded')).toBe('true');
    const items = w.findAll('[role="menuitem"]');
    expect(items.map((i) => i.text().trim().split(/\s+/)[0])).toEqual(['Account', 'Settings', 'Log']);
    expect(document.activeElement).toBe(items[0]!.element);

    await w.find('[data-testid="user-menu"]').trigger('keydown', { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]!.element);
    await w.find('[data-testid="user-menu"]').trigger('keydown', { key: 'End' });
    expect(document.activeElement).toBe(items[2]!.element);

    await w.find('[data-testid="user-menu"]').trigger('keydown', { key: 'Escape' });
    await flushPromises();
    expect(w.find('[data-testid="user-menu"]').exists()).toBe(false);
    expect(document.activeElement).toBe(btn.element);
    w.unmount();
  });
});

describe('header for guests (#22)', () => {
  it('shows a Log in link instead of the account menu', async () => {
    setUp(null);
    const w = await mountLayout();
    expect(w.find('[data-testid="user-menu-button"]').exists()).toBe(false);
    const login = w.find('[data-testid="header-login"]');
    expect(login.exists()).toBe(true);
    expect(login.attributes('href')).toContain('/login');
    w.unmount();
  });
});

describe('header search (#27, #32)', () => {
  it('has a named submit button and combobox semantics', async () => {
    setUp({ id: 'u1', username: 'alice', role: 'user' });
    const w = await mountLayout();
    expect(w.find('.search-btn').attributes('aria-label')).toBe('Search');
    const input = w.find('[data-testid="header-search-input"]');
    expect(input.attributes('role')).toBe('combobox');
    expect(input.attributes('aria-controls')).toBe('header-search-listbox');
    expect(input.attributes('aria-expanded')).toBe('false');
    expect(w.find('#header-search-listbox').attributes('role')).toBe('listbox');
    w.unmount();
  });
});

describe('admin counters (#12, #29)', () => {
  it('counts only pickable items and shows the paused ones apart', async () => {
    setUp({ id: 'a1', username: 'boss', role: 'admin' });
    const w = await mountLayout();
    await w.find('[data-testid="user-menu-button"]').trigger('click');
    await flushPromises();
    const menu = w.find('[data-testid="user-menu"]');
    expect(menu.find('.sidebar-badge').text()).toBe('3');
    expect(menu.text()).toContain('+110 waiting on paused sources');
    w.unmount();
  });
});
