<template>
  <div class="channels-page">
    <!-- DETAIL VIEW: Single Channel Profile -->
    <div v-if="channelId && channel" class="channel-detail-view">
      <!-- Back Button -->
      <button @click="goBack" class="btn btn-secondary back-btn">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
        All Channels
      </button>

      <ChannelDetailHeader @open-drawer="showDrawer = true" />
      <ChannelStatsPanel />

      <!-- Tabbed Navigation Bar -->
      <div class="channel-tabs-bar tabs-bar" style="margin-top: 12px;">
        <button
          type="button"
          class="tab-btn"
          :class="{ active: activeTab === 'archived' }"
          @click="activeTab = 'archived'"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="tab-icon"><path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.33z"></path><polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02"></polygon></svg>
          Archived Videos <span class="tab-count">{{ singleChannelData?.stats?.completedVideosCount || 0 }}</span>
        </button>
        <button
          type="button"
          class="tab-btn"
          :class="{ active: activeTab === 'shorts' }"
          @click="activeTab = 'shorts'"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="tab-icon"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect><line x1="12" y1="18" x2="12.01" y2="18"></line></svg>
          Shorts <span class="tab-count">{{ singleChannelData?.stats?.completedShortsCount || 0 }}</span>
        </button>
        <button
          type="button"
          class="tab-btn"
          :class="{ active: activeTab === 'playlists' }"
          @click="activeTab = 'playlists'; channelPlaylistsTabRef?.closePlaylist()"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="tab-icon"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
          Playlists <span class="tab-count">{{ channelPlaylistsTabRef?.channelPlaylists?.length || 0 }}</span>
        </button>
      </div>

      <ChannelVideoGrid v-show="activeTab === 'archived'" variant="videos" />
      <ChannelVideoGrid v-show="activeTab === 'shorts'" variant="shorts" />
      <div v-show="activeTab === 'playlists'">
        <ChannelPlaylistsTab ref="channelPlaylistsTabRef" />
      </div>
    </div>

    <!-- DIRECTORY VIEW: List of Channels -->
    <ChannelDirectoryView v-else />

    <ChannelSettingsDrawer v-if="channelId && channel" v-model:show-drawer="showDrawer" />
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue';
import { useChannelDetail } from '~/composables/useChannelDetail';
import ChannelDirectoryView from '~/components/channels/ChannelDirectoryView.vue';
import ChannelDetailHeader from '~/components/channels/ChannelDetailHeader.vue';
import ChannelStatsPanel from '~/components/channels/ChannelStatsPanel.vue';
import ChannelVideoGrid from '~/components/channels/ChannelVideoGrid.vue';
import ChannelPlaylistsTab from '~/components/channels/ChannelPlaylistsTab.vue';
import ChannelSettingsDrawer from '~/components/channels/ChannelSettingsDrawer.vue';

const router = useRouter();

const { channelId, channel, singleChannelData, channelVideos, refreshSingleChannel, refreshVideos } = await useChannelDetail();

const activeTab = ref('archived');
const showDrawer = ref(false);
const channelPlaylistsTabRef = ref<InstanceType<typeof ChannelPlaylistsTab> | null>(null);

watch(channelId, () => {
  activeTab.value = 'archived';
  showDrawer.value = false;
});

const goBack = () => {
  router.push({ path: '/channels' });
};

// Dynamic polling for the selected channel's videos/details
let syncStatusTimeout: any = null;

const pollStatus = async () => {
  if (channelId.value) {
    await refreshVideos();
    await refreshSingleChannel();
  }
};

const runPolling = async () => {
  await pollStatus();
  // Poll faster (every 1s) if there is an active downloading video on this channel page, else poll every 3s
  const hasActiveDownloads = channelVideos.value.some((v: any) => v.download_status === 'downloading');
  const nextPollDelay = hasActiveDownloads ? 1000 : 3000;
  syncStatusTimeout = setTimeout(runPolling, nextPollDelay);
};

