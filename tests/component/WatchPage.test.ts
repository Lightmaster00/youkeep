import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import WatchPage from '../../app/pages/watch/[id].vue';
import { useToast } from '../../app/composables/useToast';
import { manualCopy } from '../../app/utils/clipboard';

// The SSR-side fetch of the playlist panel must go through useRequestFetch
// (forwards the viewer's cookies); a separate mock proves it does.
const { requestFetchMock } = vi.hoisted(() => ({ requestFetchMock: vi.fn() }));
mockNuxtImport('useRequestFetch', () => () => requestFetchMock);

const fetchMock = vi.fn();
let videoReply: any;
let writeText: ReturnType<typeof vi.fn>;

const baseVideo = (extra: any = {}) => ({
  id: 'vid1', title: 'A video', channel_id: 'ch1', channel_title: 'Chan', visibility: 'public',
  publicly_shareable: 1, local_video_path: '/media/v/vid1.mkv', download_status: 'completed', ...extra,
});

beforeEach(() => {
  clearNuxtData();
  useToast().toasts.value.splice(0);
  manualCopy.value = null;
  videoReply = () => ({ video: baseVideo(), comments: [] });
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, opts: any = {}) => {
    if (url.startsWith('/api/videos/vid1/share-link')) return { url: '/watch/vid1?token=tok', token: 'tok', publiclyShareable: false };
    if (url.startsWith('/api/videos/vid1/report')) return { success: true };
    if (url.startsWith('/api/videos/vid1')) return videoReply();
    if (url.startsWith('/api/videos')) return { videos: [] };
    if (url === '/api/playlists/personal' && !opts.method) {
      return { playlists: [
        { id: 'mine', title: 'Mine', visibility: 'private', owner_name: 'bob', contains_video: 0 },
        { id: 'theirs', title: 'Alice public', visibility: 'public', owner_name: 'alice', contains_video: 1 },
      ] };
    }
    return {};
  });
  vi.stubGlobal('$fetch', fetchMock);
  requestFetchMock.mockReset();
  writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  useState('auth_loading').value = false;
});
afterEach(() => {
  vi.unstubAllGlobals();
  useState('auth_user').value = null;
});

const as = (user: any) => { useState<any>('auth_user').value = user; };
const mountWatch = async (query: Record<string, string> = {}) => {
  const w = await mountSuspended(WatchPage, {
    route: { path: '/watch/vid1', query },
    global: { stubs: { VideoPlayer: true } },
    attachTo: document.body,
  });
  await flushPromises();
  return w;
};

describe('watch page share (R10)', () => {
  it('a member copies the plain link of a publicly shareable video', async () => {
    as({ id: 'u1', username: 'bob', role: 'user' });
    const w = await mountWatch();
    await w.find('[data-testid="watch-share"]').trigger('click');
    await flushPromises();
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/watch/vid1`);
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('share-link'))).toBe(false);
    w.unmount();
  });

  it('hides Share from a member when the video is not publicly shareable', async () => {
    as({ id: 'u1', username: 'bob', role: 'user' });
    videoReply = () => ({ video: baseVideo({ publicly_shareable: 0, visibility: 'private' }) });
    const w = await mountWatch();
    expect(w.find('[data-testid="watch-share"]').exists()).toBe(false);
    w.unmount();
  });

  it('an admin copies the absolute share link from the server', async () => {
    as({ id: 'a1', username: 'boss', role: 'admin' });
    videoReply = () => ({ video: baseVideo({ publicly_shareable: 0, visibility: 'private' }) });
    const w = await mountWatch();
    await w.find('[data-testid="watch-share"]').trigger('click');
    await flushPromises();
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/watch/vid1?token=tok`);
    w.unmount();
  });

  it('falls back to a "Copy this link" dialog without a clipboard API (plain HTTP)', async () => {
    as({ id: 'u1', username: 'bob', role: 'user' });
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    (document as any).execCommand = vi.fn(() => false);
    const w = await mountWatch();
    await w.find('[data-testid="watch-share"]').trigger('click');
    await flushPromises();
    expect(manualCopy.value?.text).toBe(`${window.location.origin}/watch/vid1`);
    w.unmount();
  });
});

