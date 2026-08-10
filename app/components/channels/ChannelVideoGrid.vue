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
          <label>Sort by:</label>
          <select v-model="sortBy" class="filter-select">
            <option value="date_desc">Latest</option>
            <option value="date_asc">Oldest</option>
            <option value="views_desc">Most viewed</option>
            <option value="views_asc">Least viewed</option>
            <option v-if="variant === 'videos'" value="duration_desc">Longest</option>
            <option v-if="variant === 'videos'" value="duration_asc">Shortest</option>
          </select>
        </div>
      </div>
    </div>

    <div v-if="videosPending && isInitialLoad" class="videos-loading">
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

    <div v-else :class="variant === 'videos' ? 'video-grid stagger-in' : 'shorts-grid'">
      <VideoCard
        v-for="video in displayedVideos"
        :key="video.id"
        :video="video"
        :show-channel-info="false"
        @hidden="onVideoHidden"
      >
        <template #thumbnail-overlay>
          <span v-if="variant === 'shorts'" class="short-badge">Short</span>

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
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useAuth } from '~/composables/useAuth';
import { useToast } from '~/composables/useToast';
import { useChannelDetail } from '~/composables/useChannelDetail';
import { useChannelVideoFilters } from '~/composables/useChannelVideoFilters';
import { useChannelsList } from '~/composables/useChannelsList';

const props = defineProps<{ variant: 'videos' | 'shorts' }>();

const { isAdmin } = useAuth();
const toast = useToast();

const { channelId, channelVideos, videosData, videosPending, refreshVideos, refreshSingleChannel, singleChannelData } = await useChannelDetail();
const { refreshChannels } = await useChannelsList();
const { videoSearchQuery, sortBy } = useChannelVideoFilters();

const isInitialLoad = ref(true);

watch(channelId, () => {
  isInitialLoad.value = true;
});

watch(videosPending, (newVal) => {
  if (!newVal) {
    isInitialLoad.value = false;
  }
});

const completedCount = computed(() => {
  if (props.variant === 'videos') {
    return singleChannelData.value?.stats?.completedVideosCount || 0;
  }
  return singleChannelData.value?.stats?.completedShortsCount || 0;
});

const searchPlaceholder = computed(() => props.variant === 'videos' ? 'Search archived video...' : 'Search Short...');

const filteredVideos = computed(() => {
  let vids = [...channelVideos.value];

  // 1. Filter by search query
  if (videoSearchQuery.value.trim()) {
    const query = videoSearchQuery.value.toLowerCase().trim();
    vids = vids.filter(v => v.title && v.title.toLowerCase().includes(query));
  }

  // 2. Sort
  vids.sort((a, b) => {
    if (sortBy.value === 'date_desc') {
      return (b.upload_date || '').localeCompare(a.upload_date || '');
    } else if (sortBy.value === 'date_asc') {
      return (a.upload_date || '').localeCompare(b.upload_date || '');
    } else if (sortBy.value === 'views_desc') {
      return (b.view_count || 0) - (a.view_count || 0);
    } else if (sortBy.value === 'views_asc') {
      return (a.view_count || 0) - (b.view_count || 0);
    } else if (sortBy.value === 'duration_desc') {
      return (b.duration || 0) - (a.duration || 0);
    } else if (sortBy.value === 'duration_asc') {
      return (a.duration || 0) - (b.duration || 0);
    }
    return 0;
  });

  return vids;
});

const displayedVideos = computed(() => {
  if (props.variant === 'videos') {
    return filteredVideos.value.filter((v: any) => v.download_status === 'completed' && v.is_short !== 1);
  }
  return filteredVideos.value.filter((v: any) => v.download_status === 'completed' && v.is_short === 1);
});

const emptyTitle = computed(() => {
  if (props.variant === 'videos') {
    return channelVideos.value.length === 0 ? 'Channel not synchronized' : 'No videos archived locally';
  }
  return 'No Shorts archived';
});

const emptyDescription = computed(() => {
  if (props.variant === 'videos') {
    return channelVideos.value.length === 0
      ? 'No videos have been indexed for this channel yet. You need to start a sync to fetch available videos from YouTube.'
      : `There are currently ${channelVideos.value.length} videos indexed in our database, but none have been successfully downloaded yet.`;
  }
  return 'No Shorts have been downloaded for this channel yet. Make sure the Shorts archiving option is enabled in the channel settings.';
});

const emptyActionText = computed(() => {
  if (props.variant === 'videos' && channelVideos.value.length === 0 && isAdmin.value) {
    return 'Start initial sync';
  }
  return undefined;
});

const onVideoHidden = (id: string) => {
  if (videosData.value && videosData.value.videos) {
    videosData.value.videos = videosData.value.videos.filter((v: any) => v.id !== id);
  }
};

const copyShareLink = (video: any) => {
  let shareUrl = window.location.origin + '/watch/' + video.id;
  if (video.visibility !== 'public' && video.share_token) {
    shareUrl += '?token=' + video.share_token;
  }

  navigator.clipboard.writeText(shareUrl);
  toast.success('Share link copied.');
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
    refreshVideos();
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Update failed.');
  }
};

const handleDeleteVideo = async (videoId: string, title: string) => {
  if (!confirm(`Permanently delete the video "${title}"?\nThe local file will be deleted.`)) {
    return;
  }

  try {
    await $fetch(`/api/admin/videos/${videoId}`, { method: 'DELETE' });
    toast.success('Video deleted.');
    refreshVideos();
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
