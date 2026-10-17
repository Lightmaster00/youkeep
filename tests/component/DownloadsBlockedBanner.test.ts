import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import DownloadsBlockedBanner from '../../app/components/settings/DownloadsBlockedBanner.vue';
import ChannelSettingsDrawer from '../../app/components/channels/ChannelSettingsDrawer.vue';
import { useActiveCounts } from '../../app/composables/useActiveCounts';
import { useDownloadsQueue } from '../../app/composables/useDownloadsQueue';

const REASON = 'The configured downloads folder /mnt/media is missing or not writable.';
const counts = (blockedReason: string | null) => ({
  video: { downloading: 0, pending: 3 }, music: { downloading: 0, pending: 0 }, podcasts: { downloading: 0, pending: 0 },
  total: 3, current: { kind: null, progress: null, speed: null }, blockedReason,
});

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  useState('admin_active_counts').value = null;
  useState('downloads_blocked_reason').value = null;
});
afterEach(() => vi.unstubAllGlobals());

describe('DownloadsBlockedBanner', () => {
  it('shows the paused message from active-counts and hides it once cleared', async () => {
    let reply = counts(REASON);
    vi.stubGlobal('$fetch', vi.fn(async () => reply));
    const { fetchActiveCounts } = useActiveCounts();
    await fetchActiveCounts();
    const w = await mountSuspended(DownloadsBlockedBanner);
    expect(w.find('[data-testid="downloads-blocked"]').text()).toBe(
      'Downloads are paused: The configured downloads folder /mnt/media is missing or not writable. Check that the downloads folder is mounted and writable.'
    );
    expect(w.find('[role="alert"]').exists()).toBe(true);
    reply = counts(null);
    await fetchActiveCounts();
    await flushPromises();
    expect(w.find('[data-testid="downloads-blocked"]').exists()).toBe(false);
  });

  it('is also fed by the downloader log', async () => {
    vi.stubGlobal('$fetch', vi.fn(async () => ({ logs: [], ytdlPath: '', blockedReason: REASON })));
    const { fetchDiagnostics } = useDownloadsQueue();
    await fetchDiagnostics();
    const w = await mountSuspended(DownloadsBlockedBanner);
    expect(w.text()).toContain('Downloads are paused');
  });

  it('renders nothing while downloads run', async () => {
    const w = await mountSuspended(DownloadsBlockedBanner);
    expect(w.find('[data-testid="downloads-blocked"]').exists()).toBe(false);
  });
});

describe('ChannelSettingsDrawer', () => {
  it('saves a partial update that leaves the date filter alone', async () => {
    clearNuxtData();
    useState('auth_loading').value = false;
    useState<any>('auth_user').value = { id: 'a1', username: 'boss', role: 'admin' };
    fetchMock = vi.fn(async (url: string, opts?: any) => {
      if (url === '/api/channels/UC1') {
        return { channel: { id: 'UC1', title: 'Chan', download_videos: 1, download_shorts: 0, custom_save_path: '', visibility: 'public' }, stats: {} };
      }
      if (url === '/api/videos') return { videos: [], pagination: { total: 0 } };
      if (opts?.method === 'PUT') return { success: true };
      return {};
    });
    vi.stubGlobal('$fetch', fetchMock);
    const w = await mountSuspended(ChannelSettingsDrawer, {
      props: { showDrawer: true },
      route: { path: '/channels', query: { channelId: 'UC1' } },
    });
    await flushPromises();
    await w.find('form').trigger('submit');
    await flushPromises();
    const put = fetchMock.mock.calls.find(([u, o]) => u === '/api/admin/channels/UC1/options' && o?.method === 'PUT')!;
    expect(put).toBeDefined();
    expect('dateAfter' in put[1].body).toBe(false);
    expect(put[1].body.downloadVideos).toBe(true);
  });
});
