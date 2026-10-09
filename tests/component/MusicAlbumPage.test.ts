import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import AlbumPage from '../../app/pages/music/album/[id].vue';
import { useMusicPlayer } from '../../app/composables/useMusicPlayer';

const track = (i: number, extra: any = {}) => ({
  id: `t${i}`, title: `Song ${i}`, track_number: i, artist_id: 'a1', artist_name: 'Band',
  album_id: 'al1', album_title: 'Record', local_file_path: `/m/t${i}`, duration: 61, ...extra,
});

let response: any;
const fetchMock = vi.fn();
let wrapper: any;

beforeEach(() => {
  response = {
    album: {
      id: 'al1', title: 'Record', year: 2015, type: 'ep', coverUrl: '/covers/al1.jpg', manualCoverUrl: null,
      artistId: 'a1', artistName: 'Band',
    },
    tracks: [track(1), track(2), track(3, { track_number: null, title: 'Bonus' })],
  };
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, opts: any = {}) => {
    if (url === '/api/music/favorites/status') return { liked: [] };
    if (url === '/api/music/albums/al1') return response;
    if (url === '/api/admin/music/albums/al1' && opts.method === 'PATCH') {
      return { album: { id: 'al1', title: opts.body.title, release_year: 2016, cover_url: '/covers/al1.jpg', manual_cover_url: null } };
    }
    throw Object.assign(new Error('not found'), { statusCode: 404 });
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

async function mountAlbum(id = 'al1') {
  wrapper = await mountSuspended(AlbumPage, { route: `/music/album/${id}` });
  await flushPromises();
  return wrapper;
}

describe('/music/album/[id]', () => {
  it('shows the cover, title, type, year, artist link and a tracklist numbered by track number', async () => {
    const w = await mountAlbum();
    expect(w.find('.mch-kicker').text()).toBe('EP');
    expect(w.find('.ap-title').text()).toBe('Record');
    expect(w.find('.mch-subtitle').text()).toBe('2015 · 3 songs');
    expect(w.find('.ap-cover').attributes('src')).toBe('/covers/al1.jpg');
    expect(w.find('[data-testid="album-artist-link"]').attributes('href')).toBe('/music?artistId=a1');
    expect(w.findAll('.mtl-index').map((n: any) => n.text())).toEqual(['1', '2', '–']);
    expect(w.findAll('.mtl-title').map((n: any) => n.text())).toEqual(['Song 1', 'Song 2', 'Bonus']);
    // The album column is left out on the album's own page.
    expect(w.find('.mtl-album-link').exists()).toBe(false);
    expect(w.find('[data-testid="album-edit"]').exists()).toBe(false);
    expect(w.find('.mte-edit').exists()).toBe(false);
  });

  it('plays the album in order from Play and from a row', async () => {
    const w = await mountAlbum();
    await w.findAll('.mch-buttons .btn')[0]!.trigger('click');
    const player = useMusicPlayer();
    expect(player.currentTrack.value?.id).toBe('t1');
    expect(player.queue.value.map((t: any) => t.id)).toEqual(['t1', 't2', 't3']);

    await w.findAll('.mtl-row')[1]!.trigger('click');
    expect(player.currentTrack.value?.id).toBe('t2');
  });

  it('keeps the album and track edit buttons for admins', async () => {
    useState<any>('auth_user').value = { id: 'boss', username: 'boss', role: 'admin' };
    const w = await mountAlbum();
    expect(w.findAll('.mte-edit')).toHaveLength(3);

    await w.find('[data-testid="album-edit"]').trigger('click');
    await w.find('#album-edit-title').setValue('Record (Deluxe)');
    await w.find('#album-edit-title').element.form!.dispatchEvent(new Event('submit'));
    await flushPromises();
    expect(fetchMock.mock.calls.some(([u, o]) => u === '/api/admin/music/albums/al1' && o?.method === 'PATCH')).toBe(true);
    expect(w.find('.ap-title').text()).toBe('Record (Deluxe)');
    expect(w.find('.mch-subtitle').text()).toBe('2016 · 3 songs');

    await w.find('.mte-edit').trigger('click');
    expect((w.find('#track-edit-title').element as HTMLInputElement).value).toBe('Song 1');
  });

  it('reports a missing or forbidden album', async () => {
    const w = await mountAlbum('nope');
    expect(w.text()).toContain('Album not found or access denied.');
  });
});
