import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import MusicIndex from '../../app/pages/music/index.vue';

// #28: /music?q= shows "Loading..." until the search answers, never a
// premature "No results".
beforeEach(() => {
  useState('auth_loading').value = false;
  useState<any>('auth_user').value = { id: 'u1', username: 'u1', role: 'user' };
  useState('modules').value = { video: true, music: true, podcasts: true };
  useState('modules_loaded').value = true;
  vi.stubGlobal('$fetch', vi.fn(async (url: string) => {
    if (url === '/api/music/tracks/search') return { tracks: [{ id: 't1', title: 'Neon lights', artist_name: 'Band', local_file_path: '/m/t1' }] };
    if (url === '/api/music/favorites/status') return { liked: [] };
    if (url.startsWith('/api/music/artists')) return { artists: [], facets: { genres: [], languages: [], years: [] } };
    return {};
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('/music?q=', () => {
  it('shows Loading, then the results', async () => {
    const w = await mountSuspended(MusicIndex, { route: { path: '/music', query: { q: 'neon' } } });
    await flushPromises();
    expect(w.text()).toContain('Loading...');
    expect(w.text()).not.toContain('No results');
    await new Promise((r) => setTimeout(r, 400));
    await flushPromises();
    expect(w.text()).toContain('Neon lights');
    w.unmount();
  });
});
