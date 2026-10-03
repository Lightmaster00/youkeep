import { describe, it, expect } from 'vitest';
import { nextInstanceId } from '../../app/utils/uniqueId';

describe('nextInstanceId', () => {
  it('returns a different id on every call', () => {
    const ids = new Set(Array.from({ length: 100 }, () => nextInstanceId()));
    expect(ids.size).toBe(100);
  });

  it('uses the given prefix', () => {
    expect(nextInstanceId('card')).toMatch(/^card-\d+$/);
  });

  it('works when crypto.randomUUID is unavailable (non-secure context)', () => {
    const original = (globalThis.crypto as any).randomUUID;
    Object.defineProperty(globalThis.crypto, 'randomUUID', { configurable: true, value: undefined });
    try {
      expect(() => nextInstanceId()).not.toThrow();
    } finally {
      Object.defineProperty(globalThis.crypto, 'randomUUID', { configurable: true, value: original });
    }
  });
});
