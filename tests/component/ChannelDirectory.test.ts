import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import ChannelsPage from '../../app/pages/channels.vue';
import { useToast } from '../../app/composables/useToast';

// The channels directory: category chips with counts, search/sort/following
// filters synced with the URL, Discover strip, paging, empty state and the
// optimistic Subscribe button.

const channel = (id: string, extra: object = {}) => ({
  id, title: `Channel ${id}`, avatar_url: null, completed_count: 3, total_count: 3,
  categories: ['Gaming'], subscribed: false, new_count: 0, ...extra,
});

let fetchMock: ReturnType<typeof vi.fn>;
let listAnswer: (params: any) => any;
let subscribeAnswer: () => Promise<any>;

beforeEach(async () => {
  // Start every test from a clean route (a replace from the previous test may still be settling).
  await flushPromises();
  await useRouter().replace('/channels');
  clearNuxtData();
  useToast().toasts.value.splice(0);
  useState('auth_loading').value = false;
  useState('modules').value = { video: true, music: true, podcasts: true };
  useState('modules_loaded').value = true;
  useState('display_prefs_for').value = 'u1';
  useState<any>('auth_user').value = null;
  listAnswer = () => ({ channels: [channel('a'), channel('b', { categories: ['Music'] })], total: 2 });
  subscribeAnswer = async () => ({ success: true });
  fetchMock = vi.fn(async (url: string, opts: any = {}) => {
    if (url === '/api/channels' && opts.params?.page) return listAnswer(opts.params);
    if (url === '/api/channels') return { channels: [] };
    if (url === '/api/channels/categories') return { categories: [{ name: 'Gaming', count: 5 }, { name: 'Music', count: 2 }] };
    if (url === '/api/channels/discover') return { channels: [channel('d', { reason: 'Because you watch Gaming', video_count: 4 })] };
    if (/\/(un)?subscribe$/.test(url)) return subscribeAnswer();
    return {};
  });
  vi.stubGlobal('$fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  useState('auth_user').value = null;
});

const signIn = () => { useState<any>('auth_user').value = { id: 'u1', username: 'alice', role: 'user' }; };
const listCalls = () => fetchMock.mock.calls.filter(([u, o]) => u === '/api/channels' && o?.params?.page).map(([, o]) => o.params);
const lastList = () => listCalls().at(-1);
const currentQuery = () => useRouter().currentRoute.value.query;
const mountDirectory = async (query: Record<string, string> = {}) => {
  const w = await mountSuspended(ChannelsPage, { route: { path: '/channels', query } });
  await flushPromises();
  return w;
};

describe('category chips', () => {
  it('shows "All" and each category with its count; "All" is pressed without a filter', async () => {
    const w = await mountDirectory();
    const bar = w.find('[data-testid="category-bar"]');
    expect(bar.text()).toContain('All');
    expect(w.find('[data-testid="category-chip-Gaming"]').text()).toContain('5');
    expect(w.find('[data-testid="category-chip-all"]').attributes('aria-pressed')).toBe('true');
    expect(w.find('[data-testid="category-chip-Gaming"]').attributes('aria-pressed')).toBe('false');
    w.unmount();
  });

  it('clicking a chip puts it in the URL and reloads the list with it; clicking it again clears it', async () => {
    const w = await mountDirectory();
    await w.find('[data-testid="category-bar"] [data-testid="category-chip-Music"]').trigger('click');
    await flushPromises();
    await vi.waitFor(() => expect(currentQuery().category).toBe('Music'));
    expect(lastList()).toMatchObject({ category: 'Music', page: 1, limit: 48 });
    expect(w.find('[data-testid="category-bar"] [data-testid="category-chip-Music"]').attributes('aria-pressed')).toBe('true');
    await w.find('[data-testid="category-bar"] [data-testid="category-chip-Music"]').trigger('click');
    await flushPromises();
    await vi.waitFor(() => expect(currentQuery().category).toBeUndefined());
    expect(lastList()).not.toHaveProperty('category');
    w.unmount();
  });

  it('a category chip on a card filters by that category', async () => {
    const w = await mountDirectory();
    await w.find('[data-testid="dir-channel-b"] [data-testid="category-chip-Music"]').trigger('click');
    await flushPromises();
    await vi.waitFor(() => expect(currentQuery().category).toBe('Music'));
    // Navigation to the channel did not happen.
    await vi.waitFor(() => expect(currentQuery().channelId).toBeUndefined());
    w.unmount();
  });
});

describe('URL-synced filters', () => {
  it('reads category, q, sort and following from the URL on load (reload keeps them)', async () => {
    signIn();
    const w = await mountDirectory({ category: 'Gaming', q: 'cats', sort: 'videos', following: '1' });
    expect(listCalls()[0]).toEqual({ category: 'Gaming', q: 'cats', sort: 'videos', following: '1', page: 1, limit: 48 });
    expect((w.find('[data-testid="dir-sort"]').element as HTMLSelectElement).value).toBe('videos');
    expect((w.find('[data-testid="dir-following"]').element as HTMLSelectElement).value).toBe('1');
    expect((w.find('[data-testid="dir-search"]').element as HTMLInputElement).value).toBe('cats');
    w.unmount();
  });

  it('never sends invalid URL values, nor the following/watched filters for guests', async () => {
    const w = await mountDirectory({ sort: 'watched', following: '1' });
    expect(listCalls()[0]).toEqual({ page: 1, limit: 48 });
    expect(w.find('[data-testid="dir-following"]').exists()).toBe(false);
    expect(w.find('[data-testid="dir-sort"] option[value="watched"]').exists()).toBe(false);
    w.unmount();
    clearNuxtData();
    const w2 = await mountDirectory({ sort: 'bogus' });
    expect(listCalls().at(-1)).toEqual({ page: 1, limit: 48 });
    w2.unmount();
  });

  it('the sort and following selects write the URL', async () => {
    signIn();
    const w = await mountDirectory();
    await w.find('[data-testid="dir-sort"]').setValue('recent');
    await flushPromises();
    await vi.waitFor(() => expect(currentQuery().sort).toBe('recent'));
    expect(lastList()).toMatchObject({ sort: 'recent' });
    await w.find('[data-testid="dir-following"]').setValue('0');
    await flushPromises();
    await vi.waitFor(() => expect(currentQuery().following).toBe('0'));
    expect(lastList()).toMatchObject({ sort: 'recent', following: '0' });
    w.unmount();
  });

  it('the search box writes ?q= after a pause, and at once on Enter', async () => {
    vi.useFakeTimers();
    const w = await mountDirectory();
    await w.find('[data-testid="dir-search"]').setValue('gam');
    vi.advanceTimersByTime(100);
    await flushPromises();
    await vi.waitFor(() => expect(currentQuery().q).toBeUndefined());
    vi.advanceTimersByTime(300);
    await flushPromises();
    await vi.waitFor(() => expect(currentQuery().q).toBe('gam'));
    expect(lastList()).toMatchObject({ q: 'gam' });
    await w.find('[data-testid="dir-search"]').setValue('gaming');
    await w.find('form[role="search"]').trigger('submit');
    await flushPromises();
    await vi.waitFor(() => expect(currentQuery().q).toBe('gaming'));
    w.unmount();
  });
});

describe('empty state', () => {
  it('"No channels match these filters" with a Clear filters button that empties the URL filters', async () => {
    listAnswer = (p) => (p.category ? { channels: [], total: 0 } : { channels: [channel('a')], total: 1 });
    const w = await mountDirectory({ category: 'Nothing', q: 'zzz', sort: 'videos' });
    const empty = w.find('[data-testid="dir-no-match"]');
    expect(empty.text()).toContain('No channels match these filters');
    await empty.find('button').trigger('click');
    await flushPromises();
    await vi.waitFor(() => expect(currentQuery()).toEqual({ sort: 'videos' }));
    expect(w.find('[data-testid="dir-channel-a"]').exists()).toBe(true);
    w.unmount();
  });
});

describe('paging', () => {
  it('"Show more" loads the next page and disappears at the end', async () => {
    listAnswer = (p) => ({
      channels: Array.from({ length: p.page === 1 ? 48 : 2 }, (_, i) => channel(`p${p.page}-${i}`)),
      total: 50,
    });
    const w = await mountDirectory();
    expect(w.findAll('[data-testid^="dir-channel-p"]')).toHaveLength(48);
    await w.find('[data-testid="dir-show-more"]').trigger('click');
    await flushPromises();
    expect(lastList()).toMatchObject({ page: 2, limit: 48 });
    expect(w.findAll('[data-testid^="dir-channel-p"]')).toHaveLength(50);
    expect(w.find('[data-testid="dir-show-more"]').exists()).toBe(false);
    w.unmount();
  });
});

describe('Discover strip', () => {
  it('shows unfollowed channels with their reason to a signed-in viewer without filters', async () => {
    signIn();
    const w = await mountDirectory();
    const strip = w.find('[data-testid="dir-discover"]');
    expect(strip.exists()).toBe(true);
    expect(strip.text()).toContain('Because you watch Gaming');
    w.unmount();
  });

  it('is hidden while a filter is active, and for guests', async () => {
    signIn();
    const w = await mountDirectory({ category: 'Gaming' });
    expect(w.find('[data-testid="dir-discover"]').exists()).toBe(false);
    w.unmount();
    useState('auth_user').value = null;
    clearNuxtData();
    fetchMock.mockClear();
    const w2 = await mountDirectory();
    expect(w2.find('[data-testid="dir-discover"]').exists()).toBe(false);
    expect(fetchMock.mock.calls.some(([u]) => u === '/api/channels/discover')).toBe(false);
    w2.unmount();
  });
});

describe('Subscribe button', () => {
  it('flips to Following at once, and back with an error toast when the server refuses', async () => {
    signIn();
    let reject!: (e: any) => void;
    subscribeAnswer = () => new Promise((_, r) => { reject = r; });
    const w = await mountDirectory({ category: 'Gaming' });
    const button = () => w.find('[data-testid="dir-channel-a"] [data-testid="dir-channel-subscribe"]');
    expect(button().text()).toBe('Subscribe');
    await button().trigger('click');
    expect(button().text()).toBe('Following');
    expect(button().attributes('aria-pressed')).toBe('true');
    expect(fetchMock).toHaveBeenCalledWith('/api/channels/a/subscribe', { method: 'POST' });
    reject({ data: { statusMessage: 'Channel not found.' } });
    await flushPromises();
    expect(button().text()).toBe('Subscribe');
    expect(useToast().toasts.value.some((t) => t.type === 'error' && t.message === 'Channel not found.')).toBe(true);
    w.unmount();
  });

  it('a followed channel shows Following and its "N new" badge; guests get no button', async () => {
    signIn();
    listAnswer = () => ({ channels: [channel('a', { subscribed: true, new_count: 3 })], total: 1 });
    const w = await mountDirectory({ category: 'Gaming' });
    expect(w.find('[data-testid="dir-channel-subscribe"]').text()).toBe('Following');
    expect(w.find('[data-testid="dir-channel-new"]').text()).toBe('3 new');
    w.unmount();
    useState('auth_user').value = null;
    clearNuxtData();
    const w2 = await mountDirectory();
    expect(w2.find('[data-testid="dir-channel-subscribe"]').exists()).toBe(false);
    w2.unmount();
  });
});

describe('in French', () => {
  afterEach(async () => { await useNuxtApp().$i18n.setLocale('en'); });

  it('translates category chips, the discover reason and unknown names stay raw, filters keep the English value', async () => {
    await useNuxtApp().$i18n.setLocale('fr');
    signIn();
    listAnswer = () => ({ channels: [channel('a', { categories: ['Science & Technology', 'Cooking Mastery'] })], total: 1 });
    fetchMock.mockImplementation(async (url: string, opts: any = {}) => {
      if (url === '/api/channels' && opts.params?.page) return listAnswer(opts.params);
      if (url === '/api/channels/categories') return { categories: [{ name: 'Gaming', count: 5 }, { name: 'Science & Technology', count: 2 }] };
      if (url === '/api/channels/discover') return { channels: [
        channel('d', { reason: 'Because you watch Gaming', reasonKind: 'because-watch', reasonParams: { name: 'Gaming' }, video_count: 4 }),
        channel('e', { reason: 'Popular in the library', reasonKind: 'popular', reasonParams: {}, video_count: 2 }),
        channel('f', { reason: 'Something new', reasonKind: 'brand-new-kind', video_count: 1 }),
      ] };
      return {};
    });
    const w = await mountDirectory();
    expect(w.find('[data-testid="category-bar"] [data-testid="category-chip-Gaming"]').text()).toContain('Jeux vidéo');
    expect(w.find('[data-testid="category-bar"] [data-testid="category-chip-Science & Technology"]').text()).toContain('Science et technologie');
    expect(w.find('[data-testid="dir-channel-a"]').text()).toContain('Cooking Mastery');
    expect(w.find('[data-testid="dir-channel-d"] .dir-card__reason').text()).toBe('Parce que vous regardez Jeux vidéo');
    expect(w.find('[data-testid="dir-channel-e"] .dir-card__reason').text()).toBe('Populaire dans la bibliothèque');
    expect(w.find('[data-testid="dir-channel-f"] .dir-card__reason').text()).toBe('Something new');
    await w.find('[data-testid="category-bar"] [data-testid="category-chip-Gaming"]').trigger('click');
    await flushPromises();
    await vi.waitFor(() => expect(currentQuery().category).toBe('Gaming'));
    expect(lastList()).toMatchObject({ category: 'Gaming' });
    w.unmount();
  });
});
