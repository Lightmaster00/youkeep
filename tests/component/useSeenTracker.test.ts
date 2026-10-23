import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { useSeenTracker, SEEN_MAX_BATCH } from '../../app/composables/useSeenTracker';

// The seen-mark batching of the Subscriptions page, on its own.
let fetchMock: ReturnType<typeof vi.fn>;
class FakeIO {
  static instances: FakeIO[] = [];
  targets = new Set<Element>();
  constructor(public cb: (entries: any[]) => void) { FakeIO.instances.push(this); }
  observe(el: Element) { this.targets.add(el); }
  unobserve(el: Element) { this.targets.delete(el); }
  disconnect() { this.targets.clear(); }
}

beforeEach(() => {
  FakeIO.instances = [];
  vi.stubGlobal('IntersectionObserver', FakeIO);
  fetchMock = vi.fn(async () => ({ marked: 1 }));
  vi.stubGlobal('$fetch', fetchMock);
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function withTracker(enabled: boolean) {
  let api!: ReturnType<typeof useSeenTracker>;
  const w = mount(defineComponent({ setup() { api = useSeenTracker({ enabled: () => enabled }); return () => h('div'); } }));
  return { w, api: () => api };
}

describe('useSeenTracker', () => {
  it('never observes or sends anything for a guest', async () => {
    const { w, api } = withTracker(false);
    const el = document.createElement('div');
    api().observe(el, 'v1');
    api().markOpened('v2');
    expect(FakeIO.instances).toHaveLength(0);
    vi.advanceTimersByTime(10_000);
    w.unmount();
    await flushPromises();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('splits a big batch into requests of at most 200 ids and sends the rest when the page goes', async () => {
    const { w, api } = withTracker(true);
    for (let i = 0; i < SEEN_MAX_BATCH + 5; i++) api().markOpened(`v${i}`);
    await flushPromises();
    // markOpened sends at once: one id per request here.
    expect(fetchMock).toHaveBeenCalledTimes(SEEN_MAX_BATCH + 5);
    fetchMock.mockClear();
    const els = Array.from({ length: SEEN_MAX_BATCH + 3 }, () => document.createElement('div'));
    els.forEach((el, i) => api().observe(el, `w${i}`));
    for (const io of FakeIO.instances) io.cb(els.map((target) => ({ target, isIntersecting: true, intersectionRatio: 1 })));
    vi.advanceTimersByTime(2000);
    await flushPromises();
    // The 200th id flushed a full batch at once; the other 3 wait for the debounce...
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].body.videoIds).toHaveLength(SEEN_MAX_BATCH);
    // ...or for the page to go.
    w.unmount();
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1].body.videoIds).toEqual(['w200', 'w201', 'w202']);
  });

  it('tries an id again after a failed request', async () => {
    const { w, api } = withTracker(true);
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    api().markOpened('v1');
    await flushPromises();
    api().markOpened('v1');
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    api().markOpened('v1');
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    w.unmount();
  });
});
