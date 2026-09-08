# API Token Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a logged-in user generate a long-lived API token from their account page, so an external client can authenticate against YouKeep's existing HTTP API (including byte-range media streaming) via `Authorization: Bearer <token>`, without touching the browser session-cookie flow.

**Architecture:** Extend the single existing auth choke point, `getUserFromSession()` in `server/utils/auth.ts`, to also recognize a Bearer token when no session cookie is present — every one of its 109+ existing callers (route guards, visibility checks, byte-range media streaming) gains token support with zero changes to themselves. A new `api_tokens` table and `server/utils/apiTokens.ts` utility module handle token generation/hashing/lookup; three new self-service routes under `server/api/account/tokens/` and a new "Jetons API" section on the account page handle the user-facing lifecycle.

**Tech Stack:** Nuxt 4, Nitro (H3), TypeScript, better-sqlite3, Node's built-in `crypto` module, Vitest (`server` project for `tests/unit/`+`tests/integration/`).

## Global Constraints

- A token inherits exactly the permissions of the user who created it (role, private/ultra_private visibility, explicit channel access) — no separate scope/permission model.
- Tokens do not expire — valid until manually revoked.
- Self-service only — a user manages only their own tokens; no admin-issued tokens for other users.
- Token format: `yk_` prefix + 32 cryptographically random bytes, base64url-encoded (`crypto.randomBytes(32)`, no padding).
- Stored as a SHA-256 hash only (not bcrypt) — a random 256-bit token has no meaningful entropy to protect against dictionary attacks, and a fast hash keeps every authenticated API request cheap. The raw token is returned exactly once, at creation, and never again.
- `getUserFromSession` checks the session cookie first (unchanged behavior); only if no cookie is present does it check `Authorization: Bearer <token>`. Cookie takes precedence if both are somehow present. Same `UserSession` return shape in both paths.
- No change to the CSRF middleware itself — it already exempts cookie-less requests, which a Bearer-token request always is.
- New table: `api_tokens(id, user_id, label, token_hash UNIQUE, created_at, last_used_at, FOREIGN KEY user_id -> users(id) ON DELETE CASCADE)`.
- New utility module `server/utils/apiTokens.ts`: `generateApiToken()`, `hashApiToken(token)`, `createApiToken(userId, label)`, `listApiTokens(userId)`, `revokeApiToken(userId, tokenId)`, `getUserFromApiToken(token)` — exact signatures below.
- New routes: `POST /api/account/tokens` `{label}` → `{id, label, token}` (400 on empty/>100-char label); `GET /api/account/tokens` → `{tokens: [{id, label, createdAt, lastUsedAt}]}` (current user's own only, never the hash/token); `DELETE /api/account/tokens/[id]` → 404 if not found or not owned by caller (never 403).
- Account page: new "Jetons API" section below the password-change section, following that section's existing Vue/CSS conventions — label input + "Générer" button, one-time copyable token reveal with explicit "never shown again" warning + dismissal, list of existing tokens (label/created/last-used) each with a confirm-then-revoke "Révoquer" button.
- Error handling: invalid/malformed/revoked/missing token → indistinguishable from unauthenticated (`getUserFromSession` returns `null`, same downstream 401/403/visibility-denial as today). A malformed `Authorization` header (present but not `Bearer <token>` shaped) is treated as no header at all, never a distinct error.

---

## Task 1: `api_tokens` table + `server/utils/apiTokens.ts`

**Files:**
- Modify: `server/utils/db.ts:35-40` (add `api_tokens` table right after the existing `sessions` table)
- Modify: `tests/helpers/testDb.ts` (add the `api_tokens` table to `createTestDb()`'s schema, and a new `insertApiToken` helper)
- Create: `server/utils/apiTokens.ts`
- Test: `tests/unit/apiTokens.test.ts` (pure functions, no DB)
- Test: `tests/integration/apiTokens.test.ts` (DB-touching functions, following the same `(globalThis as any).getDb = () => db` pattern already used for `server/utils/auth.ts` in `tests/integration/access-control.test.ts`)

**Interfaces:**
- Produces: `generateApiToken(): string`, `hashApiToken(token: string): string`, `createApiToken(userId: string, label: string): { id: string; token: string }`, `listApiTokens(userId: string): { id: string; label: string; createdAt: number; lastUsedAt: number | null }[]`, `revokeApiToken(userId: string, tokenId: string): boolean`, `getUserFromApiToken(token: string): { id: string; username: string; role: 'admin' | 'user'; mustChangePassword: boolean } | null` — all consumed by Task 2 (`getUserFromApiToken`) and Task 3 (all others).

- [ ] **Step 1: Add the `api_tokens` table to the real schema**

In `server/utils/db.ts`, find the existing `sessions` table (currently lines 35-40):

```typescript
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
```

Add immediately after it (before the `channels` table):

```typescript

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

- [ ] **Step 2: Add the same table to the test schema, plus an `insertApiToken` helper**

In `tests/helpers/testDb.ts`, find `createTestDb()`'s `sessions` table creation (mirrors the real schema) and add the `api_tokens` table right after it, inside the same `db.exec(...)` template string:

```sql
    CREATE TABLE api_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      label TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL,
      last_used_at INTEGER,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
```

Then add a new exported helper, following the exact style of the existing `insertSession` (which sits right after `insertUser` in this file):

```typescript
export function insertApiToken(db: Database.Database, opts: { id: string; userId: string; label?: string; tokenHash: string; createdAt?: number; lastUsedAt?: number | null }) {
  db.prepare(`
    INSERT INTO api_tokens (id, user_id, label, token_hash, created_at, last_used_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(opts.id, opts.userId, opts.label ?? `Token ${opts.id}`, opts.tokenHash, opts.createdAt ?? Date.now(), opts.lastUsedAt ?? null);
}
```

- [ ] **Step 3: Write the failing unit tests for the pure functions**

Create `tests/unit/apiTokens.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { generateApiToken, hashApiToken } from '../../server/utils/apiTokens';

describe('generateApiToken', () => {
  it('starts with the yk_ prefix', () => {
    expect(generateApiToken()).toMatch(/^yk_/);
  });

  it('produces a base64url-encoded 32-byte payload after the prefix (43 characters, no padding, URL-safe alphabet)', () => {
    const token = generateApiToken();
    const payload = token.slice(3);
    expect(payload).toHaveLength(43);
    expect(payload).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(payload).not.toContain('=');
  });

  it('produces a different token on every call', () => {
    const a = generateApiToken();
    const b = generateApiToken();
    expect(a).not.toBe(b);
  });
});

describe('hashApiToken', () => {
  it('produces a 64-character lowercase hex SHA-256 digest', () => {
    const hash = hashApiToken('yk_sometoken');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic: the same input always produces the same hash', () => {
    expect(hashApiToken('yk_sometoken')).toBe(hashApiToken('yk_sometoken'));
  });

  it('produces different hashes for different inputs', () => {
    expect(hashApiToken('yk_tokenA')).not.toBe(hashApiToken('yk_tokenB'));
  });

  it('never returns the input itself (one-way, trivially)', () => {
    const input = 'yk_sometoken';
    expect(hashApiToken(input)).not.toBe(input);
    expect(hashApiToken(input)).not.toContain(input);
  });
});
```

- [ ] **Step 4: Run the unit tests to verify they fail**

Run: `npx vitest run tests/unit/apiTokens.test.ts`
Expected: FAIL — `Cannot find module '../../server/utils/apiTokens'`

- [ ] **Step 5: Write the failing integration tests for the DB-touching functions**

Create `tests/integration/apiTokens.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { createApiToken, listApiTokens, revokeApiToken, getUserFromApiToken, hashApiToken } from '../../server/utils/apiTokens';
import { createTestDb, insertUser, insertApiToken } from '../helpers/testDb';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
});

describe('createApiToken', () => {
  it('returns a raw token and an id, and stores only the hash', () => {
    insertUser(db, { id: 'u1', role: 'user' });
    const result = createApiToken('u1', 'My Phone');

    expect(result.id).toBeTruthy();
    expect(result.token).toMatch(/^yk_/);

    const row = db.prepare('SELECT token_hash, label, user_id FROM api_tokens WHERE id = ?').get(result.id) as any;
    expect(row.token_hash).toBe(hashApiToken(result.token));
    expect(row.token_hash).not.toBe(result.token);
    expect(row.label).toBe('My Phone');
    expect(row.user_id).toBe('u1');
  });
});

describe('listApiTokens', () => {
  it('returns only the given user\'s tokens, never the hash', () => {
    insertUser(db, { id: 'u1', role: 'user' });
    insertUser(db, { id: 'u2', role: 'user' });
    insertApiToken(db, { id: 't1', userId: 'u1', label: 'Phone', tokenHash: 'hash1' });
    insertApiToken(db, { id: 't2', userId: 'u2', label: 'Tablet', tokenHash: 'hash2' });

    const result = listApiTokens('u1');
    expect(result).toEqual([
      { id: 't1', label: 'Phone', createdAt: expect.any(Number), lastUsedAt: null }
    ]);
    expect(JSON.stringify(result)).not.toContain('hash1');
  });

  it('returns an empty array for a user with no tokens', () => {
    insertUser(db, { id: 'u1', role: 'user' });
    expect(listApiTokens('u1')).toEqual([]);
  });
});

describe('revokeApiToken', () => {
  it('deletes the token and returns true when the caller owns it', () => {
    insertUser(db, { id: 'u1', role: 'user' });
    insertApiToken(db, { id: 't1', userId: 'u1', tokenHash: 'hash1' });

    expect(revokeApiToken('u1', 't1')).toBe(true);
    expect(db.prepare('SELECT 1 FROM api_tokens WHERE id = ?').get('t1')).toBeUndefined();
  });

  it('returns false and does not delete when the token belongs to another user', () => {
    insertUser(db, { id: 'u1', role: 'user' });
    insertUser(db, { id: 'u2', role: 'user' });
    insertApiToken(db, { id: 't1', userId: 'u2', tokenHash: 'hash1' });

    expect(revokeApiToken('u1', 't1')).toBe(false);
    expect(db.prepare('SELECT 1 FROM api_tokens WHERE id = ?').get('t1')).toBeTruthy();
  });

  it('returns false for a nonexistent token id', () => {
    insertUser(db, { id: 'u1', role: 'user' });
    expect(revokeApiToken('u1', 'does-not-exist')).toBe(false);
  });
});

describe('getUserFromApiToken', () => {
  it('returns the owning user for a valid token', () => {
    insertUser(db, { id: 'u1', role: 'admin' });
    const created = createApiToken('u1', 'My Phone');

    const result = getUserFromApiToken(created.token);
    expect(result).toEqual({ id: 'u1', username: 'user_u1', role: 'admin', mustChangePassword: false });
  });

  it('returns null for a token that does not exist', () => {
    expect(getUserFromApiToken('yk_does-not-exist')).toBeNull();
  });

  it('returns null for a revoked token', () => {
    insertUser(db, { id: 'u1', role: 'user' });
    const created = createApiToken('u1', 'My Phone');
    revokeApiToken('u1', created.id);

    expect(getUserFromApiToken(created.token)).toBeNull();
  });

  it('updates last_used_at on a successful lookup', () => {
    insertUser(db, { id: 'u1', role: 'user' });
    const created = createApiToken('u1', 'My Phone');

    getUserFromApiToken(created.token);

    const row = db.prepare('SELECT last_used_at FROM api_tokens WHERE id = ?').get(created.id) as any;
    expect(row.last_used_at).not.toBeNull();
  });
});
```

- [ ] **Step 6: Run the integration tests to verify they fail**

Run: `npx vitest run tests/integration/apiTokens.test.ts`
Expected: FAIL — `Cannot find module '../../server/utils/apiTokens'`

- [ ] **Step 7: Implement `server/utils/apiTokens.ts`**

```typescript
import crypto from 'crypto';
import type { UserSession } from './auth';

const TOKEN_PREFIX = 'yk_';

export function generateApiToken(): string {
  return TOKEN_PREFIX + crypto.randomBytes(32).toString('base64url');
}

export function hashApiToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function createApiToken(userId: string, label: string): { id: string; token: string } {
  const db = getDb();
  const id = crypto.randomUUID();
  const token = generateApiToken();
  const tokenHash = hashApiToken(token);

  db.prepare(`
    INSERT INTO api_tokens (id, user_id, label, token_hash, created_at, last_used_at)
    VALUES (?, ?, ?, ?, ?, NULL)
  `).run(id, userId, label, tokenHash, Date.now());

  return { id, token };
}

export function listApiTokens(userId: string): { id: string; label: string; createdAt: number; lastUsedAt: number | null }[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, label, created_at, last_used_at
    FROM api_tokens
    WHERE user_id = ?
    ORDER BY created_at DESC
  `).all(userId) as { id: string; label: string; created_at: number; last_used_at: number | null }[];

  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at
  }));
}