describe('watch page for guests (R9, #21)', () => {
  it('offers Log in with a redirect back when the video is not found', async () => {
    videoReply = () => { throw Object.assign(new Error('nf'), { statusCode: 404, data: { statusMessage: 'Video not found.' } }); };
    const w = await mountWatch({ token: 'x' });
    const link = w.find('[data-testid="watch-login-hint"] a');
    expect(link.exists()).toBe(true);
    expect(link.attributes('href')).toBe(`/login?redirect=${encodeURIComponent('/watch/vid1?token=x')}`);
    w.unmount();
  });

  it('shows no Log in prompt to a signed-in user', async () => {
    as({ id: 'u1', username: 'bob', role: 'user' });
    videoReply = () => { throw Object.assign(new Error('nf'), { statusCode: 404 }); };
    const w = await mountWatch();
    expect(w.find('[data-testid="watch-login-hint"]').exists()).toBe(false);
    w.unmount();
  });

  it('never shows Report (or Save) to a guest', async () => {
    const w = await mountWatch();
    await w.find('[data-testid="watch-more"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="watch-options-menu"]').exists()).toBe(true);
    expect(w.find('[data-testid="watch-report"]').exists()).toBe(false);
    expect(w.find('[data-testid="watch-options-menu"]').text()).not.toContain('Save');
    w.unmount();
  });
});

describe('watch page report and save (#8, #21)', () => {
  it('reports with the typed reason and confirms with a toast', async () => {
    as({ id: 'u1', username: 'bob', role: 'user' });
    const w = await mountWatch();
    await w.find('[data-testid="watch-more"]').trigger('click');
    await w.find('[data-testid="watch-report"]').trigger('click');
    await flushPromises();
    const reason = document.querySelector('[data-testid="report-reason"]') as HTMLTextAreaElement;
    reason.value = 'Wrong audio track';
    reason.dispatchEvent(new Event('input'));
    await flushPromises();
    (document.querySelector('[data-testid="report-submit"]') as HTMLButtonElement).click();
    await flushPromises();
    const call = fetchMock.mock.calls.find(([u]) => u === '/api/videos/vid1/report');
    expect(call?.[1]).toMatchObject({ method: 'POST', body: { reason: 'Wrong audio track' } });
    expect(useToast().toasts.value.some((t) => t.type === 'success')).toBe(true);
    w.unmount();
  });

  it('the Save dialog lists only the user\'s own playlists, in an accessible dialog', async () => {
    as({ id: 'u1', username: 'bob', role: 'user' });
    const w = await mountWatch();
    await w.find('[data-testid="watch-more"]').trigger('click');
    const save = w.findAll('[role="menuitem"]').find((b) => b.text() === 'Save')!;
    await save.trigger('click');
    await flushPromises();
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog).not.toBeNull();
    expect(dialog.textContent).toContain('Mine');
    expect(dialog.textContent).not.toContain('Alice public');
    expect(dialog.querySelector('button[aria-label="Close"]')).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flushPromises();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    w.unmount();
  });
});

describe('watch page playlist panel (#2, #4)', () => {
  it('fetches the playlist with the request fetch and the share token', async () => {
    requestFetchMock.mockResolvedValue({
      playlist: { id: 'pl1', title: 'Shared list' },
      videos: [
        { id: 'vid1', title: 'A video', download_status: 'completed', position: 1 },
        { id: 'vid2', title: 'Next one', download_status: 'completed', position: 2 },
      ],
    });
    const w = await mountWatch({ playlistId: 'pl1', token: 'tok-pl' });
    expect(requestFetchMock).toHaveBeenCalledWith('/api/playlists/pl1', { params: { token: 'tok-pl' } });
    expect(w.text()).toContain('Shared list');
    expect(w.text()).toContain('Next one');
    w.unmount();
  });
});
