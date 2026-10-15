import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import ServerResponsivenessPanel from '../../app/components/settings/ServerResponsivenessPanel.vue';

const summary = (maxMs: number, extra: Partial<{ p99Ms: number; stalls: number; current: number; activeDownloads: number }> = {}) => ({
  current: { maxMs: extra.current ?? 12, p99Ms: 8 },
  last15min: { maxMs, p99Ms: extra.p99Ms ?? 40, stalls: extra.stalls ?? 0 },
  activeDownloads: extra.activeDownloads ?? 0,
});

let reply: () => any;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  reply = () => summary(20);
  fetchMock = vi.fn(async (url: string) => {
    if (url === '/api/admin/system/perf') return reply();
    return {};
  });
  vi.stubGlobal('$fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const mountPanel = async () => {
  const w = await mountSuspended(ServerResponsivenessPanel);
  await flushPromises();
  return w;
};
const level = (w: any) => w.find('[data-testid="responsiveness-level"]');

describe('ServerResponsivenessPanel', () => {
  it.each([
    [0, 'Responsive', 'badge-success'],
    [99.4, 'Responsive', 'badge-success'],
    [100, 'Slow at times', 'badge-warning'],
    [499, 'Slow at times', 'badge-warning'],
    [500, 'Stalling', 'badge-danger'],
    [2400, 'Stalling', 'badge-danger'],
  ])('a longest pause of %s ms reads "%s"', async (maxMs, label, badge) => {
    reply = () => summary(maxMs);
    const w = await mountPanel();
    expect(level(w).text()).toBe(label);
    expect(level(w).classes()).toContain(badge);
  });

  it('shows the last-15-minutes numbers, the current delay, running downloads and the disk note', async () => {
    reply = () => summary(812.6, { p99Ms: 300.2, stalls: 3, current: 45, activeDownloads: 2 });
    const w = await mountPanel();
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/system/perf');
    const numbers = w.find('[data-testid="responsiveness-numbers"]').text().replace(/\s+/g, ' ');
    expect(numbers).toBe('Last 15 minutes: longest pause 813 ms, p99 300 ms, 3 stalls. Now: 45 ms. 2 downloads running.');
    expect(w.text()).toContain('keep appdata on an SSD/cache drive');
  });

  it('refreshes on demand', async () => {
    const w = await mountPanel();
    expect(level(w).text()).toBe('Responsive');
    reply = () => summary(700, { stalls: 1, activeDownloads: 1 });
    await w.find('[data-testid="responsiveness-refresh"]').trigger('click');
    await flushPromises();
    expect(level(w).text()).toBe('Stalling');
    expect(w.find('[data-testid="responsiveness-numbers"]').text()).toContain('1 stall.');
    expect(w.find('[data-testid="responsiveness-numbers"]').text()).toContain('1 download running.');
  });

  it('a failed or malformed answer shows an error instead of numbers', async () => {
    reply = () => { throw new Error('boom'); };
    const w = await mountPanel();
    expect(w.find('[data-testid="responsiveness-error"]').exists()).toBe(true);
    expect(level(w).exists()).toBe(false);

    reply = () => ({});
    const malformed = await mountPanel();
    expect(malformed.find('[data-testid="responsiveness-error"]').exists()).toBe(true);
  });
});
