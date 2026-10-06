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
let failGets: Set<string>;
let holdPost: Promise<void> | null;
let sbServer: Record<string, string>;

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
  failGets = new Set();
  holdPost = null;
  sbServer = { sponsor: 'remove', intro: 'ignore', outro: 'ignore', selfpromo: 'mark', interaction: 'ignore', filler: 'ignore' };
  useToast().toasts.value = [];
  fetchMock = vi.fn(async (url: string, opts?: any) => {
    if (!opts?.method && failGets.has(url)) throw new Error('down');
    if (opts?.method === 'POST' && holdPost) await holdPost;
    if (schedules[url] && !opts?.method) return { ...schedules[url] };
    if (schedules[url] && opts?.method === 'POST') {
      if (failSchedule) throw Object.assign(new Error('x'), { data: { statusMessage: 'Invalid cron' } });
      schedules[url] = { ...opts.body };
      return { success: true };
    }
    if (url === '/api/admin/downloader/sponsorblock' && !opts?.method) return { settings: { ...sbServer } };
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

  it('refuses an empty custom cron without calling the server, and trims one before sending', async () => {
    const w = await mountAdvanced();
    await w.find('#music-cron').setValue('  ');
    await w.find('[data-testid="schedule-music"]').trigger('submit');
    await flushPromises();
    expect(posts('/api/admin/music/schedule')).toHaveLength(0);
    expect(toastMessages()).toContain('Enter a cron expression.');
    await w.find('#music-cron').setValue('  5 5 * * *  ');
    await w.find('[data-testid="schedule-music"]').trigger('submit');
    await flushPromises();
    expect(posts('/api/admin/music/schedule')[0][1].body.schedule).toBe('5 5 * * *');
  });

  it('after a failed save, shows the error and reloads the saved schedule', async () => {
    failSchedule = true;
    const w = await mountAdvanced();
    await w.find('#video-preset').setValue('hourly');
    await w.find('[data-testid="schedule-video"]').trigger('submit');
    await flushPromises();
    expect(toastMessages()).toContain('Invalid cron');
    expect((w.find('#video-preset').element as HTMLSelectElement).value).toBe('daily');
    expect((w.find('[data-testid="schedule-video-enabled"]').element as HTMLInputElement).checked).toBe(true);
    await w.find('#music-cron').setValue('1 1 * * *');
    await w.find('[data-testid="schedule-music"]').trigger('submit');
    await flushPromises();
    expect((w.find('#music-cron').element as HTMLInputElement).value).toBe('15 2 * * *');
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

  it('each type saves its own presets to its own route', async () => {
    const w = await mountAdvanced();
    await w.find('#video-preset').setValue('weekly');
    await w.find('[data-testid="schedule-video"]').trigger('submit');
    await flushPromises();
    expect(posts('/api/admin/downloader/schedule')[0][1].body).toEqual({ enabled: true, schedule: '0 3 * * 0' });
    expect(posts('/api/admin/music/schedule')).toHaveLength(0);

    await w.find('[data-testid="schedule-podcast-enabled"]').setValue(true);
    await flushPromises();
    await w.find('#podcast-preset').setValue('daily');
    await w.find('[data-testid="schedule-podcast"]').trigger('submit');
    await flushPromises();
    expect(posts('/api/admin/podcasts/schedule')[0][1].body).toEqual({ enabled: true, schedule: '0 4 * * *' });

    expect(w.find('#music-preset').text()).toContain('Every day at 3:30 AM');
    await w.find('#music-preset').setValue('daily');
    await w.find('[data-testid="schedule-music"]').trigger('submit');
    await flushPromises();
    expect(posts('/api/admin/music/schedule')[0][1].body).toEqual({ enabled: true, schedule: '30 3 * * *' });
  });

  it('saves enabled:false, and a blank custom cron does not block it', async () => {
    const w = await mountAdvanced();
    await w.find('#music-cron').setValue('  ');
    await w.find('[data-testid="schedule-music-enabled"]').setValue(false);
    await w.find('[data-testid="schedule-music"]').trigger('submit');
    await flushPromises();
    expect(posts('/api/admin/music/schedule')[0][1].body.enabled).toBe(false);
  });

  it('goes preset -> custom -> preset', async () => {
    const w = await mountAdvanced();
    await w.find('#video-preset').setValue('custom');
    expect(w.find('#video-cron').exists()).toBe(true);
    await w.find('#video-preset').setValue('twelve_hours');
    expect(w.find('#video-cron').exists()).toBe(false);
    await w.find('[data-testid="schedule-video"]').trigger('submit');
    await flushPromises();
    expect(posts('/api/admin/downloader/schedule')[0][1].body.schedule).toBe('0 */12 * * *');
  });

  it('SponsorBlock: merges partial server settings and posts all six keys', async () => {
    sbServer = { sponsor: 'mark' };
    const w = await mountAdvanced();
    await w.find('[data-testid="sponsorblock-form"]').trigger('submit');
    await flushPromises();
    expect(posts('/api/admin/downloader/sponsorblock')[0][1].body).toEqual({
      sponsor: 'mark', intro: 'ignore', outro: 'ignore', selfpromo: 'ignore', interaction: 'ignore', filler: 'ignore',
    });
  });

  it('SponsorBlock: a failed save shows the error and reloads the saved choices', async () => {
    const orig = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url: string, opts?: any) => {
      if (url === '/api/admin/downloader/sponsorblock' && opts?.method === 'POST') throw Object.assign(new Error('x'), { data: { statusMessage: 'Nope' } });
      return orig(url, opts);
    });
    const w = await mountAdvanced();
    await w.find('#sb-sponsor').setValue('ignore');
    await w.find('[data-testid="sponsorblock-form"]').trigger('submit');
    await flushPromises();
    expect(toastMessages()).toContain('Nope');
    expect((w.find('#sb-sponsor').element as HTMLSelectElement).value).toBe('remove');
  });

  it('clips: starts on from the server, toasts, and the label follows the state', async () => {
    clipsEnabled = true;
    const w = await mountAdvanced();
    const toggle = w.find('[data-testid="music-clips-toggle"]');
    expect((toggle.element as HTMLInputElement).checked).toBe(true);
    expect(w.find('.advanced-switch').text()).toBe('On');
    await toggle.setValue(false);
    await flushPromises();
    expect(toastMessages()).toContain('Music video clips will no longer be downloaded.');
    expect(w.find('.advanced-switch').text()).toBe('Off');
  });

  it('a double submit while a save is pending sends one request', async () => {
    let release!: () => void;
    holdPost = new Promise<void>((r) => { release = r; });
    const w = await mountAdvanced();
    await w.find('[data-testid="schedule-video"]').trigger('submit');
    await w.find('[data-testid="schedule-video"]').trigger('submit');
    await w.find('[data-testid="sponsorblock-form"]').trigger('submit');
    await w.find('[data-testid="sponsorblock-form"]').trigger('submit');
    release();
    await flushPromises();
    expect(posts('/api/admin/downloader/schedule')).toHaveLength(1);
    expect(posts('/api/admin/downloader/sponsorblock')).toHaveLength(1);
  });

  it('a failed initial load keeps Save disabled, shows an error and Retry reloads', async () => {
    failGets.add('/api/admin/music/schedule');
    failGets.add('/api/admin/downloader/sponsorblock');
    const w = await mountAdvanced();
    const form = w.find('[data-testid="schedule-music"]');
    expect(form.find('[data-testid="load-error"]').text()).toContain('Could not load the current settings. Reload to try again.');
    expect(form.find('button[type="submit"]').attributes('disabled')).toBeDefined();
    await form.trigger('submit');
    await flushPromises();
    expect(posts('/api/admin/music/schedule')).toHaveLength(0);
    expect(w.find('[data-testid="sponsorblock-form"] button[type="submit"]').attributes('disabled')).toBeDefined();
    await w.find('[data-testid="sponsorblock-form"]').trigger('submit');
    await flushPromises();
    expect(posts('/api/admin/downloader/sponsorblock')).toHaveLength(0);

    failGets.clear();
    await form.find('[data-testid="load-retry"]').trigger('click');
    await w.find('[data-testid="sponsorblock-retry"]').trigger('click');
    await flushPromises();
    expect(form.find('[data-testid="load-error"]').exists()).toBe(false);
    expect(form.find('button[type="submit"]').attributes('disabled')).toBeUndefined();
    expect(w.find('[data-testid="sponsorblock-form"] button[type="submit"]').attributes('disabled')).toBeUndefined();
  });
});
