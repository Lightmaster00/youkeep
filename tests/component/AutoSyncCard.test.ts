import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import AutoSyncCard from '../../app/components/settings/AutoSyncCard.vue';
import OverviewActivityCard from '../../app/components/settings/OverviewActivityCard.vue';
import DownloadsTab from '../../app/components/settings/DownloadsTab.vue';
import { useToast } from '../../app/composables/useToast';
import { relativeTime, stuckNotice, syncLine } from '../../app/utils/syncStatus';

const HOUR = 60 * 60 * 1000;
const NOW = Date.parse('2026-10-23T12:00:00Z');
let status: any;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  useToast().toasts.value = [];
  useState('modules').value = { video: true, music: true, podcasts: true };
  useState('admin_active_counts').value = null;
  status = {
    video: { enabled: true, schedule: '0 */6 * * *', lastSyncAt: NOW - 3 * 24 * HOUR, lastSyncStartedAt: null, nextRunAt: NOW + 4 * HOUR, running: false, stuck: true },
    music: { enabled: true, schedule: '30 */6 * * *', lastSyncAt: NOW - 2 * HOUR, lastSyncStartedAt: null, nextRunAt: NOW + 30 * 60_000, running: false, stuck: false },
    podcast: { enabled: false, schedule: '45 */6 * * *', lastSyncAt: null, lastSyncStartedAt: null, nextRunAt: null, running: false, stuck: false },
  };
  fetchMock = vi.fn(async (url: string, opts?: any) => {
    if (url === '/api/admin/sync-status') return status;
    if (url.endsWith('/sync-all') && opts?.method === 'POST') return { success: true, message: 'Sync of all channels started.' };
    if (url.endsWith('/concurrency')) return { maxConcurrentDownloads: 2 };
    if (url.endsWith('/schedule')) return { enabled: true, schedule: '0 */6 * * *' };
    if (url === '/api/admin/downloader/active-counts') return { video: { downloading: 0, pending: 0 }, music: { downloading: 0, pending: 0 }, podcasts: { downloading: 0, pending: 0 }, total: 0, current: { kind: null } };
    return { queue: [], queueTotal: 0, failedCount: 0, isPaused: false, settings: {} };
  });
  vi.stubGlobal('$fetch', fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('sync status helpers', () => {
  it('formats past and future times', () => {
    expect(relativeTime(NOW - 30_000, NOW)).toBe('just now');
    expect(relativeTime(NOW - 5 * 60_000, NOW)).toBe('5 minutes ago');
    expect(relativeTime(NOW - HOUR, NOW)).toBe('1 hour ago');
    expect(relativeTime(NOW - 3 * 24 * HOUR, NOW)).toBe('3 days ago');
    expect(relativeTime(NOW + 4 * HOUR, NOW)).toBe('in 4 hours');
  });

  it('writes the last/next line and the stuck notice', () => {
    expect(syncLine(status.video, NOW)).toBe('Last sync: 3 days ago · Next: in 4 hours');
    expect(syncLine(status.podcast, NOW)).toBe('Last sync: never · Next: Off');
    expect(syncLine({ ...status.music, running: true }, NOW)).toBe('Last sync: running now · Next: in 30 minutes');
    expect(stuckNotice(status.video, NOW)).toBe('Automatic sync looks stuck — last sync 3 days ago.');
    expect(stuckNotice(status.music, NOW)).toBeNull();
  });
});

describe('AutoSyncCard', () => {
  it('shows last/next per type and the stuck warning only where stuck', async () => {
    const w = await mountSuspended(AutoSyncCard);
    await flushPromises();
    expect(w.find('[data-testid="auto-sync"]').text()).toContain('Automatic sync');
    expect(w.find('[data-testid="auto-sync-video-line"]').text()).toBe('Last sync: 3 days ago · Next: in 4 hours');
    expect(w.find('[data-testid="auto-sync-podcast-line"]').text()).toBe('Last sync: never · Next: Off');
    expect(w.find('[data-testid="auto-sync-video-stuck"]').text()).toContain('Automatic sync looks stuck');
    expect(w.find('[data-testid="auto-sync-music-stuck"]').exists()).toBe(false);
  });

  it('"Sync now" posts to the existing sync-all route of that type, then reloads the status', async () => {
    const w = await mountSuspended(AutoSyncCard);
    await flushPromises();
    await w.find('[data-testid="auto-sync-music-now"]').trigger('click');
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/music/sync-all', { method: 'POST' });
    expect(fetchMock.mock.calls.filter(([u]) => u === '/api/admin/sync-status')).toHaveLength(2);
    expect(useToast().toasts.value.map((t) => t.message)).toContain('Sync of all channels started.');
  });

  it('hides a disabled module and shows an error when the status cannot load', async () => {
    useState('modules').value = { video: true, music: false, podcasts: true };
    let w = await mountSuspended(AutoSyncCard);
    await flushPromises();
    expect(w.find('[data-testid="auto-sync-music"]').exists()).toBe(false);
    expect(w.find('[data-testid="auto-sync-video"]').exists()).toBe(true);

    fetchMock.mockImplementation(async () => { throw new Error('down'); });
    w = await mountSuspended(AutoSyncCard);
    await flushPromises();
    expect(w.find('[data-testid="auto-sync-error"]').exists()).toBe(true);
  });

  it('compact mode (Overview) has no buttons', async () => {
    const w = await mountSuspended(AutoSyncCard, { props: { compact: true } });
    await flushPromises();
    expect(w.find('[data-testid="auto-sync-video-line"]').exists()).toBe(true);
    expect(w.find('[data-testid="auto-sync-video-now"]').exists()).toBe(false);
  });

  it('appears in the Overview activity card and in Settings > Downloads', async () => {
    const overview = await mountSuspended(OverviewActivityCard);
    await flushPromises();
    expect(overview.find('[data-testid="auto-sync-video-line"]').exists()).toBe(true);
    expect(overview.find('[data-testid="auto-sync-video-now"]').exists()).toBe(false);
    const tab = await mountSuspended(DownloadsTab);
    await flushPromises();
    expect(tab.find('[data-testid="auto-sync-video-now"]').exists()).toBe(true);
    tab.unmount();
  });
});