onMounted(() => {
  runPolling();
});

onUnmounted(() => {
  if (syncStatusTimeout) clearTimeout(syncStatusTimeout);
});
</script>

<style>
.channels-page {
  display: flex;
  flex-direction: column;
}

.channels-page .directory-header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
  flex-wrap: wrap;
  gap: 12px;
}

.channels-page .videos-loading .spinner {
  width: 36px;
  height: 36px;
  border: 3.5px solid rgba(139, 92, 246, 0.1);
  border-radius: 50%;
  border-top-color: var(--accent-primary);
  animation: spin 0.8s linear infinite;
}

.channels-page .channel-grid {
  display: grid;
  /* min(295px, 100%) instead of a bare 295px: minmax()'s minimum is a hard
     floor, so on a content box narrower than 295px (any viewport under ~430px)
     the single column was wider than its container and pushed a horizontal
     scrollbar onto .content-area. No-op at every width where 295px fits. */
  grid-template-columns: repeat(auto-fill, minmax(min(295px, 100%), 1fr));
  gap: 24px;
}

.channels-page .channel-card {
  display: flex;
  flex-direction: column;
  border-radius: var(--border-radius-lg);
  cursor: pointer;
  border: 1px solid var(--border-color);
  background: rgba(17, 17, 34, 0.4);
  overflow: hidden;
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), border-color 0.3s ease, box-shadow 0.3s ease;
}

.channels-page .channel-card:hover {
  transform: translateY(-4px);
  border-color: rgba(139, 92, 246, 0.3);
  box-shadow: 0 12px 32px rgba(139, 92, 246, 0.15);
  background: rgba(17, 17, 34, 0.6);
}

.channels-page .channel-card-banner {
  height: 90px;
  width: 100%;
  background: linear-gradient(135deg, var(--accent-primary) 0%, var(--accent-secondary) 100%);
  background-size: cover;
  background-position: center;
  position: relative;
}

.channels-page .channel-card-banner-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.2);
}

.channels-page .channel-card-sync-badge {
  position: absolute;
  top: 8px;
  right: 8px;
  font-size: 10px;
  font-weight: 700;
  padding: 3px 8px;
  border-radius: 20px;
  text-transform: uppercase;
}

.channels-page .channel-card-sync-badge.downloading {
  background: rgba(16, 185, 129, 0.85);
  color: white;
  box-shadow: 0 2px 6px rgba(16, 185, 129, 0.4);
}

.channels-page .channel-card-sync-badge.paused {
  background: rgba(239, 68, 68, 0.85);
  color: white;
}

.channels-page .channel-card-body {
  display: flex;
  flex-direction: column;
  padding: 16px;
  position: relative;
  flex: 1;
}

.channels-page .channel-card-avatar-wrapper {
  position: absolute;
  top: -36px;
  left: 16px;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  border: 3px solid #06060c;
  overflow: hidden;
  background: var(--bg-surface);
  box-shadow: var(--shadow-sm);
  transition: transform 0.25s ease;
}

.channels-page .channel-card:hover .channel-card-avatar-wrapper {
  transform: scale(1.05);
}

.channels-page .channel-card-avatar {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.channels-page .channel-card-info {
  margin-top: 24px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
}

.channels-page .channel-card-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.channels-page .channel-card-desc {
  font-size: 12.5px;
  color: var(--text-secondary);
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}

.channels-page .channel-card-stats {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--border-color);
}

.channels-page .stat-badge {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
}

.channels-page .visibility-pill {
  font-size: 10px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 4px;
  text-transform: uppercase;
}

.channels-page .visibility-pill.public {
  background: rgba(16, 185, 129, 0.1);
  color: #34d399;
  border: 1px solid rgba(16, 185, 129, 0.2);
}

.channels-page .visibility-pill.private {
  background: rgba(239, 68, 68, 0.1);
  color: #f87171;
  border: 1px solid rgba(239, 68, 68, 0.2);
}

