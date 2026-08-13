import { describe, it, expect } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { nextTick } from 'vue';
import BaseModal from '../../app/components/BaseModal.vue';

// BaseModal's focus/keydown-listener behavior is driven by a
// `watch(() => props.show, ...)` with no `{ immediate: true }`. That means
// the watcher callback only runs on a show TRANSITION (false -> true or
// true -> false) -- it does NOT run just because the component happened to
// mount with `show: true` already set. Verified directly: mounting with
// `show: true` from the start leaves `document.activeElement` untouched and
// does not attach the Escape listener. Tests that need the "shown" behavior
// must mount with `show: false` and then `setProps({ show: true })` to
// trigger the watcher, exactly like the real app does when a modal is
// toggled open by user action.

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

  it('does NOT move focus when mounted directly with show: true (watch has no immediate:true)', async () => {
    const wrapper = await mountSuspended(BaseModal, {
      props: { show: true, title: 'Confirm' },
      attachTo: document.body
    });
    await nextTick();
    await nextTick();
    const card = wrapper.find('.modal-card').element as HTMLElement;
    expect(document.activeElement).not.toBe(card);
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
});
