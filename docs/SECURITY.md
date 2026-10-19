# Security

## Threat model

YouKeep is a self-hosted personal archive. It is meant to run on a home LAN, or on the internet only behind something that authenticates visitors first: a VPN (Tailscale, WireGuard), or an HTTPS reverse proxy with its own login (SSO, Cloudflare Access, basic auth). It has its own accounts and roles, but it is not designed or tested as a public, internet-facing service.

Trust levels:

- **Guests** (not signed in) can open public channels, videos and shorts, and anything reached through a share link. Nothing else.
- **Members** can browse private content, keep their own history, favorites, follows, playlists and progress, and manage their own API tokens.
- **Admins** manage the library, downloads, users and settings. An admin is trusted: admins can point downloads at folders on the server and add feeds on the LAN.
- **API tokens** act for their owner, limited by their scope (read-only or full access) and expiry. They can never create credentials, manage users or run destructive library operations; those need a browser session.

## What is protected

- Passwords are hashed with bcrypt; login runs the same work for unknown users, and failed logins are rate-limited per client address and per address and user name.
- Sessions are random IDs in `HttpOnly`, `SameSite=Lax` cookies (`Secure` over HTTPS), with a 7-day lifetime and at most 20 sessions per user. Changing or resetting a password ends the user's other sessions and revokes their API tokens.
- Every state-changing request from a browser session needs a CSRF token (double-submit, HMAC of the session).
- API tokens are 256-bit random secrets stored as SHA-256 hashes, shown once; read-only tokens may only make GET/HEAD requests; expired tokens are refused and purged.
- Visibility (public / private / ultra-private) is checked on every page, API and media route, including byte-range requests.
- Outbound requests to addresses that come from third parties (podcast feeds, enclosures, redirects) are refused when they resolve to loopback, link-local, cloud-metadata or (unless an admin typed a LAN feed) private addresses. The check runs again at connect time on the address actually used, so DNS rebinding cannot slip through, and on every redirect hop (at most 5).
- Every `/api/**` response (all of them depend on who asks) is sent with `Cache-Control: no-store` and `Vary: Cookie, Authorization`, so no shared or browser cache keeps one user's data for another. Media files keep their own caching.
- A security log records failed logins (address, attempted user name, reason), logins from a new address, password changes and resets, API token creation and revocation, user creation, deletion and role changes, and library wipe/tidy runs. Admins read it in Settings → System → Security log (browser session only, never with an API token). Entries are kept 90 days, at most 5000 of them; passwords, tokens, hashes and keys are never written to it.
- Response headers: Content-Security-Policy, `X-Content-Type-Options`, `Referrer-Policy`, frame protection, and `noindex` for crawlers.

## Known limitations

- Not hardened for direct internet exposure: there is no account lockout beyond the login rate limit, no two-factor authentication and no audit of every read.
- Admins are fully trusted (see above). Give the admin role only to people you would give shell access to the server's media folders.
- Share links are long random tokens that cannot be rotated individually; changing an item's visibility is the way to cut access.
- yt-dlp and ffmpeg process content from the internet. They run as the container user with access to the media folders; keep the image updated so they get security fixes.
- Development dependencies (npm audit, checked 2026-10-19). These advisories have no patched release yet and only affect build tooling, which is not part of the built server:

  | Advisory | Package (latest = affected) | Pulled in by | Why it does not reach the running app |
  | --- | --- | --- | --- |
  | [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) (stack exhaustion on deeply nested patterns) | braces 3.0.3, via micromatch 4.0.8, fast-glob, globby 16 | nitropack (build) | Only expands glob patterns written in the build configuration; never sees user input and is not shipped. |
  | [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv) (RSA PKCS#1 v1.5 signature check too lax) | node-forge 1.4.0 | listhen, via nitropack (dev server) | Only creates the self-signed certificate of `nuxt dev --https`; never used in production. |

  npm also lists `nuxt`, `nitropack`, `listhen`, `@nuxt/nitro-server`, `@nuxt/vite-builder` and `@nuxt/vite-server` only because they depend on the two packages above. The production server in `.output/server` contains just these packages: `@babel`, `@vue`, bcryptjs, better-sqlite3, bindings, devalue, entities, estree-walker, file-uri-to-path, fnv1a-64, hookable, nostics, object-identity, rss-parser, sax, source-map-js, ufo, undici, unhead, vue, vue-bundle-renderer, vue-router, xml2js, xmlbuilder. None of the flagged packages is among them, and none is bundled into the server code. Re-check with `npm audit` after upgrading Nuxt.

## Hardening checklist

- [ ] Put YouKeep behind an HTTPS reverse proxy, or reach it only over a VPN such as Tailscale or WireGuard. Do not forward port 3000 on your router.
- [ ] Behind a proxy, set `TRUST_PROXY` to the number of proxies in front of YouKeep (see the README), and publish the container port on `127.0.0.1` only when the proxy runs on the same host.
- [ ] Use strong, unique passwords for every account, especially admins; do not keep the seeded `admin` password.
- [ ] Prefer read-only API tokens with an expiry; revoke tokens you no longer use.
- [ ] Review the security log in Settings → System from time to time.
- [ ] Back up the data folder (database, settings) regularly; see Backups in the README.
- [ ] Keep the Docker image updated (`docker compose pull && docker compose up -d`) for fixes to YouKeep, Node.js, yt-dlp and ffmpeg.

## Reporting a vulnerability

Please report security issues privately, not in a public issue: use GitHub's "Report a vulnerability" (private security advisory) on the repository, or contact the maintainer directly. Include the version or commit, the steps to reproduce and the impact you expect. You will get an answer as soon as possible; please allow time for a fix before disclosing.
