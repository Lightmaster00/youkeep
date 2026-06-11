export default defineNuxtRouteMiddleware(async (to, from) => {
  const auth = useAuth();

  // If running on server, or if user check hasn't run yet, fetch current session
  if (import.meta.server || auth.loading.value) {
    await auth.fetchUser();
  }

  // Si non connecté et essaie d'aller sur une page protégée
  const publicRoutes = ['/login', '/', '/channels', '/categories'];
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
});
