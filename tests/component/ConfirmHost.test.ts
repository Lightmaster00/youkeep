import { describe, it, expect } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import ConfirmHost from '../../app/components/ConfirmHost.vue';
import { confirmAction } from '../../app/composables/useConfirm';

describe('confirmAction + ConfirmHost (replaces window.confirm)', () => {
  it('resolves true on confirm and false on cancel, in an accessible dialog', async () => {
    const w = await mountSuspended(ConfirmHost, { attachTo: document.body });
    const yes = confirmAction({ title: 'Delete video?', message: 'Really?', confirmLabel: 'Delete video' });
    await flushPromises();
    const dialog = w.find('[role="dialog"]');
    expect(dialog.exists()).toBe(true);
    expect(dialog.text()).toContain('Really?');
    await w.find('.confirm-dialog-confirm').trigger('click');
    await expect(yes).resolves.toBe(true);
    await flushPromises();
    expect(w.find('[role="dialog"]').exists()).toBe(false);

    const no = confirmAction({ title: 'Delete video?', message: 'Really?' });
    await flushPromises();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await expect(no).resolves.toBe(false);
    w.unmount();
  });
});
