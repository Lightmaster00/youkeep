import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import LikedPage from '../../app/pages/music/liked.vue';
import PlaylistsPage from '../../app/pages/music/playlists/index.vue';
import PlaylistPage from '../../app/pages/music/playlists/[id].vue';
import { useMusicPlayer } from '../../app/composables/useMusicPlayer';
import { useToast } from '../../app/composables/useToast';

const fetchMock = vi.fn();
type Handler = (url: string, opts: any) => any;
let handler: Handler;

const track = (i: number) => ({ id: `t${i}`, title: `Song ${i}`, artist_id: 'a1', artist_name: 'Band', local_file_path: `/m/t${i}`, duration: 61 });

beforeEach(() => {
  fetchMock.mockReset();
  handler = () => ({});
  fetchMock.mockImplementation(async (url: string, opts: any = {}) => {
    if (url === '/api/music/favorites/status') return { liked: [] };
    return handler(url, opts);
  });
  vi.stubGlobal('$fetch', fetchMock);
  useState<any>('auth_user').value = { id: 'u1', username: 'u1', role: 'user' };
  useState('music_likes').value = { owner: null, liked: {} };
  useState('music_player_current_track').value = null;
  useState('music_player_shuffle').value = false;
  useToast().toasts.value.splice(0);
});
afterEach(() => vi.unstubAllGlobals());

const buttonByText = (w: any, text: string) => w.findAll('button').find((b: any) => b.text() === text)!;
const rowTitles = (w: any) => w.findAll('.mtl-title').map((t: any) => t.text());
const calls = (method: string) => fetchMock.mock.calls.filter(([, o]) => o?.method === method);

describe('/music/liked', () => {
  it('lists liked songs without asking their like state again, and plays them as the queue', async () => {
    handler = (url) => (url === '/api/music/favorites' ? { items: [track(1), track(2)], total: 2 } : {});
    const w = await mountSuspended(LikedPage);
    await flushPromises();
    expect(fetchMock.mock.calls[0]).toEqual(['/api/music/favorites', { params: { limit: 30, offset: 0 } }]);
    expect(rowTitles(w)).toEqual(['Song 1', 'Song 2']);
    expect(w.text()).toContain('2 songs');
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/music/favorites/status')).toBe(false);
    expect(w.findAll('.track-like-btn').map((b) => b.attributes('aria-pressed'))).toEqual(['true', 'true']);

    await buttonByText(w, 'Play').trigger('click');
    const player = useMusicPlayer();
    expect(player.currentTrack.value?.id).toBe('t1');
    expect(player.queue.value.map((t) => t.id)).toEqual(['t1', 't2']);
    expect(player.shuffleOn.value).toBe(false);

    await buttonByText(w, 'Shuffle').trigger('click');
    expect(player.shuffleOn.value).toBe(true);
    expect(player.queue.value.map((t) => t.id)).toEqual(['t1', 't2']);
  });

  it('drops a song from the list when it is unliked', async () => {
    handler = (url) => (url === '/api/music/favorites' ? { items: [track(1), track(2)], total: 2 } : {});
    const w = await mountSuspended(LikedPage);
    await flushPromises();
    await w.findAll('.track-like-btn')[0]!.trigger('click');
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledWith('/api/music/favorites/t1', { method: 'DELETE' });
    expect(rowTitles(w)).toEqual(['Song 2']);
    expect(w.text()).toContain('1 song');
  });

  it('shows "No liked songs yet" when there are none', async () => {
    handler = () => ({ items: [], total: 0 });
    const w = await mountSuspended(LikedPage);
    await flushPromises();
    expect(w.text()).toContain('No liked songs yet');
    expect(buttonByText(w, 'Play').attributes('disabled')).toBeDefined();
  });
});

describe('/music/playlists', () => {
  it('shows "No playlists yet", then creates one inline', async () => {
    handler = (url, opts) => {
      if (url === '/api/music/user-playlists' && opts.method === 'POST') {
        return { id: 'p1', title: opts.body.title, trackCount: 0, coverUrls: [] };
      }
      return [];
    };
    const w = await mountSuspended(PlaylistsPage);
    await flushPromises();
    expect(w.text()).toContain('No playlists yet');
    await buttonByText(w, 'New playlist').trigger('click');
    await w.find('#upl-title').setValue(' Gym ');
    await w.find('form').trigger('submit');
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledWith('/api/music/user-playlists', { method: 'POST', body: { title: 'Gym', description: null } });
    expect(w.findAll('.upl-card').map((c) => c.find('.upl-card-title').text())).toEqual(['Gym']);
    expect(w.find('.upl-card').attributes('href')).toBe('/music/playlists/p1');
  });

  it('lists playlists with their song counts', async () => {
    handler = () => [
      { id: 'p1', title: 'Gym', trackCount: 1, coverUrls: ['/c1.jpg'] },
      { id: 'p2', title: 'Sleep', trackCount: 12, coverUrls: [] },
    ];
    const w = await mountSuspended(PlaylistsPage);
    await flushPromises();
    expect(w.findAll('.upl-card').map((c) => c.text())).toEqual(['Gym1 song', 'Sleep12 songs']);
  });
});

