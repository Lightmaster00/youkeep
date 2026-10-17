// Image fallbacks for broken covers, avatars and thumbnails.
//
// An @error handler that sets a fallback which itself fails (missing file,
// blocked host) fires again, and a handler that blindly sets the same src
// again loops forever (thousands of requests per second). setImageFallback
// switches an image to its fallback at most once per original src: when the
// fallback errors too, it stops. It compares the src *attribute* (what Vue
// set), not the resolved .src property, so data URIs compare exactly.

export const FALLBACK_AVATAR = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%23666"><circle cx="12" cy="12" r="10"></circle><path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-3.33 0-10 1.67-10 5v2h20v-2c0-3.33-6.67-5-10-5z"></path></svg>';

export function setImageFallback(event: Event, fallback: string): void {
  const img = event.target as HTMLImageElement | null;
  if (!img || !fallback) return;
  const current = img.getAttribute('src');
  // The fallback itself failed: leave it broken rather than retrying.
  if (current === fallback || img.dataset.fallbackSrc === current) return;
  img.dataset.fallbackSrc = fallback;
  img.setAttribute('src', fallback);
}
