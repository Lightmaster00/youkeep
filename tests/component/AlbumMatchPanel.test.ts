import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import AlbumMatchPanel from '../../app/components/settings/AlbumMatchPanel.vue';
import SettingsSystemTab from '../../app/components/settings/SettingsSystemTab.vue';

const BASE = '/api/admin/music/album-match';
const PREVIEW = { completedTracks: 10, unchecked: 4, matched: 3, unmatched: 2, manual: 1, enabled: true };
const STATUS = { state: 'idle', scope: null, processed: 0, total: 0, matched: 0, unmatched: 0, skipped: 0, errors: 0, lastError: null };

let fetchMock: ReturnType<typeof vi.fn>;
let previewReply: () => any;
let statusReplies: any[];
let startReply: () => any;
let settingsReply: (body: any) => any;

beforeEach(() => {
  previewReply = () => PREVIEW;
  statusReplies = [STATUS];
  startReply = () => ({ started: true, joined: false, queued: 4 });
  settingsReply = (body) => ({ enabled: body.enabled });
  fetchMock = vi.fn(async (url: string, opts?: any) => {
    if (url === `${BASE}/preview`) return previewReply();
    if (url === `${BASE}/status`) return statusReplies.length > 1 ? statusReplies.shift() : statusReplies[0];
    if (url === `${BASE}/start`) return startReply();
    if (url === `${BASE}/cancel`) return { cancelling: true };
    if (url === `${BASE}/settings`) return settingsReply(opts?.body);
    return {};
  });
  vi.stubGlobal('$fetch', fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const mountPanel = async () => {
  const w = await mountSuspended(AlbumMatchPanel);
  await flushPromises();
  return w;
};
const button = (w: any, id: string) => w.find(`[data-testid="${id}"]`).element as HTMLButtonElement;

describe('AlbumMatchPanel', () => {
  it('explains what is sent to Apple and shows the counts on mount', async () => {
    const w = await mountPanel();
    expect(w.find('[data-testid="album-match-privacy"]').text()).toContain("Apple's public iTunes Search API");
    const counts = w.find('[data-testid="album-match-counts"]').text();
    expect(counts).toContain('10 downloaded track(s)');
    expect(counts).toContain('4 not checked yet');
    expect(counts).toContain('2 without a match');
    expect((w.find('[data-testid="album-match-enabled"]').element as HTMLInputElement).checked).toBe(true);
    expect(button(w, 'album-match-start').disabled).toBe(false);
    expect(button(w, 'album-match-retry').disabled).toBe(false);
  });

  it('starts the unchecked backlog, follows the progress, then shows the report', async () => {
    statusReplies = [STATUS, { ...STATUS, state: 'done', processed: 4, total: 4, matched: 3, unmatched: 1 }];
    const w = await mountPanel();
    await w.find('[data-testid="album-match-start"]').trigger('click');
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledWith(`${BASE}/start`, expect.objectContaining({ method: 'POST', body: { scope: 'unchecked' } }));
    const report = w.find('[data-testid="album-match-report"]').text();
    expect(report).toContain('Album matching finished.');
    expect(report).toContain('3 matched, 1 without a match, 0 failed');

    await w.find('[data-testid="album-match-done"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="album-match-report"]').exists()).toBe(false);
    expect(fetchMock.mock.calls.filter((c) => c[0] === `${BASE}/preview`)).toHaveLength(2);
  });

  it('retries the unmatched tracks', async () => {
    const w = await mountPanel();
    await w.find('[data-testid="album-match-retry"]').trigger('click');
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledWith(`${BASE}/start`, expect.objectContaining({ body: { scope: 'unmatched' } }));
  });

  it('disables the buttons when there is nothing to do or matching is off', async () => {
    previewReply = () => ({ ...PREVIEW, unchecked: 0, unmatched: 0 });
    let w = await mountPanel();
    expect(button(w, 'album-match-start').disabled).toBe(true);
    expect(button(w, 'album-match-retry').disabled).toBe(true);
    w.unmount();

    previewReply = () => ({ ...PREVIEW, enabled: false });
    w = await mountPanel();
    expect(button(w, 'album-match-start').disabled).toBe(true);
    expect(button(w, 'album-match-retry').disabled).toBe(true);
    expect(w.text()).toContain('(Off)');
  });

  it('turns matching off and back on, and shows a refused save', async () => {
    const w = await mountPanel();
    const toggle = w.find('[data-testid="album-match-enabled"]');
    await toggle.setValue(false);
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledWith(`${BASE}/settings`, expect.objectContaining({ method: 'POST', body: { enabled: false } }));
    expect(w.text()).toContain('(Off)');
    expect(button(w, 'album-match-start').disabled).toBe(true);

    await toggle.setValue(true);
    await flushPromises();
    expect(w.text()).toContain('(On)');

    settingsReply = () => { throw { data: { statusMessage: 'Forbidden' } }; };
    await toggle.setValue(false);
    await flushPromises();
    expect(w.find('[data-testid="album-match-error"]').text()).toContain('Forbidden');
    expect((toggle.element as HTMLInputElement).checked).toBe(true);
  });

  it('shows a refused start', async () => {
    startReply = () => { throw { data: { statusMessage: 'Album matching is turned off.' } }; };
    const w = await mountPanel();
    await w.find('[data-testid="album-match-start"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="album-match-error"]').text()).toContain('Album matching is turned off.');
  });

  it('resumes the progress of a running run, cancels it, polls every second and stops when unmounted', async () => {
    vi.useFakeTimers();
    statusReplies = [
      { ...STATUS, state: 'running', processed: 1, total: 4, matched: 1 },
      { ...STATUS, state: 'running', processed: 2, total: 4, matched: 2 },
      { ...STATUS, state: 'cancelled', processed: 2, total: 4, matched: 2 },
    ];
    const w = await mountPanel();
    expect(w.find('[data-testid="album-match-progress"]').text()).toContain('1 of 4 tracks checked, 1 matched');
    await w.find('[data-testid="album-match-cancel"]').trigger('click');
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledWith(`${BASE}/cancel`, expect.objectContaining({ method: 'POST' }));
    await vi.advanceTimersByTimeAsync(1000);
    await flushPromises();
    expect(w.find('[data-testid="album-match-progress"]').text()).toContain('2 of 4');
    await vi.advanceTimersByTimeAsync(1000);
    await flushPromises();
    expect(w.find('[data-testid="album-match-report"]').text()).toContain('was stopped');
    const statusCalls = () => fetchMock.mock.calls.filter((c) => c[0] === `${BASE}/status`).length;
    const after = statusCalls();
    await vi.advanceTimersByTimeAsync(5000);
    expect(statusCalls()).toBe(after);
    w.unmount();

    statusReplies = [{ ...STATUS, state: 'running', processed: 1, total: 4 }];
    const w2 = await mountPanel();
    const before = statusCalls();
    w2.unmount();
    await vi.advanceTimersByTimeAsync(5000);
    expect(statusCalls()).toBe(before);
  });

  it('reports a failed run with its error', async () => {
    statusReplies = [STATUS, { ...STATUS, state: 'failed', processed: 5, total: 9, errors: 5, lastError: 'iTunes did not answer 5 times in a row: 503' }];
    const w = await mountPanel();
    await w.find('[data-testid="album-match-start"]').trigger('click');
    await flushPromises();
    const report = w.find('[data-testid="album-match-report"]').text();
    expect(report).toContain('stopped because of an error');
    expect(report).toContain('iTunes did not answer 5 times in a row');
  });
});

describe('SettingsSystemTab', () => {
  it('shows the album matching tool under Tools & logs', async () => {
    const w = await mountSuspended(SettingsSystemTab);
    await flushPromises();
    expect(w.find('[data-testid="system-tools"] [data-testid="album-match-panel"]').exists()).toBe(true);
  });
});
