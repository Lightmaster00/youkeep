<template>
  <div class="tab-pane">
    <OverviewActivityCard />
    <!-- Premium Welcome & Summary Banner -->
    <div class="dashboard-banner glass-panel">
      <div class="banner-content">
        <span class="system-status-badge">
          <span class="pulse-dot"></span>
          Running
        </span>
        <h2>Overview</h2>
        <p>What your library holds and how much space it uses.</p>
      </div>
      <div class="banner-quick-stats">
        <div class="quick-stat-item">
          <span class="stat-number text-gradient">{{ formatViews(stats?.totalViews || 0) }}</span>
          <span class="stat-label">YouTube views</span>
        </div>
        <div class="quick-stat-divider"></div>
        <div class="quick-stat-item">
          <span class="stat-number">{{ stats?.totalComments?.toLocaleString() || 0 }}</span>
          <span class="stat-label">Comments saved</span>
        </div>
        <div class="quick-stat-divider"></div>
        <div class="quick-stat-item">
          <span class="stat-number" :class="{ 'settings-text-accent': (stats?.totalQueue || 0) > 0 }">{{ stats?.totalQueue || 0 }}</span>
          <span class="stat-label">Videos queued</span>
        </div>
      </div>
    </div>

    <!-- Quick Metrics Grid -->
    <div class="metrics-grid">
      <!-- Archived Videos Card -->
      <div class="metric-card glass-panel glow-purple">
        <div class="metric-card-header">
          <span class="metric-label">Videos</span>
          <div class="metric-icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 7l-7 5 7 5V7z"></path><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect></svg>
          </div>
        </div>
        <span class="metric-value">{{ stats?.totalVideos?.toLocaleString() || 0 }}</span>
        <div class="metric-sub">Downloaded and ready to watch</div>
      </div>

      <!-- Media Disk Space Card -->
      <div class="metric-card glass-panel glow-blue">
        <div class="metric-card-header">
          <span class="metric-label">Disk space</span>
          <div class="metric-icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect><rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect><line x1="6" y1="6" x2="6.01" y2="6"></line><line x1="6" y1="18" x2="6.01" y2="18"></line></svg>
          </div>
        </div>
        <span class="metric-value text-gradient">{{ formatBytes(stats?.mediaSize || 0) }}</span>
        <div class="metric-sub">Used by video files and thumbnails</div>
      </div>

      <!-- Archived Duration Card -->
      <div class="metric-card glass-panel glow-green">
        <div class="metric-card-header">
          <span class="metric-label">Total duration</span>
          <div class="metric-icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
          </div>
        </div>
        <span class="metric-value">{{ formatSecondsToHours(stats?.totalDuration || 0) }}</span>
        <div class="metric-sub">Of all downloaded videos</div>
      </div>

      <!-- SQLite Database Card -->
      <div class="metric-card glass-panel glow-pink">
        <div class="metric-card-header">
          <span class="metric-label">Database</span>
          <div class="metric-icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"></ellipse><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path><path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3"></path></svg>
          </div>
        </div>
        <span class="metric-value">{{ formatBytes(stats?.dbSize || 0) }}</span>
        <div class="metric-sub">Titles, descriptions and search index</div>
      </div>
    </div>

    <!-- Graphs & Storage Breakdown Row -->
    <div class="stats-row">
      <!-- Channels breakdown (Left Column) -->
      <div class="stats-col glass-panel">
        <div class="col-header">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--accent-primary);"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
          <h3>Top channels</h3>
        </div>
        <div v-if="channels.length === 0" class="stats-empty">
          No channels yet. Follow a channel in Library to see it here.
        </div>
        <div v-else class="stats-list">
          <div
            v-for="ch in sortedChannels"
            :key="ch.id"
            class="stats-list-item"
          >
            <div class="stats-item-info">
              <div class="stats-item-title-col">
                <span class="item-title" :title="ch.title">{{ ch.title }}</span>
                <span v-if="ch.visibility" :class="['visibility-tag mini-tag', ch.visibility]">{{ ch.visibility }}</span>
              </div>
              <span class="item-count">{{ ch.completed_count }} of {{ ch.total_count }} videos downloaded</span>
            </div>
            <!-- Progress Bar -->
            <div class="stats-item-bar-bg">
              <div
                class="stats-item-bar"
                :style="{ width: getPercentage(ch.completed_count, ch.total_count) + '%' }"
              ></div>
            </div>
          </div>
        </div>
      </div>

      <!-- Diagnostics & Storage Breakdown (Right Column) -->
      <div class="stats-col glass-panel diagnostic-panel">
        <div class="col-header">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--accent-secondary);"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
          <h3>Details</h3>
        </div>

        <div class="diagnostic-list">
          <div class="diag-item">
            <div class="diag-label">Channels followed</div>
            <div class="diag-value font-highlight">{{ stats?.totalChannels || 0 }} channels</div>
          </div>

          <div class="diag-item">
            <div class="diag-label">YouTube views of your videos</div>
            <div class="diag-value">{{ formatViews(stats?.totalViews || 0) }} views</div>
          </div>

          <div class="diag-item">
            <div class="diag-label">Comments saved</div>
            <div class="diag-value">{{ stats?.totalComments?.toLocaleString() || 0 }} comments</div>
          </div>

          <div class="diag-item">
            <div class="diag-label">Videos waiting to download</div>
            <div class="diag-value" :class="{ 'warning-highlight': (stats?.totalQueue || 0) > 0 }">
              {{ stats?.totalQueue || 0 }} queued
            </div>
          </div>

          <div class="diag-item">
            <div class="diag-label">Database engine</div>
            <div class="diag-value">better-sqlite3 v9.x</div>
          </div>
        </div>

        <div class="diagnostic-check">
          <div class="check-radar">
            <span class="radar-dot"></span>
            <span class="radar-ring"></span>
          </div>
          <div class="check-text">
            <h4>Everything is running</h4>
            <p>Followed sources are checked on their schedule.</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import OverviewActivityCard from '~/components/settings/OverviewActivityCard.vue';
import { useAdminChannels } from '~/composables/useAdminChannels';

const { stats, channels } = await useAdminChannels();

const sortedChannels = computed(() => {
  return [...channels.value]
    .sort((a, b) => (b.completed_count || 0) - (a.completed_count || 0))
    .slice(0, 5);
});

const getPercentage = (count: number, total: number) => {
  if (!total) return 0;
  return Math.min(Math.round((count / total) * 100), 100);
};

const formatSecondsToHours = (secs: number) => {
  if (!secs) return '0h';
  const hours = Math.round(secs / 3600);
  return `${hours.toLocaleString()} h`;
};

const formatViews = (views: number) => {
  if (!views) return '0';
  if (views >= 1000000) return (views / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (views >= 1000) return (views / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return views.toLocaleString();
};

const formatBytes = (bytes: number) => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};
</script>
