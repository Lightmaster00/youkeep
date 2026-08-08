# Dev Login Fixture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dev-only `POST /api/dev/login` endpoint that creates (if needed) a fixture admin user and logs it in, so future sub-projects' subagents can reach an authenticated session without touching the database directly.

**Architecture:** A single new Nitro endpoint file, mirroring the existing `server/api/auth/setup.post.ts`'s user-creation pattern and reusing the existing `createSession()` helper unchanged.

**Tech Stack:** Nuxt 4, Nitro (H3), better-sqlite3, bcryptjs, Vitest.

## Global Constraints

- No changes to any existing auth endpoint, or to `createSession`/`hashPassword` in `server/utils/auth.ts`.
- No UI — HTTP-only dev tool.
- No fixture data beyond the auth user itself.
- The guard must check both `NODE_ENV !== 'production'` AND `ALLOW_DEV_LOGIN === '1'` — both conditions required, matching the spec's exact code.
- This endpoint is plain DB/HTTP logic with no yt-dlp involvement — unlike most of this session's prior sub-projects, it gets full automated test coverage per this project's established convention.

---

### Task 1: `POST /api/dev/login` endpoint + tests

**Files:**
- Create: `server/api/dev/login.post.ts`
- Test: `tests/integration/dev-login.test.ts`

**Interfaces:**
- Consumes: `getDb()`, `hashPassword(password: string): string`, `createSession(userId: string, event: H3Event): Promise<string>` — all ambient auto-imports in this codebase (ambient, ungrep-able by name in the file itself; confirmed by reading `server/api/auth/setup.post.ts`, which uses all three with zero explicit import lines beyond `h3` and `crypto`).
- Produces: nothing consumed by later tasks — this is the only task in the plan.

- [ ] **Step 1: Write the failing tests**

Create `tests/integration/dev-login.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import loginHandler from '../../server/api/dev/login.post';
import { createTestDb, mockEvent } from '../helpers/testDb';

let db: Database.Database;
let originalNodeEnv: string | undefined;
let originalAllowDevLogin: string | undefined;

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
  originalNodeEnv = process.env.NODE_ENV;
  originalAllowDevLogin = process.env.ALLOW_DEV_LOGIN;
});

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
  process.env.ALLOW_DEV_LOGIN = originalAllowDevLogin;
});

describe('POST /api/dev/login', () => {
  it('404s when NODE_ENV is production, even with ALLOW_DEV_LOGIN=1', async () => {
    process.env.NODE_ENV = 'production';
    process.env.ALLOW_DEV_LOGIN = '1';

    await expect(loginHandler(mockEvent(undefined, { path: '/api/dev/login' }))).rejects.toMatchObject({ statusCode: 404 });
  });

  it('404s when ALLOW_DEV_LOGIN is not set, even when NODE_ENV is not production', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.ALLOW_DEV_LOGIN;

    await expect(loginHandler(mockEvent(undefined, { path: '/api/dev/login' }))).rejects.toMatchObject({ statusCode: 404 });
  });

  it('404s when ALLOW_DEV_LOGIN is set to a wrong value', async () => {
    process.env.NODE_ENV = 'development';
    process.env.ALLOW_DEV_LOGIN = 'true'; // not the exact string '1'

    await expect(loginHandler(mockEvent(undefined, { path: '/api/dev/login' }))).rejects.toMatchObject({ statusCode: 404 });
  });

  it('creates the fixture user and returns a session cookie when both conditions are met', async () => {
    process.env.NODE_ENV = 'development';
    process.env.ALLOW_DEV_LOGIN = '1';

    const event = mockEvent(undefined, { path: '/api/dev/login' });
    const result: any = await loginHandler(event);

    expect(result.success).toBe(true);
    expect(result.username).toBe('dev-fixture-admin');

    const user = db.prepare("SELECT id, role FROM users WHERE username = 'dev-fixture-admin'").get() as any;
    expect(user).toBeDefined();
    expect(user.role).toBe('admin');

    const setCookieHeader = event.node.res.getHeader('set-cookie');
    expect(setCookieHeader).toBeDefined();
    expect(String(setCookieHeader)).toContain('youkeep_session=');
  });

  it('reuses the same fixture user on a second call instead of creating a duplicate', async () => {
    process.env.NODE_ENV = 'development';
    process.env.ALLOW_DEV_LOGIN = '1';

    await loginHandler(mockEvent(undefined, { path: '/api/dev/login' }));
    await loginHandler(mockEvent(undefined, { path: '/api/dev/login' }));

    const count = (db.prepare("SELECT COUNT(*) as count FROM users WHERE username = 'dev-fixture-admin'").get() as { count: number }).count;
    expect(count).toBe(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/integration/dev-login.test.ts`
Expected: FAIL — `Cannot find module '../../server/api/dev/login.post'` (the endpoint doesn't exist yet).

- [ ] **Step 3: Create the endpoint**

Create `server/api/dev/login.post.ts`:

```ts
import { defineEventHandler, createError } from 'h3';
import crypto from 'crypto';

export default defineEventHandler(async (event) => {
  if (process.env.NODE_ENV === 'production' || process.env.ALLOW_DEV_LOGIN !== '1') {
    throw createError({ statusCode: 404, statusMessage: 'Not found' });
  }

  const db = getDb();
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

  await createSession(user.id, event);

  return { success: true, username: FIXTURE_USERNAME };
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/integration/dev-login.test.ts`
Expected: all 5 tests PASS.

- [ ] **Step 5: Run the full suite**

Run: `npm test -- --run`
Expected: all tests pass, no regressions.

- [ ] **Step 6: Manual verification**

1. Start the dev server with the flag set: `ALLOW_DEV_LOGIN=1 npm run dev`.
2. `curl -i -c /tmp/youkeep-dev-cookies.txt -X POST http://localhost:<port>/api/dev/login` (use whatever port the dev server actually bound to). Confirm a `200` response with `{"success":true,"username":"dev-fixture-admin"}` and a `Set-Cookie: youkeep_session=...` header.
3. `curl -b /tmp/youkeep-dev-cookies.txt http://localhost:<port>/api/admin/downloader/queue` — confirm this now succeeds (200, real queue data) instead of the `401` a guest would get.
4. Restart the dev server WITHOUT `ALLOW_DEV_LOGIN` set (plain `npm run dev`) and confirm `POST /api/dev/login` now returns `404`.
5. Clean up: delete the `dev-fixture-admin` row from `data/youkeep.db`'s `users` table (and its `sessions` row) if you don't want it lingering in the real dev database — or leave it, since it's inert without `ALLOW_DEV_LOGIN=1` set and does not affect the app's normal operation.

Report what you observed.

- [ ] **Step 7: Commit**

```bash
git add server/api/dev/login.post.ts tests/integration/dev-login.test.ts
git commit -m "feat: add dev-only login fixture endpoint for future manual verification"
```
