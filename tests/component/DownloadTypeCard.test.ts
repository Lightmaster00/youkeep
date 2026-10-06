import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import DownloadTypeCard from '../../app/components/settings/DownloadTypeCard.vue';
import { emptyTypeState, type TypeQueueState, type QueueItem } from '../../app/utils/allDownloads';
import { useToast } from '../../app/composables/useToast';

let fetchMock: ReturnType<typeof vi.fn>;
let serverConcurrency: number;
let failSave: boolean;

const posts = (url: string) => fetchMock.mock.calls.filter(([u, o]) => u === url && o?.method === 'POST');
const st = (over: Partial<TypeQueueState> = {}): TypeQueueState => ({ ...emptyTypeState(), ...over });
const dl = (id: string): QueueItem => ({ kind: 'music', id, title: id, source: 's', status: 'downloading', progress: 0, speed: null, eta: null, lastError: null });

beforeEach(() => {
  serverConcurrency = 3;
  failSave = false;
  useToast().toasts.value = [];
  fetchMock = vi.fn(async (url: string, opts?: any) => {
    if (url.endsWith('/concurrency') && !opts?.method) return { maxConcurrentDownloads: serverConcurrency };
    if (url.endsWith('/concurrency') && opts?.method === 'POST') {
      if (failSave) throw Object.assign(new Error('x'), { data: { statusMessage: 'Must be between 1 and 10' } });
      serverConcurrency = opts.body.maxConcurrentDownloads;
      return { success: true };
    }
    return { success: true };
  });
  vi.stubGlobal('$fetch', fetchMock);
  vi.stubGlobal('confirm', vi.fn(() => true));
});
afterEach(() => vi.unstubAllGlobals());

const mountCard = async (kind: 'video' | 'music' | 'podcast', state: TypeQueueState) => {
  const w = await mountSuspended(DownloadTypeCard, { props: { kind, state } });
  await flushPromises();
  return w;
};

describe('DownloadTypeCard', () => {
  it('shows the type, its state and a summary', async () => {
    const w = await mountCard('music', st({ items: [dl('a')], total: 12, failedCount: 2 }));
    expect(w.text()).toContain('Music');
    expect(w.find('[data-testid="type-card-state"]').text()).toBe('Active');
    expect(w.find('[data-testid="type-card-summary"]').text()).toBe('1 downloading · 9 queued');
    expect(w.find('[data-testid="pause-toggle"]').text()).toBe('Pause');
  });

  it('Pause and Resume call the type routes and ask for a refresh', async () => {
    const w = await mountCard('music', st());
    await w.find('[data-testid="pause-toggle"]').trigger('click');
    await flushPromises();
    expect(posts('/api/admin/music/pause')).toHaveLength(1);
    expect(w.emitted('changed')).toHaveLength(1);

    const p = await mountCard('podcast', st({ isPaused: true }));
    expect(p.find('[data-testid="type-card-state"]').text()).toBe('Paused');
    await p.find('[data-testid="pause-toggle"]').trigger('click');
    await flushPromises();
    expect(posts('/api/admin/podcasts/resume')).toHaveLength(1);
  });

  it('loads and saves the number of simultaneous downloads', async () => {
    const w = await mountCard('video', st());
    const input = w.find('[data-testid="concurrency-input"]');
    expect((input.element as HTMLInputElement).value).toBe('3');
    expect(w.text()).toContain('Simultaneous downloads');
    await input.setValue('5');
    await w.find('[data-testid="concurrency-save"]').trigger('click');
    await flushPromises();
    expect(posts('/api/admin/downloader/concurrency')[0][1].body).toEqual({ maxConcurrentDownloads: 5 });
  });

  it('after a failed save, puts the server value back', async () => {
    failSave = true;
    const w = await mountCard('music', st());
    const input = w.find('[data-testid="concurrency-input"]');
    await input.setValue('50');
    await w.find('[data-testid="concurrency-save"]').trigger('click');
    await flushPromises();
    expect(useToast().toasts.value.map((t) => t.message)).toContain('Must be between 1 and 10');
    expect((input.element as HTMLInputElement).value).toBe('3');
  });

  it('shows "N failed" with Retry only when there are failures', async () => {
    const none = await mountCard('podcast', st());
    expect(none.find('[data-testid="retry-failed"]').exists()).toBe(false);
    const w = await mountCard('podcast', st({ failedCount: 4, total: 4 }));
    expect(w.text()).toContain('4 failed');
    await w.find('[data-testid="retry-failed"]').trigger('click');
    await flushPromises();
    expect(posts('/api/admin/podcasts/retry-failed')).toHaveLength(1);
    expect(w.emitted('changed')).toHaveLength(1);
  });

  it('shows an error state when its queue could not be loaded', async () => {
    const w = await mountCard('music', st({ error: true }));
    expect(w.find('[data-testid="type-card-error"]').text()).toContain("Couldn't load the music queue");
  });

  it('offers Clear queue for videos only, after confirmation', async () => {
    const m = await mountCard('music', st({ total: 3 }));
    expect(m.find('[data-testid="clear-queue"]').exists()).toBe(false);
    const v = await mountCard('video', st({ total: 3 }));
    await v.find('[data-testid="clear-queue"]').trigger('click');
    await flushPromises();
    expect(posts('/api/admin/downloader/clear-queue')).toHaveLength(1);

    vi.stubGlobal('confirm', vi.fn(() => false));
    await v.find('[data-testid="clear-queue"]').trigger('click');
    await flushPromises();
    expect(posts('/api/admin/downloader/clear-queue')).toHaveLength(1);
  });
});
