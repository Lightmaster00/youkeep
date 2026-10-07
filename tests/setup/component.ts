import { vi } from 'vitest';

// Since Nuxt 4.6 the auto-imported `$fetch` is a constant captured when the
// module loads, so `vi.stubGlobal('$fetch', ...)` in a test would never reach
// the code under test. Route every call through the live global instead.
vi.mock('#build/fetch.mjs', () => {
  const live = ((...args: unknown[]) => (globalThis as any).$fetch(...args)) as any;
  live.raw = (...args: unknown[]) => (globalThis as any).$fetch.raw(...args);
  live.create = (...args: unknown[]) => (globalThis as any).$fetch.create(...args);
  return { $fetch: live };
});
