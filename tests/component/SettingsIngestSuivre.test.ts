import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import SettingsPodcastsTab from '../../app/components/settings/SettingsPodcastsTab.vue';
import { useToast } from '../../app/composables/useToast';
import SettingsMusicTab from '../../app/components/settings/SettingsMusicTab.vue';

// Clicking "Suivre" on a search result must add the show/artist right away;
// it used to only fill the manual input, which real users never noticed.

let fetchMock: ReturnType<typeof vi.fn>;
let ingestResolvers: Array<(v: any) => void>;
let holdIngest: boolean;
let searchPayload: any;

const ingestCalls = (path: string) =>
  fetchMock.mock.calls.filter(([url, opts]) => url === path && opts?.method === 'POST');

beforeEach(() => {
  ingestResolvers = [];
  holdIngest = false;
  searchPayload = {};
  fetchMock = vi.fn(async (url: string, opts?: any) => {
    if (url === '/api/admin/podcasts/search-shows' || url === '/api/admin/downloader/search-channels') {
      return searchPayload;
    }
    if (opts?.method === 'POST' && (url === '/api/admin/podcasts/ingest' || url === '/api/admin/music/ingest')) {
      if (holdIngest) {
        return new Promise((resolve) => ingestResolvers.push(resolve));
      }
      return { success: true, message: 'ok' };
    }
    return {};
  });
  vi.stubGlobal('$fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function search(wrapper: any, placeholderPart: string) {
  const input = wrapper.find(`input[placeholder*="${placeholderPart}"]`);
  await input.setValue('query');
  await input.element.closest('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
  await flushPromises();
}

const suivreButtons = (wrapper: any) =>
  wrapper.findAll('button').filter((b: any) => b.text().trim() === 'Suivre');

describe('SettingsPodcastsTab "Suivre"', () => {
  it('adds the podcast immediately with one POST and no further click', async () => {
    searchPayload = { shows: [{ feedUrl: 'https://feeds.example/show.xml', title: 'Show', author: 'A' }] };
    const wrapper = await mountSuspended(SettingsPodcastsTab);
    await search(wrapper, 'Podcast show name');
    expect(suivreButtons(wrapper)).toHaveLength(1);

    await suivreButtons(wrapper)[0].trigger('click');
    await flushPromises();

    const calls = ingestCalls('/api/admin/podcasts/ingest');
    expect(calls).toHaveLength(1);
    expect(calls[0][1].body).toEqual({ feedUrl: 'https://feeds.example/show.xml', sync_status: 'downloading' });
    // results list is cleared
    expect(suivreButtons(wrapper)).toHaveLength(0);
  });

  it('calls no ingest endpoint when the result has no feed URL', async () => {
    searchPayload = { shows: [{ feedUrl: '', title: 'No feed', author: 'A' }] };
    const wrapper = await mountSuspended(SettingsPodcastsTab);
    await search(wrapper, 'Podcast show name');
    await suivreButtons(wrapper)[0].trigger('click');
    await flushPromises();
    expect(ingestCalls('/api/admin/podcasts/ingest')).toHaveLength(0);
    expect(useToast().toasts.value.map((t) => t.message)).toContain("Ce podcast n'a pas de flux RSS exploitable.");
  });

  it('cannot be triggered a second time while the add is pending', async () => {
    searchPayload = { shows: [{ feedUrl: 'https://feeds.example/show.xml', title: 'Show', author: 'A' }] };
    holdIngest = true;
    const wrapper = await mountSuspended(SettingsPodcastsTab);
    await search(wrapper, 'Podcast show name');
    const btn = suivreButtons(wrapper)[0];
    await btn.trigger('click');
    await flushPromises();
    expect(ingestCalls('/api/admin/podcasts/ingest')).toHaveLength(1);
    // the result list is cleared at once, so no Suivre button is left to click,
    // and a stale click on the old node must not fire a second request
    expect(suivreButtons(wrapper)).toHaveLength(0);
    await btn.trigger('click');
    await flushPromises();
    expect(ingestCalls('/api/admin/podcasts/ingest')).toHaveLength(1);
    ingestResolvers.forEach((r) => r({ success: true, message: 'ok' }));
    await flushPromises();
  });
});

describe('SettingsMusicTab "Suivre"', () => {
  it('adds the artist immediately using the channel handle', async () => {
    searchPayload = { channels: [{ id: 'UC1', handle: '/@artist', title: 'Artist' }] };
    const wrapper = await mountSuspended(SettingsMusicTab);
    await search(wrapper, 'Artist or channel name');
    await suivreButtons(wrapper)[0].trigger('click');
    await flushPromises();

    const calls = ingestCalls('/api/admin/music/ingest');
    expect(calls).toHaveLength(1);
    expect(calls[0][1].body).toEqual({ url: 'https://www.youtube.com/@artist', sync_status: 'downloading' });
  });

  it('falls back to the channel id URL when there is no handle', async () => {
    searchPayload = { channels: [{ id: 'UC123', title: 'Artist' }] };
    const wrapper = await mountSuspended(SettingsMusicTab);
    await search(wrapper, 'Artist or channel name');
    await suivreButtons(wrapper)[0].trigger('click');
    await flushPromises();
    const calls = ingestCalls('/api/admin/music/ingest');
    expect(calls).toHaveLength(1);
    expect(calls[0][1].body.url).toBe('https://www.youtube.com/channel/UC123');
  });

  it('calls no ingest endpoint when neither handle nor id is present', async () => {
    searchPayload = { channels: [{ id: '', title: 'Ghost' }] };
    const wrapper = await mountSuspended(SettingsMusicTab);
    await search(wrapper, 'Artist or channel name');
    await suivreButtons(wrapper)[0].trigger('click');
    await flushPromises();
    expect(ingestCalls('/api/admin/music/ingest')).toHaveLength(0);
    expect(useToast().toasts.value.map((t) => t.message)).toContain("Impossible de déterminer l'adresse de cet artiste.");
  });

  it('cannot be triggered a second time while the add is pending', async () => {
    searchPayload = { channels: [{ id: 'UC1', handle: '/@artist', title: 'Artist' }] };
    holdIngest = true;
    const wrapper = await mountSuspended(SettingsMusicTab);
    await search(wrapper, 'Artist or channel name');
    const btn = suivreButtons(wrapper)[0];
    await btn.trigger('click');
    await flushPromises();
    expect(ingestCalls('/api/admin/music/ingest')).toHaveLength(1);
    expect(suivreButtons(wrapper)).toHaveLength(0);
    await btn.trigger('click');
    await flushPromises();
    expect(ingestCalls('/api/admin/music/ingest')).toHaveLength(1);
    ingestResolvers.forEach((r) => r({ success: true, message: 'ok' }));
    await flushPromises();
  });
});
