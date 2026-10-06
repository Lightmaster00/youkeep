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

  it('stop while an iteration is in flight: no further fetch after it resolves, no timer left', async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    fetchMock.mockImplementation(async (url: string) => { await gate; return payloads[url] ?? {}; });
    const d = useAllDownloads();
    d.startPolling();
    await vi.advanceTimersByTimeAsync(0);
    d.stopPolling();
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
    const before = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10000);
    expect(fetchMock.mock.calls.length).toBe(before);
  });

  it('stop between iterations clears the pending timer', async () => {
    vi.useFakeTimers();
    const d = useAllDownloads();
    d.startPolling();
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(1);
    const before = fetchMock.mock.calls.length;
    d.stopPolling();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10000);
    expect(fetchMock.mock.calls.length).toBe(before);
  });

  it('start, stop, start while the first iteration is in flight leaves exactly ONE loop', async () => {
    vi.useFakeTimers();
    let release!: () => void;
    let gated = true;
    const gate = new Promise<void>((r) => { release = r; });
    fetchMock.mockImplementation(async (url: string) => { if (gated) await gate; return payloads[url] ?? {}; });
    const queueCalls = () => fetchMock.mock.calls.filter(([u]) => u === '/api/admin/downloader/queue').length;
    const d = useAllDownloads();
    d.startPolling();
    await vi.advanceTimersByTimeAsync(0);
    d.stopPolling();
    d.startPolling();
    await vi.advanceTimersByTimeAsync(0);
    expect(queueCalls()).toBe(2); // iteration A and B both in flight
    gated = false;
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(1); // only B reschedules
    const base = queueCalls();
    await vi.advanceTimersByTimeAsync(500 * 4); // m1 downloads -> 500 ms loop
    expect(queueCalls() - base).toBe(4);
    d.stopPolling();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10000);
    expect(queueCalls() - base).toBe(4);
  });

  it('cap boundary: 100 items shows no notice, 101 shows it', async () => {
    const mk = (n: number, total: number) => ({
      queue: Array.from({ length: n }, (_, i) => ({ id: `v${i}`, title: 'x', download_status: 'pending', channel_title: 'c' })),
      queueTotal: total, failedCount: 0, isPaused: false,
    });
    payloads['/api/admin/music/queue'] = { queue: [], queueTotal: 0, failedCount: 0, isPaused: false };
    payloads['/api/admin/podcasts/queue'] = { queue: [], queueTotal: 0, failedCount: 0, isPaused: false };
    payloads['/api/admin/downloader/queue'] = mk(100, 100);
    const d = useAllDownloads();
    await d.refreshAll();
    expect(d.notice.value).toBeNull();
    payloads['/api/admin/downloader/queue'] = mk(100, 101);
    await d.refreshAll();
    expect(d.notice.value).toBe('Showing the first 100 of 101');
  });

  it('keeps the last good total for a type whose route failed; other types stay correct', async () => {
    const d = useAllDownloads();
    await d.refreshAll();
    failing.add('/api/admin/music/queue');
    payloads['/api/admin/downloader/queue'] = { queue: [], queueTotal: 7, failedCount: 0, isPaused: false };
    await d.refreshAll();
    expect(d.states.value.music.error).toBe(true);
    expect(d.counts.value).toEqual({ all: 9, video: 7, music: 1, podcast: 1 });
  });
});
