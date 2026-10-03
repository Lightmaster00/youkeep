import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useDisplayPrefs } from '../../app/composables/useDisplayPrefs';
import { APP_DEFAULTS, buildView } from '../../shared/displayPrefs';

const fetchMock = vi.fn();
vi.stubGlobal('$fetch', fetchMock);

function setUser(id: string | null) {
  useState<any>('auth_user').value = id ? { id, username: id, role: 'user' } : null;
}

beforeEach(() => {
  fetchMock.mockReset();
  useState<any>('display_prefs').value = buildView({}, null);
  useState<any>('display_prefs_for').value = undefined;
  setUser(null);
});

describe('useDisplayPrefs', () => {
  it('starts with the app defaults', () => {
    const { effective } = useDisplayPrefs();
    expect(effective.value).toEqual(APP_DEFAULTS);
  });

  it('ensureLoaded fetches the view once for the same user', async () => {
    fetchMock.mockResolvedValue(buildView({ density: 'compact' }, null));
    const { ensureLoaded, effective } = useDisplayPrefs();
    await ensureLoaded();
    await ensureLoaded();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/settings/display');
    expect(effective.value.density).toBe('compact');
  });

  it('refetches when the logged-in user changes (login / logout)', async () => {
    fetchMock.mockResolvedValue(buildView({}, null));
    const { ensureLoaded } = useDisplayPrefs();
    await ensureLoaded();
    setUser('u1');
    await ensureLoaded();
    setUser(null);
    await ensureLoaded();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('keeps the app defaults when the fetch fails', async () => {
    fetchMock.mockRejectedValue(new Error('network'));
    const { ensureLoaded, effective } = useDisplayPrefs();
    await ensureLoaded();
    expect(effective.value.density).toBe('comfortable');
  });

  it('keeps the loaded view when a later refresh fails', async () => {
    const loaded = buildView({}, { density: 'compact' });
    fetchMock.mockResolvedValueOnce(loaded);
    const { refresh, effective } = useDisplayPrefs();
    await refresh();
    fetchMock.mockRejectedValueOnce(new Error('network'));
    await refresh();
    expect(effective.value.density).toBe('compact');
    expect(useState<any>('display_prefs').value).toEqual(loaded);
  });

  it('falls back to the app defaults when the first load fails', async () => {
    useState<any>('display_prefs').value = buildView({ density: 'spacious' }, null);
    fetchMock.mockRejectedValueOnce(new Error('network'));
    const { refresh, effective } = useDisplayPrefs();
    await refresh();
    expect(effective.value).toEqual(APP_DEFAULTS);
  });

  it('does not keep the previous user view when the refresh for a different user fails', async () => {
    setUser('u1');
    fetchMock.mockResolvedValueOnce(buildView({}, { density: 'compact' }));
    const { refresh, effective } = useDisplayPrefs();
    await refresh();
    expect(effective.value.density).toBe('compact');
    setUser('u2');
    fetchMock.mockRejectedValueOnce(new Error('network'));
    await refresh();
    expect(effective.value).toEqual(APP_DEFAULTS);
    expect(useState<any>('display_prefs_for').value).toBe('u2');
  });

  it('saveOverrides PUTs the partial and applies the returned view', async () => {
    const returned = buildView({}, { density: 'spacious' });
    fetchMock.mockResolvedValueOnce(returned);
    const { saveOverrides, view } = useDisplayPrefs();
    const result = await saveOverrides({ density: 'spacious' });
    expect(fetchMock).toHaveBeenCalledWith('/api/account/preferences', { method: 'PUT', body: { density: 'spacious' } });
    expect(result).toEqual(returned);
    expect(view.value.overrides).toEqual({ density: 'spacious' });
  });

  it('saveAdminDefaults POSTs the partial and applies the returned view', async () => {
    const returned = buildView({ landingSpace: 'music' }, {});
    fetchMock.mockResolvedValueOnce(returned);
    const { saveAdminDefaults, effective } = useDisplayPrefs();
    await saveAdminDefaults({ landingSpace: 'music' });
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/settings/display-defaults', { method: 'POST', body: { landingSpace: 'music' } });
    expect(effective.value.landingSpace).toBe('music');
  });

  it('leaves the state untouched and rethrows when a save fails', async () => {
    fetchMock.mockRejectedValueOnce(Object.assign(new Error('bad'), { data: { statusMessage: 'Invalid' } }));
    const { saveOverrides, effective } = useDisplayPrefs();
    await expect(saveOverrides({ density: 'compact' })).rejects.toThrow('bad');
    expect(effective.value.density).toBe('comfortable');
  });
});
