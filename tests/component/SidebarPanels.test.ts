import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import { defineComponent, h, ref } from 'vue';
import SidebarPanels from '../../app/components/SidebarPanels.vue';
import { buildSidebarGroups } from '../../app/utils/sidebarGroups';
import { spaces } from '../../app/spaces';

const STORAGE_KEY = 'youkeep:sidebar-panel';
const realLocalStorage = window.localStorage;
let store: Map<string, string>;

function installFakeStorage(overrides: Partial<Storage> = {}) {
  store = new Map<string, string>();
  const fake: Storage = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() { return store.size; },
    ...overrides,
  };
  Object.defineProperty(window, 'localStorage', { configurable: true, writable: true, value: fake });
}

const groups = buildSidebarGroups(spaces, {
  isAdmin: false,
  enabled: ['video', 'music', 'podcasts'],
  hiddenNavLinks: [],
  mustChangePassword: false,
});

// The active space lives in a ref so a test can move the route to another space.
const activeSpaceId = ref('video');
const Host = defineComponent({
  setup: () => () => h(SidebarPanels, { groups, activeSpaceId: activeSpaceId.value }),
});

// Every wrapper is unmounted after its test so a stale instance cannot react to
// the shared activeSpaceId ref (and touch storage) during a later test.
const mounted: { unmount: () => void }[] = [];

async function mount(space = 'video') {
  activeSpaceId.value = space;
  const w = await mountSuspended(Host);
  mounted.push(w);
  await flushPromises();
  return w;
}

function openIds(w: Awaited<ReturnType<typeof mount>>) {
  return w.findAll('.sidebar-panel-header')
    .filter((b) => b.attributes('aria-expanded') === 'true')
    .map((b) => b.attributes('aria-controls'));
}

function header(w: Awaited<ReturnType<typeof mount>>, id: string) {
  return w.find(`#sidebar-panel-header-${id}`);
}

beforeEach(() => installFakeStorage());
afterEach(() => {
  while (mounted.length) {
    try { mounted.pop()!.unmount(); } catch (e) { /* already unmounted */ }
  }
  Object.defineProperty(window, 'localStorage', { configurable: true, writable: true, value: realLocalStorage });
});

