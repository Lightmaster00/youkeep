import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import TidyLibraryPanel from '../../app/components/settings/TidyLibraryPanel.vue';

const PREVIEW = {
  total: 3, toMove: 2, alreadyTidy: 1, conflicts: 0, missingFiles: 0, notWritable: 0, duplicateFolders: 0,
  samples: [{ id: 'a', title: 'A', from: '/v/Chan/a.mp4', to: '/v/Chan/A [a]/A [a].mp4' }],
  channels: [{ channelId: 'c1', channel: 'Chan', toMove: 2 }],
  channelNotes: [{ channelId: 'c9', channel: 'YouTube', note: 'Its folder /v/YouTube is left as is: it is shared with other channels.' }],
};
const STATUS = { state: 'idle', processed: 0, total: 0, moved: 0, skipped: 0, errors: 0, lastError: null, errorDetails: [], channelsFixed: 0 };

let fetchMock: ReturnType<typeof vi.fn>;
let statusReplies: any[];
let previewReply: () => any;
let startReply: () => any;

beforeEach(() => {
  statusReplies = [STATUS];
  previewReply = () => PREVIEW;
  startReply = () => ({ started: true });
  fetchMock = vi.fn(async (url: string) => {
    if (url === '/api/admin/library/tidy/preview') return previewReply();
    if (url === '/api/admin/library/tidy/start') return startReply();
    if (url === '/api/admin/library/tidy/status') return statusReplies.length > 1 ? statusReplies.shift() : statusReplies[0];
    if (url === '/api/admin/library/tidy/cancel') return { cancelling: true };
    return {};
  });
  vi.stubGlobal('$fetch', fetchMock);
  vi.stubGlobal('confirm', vi.fn(() => true));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const mountPanel = async () => {
  const w = await mountSuspended(TidyLibraryPanel);
  await flushPromises();
  return w;
};
const startButton = (w: any) => w.find('[data-testid="tidy-start"]').element as HTMLButtonElement;

describe('TidyLibraryPanel', () => {
  it('needs a preview before starting, then shows the report', async () => {
    statusReplies = [STATUS, { ...STATUS, state: 'done', processed: 2, total: 2, moved: 2 }];
    const w = await mountPanel();
    expect(startButton(w).disabled).toBe(true);

    await w.find('[data-testid="tidy-preview-btn"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="tidy-preview"]').text()).toContain('/v/Chan/A [a]/A [a].mp4');
    expect(w.find('[data-testid="tidy-channel-notes"]').text()).toContain('YouTube: Its folder /v/YouTube is left as is: it is shared with other channels.');
    expect(startButton(w).disabled).toBe(false);

    await w.find('[data-testid="tidy-start"]').trigger('click');
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/library/tidy/start', expect.objectContaining({ method: 'POST' }));
    expect(w.find('[data-testid="tidy-report"]').text()).toContain('Tidying finished.');
    expect(w.find('[data-testid="tidy-report"]').text()).toContain('2 moved');
  });

  it('reports unfinished downloads whose partial files will be moved, and lets them start a run alone', async () => {
    previewReply = () => ({ ...PREVIEW, total: 1, toMove: 0, alreadyTidy: 1, unfinishedToMove: 2, unfinishedFiles: 5 });
    const w = await mountPanel();
    await w.find('[data-testid="tidy-preview-btn"]').trigger('click');
    await flushPromises();
    const text = w.find('[data-testid="tidy-unfinished"]').text();
    expect(text).toContain('2 unfinished download(s)');
    expect(text).toContain('5 partial file(s)');
    expect(startButton(w).disabled).toBe(false);

    previewReply = () => ({ ...PREVIEW, toMove: 0, unfinishedToMove: 0, unfinishedFiles: 0 });
    await w.find('[data-testid="tidy-preview-btn"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="tidy-unfinished"]').exists()).toBe(false);
    expect(startButton(w).disabled).toBe(true);
  });

  it('resumes the progress bar of a running tidy and can cancel it', async () => {
    statusReplies = [{ ...STATUS, state: 'running', processed: 1, total: 4, moved: 1 }];
    const w = await mountPanel();
    expect(w.find('[data-testid="tidy-progress"]').text()).toContain('1 of 4');
    await w.find('[data-testid="tidy-cancel"]').trigger('click');
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/library/tidy/cancel', expect.objectContaining({ method: 'POST' }));
    w.unmount();
  });

  it('shows failures: preview error, refused start, failed run', async () => {
    previewReply = () => { throw { data: { statusMessage: 'Disk unavailable' } }; };
    const w = await mountPanel();
    await w.find('[data-testid="tidy-preview-btn"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="tidy-error"]').text()).toContain('Disk unavailable');
    expect(startButton(w).disabled).toBe(true);

    previewReply = () => PREVIEW;
    startReply = () => { throw { data: { statusMessage: 'A library wipe is in progress. Try again when it has finished.' } }; };
    await w.find('[data-testid="tidy-preview-btn"]').trigger('click');
    await flushPromises();
    await w.find('[data-testid="tidy-start"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="tidy-error"]').text()).toContain('library wipe');
    expect(w.find('[data-testid="tidy-report"]').exists()).toBe(false);

    startReply = () => ({ started: true });
    statusReplies = [{ ...STATUS, state: 'failed', errors: 1, lastError: 'Disk full', errorDetails: [{ id: 'a', title: 'A', message: 'Moved file could not be verified' }] }];
    await w.find('[data-testid="tidy-start"]').trigger('click');
    await flushPromises();
    const report = w.find('[data-testid="tidy-report"]').text();
    expect(report).toContain('stopped because of an error');
    expect(report).toContain('Disk full');
    expect(report).toContain('Moved file could not be verified');
  });

  it('polls every second while running, stops when the run ends and when unmounted', async () => {
    vi.useFakeTimers();
    statusReplies = [
      { ...STATUS, state: 'running', processed: 1, total: 4 },
      { ...STATUS, state: 'running', processed: 3, total: 4 },
      { ...STATUS, state: 'done', processed: 4, total: 4, moved: 4 },
    ];
    const w = await mountPanel();
    const statusCalls = () => fetchMock.mock.calls.filter(c => c[0] === '/api/admin/library/tidy/status').length;
    expect(statusCalls()).toBe(1);
    await vi.advanceTimersByTimeAsync(1000);
    await flushPromises();
    expect(w.find('[data-testid="tidy-progress"]').text()).toContain('3 of 4');
    await vi.advanceTimersByTimeAsync(1000);
    await flushPromises();
    expect(w.find('[data-testid="tidy-report"]').exists()).toBe(true);
    expect(statusCalls()).toBe(3);
    await vi.advanceTimersByTimeAsync(5000);
    expect(statusCalls()).toBe(3);
    w.unmount();

    statusReplies = [{ ...STATUS, state: 'running', processed: 1, total: 4 }];
    const w2 = await mountPanel();
    const before = statusCalls();
    w2.unmount();
    await vi.advanceTimersByTimeAsync(5000);
    expect(statusCalls()).toBe(before);
  });

  it('does not start when the confirm is declined, and shows an already-running run on a 409', async () => {
    const w = await mountPanel();
    await w.find('[data-testid="tidy-preview-btn"]').trigger('click');
    await flushPromises();
    (globalThis as any).confirm.mockReturnValueOnce(false);
    await w.find('[data-testid="tidy-start"]').trigger('click');
    await flushPromises();
    expect(fetchMock).not.toHaveBeenCalledWith('/api/admin/library/tidy/start', expect.anything());

    startReply = () => { throw { data: { statusMessage: 'A tidy run is already in progress.' } }; };
    statusReplies = [{ ...STATUS, state: 'running', processed: 2, total: 5 }];
    await w.find('[data-testid="tidy-start"]').trigger('click');
    await flushPromises();
    // The refusal is replaced by the progress of the run already going on.
    expect(w.find('[data-testid="tidy-error"]').exists()).toBe(false);
    expect(w.find('[data-testid="tidy-progress"]').text()).toContain('2 of 5');
    w.unmount();
  });

  it('shows "Preparing..." before the plan is ready, then the next step of the report', async () => {
    vi.useFakeTimers();
    statusReplies = [
      { ...STATUS, state: 'running', processed: 0, total: 0 },
      { ...STATUS, state: 'done', processed: 1, total: 1, moved: 1, channelProblems: [{ channelId: 'c2', channel: 'Dup', message: 'Its doubled folder was not repaired: a video is missing.' }], nextStep: '1 channel(s) could not be repaired yet: run tidying again after fixing the problems listed above.' },
    ];
    const w = await mountPanel();
    expect(w.find('[data-testid="tidy-progress"]').text()).toContain('Preparing...');
    await vi.advanceTimersByTimeAsync(1000);
    await flushPromises();
    expect(w.find('[data-testid="tidy-channel-problems"]').text()).toContain('Dup: Its doubled folder was not repaired');
    expect(w.find('[data-testid="tidy-next-step"]').text()).toContain('could not be repaired yet');
    w.unmount();
  });

  it('stops polling after repeated 401/403 answers and says why', async () => {
    vi.useFakeTimers();
    let calls = 0;
    fetchMock.mockImplementation(async (url: string) => {
      if (url !== '/api/admin/library/tidy/status') return {};
      calls++;
      if (calls === 1) return { ...STATUS, state: 'running', processed: 1, total: 4 };
      throw { statusCode: 401 };
    });
    const w = await mountPanel();
    await vi.advanceTimersByTimeAsync(10000);
    await flushPromises();
    expect(calls).toBe(4); // the first answer, then three refusals
    expect(w.find('[data-testid="tidy-error"]').text()).toContain('no longer signed in');
    w.unmount();
  });
});
