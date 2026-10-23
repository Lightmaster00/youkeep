import { onBeforeUnmount } from 'vue';

// "Seen" marks of the Subscriptions page: a video counts as seen once at
// least half of its card stayed on screen for 2 s, or when it is opened. The
// ids are batched and sent with one debounced POST /api/subscriptions/seen
// (at most 200 per request), each id at most once per page visit, and never
// for a guest (the route needs a user).

export const SEEN_VISIBLE_RATIO = 0.5;
export const SEEN_DWELL_MS = 2000;
export const SEEN_DEBOUNCE_MS = 1000;
export const SEEN_MAX_BATCH = 200;

export function useSeenTracker(opts: { enabled: () => boolean }) {
  const sent = new Set<string>();
  const pending = new Set<string>();
  const dwell = new Map<string, ReturnType<typeof setTimeout>>();
  const elementIds = new WeakMap<Element, string>();
  let debounce: ReturnType<typeof setTimeout> | null = null;
  let observer: IntersectionObserver | null = null;

  async function send(ids: string[]) {
    try {
      await $fetch('/api/subscriptions/seen', { method: 'POST', body: { videoIds: ids } });
    } catch {
      // Best effort: let a later sighting try these ids again.
      for (const id of ids) sent.delete(id);
    }
  }

  /** Sends what is queued now (on leaving the page, or when a card is opened). */
  function flush() {
    if (debounce) {
      clearTimeout(debounce);
      debounce = null;
    }
    if (pending.size === 0) return;
    const ids = [...pending];
    pending.clear();
    for (let i = 0; i < ids.length; i += SEEN_MAX_BATCH) void send(ids.slice(i, i + SEEN_MAX_BATCH));
  }

  function queue(id: string) {
    if (!id || !opts.enabled() || sent.has(id) || pending.has(id)) return;
    sent.add(id);
    pending.add(id);
    if (pending.size >= SEEN_MAX_BATCH) {
      flush();
      return;
    }
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(flush, SEEN_DEBOUNCE_MS);
  }

  function cancelDwell(id: string) {
    const t = dwell.get(id);
    if (t) clearTimeout(t);
    dwell.delete(id);
  }

  function onEntries(entries: IntersectionObserverEntry[]) {
    for (const entry of entries) {
      const id = elementIds.get(entry.target);
      if (!id) continue;
      const visible = entry.isIntersecting && entry.intersectionRatio >= SEEN_VISIBLE_RATIO;
      if (!visible) {
        cancelDwell(id);
        continue;
      }
      if (dwell.has(id) || sent.has(id)) continue;
      dwell.set(id, setTimeout(() => {
        dwell.delete(id);
        queue(id);
        observer?.unobserve(entry.target);
      }, SEEN_DWELL_MS));
    }
  }

  function observe(el: Element, id: string) {
    if (!opts.enabled() || sent.has(id) || typeof IntersectionObserver === 'undefined') return;
    observer ??= new IntersectionObserver(onEntries, { threshold: [0, SEEN_VISIBLE_RATIO, 1] });
    elementIds.set(el, id);
    observer.observe(el);
  }

  function unobserve(el: Element) {
    const id = elementIds.get(el);
    if (id) cancelDwell(id);
    observer?.unobserve(el);
  }

  /** The card was opened: mark it seen right away. */
  function markOpened(id: string) {
    cancelDwell(id);
    queue(id);
    flush();
  }

  /** "Mark all as seen" did the rest: nothing left to send for these. */
  function forget(ids: Iterable<string>) {
    for (const id of ids) {
      cancelDwell(id);
      sent.add(id);
      pending.delete(id);
    }
  }

  onBeforeUnmount(() => {
    for (const t of dwell.values()) clearTimeout(t);
    dwell.clear();
    observer?.disconnect();
    observer = null;
    flush();
  });

  return { observe, unobserve, markOpened, flush, forget };
}