describe('SidebarPanels', () => {
  it('renders one panel per group with an accessible header button and region', async () => {
    const w = await mount();
    const headers = w.findAll('.sidebar-panel-header');
    expect(headers.map((b) => b.element.tagName)).toEqual(['BUTTON', 'BUTTON', 'BUTTON']);
    expect(headers.map((b) => b.attributes('type'))).toEqual(['button', 'button', 'button']);
    expect(headers.map((b) => b.attributes('aria-controls'))).toEqual(['sidebar-panel-video', 'sidebar-panel-music', 'sidebar-panel-podcasts']);
    for (const id of ['video', 'music', 'podcasts']) {
      const region = w.find(`#sidebar-panel-${id}`);
      expect(region.attributes('role')).toBe('region');
      expect(region.attributes('aria-labelledby')).toBe(`sidebar-panel-header-${id}`);
    }
    expect(header(w, 'music').html()).toContain(spaces[1]!.icon.slice(0, 40));
  });

  it('opens exactly the panel of the route space on load', async () => {
    const w = await mount('music');
    expect(openIds(w)).toEqual(['sidebar-panel-music']);
    expect(w.find('#sidebar-panel-music').classes()).toContain('is-open');
    expect(w.find('#sidebar-panel-video').classes()).not.toContain('is-open');
    expect(w.find('#sidebar-panel-video').attributes('inert')).toBeDefined();
    expect(w.find('#sidebar-panel-music').attributes('inert')).toBeUndefined();
  });

  it('opens another panel by hand, closing the first, without navigating', async () => {
    const w = await mount('video');
    const before = useRouter().currentRoute.value.fullPath;
    await header(w, 'podcasts').trigger('click');
    expect(openIds(w)).toEqual(['sidebar-panel-podcasts']);
    await header(w, 'music').trigger('click');
    expect(openIds(w)).toEqual(['sidebar-panel-music']);
    await flushPromises();
    expect(useRouter().currentRoute.value.fullPath).toBe(before);
  });

  it('closes the open panel when its header is clicked again', async () => {
    const w = await mount('video');
    await header(w, 'video').trigger('click');
    expect(openIds(w)).toEqual([]);
    await header(w, 'video').trigger('click');
    expect(openIds(w)).toEqual(['sidebar-panel-video']);
  });

  it('opens the new space when the route changes space, dropping the manual choice', async () => {
    const w = await mount('video');
    await header(w, 'podcasts').trigger('click');
    activeSpaceId.value = 'music';
    await flushPromises();
    expect(openIds(w)).toEqual(['sidebar-panel-music']);
    expect(store.has(STORAGE_KEY)).toBe(false);
    // Coming back to the space the choice was made in does not revive it.
    activeSpaceId.value = 'video';
    await flushPromises();
    expect(openIds(w)).toEqual(['sidebar-panel-video']);
  });

  it('keeps the manual choice while the route stays in the same space', async () => {
    const w = await mount('video');
    await header(w, 'podcasts').trigger('click');
    activeSpaceId.value = 'video';
    await flushPromises();
    expect(openIds(w)).toEqual(['sidebar-panel-podcasts']);
  });

  it('remembers the manual choice across a reload in the same space', async () => {
    const first = await mount('video');
    await header(first, 'music').trigger('click');
    expect(JSON.parse(store.get(STORAGE_KEY)!)).toEqual({ id: 'music', spaceId: 'video' });
    mounted.pop()!.unmount();
    const w = await mount('video');
    expect(openIds(w)).toEqual(['sidebar-panel-music']);
  });

  it('remembers an all-closed choice across a reload', async () => {
    store.set(STORAGE_KEY, JSON.stringify({ id: null, spaceId: 'video' }));
    const w = await mount('video');
    expect(openIds(w)).toEqual([]);
  });

  it('ignores a stored choice made in another space', async () => {
    store.set(STORAGE_KEY, JSON.stringify({ id: 'podcasts', spaceId: 'video' }));
    const w = await mount('music');
    expect(openIds(w)).toEqual(['sidebar-panel-music']);
    expect(store.has(STORAGE_KEY)).toBe(false);
  });

  it('ignores a malformed stored value', async () => {
    store.set(STORAGE_KEY, '{not json');
    const w = await mount('music');
    expect(openIds(w)).toEqual(['sidebar-panel-music']);
    store.set(STORAGE_KEY, JSON.stringify({ id: 42, spaceId: 'music' }));
    const w2 = await mount('music');
    expect(openIds(w2)).toEqual(['sidebar-panel-music']);
  });

  it('keeps working when localStorage throws on every call', async () => {
    const boom = () => { throw new Error('denied'); };
    installFakeStorage({ getItem: boom, setItem: boom, removeItem: boom });
    const errors: unknown[] = [];
    useNuxtApp().hook('vue:error', (err) => { errors.push(err); });
    const w = await mount('video');
    expect(openIds(w)).toEqual(['sidebar-panel-video']);
    await header(w, 'music').trigger('click');
    expect(openIds(w)).toEqual(['sidebar-panel-music']);
    activeSpaceId.value = 'podcasts';
    await flushPromises();
    expect(openIds(w)).toEqual(['sidebar-panel-podcasts']);
    expect(errors).toEqual([]);
  });

  it('marks a disabled group with an Off badge and the is-off class', async () => {
    const adminGroups = buildSidebarGroups(spaces, { isAdmin: true, enabled: ['video', 'podcasts'], hiddenNavLinks: [], mustChangePassword: false });
    const w = await mountSuspended(SidebarPanels, { props: { groups: adminGroups, activeSpaceId: 'video' } });
    const g = w.findAll('.sidebar-group');
    expect(g[1]!.classes()).toContain('is-off');
    expect(g[1]!.find('.badge').text()).toBe('Off');
    expect(g[0]!.classes()).not.toContain('is-off');
    expect(g[0]!.find('.badge').exists()).toBe(false);
  });
});
