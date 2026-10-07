import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { defineComponent, h } from 'vue';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import ShowFollowButton from '../../app/components/ShowFollowButton.vue';
import PodcastShowCard from '../../app/components/PodcastShowCard.vue';
import { useToast } from '../../app/composables/useToast';

const fetchMock = vi.fn();
let followed: string[] = [];

function login(id: string | null) {
  useState<any>('auth_user').value = id ? { id, username: id, role: 'user' } : null;
}

beforeEach(() => {
  fetchMock.mockReset();
  followed = ['s2'];
  fetchMock.mockImplementation(async (url: string, opts: any) => {
    if (url === '/api/podcasts/follows/status') return { followed: opts.body.ids.filter((id: string) => followed.includes(id)) };
    return {};
  });
  vi.stubGlobal('$fetch', fetchMock);
  useState('podcast_follows').value = { owner: null, followed: {} };
  useToast().toasts.value.splice(0);
  login('u1');
});
afterEach(() => vi.unstubAllGlobals());

const List = defineComponent({
  props: { ids: { type: Array as () => string[], required: true } },
  setup: (props) => () => h('div', props.ids.map((id) => h(ShowFollowButton, { showId: id, key: id }))),
});
const statusCalls = () => fetchMock.mock.calls.filter(([url]) => url === '/api/podcasts/follows/status');

describe('ShowFollowButton', () => {
  it('loads the states of a whole grid in one status call and caches them', async () => {
    const w = await mountSuspended(List, { props: { ids: ['s1', 's2', 's3'] } });
    await flushPromises();
    expect(statusCalls()).toHaveLength(1);
    expect(statusCalls()[0]![1]).toEqual({ method: 'POST', body: { ids: ['s1', 's2', 's3'] } });
    expect(w.findAll('button').map((b) => b.text())).toEqual(['Follow', 'Following', 'Follow']);
    await mountSuspended(List, { props: { ids: ['s2', 's3'] } });
    await flushPromises();
    expect(statusCalls()).toHaveLength(1);
  });

  it('follows optimistically, then unfollows, with the matching requests', async () => {
    let resolvePut: () => void = () => {};
    fetchMock.mockImplementation(async (url: string, opts: any) => {
      if (url === '/api/podcasts/follows/status') return { followed: [] };
      if (opts?.method === 'PUT') return new Promise<void>((r) => { resolvePut = r; });
      return {};
    });
    const w = await mountSuspended(ShowFollowButton, { props: { showId: 's1', showTitle: 'Tech Talk' } });
    await flushPromises();
    const btn = w.find('button');
    expect(btn.attributes('aria-label')).toBe('Follow Tech Talk');
    await btn.trigger('click');
    expect(btn.attributes('aria-pressed')).toBe('true'); // before the server answered
    expect(fetchMock).toHaveBeenCalledWith('/api/podcasts/shows/s1/follow', { method: 'PUT' });
    resolvePut();
    await flushPromises();
    expect(btn.text()).toBe('Following');
    await btn.trigger('click');
    await flushPromises();
    expect(fetchMock).toHaveBeenLastCalledWith('/api/podcasts/shows/s1/follow', { method: 'DELETE' });
    expect(btn.attributes('aria-pressed')).toBe('false');
  });

  it('rolls back and shows a toast when the server refuses', async () => {
    let reject: (e: Error) => void = () => {};
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/podcasts/follows/status') return { followed: [] };
      return new Promise((_, r) => { reject = r; });
    });
    const w = await mountSuspended(ShowFollowButton, { props: { showId: 's1' } });
    await flushPromises();
    await w.find('button').trigger('click');
    expect(w.find('button').attributes('aria-pressed')).toBe('true');
    reject(new Error('boom'));
    await flushPromises();
    expect(w.find('button').attributes('aria-pressed')).toBe('false');
    expect(useToast().toasts.value.map((t) => [t.type, t.message])).toEqual([['error', 'Could not follow the show.']]);
  });

  it('renders nothing and asks nothing for a guest', async () => {
    login(null);
    const w = await mountSuspended(ShowFollowButton, { props: { showId: 's1' } });
    await flushPromises();
    expect(w.find('button').exists()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('drops the cache when another user logs in', async () => {
    await mountSuspended(ShowFollowButton, { props: { showId: 's2' } });
    await flushPromises();
    login('u2');
    followed = [];
    const w = await mountSuspended(ShowFollowButton, { props: { showId: 's2' } });
    await flushPromises();
    expect(statusCalls()).toHaveLength(2);
    expect(w.find('button').attributes('aria-pressed')).toBe('false');
  });

  it('does not open the show when clicked on a show card', async () => {
    const w = await mountSuspended(PodcastShowCard, { props: { show: { id: 's1', title: 'A', episode_count: 3 }, newCount: 2 } });
    await flushPromises();
    const router = useRouter();
    const push = vi.spyOn(router, 'push');
    await w.find('.show-follow-btn').trigger('click');
    expect(push).not.toHaveBeenCalled();
    expect(w.find('.show-card-new').text()).toBe('2 new');
    await w.find('.show-card').trigger('click');
    expect(push).toHaveBeenCalledWith({ path: '/podcasts', query: { showId: 's1' } });
  });
});
