import { ref, computed } from 'vue';
import { useRecentList } from './useRecentList';
import { useToast } from './useToast';
import { groupByDay } from '~/utils/historyDays';

interface Options<T> {
  // When the item was last listened to (ms), for the order and the day headings.
  timestampOf: (item: T) => number;
  removeError: string;
  clearError: string;
  onRemove?: (item: T) => void;
  onRestore?: (item: T) => void;
  onClear?: () => void;
}

// A listening history page (`url` lists it, `${url}/:id` removes one item and
// `url` itself clears it, all with DELETE): "Load more" paging, day headings,
// optimistic removal rolled back with a toast, and clear-all behind a
// confirmation. A removed item is gone on the server too, so the next page
// still starts at the number of items shown.
export function useHistoryList<T extends { id: string }>(url: string, opts: Options<T>) {
  const toast = useToast();
  const list = useRecentList(url, 'items');
  const items = list.items as unknown as { value: T[] };
  const removing = ref(new Set<string>());
  const confirmingClear = ref(false);
  const clearing = ref(false);

  const days = computed(() => groupByDay(items.value, opts.timestampOf));

  function newestFirst(a: T, b: T): number {
    return opts.timestampOf(b) - opts.timestampOf(a) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
  }

  async function remove(item: T) {
    if (removing.value.has(item.id)) return;
    removing.value.add(item.id);
    items.value = items.value.filter((i) => i.id !== item.id);
    list.total.value = Math.max(0, list.total.value - 1);
    opts.onRemove?.(item);
    try {
      await $fetch(`${url}/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
    } catch {
      items.value = [...items.value, item].sort(newestFirst);
      list.total.value += 1;
      opts.onRestore?.(item);
      toast.error(opts.removeError);
    } finally {
      removing.value.delete(item.id);
    }
  }

  async function clearAll() {
    if (clearing.value) return;
    clearing.value = true;
    try {
      await $fetch(url, { method: 'DELETE' });
      items.value = [];
      list.total.value = 0;
      opts.onClear?.();
      confirmingClear.value = false;
      toast.success('History cleared');
    } catch {
      toast.error(opts.clearError);
    } finally {
      clearing.value = false;
    }
  }

  return { ...list, days, remove, confirmingClear, clearing, clearAll };
}
