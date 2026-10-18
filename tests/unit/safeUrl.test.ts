import { describe, it, expect, vi } from 'vitest';
import { assertSafeRemoteUrl, classifyAddress, safeFetch } from '../../server/utils/safeUrl';

const lookupTo = (...addresses: string[]) => async () => addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));

describe('classifyAddress', () => {
  it.each([
    ['93.184.216.34', null], ['8.8.8.8', null], ['2606:4700::1111', null],
    ['127.0.0.1', 'private'], ['10.1.2.3', 'private'], ['172.20.0.1', 'private'], ['192.168.1.10', 'private'], ['100.64.0.1', 'private'],
    ['::1', 'private'], ['fd12:3456::1', 'private'], ['fc00::1', 'private'],
    ['169.254.169.254', 'blocked'], ['169.254.1.1', 'blocked'], ['0.0.0.0', 'blocked'], ['224.0.0.1', 'blocked'], ['255.255.255.255', 'blocked'],
    ['::', 'blocked'], ['fe80::1', 'blocked'], ['ff02::1', 'blocked'], ['fd00:ec2::254', 'blocked'],
    ['::ffff:127.0.0.1', 'private'], ['::ffff:169.254.169.254', 'blocked'], ['::ffff:8.8.8.8', null], ['64:ff9b::a9fe:a9fe', 'blocked'],
    // Reserved 240.0.0.0/4 (incl. broadcast), IETF protocol assignments, benchmarking 198.18.0.0/15.
    ['240.0.0.1', 'blocked'], ['250.1.2.3', 'blocked'], ['255.255.255.254', 'blocked'],
    ['192.0.0.8', 'private'], ['192.0.0.255', 'private'], ['192.0.1.1', null],
    ['198.18.0.1', 'private'], ['198.19.255.255', 'private'], ['198.17.255.255', null], ['198.20.0.1', null],
    ['239.255.255.255', 'blocked'], ['223.255.255.255', null],
    // Anything that is not an IP address at all is never contacted.
    ['example.com', 'blocked'], ['', 'blocked'], ['1.2.3', 'blocked'], ['::ffff:zz', 'blocked'],
  ])('%s -> %s', (ip, expected) => {
    expect(classifyAddress(ip)).toBe(expected);
  });
});

describe('assertSafeRemoteUrl', () => {
  it('accepts a public http(s) address', async () => {
    await expect(assertSafeRemoteUrl('https://feeds.example/rss', { allowPrivate: false, lookup: lookupTo('93.184.216.34') })).resolves.toBeInstanceOf(URL);
  });
  it('refuses other schemes, credentials and unresolvable hosts', async () => {
    for (const url of ['file:///etc/passwd', 'ftp://h/x', 'gopher://h/', 'javascript:alert(1)', 'https://user:pw@h/x', 'not a url']) {
      await expect(assertSafeRemoteUrl(url, { allowPrivate: true, lookup: lookupTo('93.184.216.34') })).rejects.toThrow();
    }
    await expect(assertSafeRemoteUrl('https://nowhere.invalid/', { allowPrivate: true, lookup: async () => { throw Object.assign(new Error('x'), { code: 'ENOTFOUND' }); } })).rejects.toThrow(/could not be resolved/);
  });
  it('refuses private addresses unless allowed, and metadata endpoints always', async () => {
    await expect(assertSafeRemoteUrl('http://nas.lan/feed', { allowPrivate: false, lookup: lookupTo('192.168.1.5') })).rejects.toThrow(/not allowed/);
    await expect(assertSafeRemoteUrl('http://nas.lan/feed', { allowPrivate: true, lookup: lookupTo('192.168.1.5') })).resolves.toBeInstanceOf(URL);
    await expect(assertSafeRemoteUrl('http://169.254.169.254/latest/meta-data', { allowPrivate: true })).rejects.toThrow(/not allowed/);
    await expect(assertSafeRemoteUrl('http://[::1]:8080/', { allowPrivate: false })).rejects.toThrow(/not allowed/);
    // Any one bad address of a name is enough.
    await expect(assertSafeRemoteUrl('https://mixed.example/', { allowPrivate: false, lookup: lookupTo('93.184.216.34', '127.0.0.1') })).rejects.toThrow(/not allowed/);
  });
});

describe('safeFetch', () => {
  it('checks every redirect hop, never lets a public address redirect into the LAN, and caps redirects', async () => {
    const lookup = async (host: string) => [{ address: host === 'lan.example' ? '10.0.0.5' : '93.184.216.34', family: 4 }];
    const fetchFn = vi.fn(async (url: any) => {
      const u = new URL(String(url));
      if (u.pathname === '/to-lan') return new Response(null, { status: 302, headers: { location: 'http://lan.example/secret' } });
      if (u.pathname === '/to-metadata') return new Response(null, { status: 301, headers: { location: 'http://169.254.169.254/' } });
      if (u.pathname.startsWith('/loop')) return new Response(null, { status: 302, headers: { location: `/loop${Number(u.pathname.slice(5) || 0) + 1}` } });
      return new Response('ok');
    }) as any;
    await expect(safeFetch('https://pub.example/to-lan', { allowPrivate: true, lookup, fetchFn })).rejects.toThrow(/not allowed/);
    await expect(safeFetch('https://pub.example/to-metadata', { allowPrivate: true, lookup, fetchFn })).rejects.toThrow(/not allowed/);
    await expect(safeFetch('https://pub.example/loop', { allowPrivate: false, lookup, fetchFn })).rejects.toThrow(/Too many redirects/);
    expect(fetchFn.mock.calls.every(([, init]: any[]) => init.redirect === 'manual')).toBe(true);
    // A LAN feed may move within the LAN.
    const lanFetch = vi.fn(async (url: any) => (new URL(String(url)).pathname === '/old' ? new Response(null, { status: 302, headers: { location: '/new' } }) : new Response('feed'))) as any;
    const res = await safeFetch('http://lan.example/old', { allowPrivate: true, lookup, fetchFn: lanFetch });
    expect(await res.text()).toBe('feed');
  });
});
