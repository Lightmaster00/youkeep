import { describe, it, expect, afterEach } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { nextTick } from 'vue';
import BaseModal from '../../app/components/BaseModal.vue';

// BaseModal's focus/keydown-listener behavior follows `show` (also when the
// modal mounts already shown). Most tests mount hidden and then open it, like
// the app does when a modal is toggled open by user action.
const mounted: any[] = [];
afterEach(() => {
  while (mounted.length) mounted.pop().unmount();
  document.body.innerHTML = '';
});

describe('BaseModal', () => {
  it('clicking the backdrop emits close', async () => {
    const wrapper = await mountSuspended(BaseModal, {
      props: { show: true, title: 'Confirm' },
      slots: { default: 'Are you sure?' }
    });
    await wrapper.find('.modal-overlay').trigger('click');
    expect(wrapper.emitted('close')).toBeTruthy();
    expect(wrapper.emitted('close')!.length).toBe(1);
  });

  it('clicking the modal card itself does NOT emit close (click.stop guard)', async () => {
    const wrapper = await mountSuspended(BaseModal, {
      props: { show: true, title: 'Confirm' },
      slots: { default: 'Are you sure?' }
    });
    await wrapper.find('.modal-card').trigger('click');
    expect(wrapper.emitted('close')).toBeFalsy();
  });

  it('clicking the close button emits close', async () => {
    const wrapper = await mountSuspended(BaseModal, {
      props: { show: true, title: 'Confirm' },
      slots: { default: 'Are you sure?' }
    });
    await wrapper.find('.close-modal-btn').trigger('click');
    expect(wrapper.emitted('close')).toBeTruthy();
  });

  it('pressing Escape while shown emits close', async () => {
    const wrapper = await mountSuspended(BaseModal, {
      props: { show: false, title: 'Confirm' },
      attachTo: document.body
    });
    await wrapper.setProps({ show: true });
    await nextTick();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(wrapper.emitted('close')).toBeTruthy();
  });

  it('pressing Escape while NOT shown does not emit close', async () => {
    const wrapper = await mountSuspended(BaseModal, {
      props: { show: false, title: 'Confirm' },
      attachTo: document.body
    });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(wrapper.emitted('close')).toBeFalsy();
  });

  it('pressing Escape after transitioning shown -> not shown no longer emits close (listener detached)', async () => {
    const wrapper = await mountSuspended(BaseModal, {
      props: { show: false, title: 'Confirm' },
      attachTo: document.body
    });
    await wrapper.setProps({ show: true });
    await nextTick();
    await wrapper.setProps({ show: false });
    await nextTick();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(wrapper.emitted('close')).toBeFalsy();
  });

  it('moves focus to the modal card when show transitions from false to true', async () => {
    const wrapper = await mountSuspended(BaseModal, {
      props: { show: false, title: 'Confirm' },
      attachTo: document.body
    });
    await wrapper.setProps({ show: true });
    await nextTick(); // flush the watcher
    await nextTick(); // flush the nextTick() scheduled inside the watcher
    const card = wrapper.find('.modal-card').element as HTMLElement;
    expect(document.activeElement).toBe(card);
  });

  it('also takes focus when mounted directly with show: true (modals rendered under v-if)', async () => {
    const wrapper = await mountSuspended(BaseModal, {
      props: { show: true, title: 'Confirm' },
      attachTo: document.body
    });
    await nextTick();
    await nextTick();
    const card = wrapper.find('.modal-card').element as HTMLElement;
    expect(document.activeElement).toBe(card);
    wrapper.unmount();
  });

  it('returns focus to the previously-focused element when show transitions from true to false', async () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const wrapper = await mountSuspended(BaseModal, {
      props: { show: false, title: 'Confirm' },
      attachTo: document.body
    });
    await wrapper.setProps({ show: true });
    await nextTick();
    await nextTick();
    expect(document.activeElement).toBe(wrapper.find('.modal-card').element);

    await wrapper.setProps({ show: false });
    await nextTick();
    expect(document.activeElement).toBe(trigger);

    trigger.remove();
  });

  it('does not throw or restore focus to a removed element (document.contains() guard)', async () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();

    const wrapper = await mountSuspended(BaseModal, {
      props: { show: false, title: 'Confirm' },
      attachTo: document.body
    });
    await wrapper.setProps({ show: true });
    await nextTick();
    await nextTick();

    // The element that had focus before the modal opened is removed from
    // the document while the modal is still open.
    trigger.remove();

    await wrapper.setProps({ show: false });
    await nextTick();

    // document.contains(previouslyFocusedEl) is false, so the component
    // must not attempt to call .focus() on the detached element; body (or
    // nothing) ends up focused instead of throwing.
    expect(document.activeElement).not.toBe(trigger);
  });

  it('labels the dialog with its title and the close button "Close"', async () => {
    const wrapper = await mountSuspended(BaseModal, { props: { show: true, title: 'Rename' } });
    mounted.push(wrapper);
    const card = wrapper.find('[role="dialog"]');
    expect(card.attributes('aria-modal')).toBe('true');
    const titleId = card.attributes('aria-labelledby')!;
    expect(wrapper.find(`#${titleId}`).text()).toBe('Rename');
    expect(wrapper.find('.close-modal-btn').attributes('aria-label')).toBe('Close');
  });

  it('traps Tab inside the dialog in both directions', async () => {
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    const wrapper = await mountSuspended(BaseModal, {
      props: { show: false, title: 'Trap' },
      slots: { default: '<input id="first-field" /><button id="last-btn">Save</button>' },
      attachTo: document.body,
    });
    mounted.push(wrapper);
    await wrapper.setProps({ show: true });
    await nextTick();
    await nextTick();
    const closeBtn = wrapper.find('.close-modal-btn').element as HTMLElement;
    const lastBtn = wrapper.find('#last-btn').element as HTMLElement;
    lastBtn.focus();
    const tab = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true });
    document.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(closeBtn);
    const back = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, cancelable: true });
    document.dispatchEvent(back);
    expect(document.activeElement).toBe(lastBtn);
    // Focus that escaped (e.g. by a click) is pulled back in.
    outside.focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', cancelable: true }));
    expect(document.activeElement).toBe(closeBtn);
  });

  it('Escape closes only the topmost of two stacked modals', async () => {
    const Stack = defineComponent({
      setup() {
        const outer = ref(false);
        const inner = ref(false);
        const closed: string[] = [];
        return { outer, inner, closed };
      },
      render() {
        return h('div', [
          h(BaseModal, { show: this.outer, title: 'Outer', onClose: () => { this.closed.push('outer'); this.outer = false; } }, () => 'outer body'),
          h(BaseModal, { show: this.inner, title: 'Inner', onClose: () => { this.closed.push('inner'); this.inner = false; } }, () => 'inner body'),
        ]);
      },
    });
    const wrapper = await mountSuspended(Stack, { attachTo: document.body });
    mounted.push(wrapper);
    const vm = wrapper.vm as any;
    vm.outer = true;
    await nextTick();
    vm.inner = true;
    await nextTick();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await nextTick();
    expect(vm.closed).toEqual(['inner']);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await nextTick();
    expect(vm.closed).toEqual(['inner', 'outer']);
  });
});
