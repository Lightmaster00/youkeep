import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import SubscriptionsPage from '../../app/pages/subscriptions.vue';
import { answerConfirm, pendingConfirm } from '../../app/composables/useConfirm';

// The Subscriptions page: chip bar, Latest | Channels tabs (both in the URL),
// day headings, New marks and seen tracking, Shorts apart, the empty state.

/** YYYYMMDD of `daysAgo` days before today, in the local calendar. */
function ymd(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

const video = (id: string, extra: object = {}) => ({
  id, title: `Title ${id}`, channel_id: 'c1', channel_title: 'One', channel_avatar: null, duration: 600, view_count: 10,
  upload_date: ymd(0), local_video_path: '/v.mp4', local_thumbnail_path: null, is_short: 0, isNew: false, watchedPercent: 0, ...extra,
});

const CHANNELS = [
  { id: 'c1', title: 'One', avatar_url: null, subscribedAt: 1, videoCount: 12, newCount: 2, lastUploadDate: ymd(0), lastUploadAt: 1, categories: ['Gaming', 'Education'] },
  { id: 'c2', title: 'Two', avatar_url: null, subscribedAt: 2, videoCount: 1, newCount: 0, lastUploadDate: ymd(3), lastUploadAt: 1, categories: ['Music'] },
];

let fetchMock: ReturnType<typeof vi.fn>;
let channels: any[];
let longVideos: any[];
let shortVideos: any[];
let longTotal: number;

class FakeIO {
  static instances: FakeIO[] = [];
  targets = new Set<Element>();
  constructor(public cb: (entries: any[], io: FakeIO) => void) { FakeIO.instances.push(this); }
  observe(el: Element) { this.targets.add(el); }
  unobserve(el: Element) { this.targets.delete(el); }
  disconnect() { this.targets.clear(); }
}
function setVisible(el: Element, ratio: number) {
  for (const io of FakeIO.instances) {
    if (io.targets.has(el)) io.cb([{ target: el, isIntersecting: ratio > 0, intersectionRatio: ratio }], io);
  }
}

beforeEach(() => {
  clearNuxtData();
  FakeIO.instances = [];
  vi.stubGlobal('IntersectionObserver', FakeIO);
  useState('auth_loading').value = false;
  // Navigation (?tab=, ?channel=) runs the global middleware: modules known, prefs loaded.
  useState('modules').value = { video: true, music: true, podcasts: true };
  useState('modules_loaded').value = true;
  useState('display_prefs_for').value = 'u1';
  useState<any>('auth_user').value = { id: 'u1', username: 'alice', role: 'user' };
  channels = CHANNELS.map((c) => ({ ...c }));
  longVideos = [
    video('t1', { isNew: true }),
    video('t2', { upload_date: ymd(1) }),
    video('t3', { upload_date: ymd(4), isNew: true, watchedPercent: 40 }),
    video('t4', { upload_date: ymd(40) }),
  ];
  shortVideos = [video('s1', { is_short: 1, duration: 30, isNew: true })];
  longTotal = 4;
  fetchMock = vi.fn(async (url: string, opts: any = {}) => {
    if (url === '/api/subscriptions/channels') return { channels };
    if (url === '/api/subscriptions/feed') {
      if (opts.params?.type === 'short') return { videos: shortVideos, total: shortVideos.length };
      const page = opts.params?.page ?? 1;
      return page === 1 ? { videos: longVideos, total: longTotal } : { videos: [video(`p${page}`, { upload_date: ymd(60) })], total: longTotal };
    }
    if (url === '/api/channels') return { channels: [] };
    return {};
  });
  vi.stubGlobal('$fetch', fetchMock);
});
// Unmounted even when a test fails, so its watchers never reach the next test.
const live: { unmount: () => void }[] = [];
afterEach(() => {
  for (const w of live.splice(0)) {
    try { w.unmount(); } catch { /* already unmounted */ }
  }
  vi.useRealTimers();
  vi.unstubAllGlobals();
  answerConfirm(false);
});

async function mountPage(route = '/subscriptions') {
  const w = await mountSuspended(SubscriptionsPage, { route });
  live.push(w);
  await flushPromises();
  return w;
}
const feedCalls = (type = 'video') => fetchMock.mock.calls.filter(([u, o]) => u === '/api/subscriptions/feed' && o?.params?.type === type);
const seenCalls = () => fetchMock.mock.calls.filter(([u]) => u === '/api/subscriptions/seen');

describe('subscriptions page: chips and tabs', () => {
  it('lists All and each followed channel, with a dot on the ones with new videos', async () => {
    const w = await mountPage();
    const bar = w.find('[data-testid="subs-chip-bar"]');
    expect(bar.attributes('role')).toBe('tablist');
    expect(w.find('[data-testid="chip-all"]').attributes('aria-selected')).toBe('true');
    expect(w.find('[data-testid="chip-c1"]').find('[data-testid="chip-new-dot"]').exists()).toBe(true);
    expect(w.find('[data-testid="chip-c2"]').find('[data-testid="chip-new-dot"]').exists()).toBe(false);
    expect(feedCalls()[0][1].params.channelId).toBeUndefined();
    w.unmount();
  });

  it('a chip filters by channel through ?channel=, and the URL selects the chip', async () => {
    const w = await mountPage();
    await w.find('[data-testid="chip-c2"]').trigger('click');
    await flushPromises();
    // The navigation runs the route middleware first.
    await vi.waitFor(() => expect(useRouter().currentRoute.value.query.channel).toBe('c2'));
    await flushPromises();
    expect(feedCalls().at(-1)![1].params.channelId).toBe('c2');
    expect(feedCalls('short').at(-1)![1].params.channelId).toBe('c2');
    expect(w.find('[data-testid="chip-c2"]').attributes('aria-selected')).toBe('true');
    w.unmount();

    fetchMock.mockClear();
    const w2 = await mountPage('/subscriptions?channel=c1');
    expect(w2.find('[data-testid="chip-c1"]').attributes('aria-selected')).toBe('true');
    expect(feedCalls()[0][1].params.channelId).toBe('c1');
    w2.unmount();
  });

  it('the arrow keys move between chips', async () => {
    const w = await mountSuspended(SubscriptionsPage, { route: '/subscriptions', attachTo: document.body });
    live.push(w);
    await flushPromises();
    (w.find('[data-testid="chip-all"]').element as HTMLElement).focus();
    await w.find('[data-testid="subs-chip-bar"]').trigger('keydown', { key: 'ArrowRight' });
    expect(document.activeElement).toBe(w.find('[data-testid="chip-c1"]').element);
    w.unmount();
  });

  it('switches to the Channels tab through ?tab=, and the URL opens it', async () => {
    const w = await mountPage();
    expect(w.find('[data-testid="subs-tab-latest"]').attributes('aria-selected')).toBe('true');
    await w.find('[data-testid="subs-tab-channels"]').trigger('click');
    await vi.waitFor(() => expect(useRouter().currentRoute.value.query.tab).toBe('channels'));
    await flushPromises();
    expect(w.find('[data-testid="subs-panel-channels"]').exists()).toBe(true);
    expect(w.find('[data-testid="subs-panel-latest"]').exists()).toBe(false);
    w.unmount();

    const w2 = await mountPage('/subscriptions?tab=channels');
    expect(w2.find('[data-testid="subs-tab-channels"]').attributes('aria-selected')).toBe('true');
    const card = w2.find('[data-testid="sub-channel-c1"]');
    expect(card.text()).toContain('One');
    expect(card.find('[data-testid="sub-channel-new"]').text()).toBe('2 new');
    expect(card.text()).toContain('Last upload today');
    expect(card.text()).toContain('Gaming');
    expect(w2.find('[data-testid="sub-channel-c2"]').text()).toContain('Last upload 3 days ago');
    expect(w2.find('[data-testid="sub-channel-c2"]').find('[data-testid="sub-channel-new"]').exists()).toBe(false);
    w2.unmount();
  });
});

describe('subscriptions page: Latest', () => {
  it('groups the videos under Today / Yesterday / This week / Earlier with a New mark on unseen ones', async () => {
    const w = await mountPage();
    expect(w.findAll('.subs-day__title').map((h) => h.text())).toEqual(['Today', 'Yesterday', 'This week', 'Earlier']);
    expect(w.find('[data-testid="subs-day-today"]').text()).toContain('Title t1');
    expect(w.find('[data-testid="subs-day-week"]').text()).toContain('Title t3');
    expect(w.find('[data-testid="subs-card-t1"]').find('[data-testid="new-dot"]').exists()).toBe(true);
    expect(w.find('[data-testid="subs-card-t2"]').find('[data-testid="new-dot"]').exists()).toBe(false);
    expect(w.find('[data-testid="subs-card-t3"]').find('.watched-bar__fill').attributes('style')).toContain('width: 40%');
    w.unmount();
  });

  it('asks for the Shorts apart and shows them in their own section below, never among the videos', async () => {
    const w = await mountPage();
    expect(feedCalls('short')).toHaveLength(1);
    const videos = w.find('[data-testid="subs-videos"]');
    const shorts = w.find('[data-testid="subs-shorts"]');
    expect(videos.text()).not.toContain('Title s1');
    expect(shorts.text()).toContain('Title s1');
    expect(shorts.find('.media-frame--short').exists()).toBe(true);
    const html = w.html();
    expect(html.indexOf('data-testid="subs-videos"')).toBeLessThan(html.indexOf('data-testid="subs-shorts"'));
    w.unmount();
  });

  it('sorts and filters by category (options from the followed channels)', async () => {
    const w = await mountPage();
    const options = w.find('[data-testid="subs-category"]').findAll('option').map((o) => o.text());
    expect(options).toEqual(['All categories', 'Education', 'Gaming', 'Music']);
    await w.find('[data-testid="subs-category"]').setValue('Gaming');
    await flushPromises();
    expect(feedCalls().at(-1)![1].params).toMatchObject({ category: 'Gaming', sort: 'new' });
    await w.find('[data-testid="subs-sort"]').setValue('popular');
    await flushPromises();
    expect(feedCalls().at(-1)![1].params).toMatchObject({ category: 'Gaming', sort: 'popular' });
    // Most viewed has no time order: no day headings.
    expect(w.findAll('.subs-day__title')).toHaveLength(0);
    w.unmount();
  });

  it('"Show more" appends the next page', async () => {
    longTotal = 5;
    const w = await mountPage();
    await w.find('[data-testid="subs-videos-more"]').trigger('click');
    await flushPromises();
    expect(feedCalls().at(-1)![1].params.page).toBe(2);
    expect(w.find('[data-testid="subs-videos"]').text()).toContain('Title p2');
    expect(w.find('[data-testid="subs-videos"]').text()).toContain('Title t1');
    expect(w.find('[data-testid="subs-videos-more"]').exists()).toBe(false);
    w.unmount();
  });

  it('"Mark all as seen" calls the route, then clears every New mark and chip dot', async () => {
    const w = await mountPage();
    expect(w.findAll('[data-testid="new-dot"]').length).toBe(3);
    await w.find('[data-testid="subs-mark-all-seen"]').trigger('click');
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledWith('/api/subscriptions/mark-all-seen', { method: 'POST' });
    expect(w.findAll('[data-testid="new-dot"]')).toHaveLength(0);
    expect(w.findAll('[data-testid="chip-new-dot"]')).toHaveLength(0);
    w.unmount();
  });

  it('keeps the New marks when "Mark all as seen" fails', async () => {
    const base = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url: string, opts: any) => {
      if (url === '/api/subscriptions/mark-all-seen') throw new Error('down');
      return base(url, opts);
    });
    const w = await mountPage();
    await w.find('[data-testid="subs-mark-all-seen"]').trigger('click');
    await flushPromises();
    expect(w.findAll('[data-testid="new-dot"]').length).toBe(3);
    w.unmount();
  });
});

