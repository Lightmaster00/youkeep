import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import MusicRecent from '../../app/pages/music/recent.vue';
import PodcastsRecent from '../../app/pages/podcasts/recent.vue';
import { useMusicPlayer } from '../../app/composables/useMusicPlayer';
import { usePodcastPlayer } from '../../app/composables/usePodcastPlayer';

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('$fetch', fetchMock);
  useState('music_player_current_track').value = null;
  useState('podcast_player_current_episode').value = null;
});
afterEach(() => vi.unstubAllGlobals());

const track = (i: number) => ({ id: `t${i}`, title: `Song ${i}`, artist_id: 'a1', artist_name: 'Band', local_file_path: `/m/t${i}` });
const episode = (i: number) => ({ id: `e${i}`, title: `Episode ${i}`, show_id: 's1', show_title: 'Show', local_file_path: `/p/e${i}` });

describe('/music/recent', () => {
  it('loads the first page, then the next one with Load more, and hides the button at the end', async () => {
    fetchMock
      .mockResolvedValueOnce({ tracks: [track(1), track(2)], total: 3 })
      .mockResolvedValueOnce({ tracks: [track(3)], total: 3 });
    const w = await mountSuspended(MusicRecent);
    await flushPromises();
    expect(fetchMock.mock.calls[0]).toEqual(['/api/music/playlists/recently-added', { params: { limit: 30, offset: 0 } }]);
    expect(w.findAll('.media-card')).toHaveLength(2);
    const more = w.findAll('button').find((b) => b.text() === 'Load more')!;
    await more.trigger('click');
    await flushPromises();
    expect(fetchMock.mock.calls[1]).toEqual(['/api/music/playlists/recently-added', { params: { limit: 30, offset: 2 } }]);
    expect(w.findAll('.media-card').map((c) => c.find('.media-card-title').text())).toEqual(['Song 1', 'Song 2', 'Song 3']);
    expect(w.findAll('button').some((b) => b.text() === 'Load more')).toBe(false);
  });

  it('plays a track with the loaded list as its queue', async () => {
    fetchMock.mockResolvedValueOnce({ tracks: [track(1), track(2)], total: 2 });
    const w = await mountSuspended(MusicRecent);
    await flushPromises();
    await w.findAll('.media-card')[1]!.trigger('click');
    const player = useMusicPlayer();
    expect(player.currentTrack.value?.id).toBe('t2');
    expect(player.queue.value.map((t: any) => t.id)).toEqual(['t1', 't2']);
  });

  it('shows "Nothing here yet" when there is no track', async () => {
    fetchMock.mockResolvedValueOnce({ tracks: [], total: 0 });
    const w = await mountSuspended(MusicRecent);
    await flushPromises();
    expect(w.text()).toContain('Nothing here yet');
  });
});

describe('/podcasts/recent', () => {
  it('lists episodes, pages them and plays one', async () => {
    fetchMock
      .mockResolvedValueOnce({ episodes: [episode(1)], total: 2 })
      .mockResolvedValueOnce({ episodes: [episode(2)], total: 2 });
    const w = await mountSuspended(PodcastsRecent);
    await flushPromises();
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/podcasts/episodes/recent');
    expect(w.find('h1').text()).toBe('New episodes');
    await w.findAll('button').find((b) => b.text() === 'Load more')!.trigger('click');
    await flushPromises();
    expect(fetchMock.mock.calls[1]![1]).toEqual({ params: { limit: 30, offset: 1 } });
    await w.findAll('.media-card')[1]!.trigger('click');
    expect(usePodcastPlayer().currentEpisode.value).toMatchObject({ id: 'e2', show_title: 'Show', local_file_path: '/p/e2' });
  });

  it('keeps loaded episodes and offers Retry when a page fails', async () => {
    fetchMock
      .mockResolvedValueOnce({ episodes: [episode(1)], total: 2 })
      .mockRejectedValueOnce(new Error('boom'));
    const w = await mountSuspended(PodcastsRecent);
    await flushPromises();
    await w.findAll('button').find((b) => b.text() === 'Load more')!.trigger('click');
    await flushPromises();
    expect(w.findAll('.media-card')).toHaveLength(1);
    expect(w.text()).toContain('Failed to load episodes.');
    expect(w.findAll('button').some((b) => b.text() === 'Retry')).toBe(true);
  });

  it('shows "Nothing here yet" when there is no episode', async () => {
    fetchMock.mockResolvedValueOnce({ episodes: [], total: 0 });
    const w = await mountSuspended(PodcastsRecent);
    await flushPromises();
    expect(w.text()).toContain('Nothing here yet');
  });
});
