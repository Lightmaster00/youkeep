import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import { getFeedSeed, useFeedSeed, resetFeedSeedForTests } from '../../app/composables/useFeedSeed';
import ChannelsPage from '../../app/pages/channels.vue';

let fetchMock: ReturnType<typeof vi.fn>;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('feed seed', () => {
  beforeEach(() => {
    resetFeedSeedForTests();
    window.sessionStorage.clear();
  });

  it('is one integer in 0..2^32-1, kept for the session', () => {
    const a = getFeedSeed();
    expect(Number.isInteger(a)).toBe(true);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(2 ** 32);
    expect(getFeedSeed()).toBe(a);
    expect(window.sessionStorage.getItem('youkeep:feed-seed')).toBe(String(a));
    resetFeedSeedForTests();
    expect(getFeedSeed()).toBe(a);
  });

  it('ignores a malformed stored value', () => {
    window.sessionStorage.setItem('youkeep:feed-seed', '99999999999');
    const a = getFeedSeed();
    expect(a).toBeLessThan(2 ** 32);
  });

  it('still works when storage throws', () => {
    vi.spyOn(window.sessionStorage, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(window.sessionStorage, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    const a = getFeedSeed();
    expect(getFeedSeed()).toBe(a);
  });

  it('adopts the seed hydrated into useState', () => {
    useState<number>('feed_seed').value = 12345;
    expect(useFeedSeed()).toBe(12345);
    expect(getFeedSeed()).toBe(12345);
  });
});

describe('channel page', () => {
  beforeEach(() => {
    clearNuxtData();
    useState('auth_loading').value = false;
    useState<any>('auth_user').value = { id: 'u1', username: 'bob', role: 'user' };
  });

  it('shows "Channel not found" when the API answers 404', async () => {
    fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith('/api/channels/')) {
        throw Object.assign(new Error('Not found'), { statusCode: 404, data: { statusMessage: 'Channel not found.' } });
      }
      if (url === '/api/videos') return { videos: [], pagination: { total: 0 } };
      return { channels: [] };
    });
    vi.stubGlobal('$fetch', fetchMock);
    const w = await mountSuspended(ChannelsPage, { route: { path: '/channels', query: { channelId: 'gone' } } });
    await flushPromises();
    expect(w.find('[data-testid="channel-not-found"]').exists()).toBe(true);
    expect(w.text()).toContain('Channel not found');
    // A non-admin never asks for the admin-only status=all.
    const videoCalls = fetchMock.mock.calls.filter(([u]) => u === '/api/videos');
    for (const [, opts] of videoCalls) expect(opts.params.status).toBeUndefined();
    w.unmount();
  });
});
