import { ref } from 'vue';
import { useAuth } from './useAuth';

export interface DiscoverMix {
  key: string;
  title: string;
  tracks: any[];
}

async function tracksOf(url: string, params?: Record<string, string>): Promise<any[]> {
  try {
    const data = await $fetch<{ tracks: any[] }>(url, params ? { params } : undefined);
    return data?.tracks ?? [];
  } catch {
    return [];
  }
}

async function listOf<T>(url: string, key: string, params?: Record<string, number>): Promise<T[]> {
  try {
    const data = await $fetch<any>(url, params ? { params } : undefined);
    return data?.[key] ?? [];
  } catch {
    return [];
  }
}

// The artist with the most plays among the "Most played" tracks.
export function topArtistOf(mostPlayed: any[]): { id: string; name: string } | null {
  const plays = new Map<string, { id: string; name: string; count: number }>();
  for (const t of mostPlayed) {
    if (!t?.artist_id) continue;
    const entry = plays.get(t.artist_id) ?? { id: t.artist_id, name: t.artist_name, count: 0 };
    entry.count += Number(t.play_count) || 0;
    plays.set(t.artist_id, entry);
  }
  let best: { id: string; name: string; count: number } | null = null;
  for (const entry of plays.values()) if (!best || entry.count > best.count) best = entry;
  return best ? { id: best.id, name: best.name } : null;
}

// Rows of the Music Discover page. Each row loads on its own and a failed
// one is simply empty (and so omitted). Personal rows are only asked for a
// logged-in user.
export function useMusicDiscover() {
  const { user } = useAuth();
  const mixes = ref<DiscoverMix[]>([]);
  const genres = ref<Array<{ genre: string; trackCount: number }>>([]);
  const albums = ref<any[]>([]);
  const artists = ref<any[]>([]);
  const loaded = ref(false);

  async function loadMixes() {
    const [liked, mostPlayed, rediscover] = await Promise.all([
      tracksOf('/api/music/playlists/liked-mix'),
      tracksOf('/api/music/playlists/most-played'),
      tracksOf('/api/music/playlists/rediscover'),
    ]);
    const top = topArtistOf(mostPlayed);
    const artistMix = top ? await tracksOf('/api/music/playlists/artist-mix', { artistId: top.id }) : [];
    mixes.value = [
      { key: 'liked', title: 'Mix from your liked songs', tracks: liked },
      { key: 'most-played', title: 'Most played', tracks: mostPlayed },
      { key: 'artist', title: top ? `${top.name} mix` : '', tracks: artistMix },
      { key: 'rediscover', title: 'Rediscover', tracks: rediscover },
    ].filter((m) => m.tracks.length > 0);
  }

  async function load() {
    const personal = !!user.value;
    await Promise.all([
      personal ? loadMixes() : Promise.resolve(),
      listOf<any>('/api/music/genres', 'genres').then((v) => { genres.value = v; }),
      listOf<any>('/api/music/albums/recent', 'albums', { limit: 20 }).then((v) => { albums.value = v; }),
      personal
        ? listOf<any>('/api/music/artists/explore', 'artists', { limit: 20 }).then((v) => { artists.value = v; })
        : Promise.resolve(),
    ]);
    loaded.value = true;
  }

  return { mixes, genres, albums, artists, loaded, load };
}
