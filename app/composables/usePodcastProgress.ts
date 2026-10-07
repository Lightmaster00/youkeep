import { useAuth } from './useAuth';
import { useToast } from './useToast';
import { PODCAST_STATUS_MAX_IDS } from '#shared/podcastProgress';
import type { EpisodeProgress } from '#shared/podcastProgress';

interface ProgressState {
  owner: string | null;
  // null: known to be never started.
  progress: Record<string, EpisodeProgress | null>;
}

// Same batching as usePodcastFollows: every episode row asks on mount and the
// asks of one render go out as a single progress/status call.
const queued = new Set<string>();
let flushScheduled = false;
const inFlight = new Set<string>();

// Playback progress of podcast episodes for the logged-in user, cached for the
// session (dropped when the user changes). The player records the positions it
// sends so progress bars follow along; "Mark as played/unplayed" is optimistic
// with a rollback and a toast.
export function usePodcastProgress() {
  const { user } = useAuth();
  const toast = useToast();
  const state = useState<ProgressState>('podcast_progress', () => ({ owner: null, progress: {} }));

  function cache(): Record<string, EpisodeProgress | null> {
    const owner = user.value?.id ?? null;
    if (state.value.owner !== owner) state.value = { owner, progress: {} };
    return state.value.progress;
  }

  function get(episodeId: string): EpisodeProgress | null {
    return cache()[episodeId] ?? null;
  }

  function isKnown(episodeId: string): boolean {
    return episodeId in cache();
  }

  function record(episodeId: string, progress: EpisodeProgress | null) {
    if (!user.value) return;
    cache()[episodeId] = progress;
  }

  // Records progress that came with a list (Continue, Subscribed episodes).
  function seed(episodes: Array<{ id: string; progress?: EpisodeProgress | null }>) {
    if (!user.value) return;
    const c = cache();
    for (const ep of episodes) c[ep.id] = ep.progress ?? null;
  }

  async function fetchChunk(ids: string[]): Promise<void> {
    const owner = state.value.owner;
    const res = await $fetch<{ progress: Record<string, EpisodeProgress> }>('/api/podcasts/episodes/progress/status', {
      method: 'POST', body: { ids },
    });
    if (state.value.owner !== owner) return;
    const c = cache();
    for (const id of ids) {
      // A change made while the lookup was running wins.
      if (!(id in c)) c[id] = res?.progress?.[id] ?? null;
    }
  }

  async function flush() {
    flushScheduled = false;
    const ids = [...queued];
    queued.clear();
    for (let i = 0; i < ids.length; i += PODCAST_STATUS_MAX_IDS) {
      try {
        await fetchChunk(ids.slice(i, i + PODCAST_STATUS_MAX_IDS));
      } catch {
        // Unknown progress shows as none; the next render asks again.
      }
    }
  }

  function ensure(episodeIds: string[]) {
    if (!user.value) return;
    const c = cache();
    for (const id of episodeIds) {
      if (id && !(id in c)) queued.add(id);
    }
    if (queued.size > 0 && !flushScheduled) {
      flushScheduled = true;
      Promise.resolve().then(flush);
    }
  }

  // The server progress of one episode (from the cache when known). null for
  // guests, never-started episodes and failed lookups.
  async function lookup(episodeId: string): Promise<EpisodeProgress | null> {
    if (!user.value) return null;
    if (!isKnown(episodeId)) {
      try {
        await fetchChunk([episodeId]);
      } catch {
        return null;
      }
    }
    return get(episodeId);
  }

  // Returns true when saved, false when the change failed (state rolled back).
  async function setPlayed(episodeId: string, played: boolean): Promise<boolean> {
    if (!user.value || inFlight.has(episodeId)) return false;
    const c = cache();
    const had = episodeId in c;
    const previous = c[episodeId] ?? null;
    c[episodeId] = played
      ? { positionSeconds: previous?.durationSeconds ?? previous?.positionSeconds ?? 0, durationSeconds: previous?.durationSeconds ?? null, completed: true, updatedAt: Date.now() }
      : null;
    inFlight.add(episodeId);
    try {
      const res = await $fetch<{ played: boolean; progress: EpisodeProgress | null }>(
        `/api/podcasts/episodes/${encodeURIComponent(episodeId)}/played`,
        { method: 'PUT', body: { played } }
      );
      cache()[episodeId] = res?.progress ?? null;
      return true;
    } catch {
      if (had) cache()[episodeId] = previous;
      else delete cache()[episodeId];
      toast.error(played ? 'Could not mark the episode as played.' : 'Could not mark the episode as unplayed.');
      return false;
    } finally {
      inFlight.delete(episodeId);
    }
  }

  return { get, isKnown, record, seed, ensure, lookup, setPlayed };
}
