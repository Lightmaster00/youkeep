import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import DefaultLayout from '../../app/layouts/default.vue';
import { buildView } from '../../shared/displayPrefs';

const fetchMock = vi.fn();

async function setUp(uiLanguage: 'en' | 'fr') {
  useState('auth_loading').value = false;
  useState('auth_user').value = { id: 'u1', username: 'alice', role: 'user', uiLanguage };
  useState('modules').value = { video: true, music: true, podcasts: true };
  useState('modules_loaded').value = true;
  useState('display_prefs').value = buildView({} as any, null);
  useState('display_prefs_for').value = 'u1';
  await useNuxtApp().$i18n.setLocale(uiLanguage);
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) => {
    if (url === '/api/settings/content-search-mode') return { mode: 'per_space' };
    if (url === '/api/settings/modules') return { video: true, music: true, podcasts: true };
    return {};
  });
  vi.stubGlobal('$fetch', fetchMock);
});
afterEach(async () => {
  vi.unstubAllGlobals();
  useState('auth_user').value = null;
  await useNuxtApp().$i18n.setLocale('en');
});

async function mountOpenMenu() {
  const w = await mountSuspended(DefaultLayout, { attachTo: document.body });
  await flushPromises();
  await w.find('[data-testid="user-menu-button"]').trigger('click');
  await flushPromises();
  return w;
}

describe('layout follows the UI language', () => {
  it.each([
    ['en', ['Account', 'Settings', 'Log out'], ['Home', 'Subscriptions'], 'Search'],
    ['fr', ['Compte', 'Paramètres', 'Se déconnecter'], ['Accueil', 'Abonnements'], 'Rechercher'],
  ] as const)('%s: user menu, sidebar and search label', async (lang, menu, sidebar, search) => {
    await setUp(lang);
    const w = await mountOpenMenu();
    const items = w.findAll('[role="menuitem"]').map((i) => i.text().trim());
    expect(items).toEqual(menu);
    const links = w.findAll('.sidebar-link').map((a) => a.text());
    for (const label of sidebar) expect(links).toContain(label);
    expect(w.find('.search-btn').attributes('aria-label')).toBe(search);
    w.unmount();
  });

  it('switches without remounting when the language changes', async () => {
    await setUp('en');
    const w = await mountOpenMenu();
    expect(w.find('.sidebar-link').text()).toBe('Home');
    // As the selector does: the saved language is updated first.
    useState<any>('auth_user').value = { ...useState<any>('auth_user').value, uiLanguage: 'fr' };
    await useNuxtApp().$i18n.setLocale('fr');
    await flushPromises();
    expect(w.find('.sidebar-link').text()).toBe('Accueil');
    w.unmount();
  });
});
