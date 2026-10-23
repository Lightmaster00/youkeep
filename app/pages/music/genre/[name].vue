<template>
  <div class="genre-page">
    <MusicCollectionHeader
      :kicker="t('music.kicker.genre')"
      :title="name"
      :subtitle="loaded ? countLabel : ''"
      :can-play="items.length > 0"
      @play="playAll(items)"
      @shuffle="shuffleAll(items)"
    />

    <EmptyState
      v-if="loaded && items.length === 0 && !error"
      icon="music"
      :title="t('music.genre.emptyTitle')"
      :description="t('music.genre.emptyDesc')"
    />
    <MusicTrackList
      v-else
      :tracks="items"
      :active-id="currentTrack?.id"
      @play="(track) => playFrom(track, items)"
    />

    <div v-if="loading" class="genre-status">{{ t('common.loadingDots') }}</div>
    <div v-else-if="error" class="genre-status">
      {{ t('music.recent.loadFailed') }}
      <button class="btn btn-secondary" @click="loadMore">{{ t('common.retry') }}</button>
    </div>
    <div v-else-if="hasMore" class="genre-more">
      <button class="btn btn-secondary" @click="loadMore">{{ t('common.loadMore') }}</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { useRecentList } from '~/composables/useRecentList';
import { usePlayTrackList } from '~/composables/usePlayTrackList';

// Tracks of one genre (from the Discover genre tiles), newest first. The page
// is re-created for each genre, so the list never mixes two genres.
definePageMeta({ key: (route) => route.fullPath });

const route = useRoute();
const name = computed(() => String(route.params.name ?? ''));
const { t, locale } = useI18n();
useHead({ title: computed(() => name.value || t('music.kicker.genre')) });
const { items, total, loading, error, loaded, hasMore, loadMore } = useRecentList(
  `/api/music/genres/${encodeURIComponent(name.value)}/tracks`,
  'tracks'
);
const { playAll, shuffleAll, playFrom, currentTrack } = usePlayTrackList();

const countLabel = computed(() => t('music.songCount', { count: total.value.toLocaleString(locale.value) }, total.value));

onMounted(loadMore);
</script>

<style scoped>
.genre-status {
  padding: 40px;
  text-align: center;
  color: var(--text-secondary);
}

.genre-more {
  display: flex;
  justify-content: center;
  padding: 24px 0;
}
</style>
