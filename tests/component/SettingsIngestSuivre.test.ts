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
let failIngest: boolean;
let searchPayload: any;

const ingestCalls = (path: string) =>
  fetchMock.mock.calls.filter(([url, opts]) => url === path && opts?.method === 'POST');

beforeEach(() => {
  ingestResolvers = [];
  holdIngest = false;
  failIngest = false;
  searchPayload = {};
  fetchMock = vi.fn(async (url: string, opts?: any) => {
    if (url === '/api/admin/podcasts/search-shows' || url === '/api/admin/downloader/search-channels') {
      return searchPayload;
    }
    if (opts?.method === 'POST' && (url === '/api/admin/podcasts/ingest' || url === '/api/admin/music/ingest')) {
      if (failIngest) throw Object.assign(new Error('boom'), { data: { statusMessage: 'nope' } });
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
    // results list is cleared after the successful add
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
    // results stay visible while pending, but the button is disabled
    expect(suivreButtons(wrapper)).toHaveLength(1);
    expect((btn.element as HTMLButtonElement).disabled).toBe(true);
    await btn.trigger('click');
    await flushPromises();
    expect(ingestCalls('/api/admin/podcasts/ingest')).toHaveLength(1);
    ingestResolvers.forEach((r) => r({ success: true, message: 'ok' }));
    await flushPromises();
  });

  it('keeps the results after a failed add so Suivre can be retried', async () => {
    searchPayload = { shows: [{ feedUrl: 'https://feeds.example/a.xml', title: 'A', author: 'x' }, { feedUrl: 'https://feeds.example/b.xml', title: 'B', author: 'y' }] };
    failIngest = true;
    const wrapper = await mountSuspended(SettingsPodcastsTab);
    await search(wrapper, 'Podcast show name');
    await suivreButtons(wrapper)[0].trigger('click');
    await flushPromises();
    expect(ingestCalls('/api/admin/podcasts/ingest')).toHaveLength(1);
    expect(suivreButtons(wrapper)).toHaveLength(2);
    expect((suivreButtons(wrapper)[0].element as HTMLButtonElement).disabled).toBe(false);

    failIngest = false;
    await suivreButtons(wrapper)[0].trigger('click');
    await flushPromises();
    expect(ingestCalls('/api/admin/podcasts/ingest')).toHaveLength(2);
    expect(suivreButtons(wrapper)).toHaveLength(0);
  });

  it('a quick double click on two different result cards starts only one ingest', async () => {
    searchPayload = { shows: [{ feedUrl: 'https://feeds.example/a.xml', title: 'A', author: 'x' }, { feedUrl: 'https://feeds.example/b.xml', title: 'B', author: 'y' }] };
    holdIngest = true;
    const wrapper = await mountSuspended(SettingsPodcastsTab);
    await search(wrapper, 'Podcast show name');
    const [a, b] = suivreButtons(wrapper);
    // both clicks land before Vue re-renders the disabled state
    a.trigger('click');
    b.trigger('click');
    await flushPromises();
    expect(ingestCalls('/api/admin/podcasts/ingest')).toHaveLength(1);
    expect(ingestCalls('/api/admin/podcasts/ingest')[0][1].body.feedUrl).toBe('https://feeds.example/a.xml');
    ingestResolvers.forEach((r) => r({ success: true, message: 'ok' }));
    await flushPromises();
  });

  it('sends sync_status paused when auto-sync is unchecked and includes the chosen visibility', async () => {
    searchPayload = { shows: [{ feedUrl: 'https://feeds.example/a.xml', title: 'A', author: 'x' }, { feedUrl: 'https://feeds.example/b.xml', title: 'B', author: 'y' }] };
    const wrapper = await mountSuspended(SettingsPodcastsTab);
    await search(wrapper, 'Podcast show name');
    const form = wrapper.findAll('form').filter((f: any) => f.find('select option[value="ultra_private"]').exists())[0];
    await wrapper.findAll('label.checkbox-container').filter((l: any) => l.text().includes('Sync automatically'))[0].find('input').setValue(false);
    await form.find('select').setValue('private');
    await suivreButtons(wrapper)[0].trigger('click');
    await flushPromises();
    const calls = ingestCalls('/api/admin/podcasts/ingest');
    expect(calls).toHaveLength(1);
    expect(calls[0][1].body.sync_status).toBe('paused');
    expect(calls[0][1].body.visibility).toBe('private');
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
    expect(suivreButtons(wrapper)).toHaveLength(0);
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
    expect((btn.element as HTMLButtonElement).disabled).toBe(true);
    await btn.trigger('click');
    await flushPromises();
    expect(ingestCalls('/api/admin/music/ingest')).toHaveLength(1);
    ingestResolvers.forEach((r) => r({ success: true, message: 'ok' }));
    await flushPromises();
  });

  it('keeps the results after a failed add so Suivre can be retried', async () => {
    searchPayload = { channels: [{ id: 'UC1', handle: '/@a', title: 'A' }, { id: 'UC2', handle: '/@b', title: 'B' }] };
    failIngest = true;
    const wrapper = await mountSuspended(SettingsMusicTab);
    await search(wrapper, 'Artist or channel name');
    await suivreButtons(wrapper)[0].trigger('click');
    await flushPromises();
    expect(ingestCalls('/api/admin/music/ingest')).toHaveLength(1);
    expect(suivreButtons(wrapper)).toHaveLength(2);
    expect((suivreButtons(wrapper)[0].element as HTMLButtonElement).disabled).toBe(false);

    failIngest = false;
    await suivreButtons(wrapper)[0].trigger('click');
    await flushPromises();
    expect(ingestCalls('/api/admin/music/ingest')).toHaveLength(2);
    expect(suivreButtons(wrapper)).toHaveLength(0);
  });

  it('a quick double click on two different result cards starts only one ingest', async () => {
    searchPayload = { channels: [{ id: 'UC1', handle: '/@a', title: 'A' }, { id: 'UC2', handle: '/@b', title: 'B' }] };
    holdIngest = true;
    const wrapper = await mountSuspended(SettingsMusicTab);
    await search(wrapper, 'Artist or channel name');
    const [a, b] = suivreButtons(wrapper);
    // both clicks land before Vue re-renders the disabled state
    a.trigger('click');
    b.trigger('click');
    await flushPromises();
    expect(ingestCalls('/api/admin/music/ingest')).toHaveLength(1);
    expect(ingestCalls('/api/admin/music/ingest')[0][1].body.url).toBe('https://www.youtube.com/@a');
    ingestResolvers.forEach((r) => r({ success: true, message: 'ok' }));
    await flushPromises();
  });

  it('sends sync_status paused when auto-sync is unchecked and includes the chosen visibility', async () => {
    searchPayload = { channels: [{ id: 'UC1', handle: '/@a', title: 'A' }, { id: 'UC2', handle: '/@b', title: 'B' }] };
    const wrapper = await mountSuspended(SettingsMusicTab);
    await search(wrapper, 'Artist or channel name');
    const form = wrapper.findAll('form').filter((f: any) => f.find('select option[value="ultra_private"]').exists())[0];
    await wrapper.findAll('label.checkbox-container').filter((l: any) => l.text().includes('Sync automatically'))[0].find('input').setValue(false);
    await form.find('select').setValue('private');
    await suivreButtons(wrapper)[0].trigger('click');
    await flushPromises();
    const calls = ingestCalls('/api/admin/music/ingest');
    expect(calls).toHaveLength(1);
    expect(calls[0][1].body.sync_status).toBe('paused');
    expect(calls[0][1].body.visibility).toBe('private');
  });
});
