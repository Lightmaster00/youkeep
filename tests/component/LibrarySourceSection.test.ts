import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import LibrarySourceSection from '../../app/components/settings/LibrarySourceSection.vue';
import { musicSource, podcastsSource } from '../../app/utils/librarySources';
import { useToast } from '../../app/composables/useToast';

let fetchMock: ReturnType<typeof vi.fn>;
let searchPayload: any;
let listPayload: any;
let holdIngest: boolean;
let failIngest: boolean;
let ingestResolvers: Array<(v: any) => void>;
let failRowAction: boolean;
let syncAllPayload: any;

const posts = (url: string) => fetchMock.mock.calls.filter(([u, o]) => u === url && o?.method === 'POST');
const gets = (url: string) => fetchMock.mock.calls.filter(([u, o]) => u === url && !o?.method);
const toastMessages = () => useToast().toasts.value.map((t) => t.message);

beforeEach(() => {
  searchPayload = {};
  listPayload = {};
  holdIngest = false;
  failIngest = false;
  ingestResolvers = [];
  failRowAction = false;
  syncAllPayload = { success: true };
  useToast().toasts.value = [];
  fetchMock = vi.fn(async (url: string, opts?: any) => {
    if (url === '/api/admin/downloader/search-channels' || url === '/api/admin/podcasts/search-shows') return searchPayload;
    if (url === '/api/admin/music/queue' || url === '/api/admin/podcasts/queue') return listPayload;
    if (opts?.method === 'POST' && (url === '/api/admin/music/ingest' || url === '/api/admin/podcasts/ingest')) {
      if (failIngest) throw Object.assign(new Error('boom'), { data: { statusMessage: 'nope' } });
      if (holdIngest) return new Promise((resolve) => ingestResolvers.push(resolve));
      return { success: true, message: 'ok' };
    }
    if (opts?.method === 'POST' && url.endsWith('/sync-all')) return syncAllPayload;
    if (opts?.method === 'POST' && /\/(pause|sync)$/.test(url)) {
      if (failRowAction) throw Object.assign(new Error('down'), { data: { statusMessage: 'Server unreachable' } });
      return { success: true };
    }
    return {};
  });
  vi.stubGlobal('$fetch', fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

async function search(wrapper: any, text = 'query') {
  await wrapper.find('[data-testid="follow-search-input"]').setValue(text);
  await wrapper.find('[data-testid="follow-search-form"]').trigger('submit');
  await flushPromises();
}

const followButtons = (w: any) => w.findAll('[data-testid^="follow-result-"]');

describe('LibrarySourceSection — Music', () => {
  const mountMusic = () => mountSuspended(LibrarySourceSection, { props: { config: musicSource } });

  it('follows in one click with the handle URL, clears the results and reloads Following', async () => {
    searchPayload = { channels: [{ id: 'UC1', handle: '/@artist', title: 'Artist' }] };
    const w = await mountMusic();
    await flushPromises();
    const listCallsBefore = gets('/api/admin/music/queue').length;
    await search(w);
    expect(followButtons(w)).toHaveLength(1);
    expect(followButtons(w)[0].text()).toBe('Follow');

    await followButtons(w)[0].trigger('click');
    await flushPromises();

    const calls = posts('/api/admin/music/ingest');
    expect(calls).toHaveLength(1);
    expect(calls[0][1].body).toEqual({ url: 'https://www.youtube.com/@artist', sync_status: 'downloading' });
    expect(followButtons(w)).toHaveLength(0);
    expect(gets('/api/admin/music/queue').length).toBe(listCallsBefore + 1);
    expect(toastMessages()).toContain('Now following Artist.');
  });

  it('falls back to the channel id URL when there is no handle', async () => {
    searchPayload = { channels: [{ id: 'UC123', title: 'Artist' }] };
    const w = await mountMusic();
    await search(w);
    await followButtons(w)[0].trigger('click');
    await flushPromises();
    expect(posts('/api/admin/music/ingest')[0][1].body.url).toBe('https://www.youtube.com/channel/UC123');
  });

  it('calls no ingest endpoint when the result has no address', async () => {
    searchPayload = { channels: [{ id: '', title: 'Ghost' }] };
    const w = await mountMusic();
    await search(w);
    await followButtons(w)[0].trigger('click');
    await flushPromises();
    expect(posts('/api/admin/music/ingest')).toHaveLength(0);
    expect(toastMessages()).toContain("This result has no channel address, so it can't be followed.");
  });

  it('cannot be triggered a second time while the add is pending', async () => {
    searchPayload = { channels: [{ id: 'UC1', handle: '/@artist', title: 'Artist' }] };
    holdIngest = true;
    const w = await mountMusic();
    await search(w);
    const btn = followButtons(w)[0];
    await btn.trigger('click');
    await flushPromises();
    expect(posts('/api/admin/music/ingest')).toHaveLength(1);
    expect(followButtons(w)).toHaveLength(1);
    expect((btn.element as HTMLButtonElement).disabled).toBe(true);
    await btn.trigger('click');
    await flushPromises();
    expect(posts('/api/admin/music/ingest')).toHaveLength(1);
    ingestResolvers.forEach((r) => r({ success: true, message: 'ok' }));
    await flushPromises();
  });

  it('keeps the results after a failed add so Follow can be retried, then clears them', async () => {
    searchPayload = { channels: [{ id: 'UC1', handle: '/@a', title: 'A' }, { id: 'UC2', handle: '/@b', title: 'B' }] };
    failIngest = true;
    const w = await mountMusic();
    await search(w);
    await followButtons(w)[0].trigger('click');
    await flushPromises();
    expect(posts('/api/admin/music/ingest')).toHaveLength(1);
    expect(followButtons(w)).toHaveLength(2);
    expect((followButtons(w)[0].element as HTMLButtonElement).disabled).toBe(false);
    expect(toastMessages()).toContain('nope');

    failIngest = false;
    await followButtons(w)[0].trigger('click');
    await flushPromises();
    expect(posts('/api/admin/music/ingest')).toHaveLength(2);
    expect(followButtons(w)).toHaveLength(0);
  });

  it('a quick double click on two different results starts only one add', async () => {
    searchPayload = { channels: [{ id: 'UC1', handle: '/@a', title: 'A' }, { id: 'UC2', handle: '/@b', title: 'B' }] };
    holdIngest = true;
    const w = await mountMusic();
    await search(w);
    const [a, b] = followButtons(w);
    a.trigger('click');
    b.trigger('click');
    await flushPromises();
    expect(posts('/api/admin/music/ingest')).toHaveLength(1);
    expect(posts('/api/admin/music/ingest')[0][1].body.url).toBe('https://www.youtube.com/@a');
    ingestResolvers.forEach((r) => r({ success: true, message: 'ok' }));
    await flushPromises();
  });

  it('uses the "Options for new follows" (auto-sync off, visibility private)', async () => {
    searchPayload = { channels: [{ id: 'UC1', handle: '/@a', title: 'A' }] };
    const w = await mountMusic();
    await search(w);
    await w.find('[data-testid="option-auto-sync"]').setValue(false);
    await w.find('[data-testid="option-visibility"]').setValue('private');
    await followButtons(w)[0].trigger('click');
    await flushPromises();
    expect(posts('/api/admin/music/ingest')[0][1].body).toEqual({ url: 'https://www.youtube.com/@a', sync_status: 'paused', visibility: 'private' });
  });

  it('follows a pasted @handle directly without searching', async () => {
    const w = await mountMusic();
    await w.find('[data-testid="follow-search-input"]').setValue('@someone');
    expect(w.find('[data-testid="follow-search-submit"]').text()).toBe('Follow');
    await w.find('[data-testid="follow-search-form"]').trigger('submit');
    await flushPromises();
    expect(gets('/api/admin/downloader/search-channels')).toHaveLength(0);
    expect(posts('/api/admin/music/ingest')[0][1].body).toEqual({ url: 'https://www.youtube.com/@someone', sync_status: 'downloading' });
    expect((w.find('[data-testid="follow-search-input"]').element as HTMLInputElement).value).toBe('');
  });

  it('does nothing on an empty search box (no HTML5 required attribute is relied on)', async () => {
    const w = await mountMusic();
    await w.find('[data-testid="follow-search-form"]').trigger('submit');
    await flushPromises();
    expect(gets('/api/admin/downloader/search-channels')).toHaveLength(0);
    expect(w.find('[data-testid="follow-search-input"]').attributes('required')).toBeUndefined();
  });
});

describe('LibrarySourceSection — Podcasts', () => {
  const mountPodcasts = () => mountSuspended(LibrarySourceSection, { props: { config: podcastsSource } });

  it('follows a search result by its feed URL in one click', async () => {
    searchPayload = { shows: [{ feedUrl: 'https://feeds.example/show.xml', title: 'Show', author: 'A' }] };
    const w = await mountPodcasts();
    await search(w);
    await followButtons(w)[0].trigger('click');
    await flushPromises();
    expect(posts('/api/admin/podcasts/ingest')[0][1].body).toEqual({ feedUrl: 'https://feeds.example/show.xml', sync_status: 'downloading' });
    expect(followButtons(w)).toHaveLength(0);
  });

  it('refuses a result without a feed', async () => {
    searchPayload = { shows: [{ feedUrl: '', title: 'No feed', author: 'A' }] };
    const w = await mountPodcasts();
    await search(w);
    await followButtons(w)[0].trigger('click');
    await flushPromises();
    expect(posts('/api/admin/podcasts/ingest')).toHaveLength(0);
    expect(toastMessages()).toContain("This podcast has no usable RSS feed, so it can't be followed.");
  });

  it('follows a pasted feed URL directly', async () => {
    const w = await mountPodcasts();
    await w.find('[data-testid="follow-search-input"]').setValue('https://feeds.example/x.xml');
    await w.find('[data-testid="follow-search-form"]').trigger('submit');
    await flushPromises();
    expect(gets('/api/admin/podcasts/search-shows')).toHaveLength(0);
    expect(posts('/api/admin/podcasts/ingest')[0][1].body.feedUrl).toBe('https://feeds.example/x.xml');
  });
});

describe('LibrarySourceSection — Following list', () => {
  beforeEach(() => {
    listPayload = { artists: [
      { id: 'a1', name: 'Artist One', avatar_url: '', sync_status: 'downloading', visibility: 'private', track_count: 3 },
      { id: 'a2', name: 'Artist Two', avatar_url: '', sync_status: 'paused', visibility: 'public', track_count: 1 },
    ] };
  });
  const mountMusic = async () => {
    const w = await mountSuspended(LibrarySourceSection, { props: { config: musicSource } });
    await flushPromises();
    return w;
  };

  it('renders one row per artist with count, state and a read-only visibility badge', async () => {
    const w = await mountMusic();
    const row = w.find('[data-testid="following-a1"]');
    expect(row.text()).toContain('Artist One');
    expect(row.text()).toContain('3 tracks');
    expect(row.text()).toContain('Active');
    expect(w.find('[data-testid="following-a2"]').text()).toContain('Paused');
    const badge = w.find('[data-testid="visibility-a1"]');
    expect(badge.element.tagName).toBe('SPAN');
    expect(badge.text()).toBe('Private');
    expect(w.text()).toContain('Following (2)');
  });

  it('turning the switch off pauses, turning it on syncs', async () => {
    const w = await mountMusic();
    await w.find('[data-testid="sync-switch-a1"]').setValue(false);
    await flushPromises();
    expect(posts('/api/admin/music/artists/a1/pause')).toHaveLength(1);
    await w.find('[data-testid="sync-switch-a2"]').setValue(true);
    await flushPromises();
    expect(posts('/api/admin/music/artists/a2/sync')).toHaveLength(1);
  });

  it('a failed pause shows an error and puts the switch back to the server state', async () => {
    failRowAction = true;
    const w = await mountMusic();
    const sw = w.find('[data-testid="sync-switch-a1"]');
    await sw.setValue(false);
    await flushPromises();
    expect(posts('/api/admin/music/artists/a1/pause')).toHaveLength(1);
    expect(toastMessages()).toContain('Server unreachable');
    expect((sw.element as HTMLInputElement).checked).toBe(true);
  });

  it('Sync now calls the sync route', async () => {
    const w = await mountMusic();
    await w.find('[data-testid="sync-now-a2"]').trigger('click');
    await flushPromises();
    expect(posts('/api/admin/music/artists/a2/sync')).toHaveLength(1);
    expect(toastMessages()).toContain('Sync started for Artist Two.');
  });

  it('Sync all calls the section route and reports a sync already running', async () => {
    const w = await mountMusic();
    await w.find('[data-testid="sync-all"]').trigger('click');
    await flushPromises();
    expect(posts('/api/admin/music/sync-all')).toHaveLength(1);
    expect(toastMessages()).toContain('Sync started for every followed artist.');

    syncAllPayload = { success: false };
    await w.find('[data-testid="sync-all"]').trigger('click');
    await flushPromises();
    expect(toastMessages()).toContain('A sync is already running.');
  });

  it('is collapsed when open is false', async () => {
    const w = await mountSuspended(LibrarySourceSection, { props: { config: musicSource, open: false } });
    expect(w.find('[data-testid="library-section-music"]').attributes('open')).toBeUndefined();
    const w2 = await mountSuspended(LibrarySourceSection, { props: { config: musicSource } });
    expect(w2.find('[data-testid="library-section-music"]').attributes('open')).toBeDefined();
  });
});
