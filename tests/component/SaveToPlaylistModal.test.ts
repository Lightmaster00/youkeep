import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import SaveToPlaylistModal from '../../app/components/SaveToPlaylistModal.vue';
import { useToast } from '../../app/composables/useToast';

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  useToast().toasts.value = [];
  useState('auth_loading').value = false;
  useState<any>('auth_user').value = { id: 'u1', username: 'alice', role: 'user' };
  fetchMock = vi.fn(async () => ({ playlists: [{ id: 'p1', title: 'Road trip', visibility: 'private', owner_name: 'alice', contains_video: 0 }] }));
  vi.stubGlobal('$fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const mount = async () => {
  const w = await mountSuspended(SaveToPlaylistModal, { props: { show: true, videoId: 'v1', videoTitle: 'Clip' } });
  await flushPromises();
  return w;
};

describe('SaveToPlaylistModal', () => {
  it('lists the signed-in user\'s playlists', async () => {
    await mount();
    expect(fetchMock).toHaveBeenCalledWith('/api/playlists/personal', { params: { videoId: 'v1' } });
  });

  it('a guest (or an expired session) gets a sign-in prompt and no API call', async () => {
    useState<any>('auth_user').value = null;
    const w = await mount();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(w.text()).toContain('Sign in to save videos to your playlists.');
    w.unmount();
  });

  it('a 401 shows no extra "Failed to load" toast', async () => {
    fetchMock.mockImplementation(async () => { throw Object.assign(new Error('401'), { statusCode: 401 }); });
    await mount();
    expect(useToast().toasts.value).toEqual([]);
  });
});
