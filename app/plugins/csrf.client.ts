import { readCsrfToken, withCsrfHeader } from '~/utils/csrfFetch';

// Adds the CSRF header to every same-origin mutating request.
//
// It patches window.fetch rather than replacing globalThis.$fetch: since
// Nuxt 4.6 the auto-imported `$fetch` is a constant captured when its module
// loads, i.e. before any plugin runs, so a replacement of the global is never
// seen by components or composables. ofetch calls the live window.fetch, so
// this covers $fetch, useFetch and plain fetch alike.
export default defineNuxtPlugin(() => {
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const patched = withCsrfHeader(input, init, readCsrfToken(document.cookie), window.location.origin);
    return originalFetch(input, patched ?? init);
  };
});
