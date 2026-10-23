import { watch } from 'vue';
import { readCsrfToken, withCsrfHeader } from '~/utils/csrfFetch';
import { createSessionExpiryHandler } from '~/utils/sessionExpiry';
import { useAuth } from '~/composables/useAuth';
import { useToast } from '~/composables/useToast';

// The one window.fetch patch of the app:
// - adds the CSRF header to every same-origin mutating request;
// - watches every response for a 401 from our own API (expired or revoked
//   session): the user is signed out once, told so once, and sent to the
//   login page with a way back (see utils/sessionExpiry.ts).
//
// It patches window.fetch rather than replacing globalThis.$fetch: since
// Nuxt 4.6 the auto-imported `$fetch` is a constant captured when its module
// loads, i.e. before any plugin runs, so a replacement of the global is never
// seen by components or composables. ofetch calls the live window.fetch, so
// this covers $fetch, useFetch and plain fetch alike.
export default defineNuxtPlugin((nuxtApp) => {
  const auth = useAuth();
  const toast = useToast();
  const router = useRouter();

  const expiry = createSessionExpiryHandler({
    isLoggedIn: () => auth.isLoggedIn.value,
    currentRoute: () => {
      const r = router.currentRoute.value;
      return { path: r.path, fullPath: r.fullPath, query: r.query as Record<string, unknown> };
    },
    expire: (target) => {
      auth.user.value = null;
      // The instance is read when the toast fires, so it follows the current UI language.
      toast.error(nuxtApp.$i18n.t('errors.sessionExpired'), 6000);
      nuxtApp.runWithContext(() => navigateTo(target));
    },
  });
  // Signed in again: the next expiry is reported again.
  watch(() => auth.user.value, (user) => { if (user) expiry.reset(); });

  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const patched = withCsrfHeader(input, init, readCsrfToken(document.cookie), window.location.origin);
    return originalFetch(input, patched ?? init).then((response) => {
      if (response.status === 401) {
        try {
          expiry.onResponse(input, response.status, window.location.origin);
        } catch (err) {
          console.error('Session expiry handling failed:', err);
        }
      }
      return response;
    });
  };
});
