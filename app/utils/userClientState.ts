// Everything the browser keeps for the signed-in user. On a shared browser
// the next person must not inherit any of it: player state (episode, queue),
// search history, cached likes/follows/progress, display prefs, fetched data.
// Must run in a Nuxt context (it uses useState); useAuth wraps it in
// nuxtApp.runWithContext.

// Per-user localStorage keys. youkeep:sidebar-panel (a layout choice) and the
// feed seed (random, not personal) are kept on purpose.
export const USER_LOCAL_STORAGE_KEYS = [
  'podcast_player_state',
  'music_player_state',
  'active_mini_player_type',
  'youkeep:search-history',
];
export const USER_SESSION_STORAGE_KEYS = ['landing_applied'];
// Which user the client-side state above belongs to.
export const CLIENT_OWNER_KEY = 'youkeep:client-owner';

function stopMedia(el: HTMLMediaElement | null | undefined) {
  if (!el) return;
  try {
    el.pause();
    el.removeAttribute('src');
    el.load();
  } catch {
    // A detached or already-reset element: nothing left to stop.
  }
}

function removeKeys(storage: Storage | undefined, keys: string[]) {
  if (!storage) return;
  for (const key of keys) {
    try {
      storage.removeItem(key);
    } catch {
      // Storage blocked: nothing could have been saved either.
    }
  }
}

export function readClientOwner(): string | null {
  try {
    return window.localStorage.getItem(CLIENT_OWNER_KEY);
  } catch {
    return null;
  }
}

export function writeClientOwner(userId: string | null) {
  try {
    if (userId) window.localStorage.setItem(CLIENT_OWNER_KEY, userId);
    else window.localStorage.removeItem(CLIENT_OWNER_KEY);
  } catch {
    // Not persisted: logout still clears everything.
  }
}

export function clearUserClientState() {
  // Players: stop the audio first, then forget what was loaded.
  stopMedia(useState<HTMLMediaElement | null>('music_player_audio_el').value);
  stopMedia(useState<HTMLMediaElement | null>('podcast_player_audio_el').value);

  useState('music_player_current_track').value = null;
  useState('music_player_queue').value = [];
  useState('music_player_current_index').value = -1;
  useState('music_player_is_playing').value = false;
  useState('music_player_current_time').value = 0;
  useState('music_player_duration').value = 0;
  useState('music_player_shuffled_order').value = null;
  useState('music_player_clip_mode').value = false;
  useState('music_player_restoring').value = false;
  useState('music_player_last_played_at').value = 0;

  useState('podcast_player_current_episode').value = null;
  useState('podcast_player_is_playing').value = false;
  useState('podcast_player_current_time').value = 0;
  useState('podcast_player_duration').value = 0;
  useState('podcast_player_last_played_at').value = 0;
  useState('podcast_player_saved_at').value = 0;
  useState('podcast_player_last_sync_at').value = 0;

  useState('active_mini_player_type').value = null;

  // Per-user caches (they also reset on an owner change, but not for guests).
  useState('music_likes').value = { owner: null, liked: {} };
  useState('podcast_follows').value = { owner: null, followed: {} };
  useState('podcast_progress').value = { owner: null, progress: {} };
  // Reloaded for whoever comes next.
  useState('display_prefs_for').value = undefined;
  useState('modules_loaded').value = false;
  useState('admin_active_counts').value = null;
  useState('downloads_blocked_reason').value = null;

  // useFetch / useAsyncData results (home feed, channel lists, ...).
  clearNuxtData();

  if (typeof window !== 'undefined') {
    removeKeys(window.localStorage, USER_LOCAL_STORAGE_KEYS);
    removeKeys(window.sessionStorage, USER_SESSION_STORAGE_KEYS);
    writeClientOwner(null);
  }
}
