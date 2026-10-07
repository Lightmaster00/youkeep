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
    expect(rowOrder(w)).toEqual(['popular', 'recent', 'suggested', 'subscriptions', 'recentMusic', 'newEpisodes']);
  });

  it('lists the music and podcast rows unticked by default, with English labels', async () => {
    useState<any>('modules').value = { video: true, music: true, podcasts: true };
    const w = await mountSuspended(DisplayPrefsForm, { props: { mode: 'user' } });
    const row = (id: string) => w.find(`[data-testid="section-row-${id}"]`);
    expect(row('recentMusic').text()).toContain('Recently added music');
    expect(row('newEpisodes').text()).toContain('New podcast episodes');
    expect((row('recentMusic').find('input').element as HTMLInputElement).checked).toBe(false);
    expect((row('newEpisodes').find('input').element as HTMLInputElement).checked).toBe(false);
  });

  it('opts in to a music row by appending it to the stored order', async () => {
    fetchMock.mockResolvedValue(buildView({}, { homeSections: ['recent', 'popular', 'suggested', 'subscriptions', 'recentMusic'] }));
    const w = await mountSuspended(DisplayPrefsForm, { props: { mode: 'user' } });
    await w.find('[data-testid="section-row-recentMusic"] input[type="checkbox"]').setValue(true);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][1].body).toEqual({ homeSections: ['recent', 'popular', 'suggested', 'subscriptions', 'recentMusic'] });
  });

  it('marks the row of a module that is off', async () => {
    useState<any>('modules').value = { video: true, music: false, podcasts: true };
    const w = await mountSuspended(DisplayPrefsForm, { props: { mode: 'admin' } });
    expect(w.find('[data-testid="section-row-recentMusic"]').text()).toContain('module off');
    expect(w.find('[data-testid="section-row-newEpisodes"]').text()).not.toContain('module off');
    useState<any>('modules').value = { video: true, music: true, podcasts: true };
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
    for (const id of ['suggested', 'subscriptions', 'recentMusic', 'newEpisodes']) {
      expect(dis(`up-${id}`)).toBe(true);
      expect(dis(`down-${id}`)).toBe(true);
    }
  });

  it('sends numbers (not strings) for the size selects and keeps the new value in the DOM after a successful save', async () => {
    fetchMock.mockResolvedValue(buildView({}, { rowSize: 20 }));
    const w = await mountSuspended(DisplayPrefsForm, { props: { mode: 'user' } });
    const sel = w.find('select[id$="-rowsize"]');
    await sel.setValue('20');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][1].body).toEqual({ rowSize: 20 });
    await vi.waitFor(() => expect(w.find('select[id$="-rowsize"]').attributes('disabled')).toBeUndefined());
    expect((sel.element as HTMLSelectElement).value).toBe('20');
  });

  it('gives each move button a row-specific aria-label', async () => {
    const w = await mountSuspended(DisplayPrefsForm, { props: { mode: 'user' } });
    expect(w.find('[data-testid="up-popular"]').attributes('aria-label')).toBe('Move Popular up');
    expect(w.find('[data-testid="down-popular"]').attributes('aria-label')).toBe('Move Popular down');
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

});

describe('DisplayPrefsForm — modes', () => {
  // Disjoint keys: the admin default is rowSize, the personal override is density,
  // so which reset links show proves which source each mode reads.
  const state = () => { useState<any>('display_prefs').value = buildView({ rowSize: 10 }, { density: 'compact' }); };
  const resetLabelFor = (w: any, link: any) =>
    link.element.parentElement.querySelector('label').getAttribute('for').replace(/^.*-/, '');

  it('admin mode shows the instance default, a reset link, and saves to the admin endpoint', async () => {
    state();
    fetchMock.mockResolvedValue(buildView({ rowSize: 20 }, { density: 'compact' }));
    const w = await mountSuspended(DisplayPrefsForm, { props: { mode: 'admin' } });
    const sel = w.find('select[id$="-rowsize"]');
    expect((sel.element as HTMLSelectElement).value).toBe('10');
    const links = w.findAll('a.reset-link');
    expect(links.length).toBe(1);
    expect(resetLabelFor(w, links[0])).toBe('rowsize');
    await sel.setValue('20');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/admin/settings/display-defaults');
    expect(opts.method).toBe('POST');
    expect(opts.body).toEqual({ rowSize: 20 });
    await vi.waitFor(() => expect(w.findAll('a.reset-link').length).toBe(1));
    await w.find('a.reset-link').trigger('click');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][0]).toBe('/api/admin/settings/display-defaults');
    expect(fetchMock.mock.calls[1][1].body).toEqual({ rowSize: null });
  });

  it('user mode shows the effective value and only the density reset link, which sends { density: null } to the user endpoint', async () => {
    state();
    fetchMock.mockResolvedValue(buildView({ rowSize: 10 }, {}));
    const w = await mountSuspended(DisplayPrefsForm, { props: { mode: 'user' } });
    expect((w.find('select[id$="-rowsize"]').element as HTMLSelectElement).value).toBe('10');
    expect((w.find('select[id$="-density"]').element as HTMLSelectElement).value).toBe('compact');
    const links = w.findAll('a.reset-link');
    expect(links.length).toBe(1);
    expect(resetLabelFor(w, links[0])).toBe('density');
    await links[0]!.trigger('click');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/account/preferences');
    expect(opts.body).toEqual({ density: null });
  });

});
