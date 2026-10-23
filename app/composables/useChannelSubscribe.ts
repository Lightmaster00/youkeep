import { ref, watch, type Ref } from 'vue';
import { useToast } from '~/composables/useToast';
import { apiErrorMessage } from '~/utils/apiError';

/**
 * Optimistic Subscribe / Unsubscribe for one channel: the state flips at once
 * and flips back (with an error toast) when the server refuses. `onChange`
 * runs after the server accepted.
 */
export function useChannelSubscribe(
  channelId: () => string,
  initial: () => boolean,
  onChange?: (id: string, subscribed: boolean) => void,
): { subscribed: Ref<boolean>; busy: Ref<boolean>; toggle: () => Promise<void> } {
  const toast = useToast();
  const { t } = useI18n();
  const subscribed = ref(initial());
  const busy = ref(false);
  // A new value from the parent (a reload) wins, unless a request is running.
  watch(initial, (value) => {
    if (!busy.value) subscribed.value = value;
  });

  async function toggle() {
    if (busy.value) return;
    const id = channelId();
    const next = !subscribed.value;
    subscribed.value = next;
    busy.value = true;
    try {
      await $fetch(`/api/channels/${encodeURIComponent(id)}/${next ? 'subscribe' : 'unsubscribe'}`, { method: 'POST' });
      onChange?.(id, next);
    } catch (err: any) {
      subscribed.value = !next;
      toast.error(apiErrorMessage(err, t, next ? 'channels.subscribeFailed' : 'channels.unsubscribeFailed'));
    } finally {
      busy.value = false;
    }
  }

  return { subscribed, busy, toggle };
}
