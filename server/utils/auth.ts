import { H3Event, getCookie, getHeader, setCookie, deleteCookie, createError } from 'h3';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { getUserFromApiToken } from './apiTokens';
import { getForwardedProto } from './trustProxy';

export interface UserSession {
  id: string;
  username: string;
  role: 'admin' | 'user';
  mustChangePassword: boolean;
  /** How the request authenticated: a browser session cookie or an API token. */
  via: 'session' | 'token';
}

export const SESSION_COOKIE_NAME = 'youkeep_session';
export const CSRF_COOKIE_NAME = 'csrf_token';
export const SESSION_DURATION = 1000 * 60 * 60 * 24 * 7; // 7 days

// Cookies are marked Secure only when the request actually arrived over HTTPS
// (directly, or via a reverse proxy sending X-Forwarded-Proto: https, which is
// only believed when TRUST_PROXY is set, like X-Forwarded-For). A
// Secure cookie is silently dropped by browsers on plain-HTTP LAN access
// (e.g. http://192.168.x.x:3000), which would make login impossible.
// COOKIE_SECURE=true|false overrides the detection.
export function isSecureRequest(event: H3Event): boolean {
  const override = process.env.COOKIE_SECURE;
  if (override === 'true') return true;
  if (override === 'false') return false;
  if ((event.node.req as any).connection?.encrypted) return true;
  return getForwardedProto(event) === 'https';
}

// The HMAC secret behind CSRF tokens is stored in the settings table
// (key csrf_secret, 32 random bytes as hex), created on first use, so tokens
// stay valid across restarts. Read once per process. Without a settings
// table (some tests) an in-memory secret is used instead.
let csrfSecret: Buffer | null = null;

