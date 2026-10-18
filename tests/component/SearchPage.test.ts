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
