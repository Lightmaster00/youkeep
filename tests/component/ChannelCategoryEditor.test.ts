import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import ChannelCategoryEditor from '../../app/components/channels/ChannelCategoryEditor.vue';
import ChannelsPage from '../../app/pages/channels.vue';
import { useToast } from '../../app/composables/useToast';

// The admin's category editor (Tracking options drawer) and the category
// chips of the channel page header.
let fetchMock: ReturnType<typeof vi.fn>;
let putAnswer: (body: any) => Promise<any>;

beforeEach(() => {
  clearNuxtData();
  useToast().toasts.value.splice(0);
  putAnswer = async (body) => ({
    categories: body.categories ?? ['Gaming', 'Education'],
    automatic: ['Gaming', 'Education'],
    override: body.categories,
  });
  fetchMock = vi.fn(async (url: string, opts: any = {}) => {
    if (url === '/api/channels/categories') return { categories: [{ name: 'Gaming', count: 4 }, { name: 'Music', count: 2 }, { name: 'Travel', count: 1 }] };
    if (url === '/api/admin/channels/ch1/categories') return putAnswer(opts.body);
    return {};
  });
  vi.stubGlobal('$fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  useState('auth_user').value = null;
});

const puts = () => fetchMock.mock.calls.filter(([u]) => u === '/api/admin/channels/ch1/categories').map(([, o]) => o);
const mountEditor = async (props: object = {}) => {
  const w = await mountSuspended(ChannelCategoryEditor, { props: { channelId: 'ch1', categories: ['Gaming', 'Education'], override: null, ...props } });
  await flushPromises();
  return w;
};

describe('ChannelCategoryEditor', () => {
  it('shows the automatic categories as removable chips, with known ones to add', async () => {
    const w = await mountEditor();
    expect(w.find('[data-testid="category-mode"]').text()).toBe('Automatic');
    expect(w.findAll('.cat-editor__chip').map((c) => c.find('.cat-editor__chip-label').text())).toEqual(['Gaming', 'Education']);
    // Known categories not on the channel yet are offered.
    expect(w.findAll('datalist option').map((o) => o.attributes('value'))).toEqual(['Music', 'Travel']);
    expect(w.find('[data-testid="category-reset"]').attributes('disabled')).toBeDefined();
  });

  it('removing a chip saves the remaining list as the override', async () => {
    const w = await mountEditor();
    await w.find('[data-testid="category-remove-Gaming"]').trigger('click');
    await flushPromises();
    expect(puts()).toEqual([{ method: 'PUT', body: { categories: ['Education'] } }]);
    expect(w.find('[data-testid="category-mode"]').text()).toBe('Set by hand');
    expect(w.emitted('saved')?.[0]).toEqual([['Education']]);
  });

  it('adds a typed category (Enter), refusing a duplicate', async () => {
    const w = await mountEditor();
    await w.find('[data-testid="category-input"]').setValue('gaming');
    expect(w.find('[data-testid="category-add"]').attributes('disabled')).toBeDefined();
    await w.find('[data-testid="category-input"]').setValue('  Travel ');
    await w.find('form').trigger('submit');
    await flushPromises();
    expect(puts()).toEqual([{ method: 'PUT', body: { categories: ['Gaming', 'Education', 'Travel'] } }]);
    expect(w.findAll('.cat-editor__chip')).toHaveLength(3);
    expect((w.find('[data-testid="category-input"]').element as HTMLInputElement).value).toBe('');
  });

  it('"Reset to automatic" sends null', async () => {
    const w = await mountEditor({ categories: ['Mine'], override: ['Mine'] });
    await w.find('[data-testid="category-reset"]').trigger('click');
    await flushPromises();
    expect(puts()).toEqual([{ method: 'PUT', body: { categories: null } }]);
    expect(w.find('[data-testid="category-mode"]').text()).toBe('Automatic');
    expect(w.findAll('.cat-editor__chip-label').map((c) => c.text())).toEqual(['Gaming', 'Education']);
  });

  it('a refused save keeps the chips and shows the error', async () => {
    putAnswer = () => Promise.reject({ data: { statusMessage: 'A category name has at most 40 characters.' } });
    const w = await mountEditor();
    await w.find('[data-testid="category-remove-Gaming"]').trigger('click');
    await flushPromises();
    expect(w.findAll('.cat-editor__chip')).toHaveLength(2);
    expect(useToast().toasts.value.some((t) => t.type === 'error' && t.message.includes('40 characters'))).toBe(true);
  });

  it('at 5 categories, adding is disabled', async () => {
    const w = await mountEditor({ categories: ['a', 'b', 'c', 'd', 'e'], override: ['a', 'b', 'c', 'd', 'e'] });
    expect(w.find('[data-testid="category-input"]').attributes('disabled')).toBeDefined();
    expect(w.text()).toContain('At most 5 categories.');
  });
});

describe('channel page', () => {
  const channelFetch = (channel: object) => vi.fn(async (url: string) => {
    if (url === '/api/channels/ch1') return { channel: { id: 'ch1', title: 'One', visibility: 'public', sync_status: 'paused', ...channel }, stats: { totalCount: 1 } };
    if (url === '/api/channels/categories') return { categories: [] };
    if (url === '/api/videos') return { videos: [], pagination: { total: 0 } };
    return { channels: [], playlists: [] };
  });

  it('the header shows the category chips, linking to the filtered directory', async () => {
    vi.stubGlobal('$fetch', channelFetch({ categories: ['Gaming', 'Science & Technology'] }));
    const w = await mountSuspended(ChannelsPage, { route: { path: '/channels', query: { channelId: 'ch1' } } });
    await flushPromises();
    const chips = w.findAll('[data-testid="channel-categories"] a');
    expect(chips.map((c) => c.text())).toEqual(['Gaming', 'Science & Technology']);
    expect(chips[1]!.attributes('href')).toBe('/channels?category=Science+%26+Technology');
    w.unmount();
  });

  it('the admin drawer has the category editor', async () => {
    useState<any>('auth_user').value = { id: 'a', username: 'boss', role: 'admin' };
    vi.stubGlobal('$fetch', channelFetch({ categories: ['Comedy'], categories_auto: ['Gaming'], categories_override: ['Comedy'] }));
    const w = await mountSuspended(ChannelsPage, { route: { path: '/channels', query: { channelId: 'ch1' } } });
    await flushPromises();
    const editor = w.find('[data-testid="channel-settings-drawer"] [data-testid="category-editor"]');
    expect(editor.exists()).toBe(true);
    expect(editor.find('[data-testid="category-mode"]').text()).toBe('Set by hand');
    w.unmount();
  });
});
