import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import OverviewReportsCard from '../../app/components/settings/OverviewReportsCard.vue';

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async (url: string, opts: any = {}) => {
    if (url === '/api/admin/reports') {
      return { reports: [{ id: 'r1', videoId: 'v1', videoTitle: 'Sushi', channelTitle: 'Cooking', reporter: 'bob', reason: 'Wrong audio', createdAt: Date.UTC(2026, 0, 2) }] };
    }
    if (url === '/api/admin/reports/r1' && opts.method === 'DELETE') return { success: true };
    return {};
  });
  vi.stubGlobal('$fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('Settings → Overview reports card (#21)', () => {
  it('lists reports with a link to the video and dismisses one', async () => {
    const w = await mountSuspended(OverviewReportsCard);
    await flushPromises();
    const item = w.find('[data-testid="report-r1"]');
    expect(item.text()).toContain('Wrong audio');
    expect(item.text()).toContain('Cooking');
    expect(item.find('a').attributes('href')).toBe('/watch/v1');
    await item.find('button').trigger('click');
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/reports/r1', { method: 'DELETE' });
    expect(w.find('[data-testid="reports-empty"]').exists()).toBe(true);
  });
});
