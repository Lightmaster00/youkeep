import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import MusicHistoryPage from '../../app/pages/music/history.vue';
import PodcastHistoryPage from '../../app/pages/podcasts/history.vue';
import { useMusicPlayer } from '../../app/composables/useMusicPlayer';
import { usePodcastPlayer } from '../../app/composables/usePodcastPlayer';
import { usePodcastProgress } from '../../app/composables/usePodcastProgress';
import { useToast } from '../../app/composables/useToast';

const fetchMock = vi.fn();
type Handler = (url: string, opts: any) => any;
let handler: Handler;

// Local noon of today / yesterday, so the day headings hold at any hour.
const now = new Date();
const TODAY = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12).getTime();
const YESTERDAY = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12).getTime();

const track = (i: number, playedAt: number) => ({
  id: `t${i}`, title: `Song ${i}`, artist_id: 'a1', artist_name: 'Band', local_file_path: `/m/t${i}`, duration: 61,
  playedAt, playCount: 1,
});
const progress = (updatedAt: number, completed = false) => ({ positionSeconds: completed ? 1000 : 250, durationSeconds: 1000, completed, updatedAt });
const episode = (i: number, updatedAt: number, completed = false) => ({
  id: `e${i}`, title: `Episode ${i}`, show_id: 's1', show_title: 'The Show', duration: 1000, local_file_path: `/p/e${i}`,
  download_status: 'completed', progress: progress(updatedAt, completed),
});

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
  useState('podcast_progress').value = { owner: null, progress: {} };
  useState('podcast_player_current_episode').value = null;
  useToast().toasts.value.splice(0);
});
afterEach(() => vi.unstubAllGlobals());

const buttonByText = (w: any, text: string) => w.findAll('button').find((b: any) => b.text() === text);
const headings = (w: any) => w.findAll('.history-day-heading').map((h: any) => h.text());
const calls = (method: string) => fetchMock.mock.calls.filter(([, o]) => o?.method === method);
const toastTypes = () => useToast().toasts.value.map((t) => t.type);