/* Detail View Styles */
.channels-page .channel-detail-view {
  display: flex;
  flex-direction: column;
  gap: 20px;
  max-width: 1200px;
  margin: 0 auto;
  width: 100%;
}

.channels-page .back-btn {
  align-self: flex-start;
}

.channels-page .channel-banner-container {
  height: 180px;
  width: 100%;
  border-radius: var(--border-radius-lg);
  background: linear-gradient(135deg, rgba(139, 92, 246, 0.08) 0%, rgba(18, 18, 34, 0.8) 100%);
  position: relative;
  overflow: hidden;
  box-shadow: var(--shadow-md);
}

.channels-page .banner-overlay {
  position: absolute;
  inset: 0;
  background: radial-gradient(circle at 10% 20%, rgba(0, 0, 0, 0.4) 0%, transparent 90%);
}

.channels-page .channel-profile-header {
  display: flex;
  gap: 24px;
  padding: 0 16px;
  align-items: flex-start;
}

@media (max-width: 600px) {
  .channels-page .channel-profile-header {
    flex-direction: column;
    align-items: center;
    text-align: center;
  }
}

.channels-page .channel-profile-avatar {
  width: 100px;
  height: 100px;
  border-radius: 50%;
  object-fit: cover;
  background: var(--bg-surface);
  border: 3px solid #06060c;
  box-shadow: var(--shadow-md);
}

.channels-page .channel-profile-info {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
}

.channels-page .title-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.channels-page .channel-profile-title {
  font-size: 24px;
  font-weight: 800;
}

.channels-page .channel-profile-meta {
  font-size: 13px;
  color: var(--text-secondary);
  font-weight: 500;
}

.channels-page .channel-profile-desc {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.5;
  max-width: 800px;
}

.channels-page .channel-actions-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 10px;
}

.channels-page .critical-delete-btn {
  background: #dc2626;
  color: white;
  box-shadow: 0 4px 12px rgba(220, 38, 38, 0.2);
  height: 40px;
  font-size: 13.5px;
  font-weight: 600;
  border-radius: var(--border-radius-md);
  transition: all 0.2s ease;
}

.channels-page .critical-delete-btn:hover {
  background: #b91c1c;
  transform: translateY(-1px);
}

.channels-page .pref-msg {
  font-size: 12px;
  padding: 6px 12px;
  border-radius: var(--border-radius-sm);
  align-self: flex-start;
}

/* Videos List Grid */
.channels-page .channel-videos-section {
  border-top: 1px solid var(--border-color);
  padding-top: 24px;
}

.channels-page .videos-loading {
  display: flex;
  justify-content: center;
  padding: 40px 0;
}

.channels-page .video-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  column-gap: 24px;
  row-gap: 40px;
  margin-bottom: 40px;
}

@media (max-width: 1024px) {
  .channels-page .video-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 640px) {
  .channels-page .video-grid {
    grid-template-columns: 1fr;
  }
}

.channels-page .video-card.premium-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  cursor: pointer;
}

.channels-page .video-card.premium-card .thumbnail-wrapper {
  position: relative;
  aspect-ratio: 16/9;
  border-radius: var(--border-radius-md);
  overflow: hidden;
  box-shadow: var(--shadow-sm);
  background: #000;
  border: 1px solid transparent;
  transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
}

.channels-page .video-card.premium-card .thumbnail-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.5s cubic-bezier(0.25, 1, 0.5, 1);
}

.channels-page .video-card.premium-card .thumbnail-wrapper::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 40%;
  background: linear-gradient(to top, rgba(0,0,0,0.8), transparent);
  pointer-events: none;
}

.channels-page .delete-video-btn {
  position: absolute;
  top: 6px;
  right: 6px;
  background: rgba(0, 0, 0, 0.8);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: var(--text-secondary);
  width: 26px;
  height: 26px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s;
  z-index: 3;
}

