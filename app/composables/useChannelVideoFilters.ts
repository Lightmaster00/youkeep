// The channel page's sort lives in the URL (?sort=), so reload and Back keep
// it; the search box is session state, reset when the channel changes.
export const CHANNEL_SORTS = ['date_desc', 'date_asc', 'views_desc', 'views_asc', 'duration_desc', 'duration_asc'] as const;

export function useChannelVideoFilters() {
  const route = useRoute();
  const router = useRouter();
  const videoSearchQuery = useState<string>('channel_video_search_query', () => '');

  const sortBy = computed<string>({
    get: () => {
      const s = String(route.query.sort || '');
      return (CHANNEL_SORTS as readonly string[]).includes(s) ? s : 'date_desc';
    },
    set: (value) => {
      router.replace({ query: { ...route.query, sort: value === 'date_desc' ? undefined : value } });
    },
  });

  watch(() => route.query.channelId, () => {
    // Only reset while still on the channels page, matching useChannelDetail's guard
    // against a navigation-transition flash.
    if (route.path === '/channels') {
      videoSearchQuery.value = '';
    }
  });

  return { videoSearchQuery, sortBy };
}
