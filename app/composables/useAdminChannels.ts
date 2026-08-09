export async function useAdminChannels() {
  // Capture the Nuxt app instance before the first `await`. Vue's <script setup>
  // compiler only auto-restores the component instance context around `await`
  // expressions written directly in the calling component's own script setup —
  // it cannot see into this nested async function. Without `runWithContext`,
  // the second `useFetch` call below would run after the first `await` with no
  // Nuxt instance in scope and throw "composable called outside of a plugin,
  // Nuxt hook, ... or Vue setup function".
  const nuxtApp = useNuxtApp();
  const { data: stats, refresh: refreshStats } = await useFetch<any>('/api/admin/stats');
  const { data: channelsData, refresh: refreshChannels } = await nuxtApp.runWithContext(() =>
    useFetch<{ channels: any[] }>('/api/channels')
  );
  const channels = computed(() => channelsData.value?.channels || []);

  return {
    stats, refreshStats,
    channelsData, channels, refreshChannels,
  };
}