describe('subscriptions page: seen tracking', () => {
  it('marks a new card seen after 2 s at least half visible, in one debounced batch, once per id', async () => {
    const w = await mountPage();
    vi.useFakeTimers();
    const t1 = w.find('[data-testid="subs-card-t1"]').element;
    const t3 = w.find('[data-testid="subs-card-t3"]').element;
    const t2 = w.find('[data-testid="subs-card-t2"]').element;
    setVisible(t2, 1); // not new: never tracked
    setVisible(t1, 0.6);
    setVisible(t3, 0.4); // under half visible: no timer yet
    vi.advanceTimersByTime(500);
    setVisible(t3, 0.7); // t3 counts from here
    vi.advanceTimersByTime(1600); // t = 2.1 s: t1 is queued
    expect(seenCalls()).toHaveLength(0); // still in the debounce window
    vi.advanceTimersByTime(500); // t = 2.6 s: t3 is queued, the debounce starts again
    vi.advanceTimersByTime(800); // t = 3.4 s: t1's own window (3 s) is over, nothing sent yet
    await flushPromises();
    expect(seenCalls()).toHaveLength(0);
    vi.advanceTimersByTime(200);
    await flushPromises();
    expect(seenCalls()).toHaveLength(1);
    expect(seenCalls()[0][1]).toEqual({ method: 'POST', body: { videoIds: ['t1', 't3'] } });
    // Seen again later: no second mark.
    setVisible(t1, 0);
    setVisible(t1, 1);
    vi.advanceTimersByTime(5000);
    await flushPromises();
    expect(seenCalls()).toHaveLength(1);
    w.unmount();
  });

  it('a card that leaves the screen before 2 s is not marked', async () => {
    const w = await mountPage();
    vi.useFakeTimers();
    const t1 = w.find('[data-testid="subs-card-t1"]').element;
    setVisible(t1, 0.8);
    vi.advanceTimersByTime(1900);
    setVisible(t1, 0);
    vi.advanceTimersByTime(5000);
    await flushPromises();
    expect(seenCalls()).toHaveLength(0);
    w.unmount();
  });

  it('opening a new card marks it seen at once', async () => {
    const w = await mountPage();
    await w.find('[data-testid="subs-card-s1"] a.video-title-link').trigger('click');
    await flushPromises();
    expect(seenCalls()).toHaveLength(1);
    expect(seenCalls()[0][1].body).toEqual({ videoIds: ['s1'] });
    w.unmount();
  });

  it('never sends a seen mark for a guest', async () => {
    useState<any>('auth_user').value = null;
    const w = await mountSuspended(SubscriptionsPage, { route: '/subscriptions' });
    live.push(w);
    await flushPromises();
    // A guest is sent to the login page by the middleware; the page itself asks nothing.
    expect(fetchMock.mock.calls.some(([u]) => String(u).startsWith('/api/subscriptions'))).toBe(false);
    w.unmount();
  });
});

