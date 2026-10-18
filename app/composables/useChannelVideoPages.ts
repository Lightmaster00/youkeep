import { ref, computed, watch, type Ref } from 'vue';

// One tab of a channel page (its videos or its Shorts), loaded a page at a
// time: the first page renders fast (server-side too, with the viewer's
// cookies), further pages come with "Show more". Sorting and searching
// happen on the server, so they stay right however much is loaded.
export const CHANNEL_PAGE_SIZE = 60;
// The API caps one request at 100 videos.
const MAX_REQUEST = 100;

export interface ChannelVideoPage {
  videos: any[];
  total: number;
}

export async function useChannelVideoPages(opts: {
  channelId: Ref<string>;
  variant: 'videos' | 'shorts';
  sort: Ref<string>;
  search: Ref<string>;
}) {
  const requestFetch = useRequestFetch();
  const loadingMore = ref(false);

  // The search box is debounced before it reaches the request key.
  const searchTerm = ref(opts.search.value.trim());
  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  watch(opts.search, (value) => {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      searchTimer = null;
      searchTerm.value = value.trim();
    }, 300);
  });

  const params = (offset: number, limit: number) => ({
    channelId: opts.channelId.value,
    is_short: opts.variant === 'shorts' ? 1 : 0,
    sort: opts.sort.value || 'date_desc',
    q: searchTerm.value || undefined,
    limit,
    offset,
  });

  const key = computed(() => `channel-${opts.variant}:${opts.channelId.value}:${opts.sort.value}:${searchTerm.value}`);

  const { data, pending, error } = await useAsyncData<ChannelVideoPage>(
    key,
    async () => {
      if (!opts.channelId.value) return { videos: [], total: 0 };
      const res = await requestFetch<any>('/api/videos', { params: params(0, CHANNEL_PAGE_SIZE) });
      return { videos: res?.videos || [], total: res?.pagination?.total ?? 0 };
    },
  );

  const videos = computed(() => data.value?.videos || []);
  const total = computed(() => data.value?.total || 0);
  const hasMore = computed(() => videos.value.length < total.value);

  function merge(into: any[], batch: any[]) {
    const seen = new Set(into.map((v) => v.id));
    for (const v of batch) if (!seen.has(v.id)) into.push(v);
    return into;
  }

  async function loadMore() {
    if (loadingMore.value || !hasMore.value || !data.value) return;
    loadingMore.value = true;
    const forKey = key.value;
    try {
      const res = await $fetch<any>('/api/videos', { params: params(videos.value.length, CHANNEL_PAGE_SIZE) });
      if (forKey !== key.value || !data.value) return;
      data.value = {
        videos: merge([...data.value.videos], res?.videos || []),
        total: res?.pagination?.total ?? data.value.total,
      };
    } finally {
      loadingMore.value = false;
    }
  }

  // Reload what is on screen (after a download finished, a delete, ...):
  // as many videos as are loaded now, at most 100 per request.
  async function reload() {
    if (!opts.channelId.value) return;
    const forKey = key.value;
    const want = Math.max(CHANNEL_PAGE_SIZE, videos.value.length);
    const next: any[] = [];
    let latestTotal = total.value;
    while (next.length < want) {
      const res = await $fetch<any>('/api/videos', { params: params(next.length, Math.min(MAX_REQUEST, want - next.length)) });
      const batch = res?.videos || [];
      latestTotal = res?.pagination?.total ?? latestTotal;
      merge(next, batch);
      if (batch.length === 0 || next.length >= latestTotal) break;
    }
    if (forKey !== key.value) return;
    data.value = { videos: next, total: latestTotal };
  }

  function removeVideo(id: string) {
    if (!data.value) return;
    const before = data.value.videos.length;
    const videosLeft = data.value.videos.filter((v) => v.id !== id);
    data.value = { videos: videosLeft, total: Math.max(0, data.value.total - (before - videosLeft.length)) };
  }

  return { videos, total, hasMore, pending, error, loadingMore, searchTerm, loadMore, reload, removeVideo };
}
