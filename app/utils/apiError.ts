// The server answers with English `statusMessage`s. Server code is not translated, so the client
// maps the messages a user commonly meets (login, account, password, playlists, reports, API
// tokens, rate limits) to catalogue keys. Anything unknown is shown as the server sent it,
// and a call that failed without any message gets a generic key of the caller's choosing.

export type Translate = (key: string, params?: Record<string, unknown>) => string;

interface Mapped { key: string; params?: Record<string, string | number> }

// Whole-message matches.
export const EXACT_MESSAGES: Record<string, string> = {
  'Invalid username or password.': 'errors.invalidCredentials',
  'Username and password are required.': 'errors.credentialsRequired',
  'Username or password is too long.': 'errors.credentialsTooLong',
  'The admin profile has already been set up.': 'errors.alreadySetUp',
  'Not available with an API token.': 'errors.notWithToken',
  'This API token is read-only.': 'errors.tokenReadOnly',
  'Unauthorized. Please log in.': 'errors.unauthorized',
  'Current password is required.': 'errors.currentPasswordRequired',
  'Current password is incorrect.': 'errors.currentPasswordIncorrect',
  'Choose a different password.': 'errors.chooseDifferentPassword',
  'Invalid email address format.': 'errors.invalidEmail',
  'Invalid phone number format.': 'errors.invalidPhone',
  'Invalid date of birth format (must be YYYY-MM-DD).': 'errors.invalidDob',
  'Username may only contain letters, digits, spaces and . _ @ -': 'errors.usernameChars',
  'Label must be between 1 and 100 characters.': 'errors.tokenLabelLength',
  'Token not found.': 'errors.tokenNotFound',
  'Playlist not found.': 'errors.playlistNotFound',
  'Video not found.': 'errors.videoNotFound',
  'Track not found.': 'errors.trackNotFound',
  'You do not have permission to edit this playlist.': 'errors.playlistNoEdit',
  'You do not have permission to delete this playlist.': 'errors.playlistNoDelete',
  'title is required.': 'errors.titleRequired',
  'Reason required': 'errors.reasonRequired',
  'Too many reports. Try again later.': 'errors.tooManyReports',
};

// Messages that carry a number: [pattern, key, name of the parameter].
export const NUMBERED_MESSAGES: Array<[RegExp, string, string]> = [
  // Without TRUST_PROXY the server appends a hint for the administrator (see server/api/auth/login.post.ts).
  [/^Too many failed login attempts\. Try again in (\d+) minute\(s\)\. If YouKeep runs behind a reverse proxy, the administrator must set TRUST_PROXY so visitors are not all counted as one\.$/, 'errors.tooManyLoginsProxy', 'minutes'],
  [/^Too many failed login attempts\. Try again in (\d+) minute\(s\)\.$/, 'errors.tooManyLogins', 'minutes'],
  [/^Too many failed attempts\. Try again in (\d+) minute\(s\)\.$/, 'errors.tooManyAttempts', 'minutes'],
  [/^Password must be at least (\d+) characters long\.$/, 'account.passwordTooShort', 'min'],
  [/^Password must be at most (\d+) bytes long\.$/, 'account.passwordTooLong', 'max'],
  [/^Username must be between 1 and (\d+) characters\.$/, 'errors.usernameLength', 'max'],
  [/^title must be at most (\d+) characters\.$/, 'errors.titleTooLong', 'max'],
  [/^description must be at most (\d+) characters\.$/, 'errors.descriptionTooLong', 'max'],
  [/^Reason must be at most (\d+) characters\.$/, 'errors.reasonTooLong', 'max'],
  [/^You can have at most (\d+) playlists\.$/, 'errors.playlistLimit', 'max'],
  [/^A playlist holds at most (\d+) tracks\.$/, 'errors.playlistTracksLimit', 'max'],
];

/** The catalogue key (and parameters) for a known server message, else null. */
export function mapServerMessage(message: string): Mapped | null {
  const exact = EXACT_MESSAGES[message];
  if (exact) return { key: exact };
  for (const [pattern, key, name] of NUMBERED_MESSAGES) {
    const m = message.match(pattern);
    if (m) return { key, params: { [name]: Number(m[1]) } };
  }
  return null;
}

/** The server's statusMessage of a failed $fetch / useFetch call, if it sent one. */
export function serverMessageOf(err: unknown): string {
  const e = err as { data?: { statusMessage?: unknown }; statusMessage?: unknown } | null;
  const msg = e?.data?.statusMessage ?? e?.statusMessage;
  return typeof msg === 'string' ? msg.trim() : '';
}

/**
 * What to show for a failed API call: a known server message in the UI language, else the
 * server's own message, else the caller's generic message (`fallbackKey`).
 */
export function apiErrorMessage(err: unknown, t: Translate, fallbackKey = 'errors.generic'): string {
  const raw = serverMessageOf(err);
  if (raw) {
    const mapped = mapServerMessage(raw);
    return mapped ? t(mapped.key, mapped.params) : raw;
  }
  return t(fallbackKey);
}
