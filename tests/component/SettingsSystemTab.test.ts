import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import SettingsSystemTab from '../../app/components/settings/SettingsSystemTab.vue';

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async (url: string, opts?: any) => {
    if (url === '/api/admin/system/wipe-preview') return { channelCount: 1, videoCount: 2, artistCount: 0, trackCount: 0, showCount: 0, episodeCount: 0, estimatedBytes: 1024 };
    if (url === '/api/admin/system/search-platforms') return { platforms: [] };
    if (url === '/api/settings/content-search-mode') return { mode: 'per_space' };
    if (url === '/api/admin/downloader/logs') return { logs: ['[info] started'], ytdlPath: '/usr/bin/yt-dlp' };
    if (url === '/api/admin/system/wipe-all' && opts?.method === 'POST') return { success: true };
    return {};
  });
  vi.stubGlobal('$fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const mountTab = async () => {
  const w = await mountSuspended(SettingsSystemTab);
  await flushPromises();
  return w;
};

describe('SettingsSystemTab', () => {
  it('groups the page under five sections in order', async () => {
    const w = await mountTab();
    const ids = w.findAll('[data-testid^="system-"]').map((s: any) => s.attributes('data-testid'));
    expect(ids).toEqual(['system-modules', 'system-default-display', 'system-search', 'system-tools', 'system-danger']);
    expect(w.find('[data-testid="system-default-display"]').text()).toContain('Default display');
    expect(w.find('[data-testid="system-search"]').text()).toContain('Search providers');
    expect(w.find('[data-testid="system-search"]').text()).toContain('Current space only');
  });

  it('keeps Tools & logs and Danger zone collapsed', async () => {
    const w = await mountTab();
    for (const id of ['system-tools', 'system-danger']) {
      const el = w.find(`[data-testid="${id}"]`);
      expect(el.element.tagName).toBe('DETAILS');
      expect(el.attributes('open')).toBeUndefined();
    }
    expect(w.find('[data-testid="system-tools"] summary').text()).toContain('Tools & logs');
    expect(w.find('[data-testid="system-danger"] summary').text()).toContain('Danger zone');
  });

  it('loads the log on mount', async () => {
    await mountTab();
    expect(fetchMock.mock.calls.some(([u]) => u === '/api/admin/downloader/logs')).toBe(true);
  });

  it('asks for the word DELETE before wiping', async () => {
    const w = await mountTab();
    const danger = w.find('[data-testid="system-danger"]');
    await danger.findAll('button').find((b: any) => b.text() === 'Show what will be deleted')!.trigger('click');
    await flushPromises();
    const wipe = () => danger.findAll('button').find((b: any) => b.text() === 'Delete everything')!;
    expect((wipe().element as HTMLButtonElement).disabled).toBe(true);
    await danger.find('input').setValue('SUPPRIMER');
    expect((wipe().element as HTMLButtonElement).disabled).toBe(true);
    await danger.find('input').setValue('DELETE');
    expect((wipe().element as HTMLButtonElement).disabled).toBe(false);
  });
});