describe('/music/history', () => {
  it('lists the history grouped by day and plays the whole history as the queue', async () => {
    handler = (url) => (url === '/api/music/history' ? { items: [track(1, TODAY), track(2, TODAY - 1000), track(3, YESTERDAY)], total: 3 } : {});
    const w = await mountSuspended(MusicHistoryPage);
    await flushPromises();
    expect(fetchMock.mock.calls[0]).toEqual(['/api/music/history', { params: { limit: 30, offset: 0 } }]);
    expect(headings(w)).toEqual(['Today', 'Yesterday']);
    const days = w.findAll('.history-day');
    expect(days[0]!.findAll('.mtl-title').map((t) => t.text())).toEqual(['Song 1', 'Song 2']);
    expect(days[1]!.findAll('.mtl-title').map((t) => t.text())).toEqual(['Song 3']);
    expect(buttonByText(w, 'Load more')).toBeUndefined();

    await days[1]!.find('.mtl-row').trigger('click');
    const player = useMusicPlayer();
    expect(player.currentTrack.value?.id).toBe('t3');
    expect(player.queue.value.map((t) => t.id)).toEqual(['t1', 't2', 't3']);
  });

  it('removes a song at once and puts it back in place with a toast when the server refuses', async () => {
    let fail = false;
    handler = (url, opts) => {
      if (opts.method === 'DELETE') {
        if (fail) throw new Error('nope');
        return { removed: 1 };
      }
      return url === '/api/music/history' ? { items: [track(1, TODAY), track(2, TODAY - 1000), track(3, YESTERDAY)], total: 3 } : {};
    };
    const w = await mountSuspended(MusicHistoryPage);
    await flushPromises();
    await w.find('[aria-label="Remove Song 1 from history"]').trigger('click');
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledWith('/api/music/history/t1', { method: 'DELETE' });
    expect(w.findAll('.mtl-title').map((t) => t.text())).toEqual(['Song 2', 'Song 3']);
    expect(toastTypes()).toEqual([]);
    // The count follows, so no phantom "Load more" appears.
    expect(buttonByText(w, 'Load more')).toBeUndefined();

    fail = true;
    await w.find('[aria-label="Remove Song 3 from history"]').trigger('click');
    await flushPromises();
    expect(w.findAll('.mtl-title').map((t) => t.text())).toEqual(['Song 2', 'Song 3']);
    expect(headings(w)).toEqual(['Today', 'Yesterday']);
    expect(toastTypes()).toEqual(['error']);
    expect(buttonByText(w, 'Load more')).toBeUndefined();
  });

  it('restores a refused removal at its place among the others', async () => {
    let release: (e: any) => void = () => {};
    handler = (url, opts) => {
      if (opts.method === 'DELETE') return new Promise((_, reject) => { release = reject; });
      return url === '/api/music/history' ? { items: [track(1, TODAY), track(2, TODAY - 1000), track(3, YESTERDAY)], total: 3 } : {};
    };
    const w = await mountSuspended(MusicHistoryPage);
    await flushPromises();
    await w.find('[aria-label="Remove Song 2 from history"]').trigger('click');
    expect(w.findAll('.mtl-title').map((t) => t.text())).toEqual(['Song 1', 'Song 3']);
    release(new Error('nope'));
    await flushPromises();
    expect(w.findAll('.mtl-title').map((t) => t.text())).toEqual(['Song 1', 'Song 2', 'Song 3']);
  });

  it('clears the history only after confirming', async () => {
    handler = (url, opts) => {
      if (opts.method === 'DELETE') return { removed: 2 };
      return url === '/api/music/history' ? { items: [track(1, TODAY), track(2, YESTERDAY)], total: 2 } : {};
    };
    const w = await mountSuspended(MusicHistoryPage);
    await flushPromises();
    await buttonByText(w, 'Clear history').trigger('click');
    expect(w.find('[role="dialog"]').text()).toContain('Clear history?');
    await buttonByText(w, 'Cancel').trigger('click');
    expect(w.find('[role="dialog"]').exists()).toBe(false);
    expect(calls('DELETE')).toHaveLength(0);

    await buttonByText(w, 'Clear history').trigger('click');
    await w.find('.confirm-dialog-confirm').trigger('click');
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledWith('/api/music/history', { method: 'DELETE' });
    expect(w.find('[role="dialog"]').exists()).toBe(false);
    expect(w.findAll('.mtl-row')).toHaveLength(0);
    expect(w.text()).toContain('No listening history yet');
    expect(buttonByText(w, 'Clear history')).toBeUndefined();
    expect(toastTypes()).toEqual(['success']);
  });

  it('keeps the list and says so when clearing fails', async () => {
    handler = (url, opts) => {
      if (opts.method === 'DELETE') throw new Error('nope');
      return url === '/api/music/history' ? { items: [track(1, TODAY)], total: 1 } : {};
    };
    const w = await mountSuspended(MusicHistoryPage);
    await flushPromises();
    await buttonByText(w, 'Clear history').trigger('click');
    await w.find('.confirm-dialog-confirm').trigger('click');
    await flushPromises();
    expect(w.findAll('.mtl-title').map((t) => t.text())).toEqual(['Song 1']);
    expect(toastTypes()).toEqual(['error']);
  });

  it('shows "No listening history yet" when empty', async () => {
    handler = () => ({ items: [], total: 0 });
    const w = await mountSuspended(MusicHistoryPage);
    await flushPromises();
    expect(w.text()).toContain('No listening history yet');
    expect(buttonByText(w, 'Clear history')).toBeUndefined();
  });

  it('loads the next page from the number of songs shown, after removals too', async () => {
    const page1 = Array.from({ length: 30 }, (_, i) => track(i, TODAY - i * 1000));
    let fail = true;
    handler = (url, opts) => {
      if (opts.method === 'DELETE') {
        if (fail) throw new Error('nope');
        return { removed: 1 };
      }
      if (url !== '/api/music/history') return {};
      return opts.params.offset === 0 ? { items: page1, total: 31 } : { items: [track(90, YESTERDAY)], total: 30 };
    };
    const w = await mountSuspended(MusicHistoryPage);
    await flushPromises();
    // A refused removal gives the count back: "Load more" stays.
    await w.find('[aria-label="Remove Song 1 from history"]').trigger('click');
    await flushPromises();
    expect(buttonByText(w, 'Load more')).toBeDefined();
    fail = false;
    await w.find('[aria-label="Remove Song 0 from history"]').trigger('click');
    await flushPromises();
    await buttonByText(w, 'Load more').trigger('click');
    await flushPromises();
    const gets = fetchMock.mock.calls.filter(([u, o]) => u === '/api/music/history' && !o?.method);
    expect(gets[1]![1]).toEqual({ params: { limit: 30, offset: 29 } });
    expect(w.findAll('.mtl-row')).toHaveLength(30);
    expect(headings(w)).toEqual(['Today', 'Yesterday']);
    expect(buttonByText(w, 'Load more')).toBeUndefined();
  });

  it('asks a guest to log in without calling the API', async () => {
    useState<any>('auth_user').value = null;
    const w = await mountSuspended(MusicHistoryPage);
    await flushPromises();
    expect(w.text()).toContain('Log in to see your history');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('/podcasts/history', () => {
  it('lists episodes by day with their progress, without per-row lookups, and plays one', async () => {
    handler = (url) => (url === '/api/podcasts/history' ? { items: [episode(1, TODAY), episode(2, YESTERDAY, true)], total: 2 } : undefined);
    const w = await mountSuspended(PodcastHistoryPage);
    await flushPromises();
    expect(fetchMock.mock.calls.filter(([u]) => u === '/api/podcasts/history')).toEqual([['/api/podcasts/history', { params: { limit: 30, offset: 0 } }]]);
    expect(headings(w)).toEqual(['Today', 'Yesterday']);
    expect(w.findAll('.episode-title').map((t) => t.text())).toEqual(['Episode 1', 'Episode 2']);
    expect(w.findAll('.episode-context').map((t) => t.text())).toEqual(['The Show', 'The Show']);
    expect(w.find('[role="progressbar"]').attributes('aria-valuenow')).toBe('25');
    expect(w.find('.episode-progress-played').exists()).toBe(true);
    expect(fetchMock.mock.calls.some(([u]) => u === '/api/podcasts/episodes/progress/status')).toBe(false);
    expect(w.find('[aria-label="Remove Episode 1 from history"]').attributes('title')).toContain('Also resets the resume position');

    await w.findAll('.episode-play-btn')[0]!.trigger('click');
    expect(usePodcastPlayer().currentEpisode.value?.id).toBe('e1');
  });

  it('removes an episode and its progress, and restores both when the server refuses', async () => {
    let fail = false;
    handler = (url, opts) => {
      if (opts.method === 'DELETE') {
        if (fail) throw new Error('nope');
        return { removed: 1 };
      }
      return url === '/api/podcasts/history' ? { items: [episode(1, TODAY), episode(2, YESTERDAY)], total: 2 } : undefined;
    };
    const w = await mountSuspended(PodcastHistoryPage);
    await flushPromises();
    const store = usePodcastProgress();
    await w.find('[aria-label="Remove Episode 1 from history"]').trigger('click');
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledWith('/api/podcasts/history/e1', { method: 'DELETE' });
    expect(w.findAll('.episode-title').map((t) => t.text())).toEqual(['Episode 2']);
    expect(store.isKnown('e1')).toBe(true);
    expect(store.get('e1')).toBeNull();

    fail = true;
    await w.find('[aria-label="Remove Episode 2 from history"]').trigger('click');
    await flushPromises();
    expect(w.findAll('.episode-title').map((t) => t.text())).toEqual(['Episode 2']);
    expect(store.get('e2')).toMatchObject({ positionSeconds: 250, updatedAt: YESTERDAY });
    expect(toastTypes()).toEqual(['error']);
  });

  it('clears the history after confirming and forgets every cached progress', async () => {
    handler = (url, opts) => {
      if (opts.method === 'DELETE') return { removed: 1 };
      return url === '/api/podcasts/history' ? { items: [episode(1, TODAY)], total: 1 } : undefined;
    };
    const w = await mountSuspended(PodcastHistoryPage);
    await flushPromises();
    const store = usePodcastProgress();
    store.record('other', progress(5));
    await buttonByText(w, 'Clear history').trigger('click');
    expect(w.find('[role="dialog"]').text()).toContain('resume positions');
    await w.find('.confirm-dialog-confirm').trigger('click');
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledWith('/api/podcasts/history', { method: 'DELETE' });
    expect(w.text()).toContain('No listening history yet');
    expect(store.isKnown('e1')).toBe(false);
    expect(store.isKnown('other')).toBe(false);
  });

  it('shows the empty state and pages with Load more', async () => {
    handler = (url, opts) => {
      if (url !== '/api/podcasts/history') return undefined;
      return opts.params.offset === 0 ? { items: [episode(1, TODAY)], total: 2 } : { items: [episode(2, YESTERDAY)], total: 2 };
    };
    const w = await mountSuspended(PodcastHistoryPage);
    await flushPromises();
    await buttonByText(w, 'Load more').trigger('click');
    await flushPromises();
    expect(w.findAll('.episode-title').map((t) => t.text())).toEqual(['Episode 1', 'Episode 2']);
    expect(buttonByText(w, 'Load more')).toBeUndefined();

    handler = () => ({ items: [], total: 0 });
    const empty = await mountSuspended(PodcastHistoryPage);
    await flushPromises();
    expect(empty.text()).toContain('No listening history yet');
  });
});
