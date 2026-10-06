import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import ChannelDirectoryView from '../../app/components/channels/ChannelDirectoryView.vue';
import IndexPage from '../../app/pages/index.vue';

// Adding sources lives in Settings > Library; the empty-library calls to action must open it.
const ADD_ROUTE = '/settings?tab=library&section=videos';
let feed: any;

beforeEach(() => {
  useState('auth_loading').value = false;
  useState('auth_user').value = { id: 'a1', username: 'admin', role: 'admin' };
  feed = { featured: { large: null, small: [] }, sections: [] };
  clearNuxtData();
  registerEndpoint('/api/channels', () => ({ channels: [] }));
  registerEndpoint('/api/home/feed', () => feed);
});
afterEach(() => vi.unstubAllGlobals());

describe('empty-library calls to action', () => {
  it('ChannelDirectoryView "Add a channel" opens the Library videos section', async () => {
    const w = await mountSuspended(ChannelDirectoryView);
    await flushPromises();
    const link = w.find('a');
    expect(link.text()).toBe('Add a channel');
    expect(link.attributes('href')).toBe(ADD_ROUTE);
  });

  it('the home page "Add channels" action opens the same route', async () => {
    const w = await mountSuspended(IndexPage, { route: '/' });
    await flushPromises();
    const link = w.findAll('a').find((a) => a.text().includes('Add channels'));
    expect(link?.attributes('href')).toBe(ADD_ROUTE);
  });
});

describe('channel links on the home page', () => {
  it('use the channelId query the channels page reads, never ?id=', async () => {
    feed = { featured: { large: null, small: [] }, sections: [
      { id: 'subscriptions', title: 'Subscriptions', channels: [{ channelId: 'UC1', channelTitle: 'Chan', channelAvatar: null, videos: [] }] },
    ] };
    const w = await mountSuspended(IndexPage, { route: '/' });
    await flushPromises();
    const link = w.findAll('a').find((a) => a.text().includes('See all'));
    expect(link?.attributes('href')).toBe('/channels?channelId=UC1');
  });
});
