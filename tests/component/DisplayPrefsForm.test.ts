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

  it('appends a re-enabled section at the end', async () => {
    useState<any>('display_prefs').value = buildView({}, { homeSections: ['recent'] });
    fetchMock.mockResolvedValue(buildView({}, { homeSections: ['recent', 'popular'] }));
    const w = await mountSuspended(DisplayPrefsForm, { props: { mode: 'user' } });
    await w.find('[data-testid="section-row-popular"] input[type="checkbox"]').setValue(true);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][1].body).toEqual({ homeSections: ['recent', 'popular'] });
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
