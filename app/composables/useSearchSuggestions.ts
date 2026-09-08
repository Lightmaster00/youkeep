import { ref } from 'vue';

export interface Suggestion {
  type: 'video' | 'track' | 'episode';
  title: string;
  subtitle: string;
}

type SpaceId = 'video' | 'music' | 'podcasts';
type SearchMode = 'per_space' | 'global';

const DEBOUNCE_MS = 250;

function normalizeVideo(v: any): Suggestion {
  return { type: 'video', title: v.title, subtitle: v.channel_title || '' };
}
function normalizeTrack(t: any): Suggestion {
  return { type: 'track', title: t.title, subtitle: t.artist_name || '' };
}
function normalizeEpisode(e: any): Suggestion {
  return { type: 'episode', title: e.title, subtitle: e.show_title || '' };
}

async function fetchVideos(term: string, limit: number): Promise<Suggestion[]> {
  const data = await $fetch<{ videos: any[] }>('/api/videos', { params: { q: term, limit } });
  return (data.videos || []).map(normalizeVideo);
}
async function fetchTracks(term: string, limit: number): Promise<Suggestion[]> {
  const data = await $fetch<{ tracks: any[] }>('/api/music/tracks/search', { params: { q: term, limit } });
  return (data.tracks || []).map(normalizeTrack);
}
async function fetchEpisodes(term: string, limit: number): Promise<Suggestion[]> {
  const data = await $fetch<{ episodes: any[] }>('/api/podcasts/episodes/search', { params: { q: term, limit } });
  return (data.episodes || []).map(normalizeEpisode);
}

export function useSearchSuggestions() {
  const suggestions = ref<Suggestion[]>([]);
  const loading = ref(false);
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let requestId = 0;

  async function runFetch(term: string, mode: SearchMode, activeSpaceId: SpaceId) {
    const thisRequestId = ++requestId;
    loading.value = true;
    try {
      let results: Suggestion[];
      if (mode === 'global') {
        const [videos, tracks, episodes] = await Promise.all([
          fetchVideos(term, 3),
          fetchTracks(term, 3),
          fetchEpisodes(term, 3),
        ]);
        results = [...videos, ...tracks, ...episodes];
      } else if (activeSpaceId === 'music') {
        results = await fetchTracks(term, 5);
      } else if (activeSpaceId === 'podcasts') {
        results = await fetchEpisodes(term, 5);
      } else {
        results = await fetchVideos(term, 5);
      }
      if (thisRequestId !== requestId) return;
      suggestions.value = results;
    } catch (e) {
      if (thisRequestId !== requestId) return;
      suggestions.value = [];
    } finally {
      if (thisRequestId === requestId) loading.value = false;
    }
  }

  function fetchSuggestions(term: string, mode: SearchMode, activeSpaceId: SpaceId) {
    if (debounceTimer) clearTimeout(debounceTimer);
    const trimmed = term.trim();
    if (trimmed.length < 2) {
      requestId++;
      suggestions.value = [];
      loading.value = false;
      return;
    }
    debounceTimer = setTimeout(() => runFetch(trimmed, mode, activeSpaceId), DEBOUNCE_MS);
  }

  return { suggestions, loading, fetchSuggestions };
}
