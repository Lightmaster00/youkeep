import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import PlaylistPage from '../../app/pages/playlists/[id].vue';
import PlaylistsIndex from '../../app/pages/playlists/index.vue';
import SubscriptionsPage from '../../app/pages/subscriptions.vue';

// Pages that had no component test: a personal playlist opened with and
// without its share token, the playlists list, and the subscriptions feed.
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
    if (url === '/api/channels') return { channels: [{ id: 'c1', title: 'Followed one', avatar_url: null }] };
    if (url === '/api/videos') return { videos: [{ id: 'sv1', title: 'Subscribed video', channel_id: 'c1', channel_title: 'Followed one', duration: 30 }], totalCount: 1 };
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
  });
});

describe('subscriptions page', () => {
  it('loads followed channels and only their completed videos', async () => {
    useState<any>('auth_user').value = { id: 'u1', username: 'alice', role: 'user' };
    const w = await mountSuspended(SubscriptionsPage, { route: '/subscriptions' });
    await flushPromises();
    const channelsCall = fetchMock.mock.calls.find(([u]) => u === '/api/channels')!;
    expect(channelsCall[1]).toMatchObject({ params: { subscribed: 'true' } });
    const videosCall = fetchMock.mock.calls.find(([u]) => u === '/api/videos')!;
    expect(videosCall[1]).toMatchObject({ params: { subscribed: 'true', status: 'completed' } });
    expect(w.text()).toContain('Followed one');
    expect(w.text()).toContain('Subscribed video');
  });
});
