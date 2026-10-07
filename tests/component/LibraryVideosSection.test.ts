import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import LibrarySourceSection from '../../app/components/settings/LibrarySourceSection.vue';
import { videosSource } from '../../app/utils/librarySources';
import { useToast } from '../../app/composables/useToast';

let fetchMock: ReturnType<typeof vi.fn>;
let searchPayload: any;
let channels: any[];
let failVisibility: boolean;
let failDefaultDir: boolean;
let serverDefaultDir: string;

const calls = (url: string, method?: string) => fetchMock.mock.calls.filter(([u, o]) => u === url && (method ? o?.method === method : !o?.method));
const toastMessages = () => useToast().toasts.value.map((t) => t.message);

beforeEach(() => {
  searchPayload = {};
  channels = [{ id: 'UC9', title: 'Followed', avatar_url: '', sync_status: 'downloading', visibility: 'public', completed_count: 4, total_count: 9 }];
  failVisibility = false;
  failDefaultDir = false;
  serverDefaultDir = '/data/videos';
  useToast().toasts.value = [];
  fetchMock = vi.fn(async (url: string, opts?: any) => {
    if (url === '/api/admin/downloader/search-channels') return searchPayload;
    if (url === '/api/channels') return { channels };
    if (url === '/api/channels/UC9') return { channel: { id: 'UC9', download_videos: 1, download_shorts: 0, download_lives: 0, date_after: null, custom_save_path: null } };
    if (url === '/api/admin/downloader/default-dir' && !opts?.method) return { path: serverDefaultDir };
    if (url === '/api/admin/downloader/default-dir' && opts?.method === 'POST') {
      if (failDefaultDir) throw Object.assign(new Error('x'), { data: { statusMessage: 'Folder is not writable' } });
      serverDefaultDir = opts.body.path;
      return { success: true };
    }
    if (url === '/api/admin/channels/UC9/visibility' && opts?.method === 'PUT') {
      if (failVisibility) throw Object.assign(new Error('x'), { data: { statusMessage: 'Denied' } });
      channels = channels.map((c) => ({ ...c, visibility: opts.body.visibility }));
      return { success: true };
    }
    if (url === '/api/admin/downloader/ingest' && opts?.method === 'POST') return { success: true, message: 'ok' };
    return {};
  });
  vi.stubGlobal('$fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const mountVideos = async () => {
  const w = await mountSuspended(LibrarySourceSection, { props: { config: videosSource } });
  await flushPromises();
  return w;
};

async function search(w: any) {
  await w.find('[data-testid="follow-search-input"]').setValue('chan');
  await w.find('[data-testid="follow-search-form"]').trigger('submit');
  await flushPromises();
}

describe('LibrarySourceSection — Videos', () => {
  it('pre-fills the save folder from the server default', async () => {
    const w = await mountVideos();
    expect((w.find('[data-testid="option-save-folder"]').element as HTMLInputElement).value).toBe('/data/videos');
  });

  it('follows a channel in one click with today\'s defaults (no Track modal)', async () => {
    searchPayload = { channels: [{ id: 'UC1', handle: '/@my', title: 'My Channel' }] };
    const w = await mountVideos();
    await search(w);
    await w.find('[data-testid="follow-result-0"]').trigger('click');
    await flushPromises();
    const post = calls('/api/admin/downloader/ingest', 'POST');
    expect(post).toHaveLength(1);
    expect(post[0][1].body).toEqual({
      url: 'https://www.youtube.com/channel/UC1',
      download_videos: true,
      download_shorts: false,
      download_lives: false,
      sync_status: 'downloading',
      visibility: 'public',
    }); // the pre-filled default folder is not sent: the channel follows the default
    expect(w.find('[data-testid="follow-result-0"]').exists()).toBe(false);
  });

  it('applies every option for new follows', async () => {
    searchPayload = { channels: [{ id: 'UC1', title: 'My Channel' }] };
    const w = await mountVideos();
    await search(w);
    await w.find('[data-testid="option-auto-sync"]').setValue(false);
    await w.find('[data-testid="option-visibility"]').setValue('private');
    await w.find('[data-testid="option-shorts"]').setValue(true);
    await w.find('[data-testid="option-lives"]').setValue(true);
    await w.find('[data-testid="option-videos"]').setValue(false);
    await w.find('[data-testid="option-date-after"]').setValue('2024-01-31');
    await w.find('[data-testid="option-save-folder"]').setValue('/mnt/yt');
    await w.find('[data-testid="follow-result-0"]').trigger('click');
    await flushPromises();
    expect(calls('/api/admin/downloader/ingest', 'POST')[0][1].body).toEqual({
      url: 'https://www.youtube.com/channel/UC1',
      download_videos: false,
      download_shorts: true,
      download_lives: true,
      date_after: '20240131',
      sync_status: 'paused',
      visibility: 'private',
      custom_save_path: '/mnt/yt',
    });
  });

  it('lists followed channels with an editable visibility select', async () => {
    const w = await mountVideos();
    const select = w.find('[data-testid="visibility-UC9"]');
    expect(select.element.tagName).toBe('SELECT');
    expect((select.element as HTMLSelectElement).value).toBe('public');
    expect(w.find('[data-testid="following-UC9"]').text()).toContain('4 videos');
    await select.setValue('private');
    await flushPromises();
    const put = calls('/api/admin/channels/UC9/visibility', 'PUT');
    expect(put).toHaveLength(1);
    expect(put[0][1].body).toEqual({ visibility: 'private' });
    expect((w.find('[data-testid="visibility-UC9"]').element as HTMLSelectElement).value).toBe('private');
  });

  it('a failed visibility change toasts and the select shows the server value', async () => {
    failVisibility = true;
    const w = await mountVideos();
    const select = w.find('[data-testid="visibility-UC9"]');
    await select.setValue('ultra_private');
    await flushPromises();
    expect(toastMessages()).toContain('Denied');
    expect((select.element as HTMLSelectElement).value).toBe('public');
  });

  it('Edit options opens the channel options editor', async () => {
    const w = await mountVideos();
    expect(w.find('[data-testid="channel-options-form"]').exists()).toBe(false);
    await w.find('[data-testid="edit-options-UC9"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="channel-options-form"]').exists()).toBe(true);
    expect(calls('/api/channels/UC9')).toHaveLength(1);
  });

  it('Save as default posts the folder; a failure puts the server value back', async () => {
    const w = await mountVideos();
    await w.find('[data-testid="option-save-folder"]').setValue('/new/place');
    await w.find('[data-testid="save-default-folder"]').trigger('click');
    await flushPromises();
    expect(calls('/api/admin/downloader/default-dir', 'POST')[0][1].body).toEqual({ path: '/new/place' });

    failDefaultDir = true;
    await w.find('[data-testid="option-save-folder"]').setValue('/readonly');
    await w.find('[data-testid="save-default-folder"]').trigger('click');
    await flushPromises();
    expect(toastMessages()).toContain('Folder is not writable');
    expect((w.find('[data-testid="option-save-folder"]').element as HTMLInputElement).value).toBe('/new/place');
  });

  it('music and podcast sections keep a read-only badge and no video options', async () => {
    const { musicSource } = await import('../../app/utils/librarySources');
    const w = await mountSuspended(LibrarySourceSection, { props: { config: musicSource } });
    expect(w.find('[data-testid="option-videos"]').exists()).toBe(false);
    expect(w.find('[data-testid="save-default-folder"]').exists()).toBe(false);
  });
});
