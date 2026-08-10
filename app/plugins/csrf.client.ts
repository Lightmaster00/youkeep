export default defineNuxtPlugin(() => {
  const csrfFetch = $fetch.create({
    onRequest({ options }) {
      const method = (options.method || 'GET').toString().toUpperCase();
      if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return;

      const token = useCookie('csrf_token').value;
      if (!token) return;

      options.headers = new Headers(options.headers);
      options.headers.set('x-csrf-token', token as string);
    }
  });

  globalThis.$fetch = csrfFetch as typeof globalThis.$fetch;
});
