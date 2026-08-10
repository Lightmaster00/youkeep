# CSRF Protection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add double-submit-cookie CSRF protection to all authenticated, state-changing routes (admin and regular-user) without touching any of the 50+ existing `$fetch`/`useFetch` call sites in the frontend.

**Architecture:** `createSession()` issues a second, JS-readable `csrf_token` cookie alongside the existing `httpOnly` session cookie. A new Nitro server middleware (`server/middleware/csrf.ts`) rejects any `POST`/`PUT`/`PATCH`/`DELETE` request that carries a session cookie but whose `x-csrf-token` header doesn't match the `csrf_token` cookie. A new client-only Nuxt plugin (`app/plugins/csrf.client.ts`) replaces the global `$fetch` instance so every existing mutating call automatically carries the header — no call site changes needed.

**Tech Stack:** Nuxt 4, Nitro (H3), better-sqlite3, Vitest

## Global Constraints

- No change to `sameSite`/`httpOnly`/`secure` settings on the existing session cookie.
- No synchronizer-token / DB-backed CSRF storage — double-submit cookie only, no schema change.
- No CSRF protection added to `POST /api/auth/login` or `POST /api/dev/login` — both are naturally excluded by the middleware's own "no session cookie present" check, not a maintained exemption list; do not add special-case route-path exclusions.
- No changes to any of the existing 50+ `$fetch`/`useFetch` call sites in the frontend — the client plugin must be the only touch point.
- This codebase has zero Vue component test infrastructure (project-wide, accepted gap) — the client plugin (Task 3) has no dedicated automated test; its verification step is manual only, via the dev-login fixture and a real browser Network-tab check.

---

## Task 1: Extend the test mock event + add the CSRF cookie to `server/utils/auth.ts`

**Files:**
- Modify: `tests/helpers/testDb.ts` (the `mockEvent` helper, lines 210-239)
- Modify: `server/utils/auth.ts` (`createSession`, `destroySession`)
- Modify: `tests/integration/dev-login.test.ts` (one assertion needs to also check the new cookie)

**Interfaces:**
- Consumes: nothing new.
- Produces: `createSession()` now also sets a `csrf_token` cookie (name literal `'csrf_token'`); `destroySession()` now also clears it. `mockEvent()` gains an optional `method` field in its `opts` and a `res` mock that supports a second `setCookie` call in the same request (needed by both this task's own test and Task 4's middleware tests).

### Why the test helper needs to change first

`h3`'s `setCookie(event, name, value, opts)` looks at `event.node.res.getHeader('set-cookie')` to decide how to write the new cookie: if no `set-cookie` header exists yet, it calls `event.node.res.setHeader(...)` (already supported by `mockEvent`); but if one *already* exists (i.e. this is the *second* `setCookie` call in the same request — which is exactly what happens once `createSession()` sets both the session cookie and the CSRF cookie), it calls `event.node.res.removeHeader(...)` and `event.node.res.appendHeader(...)` instead. `mockEvent`'s current `res` mock only defines `getHeader`/`setHeader`, so any test that calls the real `createSession()` against a `mockEvent()` — including the existing `tests/integration/dev-login.test.ts` — will throw a `TypeError` the moment `createSession` tries to set the second cookie, unless this gap is closed first.

- [ ] **Step 1: Extend `mockEvent`'s res mock and add a `method` option**

Read the current file first — this replaces exactly the block at `tests/helpers/testDb.ts:210-239`:

