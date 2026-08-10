<template>
  <div>
    <!-- Stats Dashboard Row -->
    <div v-if="singleChannelData?.stats" class="channel-stats-row">
      <div class="stat-card">
        <div class="stat-icon">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-gradient"><path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.33z"></path><polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02"></polygon></svg>
        </div>
        <div class="stat-info">
          <span class="stat-value">{{ singleChannelData.stats.completedCount }} / {{ singleChannelData.stats.totalCount }}</span>
          <span class="stat-label">Archived Videos</span>
        </div>
      </div>

      <div class="stat-card">
        <div class="stat-icon">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-gradient"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
        </div>
        <div class="stat-info">
          <span class="stat-value">{{ formatDurationHours(singleChannelData.stats.totalDuration) }}</span>
          <span class="stat-label">Archived Duration</span>
        </div>
      </div>

      <div class="stat-card">
        <div class="stat-icon">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-gradient"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
        </div>
        <div class="stat-info">
          <span class="stat-value">{{ formatViewsShort(singleChannelData.stats.totalViews) }}</span>
          <span class="stat-label">Cumulative Views</span>
        </div>
      </div>

      <div class="stat-card">
        <div class="stat-icon">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-gradient"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="16"></line><line x1="8" y1="12" x2="16" y2="12"></line></svg>
        </div>
        <div class="stat-info">
          <span class="stat-value">{{ formatBytes(singleChannelData.stats.totalSize) }}</span>
          <span class="stat-label">Disk Space</span>
        </div>
      </div>
    </div>

    <!-- Target Archiving Status Summary Panel -->
    <div v-if="singleChannelData?.stats && channel" class="archive-targets-summary glass-panel">
      <h3 class="summary-title">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--accent-primary);"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"></path><path d="M12 16v-4"></path><path d="M12 8h.01"></path></svg>
        Channel Archiving Status Summary
      </h3>

      <div class="summary-grid-layout">
        <!-- Column 1: YouTube Content Stats -->
        <div class="summary-card-item">
          <span class="summary-card-label">Channel Content (Indexed)</span>
          <div class="summary-card-content">
            <div class="flex-align-between">
              <span>Regular videos:</span>
              <strong>{{ singleChannelData.stats.completedVideosCount + singleChannelData.stats.pendingVideosCount + singleChannelData.stats.downloadingVideosCount + singleChannelData.stats.failedVideosCount }}</strong>
            </div>
            <div class="flex-align-between">
              <span>Shorts :</span>
              <strong>{{ singleChannelData.stats.completedShortsCount + singleChannelData.stats.pendingShortsCount + singleChannelData.stats.downloadingShortsCount + singleChannelData.stats.failedShortsCount }}</strong>
            </div>
          </div>
        </div>

        <!-- Column 2: Locally Archived Stats -->
        <div class="summary-card-item">
          <span class="summary-card-label">Already Downloaded (Archived)</span>
          <div class="summary-card-content">
            <div class="flex-align-between">
              <span>Regular videos:</span>
              <strong style="color: var(--accent-primary);">{{ singleChannelData.stats.completedVideosCount }}</strong>
            </div>
            <div class="flex-align-between">
              <span>Archived shorts:</span>
              <strong style="color: var(--accent-primary);">{{ singleChannelData.stats.completedShortsCount }}</strong>
            </div>
          </div>
        </div>

        <!-- Column 3: Scheduled / Queue Stats -->
        <div class="summary-card-item">
          <span class="summary-card-label">Remaining to download</span>
          <div class="summary-card-content">
            <div class="flex-align-between">
              <span>Scheduled videos:</span>
              <strong :style="{ color: (singleChannelData.stats.pendingVideosCount + singleChannelData.stats.downloadingVideosCount) > 0 ? '#fbbf24' : 'white' }">
                {{ singleChannelData.stats.pendingVideosCount + singleChannelData.stats.downloadingVideosCount }}
              </strong>
            </div>
            <div class="flex-align-between">
              <span>Scheduled shorts:</span>
              <strong :style="{ color: (singleChannelData.stats.pendingShortsCount + singleChannelData.stats.downloadingShortsCount) > 0 ? '#fbbf24' : 'white' }">
                {{ singleChannelData.stats.pendingShortsCount + singleChannelData.stats.downloadingShortsCount }}
              </strong>
            </div>
          </div>
        </div>

        <!-- Column 4: Exclusions / Preferences Summary -->
        <div class="summary-card-item">
          <span class="summary-card-label">Active Filters & Preferences</span>
          <div class="summary-card-content">
            <div class="flex-align-between">
              <span>Regular videos:</span>
              <span class="badge" :class="channel.download_videos === 1 ? 'badge-completed' : 'badge-failed'" style="font-size: 9px; padding: 1px 4px; font-weight: 700; line-height: 1;">
                {{ channel.download_videos === 1 ? 'ACTIVE' : 'IGNORED' }}
              </span>
            </div>
            <div class="flex-align-between">
              <span>Shorts :</span>
              <span class="badge" :class="channel.download_shorts === 1 ? 'badge-completed' : 'badge-failed'" style="font-size: 9px; padding: 1px 4px; font-weight: 700; line-height: 1;">
                {{ channel.download_shorts === 1 ? 'ACTIVE' : 'IGNORED' }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useChannelDetail } from '~/composables/useChannelDetail';

const { channel, singleChannelData } = await useChannelDetail();

const formatDurationHours = (seconds: number | null): string => {
  if (!seconds) return '0h';
  const hrs = Math.ceil(seconds / 3600);
  return `${hrs}h`;
};

const formatViewsShort = (views: number | null): string => {
  if (!views) return '0';
  if (views >= 1000000) return (views / 1000000).toFixed(1).replace('.0', '') + 'M';
  if (views >= 1000) return (views / 1000).toFixed(1).replace('.0', '') + 'k';
  return views.toString();
};

const formatBytes = (bytes: number | null): string => {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};
</script>
