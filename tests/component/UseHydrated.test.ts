import { describe, it, expect } from 'vitest';
import { defineComponent, h } from 'vue';
import { mount } from '@vue/test-utils';
import { useHydrated } from '../../app/composables/useHydrated';

describe('useHydrated', () => {
  it('is false for the first (hydration) render and true after mount', async () => {
    const renders: boolean[] = [];
    const Probe = defineComponent({
      setup() {
        const hydrated = useHydrated();
        return () => { renders.push(hydrated.value); return h('div', hydrated.value ? 'client' : 'ssr'); };
      },
    });
    const w = mount(Probe);
    await w.vm.$nextTick();
    expect(renders[0]).toBe(false);
    expect(renders.at(-1)).toBe(true);
    expect(w.text()).toBe('client');
    w.unmount();
  });
});
