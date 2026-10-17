import { moduleForPagePath } from '~/utils/moduleRouting';
import { shouldApplyLanding } from '~/utils/displayPrefs';
import { safeRedirectPath } from '~/utils/safeRedirect';

export default defineNuxtRouteMiddleware(async (to, from) => {
  const auth = useAuth();

  // If running on server, or if user check hasn't run yet, fetch current session
  if (import.meta.server || auth.loading.value) {
    await auth.fetchUser();
  }

  // If not logged in and trying to reach a protected page
  const publicRoutes = ['/login', '/', '/channels', '/shorts'];
  // A personal playlist opened from its share link (?token=...) is readable by
  // guests; the API checks the token.
  const isSharedPlaylist = to.path.startsWith('/playlists/')
    && typeof to.query.token === 'string' && to.query.token !== '';
  const isPublicRoute = publicRoutes.includes(to.path) || to.path.startsWith('/watch/') || isSharedPlaylist;
  if (!auth.isLoggedIn.value && !isPublicRoute) {
    // Come back here after signing in.
    const back = safeRedirectPath(to.fullPath);
    return navigateTo(back && back !== '/' ? { path: '/login', query: { redirect: back } } : '/login');
  }

  // If already logged in and trying to access the login page
  if (auth.isLoggedIn.value && to.path === '/login') {
    return navigateTo(safeRedirectPath(to.query.redirect) || '/');
  }

  // Protect admin dashboard pages from standard users
  if (to.path.startsWith('/admin') && !auth.isAdmin.value) {
    return navigateTo('/');
  }

  // A disabled module is invisible to non-admins: send them to the first
  // enabled module's home. Cross-module pages (/search, /account, ...) belong
  // to no module and are never redirected.
  const { ensureLoaded, isEnabled, firstEnabledHome } = useModules();
  await ensureLoaded();
  const owner = moduleForPagePath(to.path);
  if (owner && !auth.isAdmin.value && !isEnabled(owner)) {
    return navigateTo(firstEnabledHome.value);
  }

  // Load the display preferences for the current user (also on the server, so
  // the density attribute is part of the first HTML response).
  await useDisplayPrefs().ensureLoaded();

  // Landing space: when entering the app at '/', start on the user's chosen
  // space, once per browser tab session. Client only (sessionStorage); it runs
  // after every redirect above, so those still win.
  if (import.meta.client && shouldApplyLanding(to.path, to.query)) {
    const target = await useLanding().consumeLandingTarget();
    if (target) return navigateTo(target);
  }
});
