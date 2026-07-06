import { H3Event, getCookie, setCookie, deleteCookie, createError } from 'h3';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';

export interface UserSession {
  id: string;
  username: string;
  role: 'admin' | 'user';
  mustChangePassword: boolean;
}

const SESSION_COOKIE_NAME = 'youkeep_session';
const SESSION_DURATION = 1000 * 60 * 60 * 24 * 7; // 7 days

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
  }
}

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

  return false;
}
