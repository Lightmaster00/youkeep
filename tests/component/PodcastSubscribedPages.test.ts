import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import SubscribedPage from '../../app/pages/podcasts/subscribed.vue';
import LibraryPage from '../../app/pages/podcasts/index.vue';
import { usePodcastPlayer } from '../../app/composables/usePodcastPlayer';

const fetchMock = vi.fn();
type Handler = (url: string, opts: any) => any;
let handler: Handler;

const episode = (i: number, progress: any = null) => ({
  id: `e${i}`, title: `Episode ${i}`, show_id: 's1', show_title: 'Show', duration: 1000, local_file_path: `/p/e${i}`, progress,
});
const show = (id: string, newCount = 0) => ({ id, title: `Show ${id}`, episode_count: 4, newCount, followedAt: 1 });

beforeEach(() => {
  fetchMock.mockReset();
  handler = () => undefined;
  fetchMock.mockImplementation(async (url: string, opts: any = {}) => handler(url, opts));
  vi.stubGlobal('$fetch', fetchMock);
  useState<any>('auth_user').value = { id: 'u1', username: 'u1', role: 'user' };
  useState('podcast_follows').value = { owner: null, followed: {} };
  useState('podcast_progress').value = { owner: null, progress: {} };
  useState('podcast_player_current_episode').value = null;
});
afterEach(() => vi.unstubAllGlobals());

const called = (url: string) => fetchMock.mock.calls.filter(([u]) => u === url);

describe('/podcasts/subscribed', () => {
  it('shows followed shows with their new counts, continue listening and the latest episodes', async () => {
    handler = (url) => {
      if (url === '/api/podcasts/follows') return [show('s1', 3), show('s2')];
      if (url === '/api/podcasts/continue') return { items: [episode(9, { positionSeconds: 500, durationSeconds: 1000, completed: false, updatedAt: 1 })] };
      if (url === '/api/podcasts/subscribed-episodes') return { items: [episode(1), episode(2)], total: 3 };
      return undefined;
    };
    const w = await mountSuspended(SubscribedPage);
    await flushPromises();
    expect(w.findAll('.show-card-title').map((t) => t.text())).toEqual(['Show s1', 'Show s2']);
    expect(w.findAll('.show-card-new').map((b) => b.text())).toEqual(['3 new']);
    // Known from the lists: no status lookups.
    expect(called('/api/podcasts/follows/status')).toHaveLength(0);
    expect(called('/api/podcasts/episodes/progress/status')).toHaveLength(0);
    expect(w.findAll('.show-follow-btn').map((b) => b.text())).toEqual(['Following', 'Following']);
    const continueRow = w.find('.continue-row');
    expect(continueRow.find('[role="progressbar"]').attributes('aria-valuenow')).toBe('50');
    expect(called('/api/podcasts/subscribed-episodes')[0]![1]).toEqual({ params: { limit: 30, offset: 0 } });
    const latest = w.findAll('.media-grid .media-card');
    expect(latest).toHaveLength(2);
    expect(w.findAll('button').some((b) => b.text() === 'Load more')).toBe(true);

    await latest[1]!.trigger('click');
    expect(usePodcastPlayer().currentEpisode.value?.id).toBe('e2');

    // Unfollowing drops the show at once.
    await w.findAll('.show-follow-btn')[1]!.trigger('click');
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledWith('/api/podcasts/shows/s2/follow', { method: 'DELETE' });
    expect(w.findAll('.show-card-title').map((t) => t.text())).toEqual(['Show s1']);
  });

  it('shows the empty states', async () => {
    handler = (url) => {
      if (url === '/api/podcasts/follows') return [];
      if (url === '/api/podcasts/continue') return { items: [] };
      if (url === '/api/podcasts/subscribed-episodes') return { items: [], total: 0 };
      return undefined;
    };
    const w = await mountSuspended(SubscribedPage);
    await flushPromises();
    expect(w.text()).toContain('You are not following any show yet');
    expect(w.text()).toContain('Nothing in progress');
  });

  it('asks nothing for a guest', async () => {
    useState<any>('auth_user').value = null;
    const w = await mountSuspended(SubscribedPage);
    await flushPromises();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(w.text()).toContain('Log in to follow shows');
  });
});

describe('Continue listening on the Podcasts library', () => {
  it('appears above the shows for a logged-in user with something in progress', async () => {
    handler = (url) => {
      if (url === '/api/podcasts/shows') return { shows: [show('s1')] };
      if (url === '/api/podcasts/continue') return { items: [episode(5, { positionSeconds: 100, durationSeconds: 1000, completed: false, updatedAt: 1 })] };
      if (url === '/api/podcasts/follows/status') return { followed: [] };
      return undefined;
    };
    const w = await mountSuspended(LibraryPage);
    await flushPromises();
    expect(w.find('.continue-row .media-card-title').text()).toBe('Episode 5');
    expect(w.findAll('.show-card')).toHaveLength(1);
  });

  it('is hidden when nothing is in progress, and never fetched for a guest', async () => {
    handler = (url) => {
      if (url === '/api/podcasts/shows') return { shows: [] };
      if (url === '/api/podcasts/continue') return { items: [] };
      return undefined;
    };
    const w = await mountSuspended(LibraryPage);
    await flushPromises();
    expect(w.find('.continue-row').exists()).toBe(false);

    useState<any>('auth_user').value = null;
    fetchMock.mockClear();
    await mountSuspended(LibraryPage);
    await flushPromises();
    expect(called('/api/podcasts/continue')).toHaveLength(0);
  });
});
