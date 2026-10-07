import { useAuth } from './useAuth';
import { useToast } from './useToast';
import { PODCAST_STATUS_MAX_IDS } from '#shared/podcastProgress';

interface FollowsState {
  owner: string | null;
  followed: Record<string, boolean>;
}

// Ids waiting for their follow state. Every follow button asks on mount; the
// asks of one render (a whole grid) are batched into a single follows/status
// call on the next microtask. Client-only: buttons ask from onMounted.
const queued = new Set<string>();
let flushScheduled = false;
const inFlight = new Set<string>();

// Followed podcast shows of the logged-in user, cached for the session
// (dropped when the user changes). Toggling is optimistic: the button flips at
// once and flips back, with a toast, if the server refuses.
export function usePodcastFollows() {
  const { user } = useAuth();
  const toast = useToast();
  const state = useState<FollowsState>('podcast_follows', () => ({ owner: null, followed: {} }));

  function cache(): Record<string, boolean> {
    const owner = user.value?.id ?? null;
    if (state.value.owner !== owner) state.value = { owner, followed: {} };
    return state.value.followed;
  }

  function isFollowed(showId: string): boolean {
    return cache()[showId] === true;
  }

  // Records states already known from elsewhere (e.g. the Subscribed page).
  function seed(showIds: string[], followed: boolean) {
    const c = cache();
    for (const id of showIds) c[id] = followed;
  }

  async function flush() {
    flushScheduled = false;
    const ids = [...queued];
    queued.clear();
    const owner = state.value.owner;
    for (let i = 0; i < ids.length; i += PODCAST_STATUS_MAX_IDS) {
      const chunk = ids.slice(i, i + PODCAST_STATUS_MAX_IDS);
      try {
        const res = await $fetch<{ followed: string[] }>('/api/podcasts/follows/status', { method: 'POST', body: { ids: chunk } });
        if (state.value.owner !== owner) return;
        const followed = new Set(res?.followed ?? []);
        const c = cache();
        for (const id of chunk) {
          // A toggle made while the lookup was running wins.
          if (!(id in c)) c[id] = followed.has(id);
        }
      } catch {
        // Unknown states show as "not followed"; the next render asks again.
      }
    }
  }

  function ensure(showIds: string[]) {
    if (!user.value) return;
    const c = cache();
    for (const id of showIds) {
      if (id && !(id in c)) queued.add(id);
    }
    if (queued.size > 0 && !flushScheduled) {
      flushScheduled = true;
      Promise.resolve().then(flush);
    }
  }

  // Returns the new state, or null when the change failed (state rolled back).
  async function toggle(showId: string): Promise<boolean | null> {
    if (!user.value || inFlight.has(showId)) return null;
    const was = isFollowed(showId);
    cache()[showId] = !was;
    inFlight.add(showId);
    try {
      await $fetch(`/api/podcasts/shows/${encodeURIComponent(showId)}/follow`, { method: was ? 'DELETE' : 'PUT' });
      return !was;
    } catch {
      cache()[showId] = was;
      toast.error(was ? 'Could not unfollow the show.' : 'Could not follow the show.');
      return null;
    } finally {
      inFlight.delete(showId);
    }
  }

  return { isFollowed, seed, ensure, toggle };
}
