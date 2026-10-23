import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import PlaylistPage from '../../app/pages/playlists/[id].vue';
import PlaylistsIndex from '../../app/pages/playlists/index.vue';

// Pages that had no component test: a personal playlist opened with and
// without its share token and the playlists list (the Subscriptions page has
// its own file, SubscriptionsPage.test.ts).
let fetchMock: ReturnType<typeof vi.fn>;
const playlist = { id: 'p1', title: 'Road trip', visibility: 'private', owner_name: 'alice', share_token: null, description: '' };
const videos = [
  { id: 'v1', title: 'First clip', channel_title: 'Chan', duration: 61, view_count: 5, local_thumbnail_path: null },
  { id: 'v2', title: 'Second clip', channel_title: 'Chan', duration: 62, view_count: 6, local_thumbnail_path: null },
];

beforeEach(() => {
  clearNuxtData();
  useState('auth_loading').value = false;
  useState('auth_user').value = null;
  fetchMock = vi.fn(async (url: string) => {
    if (url.startsWith('/api/playlists/personal/p1')) return { playlist, videos };
    if (url.startsWith('/api/playlists/personal/nope')) throw Object.assign(new Error('404'), { statusCode: 404, statusMessage: 'Playlist not found.' });
    if (url === '/api/playlists/personal') return { playlists: [{ id: 'p1', title: 'Road trip', visibility: 'private', video_count: 2, owner_name: 'alice' }, { id: 'p2', title: 'Chill', visibility: 'public', video_count: 0, owner_name: 'bob' }] };
    return {};
  });
  vi.stubGlobal('$fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const urls = () => fetchMock.mock.calls.map(([u]) => String(u));

describe('personal playlist page', () => {
  const mountPlaylist = async (id: string, query: Record<string, string> = {}) => {
    const w = await mountSuspended(PlaylistPage, { route: { path: `/playlists/${id}`, params: { id }, query } as any });
    await flushPromises();
    return w;
  };

  it('a guest with the share link loads the playlist with its token and sees no owner controls', async () => {
    const w = await mountPlaylist('p1', { token: 'share-tok' });
    expect(urls()).toContain('/api/playlists/personal/p1?token=share-tok');
    expect(w.find('.playlist-title').text()).toBe('Road trip');
    expect(w.findAll('.video-row')).toHaveLength(2);
    expect(w.text()).not.toContain('Settings');
    expect(w.findAll('.video-row-actions button')).toHaveLength(0);
  });

  it('without a token it asks for the playlist without one', async () => {
    useState<any>('auth_user').value = { id: 'u1', username: 'alice', role: 'user' };
    await mountPlaylist('p1');
    expect(urls()).toContain('/api/playlists/personal/p1');
    expect(urls().some((u) => u.includes('token='))).toBe(false);
  });

  it('the owner gets the remove buttons', async () => {
    useState<any>('auth_user').value = { id: 'u1', username: 'alice', role: 'user' };
    const w = await mountPlaylist('p1');
    expect(w.findAll('.video-row-actions button').length).toBe(2);
  });

  it('frames the cover and every row thumbnail in the shared 16:9 media frame', async () => {
    const w = await mountPlaylist('p1', { token: 'share-tok' });
    expect(w.find('.sidebar-cover').classes()).toEqual(expect.arrayContaining(['media-frame', 'media-frame--video']));
    const rows = w.findAll('.video-row .video-thumbnail-container');
    expect(rows).toHaveLength(2);
    for (const f of rows) expect(f.classes()).toContain('media-frame--video');
    expect(w.findAll('.video-row img').map((i) => i.attributes('src')))
      .toEqual(['https://i.ytimg.com/vi/v1/mqdefault.jpg', 'https://i.ytimg.com/vi/v2/mqdefault.jpg']);
  });

  it('a playlist holding Shorts lists its long videos, then its Shorts, under two headers', async () => {
    const mixed = [
      { id: 'v1', title: 'First clip', duration: 61, is_short: 0 },
      { id: 's1', title: 'A short', duration: 20, is_short: 1 },
      { id: 'v2', title: 'Second clip', duration: 62, is_short: 0 },
    ];
    fetchMock.mockImplementation(async (url: string) => (url.startsWith('/api/playlists/personal/p1') ? { playlist, videos: mixed } : {}));
    const w = await mountPlaylist('p1', { token: 'share-tok' });
    expect(w.findAll('.playlist-kind-title').map((h) => h.text())).toEqual(['Videos', 'Shorts']);
    const videoRows = w.find('[data-testid="playlist-videos"]').findAll('.video-row');
    const shortRows = w.find('[data-testid="playlist-shorts"]').findAll('.video-row');
    expect(videoRows.map((r) => r.find('.video-title').text())).toEqual(['First clip', 'Second clip']);
    expect(shortRows.map((r) => r.find('.video-title').text())).toEqual(['A short']);
    // Each row keeps its place number in the playlist.
    expect(videoRows.map((r) => r.find('.video-index').text())).toEqual(['1', '3']);
    expect(shortRows[0]!.find('.video-index').text()).toBe('2');
    expect(shortRows[0]!.find('.video-thumbnail-container').classes()).toContain('media-frame--short');
    expect(shortRows[0]!.find('[data-testid="short-badge"]').text()).toBe('SHORT');
  });

  it('a playlist of long videos only shows no section headers', async () => {
    const w = await mountPlaylist('p1', { token: 'share-tok' });
    expect(w.findAll('.playlist-kind-title')).toHaveLength(0);
    expect(w.findAll('.video-row')).toHaveLength(2);
  });

  it('a refused playlist shows the error state, not someone else\'s content', async () => {
    const w = await mountPlaylist('nope', { token: 'wrong' });
    expect(w.text()).toContain('Error Loading Playlist');
    expect(w.text()).toContain('Playlist not found.');
    expect(w.find('.playlist-title').exists()).toBe(false);
  });
});

describe('playlists index page', () => {
  it('lists the viewer\'s playlists', async () => {
    useState<any>('auth_user').value = { id: 'u1', username: 'alice', role: 'user' };
    const w = await mountSuspended(PlaylistsIndex, { route: '/playlists' });
    await flushPromises();
    expect(urls()).toContain('/api/playlists/personal');
    expect(w.text()).toContain('Road trip');
    expect(w.text()).toContain('Chill');
    const covers = w.findAll('.thumbnail-wrapper');
    expect(covers).toHaveLength(2);
    for (const c of covers) expect(c.classes()).toEqual(expect.arrayContaining(['media-frame', 'media-frame--video']));
  });

  it('never calls the user-only API for a guest (expired session)', async () => {
    const w = await mountSuspended(PlaylistsIndex, { route: '/playlists' });
    await flushPromises();
    expect(urls()).not.toContain('/api/playlists/personal');
    expect(w.find('.loading-state').exists()).toBe(false);
  });

  it('shows no raw 401 error toast (the session-expiry handler reports it once)', async () => {
    const { useToast } = await import('../../app/composables/useToast');
    useToast().toasts.value = [];
    useState<any>('auth_user').value = { id: 'u1', username: 'alice', role: 'user' };
    fetchMock.mockImplementation(async () => { throw Object.assign(new Error('[GET] "/api/playlists/personal": 401 Unauthorized'), { statusCode: 401 }); });
    await mountSuspended(PlaylistsIndex, { route: '/playlists' });
    await flushPromises();
    expect(useToast().toasts.value).toEqual([]);
  });
});
