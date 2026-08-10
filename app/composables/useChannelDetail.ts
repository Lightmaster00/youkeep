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

  const { data: singleChannelData, refresh: refreshSingleChannel } = await useFetch<any>(computed(() => {
    return channelId.value ? `/api/channels/${channelId.value}` : '/api/channels';
  }));
  const channel = computed(() => {
    if (!channelId.value) return null;
    return singleChannelData.value?.channel || null;
  });

  const { data: videosData, pending: videosPending, refresh: refreshVideos } = await nuxtApp.runWithContext(() =>
    useFetch<any>(computed(() => {
      return channelId.value ? `/api/videos?channelId=${channelId.value}&status=all&limit=200` : '/api/videos?limit=1';
    }))
  );
  const channelVideos = computed(() => {
    if (!channelId.value) return [];
    return videosData.value?.videos || [];
  });

  return {
    channelId, channel, singleChannelData, refreshSingleChannel,
    videosData, videosPending, refreshVideos, channelVideos,
  };
}
