import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { defineComponent, h } from 'vue';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import AddToPlaylistMenu from '../../app/components/AddToPlaylistMenu.vue';
import MusicTrackActions from '../../app/components/MusicTrackActions.vue';
import { useToast } from '../../app/composables/useToast';

const fetchMock = vi.fn();
let playlists: any[];

beforeEach(() => {
  fetchMock.mockReset();
  playlists = [
    { id: 'p1', title: 'Road trip', trackCount: 3, containsTrack: true },
    { id: 'p2', title: 'Focus', trackCount: 0, containsTrack: false },
  ];
  fetchMock.mockImplementation(async (url: string, opts: any = {}) => {
    if (url === '/api/music/user-playlists' && !opts.method) return playlists;
    if (url === '/api/music/user-playlists' && opts.method === 'POST') return { id: 'p9', title: opts.body.title, trackCount: 0 };
    if (url.endsWith('/tracks') && opts.method === 'POST') return { added: true, trackCount: 1 };
    if (opts.method === 'DELETE') return { trackCount: 2 };
    if (url === '/api/music/favorites/status') return { liked: [] };
    return {};
  });
  vi.stubGlobal('$fetch', fetchMock);
  useState<any>('auth_user').value = { id: 'u1', username: 'u1', role: 'user' };
  useState('music_likes').value = { owner: null, liked: {} };
  useToast().toasts.value.splice(0);
});
const mounted: Array<{ unmount: () => void }> = [];
afterEach(() => {
  mounted.splice(0).forEach((w) => w.unmount());
  vi.unstubAllGlobals();
});

const panel = () => document.body.querySelector('.add-to-playlist-panel') as HTMLElement | null;
const items = () => [...document.body.querySelectorAll<HTMLButtonElement>('.atp-item')];

async function openMenu() {
  const w = await mountSuspended(AddToPlaylistMenu, { props: { trackId: 't1' }, attachTo: document.body });
  mounted.push(w);
  await w.find('.add-to-playlist-btn').trigger('click');
  await flushPromises();
  return w;
}

describe('AddToPlaylistMenu', () => {
  it('lists the user\'s playlists with a check on those that already hold the track', async () => {
    await openMenu();
    expect(fetchMock).toHaveBeenCalledWith('/api/music/user-playlists', { params: { containsTrack: 't1' } });
    expect(items().map((b) => [b.querySelector('.atp-title')!.textContent, b.getAttribute('aria-checked')])).toEqual([
      ['Road trip', 'true'],
      ['Focus', 'false'],
    ]);
  });

  it('adds to an unchecked playlist and removes from a checked one', async () => {
    await openMenu();
    items()[1]!.click();
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledWith('/api/music/user-playlists/p2/tracks', { method: 'POST', body: { trackId: 't1' } });
    expect(items()[1]!.getAttribute('aria-checked')).toBe('true');
    expect(items()[1]!.querySelector('.atp-count')!.textContent).toBe('1');

    items()[0]!.click();
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledWith('/api/music/user-playlists/p1/tracks/t1', { method: 'DELETE' });
    expect(items()[0]!.getAttribute('aria-checked')).toBe('false');
    expect(useToast().toasts.value.map((t) => t.message)).toEqual(['Added to Focus', 'Removed from Road trip']);
  });

  it('rolls the check back with the server message when a change fails', async () => {
    fetchMock.mockImplementation(async (url: string, opts: any = {}) => {
      if (!opts.method) return playlists;
      throw Object.assign(new Error('nope'), { data: { statusMessage: 'A playlist holds at most 2000 tracks.' } });
    });
    await openMenu();
    items()[1]!.click();
    await flushPromises();
    expect(items()[1]!.getAttribute('aria-checked')).toBe('false');
    expect(useToast().toasts.value.map((t) => [t.type, t.message])).toEqual([['error', 'A playlist holds at most 2000 tracks.']]);
  });

  it('creates a new playlist inline and adds the track to it', async () => {
    await openMenu();
    const input = panel()!.querySelector('input') as HTMLInputElement;
    input.value = '  Late night ';
    input.dispatchEvent(new Event('input'));
    await flushPromises();
    panel()!.querySelector('form')!.dispatchEvent(new Event('submit'));
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledWith('/api/music/user-playlists', { method: 'POST', body: { title: 'Late night' } });
    expect(fetchMock).toHaveBeenCalledWith('/api/music/user-playlists/p9/tracks', { method: 'POST', body: { trackId: 't1' } });
    expect(items()[0]!.querySelector('.atp-title')!.textContent).toBe('Late night');
    expect(items()[0]!.getAttribute('aria-checked')).toBe('true');
    expect(input.value).toBe('');
  });

  it('closes on Escape and on a click outside', async () => {
    await openMenu();
    expect(panel()).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flushPromises();
    expect(panel()).toBeNull();

    await openMenu();
    panel()!.querySelector('input')!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await flushPromises();
    expect(panel()).not.toBeNull();
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await flushPromises();
    expect(panel()).toBeNull();
  });

  it('shows "No playlists yet" when the user has none', async () => {
    playlists = [];
    await openMenu();
    expect(panel()!.textContent).toContain('No playlists yet');
  });

  it('is hidden for guests, like the like button', async () => {
    useState<any>('auth_user').value = null;
    const w = await mountSuspended(MusicTrackActions, { props: { trackId: 't1' } });
    expect(w.find('button').exists()).toBe(false);
  });

  it('track actions do not let a click reach the row that hosts them', async () => {
    const rowClick = vi.fn();
    const Host = defineComponent({
      setup: () => () => h('div', { onClick: rowClick }, [h(MusicTrackActions, { trackId: 't1' })]),
    });
    const w = await mountSuspended(Host);
    await flushPromises();
    await w.find('.track-like-btn').trigger('click');
    await w.find('.add-to-playlist-btn').trigger('click');
    expect(rowClick).not.toHaveBeenCalled();
  });
});
