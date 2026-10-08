import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import PodcastMiniPlayer from '../../app/components/PodcastMiniPlayer.vue';
import { usePodcastPlayer } from '../../app/composables/usePodcastPlayer';

const fetchMock = vi.fn(async () => undefined);
const putCalls = () => fetchMock.mock.calls.filter((c: any[]) => c[1]?.method === 'PUT') as any[];

beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal('$fetch', fetchMock);
  window.localStorage.removeItem('podcast_player_state');
  useState<any>('auth_user').value = { id: 'u1', username: 'u1', role: 'user' };
  useState('podcast_progress').value = { owner: null, progress: {} };
  useState('podcast_player_last_sync_at').value = 0;
});
afterEach(() => vi.unstubAllGlobals());

async function mountWithEpisode() {
  const w = await mountSuspended(PodcastMiniPlayer);
  const player = usePodcastPlayer();
  player.currentEpisode.value = { id: 'e1', title: 'E1', duration: 3600, local_file_path: '/p/e1.mp3' };
  player.currentTime.value = 321;
  return { w, player };
}

describe('PodcastMiniPlayer progress sync', () => {
  it('syncs at once on pause and marks the episode completed when it ends', async () => {
    const { w } = await mountWithEpisode();
    await w.find('audio').trigger('pause');
    expect(putCalls()[0]).toEqual(['/api/podcasts/episodes/e1/progress', { method: 'PUT', body: { positionSeconds: 321, durationSeconds: 3600 } }]);
    await w.find('audio').trigger('ended');
    expect(putCalls()[1]![1].body).toMatchObject({ completed: true });
  });

  it('flushes with a keepalive request when the page is hidden', async () => {
    const winFetch = vi.fn(() => Promise.resolve(new Response(null)));
    const original = window.fetch;
    window.fetch = winFetch as any;
    try {
      await mountWithEpisode();
      window.dispatchEvent(new Event('pagehide'));
      await flushPromises();
      expect(winFetch).toHaveBeenCalledWith('/api/podcasts/episodes/e1/progress', expect.objectContaining({ method: 'PUT', keepalive: true }));
    } finally {
      window.fetch = original;
    }
  });
});