```typescript
// Minimal H3Event stand-in: covers exactly what getUserFromSession/getCookie/
// setCookie/deleteCookie touch (event.node.req.headers.cookie, event.node.res.*).
export function mockEvent(cookieHeader?: string, opts?: { path?: string; params?: Record<string, string>; body?: any; headers?: Record<string, string>; method?: string }): any {
  const req: any = {
    method: opts?.method ?? 'GET',
    headers: { cookie: cookieHeader || '', ...(opts?.headers ?? {}) }
  };
  if (opts && Object.prototype.hasOwnProperty.call(opts, 'body')) {
    // H3's readBody(event) checks for a value already stored under this
    // well-known symbol before attempting to read/parse a raw request
    // stream — setting it directly lets tests supply a body without
    // simulating an actual HTTP request stream. Symbol.for is a global
    // registry lookup, so this matches h3's own internal ParsedBodySymbol
    // even though it isn't exported from the package.
    req[Symbol.for('h3ParsedBody')] = opts.body;
  }
  const resHeaders: Record<string, any> = {};
  return {
    method: opts?.method ?? 'GET',
    path: opts?.path ?? '/',
    context: { params: opts?.params ?? {} },
    node: {
      req,
      res: {
        statusCode: 200,
        headers: resHeaders,
        getHeader: (name: string) => resHeaders[name.toLowerCase()],
        setHeader: (name: string, value: any) => { resHeaders[name.toLowerCase()] = value; },
        // h3's setCookie() calls these on every SECOND (and later) cookie set
        // in the same request/response cycle — createSession() now sets two
        // cookies (session + csrf_token), so both must be supported here.
        removeHeader: (name: string) => { delete resHeaders[name.toLowerCase()]; },
        appendHeader: (name: string, value: any) => {
          const key = name.toLowerCase();
          const existing = resHeaders[key];
          if (existing === undefined) {
            resHeaders[key] = value;
          } else if (Array.isArray(existing)) {
            existing.push(value);
          } else {
            resHeaders[key] = [existing, value];
          }
        }
      }
    }
  };
}
```

