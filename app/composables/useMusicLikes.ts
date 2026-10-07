import { useAuth } from './useAuth';
import { useToast } from './useToast';
import { FAVORITES_STATUS_MAX_IDS } from '#shared/musicPlaylists';

interface LikesState {
  owner: string | null;
  liked: Record<string, boolean>;
}

// Ids waiting for their like state. Every like button asks on mount; the asks
// of one render (a whole list) are batched into a single favorites/status
// call on the next microtask. Client-only: buttons ask from onMounted.
const queued = new Set<string>();
let flushScheduled = false;
const inFlight = new Set<string>();

// Like state of music tracks for the logged-in user, cached for the session
// (dropped when the user changes). Toggling is optimistic: the heart flips at
// once and flips back, with a toast, if the server refuses.
export function useMusicLikes() {
  const { user } = useAuth();
  const toast = useToast();
  const state = useState<LikesState>('music_likes', () => ({ owner: null, liked: {} }));

  function cache(): Record<string, boolean> {
    const owner = user.value?.id ?? null;
    if (state.value.owner !== owner) state.value = { owner, liked: {} };
    return state.value.liked;
  }

  function isLiked(trackId: string): boolean {
    return cache()[trackId] === true;
  }

  function isKnown(trackId: string): boolean {
    return trackId in cache();
  }

  // Records states already known from elsewhere (e.g. the Liked songs list).
  function seed(trackIds: string[], liked: boolean) {
    const c = cache();
    for (const id of trackIds) c[id] = liked;
  }

  async function flush() {
    flushScheduled = false;
    const ids = [...queued];
    queued.clear();
    const owner = state.value.owner;
    for (let i = 0; i < ids.length; i += FAVORITES_STATUS_MAX_IDS) {
      const chunk = ids.slice(i, i + FAVORITES_STATUS_MAX_IDS);
      try {
        const res = await $fetch<{ liked: string[] }>('/api/music/favorites/status', { method: 'POST', body: { ids: chunk } });
        if (state.value.owner !== owner) return;
        const liked = new Set(res?.liked ?? []);
        const c = cache();
        for (const id of chunk) {
          // A toggle made while the lookup was running wins.
          if (!(id in c)) c[id] = liked.has(id);
        }
      } catch {
        // Unknown states show as "not liked"; the next render asks again.
      }
    }
  }

  function ensure(trackIds: string[]) {
    if (!user.value) return;
    const c = cache();
    for (const id of trackIds) {
      if (id && !(id in c)) queued.add(id);
    }
    if (queued.size > 0 && !flushScheduled) {
      flushScheduled = true;
      Promise.resolve().then(flush);
    }
  }

  // Returns the new state, or null when the change failed (state rolled back).
  async function toggle(trackId: string): Promise<boolean | null> {
    if (!user.value || inFlight.has(trackId)) return null;
    const was = isLiked(trackId);
    cache()[trackId] = !was;
    inFlight.add(trackId);
    try {
      await $fetch(`/api/music/favorites/${encodeURIComponent(trackId)}`, { method: was ? 'DELETE' : 'PUT' });
      return !was;
    } catch {
      cache()[trackId] = was;
      toast.error(was ? 'Could not remove the song from Liked songs.' : 'Could not add the song to Liked songs.');
      return null;
    } finally {
      inFlight.delete(trackId);
    }
  }

  return { isLiked, isKnown, seed, ensure, toggle };
}
