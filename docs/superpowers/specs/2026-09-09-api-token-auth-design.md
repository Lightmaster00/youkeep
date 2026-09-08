# API Token Authentication — Design

**Status:** Approved

## Goal

Let a user generate a long-lived API token from their account page, so a third-party or future client application (a mobile app, a TV app, a script) can authenticate against YouKeep's existing HTTP API without going through the browser-cookie session flow. This is an authentication mechanism only — it does not build a mobile client, and it does not create any new "API mode" endpoints beyond what already exists.

## Context

Every YouKeep API route currently authenticates via a single choke point: `getUserFromSession(event)` in `server/utils/auth.ts`, called directly or indirectly (through `requireUser`, `requireAdmin`, `canAccessVideo`, `canAccessMusicTrack`, `canAccessMusicArtist`, `canAccessPodcastShow`, `canAccessPodcastEpisode`) by 109 files under `server/api/`, plus the three media-streaming routes under `server/routes/` (`downloads/[...path].ts`, `downloads-music/[...path].ts`, `downloads-podcasts/[...path].ts`) that serve actual video/audio file bytes with `Range` support via `canAccessVideo`/etc. Today `getUserFromSession` only recognizes the `youkeep_session` httpOnly cookie set at login.

This design extends `getUserFromSession` itself to also recognize a Bearer token, so every one of those 109+ call sites — including the byte-range media streaming used by video/audio playback — gains token support automatically, with no changes to any of them.

**Explicitly out of scope:** a full server/client architectural split (dedicated mobile-optimized endpoints, transcoding, a distinct "API mode" separate from the web app) is a much larger, separate idea floated during discussion and deliberately deferred to its own future brainstorm if it becomes concrete. This design is the authentication layer only.

## Scope

**In scope:**
- A new `api_tokens` table and CRUD (create/list/revoke) for a logged-in user's own tokens.
- Extending `getUserFromSession` to accept `Authorization: Bearer <token>` as an alternative to the session cookie.
- A "Jetons API" section on the account page (`app/pages/account.vue`) for self-service token management.
- A token inherits exactly the permissions of the user who created it (role, private/ultra_private visibility, explicit channel access) — no separate scope/permission model.

**Out of scope:**
- Any new "mobile-friendly" or "API-mode" endpoints — a token authenticates against the exact same API surface the web UI already uses.
- Token expiration — tokens are valid until manually revoked (like a GitHub personal access token), not time-limited.
- Admin-issued tokens for other users — only self-service, a user manages only their own tokens.
- Any change to session-cookie behavior, password-change/session-revocation coupling, or the CSRF middleware itself.
- Building an actual mobile/TV client application.

## Architecture

### Auth integration

`getUserFromSession(event)` (`server/utils/auth.ts`) is extended: it checks the `youkeep_session` cookie first (existing behavior, unchanged — the web UI never sends an `Authorization` header, so its behavior is unaffected). Only if no session cookie is present does it read the `Authorization` header; if present and shaped `Bearer <token>`, it hashes the token and looks it up via a new `getUserFromApiToken(token)` helper. Both paths return the same `UserSession` shape (`{ id, username, role, mustChangePassword }`), so every existing caller — `requireUser`, `requireAdmin`, and all five `canAccessX` visibility checks — works unchanged and gains token support for free, including the byte-range media-streaming routes.

This ordering means a request can authenticate with a cookie OR a token, never both consulted ambiguously — cookie wins if both happen to be present (never expected in practice, since a browser session never carries a Bearer header).

The CSRF middleware (`server/middleware/csrf.ts`) already returns immediately when there is no `youkeep_session` cookie on the request. A token-authenticated request — by definition cookie-less — is therefore never subject to CSRF checks, correctly: CSRF protects against a browser automatically attaching an ambient cookie the attacker didn't choose to send; an explicit `Authorization` header a script/app constructs itself isn't exposed to that attack. No change to the CSRF middleware is needed.

### Token format and storage

A token is generated as `yk_` followed by 32 cryptographically random bytes, base64url-encoded (`crypto.randomBytes(32)`, no padding) — a recognizable prefix (matching conventions like `ghp_`/`sk_live_`) that makes a leaked token identifiable at a glance, plus 256 bits of entropy that makes brute-forcing infeasible.

The raw token is shown to the user exactly once, at creation. Only its SHA-256 hash is stored in the database — not bcrypt, since (unlike a human-chosen password) a random 256-bit token has no meaningful entropy to protect against dictionary/rainbow-table attacks that bcrypt's deliberate slowness defends against; a fast, standard cryptographic hash is the correct tool here and keeps every authenticated API request cheap (this runs on the hot path of every request from an external client). A stored hash can never be reversed back into a usable token, so a database leak alone does not expose working credentials.

### Data model

