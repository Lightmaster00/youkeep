import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { apiErrorMessage, mapServerMessage, serverMessageOf, EXACT_MESSAGES, NUMBERED_MESSAGES } from '../../app/utils/apiError';

const LOCALES = fileURLToPath(new URL('../../i18n/locales', import.meta.url));

function loadCatalogue(code: string): (key: string, params?: Record<string, unknown>) => string {
  const flat: Record<string, string> = {};
  const walk = (o: Record<string, unknown>, prefix = '') => {
    for (const [k, v] of Object.entries(o)) {
      if (v && typeof v === 'object') walk(v as Record<string, unknown>, `${prefix}${k}.`);
      else flat[`${prefix}${k}`] = String(v);
    }
  };
  walk(JSON.parse(readFileSync(join(LOCALES, `${code}.json`), 'utf8')));
  // Same {name} interpolation as vue-i18n for these messages.
  return (key, params = {}) => (flat[key] ?? key).replace(/\{'(.)'\}/g, '$1').replace(/\{(\w+)\}/g, (_, n) => String(params[n] ?? `{${n}}`));
}
const en = loadCatalogue('en');
const fr = loadCatalogue('fr');

const loginError = (statusMessage: string) => ({ statusCode: 401, data: { statusMessage } });

describe('apiErrorMessage', () => {
  it('maps a known server message to the UI language', () => {
    expect(apiErrorMessage(loginError('Invalid username or password.'), en)).toBe('Invalid username or password.');
    expect(apiErrorMessage(loginError('Invalid username or password.'), fr)).toBe("Nom d'utilisateur ou mot de passe incorrect.");
    expect(apiErrorMessage({ data: { statusMessage: 'Not available with an API token.' } }, fr)).toBe("Indisponible avec un jeton d'API.");
    expect(apiErrorMessage({ data: { statusMessage: 'Current password is incorrect.' } }, fr)).toBe('Le mot de passe actuel est incorrect.');
    expect(apiErrorMessage({ data: { statusMessage: 'Reason required' } }, fr)).toBe('Indiquez quel est le problème.');
  });

  it('keeps the numbers of rate limits and validation messages', () => {
    const limited = { data: { statusMessage: 'Too many failed login attempts. Try again in 7 minute(s).' } };
    expect(apiErrorMessage(limited, en)).toBe('Too many failed login attempts. Try again in 7 minute(s).');
    expect(apiErrorMessage(limited, fr)).toBe('Trop de tentatives de connexion échouées. Réessayez dans 7 minute(s).');
    expect(apiErrorMessage({ data: { statusMessage: 'Password must be at least 8 characters long.' } }, fr)).toBe('Le mot de passe doit contenir au moins 8 caractères.');
    expect(apiErrorMessage({ data: { statusMessage: 'You can have at most 200 playlists.' } }, fr)).toBe('Vous pouvez avoir 200 playlists au maximum.');
    expect(apiErrorMessage({ data: { statusMessage: 'title must be at most 200 characters.' } }, fr)).toBe('Le titre ne peut pas dépasser 200 caractères.');
  });

  it('shows an unknown server message as the server sent it', () => {
    expect(apiErrorMessage({ data: { statusMessage: 'Disk quota exceeded for this show.' } }, fr, 'errors.generic')).toBe('Disk quota exceeded for this show.');
    // Another suffix on a rate limit is not an exact match: shown as is.
    const hinted = 'Too many failed login attempts. Try again in 3 minute(s). Behind a proxy? Set X.';
    expect(apiErrorMessage({ data: { statusMessage: hinted } }, fr)).toBe(hinted);
  });

  it('maps the login rate limit with the reverse-proxy hint the server adds by default', () => {
    const msg = 'Too many failed login attempts. Try again in 15 minute(s). If YouKeep runs behind a reverse proxy, the administrator must set TRUST_PROXY so visitors are not all counted as one.';
    expect(apiErrorMessage({ data: { statusMessage: msg } }, en)).toBe(msg);
    expect(apiErrorMessage({ data: { statusMessage: msg } }, fr)).toContain('Réessayez dans 15 minute(s).');
    expect(apiErrorMessage({ data: { statusMessage: msg } }, fr)).toContain('TRUST_PROXY');
  });

  it('reads statusMessage from createError objects too', () => {
    expect(serverMessageOf({ statusMessage: 'Playlist not found.' })).toBe('Playlist not found.');
    expect(apiErrorMessage({ statusMessage: 'Playlist not found.' }, fr)).toBe('Playlist introuvable.');
  });

  it('falls back to the caller key, then to a generic message, when the server said nothing', () => {
    expect(apiErrorMessage(new Error('network down'), fr, 'report.failed')).toBe("Le signalement n'a pas pu être envoyé.");
    expect(apiErrorMessage(null, fr)).toBe('Une erreur est survenue. Veuillez réessayer.');
    expect(apiErrorMessage({ data: { statusMessage: '   ' } }, en)).toBe('Something went wrong. Please try again.');
    expect(apiErrorMessage({ data: { statusMessage: 42 } }, en, 'login.incorrect')).toBe('Incorrect credentials.');
  });

  it('maps nothing it does not know', () => {
    expect(mapServerMessage('Something else')).toBeNull();
  });

  it('every mapped message points at a key that exists, in en and fr, with matching placeholders', () => {
    const flatKeys = (code: string) => JSON.parse(readFileSync(join(LOCALES, `${code}.json`), 'utf8'));
    const lookup = (cat: any, key: string): string | undefined => key.split('.').reduce((o, p) => o?.[p], cat);
    const targets = [...Object.values(EXACT_MESSAGES), ...NUMBERED_MESSAGES.map(([, key]) => key)];
    for (const code of ['en', 'fr']) {
      const cat = flatKeys(code);
      const missing = targets.filter(k => typeof lookup(cat, k) !== 'string');
      expect(missing, `${code}`).toEqual([]);
    }
    for (const [, key, name] of NUMBERED_MESSAGES) expect(lookup(flatKeys('en'), key)).toContain(`{${name}}`);
  });

  it('an English message maps to itself in en, apart from the few reworded ones', () => {
    const reworded = new Set(['title is required.', 'Reason required']);
    for (const [message, key] of Object.entries(EXACT_MESSAGES)) {
      if (reworded.has(message)) continue;
      expect(en(key), key).toBe(message);
    }
  });
});
