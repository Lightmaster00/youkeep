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

  it('searches when ?q= appears on "/" and returns to the feed when it goes (#3)', async () => {
    feed.featured.large = { id: 'hero', title: 'Hero video', channel_title: 'C' };
    fetchMock.mockImplementation(async (url: string, opts: any = {}) => {
      if (url === '/api/home/feed') return feed;
      if (url === '/api/channels') return { channels: [] };
      if (url === '/api/videos') return opts.params?.q === 'sushi'
        ? { videos: [{ id: 'v1', title: 'Sushi rolls', channel_title: 'C' }], pagination: { total: 1, totalPages: 1 } }
        : { videos: [], pagination: { total: 0, totalPages: 0 } };
      return {};
    });
    const w = await mountHome();
    expect(w.text()).toContain('Hero video');
    const router = useRouter();
    await router.push('/?q=sushi');
    await flushPromises();
    expect(fetchMock.mock.calls.some(([u, o]) => u === '/api/videos' && o?.params?.q === 'sushi')).toBe(true);
    expect(w.find('[data-testid="home-search-results"]').text()).toContain('Sushi rolls');
    await router.push('/?q=nothing');
    await flushPromises();
    expect(w.find('[data-testid="home-search-empty"]').exists()).toBe(true);
    await router.push('/');
    await flushPromises();
    expect(w.text()).toContain('Hero video');
    expect(w.text()).not.toContain('Nothing here yet');
  });

  it('tells only guests to log in on an empty library (#22)', async () => {
    useState('display_prefs').value = buildView({ homeHero: true, homeSections: ['popular'] }, null);
    let w = await mountHome();
    expect(w.find('[data-testid="home-empty"]').text()).toContain('Log in as administrator');
    w.unmount();
    clearNuxtData();
    useState<any>('auth_user').value = { id: 'a', username: 'boss', role: 'admin' };
    w = await mountHome();
    expect(w.find('[data-testid="home-empty"]').text()).not.toContain('Log in');
    w.unmount();
  });
});

describe('home search (/?q=): Videos then Shorts', () => {
  it('shows matching long videos, then matching Shorts in their own section', async () => {
    fetchMock.mockImplementation(async (url: string, opts: any = {}) => {
      if (url === '/api/channels') return { channels: [] };
      if (url === '/api/videos') return opts.params?.type === 'short'
        ? { videos: [{ id: 's1', title: 'Sushi short', is_short: 1 }], pagination: { total: 1, totalPages: 1 } }
        : { videos: [{ id: 'v1', title: 'Sushi rolls', is_short: 0 }], pagination: { total: 1, totalPages: 1 } };
      return {};
    });
    const w = await mountSuspended(HomePage, { route: '/?q=sushi' });
    await flushPromises();
    const types = fetchMock.mock.calls.filter(([u]) => u === '/api/videos').map(([, o]) => o.params.type).sort();
    expect(types).toEqual(['short', 'video']);
    const results = w.find('[data-testid="home-search-results"]');
    const shorts = w.find('[data-testid="home-search-shorts"]');
    expect(results.text()).toContain('Sushi rolls');
    expect(results.text()).not.toContain('Sushi short');
    expect(shorts.text()).toContain('Sushi short');
    expect(shorts.find('.media-frame--short').exists()).toBe(true);
    // The Shorts section comes after the videos.
    const html = w.html();
    expect(html.indexOf('home-search-results')).toBeLessThan(html.indexOf('home-search-shorts'));
    w.unmount();
  });
});

describe('home page with the sections of the new feed', () => {
  const video = (id: string, extra: object = {}) => ({ id, title: `Title ${id}`, channel_id: 'c1', channel_title: 'Chan', channel_avatar: null, duration: 60, view_count: 1, upload_date: null, local_video_path: '/v.mp4', local_thumbnail_path: null, ...extra });

  it('renders video rows, category groups, playlists and channels in the feed order', async () => {
    useState('display_prefs').value = buildView({ homeHero: false }, null);
    feed.sections = [
      { id: 'continue', title: 'Continue watching', videos: [video('a', { positionSeconds: 30, durationSeconds: 60, progress: 0.5 })] },
      { id: 'forYou', title: 'Recommended for you', videos: [video('b', { reason: { kind: 'new', label: 'New' } })] },
      { id: 'byCategory', title: 'Browse by category', groups: [{ category: 'Gaming', title: 'Gaming', videos: [video('c')] }, { category: 'Music', title: 'Music', videos: [video('d')] }] },
      { id: 'playlists', title: 'Your playlists', playlists: [{ id: 'p1', title: 'Road trip', visibility: 'private', created_at: 1, video_count: 4, cover_video_id: 'a', thumbnail_path: null }] },
      { id: 'discoverChannels', title: 'Channels to discover', channels: [{ id: 'UC9', title: 'Fresh channel', avatar_url: null, video_count: 7, categories: ['Gaming'] }] },
    ];
    const w = await mountHome();
    expect(w.findAll('[data-testid^="home-row-"]').map((r) => r.attributes('data-testid')))
      .toEqual(['home-row-continue', 'home-row-forYou', 'home-row-byCategory', 'home-row-byCategory', 'home-row-playlists', 'home-row-discoverChannels']);
    const text = w.text();
    for (const t of ['Continue watching', 'Title a', 'Title b', 'Gaming', 'Music', 'Title c', 'Road trip', '4 videos', 'Fresh channel']) expect(text).toContain(t);
    expect(w.find('a[href="/playlists/p1"]').exists()).toBe(true);
    expect(w.find('a[href="/channels?channelId=UC9"]').exists()).toBe(true);
  });
});
