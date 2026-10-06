import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import DownloadsTab from '../../app/components/settings/DownloadsTab.vue';
import { useToast } from '../../app/composables/useToast';

const STATE_DEFAULTS: Record<string, any> = {
  settings_downloads_queue: [], settings_downloads_queue_total: 0, settings_downloads_failed_count: 0,
  settings_downloads_is_paused: false, settings_downloads_queue_error: false, settings_downloads_smooth_progress: {},
  settings_music_queue: [], settings_music_queue_total: 0, settings_music_failed_count: 0,
  settings_music_is_paused: false, settings_music_queue_error: false,
  settings_podcast_queue: [], settings_podcast_queue_total: 0, settings_podcast_failed_count: 0,
  settings_podcast_is_paused: false, settings_podcast_queue_error: false,
  settings_downloads_filter: 'all',
};

let payloads: Record<string, any>;
let failing: Set<string>;
let fetchMock: ReturnType<typeof vi.fn>;
let wrapper: any;

beforeEach(() => {
  for (const [key, value] of Object.entries(STATE_DEFAULTS)) useState(key).value = structuredClone(value);
  useToast().toasts.value = [];
  failing = new Set();
  payloads = {
    '/api/admin/downloader/queue': {
      queue: [
        { id: 'v1', title: 'Video one', download_status: 'pending', channel_title: 'Chan' },
        { id: 'v2', title: 'Video two', download_status: 'failed', channel_title: 'Chan', last_error: 'boom' },
      ],
      queueTotal: 150, failedCount: 1, isPaused: false,
    },
    '/api/admin/music/queue': { queue: [{ id: 'm1', title: 'Track', download_status: 'downloading', download_progress: 10, artist_name: 'Art' }], queueTotal: 1, failedCount: 0, isPaused: false },
    '/api/admin/podcasts/queue': { queue: [{ id: 'p1', title: 'Episode', download_status: 'pending', show_title: 'Show' }], queueTotal: 1, failedCount: 0, isPaused: true },
  };
  fetchMock = vi.fn(async (url: string, opts?: any) => {
    if (failing.has(url)) throw new Error('down');
    if (payloads[url] && !opts?.method) return payloads[url];
    if (url.endsWith('/concurrency')) return { maxConcurrentDownloads: 2 };
    if (url.endsWith('/schedule')) return { enabled: false, schedule: '' };
    if (url === '/api/admin/downloader/sponsorblock') return { settings: {} };
    if (url === '/api/settings/music-clips') return { enabled: false };
    return { success: true };
  });
  vi.stubGlobal('$fetch', fetchMock);
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  vi.unstubAllGlobals();
});

const mountTab = async () => {
  wrapper = await mountSuspended(DownloadsTab);
  await flushPromises();
  return wrapper;
};
const cardIds = (w: any) => w.findAll('.queue-card-premium').map((c: any) => c.attributes('data-testid'));

describe('DownloadsTab', () => {
  it('shows the three type cards, the filter counts and the Advanced disclosure', async () => {
    const w = await mountTab();
    expect(w.find('[data-testid="type-card-video"]').exists()).toBe(true);
    expect(w.find('[data-testid="type-card-music"]').exists()).toBe(true);
    expect(w.find('[data-testid="type-card-podcast"]').find('[data-testid="type-card-state"]').text()).toBe('Paused');
    expect(w.find('[data-testid="filter-all"]').text()).toBe('All 152');
    expect(w.find('[data-testid="filter-video"]').text()).toBe('Videos 150');
    expect(w.find('[data-testid="filter-music"]').text()).toBe('Music 1');
    expect(w.find('[data-testid="filter-podcast"]').text()).toBe('Podcasts 1');
    expect(w.find('[data-testid="downloads-advanced"]').exists()).toBe(true);
  });

  it('lists downloading items first across types, then queued, then failed', async () => {
    const w = await mountTab();
    expect(cardIds(w)).toEqual(['queue-item-music-m1', 'queue-item-video-v1', 'queue-item-podcast-p1', 'queue-item-video-v2']);
  });

  it('shows "Showing the first N of M" from the route totals', async () => {
    const w = await mountTab();
    expect(w.find('[data-testid="queue-cap-notice"]').text()).toBe('Showing the first 4 of 152');
    await w.find('[data-testid="filter-music"]').trigger('click');
    expect(w.find('[data-testid="queue-cap-notice"]').exists()).toBe(false);
    expect(cardIds(w)).toEqual(['queue-item-music-m1']);
  });

  it('runs a queue action and refreshes', async () => {
    const w = await mountTab();
    const before = fetchMock.mock.calls.filter(([u]) => u === '/api/admin/downloader/queue').length;
    await w.find('[data-testid="queue-item-video-v1"] [data-testid="queue-action-prioritize"]').trigger('click');
    await flushPromises();
    const post = fetchMock.mock.calls.find(([u, o]) => u === '/api/admin/downloader/prioritize' && o?.method === 'POST');
    expect(post![1].body).toEqual({ videoId: 'v1' });
    expect(fetchMock.mock.calls.filter(([u]) => u === '/api/admin/downloader/queue').length).toBeGreaterThan(before);
  });

  it('shows the empty state', async () => {
    for (const url of Object.keys(payloads)) payloads[url] = { queue: [], queueTotal: 0, failedCount: 0, isPaused: false };
    const w = await mountTab();
    expect(w.find('[data-testid="queue-empty"]').text()).toContain('Nothing is downloading');
  });

  it('keeps the other types working when one queue route fails', async () => {
    failing.add('/api/admin/podcasts/queue');
    const w = await mountTab();
    expect(w.find('[data-testid="type-card-podcast"] [data-testid="type-card-error"]').exists()).toBe(true);
    expect(w.find('[data-testid="type-card-video"] [data-testid="type-card-error"]').exists()).toBe(false);
    expect(cardIds(w)).toContain('queue-item-music-m1');
  });
});
