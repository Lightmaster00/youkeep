import { ref } from 'vue';
import { useAuth } from './useAuth';

async function listOf(url: string, key: string, params: Record<string, string | number>): Promise<any[]> {
  try {
    const data = await $fetch<any>(url, { params });
    return data?.[key] ?? [];
  } catch {
    return [];
  }
}

const ROW_LIMIT = 20;

// Rows of the Podcasts Discover page. Each row loads on its own and a failed
// one is simply empty (and so omitted). "Because you follow" is only asked
// for a logged-in user. `setLanguage` reloads the two rows the language chips
// filter (Popular and Recently updated).
export function usePodcastDiscover() {
  const { user } = useAuth();
  const popular = ref<any[]>([]);
  const recent = ref<any[]>([]);
  const trending = ref<any[]>([]);
  const because = ref<{ basedOn: { id: string; title: string } | null; shows: any[] }>({ basedOn: null, shows: [] });
  const languages = ref<Array<{ language: string; showCount: number }>>([]);
  const language = ref('');
  const loaded = ref(false);
  const filtering = ref(false);
  let filterRequest = 0;

  async function loadFiltered() {
    const request = ++filterRequest;
    const params: Record<string, string | number> = { limit: ROW_LIMIT };
    if (language.value) params.language = language.value;
    const [p, r] = await Promise.all([
      listOf('/api/podcasts/discover/popular', 'shows', params),
      listOf('/api/podcasts/discover/recently-updated', 'shows', params),
    ]);
    // A newer choice of language wins.
    if (request !== filterRequest) return;
    popular.value = p;
    recent.value = r;
  }

  async function loadBecause() {
    try {
      const data = await $fetch<any>('/api/podcasts/discover/because-you-follow', { params: { limit: ROW_LIMIT } });
      because.value = { basedOn: data?.basedOn ?? null, shows: data?.shows ?? [] };
    } catch {
      because.value = { basedOn: null, shows: [] };
    }
  }

  async function load() {
    await Promise.all([
      loadFiltered(),
      listOf('/api/podcasts/discover/trending', 'episodes', { limit: 12 }).then((v) => { trending.value = v; }),
      user.value ? loadBecause() : Promise.resolve(),
      listOf('/api/podcasts/discover/languages', 'languages', {}).then((v) => { languages.value = v; }),
    ]);
    loaded.value = true;
  }

  async function setLanguage(value: string) {
    if (value === language.value) return;
    language.value = value;
    filtering.value = true;
    try {
      await loadFiltered();
    } finally {
      filtering.value = false;
    }
  }

  return { popular, recent, trending, because, languages, language, loaded, filtering, load, setLanguage };
}
