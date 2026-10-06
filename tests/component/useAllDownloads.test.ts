import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useAllDownloads } from '../../app/composables/useAllDownloads';

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

beforeEach(() => {
  for (const [key, value] of Object.entries(STATE_DEFAULTS)) useState(key).value = structuredClone(value);
  failing = new Set();
  payloads = {
    '/api/admin/downloader/queue': { queue: [{ id: 'v1', title: 'V1', download_status: 'pending', channel_title: 'Chan' }], queueTotal: 1, failedCount: 0, isPaused: false },
    '/api/admin/music/queue': { queue: [{ id: 'm1', title: 'M1', download_status: 'downloading', download_progress: 50, artist_name: 'Art' }], queueTotal: 1, failedCount: 0, isPaused: true },
    '/api/admin/podcasts/queue': { queue: [{ id: 'p1', title: 'P1', download_status: 'failed', show_title: 'Show' }], queueTotal: 1, failedCount: 1, isPaused: false },
  };
  fetchMock = vi.fn(async (url: string) => {
    if (failing.has(url)) throw new Error('down');
    return payloads[url] ?? {};
  });
  vi.stubGlobal('$fetch', fetchMock);
});

afterEach(() => {
  useAllDownloads().stopPolling();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useAllDownloads', () => {
  it('merges the three queues: downloading first, then queued, then failed', async () => {
    const d = useAllDownloads();
    await d.refreshAll();
    expect(d.visible.value.items.map((i) => `${i.kind}:${i.id}`)).toEqual(['music:m1', 'video:v1', 'podcast:p1']);
    expect(d.counts.value).toEqual({ all: 3, video: 1, music: 1, podcast: 1 });
    expect(d.states.value.music.isPaused).toBe(true);
    expect(d.notice.value).toBeNull();
  });

  it('applies the filter', async () => {
    const d = useAllDownloads();
    await d.refreshAll();
    d.filter.value = 'podcast';
    expect(d.visible.value.items.map((i) => i.id)).toEqual(['p1']);
  });

  it('reports the cap notice from the route totals', async () => {
    payloads['/api/admin/downloader/queue'] = {
      queue: Array.from({ length: 100 }, (_, i) => ({ id: `v${i}`, title: 'x', download_status: 'pending', channel_title: 'c' })),
      queueTotal: 250, failedCount: 0, isPaused: false,
    };
    const d = useAllDownloads();
    await d.refreshAll();
    expect(d.notice.value).toBe('Showing the first 100 of 252');
    d.filter.value = 'video';
    expect(d.notice.value).toBe('Showing the first 100 of 250');
  });

  it('marks only the failing type as in error and keeps the others working', async () => {
    failing.add('/api/admin/music/queue');
    const d = useAllDownloads();
    await d.refreshAll();
    expect(d.states.value.music.error).toBe(true);
    expect(d.states.value.video.error).toBe(false);
    expect(d.states.value.podcast.error).toBe(false);
    expect(d.visible.value.items.map((i) => i.id)).toEqual(['v1', 'p1']);
  });

  it('runs ONE loop: 500 ms while something downloads, 3 s otherwise, and stops cleanly', async () => {
    vi.useFakeTimers();
    const d = useAllDownloads();
    const queueCalls = () => fetchMock.mock.calls.filter(([u]) => u === '/api/admin/downloader/queue').length;

    d.startPolling();
    d.startPolling(); // a second start must not create a second loop
    await vi.advanceTimersByTimeAsync(0);
    expect(queueCalls()).toBe(1);

    await vi.advanceTimersByTimeAsync(500); // music m1 is downloading → fast loop
    expect(queueCalls()).toBe(2);

    payloads['/api/admin/music/queue'] = { queue: [], queueTotal: 0, failedCount: 0, isPaused: false };
    await vi.advanceTimersByTimeAsync(500);
    expect(queueCalls()).toBe(3);
    await vi.advanceTimersByTimeAsync(2999); // now idle → 3 s
    expect(queueCalls()).toBe(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(queueCalls()).toBe(4);

    d.stopPolling();
    await vi.advanceTimersByTimeAsync(10000);
    expect(queueCalls()).toBe(4);
  });
});
