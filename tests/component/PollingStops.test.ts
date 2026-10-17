import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import { createPoller } from '../../app/utils/poller';
import SettingsSystemTab from '../../app/components/settings/SettingsSystemTab.vue';

// A request that stays in flight until released, to unmount mid-poll.
function deferred() {
  let release!: (v: any) => void;
  const promise = new Promise((resolve) => { release = resolve; });
  return { promise, release };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('wipe status polling', () => {
  it('stops when the tab unmounts, even mid-request', async () => {
    useState<any>('auth_user').value = null;
    let hold: ReturnType<typeof deferred> | null = null;
    const fetchMock = vi.fn(async (url: string, opts?: any) => {
      if (url === '/api/admin/system/wipe-all' && opts?.method === 'POST') return { success: true };
      if (url === '/api/admin/system/wipe-status') {
        if (hold) return hold.promise;
        return { inProgress: true, current: null, report: null };
      }
      if (url === '/api/admin/system/wipe-preview') return { channelCount: 0, videoCount: 0, artistCount: 0, trackCount: 0, showCount: 0, episodeCount: 0, estimatedBytes: 0 };
      if (url === '/api/admin/system/search-platforms') return { platforms: [] };
      return {};
    });
    vi.stubGlobal('$fetch', fetchMock);
    const w = await mountSuspended(SettingsSystemTab);
    await flushPromises();
    const danger = w.find('[data-testid="system-danger"]');
    await danger.findAll('button').find((b: any) => b.text() === 'Show what will be deleted')!.trigger('click');
    await flushPromises();
    await danger.find('input').setValue('DELETE');
    vi.useFakeTimers();
    await danger.findAll('button').find((b: any) => b.text() === 'Delete everything')!.trigger('click');
    await vi.advanceTimersByTimeAsync(2500);
    const statusCalls = () => fetchMock.mock.calls.filter(([u]) => u === '/api/admin/system/wipe-status').length;
    expect(statusCalls()).toBeGreaterThanOrEqual(2);
    hold = deferred();
    await vi.advanceTimersByTimeAsync(1000);
    w.unmount();
    hold.release({ inProgress: true, current: null, report: null });
    await flushPromises();
    const before = statusCalls();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(statusCalls()).toBe(before);
  });
});

describe('createPoller', () => {
  it('never re-arms once stopped while a run is in flight', async () => {
    vi.useFakeTimers();
    let hold: ReturnType<typeof deferred> | null = null;
    const task = vi.fn(async () => { if (hold) await hold.promise; });
    const poller = createPoller(task, () => 1000);
    poller.start();
    await vi.advanceTimersByTimeAsync(2500);
    expect(task).toHaveBeenCalledTimes(3);
    hold = deferred();
    await vi.advanceTimersByTimeAsync(1000);
    expect(task).toHaveBeenCalledTimes(4);
    poller.stop();
    hold.release(undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(task).toHaveBeenCalledTimes(4);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps polling after a failed run and stops when nextDelay returns null', async () => {
    vi.useFakeTimers();
    let runs = 0;
    const poller = createPoller(async () => { runs++; if (runs === 1) throw new Error('down'); }, () => (runs >= 3 ? null : 500));
    poller.start();
    await vi.advanceTimersByTimeAsync(5000);
    expect(runs).toBe(3);
    expect(vi.getTimerCount()).toBe(0);
    poller.stop();
  });
});
