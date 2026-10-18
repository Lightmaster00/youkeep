import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import ChannelsPage from '../../app/pages/channels.vue';
import { useToast } from '../../app/composables/useToast';
import { CHANNEL_PAGE_SIZE } from '../../app/composables/useChannelVideoPages';

// The first page of a channel's videos is fetched through useRequestFetch, so
// the SSR request carries the viewer's cookies (a private channel used to
// render as "not synchronized" on a direct load). The mock stands for it.
const { requestFetchMock } = vi.hoisted(() => ({ requestFetchMock: vi.fn() }));
mockNuxtImport('useRequestFetch', () => () => requestFetchMock);

let fetchMock: ReturnType<typeof vi.fn>;
let stats: any;
let videoTotal: number;

const page = (total: number, opts: any) => {
  const { offset, limit, is_short } = opts.params;
  const count = Math.max(0, Math.min(limit, total - offset));
  return { videos: Array.from({ length: count }, (_, i) => ({ id: `${is_short ? 's' : 'v'}${offset + i}`, title: `Video ${offset + i}`, download_status: 'completed', is_short })), pagination: { total } };
};

beforeEach(() => {
  clearNuxtData();
  useToast().toasts.value.splice(0);
  useState('channel_hidden_video_ids').value = [];
  useState('auth_loading').value = false;
  stats = { totalCount: 0, completedCount: 0, completedVideosCount: 0, completedShortsCount: 0 };
  videoTotal = 0;
  fetchMock = vi.fn(async (url: string, opts: any = {}) => {
    if (url === '/api/channels/ch1') return { channel: { id: 'ch1', title: 'Empty channel', visibility: 'private', sync_status: 'paused' }, stats };
    if (url === '/api/admin/downloader/ingest') return { message: 'Search started.' };
    if (url === '/api/channels/ch1/subscription') return { subscribed: false };
    if (url === '/api/channels/ch1/playlists') return { playlists: [] };
    if (url === '/api/videos') return page(videoTotal, opts);
    return { channels: [] };
  });
  vi.stubGlobal('$fetch', fetchMock);
  requestFetchMock.mockReset();
  requestFetchMock.mockImplementation(async (url: string, opts: any) => (url === '/api/videos' ? page(videoTotal, opts) : {}));
});
afterEach(() => {
  vi.unstubAllGlobals();
  useState('auth_user').value = null;
});

const as = (user: any) => { useState<any>('auth_user').value = user; };
const calls = (url: string) => fetchMock.mock.calls.filter(([u]) => u === url);
const mountChannel = async (query: Record<string, string> = {}) => {
  const w = await mountSuspended(ChannelsPage, { route: { path: '/channels', query: { channelId: 'ch1', ...query } } });
  await flushPromises();
  return w;
};

describe('empty channel auto-sync (#1)', () => {
  it('an admin triggers one ingest per visit, never again after its own refresh or polls', async () => {
    as({ id: 'a', username: 'boss', role: 'admin' });
    const w = await mountChannel();
    expect(calls('/api/admin/downloader/ingest')).toHaveLength(1);
    // The sync's refresh and later polls hand back a fresh (still empty) channel.
    for (let i = 0; i < 5; i++) {
      await refreshNuxtData();
      await flushPromises();
    }
    expect(calls('/api/admin/downloader/ingest')).toHaveLength(1);
    w.unmount();
  });

  it.each([
    ['a member', { id: 'u', username: 'bob', role: 'user' }],
    ['a guest', null],
  ])('%s never calls it and sees no error toast', async (_who, user) => {
    as(user);
    const w = await mountChannel();
    expect(calls('/api/admin/downloader/ingest')).toHaveLength(0);
    expect(useToast().toasts.value.filter((t) => t.type === 'error')).toHaveLength(0);
    w.unmount();
  });

  it('a guest gets no Subscribe button and no subscription request (#41)', async () => {
    as(null);
    const w = await mountChannel();
    expect(calls('/api/channels/ch1/subscription')).toHaveLength(0);
    expect(w.find('.subscribe-btn').exists()).toBe(false);
    w.unmount();
  });
});

describe('channel videos, lazily paged (#2, #34, R15)', () => {
  beforeEach(() => {
    stats = { totalCount: 150, completedCount: 150, completedVideosCount: 150, completedShortsCount: 0 };
    videoTotal = 150;
  });

  it('renders the first page from the request fetch, then "Show more" adds the next', async () => {
    as({ id: 'u', username: 'bob', role: 'user' });
    const w = await mountChannel();
    // First page: one request through useRequestFetch (cookies on SSR), none of the 50-page loop.
    expect(requestFetchMock.mock.calls.filter(([u, o]) => u === '/api/videos' && o.params.is_short === 0)).toHaveLength(1);
    expect(calls('/api/videos')).toHaveLength(0);
    const grid = () => w.find('[data-testid="channel-videos-grid"]');
    expect(grid().findAll('.video-card, [class*="video-card"]').length || grid().element.children.length).toBe(CHANNEL_PAGE_SIZE);
    const more = w.find('[data-testid="channel-videos-more"]');
    expect(more.text()).toContain(`Showing ${CHANNEL_PAGE_SIZE} of 150`);
    await more.find('button').trigger('click');
    await flushPromises();
    expect(calls('/api/videos')).toHaveLength(1);
    expect(calls('/api/videos')[0]![1].params).toMatchObject({ channelId: 'ch1', offset: CHANNEL_PAGE_SIZE, limit: CHANNEL_PAGE_SIZE, is_short: 0 });
    expect(grid().element.children.length).toBe(CHANNEL_PAGE_SIZE * 2);
    expect(w.find('[data-testid="channel-videos-more"]').text()).toContain('Showing 120 of 150');
    w.unmount();
  });

  it('sends the sort from the URL (?sort=) to the server', async () => {
    as({ id: 'u', username: 'bob', role: 'user' });
    const w = await mountChannel({ sort: 'views_desc', tab: 'shorts' });
    const first = requestFetchMock.mock.calls.find(([u, o]) => u === '/api/videos' && o.params.is_short === 0)!;
    expect(first[1].params.sort).toBe('views_desc');
    // ?tab=shorts selects the Shorts tab.
    expect(w.find('.tab-btn.active').text()).toContain('Shorts');
    w.unmount();
  });
});