describe('subscriptions page: channels', () => {
  it('unsubscribes after the shared confirm dialog, and not when it is cancelled', async () => {
    const w = await mountPage('/subscriptions?tab=channels');
    await w.find('[data-testid="sub-channel-c2"] [data-testid="sub-channel-unsubscribe"]').trigger('click');
    expect(pendingConfirm.value?.confirmLabel).toBe('Unsubscribe');
    answerConfirm(false);
    await flushPromises();
    expect(fetchMock.mock.calls.some(([u]) => u === '/api/channels/c2/unsubscribe')).toBe(false);
    expect(w.find('[data-testid="sub-channel-c2"]').exists()).toBe(true);

    await w.find('[data-testid="sub-channel-c2"] [data-testid="sub-channel-unsubscribe"]').trigger('click');
    expect(pendingConfirm.value?.message).toContain('Two');
    answerConfirm(true);
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledWith('/api/channels/c2/unsubscribe', { method: 'POST' });
    expect(w.find('[data-testid="sub-channel-c2"]').exists()).toBe(false);
    expect(w.find('[data-testid="chip-c2"]').exists()).toBe(false);
    w.unmount();
  });

  it('suggests up to 6 library channels with videos when the viewer follows none', async () => {
    channels = [];
    const base = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url: string, opts: any) => {
      if (url === '/api/channels') {
        return { channels: Array.from({ length: 9 }, (_, i) => ({ id: `L${i}`, title: `Lib ${i}`, avatar_url: null, completed_count: i === 0 ? 0 : i, total_count: i })) };
      }
      return base(url, opts);
    });
    const w = await mountPage();
    expect(w.find('[data-testid="subs-empty"]').text()).toContain('You are not following any channel yet');
    const cards = w.findAll('[data-testid^="channel-card-"]');
    expect(cards).toHaveLength(6);
    expect(w.find('[data-testid="channel-card-L0"]').exists()).toBe(false);
    expect(cards[0].text()).toContain('Lib 8');
    expect(cards[0].find('[data-testid="channel-subscribe"]').text()).toBe('Subscribe');
    expect(feedCalls()).toHaveLength(0);
    w.unmount();
  });
});