function getCsrfSecret(): Buffer {
  if (csrfSecret) return csrfSecret;
  try {
    const db = getDb();
    const row = db.prepare("SELECT value FROM settings WHERE key = 'csrf_secret'").get() as { value: string } | undefined;
    if (row && /^[0-9a-f]{64}$/.test(row.value)) {
      csrfSecret = Buffer.from(row.value, 'hex');
    } else {
      const fresh = crypto.randomBytes(32);
      db.prepare(`
        INSERT INTO settings (key, value) VALUES ('csrf_secret', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(fresh.toString('hex'));
      csrfSecret = fresh;
    }
  } catch {
    csrfSecret = crypto.randomBytes(32);
  }
  return csrfSecret;
}

/** Forgets the cached CSRF secret, as a restart would (tests only). */
export function resetCsrfSecretCacheForTests(): void {
  csrfSecret = null;
}

export function computeCsrfToken(sessionId: string): string {
  return crypto.createHmac('sha256', getCsrfSecret()).update(sessionId).digest('hex');
}

/** Constant-time string comparison; false for anything that is not two strings. */
export function safeEqual(a: unknown, b: unknown): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

/** Removes both the session cookie and its CSRF companion. */
export function clearSessionCookies(event: H3Event): void {
  deleteCookie(event, SESSION_COOKIE_NAME, { path: '/' });
  deleteCookie(event, CSRF_COOKIE_NAME, { path: '/' });
}

/** Deletes every expired session row; returns how many were removed. Never throws. */
export function purgeExpiredSessions(): number {
  try {
    return getDb().prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now()).changes;
  } catch (err) {
    console.error('YouKeep: could not purge expired sessions:', err);
    return 0;
  }
}

export const SESSION_PURGE_INTERVAL_MS = 60 * 60 * 1000;

/** Purges expired sessions now and every hour; returns a function that stops it. */
export function startSessionCleanup(): () => void {
  purgeExpiredSessions();
  const timer = setInterval(purgeExpiredSessions, SESSION_PURGE_INTERVAL_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}

const BCRYPT_ROUNDS = 10;

// A valid bcrypt hash of a random throwaway password. Login compares against
// it when the username does not exist, so an unknown user costs the same time
// as a wrong password (no timing oracle on which usernames exist).
export const DUMMY_PASSWORD_HASH = '$2b$10$073K657YTnd.q68kw787sOXGW10kBnYDukAbbfnoGX.i8R06CQj92';

// bcryptjs's async API yields to the event loop between chunks of work, but
// several hashes started together all run their chunks back to back in the
// same loop phase (8 parallel compares stalled the loop for ~420 ms). Running
// them one at a time keeps every stall to a single hash (~50 ms) so health
// checks and other requests are served in between.
let bcryptQueue: Promise<unknown> = Promise.resolve();
function runBcrypt<T>(task: () => Promise<T>): Promise<T> {
  const run = bcryptQueue.then(task, task);
  bcryptQueue = run.catch(() => undefined);
  return run;
}

export function hashPassword(password: string): Promise<string> {
  return runBcrypt(() => bcrypt.hash(password, BCRYPT_ROUNDS));
}

// Always performs a full bcrypt comparison: a missing hash is compared against
// DUMMY_PASSWORD_HASH and then reported as a mismatch.
export async function verifyPassword(password: string, hash: string | null | undefined): Promise<boolean> {
  let ok = false;
  try {
    ok = await runBcrypt(() => bcrypt.compare(password, hash || DUMMY_PASSWORD_HASH));
  } catch {
    ok = false;
  }
  return ok && !!hash;
}

export const MAX_SESSIONS_PER_USER = 20;

export async function createSession(userId: string, event: H3Event): Promise<string> {
  const db = getDb();
  const sessionId = crypto.randomUUID();
  const expiresAt = Date.now() + SESSION_DURATION;

  db.transaction(() => {
    db.prepare(`
      INSERT INTO sessions (id, user_id, expires_at)
      VALUES (?, ?, ?)
    `).run(sessionId, userId, expiresAt);
    // Every session lasts SESSION_DURATION, so the earliest expiry is the
    // oldest login: keep only the newest MAX_SESSIONS_PER_USER.
    db.prepare(`
      DELETE FROM sessions
      WHERE user_id = ? AND id NOT IN (
        SELECT id FROM sessions WHERE user_id = ? ORDER BY expires_at DESC, id DESC LIMIT ?
      )
    `).run(userId, userId, MAX_SESSIONS_PER_USER);
  })();

  // Set httpOnly cookie
  setCookie(event, SESSION_COOKIE_NAME, sessionId, {
    httpOnly: true,
    secure: isSecureRequest(event),
    sameSite: 'lax',
    maxAge: SESSION_DURATION / 1000,
    path: '/'
  });

  // Set a second, JS-readable CSRF token cookie (double-submit pattern) —
  // NOT httpOnly, since the client plugin (app/plugins/csrf.client.ts) must
  // be able to read it and echo it back as a header on mutating requests.
  setCookie(event, CSRF_COOKIE_NAME, computeCsrfToken(sessionId), {
    httpOnly: false,
    secure: isSecureRequest(event),
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
    clearSessionCookies(event);
  }
}

function getUserFromBearer(event: H3Event): UserSession | null {
  const authHeader = getHeader(event, 'authorization');
  // RFC 7235: the auth scheme is case-insensitive.
  const bearer = authHeader?.match(/^Bearer\s+(.+)$/i);
  const token = bearer?.[1]?.trim();
  if (!token) return null;
  return getUserFromApiToken(token);
}

export async function getUserFromSession(event: H3Event): Promise<UserSession | null> {
  const sessionId = getCookie(event, SESSION_COOKIE_NAME);

  if (!sessionId) {
    // No session cookie — fall back to an API token, if one was supplied.
    return getUserFromBearer(event);
  }

  const db = getDb();
  const session = db.prepare(`
    SELECT s.expires_at, u.id, u.username, u.role, u.must_change_password
    FROM sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.id = ?
  `).get(sessionId) as { expires_at: number; id: string; username: string; role: 'admin' | 'user'; must_change_password: number } | undefined;

  if (!session) {
    clearSessionCookies(event);
    // A stale cookie must not hide a valid Bearer token sent alongside it.
    return getUserFromBearer(event);
  }

  // Check expiration
  if (Date.now() > session.expires_at) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
    clearSessionCookies(event);
    return getUserFromBearer(event);
  }

  return {
    id: session.id,
    username: session.username,
    role: session.role,
    mustChangePassword: session.must_change_password === 1,
    via: 'session'
  };
}

export const API_TOKEN_FORBIDDEN_MESSAGE = 'Not available with an API token.';

/**
 * Routes that mint credentials or manage identities (tokens, passwords,
 * users, search-platform keys) need a real browser session: a leaked API
 * token must not be able to create more credentials or accounts.
 */
export function assertNotApiToken(user: UserSession): void {
  if (user.via === 'token') {
    throw createError({ statusCode: 403, statusMessage: API_TOKEN_FORBIDDEN_MESSAGE });
  }
}

export async function requireSessionUser(event: H3Event): Promise<UserSession> {
  const user = await requireUser(event);
  assertNotApiToken(user);
  return user;
}

export async function requireSessionAdmin(event: H3Event): Promise<UserSession> {
  const user = await requireAdmin(event);
  assertNotApiToken(user);
  return user;
}

export async function requireUser(event: H3Event): Promise<UserSession> {
  const user = await getUserFromSession(event);
  if (!user) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized. Please log in.'
    });
  }
  return user;
}

export async function requireAdmin(event: H3Event): Promise<UserSession> {
  const user = await requireUser(event);
  if (user.role !== 'admin') {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden. Admin privileges required.'
    });
  }
  return user;
}

export async function canAccessVideo(videoId: string, event: any, token?: string): Promise<boolean> {
  const db = getDb();
  
  // Fetch the visibility of the video and of its channel
  const video = db.prepare(`
    SELECT v.visibility as video_visibility, v.share_token, c.visibility as channel_visibility 
    FROM videos v
    JOIN channels c ON v.channel_id = c.id
    WHERE v.id = ?
  `).get(videoId) as { video_visibility: string; share_token: string | null; channel_visibility: string } | undefined;

  if (!video) return false;

  // If the share token is valid, access is granted
  if (token && video.share_token && safeEqual(token, video.share_token)) {
    return true;
  }

  // Fetch the user
  const user = await getUserFromSession(event);

  // Determine the effective visibility (the more restrictive of the two)
  const visMap: Record<string, number> = { 'public': 0, 'private': 1, 'ultra_private': 2 };
  const videoLevel = visMap[video.video_visibility] ?? 0;
  const channelLevel = visMap[video.channel_visibility] ?? 0;
  const effectiveVisibilityLevel = Math.max(videoLevel, channelLevel);

  if (effectiveVisibilityLevel === 0) {
    // Public: accessible to everyone
    return true;
  }

  if (!user) {
    // Guest: access denied to restricted content
    return false;
  }

  if (user.role === 'admin') {
    return true; // Admin sees everything
  }

  if (effectiveVisibilityLevel === 1) {
    // Private: any logged-in member can view
    return true;
  }

  // If the user has explicit access to the video's channel
  const channelAccessCheck = db.prepare(`
    SELECT 1 FROM user_channel_access 
    WHERE user_id = ? AND channel_id = (SELECT channel_id FROM videos WHERE id = ?)
  `).get(user.id, videoId);
  if (channelAccessCheck) {
    return true;
  }

  // Ultra Private: admin only
  return false;
}

export async function canAccessChannel(channelId: string, event: any): Promise<boolean> {
  const db = getDb();
  const channel = db.prepare('SELECT visibility FROM channels WHERE id = ?').get(channelId) as { visibility: string } | undefined;
  
  if (!channel) return false;

  const user = await getUserFromSession(event);

  if (channel.visibility === 'public') {
    return true;
  }

  if (!user) {
    return false;
  }

  if (user.role === 'admin') {
    return true;
  }

  if (channel.visibility === 'private') {
    return true;
  }

  // Check the explicit access granted to the user
  const explicitAccess = db.prepare('SELECT 1 FROM user_channel_access WHERE user_id = ? AND channel_id = ?').get(user.id, channelId);
  if (explicitAccess) {
    return true;
  }

  return false;
}

export async function canAccessMusicTrack(trackId: string, event: any): Promise<boolean> {
  const db = getDb();

  const track = db.prepare(`
    SELECT a.visibility as artist_visibility
    FROM music_tracks t
    JOIN music_artists a ON t.artist_id = a.id
    WHERE t.id = ?
  `).get(trackId) as { artist_visibility: string } | undefined;

  if (!track) return false;

  const user = await getUserFromSession(event);

  const visMap: Record<string, number> = { 'public': 0, 'private': 1, 'ultra_private': 2 };
  // Unlike canAccessVideo (which defaults an unrecognized value to public),
  // fail closed here: music_artists.visibility has no CHECK constraint and
  // the admin ingest endpoint doesn't validate it, so a typo must never
  // silently make restricted content world-readable.
  const level = visMap[track.artist_visibility] ?? 2;

  if (level === 0) return true; // Public: everyone
  if (!user) return false;      // Guest: no access to restricted content
  if (user.role === 'admin') return true; // Admin sees everything
  if (level === 1) return true; // Private: any logged-in member

  // Ultra Private: admin-only for music today — no equivalent of
  // user_channel_access exists for music artists yet.
  return false;
}

export async function canAccessMusicArtist(artistId: string, event: any): Promise<boolean> {
  const db = getDb();

  const artist = db.prepare('SELECT visibility FROM music_artists WHERE id = ?').get(artistId) as { visibility: string } | undefined;

  if (!artist) return false;

  const user = await getUserFromSession(event);

  const visMap: Record<string, number> = { 'public': 0, 'private': 1, 'ultra_private': 2 };
  // Same fail-closed reasoning as canAccessMusicTrack: music_artists.visibility
  // has no CHECK constraint, so an unrecognized value must never be treated
  // as public.
  const level = visMap[artist.visibility] ?? 2;

  if (level === 0) return true; // Public: everyone
  if (!user) return false;      // Guest: no access to restricted content
  if (user.role === 'admin') return true; // Admin sees everything
  if (level === 1) return true; // Private: any logged-in member

  // Ultra Private: admin-only for music today — no equivalent of
  // user_channel_access exists for music artists yet.
  return false;
}

export async function canAccessPodcastShow(showId: string, event: any): Promise<boolean> {
  const db = getDb();

  const show = db.prepare('SELECT visibility FROM podcast_shows WHERE id = ?').get(showId) as { visibility: string } | undefined;

  if (!show) return false;

  const user = await getUserFromSession(event);

  const visMap: Record<string, number> = { 'public': 0, 'private': 1, 'ultra_private': 2 };
  // Fail closed, same reasoning as canAccessMusicArtist: podcast_shows.visibility
  // has no CHECK constraint and only the ingest endpoint validates it, so an
  // unrecognized value must never be treated as public.
  const level = visMap[show.visibility] ?? 2;

  if (level === 0) return true; // Public: everyone
  if (!user) return false;      // Guest: no access to restricted content
  if (user.role === 'admin') return true; // Admin sees everything
  if (level === 1) return true; // Private: any logged-in member

  // Ultra Private: admin-only for podcasts — no equivalent of
  // user_channel_access exists for podcast shows.
  return false;
}

export async function canAccessPodcastEpisode(episodeId: string, event: any): Promise<boolean> {
  const db = getDb();

  const episode = db.prepare(`
    SELECT s.visibility as show_visibility
    FROM podcast_episodes e
    JOIN podcast_shows s ON e.show_id = s.id
    WHERE e.id = ?
  `).get(episodeId) as { show_visibility: string } | undefined;

  if (!episode) return false;

  const user = await getUserFromSession(event);

  const visMap: Record<string, number> = { 'public': 0, 'private': 1, 'ultra_private': 2 };
  // Fail closed on an unrecognized visibility value — same reasoning as
  // canAccessMusicTrack. podcast_episodes has no visibility column of its
  // own, so the parent show's value is the only tier that applies.
  const level = visMap[episode.show_visibility] ?? 2;

  if (level === 0) return true; // Public: everyone
  if (!user) return false;      // Guest: no access to restricted content
  if (user.role === 'admin') return true; // Admin sees everything
  if (level === 1) return true; // Private: any logged-in member

  // Ultra Private: admin-only for podcasts.
  return false;
}
