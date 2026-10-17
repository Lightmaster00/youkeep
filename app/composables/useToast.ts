import { ref } from 'vue';

export interface Toast {
  id: number;
  message: string;
  type: 'success' | 'error' | 'info';
}

// At most this many toasts on screen: the oldest makes room for a new one.
export const MAX_VISIBLE_TOASTS = 4;
// The same message again within this window does not stack a second toast;
// the visible one simply stays up longer.
export const TOAST_DEDUPE_MS = 3000;

const toasts = ref<Toast[]>([]);
let toastId = 0;
const timers = new Map<number, ReturnType<typeof setTimeout>>();
const shownAt = new Map<number, number>();

function removeToast(id: number) {
  const timer = timers.get(id);
  if (timer) clearTimeout(timer);
  timers.delete(id);
  shownAt.delete(id);
  const idx = toasts.value.findIndex(t => t.id === id);
  if (idx !== -1) toasts.value.splice(idx, 1);
}

function arm(id: number, duration: number) {
  const previous = timers.get(id);
  if (previous) clearTimeout(previous);
  timers.set(id, setTimeout(() => removeToast(id), duration));
}

function showToast(message: string, type: 'success' | 'error' | 'info' = 'success', duration = 3500) {
  const now = Date.now();
  const twin = toasts.value.find(t => t.message === message && t.type === type);
  if (twin && now - (shownAt.get(twin.id) ?? 0) < TOAST_DEDUPE_MS) {
    shownAt.set(twin.id, now);
    arm(twin.id, duration);
    return;
  }
  const id = toastId++;
  toasts.value.push({ id, message, type });
  shownAt.set(id, now);
  arm(id, duration);
  while (toasts.value.length > MAX_VISIBLE_TOASTS) removeToast(toasts.value[0]!.id);
}

export function useToast() {
  return {
    toasts,
    showToast,
    success: (msg: string, dur?: number) => showToast(msg, 'success', dur),
    error: (msg: string, dur?: number) => showToast(msg, 'error', dur),
    info: (msg: string, dur?: number) => showToast(msg, 'info', dur),
    removeToast
  };
}
