import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import LibraryTab from '../../app/components/settings/LibraryTab.vue';

let scrolled: string[];

beforeEach(() => {
  vi.stubGlobal('$fetch', vi.fn(async () => ({})));
  scrolled = [];
  Element.prototype.scrollIntoView = vi.fn(function (this: Element) { scrolled.push(this.id); });
});
afterEach(() => vi.unstubAllGlobals());

const order = (w: any) => w.findAll('[data-testid^="library-section-"]').map((s: any) => s.attributes('data-testid'));
const isOpen = (w: any, kind: string) => w.find(`[data-testid="library-section-${kind}"]`).attributes('open') !== undefined;

describe('LibraryTab', () => {
  it('shows Videos, Music and Podcasts in that order, all open', async () => {
    const w = await mountSuspended(LibraryTab, { props: { section: null } });
    expect(order(w)).toEqual(['library-section-videos', 'library-section-music', 'library-section-podcasts']);
    expect(['videos', 'music', 'podcasts'].map((k) => isOpen(w, k))).toEqual([true, true, true]);
    expect(w.text()).toContain('Library');
  });

  it('opens and scrolls to the requested section only', async () => {
    const w = await mountSuspended(LibraryTab, { props: { section: 'music' }, attachTo: document.body });
    await flushPromises();
    expect(['videos', 'music', 'podcasts'].map((k) => isOpen(w, k))).toEqual([false, true, false]);
    expect(scrolled).toContain('library-music');
    w.unmount();
  });

  it('follows a section change', async () => {
    const w = await mountSuspended(LibraryTab, { props: { section: 'music' }, attachTo: document.body });
    await w.setProps({ section: 'podcasts' });
    await flushPromises();
    expect(['videos', 'music', 'podcasts'].map((k) => isOpen(w, k))).toEqual([false, false, true]);
    expect(scrolled).toContain('library-podcasts');
    w.unmount();
  });
});