export function revokeApiToken(userId: string, tokenId: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM api_tokens WHERE id = ? AND user_id = ?').run(tokenId, userId);
  return result.changes > 0;
}

export function getUserFromApiToken(token: string): UserSession | null {
  const db = getDb();
  const tokenHash = hashApiToken(token);

  const row = db.prepare(`
    SELECT u.id, u.username, u.role, u.must_change_password, a.id as token_id
    FROM api_tokens a
    JOIN users u ON a.user_id = u.id
    WHERE a.token_hash = ?
  `).get(tokenHash) as { id: string; username: string; role: 'admin' | 'user'; must_change_password: number; token_id: string } | undefined;

  if (!row) return null;

  db.prepare('UPDATE api_tokens SET last_used_at = ? WHERE id = ?').run(Date.now(), row.token_id);

  return {
    id: row.id,
    username: row.username,
    role: row.role,
    mustChangePassword: row.must_change_password === 1
  };
}
```

Note: `getDb()` is Nitro's ambient auto-import (used the same way throughout `server/utils/*.ts` with no explicit import statement) — do not add an import for it.

- [ ] **Step 8: Run both test files to verify they pass**

Run: `npx vitest run tests/unit/apiTokens.test.ts tests/integration/apiTokens.test.ts`
Expected: PASS (7 unit tests + 10 integration tests = 17 total)

- [ ] **Step 9: Commit**

```bash
git add server/utils/db.ts server/utils/apiTokens.ts tests/helpers/testDb.ts tests/unit/apiTokens.test.ts tests/integration/apiTokens.test.ts
git commit -m "feat: add api_tokens table and apiTokens utility module"
```

---

## Task 2: Extend `getUserFromSession` to accept Bearer tokens

**Files:**
- Modify: `server/utils/auth.ts:1,78-108` (add the `getHeader` import; extend `getUserFromSession`)
- Test: `tests/integration/apiTokenAuth.test.ts` (new)

**Interfaces:**
- Consumes: `getUserFromApiToken(token: string): UserSession | null` (Task 1).
- Produces: no new exported function — `getUserFromSession` itself is extended, so every one of its 109+ existing callers (`requireUser`, `requireAdmin`, `canAccessVideo`, `canAccessMusicTrack`, `canAccessMusicArtist`, `canAccessPodcastShow`, `canAccessPodcastEpisode`, and every route calling `getUserFromSession` directly) gains Bearer-token support automatically, with no changes to themselves.

- [ ] **Step 1: Write the failing integration tests**

Create `tests/integration/apiTokenAuth.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { getUserFromSession, requireAdmin, canAccessMusicTrack } from '../../server/utils/auth';
import { createApiToken } from '../../server/utils/apiTokens';
import csrfMiddleware from '../../server/middleware/csrf';
import {
  createTestDb,
  insertUser,
  insertSession,
  insertMusicArtist,
  insertMusicTrack,
  mockEvent,
  sessionCookie
} from '../helpers/testDb';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
});

function bearerEvent(token: string, opts?: { method?: string }) {
  return mockEvent(undefined, { method: opts?.method ?? 'GET', headers: { authorization: `Bearer ${token}` } });
}

describe('getUserFromSession with a Bearer token', () => {
  it('authenticates via a valid Bearer token when there is no session cookie', async () => {
    insertUser(db, { id: 'u1', role: 'user' });
    const created = createApiToken('u1', 'My Phone');

    const result = await getUserFromSession(bearerEvent(created.token));
    expect(result).toEqual({ id: 'u1', username: 'user_u1', role: 'user', mustChangePassword: false });
  });

  it('returns null for an invalid token', async () => {
    const result = await getUserFromSession(bearerEvent('yk_not-a-real-token'));
    expect(result).toBeNull();
  });

  it('returns null for a revoked token', async () => {
    insertUser(db, { id: 'u1', role: 'user' });
    const created = createApiToken('u1', 'My Phone');
    db.prepare('DELETE FROM api_tokens WHERE id = ?').run(created.id);

    const result = await getUserFromSession(bearerEvent(created.token));
    expect(result).toBeNull();
  });

  it('returns null for a malformed Authorization header (not "Bearer <token>" shaped), same as no header at all', async () => {
    const event = mockEvent(undefined, { headers: { authorization: 'not-a-bearer-header' } });
    const result = await getUserFromSession(event);
    expect(result).toBeNull();
  });

  it('prefers the session cookie over a Bearer token when both are present', async () => {
    insertUser(db, { id: 'cookie-user', role: 'user' });
    insertSession(db, { id: 'sess1', userId: 'cookie-user' });
    insertUser(db, { id: 'token-user', role: 'user' });
    const created = createApiToken('token-user', 'My Phone');

    const event = mockEvent(sessionCookie('sess1'), { headers: { authorization: `Bearer ${created.token}` } });
    const result = await getUserFromSession(event);
    expect(result?.id).toBe('cookie-user');
  });

  it('carries the admin role through to requireAdmin', async () => {
    insertUser(db, { id: 'admin1', role: 'admin' });
    const created = createApiToken('admin1', 'Admin Token');

    const result = await requireAdmin(bearerEvent(created.token));
    expect(result.role).toBe('admin');
  });

  it('rejects a non-admin token from requireAdmin', async () => {
    insertUser(db, { id: 'u1', role: 'user' });
    const created = createApiToken('u1', 'User Token');

    await expect(requireAdmin(bearerEvent(created.token))).rejects.toMatchObject({ statusCode: 403 });
  });

  it('carries private-content visibility through to canAccessMusicTrack, matching the owning user\'s access', async () => {
    insertUser(db, { id: 'u1', role: 'user' });
    const created = createApiToken('u1', 'My Phone');
    insertMusicArtist(db, { id: 'a1', visibility: 'private' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });

    const hasAccess = await canAccessMusicTrack('t1', bearerEvent(created.token));
    expect(hasAccess).toBe(true);
  });

  it('a Bearer-authenticated mutating request is never blocked by the CSRF middleware, since it carries no session cookie', async () => {
    insertUser(db, { id: 'u1', role: 'user' });
    const created = createApiToken('u1', 'My Phone');

    const event = bearerEvent(created.token, { method: 'POST' });

    expect(() => csrfMiddleware(event)).not.toThrow();
    const result = await getUserFromSession(event);
    expect(result?.id).toBe('u1');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/integration/apiTokenAuth.test.ts`
Expected: FAIL — the first several tests fail because `getUserFromSession` does not yet check any `Authorization` header, so it returns `null` for a Bearer-only request that should authenticate; the "malformed header" and "cookie precedence" and "CSRF" tests may incidentally pass already (a null/cookie-preferring result is already the current behavior in those specific cases) — that's fine, the goal of this step is just confirming the currently-unimplemented behaviors genuinely fail before you implement them.

- [ ] **Step 3: Extend `getUserFromSession`**

In `server/utils/auth.ts`, change the import on line 1 from:

```typescript
import { H3Event, getCookie, setCookie, deleteCookie, createError } from 'h3';
```

to:

```typescript
import { H3Event, getCookie, getHeader, setCookie, deleteCookie, createError } from 'h3';
```

Then replace the existing `getUserFromSession` function (currently lines 78-108):

```typescript
export async function getUserFromSession(event: H3Event): Promise<UserSession | null> {
  const sessionId = getCookie(event, SESSION_COOKIE_NAME);
  if (!sessionId) return null;

  const db = getDb();
  const session = db.prepare(`
    SELECT s.expires_at, u.id, u.username, u.role, u.must_change_password
    FROM sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.id = ?
  `).get(sessionId) as { expires_at: number; id: string; username: string; role: 'admin' | 'user'; must_change_password: number } | undefined;

  if (!session) {
    deleteCookie(event, SESSION_COOKIE_NAME, { path: '/' });
    return null;
  }

  // Check expiration
  if (Date.now() > session.expires_at) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
    deleteCookie(event, SESSION_COOKIE_NAME, { path: '/' });
    return null;
  }

  return {
    id: session.id,
    username: session.username,
    role: session.role,
    mustChangePassword: session.must_change_password === 1
  };
}
```

with:

```typescript
export async function getUserFromSession(event: H3Event): Promise<UserSession | null> {
  const sessionId = getCookie(event, SESSION_COOKIE_NAME);

  if (!sessionId) {
    // No session cookie — fall back to an API token, if one was supplied.
    const authHeader = getHeader(event, 'authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) return null;

    const token = authHeader.slice('Bearer '.length).trim();
    if (!token) return null;

    return getUserFromApiToken(token);
  }

  const db = getDb();
  const session = db.prepare(`
    SELECT s.expires_at, u.id, u.username, u.role, u.must_change_password
    FROM sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.id = ?
  `).get(sessionId) as { expires_at: number; id: string; username: string; role: 'admin' | 'user'; must_change_password: number } | undefined;

  if (!session) {
    deleteCookie(event, SESSION_COOKIE_NAME, { path: '/' });
    return null;
  }

  // Check expiration
  if (Date.now() > session.expires_at) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
    deleteCookie(event, SESSION_COOKIE_NAME, { path: '/' });
    return null;
  }

  return {
    id: session.id,
    username: session.username,
    role: session.role,
    mustChangePassword: session.must_change_password === 1
  };
}
```

Add the import for `getUserFromApiToken` at the top of the file, alongside the other imports (after line 3, `import bcrypt from 'bcryptjs';`):

```typescript
import { getUserFromApiToken } from './apiTokens';
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/integration/apiTokenAuth.test.ts`
Expected: PASS (9 tests)

Also run the full existing auth-related suites to confirm no regression to cookie-based behavior:

Run: `npx vitest run tests/integration/access-control.test.ts tests/integration/csrf.test.ts tests/integration/dev-login.test.ts`
Expected: PASS, no regressions

- [ ] **Step 5: Commit**

```bash
git add server/utils/auth.ts tests/integration/apiTokenAuth.test.ts
git commit -m "feat: accept Authorization Bearer tokens in getUserFromSession"
```

---

## Task 3: Self-service token management routes

**Files:**
- Create: `server/api/account/tokens/index.get.ts`
- Create: `server/api/account/tokens/index.post.ts`
- Create: `server/api/account/tokens/[id].delete.ts`
- Test: `tests/integration/account-tokens.test.ts`

**Interfaces:**
- Consumes: `requireUser(event): Promise<UserSession>` (existing, `server/utils/auth.ts`), `createApiToken(userId, label)`, `listApiTokens(userId)`, `revokeApiToken(userId, tokenId)` (Task 1, `server/utils/apiTokens.ts`).
- Produces: `POST /api/account/tokens`, `GET /api/account/tokens`, `DELETE /api/account/tokens/[id]` — consumed by Task 4 (the account page UI).

- [ ] **Step 1: Write the failing integration tests**

Create `tests/integration/account-tokens.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import getHandler from '../../server/api/account/tokens/index.get';
import postHandler from '../../server/api/account/tokens/index.post';
import deleteHandler from '../../server/api/account/tokens/[id].delete';
import { createApiToken } from '../../server/utils/apiTokens';
import {
  createTestDb,
  insertUser,
  insertSession,
  mockEvent,
  sessionCookie
} from '../helpers/testDb';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
});

// Inserts the user + a session for them and returns a mockEvent. Call this
// at most once per userId within a single test — a second call would
// violate the users table's PRIMARY KEY/UNIQUE constraints. Where a test
// needs a second request as the same already-logged-in user (e.g. delete
// then re-list), reuse the same returned event object across both handler
// calls instead of calling this again.
function loginAs(userId: string, opts?: { path?: string; params?: Record<string, string>; body?: any }) {
  insertUser(db, { id: userId, role: 'user' });
  const sessionId = `sess-${userId}`;
  insertSession(db, { id: sessionId, userId });
  return mockEvent(sessionCookie(sessionId), {
    path: opts?.path ?? '/api/account/tokens',
    params: opts?.params,
    body: opts?.body
  });
}

describe('POST /api/account/tokens', () => {
  it('creates a token and returns it exactly once', async () => {
    const event = loginAs('u1', { body: { label: 'My Phone' } });

    const result: any = await postHandler(event);
    expect(result.label).toBe('My Phone');
    expect(result.token).toMatch(/^yk_/);
    expect(result.id).toBeTruthy();
  });

  it('rejects an empty label with 400', async () => {
    const event = loginAs('u1', { body: { label: '' } });
    await expect(postHandler(event)).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects a label over 100 characters with 400', async () => {
    const event = loginAs('u1', { body: { label: 'x'.repeat(101) } });
    await expect(postHandler(event)).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects an unauthenticated request with 401', async () => {
    const event = mockEvent(undefined, { path: '/api/account/tokens', body: { label: 'My Phone' } });
    await expect(postHandler(event)).rejects.toMatchObject({ statusCode: 401 });
  });
});

describe('GET /api/account/tokens', () => {
  it('lists only the current user\'s tokens, never the raw token or hash', async () => {
    const event = loginAs('u1');
    insertUser(db, { id: 'u2', role: 'user' });
    createApiToken('u1', 'Phone');
    createApiToken('u2', 'Tablet');

    const result: any = await getHandler(event);
    expect(result.tokens).toHaveLength(1);
    expect(result.tokens[0].label).toBe('Phone');
    expect(JSON.stringify(result)).not.toMatch(/yk_/);
  });

  it('returns an empty list for a user with no tokens', async () => {
    const event = loginAs('u1');
    const result: any = await getHandler(event);
    expect(result.tokens).toEqual([]);
  });
});

describe('DELETE /api/account/tokens/[id]', () => {
  it('revokes a token owned by the caller', async () => {
    const event = loginAs('u1');
    const created = createApiToken('u1', 'Phone');
    event.context.params = { id: created.id };

    const result: any = await deleteHandler(event);
    expect(result.success).toBe(true);

    // Reuse the same event for the follow-up list check — getHandler reads
    // only the session cookie and ignores context.params, so this is a
    // second, independent call as the same already-authenticated user
    // without a second loginAs('u1') (which would double-insert the user).
    const listResult: any = await getHandler(event);
    expect(listResult.tokens).toEqual([]);
  });

  it('returns 404 for a token owned by another user', async () => {
    const event = loginAs('u1');
    insertUser(db, { id: 'other-user', role: 'user' });
    const created = createApiToken('other-user', 'Their Phone');
    event.context.params = { id: created.id };

    await expect(deleteHandler(event)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('returns 404 for a nonexistent token id', async () => {
    const event = loginAs('u1');
    event.context.params = { id: 'does-not-exist' };

    await expect(deleteHandler(event)).rejects.toMatchObject({ statusCode: 404 });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/integration/account-tokens.test.ts`
Expected: FAIL — `Cannot find module '../../server/api/account/tokens/index.get'` (and the other two route files)

- [ ] **Step 3: Implement the three routes**

Create `server/api/account/tokens/index.get.ts`:

```typescript
import { defineEventHandler } from 'h3';
import { requireUser } from '../../../utils/auth';
import { listApiTokens } from '../../../utils/apiTokens';

export default defineEventHandler(async (event) => {
  const userSession = await requireUser(event);
  const tokens = listApiTokens(userSession.id);
  return { tokens };
});
```

Create `server/api/account/tokens/index.post.ts`:

```typescript
import { defineEventHandler, readBody, createError } from 'h3';
import { requireUser } from '../../../utils/auth';
import { createApiToken } from '../../../utils/apiTokens';

export default defineEventHandler(async (event) => {
  const userSession = await requireUser(event);
  const body = await readBody(event);
  const label = typeof body?.label === 'string' ? body.label.trim() : '';

  if (!label || label.length > 100) {
    throw createError({ statusCode: 400, statusMessage: 'Label must be between 1 and 100 characters.' });
  }

  const result = createApiToken(userSession.id, label);
  return { id: result.id, label, token: result.token };
});
```

Create `server/api/account/tokens/[id].delete.ts`:

```typescript
import { defineEventHandler, createError } from 'h3';
import { requireUser } from '../../../utils/auth';
import { revokeApiToken } from '../../../utils/apiTokens';

export default defineEventHandler(async (event) => {
  const userSession = await requireUser(event);
  const tokenId = event.context.params?.id;

  if (!tokenId) {
    throw createError({ statusCode: 404, statusMessage: 'Token not found.' });
  }

  const revoked = revokeApiToken(userSession.id, tokenId);
  if (!revoked) {
    throw createError({ statusCode: 404, statusMessage: 'Token not found.' });
  }

  return { success: true };
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/integration/account-tokens.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add server/api/account/tokens/index.get.ts server/api/account/tokens/index.post.ts server/api/account/tokens/[id].delete.ts tests/integration/account-tokens.test.ts
git commit -m "feat: add self-service API token management routes"
```

---

## Task 4: "Jetons API" section on the account page

**Files:**
- Modify: `app/pages/account.vue`

**Interfaces:**
- Consumes: `GET /api/account/tokens`, `POST /api/account/tokens`, `DELETE /api/account/tokens/[id]` (Task 3).

This task has no dedicated automated test — per this codebase's established convention, this Vue-template UI wiring is verified manually in Task 5. Correctness here comes from precise code, verified by a successful `npx nuxt build` and `npx vitest run` (no regressions), same as this codebase's established pattern for UI-only tasks with no direct test file (see `docs/superpowers/plans/2026-09-08-search-ux-enhancements.md`'s Task 5 for precedent).

- [ ] **Step 1: Add the "Jetons API" section to the template**

In `app/pages/account.vue`, the right column (`.account-col`, currently containing exactly one `.profile-box.security-box` for password change, lines 77-123) gets a second `.profile-box` sibling added right after the closing `</div>` of the existing `security-box` div (currently line 123) and before the closing `</div>` of `.account-col` (currently line 124):

```html
        <div class="profile-box glass-panel api-tokens-box">
          <div class="security-header">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="security-icon"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"></path></svg>
            <div>
              <h4>Jetons API</h4>
              <p class="section-desc mb-0">Générez un jeton pour connecter une application externe (client mobile, script) à votre compte.</p>
            </div>
          </div>

          <hr class="separator" />

          <div v-if="newToken" class="form-msg success-msg mt-3 mb-4 alert-box new-token-reveal">
            <strong>⚠️ Ce jeton ne sera plus jamais affiché.</strong> Copiez-le maintenant :
            <div class="new-token-value">
              <code>{{ newToken }}</code>
              <UiButton variant="secondary" @click="copyNewToken">Copier</UiButton>
            </div>
            <UiButton variant="primary" class="mt-3" @click="dismissNewToken">J'ai copié mon jeton</UiButton>
          </div>

          <form v-else @submit.prevent="handleCreateToken" class="mt-4">
            <div class="form-group">
              <label class="form-label" for="token_label">Nom du jeton</label>
              <input
                type="text"
                id="token_label"
                v-model="newTokenLabel"
                class="form-input"
                placeholder="ex : iPhone, Tablette salon"
                maxlength="100"
                required
              />
            </div>

            <div v-if="tokenMessage" class="form-msg mt-3" :class="tokenSuccess ? 'success-msg' : 'error-msg'">
              {{ tokenMessage }}
            </div>

            <div class="form-actions mt-4">
              <UiButton variant="primary" type="submit" :loading="creatingToken">
                Générer
              </UiButton>
            </div>
          </form>

          <div v-if="apiTokens.length > 0" class="api-tokens-list mt-4">
            <div v-for="token in apiTokens" :key="token.id" class="api-token-row">
              <div class="api-token-info">
                <span class="api-token-label">{{ token.label }}</span>
                <span class="api-token-meta">
                  Créé le {{ formatTokenDate(token.createdAt) }} ·
                  {{ token.lastUsedAt ? `Utilisé le ${formatTokenDate(token.lastUsedAt)}` : 'Jamais utilisé' }}
                </span>
              </div>
              <UiButton variant="danger" :loading="revokingTokenId === token.id" @click="handleRevokeToken(token.id)">
                Révoquer
              </UiButton>
            </div>
          </div>
        </div>
```

- [ ] **Step 2: Add the script logic**

In `app/pages/account.vue`'s `<script setup>` block, after the existing `handleChangeOwnPassword` function (currently ending at line 228, right before the closing `</script>` tag), add:

```typescript
// --- API Tokens Logic ---
interface ApiToken {
  id: string;
  label: string;
  createdAt: number;
  lastUsedAt: number | null;
}

const apiTokens = ref<ApiToken[]>([]);
const newTokenLabel = ref('');
const newToken = ref('');
const creatingToken = ref(false);
const tokenMessage = ref('');
const tokenSuccess = ref(true);
const revokingTokenId = ref('');

const fetchApiTokens = async () => {
  try {
    const data = await $fetch<{ tokens: ApiToken[] }>('/api/account/tokens');
    apiTokens.value = data.tokens;
  } catch (err: any) {
    console.error('Failed to load API tokens', err);
  }
};

const handleCreateToken = async () => {
  creatingToken.value = true;
  tokenMessage.value = '';
  tokenSuccess.value = true;
  try {
    const result = await $fetch<{ id: string; label: string; token: string }>('/api/account/tokens', {
      method: 'POST',
      body: { label: newTokenLabel.value }
    });
    newToken.value = result.token;
    newTokenLabel.value = '';
    await fetchApiTokens();
  } catch (err: any) {
    tokenSuccess.value = false;
    tokenMessage.value = err.data?.statusMessage || 'La création du jeton a échoué.';
  } finally {
    creatingToken.value = false;
  }
};

const copyNewToken = () => {
  if (newToken.value) {
    navigator.clipboard.writeText(newToken.value);
  }
};

const dismissNewToken = () => {
  newToken.value = '';
};

const handleRevokeToken = async (tokenId: string) => {
  if (!confirm('Révoquer ce jeton ? Toute application qui l\'utilise perdra immédiatement l\'accès.')) {
    return;
  }
  revokingTokenId.value = tokenId;
  try {
    await $fetch(`/api/account/tokens/${tokenId}`, { method: 'DELETE' });
    await fetchApiTokens();
  } catch (err: any) {
    console.error('Failed to revoke API token', err);
  } finally {
    revokingTokenId.value = '';
  }
};

const formatTokenDate = (timestamp: number): string => {
  return new Date(timestamp).toLocaleDateString('fr-FR', { year: 'numeric', month: 'short', day: 'numeric' });
};

onMounted(() => {
  fetchApiTokens();
});
```

Note: this file already has one `onMounted(() => { fetchProfile(); });` call (currently lines 160-162). Do not replace it — add this as a **second**, separate `onMounted(...)` call. Vue supports multiple `onMounted` registrations in the same `<script setup>`; both run.

- [ ] **Step 3: Add the CSS**

At the end of the `<style scoped>` block (after the existing `.form-row .form-group { margin-bottom: 0; }` rule, currently just before the closing `</style>` tag), add:

```css
.api-tokens-box {
  margin-top: 0;
}

.new-token-reveal {
  display: block;
}

.new-token-value {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
  padding: 10px 14px;
  background: rgba(0, 0, 0, 0.25);
  border-radius: 8px;
  font-family: monospace;
  word-break: break-all;
}

.new-token-value code {
  flex: 1;
}

.api-tokens-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.api-token-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 16px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 10px;
}

.api-token-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.api-token-label {
  font-weight: 600;
}

.api-token-meta {
  font-size: 12.5px;
  color: var(--text-secondary);
}
```

- [ ] **Step 4: Verify the `UiButton` component supports a `danger` variant**

Before relying on `variant="danger"` in Step 1's template, check `app/components/UiButton.vue`'s `variant` prop type (search for `variant` in that file). If `'danger'` is not one of its accepted values, use whatever this codebase's existing convention is for a destructive-action button instead (search other admin/settings pages for how a delete/revoke button is styled, e.g. grep for `variant="` across `app/pages/settings.vue` or similar admin panels) and substitute that exact variant name in the template from Step 1.

- [ ] **Step 5: Verify with a build and the full test suite**

Run: `npx vitest run`
Expected: All existing tests still PASS (this task adds no new test files)

Run: `npx nuxt build`
Expected: Clean build, no TypeScript errors

- [ ] **Step 6: Commit**

```bash
git add app/pages/account.vue
git commit -m "feat: add API token management UI to the account page"
```

---

## Task 5: Manual end-to-end verification

**Files:** None (no code changes — verification only).

Per this codebase's established convention (documented in project memory), the Browser pane cannot reach a locally-started dev server in this environment. Use the `ALLOW_DEV_LOGIN=1 npm run dev` + `POST /api/dev/login` + `curl` workaround.

- [ ] **Step 1: Start the dev server and authenticate**

```bash
ALLOW_DEV_LOGIN=1 npm run dev &
sleep 3
curl -s -c /tmp/youkeep-cookies.txt -X POST http://localhost:3000/api/dev/login -H "Content-Type: application/json" -d '{}'
```

Expected: a session cookie is written to `/tmp/youkeep-cookies.txt` and the response confirms a user session.

- [ ] **Step 2: Create a token via the cookie-authenticated API, using the session from Step 1**

```bash
curl -s -b /tmp/youkeep-cookies.txt -H "x-csrf-token: $(grep csrf_token /tmp/youkeep-cookies.txt | awk '{print $NF}')" \
  -X POST http://localhost:3000/api/account/tokens \
  -H "Content-Type: application/json" \
  -d '{"label":"E2E Verification Token"}'
```

Expected: a JSON response containing `id`, `label`, and `token` (starting with `yk_`). Save the `token` value for the next steps — refer to it as `$TOKEN` below.

- [ ] **Step 3: Verify a JSON API route accepts the token with no cookie at all**

```bash
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/videos
```

Expected: a normal `{ videos: [...] }` response (or an empty array if the dev DB has no videos) — NOT a 401. Confirm this by also running the same request with an intentionally wrong token and observing a 401:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer yk_wrong-token" http://localhost:3000/api/videos
```

Expected: `401`.

- [ ] **Step 4: Verify a mutating request via Bearer token succeeds with no CSRF header**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"label":"Second Token"}' \
  http://localhost:3000/api/account/tokens
```

Expected: `200` — confirming the CSRF middleware genuinely does not block a Bearer-authenticated mutating request, even with zero CSRF header, because it never sees a session cookie on this request.

- [ ] **Step 5: Verify the byte-range media-streaming path accepts the token**

If the dev DB has no completed video with a `local_video_path`, seed one directly via SQL before this step (matching the established seeding convention from prior sub-projects' manual verification tasks), then:

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Range: bytes=0-1023" \
  "http://localhost:3000/downloads/<channelId>/<videoId>.mp4"
```

Expected: `206` (Partial Content), confirming `canAccessVideo` → `getUserFromSession` correctly authenticated the Range request via the Bearer token alone, with no cookie in the request at all.

- [ ] **Step 6: Verify token listing, then revoke, then confirm access is immediately lost**

```bash
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/account/tokens
```

Expected: a `{ tokens: [...] }` list containing at least the two tokens created in Steps 2 and 4, each with `label`, `createdAt`, `lastUsedAt` (both should now show a non-null `lastUsedAt` for the token actually used in Steps 3-5) — and no `token`/hash field anywhere in the response.

Extract the id of the "E2E Verification Token" from that response (call it `$TOKEN_ID`), then revoke it:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X DELETE \
  -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/account/tokens/$TOKEN_ID"
```

Expected: this will actually fail with `401` once the token being used to authenticate the DELETE request is the very token it's trying to revoke and the revocation completes mid-request — that's fine and expected, not a bug: confirm this specific token is now gone by using the *cookie* session from Step 1 to re-list tokens:

```bash
curl -s -b /tmp/youkeep-cookies.txt http://localhost:3000/api/account/tokens
```

Expected: the "E2E Verification Token" is no longer in the list. Then confirm the revoked token itself no longer authenticates:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/videos
```

Expected: `401`.

- [ ] **Step 7: Clean up**

Using the cookie session, revoke the remaining "Second Token" created in Step 4, and delete any rows seeded in Step 5:

```bash
curl -s -b /tmp/youkeep-cookies.txt -H "x-csrf-token: $(grep csrf_token /tmp/youkeep-cookies.txt | awk '{print $NF}')" http://localhost:3000/api/account/tokens
# note the remaining token's id, then:
curl -s -b /tmp/youkeep-cookies.txt -H "x-csrf-token: $(grep csrf_token /tmp/youkeep-cookies.txt | awk '{print $NF}')" -X DELETE "http://localhost:3000/api/account/tokens/<remaining-id>"
```

Stop the dev server:

```bash
kill %1 2>/dev/null || true
```

- [ ] **Step 8: Run the full test suite one final time**

```bash
npx vitest run
```

Expected: all tests pass, including every test file added in Tasks 1-3 (`tests/unit/apiTokens.test.ts`, `tests/integration/apiTokens.test.ts`, `tests/integration/apiTokenAuth.test.ts`, `tests/integration/account-tokens.test.ts`) alongside the full pre-existing suite.

No commit for this task — it is verification only. If any check reveals a real bug, fix it in the relevant task's files, re-run the full suite, and commit the fix with a message describing the bug found during manual verification.
