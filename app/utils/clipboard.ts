import { shallowRef } from 'vue';

// Copying text that works everywhere a self-hosted instance runs:
// navigator.clipboard only exists in a secure context (HTTPS or localhost), so
// plain http://<lan-ip> falls back to execCommand('copy') on a hidden
// textarea, and if that fails too, to a "Copy this link" dialog with the text
// selected (ClipboardFallbackHost in app.vue) for a manual Ctrl+C.

/** Text waiting for a manual copy (shown by ClipboardFallbackHost). */
export const manualCopy = shallowRef<{ text: string; title: string } | null>(null);

function execCommandCopy(text: string): boolean {
  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') return false;
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.top = '-1000px';
  area.style.opacity = '0';
  const previous = document.activeElement as HTMLElement | null;
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  document.body.removeChild(area);
  previous?.focus?.();
  return ok;
}

/**
 * Copies `text`. Resolves 'copied' when it reached the clipboard, 'manual'
 * when the user was shown the text to copy by hand.
 */
export async function copyToClipboard(text: string, title = 'Copy this link'): Promise<'copied' | 'manual'> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return 'copied';
    }
  } catch {
    // Permission refused or not focused: try the older way.
  }
  if (execCommandCopy(text)) return 'copied';
  manualCopy.value = { text, title };
  return 'manual';
}
