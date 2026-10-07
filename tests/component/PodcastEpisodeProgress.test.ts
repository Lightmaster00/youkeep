import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { defineComponent, h } from 'vue';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import PodcastEpisodeRow from '../../app/components/PodcastEpisodeRow.vue';
import PodcastEpisodeCard from '../../app/components/PodcastEpisodeCard.vue';
import { useToast } from '../../app/composables/useToast';

const fetchMock = vi.fn();
let progress: Record<string, any> = {};

function login(id: string | null) {
  useState<any>('auth_user').value = id ? { id, username: id, role: 'user' } : null;
}

const ep = (id: string, extra: any = {}) => ({
  id, title: `Episode ${id}`, duration: 1000, download_status: 'completed', local_file_path: `/p/${id}`, ...extra,
});

beforeEach(() => {
  fetchMock.mockReset();
  progress = {
    e1: { positionSeconds: 250, durationSeconds: 1000, completed: false, updatedAt: 1 },
    e2: { positionSeconds: 1000, durationSeconds: 1000, completed: true, updatedAt: 1 },
  };
  fetchMock.mockImplementation(async (url: string, opts: any) => {
    if (url === '/api/podcasts/episodes/progress/status') {
      return { progress: Object.fromEntries(opts.body.ids.filter((id: string) => progress[id]).map((id: string) => [id, progress[id]])) };
    }
    return {};
  });
  vi.stubGlobal('$fetch', fetchMock);
  useState('podcast_progress').value = { owner: null, progress: {} };
  useToast().toasts.value.splice(0);
  login('u1');
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

const Rows = defineComponent({
  props: { eps: { type: Array as () => any[], required: true } },
  setup: (props) => () => h('div', props.eps.map((e) => h(PodcastEpisodeRow, { episode: e, key: e.id }))),
});
const statusCalls = () => fetchMock.mock.calls.filter(([url]) => url === '/api/podcasts/episodes/progress/status');
const menuItem = () => document.body.querySelector<HTMLButtonElement>('.episode-menu-item');

describe('episode progress and "Mark as played"', () => {
  it('shows a progress bar or a Played mark from one batched status call', async () => {
    const w = await mountSuspended(Rows, { props: { eps: [ep('e1'), ep('e2'), ep('e3')] } });
    await flushPromises();
    expect(statusCalls()).toHaveLength(1);
    expect(statusCalls()[0]![1]).toEqual({ method: 'POST', body: { ids: ['e1', 'e2', 'e3'] } });
    const rows = w.findAll('.episode-row');
    expect(rows[0]!.find('[role="progressbar"]').attributes('aria-valuenow')).toBe('25');
    expect(rows[0]!.find('.episode-progress-fill').attributes('style')).toContain('width: 25%');
    expect(rows[1]!.find('.episode-progress-played').text()).toBe('Played');
    expect(rows[2]!.find('.episode-progress').exists()).toBe(false);
  });

  it('marks as played optimistically and back to unplayed', async () => {
    let resolvePut: (v: any) => void = () => {};
    fetchMock.mockImplementation(async (url: string, opts: any) => {
      if (url === '/api/podcasts/episodes/progress/status') return { progress: { e1: progress.e1 } };
      if (opts?.method === 'PUT') return new Promise((r) => { resolvePut = r; });
      return {};
    });
    const w = await mountSuspended(PodcastEpisodeRow, { props: { episode: ep('e1') }, attachTo: document.body });
    await flushPromises();
    await w.find('.episode-menu-btn').trigger('click');
    expect(menuItem()!.textContent!.trim()).toBe('Mark as played');
    menuItem()!.click();
    await flushPromises();
    expect(fetchMock).toHaveBeenLastCalledWith('/api/podcasts/episodes/e1/played', { method: 'PUT', body: { played: true } });
    expect(w.find('.episode-progress-played').exists()).toBe(true); // before the server answered
    resolvePut({ played: true, progress: { positionSeconds: 1000, durationSeconds: 1000, completed: true, updatedAt: 2 } });
    await flushPromises();
    expect(w.find('.episode-progress-played').exists()).toBe(true);

    fetchMock.mockImplementation(async () => ({ played: false, progress: null }));
    await w.find('.episode-menu-btn').trigger('click');
    expect(menuItem()!.textContent!.trim()).toBe('Mark as unplayed');
    menuItem()!.click();
    await flushPromises();
    expect(fetchMock).toHaveBeenLastCalledWith('/api/podcasts/episodes/e1/played', { method: 'PUT', body: { played: false } });
    expect(w.find('.episode-progress').exists()).toBe(false);
  });

  it('rolls back with a toast when marking fails', async () => {
    let reject: (e: Error) => void = () => {};
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/podcasts/episodes/progress/status') return { progress: { e1: progress.e1 } };
      return new Promise((_, r) => { reject = r; });
    });
    const w = await mountSuspended(PodcastEpisodeRow, { props: { episode: ep('e1') }, attachTo: document.body });
    await flushPromises();
    await w.find('.episode-menu-btn').trigger('click');
    menuItem()!.click();
    await flushPromises();
    expect(w.find('.episode-progress-played').exists()).toBe(true);
    reject(new Error('boom'));
    await flushPromises();
    expect(w.find('.episode-progress-played').exists()).toBe(false);
    expect(w.find('[role="progressbar"]').attributes('aria-valuenow')).toBe('25');
    expect(useToast().toasts.value.map((t) => [t.type, t.message])).toEqual([['error', 'Could not mark the episode as played.']]);
  });

  it('shows no menu or progress and asks nothing for a guest, nor a menu for an unplayable episode', async () => {
    login(null);
    const w = await mountSuspended(PodcastEpisodeRow, { props: { episode: ep('e1') } });
    await flushPromises();
    expect(w.find('.episode-menu-btn').exists()).toBe(false);
    expect(w.find('.episode-progress').exists()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    login('u1');
    const pending = await mountSuspended(PodcastEpisodeRow, { props: { episode: ep('e9', { download_status: 'pending', local_file_path: null }) } });
    expect(pending.find('.episode-menu-btn').exists()).toBe(false);
  });

  it('shows progress on episode cards and the menu only with showActions', async () => {
    const plain = await mountSuspended(PodcastEpisodeCard, { props: { episode: ep('e1') } });
    await flushPromises();
    expect(plain.find('[role="progressbar"]').exists()).toBe(true);
    expect(plain.find('.episode-menu-btn').exists()).toBe(false);
    const withActions = await mountSuspended(PodcastEpisodeCard, { props: { episode: ep('e1'), showActions: true } });
    const emitted = withActions.emitted('play');
    await withActions.find('.episode-menu-btn').trigger('click');
    expect(emitted).toBeUndefined(); // the menu never plays the episode
  });
});
