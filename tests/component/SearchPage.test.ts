import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import SearchPage from '../../app/pages/search.vue';

// The results are loaded through useRequestFetch (the viewer's cookies reach
// the API during SSR), so the first render already holds what this user may
// see, private videos included.
const { requestFetchMock } = vi.hoisted(() => ({ requestFetchMock: vi.fn() }));
mockNuxtImport('useRequestFetch', () => () => requestFetchMock);

beforeEach(() => {
  clearNuxtData();
  useState('auth_loading').value = false;
  useState<any>('auth_user').value = { id: 'u1', username: 'bob', role: 'user' };
  useState('modules').value = { video: true, music: true, podcasts: true };
  useState('modules_loaded').value = true;
  // A guest-like bare $fetch would find nothing.
  vi.stubGlobal('$fetch', vi.fn(async () => ({ videos: [], tracks: [], episodes: [] })));
  requestFetchMock.mockReset();
  requestFetchMock.mockImplementation(async (url: string) => {
    if (url === '/api/videos') return { videos: [{ id: 'priv1', title: 'Private sushi video', channel_title: 'Family' }] };
    if (url === '/api/music/tracks/search') return { tracks: [{ id: 't1', title: 'Sushi song', artist_name: 'Band' }] };
    if (url === '/api/podcasts/episodes/search') return { episodes: [] };
    return {};
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  useState('auth_user').value = null;
});

describe('/search', () => {
  it('renders the signed-in viewer\'s results on the first render', async () => {
    const w = await mountSuspended(SearchPage, { route: { path: '/search', query: { q: 'sushi' } } });
    await flushPromises();
    expect(w.text()).toContain('Private sushi video');
    expect(w.text()).toContain('Sushi song');
    expect(w.text()).toContain('No episodes');
    expect(requestFetchMock).toHaveBeenCalledWith('/api/videos', expect.objectContaining({ params: expect.objectContaining({ q: 'sushi' }) }));
    w.unmount();
  });
});

describe('/search: Videos then Shorts', () => {
  beforeEach(() => {
    requestFetchMock.mockImplementation(async (url: string, opts: any = {}) => {
      if (url === '/api/videos') {
        return opts.params?.type === 'short'
          ? { videos: [{ id: 's1', title: 'Sushi short', is_short: 1 }] }
          : { videos: [{ id: 'v1', title: 'Sushi long video', is_short: 0 }] };
      }
      return { tracks: [], episodes: [] };
    });
  });

  it('asks for each kind separately and shows two sections, never interleaved', async () => {
    const w = await mountSuspended(SearchPage, { route: { path: '/search', query: { q: 'sushi' } } });
    await flushPromises();
    const types = requestFetchMock.mock.calls.filter(([u]) => u === '/api/videos').map(([, o]) => o.params.type).sort();
    expect(types).toEqual(['short', 'video']);
    const titles = w.findAll('h2.search-section-title').map((h) => h.text());
    expect(titles.slice(0, 2)).toEqual(['Videos', 'Shorts']);
    const videos = w.find('[data-testid="search-videos"]');
    const shorts = w.find('[data-testid="search-shorts"]');
    expect(videos.text()).toContain('Sushi long video');
    expect(videos.text()).not.toContain('Sushi short');
    expect(shorts.text()).toContain('Sushi short');
    expect(shorts.text()).not.toContain('Sushi long video');
    expect(shorts.find('.thumbnail-wrapper').classes()).toContain('media-frame--short');
    expect(shorts.find('[data-testid="short-badge"]').text()).toBe('SHORT');
    expect(videos.find('[data-testid="short-badge"]').exists()).toBe(false);
    w.unmount();
  });

  it('shows no Shorts section when no Short matches', async () => {
    requestFetchMock.mockImplementation(async (url: string, opts: any = {}) =>
      url === '/api/videos' ? { videos: opts.params?.type === 'short' ? [] : [{ id: 'v1', title: 'Sushi long video' }] } : { tracks: [], episodes: [] });
    const w = await mountSuspended(SearchPage, { route: { path: '/search', query: { q: 'sushi' } } });
    await flushPromises();
    expect(w.find('[data-testid="search-shorts"]').exists()).toBe(false);
    expect(w.text()).toContain('Sushi long video');
    w.unmount();
  });
});
