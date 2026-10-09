import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import DiscoverPage from '../../app/pages/music/discover.vue';
import GenrePage from '../../app/pages/music/genre/[name].vue';
import { useMusicPlayer } from '../../app/composables/useMusicPlayer';
import { topArtistOf } from '../../app/composables/useMusicDiscover';

const fetchMock = vi.fn();
type Handler = (url: string, opts: any) => any;
let handler: Handler;

const track = (i: number, extra: any = {}) => ({
  id: `t${i}`, title: `Song ${i}`, artist_id: 'a1', artist_name: 'Band', local_file_path: `/m/t${i}`, duration: 61, ...extra,
});

const FULL: Record<string, any> = {
  '/api/music/playlists/liked-mix': { tracks: [track(1), track(2)] },
  '/api/music/playlists/most-played': { tracks: [track(3, { artist_id: 'a2', artist_name: 'Top', play_count: 9 }), track(4, { play_count: 2 })] },
  '/api/music/playlists/rediscover': { tracks: [track(5)] },
  '/api/music/playlists/artist-mix': { tracks: [track(6), track(7), track(8)] },
  '/api/music/genres': { genres: [{ genre: 'Hip Hop', trackCount: 3 }, { genre: 'R&B / Soul', trackCount: 1 }] },
  '/api/music/albums/recent': { albums: [{ id: 'al1', title: 'First', artist_id: 'a9', artist_name: 'Nine', release_year: 2020, cover_url: null, trackCount: 4 }] },
  '/api/music/artists/explore': { artists: [{ id: 'a7', name: 'Seven', avatar_url: null, track_count: 1 }] },
};

beforeEach(() => {
  fetchMock.mockReset();
  handler = (url) => FULL[url];
  fetchMock.mockImplementation(async (url: string, opts: any = {}) => {
    if (url === '/api/music/favorites/status') return { liked: [] };
    return handler(url, opts);
  });
  vi.stubGlobal('$fetch', fetchMock);
  useState<any>('auth_user').value = { id: 'u1', username: 'u1', role: 'user' };
  useState('music_likes').value = { owner: null, liked: {} };
  useState('music_player_current_track').value = null;
  useState('music_player_shuffle').value = false;
});
afterEach(() => vi.unstubAllGlobals());

const called = (url: string) => fetchMock.mock.calls.filter(([u]) => u === url);
const rowTitles = (w: any) => w.findAll('.discover-row-title').map((t: any) => t.text());

