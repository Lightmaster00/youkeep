const STORAGE_KEY = 'youkeep:search-history';
const MAX_ENTRIES = 8;

export function useSearchHistory() {
  function get(): string[] {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : [];
    } catch (e) {
      return [];
    }
  }

  function add(term: string): void {
    const trimmed = term.trim();
    if (!trimmed) return;
    try {
      const current = get();
      const deduped = current.filter((t) => t !== trimmed);
      const next = [trimmed, ...deduped].slice(0, MAX_ENTRIES);
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (e) {
      // localStorage unavailable or full — history is best-effort, fail silently
    }
  }

  function clear(): void {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      // fail silently
    }
  }

  return { get, add, clear };
}
