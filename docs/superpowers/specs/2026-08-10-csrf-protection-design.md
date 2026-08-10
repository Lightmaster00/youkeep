# CSRF Protection — Design

## Context

Eleventh sub-project of the ongoing "bug fixes" initiative — the third of 5 items reopened after the user explicitly asked to reconsider previously-declined audit findings ("corrige tout"). Originally declined ("`sameSite: lax` + JSON-only + no permissive CORS already mitigates; a real token implementation is a non-trivial new feature for negligible residual risk on self-hosted app"); the user now wants it implemented for real.

Explored the current auth mechanics (`server/utils/auth.ts`): sessions are a random UUID stored in the `sessions` table, set as an `httpOnly`, `sameSite: 'lax'`, `secure`-in-production cookie (`youkeep_session`) by `createSession()`. `requireUser`/`requireAdmin` read this cookie on every protected route. No CSRF-adjacent code exists today.

The frontend has no central request interceptor — every mutating call is a direct `$fetch(...)` or `useFetch(...)` across 50+ Vue files, with no plugin or shared wrapper. Confirmed via Nuxt's architecture that this doesn't require touching every call site: Nuxt's globally auto-imported `$fetch` resolves to `globalThis.$fetch` (the `ofetch` instance Nitro/Nuxt provide), and a single client plugin can replace that global instance (`globalThis.$fetch = $fetch.create({ onRequest ... })`) to transparently intercept every subsequent `$fetch`/`useFetch` call app-wide, including ones already written.

Confirmed no webhook or third-party callback endpoints exist in this app (checked `server/api/**` for `webhook`) — the only endpoints that must remain reachable without a session (and therefore naturally need no CSRF header) are `POST /api/auth/login` and `POST /api/dev/login`, both of which create a session rather than requiring one already exist.

## Scope

- Protect all authenticated, state-changing routes (`POST`/`PUT`/`PATCH`/`DELETE` under `server/api/**` reached with an existing session cookie) — both admin and regular-user actions, not just `server/api/admin/**`.
- Double-submit cookie pattern: a second, JS-readable cookie compared against a request header. No server-side token storage, no DB schema change.

## Non-Goals

- No synchronizer-token pattern (DB-backed per-session token) — double-submit is sufficient for this app's threat model and needs no schema change or per-request DB lookup.
- No change to `sameSite`/`httpOnly`/`secure` settings on the existing session cookie — this adds a second, independent protection layer, not a replacement.
- No CSRF protection on `POST /api/auth/login` or `POST /api/dev/login` — neither has an existing session to hijack at request time, so there's nothing for CSRF to protect there; both are excluded automatically by the middleware's own logic (see Design), not via a maintained exemption list.
- No change to any of the 50+ existing `$fetch`/`useFetch` call sites — the client plugin makes this transparent.

## Design

### 1. Server: issue the CSRF cookie alongside the session cookie

In `server/utils/auth.ts`'s `createSession(userId, event)`, after generating `sessionId`, also generate a CSRF token (`crypto.randomUUID()`, same primitive already used for session IDs) and set it as a second cookie:

```ts
const csrfToken = crypto.randomUUID();
setCookie(event, 'csrf_token', csrfToken, {
  httpOnly: false, // must be readable by client JS to echo back as a header
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: SESSION_DURATION / 1000,
  path: '/'
});
```

`destroySession(event)` also clears this cookie (`deleteCookie(event, 'csrf_token', { path: '/' })`), alongside the existing session-cookie deletion, so a logged-out session doesn't leave a stale CSRF cookie behind.

### 2. Server: validate on state-changing requests

New `server/middleware/csrf.ts` (Nitro server middleware, runs before route handlers on every request):

```ts
import { defineEventHandler, getCookie, getHeader, createError } from 'h3';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export default defineEventHandler((event) => {
  if (!MUTATING_METHODS.has(event.method)) return;

  const sessionId = getCookie(event, 'youkeep_session');
  if (!sessionId) return; // no session to protect (e.g. login itself)

  const cookieToken = getCookie(event, 'csrf_token');
  const headerToken = getHeader(event, 'x-csrf-token');

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    throw createError({ statusCode: 403, statusMessage: 'Invalid or missing CSRF token. Please refresh the page and try again.' });
  }
});
```

This runs for every mutating request with a session cookie present, regardless of whether the route ultimately requires `requireUser`/`requireAdmin` — correct, since a route reachable with a session cookie but no auth requirement doesn't exist in this app's mutating surface (all mutating routes already call one of those two).

### 3. Client: transparently attach the header

New `app/plugins/csrf.client.ts`:

```ts
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
```

The `.client.ts` suffix (Nuxt convention) means this only runs in the browser — correct, since SSR-time data fetching in this app is exclusively `GET` (initial page data), never a mutation; nothing server-rendered needs the header. `useCookie('csrf_token')` is Nuxt's built-in reactive cookie accessor, reading the same non-`httpOnly` cookie the server just set.

## Error Handling

A request that fails the CSRF check gets a `403` with a clear `statusMessage` before it ever reaches its route handler's own logic — the existing frontend pattern (`toast.error(err.data?.statusMessage || ...)`, used throughout the app) surfaces this like any other API error, no new client-side handling needed. In the extremely unlikely case a legitimate user hits this (e.g. a very stale tab with an expired/rotated CSRF cookie), the message tells them to refresh, which re-fetches a valid session+CSRF cookie pair.

## Verification

New test file `tests/integration/csrf.test.ts` (unit-test style, matching this codebase's existing `tests/integration/*.test.ts` pattern for server routes, e.g. `dev-login.test.ts`): verify (a) a mutating request with a valid session but no `x-csrf-token` header is rejected with 403, (b) a mutating request with a mismatched header is rejected with 403, (c) a mutating request with the correct header succeeds, (d) a mutating request with no session cookie at all (e.g. `POST /api/auth/login`) is not blocked by this middleware. For the client plugin, this codebase has no Vue/component test infrastructure (project-wide accepted gap) — verify manually via the dev-login fixture: confirm a real authenticated mutation (e.g. toggling a channel's subscription) still works end-to-end through the browser, and confirm via the Network tab that the `x-csrf-token` header is present on the request.
