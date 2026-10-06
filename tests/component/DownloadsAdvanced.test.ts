import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import DownloadsAdvanced from '../../app/components/settings/DownloadsAdvanced.vue';
import { useToast } from '../../app/composables/useToast';

let fetchMock: ReturnType<typeof vi.fn>;
let schedules: Record<string, { enabled: boolean; schedule: string }>;
let failSchedule: boolean;
let clipsEnabled: boolean;
let failClips: boolean;

const posts = (url: string) => fetchMock.mock.calls.filter(([u, o]) => u === url && o?.method === 'POST');
const toastMessages = () => useToast().toasts.value.map((t) => t.message);

beforeEach(() => {
  schedules = {
    '/api/admin/downloader/schedule': { enabled: true, schedule: '0 3 * * *' },
    '/api/admin/music/schedule': { enabled: true, schedule: '15 2 * * *' },
    '/api/admin/podcasts/schedule': { enabled: false, schedule: '0 4 * * *' },
  };
  failSchedule = false;
  clipsEnabled = false;
  failClips = false;
  useToast().toasts.value = [];
  fetchMock = vi.fn(async (url: string, opts?: any) => {
    if (schedules[url] && !opts?.method) return { ...schedules[url] };
    if (schedules[url] && opts?.method === 'POST') {
      if (failSchedule) throw Object.assign(new Error('x'), { data: { statusMessage: 'Invalid cron' } });
      schedules[url] = { ...opts.body };
      return { success: true };
    }
    if (url === '/api/admin/downloader/sponsorblock' && !opts?.method) return { settings: { sponsor: 'remove', intro: 'ignore', outro: 'ignore', selfpromo: 'mark', interaction: 'ignore', filler: 'ignore' } };
    if (url === '/api/admin/downloader/sponsorblock' && opts?.method === 'POST') return { success: true };
    if (url === '/api/settings/music-clips') return { enabled: clipsEnabled };
    if (url === '/api/admin/settings/music-clips' && opts?.method === 'POST') {
      if (failClips) throw Object.assign(new Error('x'), { data: { statusMessage: 'Not allowed' } });
      clipsEnabled = opts.body.enabled;
      return { success: true };
    }
    return {};
  });
  vi.stubGlobal('$fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const mountAdvanced = async () => {
  const w = await mountSuspended(DownloadsAdvanced);
  await flushPromises();
  return w;
};

describe('DownloadsAdvanced', () => {
  it('is a collapsed "Advanced" disclosure', async () => {
    const w = await mountAdvanced();
    const root = w.find('[data-testid="downloads-advanced"]');
    expect(root.element.tagName).toBe('DETAILS');
    expect(root.attributes('open')).toBeUndefined();
    expect(w.find('summary').text()).toContain('Advanced');
  });

  it('loads each schedule and selects its preset', async () => {
    const w = await mountAdvanced();
    expect((w.find('#video-preset').element as HTMLSelectElement).value).toBe('daily');
    expect((w.find('#music-preset').element as HTMLSelectElement).value).toBe('custom');
    expect((w.find('#music-cron').element as HTMLInputElement).value).toBe('15 2 * * *');
    expect(w.find('#podcast-preset').exists()).toBe(false); // podcast schedule is off
  });

  it('saves a schedule for its own type', async () => {
    const w = await mountAdvanced();
    await w.find('#video-preset').setValue('weekly');
    await w.find('[data-testid="schedule-video"]').trigger('submit');
    await flushPromises();
    expect(posts('/api/admin/downloader/schedule')[0][1].body).toEqual({ enabled: true, schedule: '0 3 * * 0' });
    expect(posts('/api/admin/music/schedule')).toHaveLength(0);
  });

  it('refuses an empty custom cron without calling the server', async () => {
    const w = await mountAdvanced();
    await w.find('#music-cron').setValue('  ');
    await w.find('[data-testid="schedule-music"]').trigger('submit');
    await flushPromises();
    expect(posts('/api/admin/music/schedule')).toHaveLength(0);
    expect(toastMessages()).toContain('Enter a cron expression.');
  });

  it('after a failed save, shows the error and reloads the saved schedule', async () => {
    failSchedule = true;
    const w = await mountAdvanced();
    await w.find('#video-preset').setValue('hourly');
    await w.find('[data-testid="schedule-video"]').trigger('submit');
    await flushPromises();
    expect(toastMessages()).toContain('Invalid cron');
    expect((w.find('#video-preset').element as HTMLSelectElement).value).toBe('daily');
  });

  it('saves the SponsorBlock choices', async () => {
    const w = await mountAdvanced();
    expect((w.find('#sb-sponsor').element as HTMLSelectElement).value).toBe('remove');
    await w.find('#sb-intro').setValue('mark');
    await w.find('[data-testid="sponsorblock-form"]').trigger('submit');
    await flushPromises();
    expect(posts('/api/admin/downloader/sponsorblock')[0][1].body).toMatchObject({ sponsor: 'remove', intro: 'mark', selfpromo: 'mark' });
  });

  it('turns music clips on, and puts the switch back when the server refuses', async () => {
    const w = await mountAdvanced();
    const toggle = w.find('[data-testid="music-clips-toggle"]');
    expect((toggle.element as HTMLInputElement).checked).toBe(false);
    await toggle.setValue(true);
    await flushPromises();
    expect(posts('/api/admin/settings/music-clips')[0][1].body).toEqual({ enabled: true });
    expect((toggle.element as HTMLInputElement).checked).toBe(true);

    failClips = true;
    await toggle.setValue(false);
    await flushPromises();
    expect(toastMessages()).toContain('Not allowed');
    expect((toggle.element as HTMLInputElement).checked).toBe(true);
  });
});
