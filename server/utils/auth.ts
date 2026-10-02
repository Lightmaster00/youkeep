import { H3Event, getCookie, getHeader, getRequestProtocol, setCookie, deleteCookie, createError } from 'h3';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { getUserFromApiToken } from './apiTokens';

export interface UserSession {
  id: string;
  username: string;
  role: 'admin' | 'user';
  mustChangePassword: boolean;
}

export const SESSION_COOKIE_NAME = 'youkeep_session';
export const CSRF_COOKIE_NAME = 'csrf_token';
export const SESSION_DURATION = 1000 * 60 * 60 * 24 * 7; // 7 days

// Cookies are marked Secure only when the request actually arrived over HTTPS
// (directly, or via a reverse proxy sending X-Forwarded-Proto: https). A
// Secure cookie is silently dropped by browsers on plain-HTTP LAN access
// (e.g. http://192.168.x.x:3000), which would make login impossible.
// COOKIE_SECURE=true|false overrides the detection.
export function isSecureRequest(event: H3Event): boolean {
  const override = process.env.COOKIE_SECURE;
  if (override === 'true') return true;
  if (override === 'false') return false;
  return getRequestProtocol(event) === 'https';
}

// Regenerated on every process start — invalidates in-flight CSRF tokens on
// restart/deploy, but server/middleware/csrf.ts self-heals this transparently
// on the user's next GET request, so it is never user-visible.
const CSRF_SECRET = crypto.randomBytes(32);

export function computeCsrfToken(sessionId: string): string {
  return crypto.createHmac('sha256', CSRF_SECRET).update(sessionId).digest('hex');
}

export function hashPassword(password: string): string {
  const salt = bcrypt.genSaltSync(10);
  return bcrypt.hashSync(password, salt);
}

export function verifyPassword(password: string, hash: string): boolean {
  return bcrypt.compareSync(password, hash);
}

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
    deleteCookie(event, SESSION_COOKIE_NAME, { path: '/' });
    deleteCookie(event, CSRF_COOKIE_NAME, { path: '/' });
  }
}

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
  
  // Récupérer la visibilité de la vidéo et de sa chaîne
  const video = db.prepare(`
    SELECT v.visibility as video_visibility, v.share_token, c.visibility as channel_visibility 
    FROM videos v
    JOIN channels c ON v.channel_id = c.id
    WHERE v.id = ?
  `).get(videoId) as { video_visibility: string; share_token: string | null; channel_visibility: string } | undefined;

  if (!video) return false;

  // Si le token de partage est valide, l'accès est autorisé
  if (token && video.share_token && token === video.share_token) {
    return true;
  }

  // Récupérer l'utilisateur
  const user = await getUserFromSession(event);

  // Déterminer la visibilité effective (la plus restrictive des deux)
  const visMap: Record<string, number> = { 'public': 0, 'private': 1, 'ultra_private': 2 };
  const videoLevel = visMap[video.video_visibility] ?? 0;
  const channelLevel = visMap[video.channel_visibility] ?? 0;
  const effectiveVisibilityLevel = Math.max(videoLevel, channelLevel);

  if (effectiveVisibilityLevel === 0) {
    // Public : accessible à tous
    return true;
  }

  if (!user) {
    // Invité : accès refusé aux contenus restreints
    return false;
  }

  if (user.role === 'admin') {
    return true; // Admin voit tout
  }

  if (effectiveVisibilityLevel === 1) {
    // Privé : tout membre connecté peut voir
    return true;
  }

  // Si l'utilisateur possède un accès explicite à la chaîne de la vidéo
  const channelAccessCheck = db.prepare(`
    SELECT 1 FROM user_channel_access 
    WHERE user_id = ? AND channel_id = (SELECT channel_id FROM videos WHERE id = ?)
  `).get(user.id, videoId);
  if (channelAccessCheck) {
    return true;
  }

  // Ultra Privé : réservé uniquement à l'admin
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

  // Vérifier l'accès explicite accordé à l'utilisateur
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