describe('/music/discover', () => {
  it('shows every row for a logged-in user, with the mixes, genre, album and artist tiles', async () => {
    const w = await mountSuspended(DiscoverPage);
    await flushPromises();
    expect(rowTitles(w)).toEqual(['Made for you', 'Browse by genre', 'New albums', 'Artists to explore']);
    expect(w.findAll('.mix-tile-title').map((t) => t.text())).toEqual(['Mix from your liked songs', 'Most played', 'Top mix', 'Rediscover']);
    // The top artist is the one with the most plays among the most played tracks.
    expect(called('/api/music/playlists/artist-mix')[0]![1]).toEqual({ params: { artistId: 'a2' } });
    expect(w.findAll('.genre-tile').map((a) => a.attributes('href'))).toEqual([
      '/music/genre/Hip%20Hop', '/music/genre/R%26B%20%2F%20Soul',
    ]);
    expect(w.find('.album-tile').attributes('href')).toBe('/music/album/al1');
    expect(w.find('.album-tile').text()).toContain('Nine · 2020');
    expect(w.find('.artist-tile').attributes('href')).toBe('/music?artistId=a7');

    await w.findAll('.mix-tile')[2]!.trigger('click');
    const player = useMusicPlayer();
    expect(player.currentTrack.value?.id).toBe('t6');
    expect(player.queue.value.map((t) => t.id)).toEqual(['t6', 't7', 't8']);
  });

  it('shows only the shared rows to guests and never asks for personal ones', async () => {
    useState<any>('auth_user').value = null;
    const w = await mountSuspended(DiscoverPage);
    await flushPromises();
    expect(rowTitles(w)).toEqual(['Browse by genre', 'New albums']);
    for (const url of ['/api/music/playlists/liked-mix', '/api/music/playlists/most-played', '/api/music/playlists/rediscover', '/api/music/artists/explore']) {
      expect(called(url)).toHaveLength(0);
    }
  });

  it('omits empty rows and empty mixes, and shows the empty state when nothing is left', async () => {
    handler = (url) => {
      if (url === '/api/music/playlists/rediscover') return { tracks: [track(5)] };
      if (url.startsWith('/api/music/playlists/')) return { tracks: [] };
      if (url === '/api/music/genres') return { genres: [] };
      if (url === '/api/music/albums/recent') throw new Error('down');
      return { artists: [] };
    };
    const w = await mountSuspended(DiscoverPage);
    await flushPromises();
    expect(rowTitles(w)).toEqual(['Made for you']);
    expect(w.findAll('.mix-tile-title').map((t) => t.text())).toEqual(['Rediscover']);
    expect(called('/api/music/playlists/artist-mix')).toHaveLength(0);
    expect(w.text()).not.toContain('Nothing to discover yet');

    handler = (url) => (url.startsWith('/api/music/playlists/') ? { tracks: [] } : {});
    const empty = await mountSuspended(DiscoverPage);
    await flushPromises();
    expect(rowTitles(empty)).toEqual([]);
    expect(empty.text()).toContain('Nothing to discover yet');
  });

  it('offers a radio from the track in the player', async () => {
    useState('music_player_current_track').value = track(42);
    handler = (url, opts) => (url === '/api/music/playlists/radio' ? (opts.params.trackId === 't42' ? { tracks: [track(43), track(44)] } : {}) : FULL[url]);
    const w = await mountSuspended(DiscoverPage);
    await flushPromises();
    const radio = w.findAll('.mix-tile').at(-1)!;
    expect(radio.text()).toContain('From Song 42');
    await radio.trigger('click');
    await flushPromises();
    expect(useMusicPlayer().queue.value.map((t) => t.id)).toEqual(['t43', 't44']);
  });
});

describe('topArtistOf', () => {
  it('sums plays per artist', () => {
    expect(topArtistOf([
      { artist_id: 'x', artist_name: 'X', play_count: 5 },
      { artist_id: 'y', artist_name: 'Y', play_count: 4 },
      { artist_id: 'y', artist_name: 'Y', play_count: 3 },
    ])).toEqual({ id: 'y', name: 'Y' });
    expect(topArtistOf([])).toBeNull();
  });
});

describe('/music/genre/[name]', () => {
  it('lists the genre tracks with paging, Play and the like/add actions', async () => {
    handler = (url, opts) => {
      if (url !== '/api/music/genres/R%26B%20%2F%20Soul/tracks') return {};
      return opts.params.offset === 0
        ? { tracks: Array.from({ length: 30 }, (_, i) => track(i)), total: 31 }
        : { tracks: [track(30)], total: 31 };
    };
    const w = await mountSuspended(GenrePage, { route: '/music/genre/R%26B%20%2F%20Soul' });
    await flushPromises();
    expect(w.find('.mch-title').text()).toBe('R&B / Soul');
    expect(w.text()).toContain('31 songs');
    expect(w.findAll('.mtl-row')).toHaveLength(30);
    expect(w.findAll('.track-like-btn')).toHaveLength(30);

    await w.findAll('button').find((b) => b.text() === 'Load more')!.trigger('click');
    await flushPromises();
    expect(called('/api/music/genres/R%26B%20%2F%20Soul/tracks')[1]![1]).toEqual({ params: { limit: 30, offset: 30 } });
    expect(w.findAll('.mtl-row')).toHaveLength(31);
    expect(w.findAll('button').some((b) => b.text() === 'Load more')).toBe(false);

    await w.findAll('button').find((b) => b.text() === 'Play')!.trigger('click');
    expect(useMusicPlayer().currentTrack.value?.id).toBe('t0');
  });

  it('shows the empty state for an unknown genre', async () => {
    handler = () => ({ tracks: [], total: 0 });
    const w = await mountSuspended(GenrePage, { route: '/music/genre/Polka' });
    await flushPromises();
    expect(w.text()).toContain('No tracks in this genre');
    expect(w.find('.mtl-row').exists()).toBe(false);
  });
});
