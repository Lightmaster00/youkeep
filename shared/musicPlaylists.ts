// Pure module shared by the Nitro server and the Vue app (app code imports it
// via the `#shared/musicPlaylists` alias, server code with relative paths): no
// Nuxt auto-imports and no I/O in here. Limits and validation for liked songs
// and personal music playlists.

export const PLAYLIST_TITLE_MAX = 100;
export const PLAYLIST_DESCRIPTION_MAX = 500;
export const MAX_PLAYLISTS_PER_USER = 200;
export const MAX_TRACKS_PER_PLAYLIST = 2000;
export const FAVORITES_STATUS_MAX_IDS = 200;

// Track ids are YouTube video ids, playlist ids are UUIDs: both fit here.
const MEDIA_ID_RE = /^[A-Za-z0-9_.:-]{1,128}$/;

export function isValidMediaId(value: unknown): value is string {
  return typeof value === 'string' && MEDIA_ID_RE.test(value);
}

export interface PlaylistFields {
  title?: string;
  description?: string | null;
}

export type PlaylistFieldsResult = { ok: true; fields: PlaylistFields } | { ok: false; error: string };

// Validates a create (`partial: false`, title required) or update body.
// Titles are trimmed and must be 1-100 characters; an empty or null
// description clears it.
export function validatePlaylistFields(body: unknown, partial: boolean): PlaylistFieldsResult {
  const src = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const fields: PlaylistFields = {};

  if (src.title !== undefined || !partial) {
    if (typeof src.title !== 'string') return { ok: false, error: 'Title is required.' };
    const title = src.title.trim();
    if (title.length === 0) return { ok: false, error: 'Title is required.' };
    if (title.length > PLAYLIST_TITLE_MAX) {
      return { ok: false, error: `Title must be at most ${PLAYLIST_TITLE_MAX} characters.` };
    }
    fields.title = title;
  }

  if (src.description !== undefined) {
    if (src.description === null) {
      fields.description = null;
    } else if (typeof src.description !== 'string') {
      return { ok: false, error: 'Description must be text.' };
    } else {
      const description = src.description.trim();
      if (description.length > PLAYLIST_DESCRIPTION_MAX) {
        return { ok: false, error: `Description must be at most ${PLAYLIST_DESCRIPTION_MAX} characters.` };
      }
      fields.description = description || null;
    }
  }

  return { ok: true, fields };
}

// True when `proposed` holds exactly the ids of `current`, each once.
export function isPermutationOf(current: readonly string[], proposed: unknown): proposed is string[] {
  if (!Array.isArray(proposed) || proposed.length !== current.length) return false;
  const remaining = new Set(current);
  if (remaining.size !== current.length) return false;
  for (const id of proposed) {
    if (typeof id !== 'string' || !remaining.delete(id)) return false;
  }
  return remaining.size === 0;
}

// A copy of `list` with the item at `index` moved by `delta` places, or the
// same order when the move would leave the list.
export function moveItem<T>(list: readonly T[], index: number, delta: number): T[] {
  const copy = list.slice();
  const target = index + delta;
  if (index < 0 || index >= copy.length || target < 0 || target >= copy.length) return copy;
  const [item] = copy.splice(index, 1);
  copy.splice(target, 0, item as T);
  return copy;
}
