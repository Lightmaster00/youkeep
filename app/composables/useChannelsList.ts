export async function useChannelsList() {
  const { data: channelsData, pending, refresh: refreshChannels } = await useFetch<{ channels: any[] }>('/api/channels');
  const channels = computed(() => channelsData.value?.channels || []);

  return {
    channelsData, channels, pending, refreshChannels,
  };
}
