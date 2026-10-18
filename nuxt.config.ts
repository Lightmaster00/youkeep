// https://nuxt.com/docs/api/configuration/nuxt-config

// Changes on every build (or set YOUKEEP_BUILD_ID): the service worker is
// registered as /sw.js?v=<buildId>, so each build installs a fresh worker with
// its own cache and drops the previous build's files.
const buildId = process.env.YOUKEEP_BUILD_ID || Date.now().toString(36);

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  css: ['~/assets/css/main.css'],
  runtimeConfig: {
    public: {
      buildId
    }
  },
  nitro: {
    externals: {
      external: ['better-sqlite3']
    }
  },
  app: {
    head: {
      title: 'YouKeep',
      meta: [
        { name: 'theme-color', content: '#8b5cf6' },
        // A private, self-hosted app: keep every page out of search engines.
        { name: 'robots', content: 'noindex, nofollow' },
        // The standard name (the apple- one alone is deprecated); iOS still
        // reads apple-mobile-web-app-status-bar-style below.
        { name: 'mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' }
      ],
      link: [
        { rel: 'manifest', href: '/manifest.webmanifest' },
        { rel: 'icon', type: 'image/x-icon', href: '/favicon.ico' },
        { rel: 'icon', type: 'image/svg+xml', href: '/icon.svg' },
        { rel: 'apple-touch-icon', href: '/icon.svg' }
      ]
    }
  }
})


