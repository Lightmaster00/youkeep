// Where to go after signing in: only a same-origin path is accepted, so a
// crafted /login?redirect=... link can never send the user to another site.
// Accepted: "/watch/abc?t=3". Refused: "//evil.com", "/\evil", "https://x",
// "javascript:...", anything with control characters, and /login itself.
const BASE = 'http://redirect.invalid';

export function safeRedirectPath(raw: unknown): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) return null;
  if (!/^\/(?!\/)/.test(value)) return null;
  // Browsers treat "\" like "/", so "/\evil.com" would be protocol-relative.
  if (value.includes('\\')) return null;
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value, BASE);
  } catch {
    return null;
  }
  if (url.origin !== BASE) return null;
  // The checks above ran on the raw value; normalisation ("/.//x", "/a/..//x",
  // "/%2e%2e//x") can still produce a protocol-relative "//x", which the
  // router would treat as an external address. Check the normalised path,
  // percent-decoded, once more.
  let decoded: string;
  try {
    decoded = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  if (url.pathname.startsWith('//') || decoded.startsWith('//')) return null;
  if (decoded.includes('\\') || /[\u0000-\u001f\u007f]/.test(decoded)) return null;
  if (url.pathname === '/login') return null;
  return `${url.pathname}${url.search}${url.hash}`;
}
