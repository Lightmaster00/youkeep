# Languages (UI + video titles) design

## Goal
The app is available in 9 languages (en, fr, es, de, pt, it, zh, ja, ru). Each user picks the UI language and, separately, the language of video titles/descriptions.

## Scope
- User-facing pages are translated. Admin (settings and admin routes) stays English.
- No change to downloader behaviour or existing route contracts, except additive fields.

## Sub-projects
1. **Foundation**: `@nuxtjs/i18n` (no URL prefixes), catalogues `en` + `fr`, per-user `ui_language` stored on the user (default: browser language, fallback `en`), selector in Account. Migrate header, nav, login, account first.
2. **String migration** by area: home, subscriptions, channels, player, music, podcasts, search. A guard test fails if a migrated area contains hard-coded UI text.
3. **More languages**: es, de, pt, it, zh, ja, ru. A test asserts every catalogue has exactly the same keys as `en`.
4. **Video text language**: per-user `content_language` (`original` or a language code). When set, titles/descriptions show the translation if YouTube provides one; fetched lazily on first view, cached in a table, falls back to the original. Feasibility with yt-dlp must be validated on the real server before building (YouTube blocks the dev machine).

## Rules
- Missing key in a language falls back to English; never show a raw key.
- Dates and numbers formatted with `Intl` using the UI language.
- Language preference changes apply immediately without reload.

## Testing
Unit tests for locale resolution and key parity; component tests for the selector; live browser check of switching language.
