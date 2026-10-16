import dns from 'dns';
import net from 'net';

/**
 * Outbound requests to addresses that come from third parties (podcast feeds,
 * their enclosures and redirects) must never reach the server's own network:
 * loopback, the LAN, link-local, cloud metadata endpoints...
 *
 * Limitation: the name is resolved here and again by fetch() when it
 * connects, so a DNS answer that changes in between (rebinding) is not
 * caught. Every redirect hop is checked again.
 */

export class UnsafeUrlError extends Error {
  statusCode = 400;
}

export type LookupFn = (hostname: string) => Promise<{ address: string; family: number }[]>;

const defaultLookup: LookupFn = (hostname) => dns.promises.lookup(hostname, { all: true, verbatim: true });

/** The DNS resolver used when a call passes none; tests replace it (no real DNS). */
export const safeUrlDeps: { lookup: LookupFn } = { lookup: defaultLookup };

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

function inV4(ip: string, cidr: string): boolean {
  const [base, bits] = cidr.split('/') as [string, string];
  const mask = Number(bits) === 0 ? 0 : (~0 << (32 - Number(bits))) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}

/** Cloud metadata endpoints: blocked even when private addresses are allowed. */
const ALWAYS_BLOCKED_V4 = ['169.254.0.0/16', '0.0.0.0/8', '255.255.255.255/32', '224.0.0.0/4', '240.0.0.0/4'];
const PRIVATE_V4 = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '127.0.0.0/8', '100.64.0.0/10', '192.0.0.0/24', '198.18.0.0/15'];

/** Expands an IPv6 address to its 8 groups (numbers), or null. */
function ipv6Groups(ip: string): number[] | null {
  let addr = ip.split('%')[0]!.toLowerCase();
  // Embedded IPv4 (::ffff:1.2.3.4).
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(addr);
  if (v4) {
    const n = ipv4ToInt(v4[1]!);
    addr = addr.slice(0, -v4[1]!.length) + `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const halves = addr.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 && missing !== 0) return null;
  const groups = [...head, ...Array(Math.max(0, missing)).fill('0'), ...tail].map((g) => parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

/**
 * Why `ip` may not be contacted ('private' or 'blocked'), or null when it is
 * a public address. 'private' addresses are allowed with allowPrivate.
 */
export function classifyAddress(ip: string): 'private' | 'blocked' | null {
  if (net.isIPv4(ip)) {
    if (ALWAYS_BLOCKED_V4.some((c) => inV4(ip, c))) return 'blocked';
    if (PRIVATE_V4.some((c) => inV4(ip, c))) return 'private';
    return null;
  }
  if (!net.isIPv6(ip)) return 'blocked';
  const g = ipv6Groups(ip);
  if (!g) return 'blocked';
  // IPv4-mapped (::ffff:a.b.c.d) and NAT64 (64:ff9b::a.b.c.d): judge the IPv4 address.
  const mapped = g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff;
  const nat64 = g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0);
  if (mapped || nat64) return classifyAddress(`${g[6]! >> 8}.${g[6]! & 0xff}.${g[7]! >> 8}.${g[7]! & 0xff}`);
  if (g.every((x) => x === 0)) return 'blocked'; // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return 'private'; // ::1
  if ((g[0]! & 0xffc0) === 0xfe80) return 'blocked'; // link-local fe80::/10
  if ((g[0]! & 0xff00) === 0xff00) return 'blocked'; // multicast
  if (g[0] === 0xfd00 && g[1] === 0x0ec2) return 'blocked'; // AWS metadata fd00:ec2::254
  if ((g[0]! & 0xfe00) === 0xfc00) return 'private'; // unique-local fc00::/7
  return null;
}

/**
 * Throws UnsafeUrlError unless `raw` is an http(s) URL without credentials
 * whose host resolves only to addresses that may be contacted: public ones,
 * plus private/LAN ones when `allowPrivate` (an admin-typed feed address).
 * Link-local and cloud metadata addresses are never allowed.
 */
export async function assertSafeRemoteUrl(raw: string, opts: { allowPrivate: boolean; lookup?: LookupFn }): Promise<URL> {
  return (await checkRemoteUrl(raw, opts)).url;
}

async function checkRemoteUrl(raw: string, opts: { allowPrivate: boolean; lookup?: LookupFn }): Promise<{ url: URL; isPrivate: boolean }> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError('Not a valid address.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new UnsafeUrlError('Only http and https addresses are allowed.');
  if (url.username || url.password) throw new UnsafeUrlError('Addresses with a user name or password are not allowed.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!host) throw new UnsafeUrlError('The address has no host.');
  let addresses: string[];
  if (net.isIP(host)) {
    addresses = [host];
  } else {
    try {
      addresses = (await (opts.lookup ?? safeUrlDeps.lookup)(host)).map((a) => a.address);
    } catch (err: any) {
      throw new UnsafeUrlError(`The host ${host} could not be resolved (${err?.code || err?.message || err}).`);
    }
    if (addresses.length === 0) throw new UnsafeUrlError(`The host ${host} could not be resolved.`);
  }
  let isPrivate = false;
  for (const address of addresses) {
    const kind = classifyAddress(address);
    if (kind === 'blocked' || (kind === 'private' && !opts.allowPrivate)) {
      throw new UnsafeUrlError(`The address ${host} points to a network location that is not allowed.`);
    }
    if (kind === 'private') isPrivate = true;
  }
  return { url, isPrivate };
}

export const MAX_REDIRECTS = 5;

/**
 * fetch() that follows at most MAX_REDIRECTS redirects itself, checking every
 * hop. A redirect may only lead to a private address when private addresses
 * are allowed AND the address it started from was itself private (a LAN feed
 * moving within the LAN); a public address never redirects into the LAN.
 */
export async function safeFetch(raw: string, init: RequestInit & { allowPrivate: boolean; lookup?: LookupFn; fetchFn?: typeof fetch }): Promise<Response> {
  const { allowPrivate, lookup, fetchFn, ...requestInit } = init;
  let current = raw;
  let privateAllowed = allowPrivate;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const { url, isPrivate } = await checkRemoteUrl(current, { allowPrivate: privateAllowed, lookup });
    if (hop === 0) privateAllowed = allowPrivate && isPrivate;
    const response = await (fetchFn ?? fetch)(url, { ...requestInit, redirect: 'manual' });
    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
      try { await response.body?.cancel(); } catch {}
      current = new URL(response.headers.get('location')!, url).toString();
      continue;
    }
    return response;
  }
  throw new UnsafeUrlError(`Too many redirects (more than ${MAX_REDIRECTS}).`);
}
