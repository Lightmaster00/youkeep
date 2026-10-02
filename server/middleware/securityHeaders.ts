import { defineEventHandler, setHeader } from 'h3';
import { isSecureRequest } from '../utils/auth';

// Nuxt SSR emits inline <script>/<style> (payload + scoped CSS), so script-src
// and style-src need 'unsafe-inline'; everything else stays locked to the app's
// own origin: no external scripts, frames, plugins or form targets.
// Google Fonts is imported by main.css; images may come from any host (video
// thumbnails, channel avatars, podcast covers). Media is only ever played from
// files served by this app.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob: https: http:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'"
].join('; ');

export default defineEventHandler((event) => {
  setHeader(event, 'X-Content-Type-Options', 'nosniff');
  setHeader(event, 'X-Frame-Options', 'SAMEORIGIN');
  // Share links carry a token in the query string: never leak it to other sites.
  setHeader(event, 'Referrer-Policy', 'same-origin');
  setHeader(event, 'Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  // The dev server needs eval for HMR; the policy only applies to production.
  if (process.env.NODE_ENV === 'production') {
    setHeader(event, 'Content-Security-Policy', CSP);
  }
  // HSTS only over HTTPS (direct or via X-Forwarded-Proto): sending it on plain
  // HTTP is ignored by browsers, and a LAN install must never be locked to HTTPS.
  if (isSecureRequest(event)) {
    setHeader(event, 'Strict-Transport-Security', 'max-age=15552000');
  }
});
