import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

// public/sw.js is a classic script (no module), so it is evaluated in a vm
// sandbox with fake Cache Storage, fetch and event plumbing.
const SOURCE = readFileSync(fileURLToPath(new URL('../../public/sw.js', import.meta.url)), 'utf8');
const ORIGIN = 'https://kept.example';

class FakeCache {
  store = new Map<string, any>();
  async match(req: any) { return this.store.get(typeof req === 'string' ? req : req.url); }
  async put(req: any, res: any) { this.store.set(typeof req === 'string' ? req : req.url, res); }
  async addAll(urls: string[]) { for (const u of urls) this.store.set(new URL(u, ORIGIN).href, { ok: true, url: u }); }
}

function loadWorker(scriptUrl = `${ORIGIN}/sw.js?v=build42`, existingCaches: string[] = []) {
  const handlers: Record<string, (event: any) => void> = {};
  const cacheMap = new Map<string, FakeCache>(existingCaches.map((n) => [n, new FakeCache()]));
  const caches = {
    open: vi.fn(async (name: string) => {
      if (!cacheMap.has(name)) cacheMap.set(name, new FakeCache());
      return cacheMap.get(name)!;
    }),
    keys: vi.fn(async () => [...cacheMap.keys()]),
    delete: vi.fn(async (name: string) => cacheMap.delete(name)),
  };
  const fetchMock = vi.fn(async (req: any) => ({ ok: true, type: 'basic', url: req.url, clone() { return this; } }));
  const self = {
    location: new URL(scriptUrl),
    addEventListener: (type: string, fn: (event: any) => void) => { handlers[type] = fn; },
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn(async () => undefined) },
  };
  vm.runInNewContext(SOURCE, { self, caches, fetch: fetchMock, URL, Promise });
  return { handlers, cacheMap, caches, fetchMock, self };
}

const request = (path: string, init: { method?: string; mode?: string } = {}) => ({
  url: new URL(path, ORIGIN).href,
  method: init.method || 'GET',
  mode: init.mode || 'no-cors',
});

async function dispatchFetch(worker: ReturnType<typeof loadWorker>, req: any) {
  let responded: Promise<any> | null = null;
  worker.handlers.fetch!({ request: req, respondWith: (p: Promise<any>) => { responded = p; } });
  return responded ? await responded : null;
}

describe('service worker', () => {
  let worker: ReturnType<typeof loadWorker>;
  beforeEach(() => { worker = loadWorker(); });

  it('names its cache after the build id from its own URL', async () => {
    let waited: Promise<any> | null = null;
    worker.handlers.install!({ waitUntil: (p: Promise<any>) => { waited = p; } });
    await waited;
    expect([...worker.cacheMap.keys()]).toEqual(['youkeep-static-build42']);
  });

  it('never precaches "/" or any HTML', async () => {
    let waited: Promise<any> | null = null;
    worker.handlers.install!({ waitUntil: (p: Promise<any>) => { waited = p; } });
    await waited;
    const cached = [...worker.cacheMap.get('youkeep-static-build42')!.store.keys()].map((u) => new URL(u).pathname);
    expect(cached).not.toContain('/');
    expect(cached.every((p) => /\.(ico|svg|png)$/.test(p))).toBe(true);
  });

  it('leaves navigations, /api, media and non-GET requests to the network', async () => {
    for (const req of [
      request('/', { mode: 'navigate' }),
      request('/watch/abc', { mode: 'navigate' }),
      request('/api/auth/me'),
      request('/api/videos?limit=10'),
      request('/downloads/d/x.mp4'),
      request('/manifest.webmanifest'),
      request('/_nuxt/builds/latest.json'),
      request('/_nuxt/entry.abc123.js', { method: 'POST' }),
      { url: 'https://cdn.other.example/_nuxt/a.js', method: 'GET', mode: 'no-cors' },
    ]) {
      expect(await dispatchFetch(worker, req)).toBeNull();
    }
    expect(worker.fetchMock).not.toHaveBeenCalled();
  });

  it('serves hashed /_nuxt/ assets and icons cache-first', async () => {
    const req = request('/_nuxt/entry.abc123.js');
    const first = await dispatchFetch(worker, req);
    expect(first.url).toBe(req.url);
    expect(worker.fetchMock).toHaveBeenCalledTimes(1);
    await dispatchFetch(worker, req);
    expect(worker.fetchMock).toHaveBeenCalledTimes(1);
    expect(await dispatchFetch(worker, request('/icon.svg'))).not.toBeNull();
  });

  it('does not store failed responses', async () => {
    worker.fetchMock.mockResolvedValueOnce({ ok: false, status: 404, type: 'basic', url: '', clone() { return this; } });
    await dispatchFetch(worker, request('/_nuxt/missing.js'));
    await dispatchFetch(worker, request('/_nuxt/missing.js'));
    expect(worker.fetchMock).toHaveBeenCalledTimes(2);
  });

  it('deletes every other cache on activate', async () => {
    worker = loadWorker(`${ORIGIN}/sw.js?v=build43`, ['youkeep-v1', 'youkeep-static-build42', 'youkeep-static-build43']);
    let waited: Promise<any> | null = null;
    worker.handlers.activate!({ waitUntil: (p: Promise<any>) => { waited = p; } });
    await waited;
    expect([...worker.cacheMap.keys()]).toEqual(['youkeep-static-build43']);
  });

  it('clears every cache on a clear-caches message and answers on the port', async () => {
    worker = loadWorker(undefined, ['youkeep-static-build42', 'other']);
    const port = { postMessage: vi.fn() };
    let waited: Promise<any> | null = null;
    worker.handlers.message!({ data: { type: 'clear-caches' }, ports: [port], waitUntil: (p: Promise<any>) => { waited = p; } });
    await waited;
    expect(worker.cacheMap.size).toBe(0);
    expect(port.postMessage).toHaveBeenCalledWith({ cleared: true });
  });

  it('ignores other messages', async () => {
    worker = loadWorker(undefined, ['youkeep-static-build42']);
    worker.handlers.message!({ data: { type: 'hello' }, ports: [] });
    await Promise.resolve();
    expect(worker.cacheMap.size).toBe(1);
  });
});
