import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { defineComponent, h } from 'vue';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import TrackLikeButton from '../../app/components/TrackLikeButton.vue';
import { useToast } from '../../app/composables/useToast';

const fetchMock = vi.fn();
let liked: string[] = [];

function login(id: string | null) {
  useState<any>('auth_user').value = id ? { id, username: id, role: 'user' } : null;
}

beforeEach(() => {
  fetchMock.mockReset();
  liked = ['t2'];
  fetchMock.mockImplementation(async (url: string, opts: any) => {
    if (url === '/api/music/favorites/status') return { liked: opts.body.ids.filter((id: string) => liked.includes(id)) };
    return {};
  });
  vi.stubGlobal('$fetch', fetchMock);
  useState('music_likes').value = { owner: null, liked: {} };
  useToast().toasts.value.splice(0);
  login('u1');
});
afterEach(() => vi.unstubAllGlobals());

const List = defineComponent({
  props: { ids: { type: Array as () => string[], required: true } },
  setup: (props) => () => h('div', props.ids.map((id) => h(TrackLikeButton, { trackId: id, key: id }))),
});

const statusCalls = () => fetchMock.mock.calls.filter(([url]) => url === '/api/music/favorites/status');

describe('TrackLikeButton', () => {
  it('loads the states of a whole rendered list in one status call', async () => {
    const w = await mountSuspended(List, { props: { ids: ['t1', 't2', 't3'] } });
    await flushPromises();
    expect(statusCalls()).toHaveLength(1);
    expect(statusCalls()[0]![1]).toEqual({ method: 'POST', body: { ids: ['t1', 't2', 't3'] } });
    expect(w.findAll('button').map((b) => b.attributes('aria-pressed'))).toEqual(['false', 'true', 'false']);

    // Cached for the session: mounting the same tracks again asks nothing.
    await mountSuspended(List, { props: { ids: ['t2', 't3'] } });
    await flushPromises();
    expect(statusCalls()).toHaveLength(1);
  });

  it('likes optimistically and unlikes with the matching requests', async () => {
    let resolvePut: () => void = () => {};
    fetchMock.mockImplementation(async (url: string, opts: any) => {
      if (url === '/api/music/favorites/status') return { liked: [] };
      if (opts?.method === 'PUT') return new Promise<void>((r) => { resolvePut = r; });
      return {};
    });
    const w = await mountSuspended(TrackLikeButton, { props: { trackId: 't1' } });
    await flushPromises();
    const btn = w.find('button');
    expect(btn.attributes('aria-label')).toBe('Add to Liked songs');
    await btn.trigger('click');
    // Flipped before the server answered.
    expect(btn.attributes('aria-pressed')).toBe('true');
    expect(fetchMock).toHaveBeenCalledWith('/api/music/favorites/t1', { method: 'PUT' });
    resolvePut();
    await flushPromises();
    expect(btn.attributes('aria-pressed')).toBe('true');
    expect(btn.attributes('aria-label')).toBe('Remove from Liked songs');
    await btn.trigger('click');
    await flushPromises();
    expect(fetchMock).toHaveBeenLastCalledWith('/api/music/favorites/t1', { method: 'DELETE' });
    expect(btn.attributes('aria-pressed')).toBe('false');
  });

  it('rolls back and shows a toast when the server refuses', async () => {
    let reject: (e: Error) => void = () => {};
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/music/favorites/status') return { liked: ['t2'] };
      return new Promise((_, r) => { reject = r; });
    });
    const w = await mountSuspended(TrackLikeButton, { props: { trackId: 't2' } });
    await flushPromises();
    expect(w.find('button').attributes('aria-pressed')).toBe('true');
    await w.find('button').trigger('click');
    expect(w.find('button').attributes('aria-pressed')).toBe('false');
    reject(new Error('boom'));
    await flushPromises();
    expect(w.find('button').attributes('aria-pressed')).toBe('true');
    expect(useToast().toasts.value.map((t) => [t.type, t.message])).toEqual([['error', 'Could not remove the song from Liked songs.']]);
  });

  it('renders nothing and asks nothing for a guest', async () => {
    login(null);
    const w = await mountSuspended(TrackLikeButton, { props: { trackId: 't1' } });
    await flushPromises();
    expect(w.find('button').exists()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('drops the cache when another user logs in', async () => {
    await mountSuspended(TrackLikeButton, { props: { trackId: 't2' } });
    await flushPromises();
    login('u2');
    liked = [];
    const w = await mountSuspended(TrackLikeButton, { props: { trackId: 't2' } });
    await flushPromises();
    expect(statusCalls()).toHaveLength(2);
    expect(w.find('button').attributes('aria-pressed')).toBe('false');
  });
});
