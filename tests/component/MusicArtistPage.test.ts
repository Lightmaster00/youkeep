import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import MusicIndexPage from '../../app/pages/music/index.vue';
import { useMusicPlayer } from '../../app/composables/useMusicPlayer';

const track = (i: number, extra: any = {}) => ({
  id: `t${i}`, title: `Song ${i}`, artist_id: 'a1', artist_name: 'Band', local_file_path: `/m/t${i}`, duration: 61, ...extra,
});
const albumRow = (id: string, extra: any = {}) => ({
  id, title: `Record ${id}`, release_year: 2020, album_type: 'album', artist_id: 'a1', artist_name: 'Band',
  cover_url: null, manual_cover_url: null, track_count: 3, ...extra,
});

let overview: any;
const fetchMock = vi.fn();
let wrapper: any;

function songsFor(params: any) {
  const all = Array.from({ length: 60 }, (_, i) => track(i + 1, { title: `${params.sort} ${i + 1}` }));
  return { items: all.slice(params.offset, params.offset + params.limit), total: all.length };
}

beforeEach(() => {
  overview = {
    artist: { id: 'a1', name: 'Band', description: 'A band.', avatar_url: null, banner_url: null, visibility: 'private' },
    popular: [track(1), track(2), track(3), track(4), track(5, { album_id: 'al1', album_title: 'Record al1' })],
    latest: { kind: 'album', album: albumRow('al1', { release_year: 2024 }) },
    albums: [albumRow('al1', { release_year: 2024 }), albumRow('al2', { release_year: 2010 })],
    singles: [albumRow('s1', { album_type: 'single', title: 'Hit', track_count: 1 })],
    counts: { tracks: 12, albums: 2, singles: 1 },
  };
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, opts: any = {}) => {
    if (url === '/api/music/favorites/status') return { liked: [] };
    if (url === '/api/music/artists/a1/overview') return overview;
    if (url === '/api/music/artists/a1/songs') return songsFor(opts.params);
    return {};
  });
  vi.stubGlobal('$fetch', fetchMock);
  useState('auth_loading').value = false;
  useState<any>('auth_user').value = { id: 'u1', username: 'u1', role: 'user' };
  useState('music_likes').value = { owner: null, liked: {} };
  useState('music_player_current_track').value = null;
  useState('music_player_shuffle').value = false;
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  vi.unstubAllGlobals();
});

async function mountArtist(query: Record<string, string> = {}) {
  wrapper = await mountSuspended(MusicIndexPage, { route: { path: '/music', query: { artistId: 'a1', ...query } } });
  await flushPromises();
  return wrapper;
}

const currentQuery = () => useRouter().currentRoute.value.query;
const songsCalls = () => fetchMock.mock.calls.filter(([u]) => u === '/api/music/artists/a1/songs');
const sectionTitles = (w: any) => w.findAll('.mao-title, .discover-row-title').map((t: any) => t.text());

