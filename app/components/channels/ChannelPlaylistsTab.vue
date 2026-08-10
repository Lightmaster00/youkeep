<template>
  <div class="channel-videos-section">
    <!-- Playlist List View -->
    <template v-if="!selectedPlaylistId">
      <div class="videos-section-header" style="display: flex; align-items: center; justify-content: space-between;">
        <h2 class="section-title">Playlists</h2>
        <button
          @click="handleSyncPlaylists"
          class="btn btn-secondary btn-sm"
          :disabled="syncingPlaylists"
        >
          {{ syncingPlaylists ? 'Syncing...' : 'Sync Playlists' }}
        </button>
      </div>

      <div v-if="playlistsPending" class="videos-loading">
        <div class="spinner"></div>
      </div>

      <EmptyState
        v-else-if="channelPlaylists.length === 0"
        title="No playlists found"
        description="No public playlists are listed for this channel. Click 'Sync Playlists' above to scan for public playlists."
        icon="folder"
      />

      <div v-else class="video-grid" style="grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));">
        <div
          v-for="playlist in channelPlaylists"
          :key="playlist.id"
          class="video-card premium-card"
          @click="openPlaylist(playlist.id)"
          style="cursor: pointer;"
        >
          <div class="thumbnail-wrapper" style="position: relative;">
            <!-- Overlay to make it look like a playlist card -->
            <div style="position: absolute; right: 0; top: 0; bottom: 0; width: 40%; background: rgba(0, 0, 0, 0.7); backdrop-filter: blur(2px); z-index: 2; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; border-top-right-radius: inherit; border-bottom-right-radius: inherit;">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: white;"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
              <span style="font-size: 12px; font-weight: 700; color: white;">{{ playlist.video_count }}</span>
            </div>
            <img
              :src="playlist.thumbnail_url || 'data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 16 9\' fill=\'%23111\'><rect width=\'16\' height=\'9\' fill=\'%23111\'/></svg>'"
              class="thumbnail-img"
              alt="Playlist Thumbnail"
              style="aspect-ratio: 16/9; object-fit: cover;"
            />
          </div>
          <div class="video-info" style="padding: 10px; display: flex; flex-direction: column; flex: 1;">
            <h4 class="video-title" style="font-size: 14px; font-weight: 600; line-height: 1.4; color: white; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">
              {{ playlist.title }}
            </h4>
            <p v-if="playlist.description" style="font-size: 12px; color: var(--text-secondary); margin-top: 6px; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">
              {{ playlist.description }}
            </p>
          </div>
        </div>
      </div>
    </template>

    <!-- Playlist Detail View -->
    <template v-else>
      <div class="videos-section-header" style="display: flex; align-items: center; gap: 12px;">
        <button @click="closePlaylist" class="btn btn-secondary btn-sm" style="display: inline-flex; align-items: center; gap: 6px;">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
          Back to playlists
        </button>
        <h2 class="section-title" style="margin-left: 8px;">{{ selectedPlaylistData?.playlist?.title }}</h2>
      </div>

      <div v-if="loadingPlaylistDetail" class="videos-loading">
        <div class="spinner"></div>
      </div>

      <EmptyState
        v-else-if="!selectedPlaylistData?.videos?.length"
        title="Empty playlist"
        description="This playlist does not contain any videos."
        icon="video"
      />

      <div v-else class="video-grid">
        <VideoCard
          v-for="video in selectedPlaylistData.videos"
          :key="video.id"
          :video="video"
          :show-channel-info="false"
          :clickable="video.download_status === 'completed'"
          :to="`/watch/${video.id}?playlistId=${selectedPlaylistId}`"
          @hidden="onVideoHidden"
        >
          <template #thumbnail-overlay>
            <span class="badge queue-status-badge" :class="getBadgeClass(video.download_status)" style="top: 8px; right: 8px;">
              {{ formatStatus(video.download_status) }}
            </span>
            <span class="badge" style="position: absolute; bottom: 8px; left: 8px; background: rgba(0, 0, 0, 0.7); font-size: 11px; padding: 2px 6px; border-radius: 4px; font-weight: 700; z-index: 2;">
              #{{ video.position }}
            </span>
          </template>
        </VideoCard>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue';
import { useToast } from '~/composables/useToast';
import { useChannelDetail } from '~/composables/useChannelDetail';

const toast = useToast();

const { channelId, videosData } = await useChannelDetail();

const { data: playlistsData, pending: playlistsPending, refresh: refreshPlaylists } = await useFetch<any>(computed(() => {
  return channelId.value ? `/api/channels/${channelId.value}/playlists` : '/api/channels';
}));
const channelPlaylists = computed(() => {
  if (!channelId.value) return [];
  return playlistsData.value?.playlists || [];
});

const selectedPlaylistId = ref('');
const selectedPlaylistData = ref<any>(null);
const loadingPlaylistDetail = ref(false);
const syncingPlaylists = ref(false);

const openPlaylist = async (playlistId: string) => {
  selectedPlaylistId.value = playlistId;
  loadingPlaylistDetail.value = true;
  try {
    selectedPlaylistData.value = await $fetch(`/api/playlists/${playlistId}`);
  } catch (err) {
    toast.error('Failed to load playlist details.');
  } finally {
    loadingPlaylistDetail.value = false;
  }
};

const closePlaylist = () => {
  selectedPlaylistId.value = '';
  selectedPlaylistData.value = null;
};

watch(channelId, () => {
  closePlaylist();
});

let syncPlaylistsRefreshTimer: ReturnType<typeof setTimeout> | null = null;

async function handleSyncPlaylists() {
  if (!channelId.value) return;
  syncingPlaylists.value = true;
  try {
    const res = await $fetch<any>(`/api/admin/channels/${channelId.value}/sync-playlists`, {
      method: 'POST'
    });
    toast.success(res.message || 'Playlist sync started.');
    // The sync runs in the background on the server; give it a moment before refreshing.
    syncPlaylistsRefreshTimer = setTimeout(() => {
      syncPlaylistsRefreshTimer = null;
      refreshPlaylists();
    }, 5000);
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Failed to start playlist sync.');
  } finally {
    syncingPlaylists.value = false;
  }
}

onUnmounted(() => {
  if (syncPlaylistsRefreshTimer) {
    clearTimeout(syncPlaylistsRefreshTimer);
    syncPlaylistsRefreshTimer = null;
  }
});

const onVideoHidden = (id: string) => {
  if (selectedPlaylistData.value && selectedPlaylistData.value.videos) {
    selectedPlaylistData.value.videos = selectedPlaylistData.value.videos.filter((v: any) => v.id !== id);
  }
  if (videosData.value && videosData.value.videos) {
    videosData.value.videos = videosData.value.videos.filter((v: any) => v.id !== id);
  }
};

const formatStatus = (status: string): string => {
  switch (status) {
    case 'pending': return 'Pending';
    case 'downloading': return 'Downloading';
    case 'completed': return 'Completed';
    case 'failed': return 'Failed';
    default: return status;
  }
};

const getBadgeClass = (status: string): string => {
  switch (status) {
    case 'pending': return 'badge-pending';
    case 'downloading': return 'badge-downloading';
    case 'completed': return 'badge-completed';
    case 'failed': return 'badge-failed';
    default: return '';
  }
};

defineExpose({ channelPlaylists, closePlaylist });
</script>
