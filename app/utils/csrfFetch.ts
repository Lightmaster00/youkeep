const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function readCsrfToken(cookie: string): string | null {
  const match = cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/);
  return match ? decodeURIComponent(match[1] ?? '') : null;
}

// Returns the init to use for a window.fetch call: for a same-origin mutating
// request that carries no x-csrf-token yet, the header is added. Anything else
// is returned untouched (null = leave the call as it is).
export function withCsrfHeader(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  token: string | null,
  origin: string
): RequestInit | null {
  if (!token) return null;
  const isRequest = typeof Request !== 'undefined' && input instanceof Request;
  const method = (init?.method || (isRequest ? (input as Request).method : 'GET')).toUpperCase();
  if (!MUTATING.has(method)) return null;

  const rawUrl = isRequest ? (input as Request).url : input instanceof URL ? input.href : String(input);
  let url: URL;
  try { url = new URL(rawUrl, origin); } catch { return null; }
  if (url.origin !== origin) return null;

  const headers = new Headers(init?.headers ?? (isRequest ? (input as Request).headers : undefined));
  if (headers.has('x-csrf-token')) return null;
  headers.set('x-csrf-token', token);
  return { ...init, headers };
}
