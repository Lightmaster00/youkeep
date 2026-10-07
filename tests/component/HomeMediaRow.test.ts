import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import HomeMediaRow from '../../app/components/HomeMediaRow.vue';
import { useMusicPlayer } from '../../app/composables/useMusicPlayer';
import { usePodcastPlayer } from '../../app/composables/usePodcastPlayer';

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({});
  vi.stubGlobal('$fetch', fetchMock);
  useState('music_player_current_track').value = null;
  useState('music_player_queue').value = [];
  useState('podcast_player_current_episode').value = null;
});
afterEach(() => vi.unstubAllGlobals());

const musicSection = {
  id: 'recentMusic' as const,
  title: 'Recently added music',
  tracks: [
    { id: 't1', title: 'First song', artist_id: 'a1', artist_name: 'The Band', album_title: 'LP', local_file_path: '/m/t1.m4a' },
    { id: 't2', title: 'Second song', artist_id: 'a1', artist_name: 'The Band', local_file_path: '/m/t2.m4a' },
  ],
};
const episodeSection = {
  id: 'newEpisodes' as const,
  title: 'New podcast episodes',
  episodes: [
    { id: 'e1', title: 'Pilot', show_id: 's1', show_title: 'The Show', show_cover_url: 'https://img/s.jpg', pub_date: 'Tue, 06 Oct 2026 10:00:00 GMT', duration: 60, local_file_path: '/p/e1.mp3' },
  ],
};

describe('HomeMediaRow', () => {
  it('renders a music row with title, cards and a link to the Recent page', async () => {
    const w = await mountSuspended(HomeMediaRow, { props: { section: musicSection } });
    expect(w.find('.row-title').text()).toBe('Recently added music');
    expect(w.findAll('.media-card').map((c) => c.find('.media-card-title').text())).toEqual(['First song', 'Second song']);
    expect(w.find('.media-card-sub').text()).toBe('The Band');
    expect(w.find('.media-card-sub').attributes('href')).toBe('/music?artistId=a1');
    expect(w.find('.see-all-link').attributes('href')).toBe('/music/recent');
  });

  it('plays a clicked track with the row as its queue', async () => {
    const w = await mountSuspended(HomeMediaRow, { props: { section: musicSection } });
    await w.findAll('.media-card')[1]!.trigger('click');
    const player = useMusicPlayer();
    expect(player.currentTrack.value?.id).toBe('t2');
    expect(player.queue.value.map((t: any) => t.id)).toEqual(['t1', 't2']);
  });

  it('renders an episode row and plays the clicked episode with its show info', async () => {
    const w = await mountSuspended(HomeMediaRow, { props: { section: episodeSection } });
    expect(w.find('.row-title').text()).toBe('New podcast episodes');
    expect(w.find('.media-card-title').text()).toBe('Pilot');
    expect(w.find('.media-card-sub').attributes('href')).toBe('/podcasts?showId=s1');
    expect(w.find('.media-card-meta').text()).toBe('Oct 6, 2026');
    expect(w.find('.see-all-link').attributes('href')).toBe('/podcasts/recent');
    await w.find('.media-card').trigger('click');
    expect(usePodcastPlayer().currentEpisode.value).toMatchObject({
      id: 'e1', title: 'Pilot', show_title: 'The Show', show_cover_url: 'https://img/s.jpg', local_file_path: '/p/e1.mp3',
    });
  });
});
