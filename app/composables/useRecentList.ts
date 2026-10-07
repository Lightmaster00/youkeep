import { ref, computed } from 'vue';

const PAGE_SIZE = 30;

// "Load more" paging over /api/music/playlists/recently-added (key 'tracks')
// or /api/podcasts/episodes/recent (key 'episodes'): both return the page under
// `key` plus the `total` count. A failed page keeps what was already loaded.
export function useRecentList(url: string, key: 'tracks' | 'episodes') {
  const items = ref<any[]>([]);
  const total = ref(0);
  const loading = ref(false);
  const error = ref(false);
  const loaded = ref(false);
  const hasMore = computed(() => items.value.length < total.value);

  async function loadMore() {
    if (loading.value) return;
    loading.value = true;
    error.value = false;
    try {
      const data = await $fetch<any>(url, { params: { limit: PAGE_SIZE, offset: items.value.length } });
      items.value.push(...(data?.[key] || []));
      total.value = data?.total || 0;
      loaded.value = true;
    } catch {
      error.value = true;
    } finally {
      loading.value = false;
    }
  }

  return { items, total, loading, error, loaded, hasMore, loadMore };
}
