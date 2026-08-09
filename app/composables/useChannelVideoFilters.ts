export function useChannelVideoFilters() {
  const route = useRoute();
  const videoSearchQuery = useState<string>('channel_video_search_query', () => '');
  const sortBy = useState<string>('channel_video_sort_by', () => 'date_desc');

  watch(() => route.query.channelId, () => {
    // Only reset while still on the channels page, matching useChannelDetail's guard
    // against a navigation-transition flash.
    if (route.path === '/channels') {
      videoSearchQuery.value = '';
      sortBy.value = 'date_desc';
    }
  });

  return { videoSearchQuery, sortBy };
}
