export default defineNuxtPlugin(() => {
  const csrfFetch = $fetch.create({
    onRequest({ options }) {
      const method = (options.method || 'GET').toString().toUpperCase();
      if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return;

      const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/);
      if (!match) return;

      options.headers = new Headers(options.headers);
      options.headers.set('x-csrf-token', decodeURIComponent(match[1]));
    }
  });

  globalThis.$fetch = csrfFetch as typeof globalThis.$fetch;
});
