<template>
  <div class="liked-page">
    <MusicCollectionHeader
      :kicker="t('music.kicker.playlist')"
      :title="t('nav.likedSongs')"
      :subtitle="loaded ? countLabel : ''"
      :can-play="visible.length > 0"
      @play="playAll(visible)"
      @shuffle="shuffleAll(visible)"
    >
      <template #art>
        <svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>
      </template>
    </MusicCollectionHeader>

    <EmptyState
      v-if="loaded && visible.length === 0 && !hasMore"
      icon="music"
      :title="t('music.liked.emptyTitle')"
      :description="t('music.liked.emptyDesc')"
    />
    <MusicTrackList
      v-else
      :tracks="visible"
      :active-id="currentTrack?.id"
      @play="(track) => playFrom(track, visible)"
    />

    <div v-if="loading" class="liked-status">{{ t('common.loadingDots') }}</div>
    <div v-else-if="error" class="liked-status">
      {{ t('music.liked.loadFailed') }}
      <button class="btn btn-secondary" @click="loadMore">{{ t('common.retry') }}</button>
    </div>
    <div v-else-if="hasMore" class="liked-more">
      <button class="btn btn-secondary" @click="loadMore">{{ t('common.loadMore') }}</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';
import { useRecentList } from '~/composables/useRecentList';
import { useMusicLikes } from '~/composables/useMusicLikes';
import { usePlayTrackList } from '~/composables/usePlayTrackList';

const { t, locale } = useI18n();
useHead({ title: computed(() => t('nav.likedSongs')) });

const { items, total, loading, error, loaded, hasMore, loadMore } = useRecentList('/api/music/favorites', 'items');
const likes = useMusicLikes();
const { playAll, shuffleAll, playFrom, currentTrack } = usePlayTrackList();

// Every loaded track is liked; unliking one (here or in the player) drops it
// from the list at once.
watch(() => items.value.length, (length, previous) => {
  likes.seed(items.value.slice(previous ?? 0, length).map((t) => t.id), true);
});
const visible = computed(() => items.value.filter((t) => likes.isLiked(t.id)));

const countLabel = computed(() => {
  const count = Math.max(0, total.value - (items.value.length - visible.value.length));
  return t('music.songCount', { count: count.toLocaleString(locale.value) }, count);
});

onMounted(loadMore);
</script>

<style scoped>
.liked-status {
  padding: 40px;
  text-align: center;
  color: var(--text-secondary);
}

.liked-more {
  display: flex;
  justify-content: center;
  padding: 24px 0;
}
</style>
