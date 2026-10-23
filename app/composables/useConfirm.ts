import { shallowRef } from 'vue';

// A promise-based replacement for window.confirm(): `await confirmAction(...)`
// opens the app's ConfirmDialog (rendered once by ConfirmHost in app.vue) and
// resolves true on confirm, false on cancel or Escape.
export interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel: string;
  resolve: (ok: boolean) => void;
}

// Module state, not useState: a request holds a function and only ever exists
// in the browser (it is opened from a click handler).
export const pendingConfirm = shallowRef<ConfirmRequest | null>(null);

export function answerConfirm(ok: boolean) {
  const req = pendingConfirm.value;
  if (!req) return;
  pendingConfirm.value = null;
  req.resolve(ok);
}

export function confirmAction(opts: { title: string; message: string; confirmLabel?: string }): Promise<boolean> {
  // A second question replaces an unanswered one (which counts as cancelled).
  answerConfirm(false);
  return new Promise((resolve) => {
    pendingConfirm.value = {
      title: opts.title,
      message: opts.message,
      // Empty: ConfirmHost words the default in the UI language.
      confirmLabel: opts.confirmLabel || '',
      resolve,
    };
  });
}

export function useConfirm() {
  return { confirm: confirmAction };
}
