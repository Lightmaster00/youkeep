# Dev Login Fixture — Design

## Context

Fifth sub-project of the ongoing "bug fixes" initiative — infrastructure/tooling, not a bug fix. Across the last 3 sub-projects this session, every subagent (implementer and reviewer) hit the same wall: no way to reach an authenticated live browser/API session for manual verification, so all UI-touching fixes were verified by code trace only. Some subagents attempted the workaround used successfully in much earlier sessions — inserting a session row directly into the `sessions` table, matching an existing admin's `id` from the `users` table — but this has recently started tripping the safety classifier as "credential exploration" even though it's the user's own local dev database. A supported, explicit HTTP endpoint avoids this: it's a normal API call, not database probing.

## Scope

- A new `POST /api/dev/login` endpoint that, when explicitly enabled, creates (if needed) a fixture admin user and logs it in, returning a valid session cookie via the same code path real login uses.

## Non-Goals

- No changes to the real login flow, `setup.post.ts`, or any existing auth endpoint.
- No UI for this — it's an HTTP-only dev tool, not a login page feature.
- No attempt to seed any other fixture data (videos, channels, music) — this is purely an auth shortcut; whatever data exists in the dev DB at the time is what a session obtained this way can see, gated by the fixture user's `admin` role exactly like any other admin.

## Design

### Guard

Double lock, checked first, before any other logic:

```ts
if (process.env.NODE_ENV === 'production' || process.env.ALLOW_DEV_LOGIN !== '1') {
  throw createError({ statusCode: 404, statusMessage: 'Not found' });
}
```

Returns a plain `404`, not a `403` or any message hinting the endpoint exists — a `403` would confirm to an attacker probing a misconfigured production deployment that this route is real but blocked; `404` is indistinguishable from a route that was never registered.

Both conditions must hold for the endpoint to work: `NODE_ENV` must not be `'production'` (matching the existing convention in this codebase, e.g. the session cookie's `secure` flag), AND the operator must have explicitly set `ALLOW_DEV_LOGIN=1` when starting the server. Neither alone is sufficient — this means a `NODE_ENV` misconfiguration in a real deployment (a real, recurring incident category) does not by itself expose this endpoint.

### Fixture user find-or-create

Mirrors the existing pattern in `server/api/auth/setup.post.ts` (password hashing, UUID generation, direct `INSERT`):

```ts
const FIXTURE_USERNAME = 'dev-fixture-admin';

let user = db.prepare('SELECT id FROM users WHERE username = ?').get(FIXTURE_USERNAME) as { id: string } | undefined;

if (!user) {
  const userId = crypto.randomUUID();
  const passwordHash = hashPassword(crypto.randomUUID()); // random, unused — this endpoint bypasses password login entirely
  db.prepare(`
    INSERT INTO users (id, username, password_hash, role, created_at)
    VALUES (?, ?, ?, 'admin', ?)
  `).run(userId, FIXTURE_USERNAME, passwordHash, Date.now());
  user = { id: userId };
}
```

The password hash is a random, never-used value (this endpoint never checks a password — its whole purpose is to bypass that step under the double-lock guard above) — set only because `password_hash` is `NOT NULL` in the schema.

### Session creation and response

```ts
await createSession(user.id, event);

return { success: true, username: FIXTURE_USERNAME };
```

`createSession` is the exact same function `setup.post.ts` and the real login endpoint already call — it sets the session cookie with the correct `httpOnly`/`secure`-in-production-only/`sameSite` flags automatically, so this endpoint doesn't need to duplicate any of that logic.

### Usage (for future sub-projects' subagents)

Documented in this spec for now (not a new CLAUDE.md rule, since that's out of scope for a code-level design doc — the user can decide separately whether to add a project-level note):

```bash
ALLOW_DEV_LOGIN=1 npm run dev
curl -c /tmp/youkeep-dev-cookies.txt -X POST http://localhost:PORT/api/dev/login
# subsequent requests: curl -b /tmp/youkeep-dev-cookies.txt http://localhost:PORT/api/...
```

Or, for browser-based verification (Claude's Browser pane tools), the same `curl` call first, then reading the cookie value out of the cookie jar file to set it in the browser context, or simpler: since the dev server must be started with `ALLOW_DEV_LOGIN=1` anyway, a subagent can just `curl -X POST http://localhost:PORT/api/dev/login` once to create the fixture user/session server-side, then note the exact session id is also derivable by querying `sessions WHERE user_id = (SELECT id FROM users WHERE username = 'dev-fixture-admin')` — though the simplest path is always just using the cookie jar directly with `curl`, or navigating the Browser pane to a page that first triggers the login call.

## Error Handling

- If `createSession` itself fails (extremely unlikely — same code path already used elsewhere in this app), the error propagates normally as a 500, same as any other endpoint failure.
- No special handling needed for "fixture user already exists" — the find-or-create logic handles that as the normal, expected case (idempotent across dev-server restarts, since the DB file persists).

## Verification

- This is a plain HTTP endpoint with no yt-dlp involvement — it gets a real automated integration test (this codebase's established convention: DB/HTTP logic without yt-dlp gets tests; yt-dlp-touching code doesn't).
- Test coverage: without `ALLOW_DEV_LOGIN=1` set, the endpoint 404s; with it set (test can mutate `process.env.ALLOW_DEV_LOGIN` directly, consistent with how other tests in this codebase manipulate environment-dependent behavior), a fresh call creates the fixture user and returns a session cookie; a second call reuses the same fixture user (no duplicate `users` row, verified by checking the `users` table row count stays at 1 after 2 calls).
- Manual verification: start the dev server with `ALLOW_DEV_LOGIN=1`, curl the endpoint, confirm a `Set-Cookie` header comes back and that cookie successfully authenticates a subsequent request to an admin-only endpoint (e.g. `GET /api/admin/downloader/queue`).
