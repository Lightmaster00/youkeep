import { safeRedirectPath } from './safeRedirect';

// What to do when an API call answers 401 (the session expired or was
// revoked): sign the user out once, say so once, and send them to the login
// page with a way back. Pure logic; the window.fetch patch (plugins/csrf.client.ts)
// feeds it every response.

// Their own 401 means "wrong password" or "nobody is signed in", not an expiry;
// the login and logout flows handle those themselves.
const EXCLUDED_PATHS = new Set(['/api/auth/login', '/api/auth/setup', '/api/auth/me', '/api/auth/logout']);

const PUBLIC_PATHS = new Set(['/login', '/', '/channels', '/shorts']);

/** Pages a guest may open (the auth middleware lets them through). */
export function isPublicRoute(path: string, query: Record<string, unknown> = {}): boolean {
  // A personal playlist opened from its share link (?token=...) is readable by
  // guests; the API checks the token.
  const isSharedPlaylist = path.startsWith('/playlists/') && typeof query.token === 'string' && query.token !== '';
  return PUBLIC_PATHS.has(path) || path.startsWith('/watch/') || isSharedPlaylist;
}

/** True for a 401 from one of this app's own /api routes, other than the excluded auth ones. */
export function isExpiryResponse(input: RequestInfo | URL, status: number, origin: string): boolean {
  if (status !== 401) return false;
  const isRequest = typeof Request !== 'undefined' && input instanceof Request;
  const raw = isRequest ? (input as Request).url : input instanceof URL ? input.href : String(input);
  let url: URL;
  try { url = new URL(raw, origin); } catch { return false; }
  if (url.origin !== origin) return false;
  if (!url.pathname.startsWith('/api/')) return false;
  return !EXCLUDED_PATHS.has(url.pathname.replace(/\/+$/, ''));
}

/** Where to send the user: /login, with ?redirect=<current page> when that page is a safe one to come back to. */
export function loginTarget(fullPath: string): { path: '/login'; query?: { redirect: string } } {
  const back = safeRedirectPath(fullPath);
  return back && back !== '/' ? { path: '/login', query: { redirect: back } } : { path: '/login' };
}

export interface SessionExpiryDeps {
  isLoggedIn: () => boolean;
  currentRoute: () => { path: string; fullPath: string; query: Record<string, unknown> };
  /** Clears the auth state, shows the toast and navigates (called once per expiry). */
  expire: (target: ReturnType<typeof loginTarget>) => void;
}

/**
 * Returns `onResponse`, to call with every fetch response, and `reset`, to
 * call when the user signs in again. Only the first 401 of an expiry acts;
 * later ones (the other requests of the same page) are ignored until reset.
 * Nothing happens on the login page, nor for a guest on a public page (a
 * guest's 401 there is expected and handled by the page).
 */
export function createSessionExpiryHandler(deps: SessionExpiryDeps) {
  let handled = false;
  return {
    onResponse(input: RequestInfo | URL, status: number, origin: string): boolean {
      if (!isExpiryResponse(input, status, origin)) return false;
      const route = deps.currentRoute();
      if (route.path === '/login') return false;
      if (!deps.isLoggedIn() && isPublicRoute(route.path, route.query)) return false;
      if (handled) return false;
      handled = true;
      deps.expire(loginTarget(route.fullPath));
      return true;
    },
    reset() {
      handled = false;
    },
  };
}

/** True for a $fetch error caused by a 401 (the global handler already reported it). */
export function isUnauthorizedError(err: unknown): boolean {
  const e = err as { statusCode?: number; status?: number; response?: { status?: number } } | null;
  return !!e && (e.statusCode === 401 || e.status === 401 || e.response?.status === 401);
}
