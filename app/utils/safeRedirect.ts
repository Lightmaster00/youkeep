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
  if (url.pathname === '/login') return null;
  return `${url.pathname}${url.search}${url.hash}`;
}
