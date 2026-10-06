import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import ChannelOptionsModal from '../../app/components/settings/ChannelOptionsModal.vue';
import { useToast } from '../../app/composables/useToast';

let fetchMock: ReturnType<typeof vi.fn>;
let channel: any;
let failSave: boolean;

beforeEach(() => {
  channel = { id: 'UC1', download_videos: 1, download_shorts: 0, download_lives: 1, date_after: '20240131', custom_save_path: '/data/videos/Chan' };
  failSave = false;
  useToast().toasts.value = [];
  fetchMock = vi.fn(async (url: string, opts?: any) => {
    if (url === '/api/channels/UC1') return { channel: { ...channel } };
    if (url === '/api/admin/channels/UC1/options' && opts?.method === 'PUT') {
      if (failSave) throw Object.assign(new Error('x'), { data: { statusMessage: 'Disk full' } });
      return { success: true };
    }
    return {};
  });
  vi.stubGlobal('$fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const mountModal = async () => {
  const w = await mountSuspended(ChannelOptionsModal, { props: { channelId: 'UC1', channelName: 'Chan' } });
  await flushPromises();
  return w;
};
const val = (w: any, id: string) => w.find(`[data-testid="${id}"]`).element as HTMLInputElement;

describe('ChannelOptionsModal', () => {
  it('loads the channel options into the form', async () => {
    const w = await mountModal();
    expect(w.text()).toContain('Options for Chan');
    expect(val(w, 'opt-videos').checked).toBe(true);
    expect(val(w, 'opt-shorts').checked).toBe(false);
    expect(val(w, 'opt-lives').checked).toBe(true);
    expect(val(w, 'opt-date').value).toBe('2024-01-31');
    expect(val(w, 'opt-folder').value).toBe('/data/videos/Chan');
  });

  it('saves with PUT options and emits saved then close', async () => {
    const w = await mountModal();
    await w.find('[data-testid="opt-shorts"]').setValue(true);
    await w.find('[data-testid="opt-date"]').setValue('');
    await w.find('[data-testid="opt-folder"]').setValue('  ');
    await w.find('[data-testid="channel-options-form"]').trigger('submit');
    await flushPromises();
    const put = fetchMock.mock.calls.find(([u, o]) => u === '/api/admin/channels/UC1/options' && o?.method === 'PUT');
    expect(put![1].body).toEqual({ downloadVideos: true, downloadShorts: true, downloadLives: true, dateAfter: null, customSavePath: null });
    expect(w.emitted('saved')).toHaveLength(1);
    expect(w.emitted('close')).toHaveLength(1);
  });

  it('after a failed save, shows the error and reloads the form from the server', async () => {
    failSave = true;
    const w = await mountModal();
    await w.find('[data-testid="opt-shorts"]').setValue(true);
    await w.find('[data-testid="channel-options-form"]').trigger('submit');
    await flushPromises();
    expect(useToast().toasts.value.map((t) => t.message)).toContain('Disk full');
    expect(val(w, 'opt-shorts').checked).toBe(false);
    expect(w.emitted('saved')).toBeUndefined();
    expect(w.emitted('close')).toBeUndefined();
  });
});
