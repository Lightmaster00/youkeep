import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useSearchHistory } from '../../app/composables/useSearchHistory';

const realLocalStorage = window.localStorage;

function installFakeStorage(overrides: Partial<Storage> = {}) {
  const store = new Map<string, string>();
  const fake: Storage = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() { return store.size; },
    ...overrides,
  };
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    writable: true,
    value: fake,
  });
  return fake;
}

function restoreRealStorage() {
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    writable: true,
    value: realLocalStorage,
  });
}

describe('useSearchHistory', () => {
  beforeEach(() => {
    installFakeStorage();
  });

  afterEach(() => {
    restoreRealStorage();
  });

  it('returns an empty list when nothing has been added', () => {
    const { get } = useSearchHistory();
    expect(get()).toEqual([]);
  });

  it('adds a term and returns it most-recent-first', () => {
    const { add, get } = useSearchHistory();
    add('foo');
    add('bar');
    expect(get()).toEqual(['bar', 'foo']);
  });

  it('dedupes a re-added term, moving it to the front', () => {
    const { add, get } = useSearchHistory();
    add('foo');
    add('bar');
    add('foo');
    expect(get()).toEqual(['foo', 'bar']);
  });

  it('caps the history at 8 entries, dropping the oldest', () => {
    const { add, get } = useSearchHistory();
    for (let i = 1; i <= 9; i++) add(`term${i}`);
    const result = get();
    expect(result).toHaveLength(8);
    expect(result[0]).toBe('term9');
    expect(result).not.toContain('term1');
  });

  it('ignores an empty or whitespace-only term', () => {
    const { add, get } = useSearchHistory();
    add('');
    add('   ');
    expect(get()).toEqual([]);
  });

  it('clears the history', () => {
    const { add, get, clear } = useSearchHistory();
    add('foo');
    clear();
    expect(get()).toEqual([]);
  });

  it('get() fails silently to an empty array when localStorage.getItem throws', () => {
    installFakeStorage({
      getItem: () => { throw new Error('quota exceeded'); },
    });
    const { get } = useSearchHistory();
    expect(get()).toEqual([]);
  });

  it('add() fails silently (no throw) when localStorage.setItem throws', () => {
    installFakeStorage({
      setItem: () => { throw new Error('quota exceeded'); },
    });
    const { add } = useSearchHistory();
    expect(() => add('foo')).not.toThrow();
  });

  it('clear() fails silently (no throw) when localStorage.removeItem throws', () => {
    installFakeStorage({
      removeItem: () => { throw new Error('quota exceeded'); },
    });
    const { clear } = useSearchHistory();
    expect(() => clear()).not.toThrow();
  });
});
