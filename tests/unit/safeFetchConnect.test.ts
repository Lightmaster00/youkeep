import { describe, it, expect, afterEach } from 'vitest';
import http from 'http';
import tls from 'tls';
import type { AddressInfo } from 'net';
import { createValidatingLookup, safeFetch, UnsafeUrlError, type LookupFn } from '../../server/utils/safeUrl';

// Every request here goes to a server on 127.0.0.1 started by the test, or is
// refused before connecting: no real DNS, no network.

const PUBLIC_V4 = '93.184.216.34';
const PUBLIC_V6 = '2606:2800:220:1:248:1893:25c8:1946';

const answers = (...addresses: string[]) => addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));

/** A resolver that returns each answer set in turn (the last one repeats). */
function sequence(...sets: string[][]): LookupFn & { calls: string[] } {
  const calls: string[] = [];
  let i = 0;
  const fn = (async (hostname: string) => {
    calls.push(hostname);
    const set = sets[Math.min(i++, sets.length - 1)]!;
    return answers(...set);
  }) as LookupFn & { calls: string[] };
  fn.calls = calls;
  return fn;
}

function runLookup(lookup: ReturnType<typeof createValidatingLookup>, host: string, all: boolean): Promise<any> {
  return new Promise((resolve, reject) => {
    lookup(host, { all }, (err: any, address: any, family?: number) => (err ? reject(err) : resolve(all ? address : { address, family })));
  });
}

let servers: { close: () => void }[] = [];
afterEach(() => {
  for (const s of servers) s.close();
  servers = [];
});

async function startHttp(): Promise<{ port: number; hits: { host?: string }[] }> {
  const hits: { host?: string }[] = [];
  const server = http.createServer((req, res) => {
    hits.push({ host: req.headers.host });
    res.end('reached');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  servers.push(server);
  return { port: (server.address() as AddressInfo).port, hits };
}

describe('createValidatingLookup (connect-time check)', () => {
  it('returns only validated public addresses, IPv4 and IPv6', async () => {
    const lookup = createValidatingLookup({ allowPrivate: false, lookup: sequence([PUBLIC_V4, PUBLIC_V6]) });
    expect(await runLookup(lookup, 'pub.example', true)).toEqual(answers(PUBLIC_V4, PUBLIC_V6));
    expect(await runLookup(lookup, 'pub.example', false)).toEqual({ address: PUBLIC_V4, family: 4 });
  });

  it.each([
    ['public + private IPv4', [PUBLIC_V4, '10.0.0.5']],
    ['public + loopback IPv6', [PUBLIC_V4, '::1']],
    ['unique-local IPv6', ['fd12:3456::1']],
    ['IPv4-mapped loopback', ['::ffff:127.0.0.1']],
  ])('refuses %s when private addresses are not allowed', async (_name, set) => {
    const lookup = createValidatingLookup({ allowPrivate: false, lookup: sequence(set) });
    await expect(runLookup(lookup, 'x.example', true)).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it('refuses link-local / metadata addresses even when private ones are allowed', async () => {
    const lookup = createValidatingLookup({ allowPrivate: true, lookup: sequence(['192.168.1.2', '169.254.169.254']) });
    await expect(runLookup(lookup, 'x.example', true)).rejects.toThrow(/not allowed/);
    const v6 = createValidatingLookup({ allowPrivate: true, lookup: sequence(['fe80::1']) });
    await expect(runLookup(v6, 'x.example', true)).rejects.toThrow(/not allowed/);
  });

  it('allows LAN addresses when private ones are allowed', async () => {
    const lookup = createValidatingLookup({ allowPrivate: true, lookup: sequence(['192.168.1.2', 'fd00::2']) });
    expect(await runLookup(lookup, 'nas.lan', true)).toEqual(answers('192.168.1.2', 'fd00::2'));
  });
});

describe('safeFetch connects to the address it validated', () => {
  it('a name that resolves public at check time and private at connect time is refused (DNS rebinding)', async () => {
    const { port, hits } = await startHttp();
    const lookup = sequence([PUBLIC_V4], ['127.0.0.1']);
    const err = await safeFetch(`http://rebind.example:${port}/feed`, { allowPrivate: false, lookup }).catch((e) => e);
    expect(err).toBeInstanceOf(UnsafeUrlError);
    expect(String(err.message)).toMatch(/not allowed/);
    expect(hits).toEqual([]);
    // The connect-time resolution really happened (not only the pre-check).
    expect(lookup.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('mixed public + private answers at connect time are refused', async () => {
    const { port, hits } = await startHttp();
    const lookup = sequence([PUBLIC_V4], [PUBLIC_V4, '127.0.0.1']);
    await expect(safeFetch(`http://mixed.example:${port}/`, { allowPrivate: false, lookup })).rejects.toBeInstanceOf(UnsafeUrlError);
    expect(hits).toEqual([]);
  });

  it('keeps the original host name in the Host header', async () => {
    const { port, hits } = await startHttp();
    const res = await safeFetch(`http://nas.lan:${port}/feed`, { allowPrivate: true, lookup: sequence(['127.0.0.1']) });
    expect(await res.text()).toBe('reached');
    expect(hits).toEqual([{ host: `nas.lan:${port}` }]);
  });

  it('sends the original host name as TLS SNI', async () => {
    let seen: string | undefined;
    const server = tls.createServer({
      SNICallback: (name, cb) => {
        seen = name;
        cb(new Error('test server has no certificate'), undefined as any);
      },
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    servers.push(server);
    const port = (server.address() as AddressInfo).port;
    await safeFetch(`https://feeds.lan:${port}/`, { allowPrivate: true, lookup: sequence(['127.0.0.1']) }).catch(() => {});
    expect(seen).toBe('feeds.lan');
  });
});
