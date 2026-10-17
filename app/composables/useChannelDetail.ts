import { useAuth } from '~/composables/useAuth';
import { useFeedSeed } from '~/composables/useFeedSeed';

export const CHANNEL_VIDEOS_PAGE_SIZE = 100;
// 50 pages of 100: past that a channel page would be unusable anyway.
export const CHANNEL_VIDEOS_MAX_PAGES = 50;

export async function fetchAllChannelVideos(channelId: string, admin: boolean, seed: number) {
  const videos: any[] = [];
  let total = 0;
  for (let page = 1; page <= CHANNEL_VIDEOS_MAX_PAGES; page++) {
    const res = await $fetch<any>('/api/videos', {
      params: {
        channelId,
        status: admin ? 'all' : undefined,
        limit: CHANNEL_VIDEOS_PAGE_SIZE,
        page,
        seed
      }
    });
    const batch = res?.videos || [];
    videos.push(...batch);
    total = res?.pagination?.total ?? videos.length;
    if (batch.length < CHANNEL_VIDEOS_PAGE_SIZE || videos.length >= total) break;
  }
  return { videos, pagination: { total } };
}

export async function useChannelDetail() {
  // Capture the Nuxt app instance before the first `await`. Vue's <script setup>
  // compiler only auto-restores the component instance context around `await`
  // expressions written directly in the calling component's own script setup —
  // it cannot see into this nested async function. Without capturing it here,
  // the second `useFetch` call below would run after the first `await` with no
  // Nuxt instance in scope and throw "composable called outside of a plugin,
  // Nuxt hook, ... or Vue setup function" (same reasoning as
  // app/composables/useAdminChannels.ts's second useFetch call).
  const nuxtApp = useNuxtApp();
  const route = useRoute();
  const channelId = ref(route.query.channelId ? String(route.query.channelId) : '');

  watch(() => route.query.channelId, (newId) => {
    // Only update if we are still on the channels page to prevent transition flash
    if (route.path === '/channels') {
      channelId.value = newId ? String(newId) : '';
    }
  });

  const { isAdmin } = useAuth();
  const seed = useFeedSeed();

  const { data: singleChannelData, error: channelError, refresh: refreshSingleChannel } = await useFetch<any>(computed(() => {
    return channelId.value ? `/api/channels/${encodeURIComponent(channelId.value)}` : '/api/channels';
  }));
  const channel = computed(() => {
    if (!channelId.value) return null;
    return singleChannelData.value?.channel || null;
  });
  // Unknown and inaccessible channels both answer 404: one "not found" state.
  const channelNotFound = computed(() => !!channelId.value && !!channelError.value);

  // Every video of the channel, fetched page by page (the API caps a page at
  // 100). Admins also see queued/failed videos (status=all); everyone else
  // gets the default (completed) view, the only one the API allows them.
  const { data: videosData, pending: videosPending, refresh: refreshVideos } = await nuxtApp.runWithContext(() =>
    useAsyncData<any>(
      computed(() => `channel-videos:${channelId.value}:${isAdmin.value ? 'all' : 'completed'}`),
      () => (channelId.value
        ? fetchAllChannelVideos(channelId.value, isAdmin.value, seed)
        : Promise.resolve({ videos: [], pagination: { total: 0 } }))
    )
  );
  const channelVideos = computed(() => {
    if (!channelId.value) return [];
    return videosData.value?.videos || [];
  });

  return {
    channelId, channel, channelNotFound, singleChannelData, refreshSingleChannel,
    videosData, videosPending, refreshVideos, channelVideos,
  };
}
