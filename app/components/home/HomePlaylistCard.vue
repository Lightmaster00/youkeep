<template>
  <NuxtLink :to="`/playlists/${playlist.id}`" class="playlist-card" :data-testid="`playlist-card-${playlist.id}`">
    <MediaFrame class="playlist-card__cover" kind="video" :src="cover" :fallback="remoteCover" alt="">
      <span v-if="!cover" class="playlist-card__empty" aria-hidden="true">
        <svg xmlns="http://www.w3.org/2000/svg" width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
      </span>
      <span class="playlist-card__count">
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
        {{ countLabel }}
      </span>
    </MediaFrame>
    <span class="playlist-card__title">{{ playlist.title }}</span>
    <span class="playlist-card__meta">{{ visibilityLabel }}</span>
  </NuxtLink>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { thumbUrl, youtubeThumb } from '~/utils/thumb';

// A personal playlist on the home: the first video's thumbnail as its cover,
// with the number of videos over it.
const props = defineProps<{
  playlist: { id: string; title: string; visibility?: string; video_count: number; cover_video_id?: string | null; thumbnail_path?: string | null };
}>();

const remoteCover = computed(() => (props.playlist.cover_video_id ? youtubeThumb(props.playlist.cover_video_id) : ''));
const cover = computed(() => thumbUrl(props.playlist.thumbnail_path, 480) || remoteCover.value);
const { t } = useI18n();
const countLabel = computed(() => t('video.count', props.playlist.video_count));
const VISIBILITIES = ['private', 'public', 'unlisted'];
const visibilityLabel = computed(() => t(`home.visibility.${VISIBILITIES.includes(props.playlist.visibility ?? '') ? props.playlist.visibility : 'playlist'}`));
</script>

<style scoped>
.playlist-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: inherit;
  text-decoration: none;
  border-radius: 12px;
}
.playlist-card:focus-visible {
  outline: 2px solid var(--accent-primary);
  outline-offset: 3px;
}

.playlist-card__cover {
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.04);
  margin-bottom: 6px;
  /* A stacked edge behind the cover reads as "a collection". */
  box-shadow: 0 -5px 0 -2px rgba(139, 92, 246, 0.35);
}
.playlist-card__cover :deep(.media-frame__media) {
  transition: transform 0.5s cubic-bezier(0.25, 1, 0.5, 1);
}
.playlist-card:hover .playlist-card__cover :deep(.media-frame__media) { transform: scale(1.04); }

.playlist-card__empty {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: rgba(255, 255, 255, 0.7);
  background: linear-gradient(135deg, rgba(139, 92, 246, 0.35), rgba(236, 72, 153, 0.2));
}

.playlist-card__count {
  position: absolute;
  right: 8px;
  bottom: 8px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.8);
  color: white;
  font-size: 11.5px;
  font-weight: 600;
  z-index: 1;
}

.playlist-card__title {
  font-size: 14.5px;
  font-weight: 600;
  line-height: 1.35;
  color: var(--text-primary);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  overflow-wrap: anywhere;
}

.playlist-card__meta {
  font-size: 12px;
  color: var(--text-secondary);
}
</style>
