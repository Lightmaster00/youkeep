import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import ChannelDirectoryView from '../../app/components/channels/ChannelDirectoryView.vue';

// Adding sources lives in Settings > Library; the empty-library calls to action must open it.
const ADD_ROUTE = '/settings?tab=library&section=videos';

beforeEach(() => {
  useState('auth_loading').value = false;
  useState('auth_user').value = { id: 'a1', username: 'admin', role: 'admin' };
  registerEndpoint('/api/channels', () => ({ channels: [] }));
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

  it('the home page empty-library action is wired to the same route', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('app/pages/index.vue', 'utf8');
    const block = src.slice(src.indexOf('<!-- Empty library -->'), src.indexOf('<!-- Search Mode -->'));
    expect(block).toContain(`action-route="${ADD_ROUTE}"`);
    expect(block).toContain(`'Add channels'`);
  });
});

describe('channel links on the home page', () => {
  it('use the channelId query the channels page reads, never ?id=', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('app/pages/index.vue', 'utf8');
    expect(src).not.toContain('/channels?id=');
    expect(src.match(/\/channels\?channelId=/g)?.length).toBe(2);
  });
});
