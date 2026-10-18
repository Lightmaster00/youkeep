import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import ShortsPage from '../../app/pages/shorts.vue';

// /shorts is public: a guest gets the public Shorts from the (now public)
// /api/videos/recommend, and never posts watch time (#15).
const fetchMock = vi.fn();

beforeEach(() => {
  useState('auth_loading').value = false;
  useState('auth_user').value = null;
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) => {
    if (url === '/api/videos/recommend') return { videos: [{ id: 's1', title: 'Public short', channel_title: 'C', channel_id: 'c1', is_short: 1, publicly_shareable: 1, local_video_path: '/m/s1.mp4' }] };
    if (url.startsWith('/api/videos/s1')) return { video: { id: 's1' }, comments: [] };
    return {};
  });
  vi.stubGlobal('$fetch', fetchMock);
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => vi.unstubAllGlobals());

describe('/shorts for a guest', () => {
  it('shows the public Shorts and posts no watch time', async () => {
    const w = await mountSuspended(ShortsPage, { route: '/shorts' });
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledWith('/api/videos/recommend');
    expect(w.text()).toContain('Public short');
    expect(w.text()).not.toContain('No Shorts available');
    w.unmount();
    await flushPromises();
    expect(fetchMock.mock.calls.some(([u]) => u === '/api/videos/track')).toBe(false);
  });
});