describe('artist page', () => {
  it('shows the header and the Overview sections, never a bucket for album-less tracks', async () => {
    const w = await mountArtist();
    expect(w.find('.mah-name').text()).toBe('Band');
    expect(w.text()).toContain('12 songs · 2 albums · 1 single or EP');
    expect(w.find('[data-testid="artist-tab-overview"]').attributes('aria-selected')).toBe('true');
    expect(sectionTitles(w)).toEqual(['Popular', 'Latest release', 'Albums', 'Singles & EPs']);
    expect(w.findAll('.mtl-row')).toHaveLength(5);
    expect(w.find('.mtl-album-link').attributes('href')).toBe('/music/album/al1');
    expect(w.find('[data-testid="latest-release"]').attributes('href')).toBe('/music/album/al1');
    expect(w.find('[data-testid="latest-release"]').text()).toContain('Album · 2024');
    expect(w.findAll('.album-tile').map((a: any) => a.attributes('href'))).toEqual([
      '/music/album/al1', '/music/album/al2', '/music/album/s1',
    ]);
    // The artist's own name is not repeated on its album tiles; singles say so.
    expect(w.findAll('.album-tile')[2]!.text()).toContain('Single · 2020');
    expect(w.findAll('.album-tile')[0]!.text()).not.toContain('Band');
    expect(w.text().toLowerCase()).not.toContain('without an album');
  });

  it('hides the Singles & EPs row when there are none and shows a playable latest track', async () => {
    overview.singles = [];
    overview.latest = { kind: 'track', track: track(9, { title: 'Fresh' }) };
    const w = await mountArtist();
    expect(sectionTitles(w)).toEqual(['Popular', 'Latest release', 'Albums']);
    const latest = w.find('[data-testid="latest-release"]');
    expect(latest.text()).toContain('Fresh');
    await latest.trigger('click');
    expect(useMusicPlayer().currentTrack.value?.id).toBe('t9');
  });

  it('opens the tab named in the URL and writes the selected tab back to it', async () => {
    const w = await mountArtist({ tab: 'albums' });
    expect(w.find('[data-testid="artist-tab-albums"]').attributes('aria-selected')).toBe('true');
    expect(w.findAll('.discover-row-title').map((t: any) => t.text())).toEqual(['Albums', 'Singles & EPs']);
    expect(w.findAll('.album-tile')[0]!.text()).toContain('3 tracks');

    await w.find('[data-testid="artist-tab-songs"]').trigger('click');
    await vi.waitFor(() => expect(currentQuery().tab).toBe('songs'));
    expect(currentQuery().artistId).toBe('a1');
    await flushPromises();
    expect(w.find('[data-testid="songs-sort"]').exists()).toBe(true);

    await w.find('[data-testid="artist-tab-overview"]').trigger('click');
    await vi.waitFor(() => expect(currentQuery().tab).toBeUndefined());

    await useRouter().replace({ path: '/music', query: { artistId: 'a1', tab: 'bogus' } });
    await flushPromises();
    expect(w.find('[data-testid="artist-tab-overview"]').attributes('aria-selected')).toBe('true');
  });

  it('"Show more" under Popular opens the Songs tab sorted by popularity', async () => {
    const w = await mountArtist();
    await w.find('[data-testid="popular-show-more"]').trigger('click');
    await vi.waitFor(() => expect(currentQuery().tab).toBe('songs'));
    await flushPromises();
    expect(songsCalls()[0]![1].params).toEqual({ sort: 'popular', limit: 50, offset: 0 });
    expect((w.find('[data-testid="songs-sort"]').element as HTMLSelectElement).value).toBe('popular');
  });

  it('Songs pages with Load more and restarts the list on a sort change', async () => {
    const w = await mountArtist({ tab: 'songs' });
    const rows = () => w.findAll('.mas .mtl-title').map((t: any) => t.text());
    expect(rows()).toHaveLength(50);
    expect(rows()[0]).toBe('popular 1');

    await w.find('[data-testid="songs-load-more"]').trigger('click');
    await flushPromises();
    expect(rows()).toHaveLength(60);
    expect(songsCalls().at(-1)![1].params).toEqual({ sort: 'popular', limit: 50, offset: 50 });
    expect(w.find('[data-testid="songs-load-more"]').exists()).toBe(false);

    await w.find('[data-testid="songs-sort"]').setValue('newest');
    await flushPromises();
    expect(songsCalls().at(-1)![1].params).toEqual({ sort: 'newest', limit: 50, offset: 0 });
    expect(rows()).toHaveLength(50);
    expect(rows()[0]).toBe('newest 1');
  });

  it('Play queues the songs most popular first; Shuffle turns shuffle on', async () => {
    const w = await mountArtist();
    const [play, shuffle] = w.findAll('.mch-buttons .btn');
    await play!.trigger('click');
    await flushPromises();
    expect(songsCalls().at(-1)![1].params).toEqual({ sort: 'popular', limit: 200, offset: 0 });
    const player = useMusicPlayer();
    expect(player.currentTrack.value?.id).toBe('t1');
    expect(player.queue.value).toHaveLength(60);
    expect(player.shuffleOn.value).toBe(false);

    await shuffle!.trigger('click');
    await flushPromises();
    expect(player.shuffleOn.value).toBe(true);
  });

  it('shows admin-only visibility badge and edit buttons only to admins', async () => {
    let w = await mountArtist();
    expect(w.find('.mah .badge').exists()).toBe(false);
    expect(w.find('.mte-edit').exists()).toBe(false);
    wrapper.unmount();

    useState<any>('auth_user').value = { id: 'boss', username: 'boss', role: 'admin' };
    w = await mountArtist();
    expect(w.find('.mah .badge').text()).toBe('Private');
    expect(w.findAll('.mte-edit')).toHaveLength(5);
    await w.find('.mte-edit').trigger('click');
    expect(w.find('#track-edit-title').exists()).toBe(true);
  });

  it('reports a missing or forbidden artist', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/music/artists/a1/overview') throw Object.assign(new Error('nope'), { statusCode: 403 });
      return {};
    });
    const w = await mountArtist();
    expect(w.text()).toContain('Artist not found or access denied.');
  });
});
