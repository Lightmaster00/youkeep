import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import HomePage from '../../app/pages/index.vue';
import { buildView } from '../../shared/displayPrefs';

const fetchMock = vi.fn();
let feed: any;

beforeEach(() => {
  feed = { featured: { large: null, small: [] }, sections: [] };
  clearNuxtData(); // useFetch caches /api/home/feed across tests of one file
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) => {
    if (url === '/api/home/feed') return feed;
    if (url === '/api/channels') return { channels: [] };
    return {};
  });
  vi.stubGlobal('$fetch', fetchMock);
  useState('auth_loading').value = false;
  useState('auth_user').value = null;
  useState('modules').value = { video: true, music: true, podcasts: true };
  useState('modules_loaded').value = true;
  useState('display_prefs_for').value = null;
});
afterEach(() => vi.unstubAllGlobals());

async function mountHome() {
  const w = await mountSuspended(HomePage, { route: '/' });
  await flushPromises();
  return w;
}

describe('home page', () => {
  it('renders the music and podcast rows returned by the feed, in order', async () => {
    useState('display_prefs').value = buildView({ homeHero: false, homeSections: ['newEpisodes', 'recentMusic'] }, null);
    feed.sections = [
      { id: 'newEpisodes', title: 'New podcast episodes', episodes: [{ id: 'e1', title: 'Pilot', show_id: 's1', show_title: 'Show', local_file_path: '/p/e1' }] },
      { id: 'recentMusic', title: 'Recently added music', tracks: [{ id: 't1', title: 'Song', artist_id: 'a1', artist_name: 'Band', local_file_path: '/m/t1' }] },
    ];
    const w = await mountHome();
    expect(w.findAll('[data-testid^="home-row-"]').map((r) => r.attributes('data-testid'))).toEqual(['home-row-newEpisodes', 'home-row-recentMusic']);
    expect(w.text()).toContain('Pilot');
    expect(w.text()).toContain('Song');
  });

  it('shows the "home is empty" state when only rows of disabled modules are chosen', async () => {
    useState('modules').value = { video: true, music: false, podcasts: false };
    useState('display_prefs').value = buildView({ homeHero: false, homeSections: ['recentMusic', 'newEpisodes'] }, null);
    const w = await mountHome();
    expect(w.text()).toContain('Home is empty');
  });

  it('shows the generic empty-library state when chosen rows have nothing yet', async () => {
    useState('display_prefs').value = buildView({ homeHero: false, homeSections: ['recentMusic'] }, null);
    const w = await mountHome();
    expect(w.text()).toContain('Nothing here yet');
  });
});
