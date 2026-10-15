import { getHeader, type H3Event } from 'h3';

// TRUST_PROXY tells the app how many reverse proxies sit in front of it.
// Empty, "false" or "0": none, X-Forwarded-* headers are ignored (any client
// could forge them). "true" or "1": one proxy (Nginx Proxy Manager, Traefik,
// Caddy, Cloudflare Tunnel...). "N": N proxies chained.
export function trustedProxyHops(): number {
  const raw = (process.env.TRUST_PROXY ?? '').trim().toLowerCase();
  if (raw === '' || raw === 'false' || raw === '0' || raw === 'no') return 0;
  if (raw === 'true' || raw === 'yes') return 1;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 && n < 100 ? n : 0;
}

function headerList(event: H3Event, name: string): string[] {
  return (getHeader(event, name) ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');
}

// Each trusted proxy appends the address it received the request from, so
// with N proxies the client is the Nth entry from the RIGHT. Anything to the
// left of it was sent by the client itself and can be forged.
function forwardedValue(event: H3Event, name: string): string | undefined {
  const hops = trustedProxyHops();
  if (hops === 0) return undefined;
  const entries = headerList(event, name);
  if (entries.length === 0) return undefined;
  return entries[Math.max(0, entries.length - hops)];
}

/** The client's IP address, honouring X-Forwarded-For only when TRUST_PROXY is set. */
export function getClientIp(event: H3Event): string {
  const forwarded = forwardedValue(event, 'x-forwarded-for');
  if (forwarded) return forwarded;
  return event.context?.clientAddress || event.node.req.socket?.remoteAddress || 'unknown';
}

/** X-Forwarded-Proto, only when TRUST_PROXY is set. */
export function getForwardedProto(event: H3Event): string | undefined {
  return forwardedValue(event, 'x-forwarded-proto')?.toLowerCase();
}

/** X-Forwarded-Host, only when TRUST_PROXY is set. */
export function getForwardedHost(event: H3Event): string | undefined {
  return forwardedValue(event, 'x-forwarded-host');
}
