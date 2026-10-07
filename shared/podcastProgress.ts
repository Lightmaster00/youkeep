// Pure module shared by the Nitro server and the Vue app (app code imports it
// via the `#shared/podcastProgress` alias, server code with relative paths): no
// Nuxt auto-imports and no I/O in here. Limits, validation and the playback
// progress rules of followed shows and per-user episode progress.

export { isValidMediaId as isValidPodcastId } from './musicPlaylists';

export const MAX_FOLLOWED_SHOWS = 500;
export const PODCAST_STATUS_MAX_IDS = 200;
// A position this close to the end counts as "finished listening".
export const COMPLETED_TOLERANCE_SECONDS = 10;
// "Continue listening" ignores episodes barely started.
export const CONTINUE_MIN_POSITION_SECONDS = 5;
// Upper bound for any stored position or duration (one week), so a bogus
// client value cannot overflow anything.
export const MAX_PROGRESS_SECONDS = 7 * 24 * 3600;

export interface ProgressInput {
  positionSeconds: number;
  durationSeconds: number | null;
  completed?: boolean;
}

export type ProgressInputResult = { ok: true; value: ProgressInput } | { ok: false; error: string };

function toSeconds(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.min(MAX_PROGRESS_SECONDS, Math.max(0, Math.floor(value)));
}

// Validates a progress PUT body. Positions and durations are floored to whole
// seconds and clamped to [0, one week]; the position is also clamped to the
// duration when one is given. A zero duration means "unknown".
export function parseProgressInput(body: unknown): ProgressInputResult {
  const src = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  let position = toSeconds(src.positionSeconds);
  if (position === null) return { ok: false, error: 'positionSeconds must be a number.' };

  let duration: number | null = null;
  if (src.durationSeconds !== undefined && src.durationSeconds !== null) {
    duration = toSeconds(src.durationSeconds);
    if (duration === null) return { ok: false, error: 'durationSeconds must be a number.' };
    if (duration === 0) duration = null;
  }
  if (duration !== null) position = Math.min(position, duration);

  if (src.completed !== undefined && typeof src.completed !== 'boolean') {
    return { ok: false, error: 'completed must be true or false.' };
  }
  const value: ProgressInput = { positionSeconds: position, durationSeconds: duration };
  if (typeof src.completed === 'boolean') value.completed = src.completed;
  return { ok: true, value };
}

// True when the position is within the completion tolerance of a known duration.
export function reachesEnd(positionSeconds: number, durationSeconds: number | null | undefined): boolean {
  if (!durationSeconds || durationSeconds <= 0 || !Number.isFinite(positionSeconds)) return false;
  return positionSeconds >= durationSeconds - COMPLETED_TOLERANCE_SECONDS;
}

// The completed flag after an update: an explicit value wins, reaching the end
// marks the episode completed, and otherwise the previous flag is kept (a later,
// lower position never un-marks a completed episode by itself).
export function nextCompleted(previous: boolean, input: ProgressInput, durationSeconds: number | null): boolean {
  if (input.completed !== undefined) return input.completed;
  if (reachesEnd(input.positionSeconds, durationSeconds)) return true;
  return previous;
}

export interface EpisodeProgress {
  positionSeconds: number;
  durationSeconds: number | null;
  completed: boolean;
  updatedAt: number;
}

// Share of the episode heard, 0..1 (0 when the duration is unknown, 1 when played).
export function progressFraction(progress: EpisodeProgress | null | undefined, fallbackDuration?: number | null): number {
  if (!progress) return 0;
  if (progress.completed) return 1;
  const duration = progress.durationSeconds || fallbackDuration || 0;
  if (duration <= 0) return 0;
  return Math.min(1, Math.max(0, progress.positionSeconds / duration));
}

export interface LocalPosition {
  positionSeconds: number;
  savedAt: number;
}

// Where playback should start. The server position wins when it was saved
// after the local one (another device listened later); the local one stays the
// fallback for guests and offline use. A server position on a completed
// episode at (or with no known) end restarts from 0, while a completed
// episode being heard again resumes where it was left.
export function chooseResumePosition(
  local: LocalPosition | null,
  server: EpisodeProgress | null,
  fallbackDuration?: number | null
): number {
  if (server && (!local || server.updatedAt > local.savedAt)) {
    const duration = server.durationSeconds || fallbackDuration || 0;
    if (server.completed && (duration <= 0 || reachesEnd(server.positionSeconds, duration))) return 0;
    return Math.max(0, server.positionSeconds);
  }
  return local ? Math.max(0, local.positionSeconds) : 0;
}