Note: `event.method` is set both on `node.req.method` and directly on the returned object's own `method` property — the real `H3Event` class exposes `method` as a getter computed from `node.req.method`, but since this mock is a plain object (not an `H3Event` instance), setting it directly on the object is what makes `event.method` readable by code that expects the real getter's behavior (this codebase's new CSRF middleware, Task 2, reads `event.method` directly).

- [ ] **Step 2: Add the CSRF cookie to `createSession()` and clear it in `destroySession()`**

Read `server/utils/auth.ts` in full first to confirm the current exact content still matches (it was last touched by the dev-login-fixture sub-project). Apply this change to the `createSession` and `destroySession` functions:

```typescript
export async function createSession(userId: string, event: H3Event): Promise<string> {
  const db = getDb();
  const sessionId = crypto.randomUUID();
  const expiresAt = Date.now() + SESSION_DURATION;

  // Insert session in DB
  db.prepare(`
    INSERT INTO sessions (id, user_id, expires_at)
    VALUES (?, ?, ?)
  `).run(sessionId, userId, expiresAt);

  // Set httpOnly cookie
  setCookie(event, SESSION_COOKIE_NAME, sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_DURATION / 1000,
    path: '/'
  });

  // Set a second, JS-readable CSRF token cookie (double-submit pattern) —
  // NOT httpOnly, since the client plugin (app/plugins/csrf.client.ts) must
  // be able to read it and echo it back as a header on mutating requests.
  const csrfToken = crypto.randomUUID();
  setCookie(event, CSRF_COOKIE_NAME, csrfToken, {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_DURATION / 1000,
    path: '/'
  });

  return sessionId;
}

export async function destroySession(event: H3Event): Promise<void> {
  const sessionId = getCookie(event, SESSION_COOKIE_NAME);
  if (sessionId) {
    const db = getDb();
    db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
    deleteCookie(event, SESSION_COOKIE_NAME, { path: '/' });
    deleteCookie(event, CSRF_COOKIE_NAME, { path: '/' });
  }
}
```

Also add the new constant next to the existing `SESSION_COOKIE_NAME`/`SESSION_DURATION` constants near the top of the file:

```typescript
const SESSION_COOKIE_NAME = 'youkeep_session';
const CSRF_COOKIE_NAME = 'csrf_token';
const SESSION_DURATION = 1000 * 60 * 60 * 24 * 7; // 7 days
```

(Only the `CSRF_COOKIE_NAME` line is new — the other two already exist; show them here so the insertion point is unambiguous.)

- [ ] **Step 3: Update the existing dev-login test's cookie assertion**

`tests/integration/dev-login.test.ts` already asserts the response contains a `youkeep_session=` cookie. Add a second assertion for the new cookie right after it (in the `'creates the fixture user and returns a session cookie when both conditions are met'` test):

```typescript
    const setCookieHeader = event.node.res.getHeader('set-cookie');
    expect(setCookieHeader).toBeDefined();
    expect(String(setCookieHeader)).toContain('youkeep_session=');
    expect(String(setCookieHeader)).toContain('csrf_token=');
```

(The `String(setCookieHeader)` conversion already works whether `setCookieHeader` is a single string or the array `appendHeader` may now produce, since `Array.prototype.toString()` joins with commas and `.toContain` does a substring search either way.)

- [ ] **Step 4: Run the full test suite to confirm nothing broke**

Run: `npm run test`
Expected: all existing tests pass, including the updated `dev-login.test.ts` (which now exercises the two-cookie `removeHeader`/`appendHeader` path in the extended mock).

- [ ] **Step 5: Commit**

```bash
git add tests/helpers/testDb.ts server/utils/auth.ts tests/integration/dev-login.test.ts
git commit -m "feat: issue a CSRF cookie alongside the session cookie"
```

---

## Task 2: Create the CSRF-checking Nitro middleware

**Files:**
- Create: `server/middleware/csrf.ts`

**Interfaces:**
- Consumes: `event.method`, `getCookie(event, 'youkeep_session')`, `getCookie(event, 'csrf_token')`, `getHeader(event, 'x-csrf-token')` — all standard `h3` exports, plus the two cookie name literals this task hardcodes directly (matching Task 1's `SESSION_COOKIE_NAME`/`CSRF_COOKIE_NAME` values — `'youkeep_session'` and `'csrf_token'`).
- Produces: throws a `403` `H3Error` for any mutating request that has a session cookie but a missing/mismatched CSRF header. Does nothing (returns `undefined`) for non-mutating requests or requests with no session cookie.

- [ ] **Step 1: Create the middleware file**

```typescript
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

Nitro auto-registers every file under `server/middleware/` to run on every request, in filename order, before the matched route handler — no manual wiring needed.

- [ ] **Step 2: Verify the app still builds**

Run: `npm run build`
Expected: clean build, no errors (this file has no dependents yet to exercise it end-to-end — Task 4 tests it directly, and the dev-login flow itself is unaffected since it has no session cookie yet at request time).

- [ ] **Step 3: Commit**

```bash
git add server/middleware/csrf.ts
git commit -m "feat: add CSRF-checking Nitro middleware"
```

---

## Task 3: Create the client plugin

**Files:**
- Create: `app/plugins/csrf.client.ts`

**Interfaces:**
- Consumes: `useCookie('csrf_token')` (Nuxt built-in), `$fetch.create` (Nuxt/ofetch built-in, globally auto-imported).
- Produces: overwrites `globalThis.$fetch` with an instance that adds an `x-csrf-token` header to every `POST`/`PUT`/`PATCH`/`DELETE` request, transparently to every existing `$fetch`/`useFetch` call site in the app.

- [ ] **Step 1: Create the plugin file**

```typescript
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

The `.client.ts` filename suffix is a Nuxt convention: this plugin only runs in the browser, never during SSR — correct here, since every mutating request in this app originates from a user interaction in the browser (SSR-time fetching in this app is exclusively `GET` requests for initial page data, which this plugin doesn't touch).

- [ ] **Step 2: Verify the app still builds**

Run: `npm run build`
Expected: clean build, no errors.

- [ ] **Step 3: Commit**

```bash
git add app/plugins/csrf.client.ts
git commit -m "feat: add client plugin to attach CSRF header to mutating requests"
```

---

## Task 4: Integration tests for the CSRF middleware

**Files:**
- Create: `tests/integration/csrf.test.ts`

**Interfaces:**
- Consumes: `server/middleware/csrf.ts`'s default export (the middleware handler), `mockEvent` from `tests/helpers/testDb.ts` (with its new `method` option from Task 1).
- Produces: nothing consumed by later tasks — this is the last task in the plan.

This task depends on Task 1 (the extended `mockEvent`) and Task 2 (the middleware itself), so it must run after both.

- [ ] **Step 1: Write the test file**

```typescript
import { describe, it, expect } from 'vitest';
import csrfMiddleware from '../../server/middleware/csrf';
import { mockEvent } from '../helpers/testDb';

describe('CSRF middleware', () => {
  it('rejects a mutating request with a session cookie but no x-csrf-token header', () => {
    const event = mockEvent('youkeep_session=abc123; csrf_token=secret-token', {
      method: 'POST'
    });

    expect(() => csrfMiddleware(event)).toThrow(
      expect.objectContaining({ statusCode: 403 })
    );
  });

  it('rejects a mutating request with a mismatched x-csrf-token header', () => {
    const event = mockEvent('youkeep_session=abc123; csrf_token=secret-token', {
      method: 'POST',
      headers: { 'x-csrf-token': 'wrong-token' }
    });

    expect(() => csrfMiddleware(event)).toThrow(
      expect.objectContaining({ statusCode: 403 })
    );
  });

  it('allows a mutating request with a matching x-csrf-token header', () => {
    const event = mockEvent('youkeep_session=abc123; csrf_token=secret-token', {
      method: 'POST',
      headers: { 'x-csrf-token': 'secret-token' }
    });

    expect(() => csrfMiddleware(event)).not.toThrow();
  });

  it('does not block a mutating request with no session cookie (e.g. login itself)', () => {
    const event = mockEvent(undefined, {
      method: 'POST',
      path: '/api/auth/login'
    });

    expect(() => csrfMiddleware(event)).not.toThrow();
  });

  it('does not block a non-mutating (GET) request even without a CSRF header', () => {
    const event = mockEvent('youkeep_session=abc123; csrf_token=secret-token', {
      method: 'GET'
    });

    expect(() => csrfMiddleware(event)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the new tests**

Run: `npm run test -- csrf.test.ts`
Expected: all 5 tests pass.

- [ ] **Step 3: Run the full test suite**

Run: `npm run test`
Expected: all tests pass (275 pre-existing + the new ones from this plan).

- [ ] **Step 4: Commit**

```bash
git add tests/integration/csrf.test.ts
git commit -m "test: add integration tests for the CSRF middleware"
```

---

## Self-Review Notes

**Spec coverage:** All 3 spec pieces (session-cookie change, middleware, client plugin) map to Tasks 1-3; the spec's 4 named test cases (a-d) plus a 5th (GET requests unaffected, implied by the middleware's own early-return but not explicitly enumerated in the spec — added here since it's a one-line addition that closes an obvious gap in coverage) map to Task 4.

**Placeholder scan:** No TBD/TODO; every step shows complete, exact code.

**Type consistency:** `CSRF_COOKIE_NAME` (Task 1) is `'csrf_token'`, matching the literal string used directly in Task 2's middleware and Task 3's `useCookie('csrf_token')` call — Task 2 doesn't import the constant from `auth.ts` (that file has no exports of its cookie-name constants today, and adding one would be a larger, unrequested refactor of an unrelated file's export surface) but uses the identical literal value, which is what actually matters at runtime.

**Real testing gap found during planning, not assumed:** `tests/helpers/testDb.ts`'s `mockEvent` didn't support a second `setCookie` call in the same request (missing `removeHeader`/`appendHeader` on its `res` mock) — traced directly from reading `h3`'s actual `setCookie` implementation, not inferred. Without Task 1's Step 1, the existing `dev-login.test.ts` would start throwing `TypeError` the moment `createSession()` tries to set its second cookie. This is why Task 1 fixes the test helper before touching `auth.ts` itself, in the same task and same commit — splitting them would leave an intermediate broken-test state.
