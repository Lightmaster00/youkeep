import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import DisplayPrefsForm from '../../app/components/DisplayPrefsForm.vue';
import { buildView } from '../../shared/displayPrefs';

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('$fetch', fetchMock);
  useState<any>('display_prefs').value = buildView({}, {});
  useState<any>('display_prefs_for').value = undefined;
});
afterEach(() => vi.unstubAllGlobals());

const rowOrder = (w: any) =>
  w.findAll('[data-testid^="section-row-"]').map((r: any) => r.attributes('data-testid').replace('section-row-', ''));

describe('DisplayPrefsForm — home section', () => {
  it('lists visible sections in order, then hidden ones', async () => {
    useState<any>('display_prefs').value = buildView({}, { homeSections: ['popular', 'recent'] });
    const w = await mountSuspended(DisplayPrefsForm, { props: { mode: 'user' } });
    expect(rowOrder(w)).toEqual(['popular', 'recent', 'suggested', 'subscriptions']);
  });

  it('disables ↑ on the first visible row and ↓ on the last visible row', async () => {
    const w = await mountSuspended(DisplayPrefsForm, { props: { mode: 'user' } });
    expect(w.find('[data-testid="up-recent"]').attributes('disabled')).toBeDefined();
    expect(w.find('[data-testid="down-subscriptions"]').attributes('disabled')).toBeDefined();
    expect(w.find('[data-testid="down-recent"]').attributes('disabled')).toBeUndefined();
  });

  it('sends the swapped array when ↓ is clicked', async () => {
    fetchMock.mockResolvedValue(buildView({}, { homeSections: ['popular', 'recent', 'suggested', 'subscriptions'] }));
    const w = await mountSuspended(DisplayPrefsForm, { props: { mode: 'user' } });
    await w.find('[data-testid="down-recent"]').trigger('click');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/account/preferences');
    expect(opts.method).toBe('PUT');
    expect(opts.body).toEqual({ homeSections: ['popular', 'recent', 'suggested', 'subscriptions'] });
  });

  it('removes a section from the array when its checkbox is unticked', async () => {
    fetchMock.mockResolvedValue(buildView({}, { homeSections: ['recent', 'suggested', 'subscriptions'] }));
    const w = await mountSuspended(DisplayPrefsForm, { props: { mode: 'user' } });
    const box = w.find('[data-testid="section-row-popular"] input[type="checkbox"]');
    await box.setValue(false);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][1].body).toEqual({ homeSections: ['recent', 'suggested', 'subscriptions'] });
  });

  it('appends a re-enabled section at the end (not canonical order)', async () => {
    useState<any>('display_prefs').value = buildView({}, { homeSections: ['popular'] });
    fetchMock.mockResolvedValue(buildView({}, { homeSections: ['popular', 'recent'] }));
    const w = await mountSuspended(DisplayPrefsForm, { props: { mode: 'user' } });
    await w.find('[data-testid="section-row-recent"] input[type="checkbox"]').setValue(true);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][1].body).toEqual({ homeSections: ['popular', 'recent'] });
  });

  it('applies move boundaries to visible rows only; hidden rows have no moves', async () => {
    useState<any>('display_prefs').value = buildView({}, { homeSections: ['popular', 'recent'] });
    const w = await mountSuspended(DisplayPrefsForm, { props: { mode: 'user' } });
    const dis = (id: string) => w.find(`[data-testid="${id}"]`).attributes('disabled') !== undefined;
    expect(dis('down-recent')).toBe(true);
    expect(dis('up-popular')).toBe(true);
    expect(dis('down-popular')).toBe(false);
    expect(dis('up-recent')).toBe(false);
    for (const id of ['suggested', 'subscriptions']) {
      expect(dis(`up-${id}`)).toBe(true);
      expect(dis(`down-${id}`)).toBe(true);
    }
  });

  it('keeps the new value in the DOM after a successful save', async () => {
    fetchMock.mockResolvedValue(buildView({}, { rowSize: 20 }));
    const w = await mountSuspended(DisplayPrefsForm, { props: { mode: 'user' } });
    const sel = w.find('select[id$="-rowsize"]');
    await sel.setValue('20');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await vi.waitFor(() => expect(w.find('select[id$="-rowsize"]').attributes('disabled')).toBeUndefined());
    expect((sel.element as HTMLSelectElement).value).toBe('20');
  });

  it('sends null when the reset link is clicked', async () => {
    useState<any>('display_prefs').value = buildView({}, { rowSize: 20 });
    fetchMock.mockResolvedValue(buildView({}, {}));
    const w = await mountSuspended(DisplayPrefsForm, { props: { mode: 'user' } });
    const link = w.findAll('a.reset-link');
    expect(link.length).toBe(1);
    await link[0]!.trigger('click');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][1].body).toEqual({ rowSize: null });
  });

  it('gives each move button a row-specific aria-label', async () => {
    const w = await mountSuspended(DisplayPrefsForm, { props: { mode: 'user' } });
    expect(w.find('[data-testid="up-popular"]').attributes('aria-label')).toBe('Monter Populaires');
    expect(w.find('[data-testid="down-popular"]').attributes('aria-label')).toBe('Descendre Populaires');
  });

  it('snaps the hero checkbox back after a failed save', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/settings/display') return buildView({}, {});
      throw { data: { statusMessage: 'nope' } };
    });
    const w = await mountSuspended(DisplayPrefsForm, { props: { mode: 'user' } });
    const box = w.find('[data-testid="hero-toggle"]');
    expect((box.element as HTMLInputElement).checked).toBe(true);
    await box.setValue(false);
    await vi.waitFor(() => expect((box.element as HTMLInputElement).checked).toBe(true));
  });

  it('sends numbers (not strings) for the size selects', async () => {
    fetchMock.mockResolvedValue(buildView({}, { rowSize: 20 }));
    const w = await mountSuspended(DisplayPrefsForm, { props: { mode: 'user' } });
    await w.find('select[id$="-rowsize"]').setValue('20');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][1].body).toEqual({ rowSize: 20 });
  });
});

describe('DisplayPrefsForm — modes', () => {
  const state = () => { useState<any>('display_prefs').value = buildView({ rowSize: 10 }, { rowSize: 30 }); };

  it('admin mode shows the instance default, a reset link, and saves to the admin endpoint', async () => {
    state();
    fetchMock.mockResolvedValue(buildView({ rowSize: 20 }, { rowSize: 30 }));
    const w = await mountSuspended(DisplayPrefsForm, { props: { mode: 'admin' } });
    const sel = w.find('select[id$="-rowsize"]');
    expect((sel.element as HTMLSelectElement).value).toBe('10');
    expect(w.findAll('a.reset-link').length).toBe(1);
    await sel.setValue('20');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/admin/settings/display-defaults');
    expect(opts.method).toBe('POST');
    expect(opts.body).toEqual({ rowSize: 20 });
  });

  it('user mode shows the effective (personal) value', async () => {
    state();
    const w = await mountSuspended(DisplayPrefsForm, { props: { mode: 'user' } });
    expect((w.find('select[id$="-rowsize"]').element as HTMLSelectElement).value).toBe('30');
  });
});
