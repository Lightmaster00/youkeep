import { defineEventHandler, setHeader } from 'h3';

// No HSTS (many installs are plain HTTP on a LAN) and no CSP (Nuxt SSR emits
// inline scripts); these headers are safe for both HTTP and HTTPS setups.
export default defineEventHandler((event) => {
  setHeader(event, 'X-Content-Type-Options', 'nosniff');
  setHeader(event, 'X-Frame-Options', 'SAMEORIGIN');
  // Share links carry a token in the query string: never leak it to other sites.
  setHeader(event, 'Referrer-Policy', 'same-origin');
  setHeader(event, 'Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
});
