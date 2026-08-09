export async function useAdminChannels() {
  const { data: stats, refresh: refreshStats } = await useFetch<any>('/api/admin/stats');
  const { data: channelsData, refresh: refreshChannels } = await useFetch<{ channels: any[] }>('/api/channels');
  const channels = computed(() => channelsData.value?.channels || []);

  return {
    stats, refreshStats,
    channelsData, channels, refreshChannels,
  };
}
