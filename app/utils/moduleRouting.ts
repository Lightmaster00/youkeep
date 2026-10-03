export type ModuleId = 'video' | 'music' | 'podcasts';

const VIDEO_PAGE_PREFIXES = ['/shorts', '/channels', '/subscriptions', '/playlists', '/watch'];

// Which module owns a page route. Cross-module pages (/search, /account,
// /settings, /admin, /login) belong to none, so they are never redirected.
export function moduleForPagePath(rawPath: string): ModuleId | null {
  const path = rawPath.split('?')[0] || '';
  if (path === '/') return 'video';
  if (VIDEO_PAGE_PREFIXES.some((p) => path === p || path.startsWith(p + '/'))) return 'video';
  if (path === '/music' || path.startsWith('/music/')) return 'music';
  if (path === '/podcasts' || path.startsWith('/podcasts/')) return 'podcasts';
  return null;
}

// The space the layout shows for a route. Module-less pages (/account,
// /search, /settings, /admin) use Video, unless a non-admin has Video disabled,
// in which case the first enabled space is used so the nav and search stay valid.
export function resolveActiveSpaceId(path: string, isAdmin: boolean, enabled: ModuleId[]): ModuleId {
  if (path === '/music' || path.startsWith('/music/')) return 'music';
  if (path === '/podcasts' || path.startsWith('/podcasts/')) return 'podcasts';
  if (isAdmin || enabled.includes('video')) return 'video';
  return enabled[0] ?? 'video';
}
