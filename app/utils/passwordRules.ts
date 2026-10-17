// Client-side mirror of the server password rules (server/utils/validation.ts
// validatePassword): at least 8 characters, at most 72 bytes once UTF-8
// encoded (bcrypt ignores anything past 72 bytes).
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_BYTES = 72;

// Returns a user-facing message, or null when the password is acceptable.
export function passwordProblem(password: string): string | null {
  if ([...password].length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters long.`;
  }
  if (new TextEncoder().encode(password).length > PASSWORD_MAX_BYTES) {
    return `Password is too long: at most ${PASSWORD_MAX_BYTES} bytes (fewer characters if you use accents or emoji).`;
  }
  return null;
}
