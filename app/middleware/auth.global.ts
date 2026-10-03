import { moduleForPagePath } from '~/utils/moduleRouting';
import { shouldApplyLanding } from '~/utils/displayPrefs';

export default defineNuxtRouteMiddleware(async (to, from) => {
  const auth = useAuth();

  // If running on server, or if user check hasn't run yet, fetch current session
  if (import.meta.server || auth.loading.value) {
    await auth.fetchUser();
  }

  // Si non connecté et essaie d'aller sur une page protégée
  const publicRoutes = ['/login', '/', '/channels', '/categories', '/shorts'];
  const isPublicRoute = publicRoutes.includes(to.path) || to.path.startsWith('/watch/');
  if (!auth.isLoggedIn.value && !isPublicRoute) {
    return navigateTo('/login');
  }

  // If already logged in and trying to access the login page
  if (auth.isLoggedIn.value && to.path === '/login') {
    return navigateTo('/');
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
