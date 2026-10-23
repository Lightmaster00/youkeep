import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import VideoCategoriesPanel from '../../app/components/settings/VideoCategoriesPanel.vue';

const BASE = '/api/admin/system/metadata-backfill';
const RUN = { state: 'idle', processed: 0, enriched: 0, failed: 0, waitingReason: null, lastError: null, startedAt: null, finishedAt: null };
const STATUS = { total: 10, enriched: 4, pending: 6, enabled: true, run: RUN };

let fetchMock: ReturnType<typeof vi.fn>;
let statusReplies: any[];
let startReply: () => any;
let settingsReply: (body: any) => any;

beforeEach(() => {
  statusReplies = [STATUS];
  startReply = () => ({ started: true, alreadyRunning: false, pending: 6 });
  settingsReply = (body) => ({ enabled: body.enabled });
  fetchMock = vi.fn(async (url: string, opts?: any) => {
    if (url === `${BASE}/status`) return statusReplies.length > 1 ? statusReplies.shift() : statusReplies[0];
    if (url === `${BASE}/start`) return startReply();
    if (url === `${BASE}/settings`) return settingsReply(opts?.body);
    return {};
  });
  vi.stubGlobal('$fetch', fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const mountPanel = async () => {
  const w = await mountSuspended(VideoCategoriesPanel);
  await flushPromises();
  return w;
};
const el = (w: any, id: string) => w.find(`[data-testid="${id}"]`);

describe('VideoCategoriesPanel', () => {
  it('shows the counts and the toggle on mount', async () => {
    const w = await mountPanel();
    const counts = el(w, 'video-categories-counts').text();
    expect(counts).toContain('10 video(s)');
    expect(counts).toContain('4 with categories');
    expect(counts).toContain('6 waiting');
    expect((el(w, 'video-categories-enabled').element as HTMLInputElement).checked).toBe(true);
    expect((el(w, 'video-categories-start').element as HTMLButtonElement).disabled).toBe(false);
  });

  it('"Run now" starts the lookup and follows it until it is done', async () => {
    vi.useFakeTimers();
    statusReplies = [STATUS, { ...STATUS, run: { ...RUN, state: 'running', processed: 2, enriched: 2 } }, { ...STATUS, pending: 0, enriched: 10, run: { ...RUN, state: 'done', processed: 6, enriched: 6 } }];
    const w = await mountPanel();
    await el(w, 'video-categories-start').trigger('click');
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledWith(`${BASE}/start`, { method: 'POST' });
    expect(el(w, 'video-categories-status').text()).toContain('2 video(s) checked');
    await vi.advanceTimersByTimeAsync(2000);
    await flushPromises();
    expect(el(w, 'video-categories-status').text()).toContain('Finished: 6 video(s) updated');
    expect(el(w, 'video-categories-counts').text()).toContain('0 waiting');
  });

  it('shows why a run is waiting', async () => {
    statusReplies = [{ ...STATUS, run: { ...RUN, state: 'running', waitingReason: 'The downloader is paused or the Video module is off.' } }];
    const w = await mountPanel();
    expect(el(w, 'video-categories-status').text()).toContain('Waiting: The downloader is paused');
    w.unmount();
  });

  it('turns the lookup off; "Run now" is then disabled', async () => {
    const w = await mountPanel();
    const box = el(w, 'video-categories-enabled');
    (box.element as HTMLInputElement).checked = false;
    await box.trigger('change');
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledWith(`${BASE}/settings`, { method: 'POST', body: { enabled: false } });
    expect((el(w, 'video-categories-start').element as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows the server message when the start is refused', async () => {
    startReply = () => { throw Object.assign(new Error('x'), { data: { statusMessage: 'Video category lookup is turned off.' } }); };
    const w = await mountPanel();
    await el(w, 'video-categories-start').trigger('click');
    await flushPromises();
    expect(el(w, 'video-categories-error').text()).toBe('Video category lookup is turned off.');
  });
});

describe('SettingsSystemTab', () => {
  it('shows the video categories tool under Tools & logs', async () => {
    const { default: SettingsSystemTab } = await import('../../app/components/settings/SettingsSystemTab.vue');
    const w = await mountSuspended(SettingsSystemTab);
    await flushPromises();
    expect(w.find('[data-testid="system-tools"] [data-testid="video-categories-panel"]').exists()).toBe(true);
  });
});
