export async function useChannelDetail() {
  // The channel's videos are loaded per tab, a page at a time, by
  // useChannelVideoPages (ChannelVideoGrid). useFetch forwards the viewer's
  // cookies during SSR, so a private channel renders for whoever may see it.
  const route = useRoute();
  const channelId = ref(route.query.channelId ? String(route.query.channelId) : '');

  watch(() => route.query.channelId, (newId) => {
    // Only update if we are still on the channels page to prevent transition flash
    if (route.path === '/channels') {
      channelId.value = newId ? String(newId) : '';
    }
  });

  const { data: singleChannelData, error: channelError, refresh: refreshSingleChannel } = await useFetch<any>(computed(() => {
    return channelId.value ? `/api/channels/${encodeURIComponent(channelId.value)}` : '/api/channels';
  }));
  const channel = computed(() => {
    if (!channelId.value) return null;
    return singleChannelData.value?.channel || null;
  });
  // Unknown and inaccessible channels both answer 404: one "not found" state.
  const channelNotFound = computed(() => !!channelId.value && !!channelError.value);

  return {
    channelId, channel, channelNotFound, singleChannelData, refreshSingleChannel,
  };
}