```sql
CREATE TABLE IF NOT EXISTS api_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  label TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

`label` is a user-chosen name ("iPhone", "Living room tablet") shown in the token list to distinguish tokens without ever showing the secret again. `last_used_at` is updated on every successful authenticated request through that token, so a user can spot a stale/unused token before deciding whether to revoke it. `token_hash` is `UNIQUE` so lookup is a single indexed query. Deleting a user cascades to their tokens, matching the existing `sessions` table's behavior.

### New utility module

`server/utils/apiTokens.ts`:
- `generateApiToken(): string` — produces a new raw `yk_...` token.
- `hashApiToken(token: string): string` — SHA-256 hex digest.
- `createApiToken(userId: string, label: string): { id: string; token: string }` — generates, hashes, inserts a row, returns the raw token (only time it's ever returned).
- `listApiTokens(userId: string): { id: string; label: string; createdAt: number; lastUsedAt: number | null }[]` — never includes the hash or raw token.
- `revokeApiToken(userId: string, tokenId: string): boolean` — deletes the row only if it belongs to `userId`; returns whether a row was deleted.
- `getUserFromApiToken(token: string): UserSession | null` — hashes the token, joins `api_tokens` to `users`, updates `last_used_at`, returns the same `UserSession` shape `getUserFromSession` uses (or `null` if no match).

### API routes

Under `server/api/account/tokens/`, following the existing convention of `server/api/account/password.put.ts`:
- `POST /api/account/tokens` — body `{ label: string }`; requires a logged-in user (`requireUser`); validates `label` is non-empty and reasonably bounded (1-100 characters); returns `{ id, label, token }` — the one and only time the raw token is returned.
- `GET /api/account/tokens` — requires a logged-in user; returns `{ tokens: [{ id, label, createdAt, lastUsedAt }] }` for the current user only.
- `DELETE /api/account/tokens/[id]` — requires a logged-in user; calls `revokeApiToken(userSession.id, id)`; returns `404` if the token doesn't exist or doesn't belong to the caller (never `403`, so an attacker probing token IDs can't distinguish "exists but not yours" from "doesn't exist").

### Account page UI

A new "Jetons API" section on `app/pages/account.vue`, placed below the existing password-change section (same page, same self-service pattern):
- A label input + "Générer" button. On success, the raw token is displayed once in a copyable, monospace field with an explicit warning that it will never be shown again, and a "J'ai copié mon jeton" dismissal to close that one-time view.
- Below that, the list of existing tokens: label, creation date, last-used date (or "Jamais utilisé"), each with a "Révoquer" button that asks for confirmation before calling `DELETE`.

## Error Handling

- A request with a missing, malformed, or revoked token behaves exactly like a request with no session at all: `getUserFromSession` returns `null`, and every existing caller's existing 401 (`requireUser`)/403 (`requireAdmin`)/visibility-denial behavior applies unchanged — no new error paths are introduced into the 109 existing call sites.
- `POST /api/account/tokens` with an empty or over-length label: `400`.
- `DELETE /api/account/tokens/[id]` for a token that doesn't exist or belongs to another user: `404` (not `403`), so probing token IDs never confirms existence.
- A malformed `Authorization` header (present but not `Bearer <token>` shaped) is treated identically to no header at all — falls through to "unauthenticated," never a distinct error.

## Testing

- Unit tests for `generateApiToken`/`hashApiToken`/the token-lookup logic in `server/utils/apiTokens.ts`: token format (`yk_` prefix, expected length), hash is deterministic and one-way (same input → same hash, hash ≠ input), `createApiToken` returns the raw token exactly once and the stored row never contains it.
- Integration tests for `getUserFromSession`'s extended behavior (`server/utils/auth.ts`): a valid Bearer token authenticates and returns the correct `UserSession`; an invalid/malformed/revoked token returns `null`; when both a valid session cookie and a valid Bearer token are present, the cookie takes precedence; a token created by an admin user carries `role: 'admin'` through to `requireAdmin`; a token created by a user with private/ultra_private content access correctly passes the corresponding `canAccessX` check; a request via `Authorization: Bearer` is never blocked by the CSRF middleware (no session cookie present, so it returns early) even for a mutating (`POST`/`PUT`/`DELETE`) method.
- Integration tests for the three new routes: token creation returns the raw token once and a subsequent `GET` list never includes it; listing only ever returns the current user's own tokens, never another user's; revocation removes the row and a subsequent request with that token is rejected; revoking another user's token ID returns `404`; revoking a nonexistent token ID also returns `404`.
- Manual end-to-end verification (per this project's established `curl` + dev-login-fixture convention, since the Browser pane can't reach a local dev server in this environment): create a token via the UI or `curl`, then issue a `curl` request to an existing JSON API route (e.g. `GET /api/videos`) and to a byte-range media-streaming route (`GET /downloads/...` with a `Range` header) using only `Authorization: Bearer <token>` — no cookie at all — confirming the token path genuinely works end-to-end through both a JSON endpoint and the file-streaming path, not just in unit tests against the auth function in isolation.
