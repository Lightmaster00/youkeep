<template>
  <div class="channel-videos-section">
    <!-- Filter and Sort Bar -->
    <div v-if="completedCount > 0" class="filter-sort-bar glass-panel">
      <div class="search-box">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
        <input
          type="text"
          v-model="videoSearchQuery"
          :placeholder="searchPlaceholder"
          class="filter-input"
        />
      </div>

      <div class="filters-group">
        <div class="filter-item">
          <label>{{ t('channels.sortBy') }}</label>
          <select v-model="sortBy" class="filter-select">
            <option value="date_desc">{{ t('channels.sortLatest') }}</option>
            <option value="date_asc">{{ t('channels.sortOldest') }}</option>
            <option value="views_desc">{{ t('channels.sortMostViewed') }}</option>
            <option value="views_asc">{{ t('channels.sortLeastViewed') }}</option>
            <option v-if="variant === 'videos'" value="duration_desc">{{ t('channels.sortLongest') }}</option>
            <option v-if="variant === 'videos'" value="duration_asc">{{ t('channels.sortShortest') }}</option>
          </select>
        </div>
      </div>
    </div>

    <div v-if="pending && videos.length === 0" class="videos-loading">
      <div class="spinner"></div>
    </div>

    <EmptyState
      v-else-if="displayedVideos.length === 0"
      :title="emptyTitle"
      :description="emptyDescription"
      :icon="variant === 'videos' ? 'video' : 'shorts'"
      :action-text="emptyActionText"
      @action="handleToggleSync(true)"
    />

    <div v-else :class="variant === 'videos' ? 'video-grid stagger-in' : 'shorts-grid'" :data-testid="`channel-${variant}-grid`">
      <VideoCard
        v-for="video in displayedVideos"
        :key="video.id"
        :video="video"
        :show-channel-info="false"
        @hidden="onVideoHidden"
      >
        <template #thumbnail-overlay>
          <!-- Admin Actions on Thumbnail -->
          <div v-if="isAdmin" class="admin-video-actions" @click.stop>

            <!-- Share button -->
            <button
              class="action-icon-btn"
              @click="copyShareLink(video)"
              title="Copy share link"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>
            </button>

            <!-- Visibility select -->
            <select
              :value="video.visibility || 'public'"
              @change="handleUpdateVideoVisibility(video.id, $event)"
              class="visibility-quick-select"
              title="Edit visibility"
            >
              <option value="public">🌍 Public</option>
              <option value="private">🔒 Private</option>
              <option value="ultra_private">🔑 Ultra</option>
            </select>

            <!-- Delete icon -->
            <button
              class="delete-video-btn-overlay"
              @click="handleDeleteVideo(video.id, video.title)"
              title="Delete video"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>
          </div>
        </template>
      </VideoCard>
    </div>

    <div v-if="displayedVideos.length > 0 && (hasMore || total > CHANNEL_PAGE_SIZE)" class="channel-show-more" :data-testid="`channel-${variant}-more`">
      <p class="channel-show-more-count" aria-live="polite">{{ t('channels.showing', { shown: displayedVideos.length, total }) }}</p>
      <button v-if="hasMore" type="button" class="btn btn-secondary" :disabled="loadingMore" @click="loadMore">
        {{ loadingMore ? t('common.loadingDots') : t('common.showMore') }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { confirmAction } from '~/composables/useConfirm';
import { shareVideoLink } from '~/utils/shareVideo';
import { computed, watch } from 'vue';
import { useAuth } from '~/composables/useAuth';
import { useToast } from '~/composables/useToast';
import { useChannelDetail } from '~/composables/useChannelDetail';
import { useChannelVideoFilters } from '~/composables/useChannelVideoFilters';
import { useChannelsList } from '~/composables/useChannelsList';
import { useChannelVideoPages, CHANNEL_PAGE_SIZE } from '~/composables/useChannelVideoPages';

const props = defineProps<{ variant: 'videos' | 'shorts' }>();

const { t } = useI18n();
const { isAdmin } = useAuth();
const toast = useToast();

const { channelId, refreshSingleChannel, singleChannelData } = await useChannelDetail();
const { refreshChannels } = await useChannelsList();
const { videoSearchQuery, sortBy } = useChannelVideoFilters();
// Videos hidden from another tab of this page (the playlists tab).
const hiddenIds = useState<string[]>('channel_hidden_video_ids', () => []);

const { videos, total, hasMore, pending, loadingMore, searchTerm, loadMore, reload, removeVideo } = await useChannelVideoPages({
  channelId,
  variant: props.variant,
  sort: sortBy,
  search: videoSearchQuery,
});

const completedCount = computed(() => {
  if (props.variant === 'videos') {
    return singleChannelData.value?.stats?.completedVideosCount || 0;
  }
  return singleChannelData.value?.stats?.completedShortsCount || 0;
});
const indexedCount = computed(() => singleChannelData.value?.stats?.totalCount || 0);

// A download finishing (or a delete elsewhere) changes the count: reload the
// pages already on screen, never the whole channel.
watch(completedCount, (now, before) => {
  if (import.meta.client && now !== before) reload().catch(() => {});
});

const searchPlaceholder = computed(() => props.variant === 'videos' ? t('channels.searchVideos') : t('channels.searchShorts'));

const displayedVideos = computed(() => {
  const hidden = new Set(hiddenIds.value);
  return videos.value.filter((v: any) => !hidden.has(v.id));
});

const emptyTitle = computed(() => {
  if (searchTerm.value) return t('channels.emptyNoMatch');
  if (props.variant === 'videos') {
    return indexedCount.value === 0 ? t('channels.emptyNotSynced') : t('channels.emptyNoneLocal');
  }
  return t('channels.emptyNoShorts');
});

const emptyDescription = computed(() => {
  if (searchTerm.value) return t('channels.emptyNoMatchDesc', { query: searchTerm.value });
  if (props.variant === 'videos') {
    return indexedCount.value === 0
      ? t('channels.emptyNotSyncedDesc')
      : t('channels.emptyIndexedDesc', { count: indexedCount.value });
  }
  return t('channels.emptyNoShortsDesc');
});

const emptyActionText = computed(() => {
  if (props.variant === 'videos' && !searchTerm.value && indexedCount.value === 0 && isAdmin.value) {
    return 'Start initial sync';
  }
  return undefined;
});

const onVideoHidden = (id: string) => {
  removeVideo(id);
};

const copyShareLink = async (video: any) => {
  const res = await shareVideoLink(video, isAdmin.value);
  if (!res.ok) toast.error(res.message || t('channels.shareFailed'));
  else if (res.message) toast.success(res.message);
};

const handleUpdateVideoVisibility = async (videoId: string, event: Event) => {
  const select = event.target as HTMLSelectElement;
  const visibility = select.value;
  try {
    await $fetch(`/api/admin/videos/${videoId}/visibility`, {
      method: 'PUT',
      body: { visibility }
    });
    toast.success('Video visibility updated.');
    reload().catch(() => {});
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Update failed.');
  }
};

const handleDeleteVideo = async (videoId: string, title: string) => {
  if (!(await confirmAction({ title: 'Delete video?', message: `Permanently delete the video "${title}"? The local file will be deleted.`, confirmLabel: 'Delete video' }))) {
    return;
  }

  try {
    await $fetch(`/api/admin/videos/${videoId}`, { method: 'DELETE' });
    toast.success('Video deleted.');
    removeVideo(videoId);
    refreshSingleChannel();
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Deletion failed.');
  }
};

const handleToggleSync = async (start: boolean) => {
  const endpoint = start ? 'sync' : 'pause';
  try {
    await $fetch(`/api/admin/channels/${channelId.value}/${endpoint}`, { method: 'POST' });
    toast.success(start ? 'Synchronization started.' : 'Synchronization paused.');
    refreshSingleChannel();
    refreshChannels();
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Action failed.');
  }
};
</script>

<style scoped>
.channel-show-more {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  margin: 24px 0 8px;
}
.channel-show-more-count {
  margin: 0;
  font-size: 13px;
  color: var(--text-secondary);
}
</style>