.channels-page .delete-video-btn:hover {
  background: #dc2626;
  color: white;
  transform: scale(1.1);
  box-shadow: 0 2px 8px rgba(220, 38, 38, 0.5);
}

.channels-page .video-card.premium-card .video-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px;
}

.channels-page .video-card.premium-card .video-title {
  font-family: var(--font-title);
  font-size: 14px;
  font-weight: 600;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
}

.channels-page .video-card.premium-card:hover .thumbnail-img {
  transform: scale(1.06);
}

.channels-page .drawer-body .spinner-sm {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-radius: 50%;
  border-top-color: white;
  animation: spin 0.8s linear infinite;
  display: inline-block;
}

/* Barres de tri / filtrage / batch actions */
.channels-page .videos-section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  flex-wrap: wrap;
  gap: 12px;
}

.channels-page .filter-sort-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-radius: var(--border-radius-md);
  margin-bottom: 24px;
  flex-wrap: wrap;
  gap: 16px;
}

.channels-page .search-box {
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.08);
  padding: 0 12px;
  border-radius: 40px;
  height: 36px;
  width: 260px;
  /* 260px + .filter-sort-bar's 32px padding needs a 292px content box, which a
     viewport under ~427px does not have. max-width caps it; min-width: 0
     defeats the flex item's automatic minimum size, which was otherwise
     floored by the text input's intrinsic width and blocked the shrink. */
  max-width: 100%;
  min-width: 0;
}

.channels-page .search-box svg {
  color: var(--text-secondary);
}

.channels-page .filter-input {
  background: transparent;
  border: none;
  color: var(--text-primary);
  font-size: 13px;
  width: 100%;
  /* Without this, the input's intrinsic size sets .search-box's min-content
     width and the max-width above can never actually take effect. */
  min-width: 0;
}

.channels-page .filter-input:focus {
  outline: none;
}

.channels-page .filters-group {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}

.channels-page .filter-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.channels-page .filter-item label {
  color: var(--text-secondary);
  font-weight: 500;
}

.channels-page .filter-select {
  background: rgba(0, 0, 0, 0.4);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: var(--text-primary);
  border-radius: var(--border-radius-sm);
  padding: 4px 10px;
  font-size: 13px;
  outline: none;
}

.channels-page .filter-select:focus {
  border-color: var(--accent-primary);
}

/* Visibility Quick Actions styling */
.channels-page .admin-video-actions {
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: 4;
  display: flex;
  align-items: center;
  gap: 4px;
  background: rgba(0, 0, 0, 0.85);
  padding: 4px 6px;
  border-radius: 20px;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.channels-page .action-icon-btn,
.channels-page .delete-video-btn-overlay {
  background: transparent;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  transition: all 0.2s;
}

.channels-page .action-icon-btn:hover {
  color: white;
  background: rgba(255, 255, 255, 0.1);
}

.channels-page .delete-video-btn-overlay:hover {
  color: white;
  background: #dc2626;
}

.channels-page .visibility-quick-select {
  background: transparent;
  border: none;
  color: var(--text-secondary);
  font-size: 11px;
  cursor: pointer;
  outline: none;
  font-weight: 600;
  padding-right: 4px;
}

.channels-page .visibility-quick-select option {
  background: #121212;
  color: white;
}

/* Stats Row and Cards */
.channels-page .channel-stats-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  margin-top: 16px;
  margin-bottom: 24px;
}
@media (max-width: 900px) {
  .channels-page .channel-stats-row {
    grid-template-columns: repeat(2, 1fr);
  }
}
@media (max-width: 500px) {
  .channels-page .channel-stats-row {
    grid-template-columns: 1fr;
  }
}
.channels-page .channel-stats-row .stat-card {
  background: rgba(255, 255, 255, 0.02);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.06);
  padding: 18px;
  border-radius: var(--border-radius-lg);
  display: flex;
  align-items: center;
  gap: 16px;
  transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
  box-shadow: var(--shadow-sm);
}

