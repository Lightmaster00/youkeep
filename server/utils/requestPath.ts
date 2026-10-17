/**
 * The request path that path-based rules (cross-site guard, forced password
 * change, module gate) compare against: query string removed, repeated
 * slashes collapsed, trailing slashes removed and lower-cased, so
 * `/API//auth/login/?x=1` matches the rule for `/api/auth/login`.
 */
export function normalizeRequestPath(raw: string | undefined | null): string {
  const pathOnly = (raw || '').split('?')[0]!.split('#')[0]!;
  const collapsed = pathOnly.replace(/\/{2,}/g, '/').replace(/\/+$/, '').toLowerCase();
  if (!collapsed) return '/';
  return collapsed.startsWith('/') ? collapsed : `/${collapsed}`;
}
