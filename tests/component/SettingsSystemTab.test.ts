import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import SettingsSystemTab from '../../app/components/settings/SettingsSystemTab.vue';

let fetchMock: ReturnType<typeof vi.fn>;
let platforms: any[] = [];

beforeEach(() => {
  platforms = [];
  fetchMock = vi.fn(async (url: string, opts?: any) => {
    if (url === '/api/admin/system/wipe-preview') return { channelCount: 1, videoCount: 2, artistCount: 0, trackCount: 0, showCount: 0, episodeCount: 0, estimatedBytes: 1024 };
    if (url === '/api/admin/system/search-platforms' && opts?.method === 'POST') return { success: true };
    if (url === '/api/admin/system/search-platforms') return { platforms };
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
  it('groups the page under six sections in order', async () => {
    const w = await mountTab();
    const ids = w.findAll('[data-testid^="system-"]').map((s: any) => s.attributes('data-testid'));
    expect(ids).toEqual(['system-modules', 'system-default-display', 'system-search', 'system-tools', 'system-security', 'system-danger']);
    expect(w.find('[data-testid="system-default-display"]').text()).toContain('Default display');
    expect(w.find('[data-testid="system-search"]').text()).toContain('Search providers');
    expect(w.find('[data-testid="system-search"]').text()).toContain('Current space only');
  });

  it('keeps Tools & logs and Danger zone collapsed', async () => {
    const w = await mountTab();
    for (const id of ['system-tools', 'system-security', 'system-danger']) {
      const el = w.find(`[data-testid="${id}"]`);
      expect(el.element.tagName).toBe('DETAILS');
      expect(el.attributes('open')).toBeUndefined();
    }
    expect(w.find('[data-testid="system-tools"] summary').text()).toContain('Tools & logs');
    expect(w.find('[data-testid="system-danger"] summary').text()).toContain('Danger zone');
    expect(w.find('[data-testid="system-security"] summary').text()).toContain('Security log');
  });

  it('reads the security log only once its section is opened', async () => {
    const w = await mountTab();
    const calls = () => fetchMock.mock.calls.filter(([u]) => String(u).startsWith('/api/admin/security-events'));
    expect(calls()).toHaveLength(0);
    const details = w.find('[data-testid="system-security"]');
    (details.element as HTMLDetailsElement).open = true;
    await details.trigger('toggle');
    await flushPromises();
    expect(calls()).toHaveLength(1);
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

describe('SettingsSystemTab search providers', () => {
  const configured = () => [
    { id: 'podcastindex', apiKeyConfigured: true, apiKeyHint: '1234', apiSecretConfigured: true, apiSecretHint: 'abcd', apiKey: '••••1234', apiSecret: '••••abcd' },
    { id: 'listennotes', apiKeyConfigured: false, apiKeyHint: '', apiSecretConfigured: false, apiSecretHint: '', apiKey: '', apiSecret: '' },
  ];
  const posts = () => fetchMock.mock.calls.filter(([u, o]) => u === '/api/admin/system/search-platforms' && o?.method === 'POST');

  it('starts with empty inputs and shows the configured hint as a placeholder', async () => {
    platforms = configured();
    const w = await mountTab();
    const pi = w.find('[data-testid="platform-podcastindex"]');
    const key = pi.find('[data-testid="platform-api-key"]');
    expect((key.element as HTMLInputElement).value).toBe('');
    expect(key.attributes('placeholder')).toBe('Configured (…1234)');
    expect(pi.find('[data-testid="platform-api-secret"]').attributes('placeholder')).toBe('Configured (…abcd)');
    expect(w.html()).not.toContain('••••');
    const ln = w.find('[data-testid="platform-listennotes"]');
    expect(ln.find('[data-testid="platform-api-key"]').attributes('placeholder')).toBe('API key');
    expect(ln.find('[data-testid="platform-clear-key"]').exists()).toBe(false);
  });

  it('sends only the fields the admin typed', async () => {
    platforms = configured();
    const w = await mountTab();
    const pi = w.find('[data-testid="platform-podcastindex"]');
    await pi.find('[data-testid="platform-api-secret"]').setValue('new-secret');
    await pi.trigger('submit');
    await flushPromises();
    expect(posts()).toHaveLength(1);
    expect(posts()[0]![1].body).toEqual({ id: 'podcastindex', apiSecret: 'new-secret' });
  });

  it('does not post when nothing was typed', async () => {
    platforms = configured();
    const w = await mountTab();
    await w.find('[data-testid="platform-podcastindex"]').trigger('submit');
    await flushPromises();
    expect(posts()).toHaveLength(0);
  });

  it('Clear sends clearApiKey / clearApiSecret only', async () => {
    platforms = configured();
    const w = await mountTab();
    const pi = w.find('[data-testid="platform-podcastindex"]');
    await pi.find('[data-testid="platform-clear-key"]').trigger('click');
    await flushPromises();
    await w.find('[data-testid="platform-podcastindex"] [data-testid="platform-clear-secret"]').trigger('click');
    await flushPromises();
    expect(posts().map((c) => c[1].body)).toEqual([
      { id: 'podcastindex', clearApiKey: true },
      { id: 'podcastindex', clearApiSecret: true },
    ]);
  });
});