describe('/music/playlists/[id]', () => {
  const detail = () => ({
    playlist: { id: 'p1', title: 'Gym', description: 'Loud', trackCount: 3, coverUrls: [] },
    tracks: [track(1), track(2), track(3)],
  });

  async function mountDetail() {
    const w = await mountSuspended(PlaylistPage, { route: '/music/playlists/p1' });
    await flushPromises();
    return w;
  }

  it('moves a track down and saves the new order', async () => {
    handler = (url) => (url === '/api/music/user-playlists/p1' ? detail() : { success: true });
    const w = await mountDetail();
    expect(w.find('h1').text()).toBe('Gym');
    expect(rowTitles(w)).toEqual(['Song 1', 'Song 2', 'Song 3']);
    await w.find('[aria-label="Move Song 1 down"]').trigger('click');
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledWith('/api/music/user-playlists/p1/order', { method: 'PUT', body: { trackIds: ['t2', 't1', 't3'] } });
    expect(rowTitles(w)).toEqual(['Song 2', 'Song 1', 'Song 3']);
    expect(w.find('[aria-label="Move Song 2 up"]').attributes('disabled')).toBeDefined();
    expect(w.find('[aria-label="Move Song 3 down"]').attributes('disabled')).toBeDefined();
  });

  it('puts the order back when saving it fails', async () => {
    let reject: (e: any) => void = () => {};
    handler = (url, opts) => {
      if (opts.method === 'PUT') return new Promise((_, r) => { reject = r; });
      return detail();
    };
    const w = await mountDetail();
    await w.find('[aria-label="Move Song 3 up"]').trigger('click');
    expect(rowTitles(w)).toEqual(['Song 1', 'Song 3', 'Song 2']);
    reject(Object.assign(new Error('x'), { data: { statusMessage: 'trackIds must list every track of the playlist exactly once.' } }));
    await flushPromises();
    expect(rowTitles(w)).toEqual(['Song 1', 'Song 2', 'Song 3']);
    expect(useToast().toasts.value.map((t) => t.type)).toEqual(['error']);
  });

  it('removes a track, and restores it if the server refuses', async () => {
    let fail = false;
    handler = (url, opts) => {
      if (opts.method === 'DELETE') {
        if (fail) throw new Error('nope');
        return { trackCount: 2 };
      }
      return detail();
    };
    const w = await mountDetail();
    await w.find('[aria-label="Remove Song 2 from this playlist"]').trigger('click');
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledWith('/api/music/user-playlists/p1/tracks/t2', { method: 'DELETE' });
    expect(rowTitles(w)).toEqual(['Song 1', 'Song 3']);
    expect(w.text()).toContain('2 songs');
    fail = true;
    await w.find('[aria-label="Remove Song 3 from this playlist"]').trigger('click');
    await flushPromises();
    expect(rowTitles(w)).toEqual(['Song 1', 'Song 3']);
  });

  it('renames the playlist', async () => {
    handler = (url, opts) => (opts.method === 'PUT' ? { id: 'p1', title: opts.body.title, description: opts.body.description } : detail());
    const w = await mountDetail();
    await buttonByText(w, 'Edit').trigger('click');
    await w.find('input[aria-label="Playlist name"]').setValue('Gym 2');
    await w.find('form.pd-edit').trigger('submit');
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledWith('/api/music/user-playlists/p1', { method: 'PUT', body: { title: 'Gym 2', description: 'Loud' } });
    expect(w.find('h1').text()).toBe('Gym 2');
  });

  it('deletes the playlist only after confirmation', async () => {
    handler = (url, opts) => (opts.method === 'DELETE' ? { success: true } : detail());
    const w = await mountDetail();
    await buttonByText(w, 'Delete playlist').trigger('click');
    expect(calls('DELETE')).toHaveLength(0);
    expect(w.text()).toContain('"Gym" will be deleted.');
    await buttonByText(w, 'Delete').trigger('click');
    await flushPromises();
    expect(calls('DELETE')[0]![0]).toBe('/api/music/user-playlists/p1');
  });

  it('plays the playlist in order', async () => {
    handler = () => detail();
    const w = await mountDetail();
    await w.findAll('.mtl-row')[1]!.trigger('click');
    const player = useMusicPlayer();
    expect(player.currentTrack.value?.id).toBe('t2');
    expect(player.queue.value.map((t) => t.id)).toEqual(['t1', 't2', 't3']);
  });

  it('says so when the playlist does not exist', async () => {
    handler = () => { throw Object.assign(new Error('404'), { statusCode: 404 }); };
    const w = await mountDetail();
    expect(w.text()).toContain('Playlist not found');
  });
});