.channels-page .channel-stats-row .stat-card:hover {
  transform: translateY(-3px);
  background: rgba(255, 255, 255, 0.04);
  border-color: rgba(255, 255, 255, 0.12);
}

/* Individual glowing metrics on hover */
.channels-page .channel-stats-row .stat-card:nth-child(1):hover {
  box-shadow: 0 8px 24px rgba(139, 92, 246, 0.18);
  border-color: rgba(139, 92, 246, 0.3);
}
.channels-page .channel-stats-row .stat-card:nth-child(2):hover {
  box-shadow: 0 8px 24px rgba(16, 185, 129, 0.18);
  border-color: rgba(16, 185, 129, 0.3);
}
.channels-page .channel-stats-row .stat-card:nth-child(3):hover {
  box-shadow: 0 8px 24px rgba(59, 130, 246, 0.18);
  border-color: rgba(59, 130, 246, 0.3);
}
.channels-page .channel-stats-row .stat-card:nth-child(4):hover {
  box-shadow: 0 8px 24px rgba(236, 72, 153, 0.18);
  border-color: rgba(236, 72, 153, 0.3);
}

.channels-page .channel-stats-row .stat-icon {
  background: rgba(139, 92, 246, 0.1);
  border-radius: var(--border-radius-sm);
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--accent-primary);
  flex-shrink: 0;
}
.channels-page .channel-stats-row .stat-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.channels-page .channel-stats-row .stat-value {
  font-family: var(--font-title);
  font-size: 16px;
  font-weight: 800;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.channels-page .channel-stats-row .stat-label {
  font-size: 11px;
  color: var(--text-secondary);
  text-transform: uppercase;
  font-weight: 600;
  letter-spacing: 0.05em;
}

/* Redesigned Target Summary layout and micro-animations */
.channels-page .archive-targets-summary {
  margin-top: 16px;
  margin-bottom: 8px;
  padding: 20px;
  border-radius: var(--border-radius-md);
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.channels-page .summary-title {
  margin-top: 0;
  margin-bottom: 14px;
  font-size: 14px;
  font-weight: 700;
  color: white;
  display: flex;
  align-items: center;
  gap: 8px;
}

.channels-page .summary-grid-layout {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
}

.channels-page .summary-card-item {
  background: rgba(255, 255, 255, 0.01);
  padding: 12px 16px;
  border-radius: var(--border-radius-md);
  border: 1px solid rgba(255, 255, 255, 0.04);
  transition: all 0.25s ease;
}

.channels-page .summary-card-item:hover {
  background: rgba(255, 255, 255, 0.02);
  border-color: rgba(139, 92, 246, 0.15);
  transform: translateY(-1px);
}

.channels-page .summary-card-label {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-secondary);
}

.channels-page .summary-card-content {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  color: white;
}

.channels-page .flex-align-between {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

/* Tabs Bar */
.channels-page .channel-tabs-bar {
  display: flex;
  gap: 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  margin-bottom: 24px;
}

.channels-page .channel-tabs-bar .tab-count {
  background: rgba(255, 255, 255, 0.08);
  padding: 1px 6px;
  border-radius: 10px;
  font-size: 10px;
  font-weight: 700;
}

/* Status badge overlay on thumbnail */
.channels-page .queue-status-badge {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 4;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 4px 8px;
  border-radius: 4px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
}

.channels-page .sync-warning-banner {
  display: flex;
  gap: 16px;
  padding: 16px 20px;
  border-radius: var(--border-radius-md);
  border: 1px solid rgba(234, 179, 8, 0.3);
  background: rgba(234, 179, 8, 0.05);
  align-items: flex-start;
  margin-bottom: 8px;
}
.channels-page .warning-text {
  display: flex;
  flex-direction: column;
}
.channels-page .shorts-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 20px;
}
.channels-page .short-badge {
  position: absolute;
  top: 6px;
  left: 6px;
  background: #ff0000;
  color: white;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 700;
  z-index: 2;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
}
</style>
