import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import DiscoverPage from '../../app/pages/podcasts/discover.vue';
import { usePodcastPlayer } from '../../app/composables/usePodcastPlayer';

const fetchMock = vi.fn();
type Handler = (url: string, opts: any) => any;
let handler: Handler;

const show = (id: string, extra: any = {}) => ({ id, title: `Show ${id}`, episode_count: 3, ...extra });
const episode = (id: string, extra: any = {}) => ({
  id, title: `Episode ${id}`, show_id: 's1', show_title: 'Show s1', duration: 600,
  download_status: 'completed', local_file_path: `/p/${id}.mp3`, listenerCount: 2, ...extra,
});

const FULL: Handler = (url, opts) => {
  const lang = opts?.params?.language;
  if (url === '/api/podcasts/discover/popular') {
    return { shows: lang === 'fr' ? [show('frPop', { followerCount: 1 })] : [show('pop1', { followerCount: 5 }), show('pop2', { followerCount: 1 })] };
  }
  if (url === '/api/podcasts/discover/recently-updated') {
    return { shows: lang === 'fr' ? [] : [show('rec1', { latestEpisodeTitle: 'Latest one', latestEpisodeAt: Date.UTC(2026, 0, 15, 12) })] };
  }
  if (url === '/api/podcasts/discover/trending') return { episodes: [episode('e1', { listenerCount: 3 }), episode('e2', { listenerCount: 1 })] };
  if (url === '/api/podcasts/discover/because-you-follow') return { basedOn: { id: 'mine', title: 'My Show' }, shows: [show('sugg1')] };
  if (url === '/api/podcasts/discover/languages') return { languages: [{ language: 'en', showCount: 4 }, { language: 'fr', showCount: 1 }] };
  if (url === '/api/podcasts/follows/status') return { followed: [] };
  if (url === '/api/podcasts/episodes/progress/status') return { progress: {} };
  return undefined;
};

beforeEach(() => {
  fetchMock.mockReset();
  handler = FULL;
  fetchMock.mockImplementation(async (url: string, opts: any = {}) => handler(url, opts));
  vi.stubGlobal('$fetch', fetchMock);
  useState<any>('auth_user').value = { id: 'u1', username: 'u1', role: 'user' };
  useState('podcast_follows').value = { owner: null, followed: {} };
  useState('podcast_progress').value = { owner: null, progress: {} };
  useState('podcast_player_current_episode').value = null;
});
afterEach(() => vi.unstubAllGlobals());

const called = (url: string) => fetchMock.mock.calls.filter(([u]) => u === url);
const rowTitles = (w: any) => w.findAll('.discover-row-title').map((t: any) => t.text());
const rowShows = (w: any, title: string) => {
  const row = w.findAll('.discover-row').find((r: any) => r.find('.discover-row-title').text() === title);
  return row ? row.findAll('.show-card-title').map((t: any) => t.text()) : [];
};

describe('/podcasts/discover', () => {
  it('shows every row for a logged-in user with counts, latest episode and the follow buttons', async () => {
    const w = await mountSuspended(DiscoverPage);
    await flushPromises();
    expect(rowTitles(w)).toEqual(['Popular with listeners', 'Recently updated', 'Trending episodes', 'Because you follow My Show']);
    expect(rowShows(w, 'Popular with listeners')).toEqual(['Show pop1', 'Show pop2']);
    expect(w.findAll('.show-card-detail').map((d) => d.text()).slice(0, 3)).toEqual(['5 followers', '1 follower', 'Latest one · Jan 15, 2026']);
    expect(w.findAll('.episode-context').map((c) => c.text())).toEqual(['Show s1 · 3 listeners', 'Show s1 · 1 listener']);
    expect(w.findAll('.show-follow-btn').length).toBe(4);
    expect(w.findAll('.language-chip').map((c) => c.text())).toEqual(['All', 'en 4', 'fr 1']);

    await w.find('.episode-play-btn').trigger('click');
    expect(usePodcastPlayer().currentEpisode.value?.id).toBe('e1');
  });

  it('filters the popular and recently updated rows by language in place, and All clears it', async () => {
    const w = await mountSuspended(DiscoverPage);
    await flushPromises();
    await w.findAll('.language-chip')[2]!.trigger('click');
    await flushPromises();
    expect(called('/api/podcasts/discover/popular').at(-1)![1]).toEqual({ params: { limit: 20, language: 'fr' } });
    expect(called('/api/podcasts/discover/recently-updated').at(-1)![1]).toEqual({ params: { limit: 20, language: 'fr' } });
    expect(rowShows(w, 'Popular with listeners')).toEqual(['Show frPop']);
    expect(rowTitles(w)).not.toContain('Recently updated');
    // The other rows are not filtered and not asked again.
    expect(rowTitles(w)).toContain('Trending episodes');
    expect(called('/api/podcasts/discover/trending')).toHaveLength(1);
    expect(w.findAll('.language-chip')[2]!.attributes('aria-pressed')).toBe('true');

    await w.findAll('.language-chip')[0]!.trigger('click');
    await flushPromises();
    expect(called('/api/podcasts/discover/popular').at(-1)![1]).toEqual({ params: { limit: 20 } });
    expect(rowShows(w, 'Popular with listeners')).toEqual(['Show pop1', 'Show pop2']);
  });

  it('tells when a language has no shows in the filtered rows', async () => {
    handler = (url, opts) => (opts?.params?.language && url.includes('/discover/') ? { shows: [] } : FULL(url, opts));
    const w = await mountSuspended(DiscoverPage);
    await flushPromises();
    await w.findAll('.language-chip')[1]!.trigger('click');
    await flushPromises();
    expect(w.text()).toContain('No shows in this language yet.');
  });

  it('shows guests the shared rows only and never asks for suggestions', async () => {
    useState<any>('auth_user').value = null;
    const w = await mountSuspended(DiscoverPage);
    await flushPromises();
    expect(rowTitles(w)).toEqual(['Popular with listeners', 'Recently updated', 'Trending episodes']);
    expect(called('/api/podcasts/discover/because-you-follow')).toHaveLength(0);
    expect(w.findAll('.show-follow-btn')).toHaveLength(0);
  });

  it('omits empty rows and shows the empty state when there is nothing at all', async () => {
    handler = (url) => {
      if (url === '/api/podcasts/discover/trending') return { episodes: [] };
      if (url === '/api/podcasts/discover/because-you-follow') return { basedOn: { id: 'm', title: 'M' }, shows: [] };
      if (url === '/api/podcasts/discover/languages') return { languages: [] };
      if (url === '/api/podcasts/discover/popular') throw new Error('down');
      if (url.startsWith('/api/podcasts/discover/')) return { shows: [] };
      return undefined;
    };
    const w = await mountSuspended(DiscoverPage);
    await flushPromises();
    expect(rowTitles(w)).toEqual([]);
    expect(w.find('.language-chips').exists()).toBe(false);
    expect(w.text()).toContain('Nothing to discover yet');
  });
});
