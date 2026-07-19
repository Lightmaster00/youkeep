import Database from 'better-sqlite3';

// Minimal schema mirroring server/utils/db.ts — only the tables/columns the
// access-control logic under test actually touches.
export function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'user')),
      must_change_password INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE channels (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      visibility TEXT DEFAULT 'public',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE videos (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      visibility TEXT DEFAULT 'public',
      share_token TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE
    );

    CREATE TABLE user_channel_access (
      user_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      PRIMARY KEY (user_id, channel_id)
    );
  `);

  return db;
}

export function insertUser(db: Database.Database, opts: { id: string; role: 'admin' | 'user' }) {
  db.prepare(`
    INSERT INTO users (id, username, password_hash, role, created_at)
    VALUES (?, ?, 'x', ?, ?)
  `).run(opts.id, `user_${opts.id}`, opts.role, Date.now());
}

export function insertSession(db: Database.Database, opts: { id: string; userId: string; expiresAt?: number }) {
  db.prepare(`
    INSERT INTO sessions (id, user_id, expires_at)
    VALUES (?, ?, ?)
  `).run(opts.id, opts.userId, opts.expiresAt ?? Date.now() + 1000 * 60 * 60);
}

export function insertChannel(db: Database.Database, opts: { id: string; visibility?: string }) {
  db.prepare(`
    INSERT INTO channels (id, title, visibility, created_at)
    VALUES (?, ?, ?, ?)
  `).run(opts.id, `Channel ${opts.id}`, opts.visibility ?? 'public', Date.now());
}

export function insertVideo(db: Database.Database, opts: { id: string; channelId: string; visibility?: string; shareToken?: string | null }) {
  db.prepare(`
    INSERT INTO videos (id, title, channel_id, visibility, share_token, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(opts.id, `Video ${opts.id}`, opts.channelId, opts.visibility ?? 'public', opts.shareToken ?? null, Date.now());
}

export function grantChannelAccess(db: Database.Database, userId: string, channelId: string) {
  db.prepare('INSERT INTO user_channel_access (user_id, channel_id) VALUES (?, ?)').run(userId, channelId);
}

// Minimal H3Event stand-in: covers exactly what getUserFromSession/getCookie/
// deleteCookie touch (event.node.req.headers.cookie, event.node.res.*).
export function mockEvent(cookieHeader?: string): any {
  return {
    node: {
      req: { headers: { cookie: cookieHeader || '' } },
      res: {
        getHeader: () => undefined,
        setHeader: () => {}
      }
    }
  };
}

export function sessionCookie(sessionId: string): string {
  return `youkeep_session=${sessionId}`;
}
