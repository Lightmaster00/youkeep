import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import OverviewActivityCard from '../../app/components/settings/OverviewActivityCard.vue';

let payload: any;

beforeEach(() => {
  useState('admin_active_counts').value = null;
  payload = {
    video: { downloading: 1, pending: 20 },
    music: { downloading: 2, pending: 0 },
    podcasts: { downloading: 0, pending: 5 },
    total: 28,
    current: { kind: 'video', progress: 10, speed: null },
  };
  vi.stubGlobal('$fetch', vi.fn(async () => payload));
});
afterEach(() => vi.unstubAllGlobals());

describe('OverviewActivityCard', () => {
  it('shows what is downloading per type, the total queued and a link to Downloads', async () => {
    const w = await mountSuspended(OverviewActivityCard);
    await flushPromises();
    expect(w.find('[data-testid="overview-activity"]').text()).toContain('Activity');
    expect(w.find('[data-testid="activity-summary"]').text()).toBe('3 downloading now, 25 queued');
    expect(w.find('[data-testid="activity-video"]').text()).toContain('Videos');
    expect(w.find('[data-testid="activity-video"]').text()).toContain('1 downloading · 20 queued');
    expect(w.find('[data-testid="activity-music"]').text()).toContain('2 downloading · 0 queued');
    expect(w.find('[data-testid="activity-podcasts"]').text()).toContain('0 downloading · 5 queued');
    expect(w.find('[data-testid="activity-open-downloads"]').attributes('href')).toBe('/settings?tab=downloads');
  });

  it('says "Nothing is downloading" when idle', async () => {
    payload = { video: { downloading: 0, pending: 0 }, music: { downloading: 0, pending: 0 }, podcasts: { downloading: 0, pending: 0 }, total: 0, current: { kind: null, progress: null, speed: null } };
    const w = await mountSuspended(OverviewActivityCard);
    await flushPromises();
    expect(w.find('[data-testid="activity-summary"]').text()).toBe('Nothing is downloading');
  });
});
