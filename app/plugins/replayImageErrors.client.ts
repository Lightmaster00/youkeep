// Server-rendered <img> tags start loading before Vue hydrates and attaches
// their @error handlers, so an image that fails early (missing avatar, broken
// thumbnail) never gets its fallback. Once the app has hydrated, re-dispatch
// `error` on every image that already failed; the handlers' once-only guard
// (utils/imageFallback) keeps this from looping.
export function replayFailedImageErrors(root: ParentNode = document) {
  root.querySelectorAll('img').forEach((img) => {
    if (img.getAttribute('src') && img.complete && img.naturalWidth === 0) {
      img.dispatchEvent(new Event('error'));
    }
  });
}

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.hook('app:suspense:resolve', () => {
    // After the hydration patch has attached listeners.
    setTimeout(() => replayFailedImageErrors(), 0);
  });
});
