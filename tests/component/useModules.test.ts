import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useModules } from '../../app/composables/useModules';

const fetchMock = vi.fn();
vi.stubGlobal('$fetch', fetchMock);

beforeEach(() => {
  fetchMock.mockReset();
  const { modules } = useModules();
  modules.value = { video: true, music: true, podcasts: true };
  useState<boolean>('modules_loaded').value = false;
});

describe('useModules', () => {
  it('treats every module as enabled before anything is fetched', () => {
    const { isEnabled, enabledModules, firstEnabledHome } = useModules();
    expect(isEnabled('video')).toBe(true);
    expect(enabledModules.value).toEqual(['video', 'music', 'podcasts']);
    expect(firstEnabledHome.value).toBe('/');
    expect(isEnabled('something-else')).toBe(true); // unknown id: treated as enabled
  });

  it('refresh() loads the states from /api/settings/modules', async () => {
    fetchMock.mockResolvedValueOnce({ video: false, music: true, podcasts: false });
    const { refresh, isEnabled, enabledModules } = useModules();
    await refresh();
    expect(fetchMock).toHaveBeenCalledWith('/api/settings/modules');
    expect(isEnabled('video')).toBe(false);
    expect(isEnabled('music')).toBe(true);
    expect(enabledModules.value).toEqual(['music']);
  });

  it('firstEnabledHome follows the order video, music, podcasts', async () => {
    fetchMock.mockResolvedValueOnce({ video: false, music: false, podcasts: true });
    const { refresh, firstEnabledHome } = useModules();
    await refresh();
    expect(firstEnabledHome.value).toBe('/podcasts');

    fetchMock.mockResolvedValueOnce({ video: false, music: true, podcasts: true });
    await refresh();
    expect(firstEnabledHome.value).toBe('/music');
  });

  it('treats a missing key in the response as enabled, and everything as enabled when the fetch fails', async () => {
    fetchMock.mockResolvedValueOnce({ music: false });
    const { refresh, isEnabled, enabledModules } = useModules();
    await refresh();
    expect(enabledModules.value).toEqual(['video', 'podcasts']);
    fetchMock.mockRejectedValueOnce(new Error('network'));
    await refresh();
    expect(isEnabled('music')).toBe(true);
    expect(enabledModules.value).toEqual(['video', 'music', 'podcasts']);
  });

  it('ensureLoaded() fetches once, then reuses the loaded state', async () => {
    fetchMock.mockResolvedValue({ video: true, music: false, podcasts: true });
    const { ensureLoaded } = useModules();
    await ensureLoaded();
    await ensureLoaded();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

});
