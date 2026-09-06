<template>
  <div class="settings-container">
    <h1 class="page-title text-gradient">Application Settings</h1>

    <div class="settings-layout">
      <!-- Tabs Sidebar -->
      <div v-if="isAdmin" class="settings-tabs glass-panel">
        <button
          v-if="isAdmin && !currentUser?.mustChangePassword"
          class="tab-btn"
          :class="{ active: activeTab === 'stats' }"
          @click="activeTab = 'stats'"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>
          <span>Dashboard</span>
        </button>

        <button
          v-if="isAdmin && !currentUser?.mustChangePassword"
          class="tab-btn"
          :class="{ active: activeTab === 'downloads' }"
          @click="activeTab = 'downloads'"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
          <span>Downloads</span>
          <span v-if="activeDownloadCount > 0" class="tab-badge">{{ activeDownloadCount }}</span>
        </button>

        <button
          v-if="isAdmin && !currentUser?.mustChangePassword"
          class="tab-btn"
          :class="{ active: activeTab === 'music' }"
          @click="activeTab = 'music'"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>
          <span>Music</span>
          <span v-if="musicActiveDownloadCount > 0" class="tab-badge">{{ musicActiveDownloadCount }}</span>
        </button>

        <button
          v-if="isAdmin && !currentUser?.mustChangePassword"
          class="tab-btn"
          :class="{ active: activeTab === 'podcasts' }"
          @click="activeTab = 'podcasts'"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>
          <span>Podcasts</span>
          <span v-if="podcastActiveDownloadCount > 0" class="tab-badge">{{ podcastActiveDownloadCount }}</span>
        </button>

        <button
          v-if="isAdmin && !currentUser?.mustChangePassword"
          class="tab-btn"
          :class="{ active: activeTab === 'users' }"
          @click="activeTab = 'users'"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
          <span>Users</span>
        </button>

        <button
          v-if="isAdmin && !currentUser?.mustChangePassword"
          class="tab-btn"
          :class="{ active: activeTab === 'system' }"
          @click="activeTab = 'system'"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"></path></svg>
          <span>System</span>
        </button>

      </div>

      <!-- Tab Content Area -->
      <div class="settings-content">
        <SettingsStatsTab v-if="activeTab === 'stats' && isAdmin" />
        <SettingsDownloadsTab v-if="activeTab === 'downloads' && isAdmin" />
        <SettingsMusicTab v-if="activeTab === 'music' && isAdmin" />
        <SettingsPodcastsTab v-if="activeTab === 'podcasts' && isAdmin" />
        <SettingsSystemTab v-if="activeTab === 'system' && isAdmin" />
        <SettingsUsersTab v-if="activeTab === 'users' && isAdmin" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';
import { useAuth } from '~/composables/useAuth';
import { useDownloadsQueue } from '~/composables/useDownloadsQueue';
import { useMusicQueue } from '~/composables/useMusicQueue';
import { usePodcastQueue } from '~/composables/usePodcastQueue';

const { user: currentUser, isAdmin } = useAuth();
const route = useRoute();

const allowedTabs = ['stats', 'downloads', 'podcasts', 'users', 'system'];
const queryTab = route.query.tab ? String(route.query.tab) : '';
const initialTab = allowedTabs.includes(queryTab) ? queryTab : 'stats';
if (!isAdmin.value) {
  navigateTo('/account');
}

const activeTab = ref(initialTab);

watch(() => route.query.tab, (newTab) => {
  if (newTab && allowedTabs.includes(String(newTab))) {
    activeTab.value = String(newTab);
  }
});

const { activeDownloadCount, fetchQueue, fetchDiagnostics, stopSmoothProgressLoop } = useDownloadsQueue();
const { musicQueue, musicActiveDownloadCount, fetchMusicQueue } = useMusicQueue();
const { podcastQueue, podcastActiveDownloadCount, fetchPodcastQueue } = usePodcastQueue();

// Dynamic polling for queue and progress
let pollingTimeout: any = null;

const runPolling = async () => {
  if (!isAdmin.value) return;
  await fetchQueue();
  // Only poll diagnostics when downloads are active
  if (activeDownloadCount.value > 0) {
    await fetchDiagnostics();
  }

  // If we have active downloads, poll faster (500ms) for high reactivity, otherwise poll every 3000ms
  const nextPollDelay = activeDownloadCount.value > 0 ? 500 : 3000;
  pollingTimeout = setTimeout(runPolling, nextPollDelay);
};

let musicPollingTimeout: any = null;

const runMusicPolling = async () => {
  if (!isAdmin.value || activeTab.value !== 'music') {
    musicPollingTimeout = setTimeout(runMusicPolling, 3000);
    return;
  }
  await fetchMusicQueue();
  const hasActiveMusicDownload = musicQueue.value.some(t => t.download_status === 'downloading');
  const nextPollDelay = hasActiveMusicDownload ? 500 : 3000;
  musicPollingTimeout = setTimeout(runMusicPolling, nextPollDelay);
};

let podcastPollingTimeout: any = null;

const runPodcastPolling = async () => {
  if (!isAdmin.value || activeTab.value !== 'podcasts') {
    podcastPollingTimeout = setTimeout(runPodcastPolling, 3000);
    return;
  }
  await fetchPodcastQueue();
  const hasActivePodcastDownload = podcastQueue.value.some(e => e.download_status === 'downloading');
  const nextPollDelay = hasActivePodcastDownload ? 500 : 3000;
  podcastPollingTimeout = setTimeout(runPodcastPolling, nextPollDelay);
};

onMounted(() => {
  if (isAdmin.value) {
    runPolling();
    runMusicPolling();
    runPodcastPolling();
  }
});

onUnmounted(() => {
  if (pollingTimeout) clearTimeout(pollingTimeout);
  if (musicPollingTimeout) clearTimeout(musicPollingTimeout);
  if (podcastPollingTimeout) clearTimeout(podcastPollingTimeout);
  stopSmoothProgressLoop();
});
</script>

<style>

.settings-container {
  display: flex;
  flex-direction: column;
  gap: 20px;
  max-width: 1200px;
  margin: 0 auto;
  width: 100%;
}

.settings-container .settings-layout {
  display: grid;
  grid-template-columns: var(--sidebar-width) 1fr;
  gap: 24px;
  align-items: start;
}

@media (max-width: 900px) {
  .settings-container .settings-layout {
    grid-template-columns: 1fr;
  }
}

.settings-container .settings-tabs {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
  border-radius: var(--border-radius-md);
}

@media (max-width: 900px) {
  .settings-container .settings-tabs {
    flex-direction: row;
    overflow-x: auto;
    white-space: nowrap;
    padding: 8px;
  }
}

.settings-container .tab-btn {
  width: 100%;
  text-align: left;
  justify-content: flex-start;
}

.settings-container .tab-badge {
  background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
  color: white;
  font-size: 9px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 8px;
  margin-left: auto;
}

.settings-container .settings-content {
  flex: 1;
  min-width: 0;
}

.settings-container .tab-pane {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.settings-container .pane-header h2 {
  font-size: 24px;
  font-weight: 700;
  margin-bottom: 4px;
}

.settings-container .pane-header p {
  color: var(--text-secondary);
  font-size: 14px;
}

/* Metrics Dashboard */
.settings-container .metrics-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(220px, 100%), 1fr));
  gap: 16px;
}

.settings-container .metric-card {
  display: flex;
  flex-direction: column;
  padding: 20px;
  border-radius: var(--border-radius-md);
}

.settings-container .metric-label {
  font-size: 12px;
  text-transform: uppercase;
  color: var(--text-muted);
  font-weight: 700;
  letter-spacing: 0.05em;
  margin-bottom: 8px;
}

.settings-container .metric-value {
  font-size: 28px;
  font-weight: 800;
  font-family: var(--font-title);
  line-height: 1.2;
}

.settings-container .metric-sub {
  font-size: 11px;
  color: var(--text-secondary);
  margin-top: 4px;
}

.settings-container .stats-row {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.settings-container .stats-col {
  padding: 20px;
  border-radius: var(--border-radius-md);
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.settings-container .stats-col h3 {
  font-size: 16px;
  font-weight: 600;
}

.settings-container .stats-empty {
  color: var(--text-muted);
  font-size: 13px;
  padding: 12px 0;
}

.settings-container .stats-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.settings-container .stats-list-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.settings-container .stats-item-info {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
}

.settings-container .item-title {
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 250px;
}

.settings-container .item-count {
  color: var(--text-secondary);
}

.settings-container .stats-item-bar-bg {
  height: 6px;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 3px;
  overflow: hidden;
}

.settings-container .stats-item-bar {
  height: 100%;
  background: linear-gradient(90deg, var(--accent-primary), var(--accent-primary-hover));
  border-radius: 3px;
}

.settings-container .secondary-gradient {
  background: linear-gradient(90deg, var(--accent-secondary), var(--accent-secondary-hover)) !important;
}

/* Ingestion Form */
.settings-container .ingest-box, .settings-container .config-section, .settings-container .profile-box {
  padding: 24px;
  border-radius: var(--border-radius-md);
}

.settings-container .ingest-box h3, .settings-container .config-section h3, .settings-container .profile-box h4 {
  font-size: 16px;
  margin-bottom: 8px;
}

.settings-container .section-desc {
  font-size: 13px;
  color: var(--text-secondary);
}

.settings-container .ingest-form {
  display: flex;
  gap: 12px;
  margin-top: 16px;
}

@media (max-width: 600px) {
  .settings-container .ingest-form {
    flex-direction: column;
  }
}





.settings-container .queue-actions-row {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

/* Queue List */
.settings-container .queue-box {
  padding: 24px;
  border-radius: var(--border-radius-md);
}

.settings-container .queue-box h3 {
  font-size: 16px;
  margin-bottom: 16px;
}

.settings-container .queue-empty {
  color: var(--text-muted);
  font-size: 13px;
  text-align: center;
  padding: 24px 0;
}

.settings-container .queue-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.settings-container .queue-card {
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.04);
  border-radius: var(--border-radius-sm);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.settings-container .queue-details {
  display: flex;
  justify-content: space-between;
  align-items: start;
  gap: 16px;
}

.settings-container .queue-text {
  flex: 1;
  min-width: 0;
}

.settings-container .queue-title {
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.settings-container .queue-channel {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 2px;
}

.settings-container .queue-error {
  font-size: 11px;
  color: #f87171;
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.15);
  border-radius: 4px;
  padding: 8px 12px;
  font-family: var(--font-mono, monospace);
  line-height: 1.4;
  word-break: break-word;
  white-space: pre-wrap;
}

.settings-container .badge {
  padding: 3px 8px;
  font-size: 11px;
  border-radius: 4px;
  font-weight: 600;
}

.settings-container .badge-pending {
  background: rgba(234, 179, 8, 0.15);
  color: #fbbf24;
}

.settings-container .badge-downloading {
  background: rgba(139, 92, 246, 0.15);
  color: #a78bfa;
}

.settings-container .badge-completed {
  background: rgba(34, 197, 94, 0.15);
  color: #4ade80;
}

.settings-container .badge-failed {
  background: rgba(239, 68, 68, 0.15);
  color: #f87171;
}

.settings-container .queue-progress-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.settings-container .progress-bar-bg {
  flex: 1;
  height: 6px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 3px;
  overflow: hidden;
}

.settings-container .progress-bar-fill {
  height: 100%;
  background: linear-gradient(
    90deg,
    var(--accent-primary) 0%,
    var(--accent-secondary) 50%,
    var(--accent-primary) 100%
  );
  background-size: 200% 100%;
  box-shadow: 0 0 8px var(--accent-primary-glow), 0 0 3px var(--accent-primary);
  border-radius: 3px;
  animation: progress-shimmer 2.5s infinite linear;
  transition: width 0.4s cubic-bezier(0.25, 0.8, 0.25, 1);
}

@keyframes progress-shimmer {
  0% {
    background-position: 100% 0;
  }
  100% {
    background-position: -100% 0;
  }
}

.settings-container .progress-percent {
  font-size: 12px;
  font-weight: 600;
  width: 35px;
  text-align: right;
}

.settings-container .queue-meta {
  display: flex;
  gap: 16px;
  font-size: 12px;
  color: var(--text-secondary);
}

.settings-container .queue-card-actions {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}



/* Logs Terminal */
.settings-container .logs-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.settings-container .logs-header h3 {
  font-size: 15px;
}

.settings-container .logs-terminal {
  background: #030307;
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 6px;
  padding: 16px;
  font-family: monospace;
  font-size: 12px;
  max-height: 250px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.settings-container .log-line {
  white-space: pre-wrap;
  word-break: break-all;
}

.settings-container .log-default { color: #d1d5db; }
.settings-container .log-info { color: #3b82f6; }
.settings-container .log-success { color: #10b981; }
.settings-container .log-warning { color: #f59e0b; }
.settings-container .log-error { color: #ef4444; }

/* Configuration Elements */
.settings-container .checkbox-container {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
  cursor: pointer;
  user-select: none;
}

.settings-container .checkbox-container input {
  display: none;
}

.settings-container .checkmark {
  width: 18px;
  height: 18px;
  border: 2px solid rgba(255, 255, 255, 0.2);
  border-radius: 4px;
  display: inline-block;
  position: relative;
  transition: all 0.2s;
}

.settings-container .checkbox-container input:checked ~ .checkmark {
  background: var(--accent-primary);
  border-color: var(--accent-primary);
}

.settings-container .checkbox-container input:checked ~ .checkmark::after {
  content: '';
  position: absolute;
  left: 5px;
  top: 1px;
  width: 4px;
  height: 8px;
  border: solid white;
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}

.settings-container .schedule-settings-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-top: 16px;
}

@media (max-width: 600px) {
  .settings-container .schedule-settings-row {
    grid-template-columns: 1fr;
  }
}



.settings-container .diagnostic-pre {
  background: #030307;
  padding: 12px;
  border-radius: 6px;
  font-family: monospace;
  font-size: 11px;
  max-height: 180px;
  overflow-y: auto;
  border: 1px solid rgba(255, 255, 255, 0.05);
}

.settings-container .diagnostic-status-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
}

.settings-container .diagnostic-label {
  font-weight: 600;
  color: var(--text-secondary);
  width: 70px;
}

.settings-container .badge-status {
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
}

.settings-container .badge-success {
  background: rgba(16, 185, 129, 0.15);
  color: #10b981;
  border: 1px solid rgba(16, 185, 129, 0.2);
}

.settings-container .badge-warning {
  background: rgba(245, 158, 11, 0.15);
  color: #f59e0b;
  border: 1px solid rgba(245, 158, 11, 0.2);
}

.settings-container .badge-danger {
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
  border: 1px solid rgba(239, 68, 68, 0.2);
}

.settings-container .diagnostic-version-text {
  font-size: 12px;
  color: var(--text-secondary);
}

.settings-container .ffmpeg-warning-box {
  background: rgba(245, 158, 11, 0.08);
  border: 1px solid rgba(245, 158, 11, 0.15);
  padding: 12px 16px;
  border-radius: 8px;
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.5;
}

.settings-container .warning-title {
  color: #f59e0b;
  display: block;
  margin-bottom: 4px;
}

.settings-container .warning-desc {
  margin: 0;
}

.settings-container .btn-group {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}



/* Users Admin Layout */
.settings-container .users-layout {
  display: grid;
  grid-template-columns: 350px 1fr;
  gap: 24px;
  align-items: start;
}

@media (max-width: 900px) {
  .settings-container .users-layout {
    grid-template-columns: 1fr;
  }
}

.settings-container .user-form-panel, .settings-container .users-list-panel {
  padding: 24px;
  border-radius: var(--border-radius-md);
}

.settings-container .role-selector {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.settings-container .role-option {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
  background: rgba(0, 0, 0, 0.2);
  text-align: center;
}

.settings-container .role-option input {
  display: none;
}

.settings-container .role-option span {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
}

.settings-container .role-option.selected {
  border-color: var(--accent-primary);
  background: rgba(139, 92, 246, 0.08);
}

.settings-container .role-option.selected span {
  color: white;
}

.settings-container .permissions-grids {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.settings-container .perm-col {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.settings-container .perm-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--text-muted);
}

.settings-container .checklist-container {
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 6px;
  padding: 8px;
  max-height: 150px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.settings-container .check-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  cursor: pointer;
}

.settings-container .check-item input {
  cursor: pointer;
}

.settings-container .check-item span {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.settings-container .settings-form-msg {
  padding: 10px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
}

.settings-container .settings-success-msg {
  background: rgba(34, 197, 94, 0.1);
  border: 1px solid rgba(34, 197, 94, 0.2);
  color: #4ade80;
}

.settings-container .settings-error-msg {
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.2);
  color: #f87171;
}

.settings-container .users-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.settings-container .user-card {
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.04);
  border-radius: var(--border-radius-sm);
  padding: 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
}

.settings-container .user-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.settings-container .user-headline {
  display: flex;
  align-items: center;
  gap: 8px;
}

.settings-container .user-created {
  font-size: 11px;
}

.settings-container .user-access-summary {
  display: flex;
  gap: 12px;
  font-size: 11px;
  margin-top: 4px;
}

.settings-container .user-actions {
  display: flex;
  gap: 8px;
}

.settings-container .btn-icon-sm {
  padding: 8px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* Account Profile Pane */
.settings-container .profile-details-row {
  display: flex;
  align-items: center;
  gap: 20px;
}

.settings-container .ml-2 { margin-left: 8px; }
.settings-container .mr-2 { margin-right: 8px; }
.settings-container .mt-2 { margin-top: 8px; }
.settings-container .mt-3 { margin-top: 12px; }
.settings-container .mt-4 { margin-top: 24px; }
.settings-container .text-success { color: #4ade80; }
.settings-container .text-danger { color: #f87171; }
.settings-container .text-muted { color: var(--text-muted); }

.settings-container .spin-anim {
  animation: spin 1.2s linear infinite;
}

/* Modals */
.settings-container .modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  animation: fadeIn 0.2s ease-out;
}

.settings-container .modal-content {
  width: 90%;
  max-width: 550px;
  background: rgba(18, 18, 29, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: var(--border-radius-md);
  padding: 24px;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5);
  animation: slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

.settings-container .modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  padding-bottom: 12px;
}

.settings-container .modal-header h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
}

.settings-container .btn-close {
  background: transparent;
  border: none;
  color: var(--text-secondary);
  font-size: 24px;
  cursor: pointer;
  padding: 0;
  line-height: 1;
}

.settings-container .btn-close:hover {
  color: white;
}

/* Search results styles */
.settings-container .search-results-list {
  border-top: 1px solid rgba(255, 255, 255, 0.05);
  padding-top: 16px;
}

.settings-container .search-results-grid {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: 300px;
  overflow-y: auto;
  padding-right: 4px;
}

.settings-container .search-channel-card {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.04);
  border-radius: 8px;
  transition: all 0.2s;
}

.settings-container .search-channel-card:hover {
  background: rgba(255, 255, 255, 0.04);
  border-color: rgba(255, 255, 255, 0.08);
}

.settings-container .channel-avatar-thumb {
  width: 50px;
  height: 50px;
  border-radius: 50%;
  object-fit: cover;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(0, 0, 0, 0.2);
}

.settings-container .channel-search-info {
  flex: 1;
  min-width: 0;
}

.settings-container .channel-search-info h5 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: white;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.settings-container .channel-search-meta {
  margin: 2px 0 0;
  font-size: 11px;
  color: var(--text-secondary);
}

.settings-container .channel-search-desc {
  margin: 4px 0 0;
  font-size: 11px;
  color: var(--text-muted);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* Global status badges */
.settings-container .badge-active-global {
  background: rgba(16, 185, 129, 0.15);
  color: #10b981;
  border: 1px solid rgba(16, 185, 129, 0.2);
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 600;
}

.settings-container .badge-paused-global {
  background: rgba(245, 158, 11, 0.15);
  color: #f59e0b;
  border: 1px solid rgba(245, 158, 11, 0.2);
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 600;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes slideUp {
  from { transform: translateY(20px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

/* Diagnostic Dashboard Enhancements */
.settings-container .dashboard-banner {
  margin-bottom: 16px;
  padding: 24px;
  border-radius: var(--border-radius-lg);
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 24px;
  background: linear-gradient(135deg, rgba(30, 30, 50, 0.4) 0%, rgba(15, 15, 25, 0.5) 100%);
}

.settings-container .banner-content h2 {
  font-size: 22px;
  font-weight: 800;
  color: white;
  margin: 0 0 6px 0;
  letter-spacing: -0.01em;
}

.settings-container .banner-content p {
  color: var(--text-secondary);
  font-size: 13.5px;
  margin: 0;
  max-width: 600px;
  line-height: 1.5;
}

.settings-container .system-status-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: rgba(16, 185, 129, 0.1);
  color: #34d399;
  border: 1px solid rgba(16, 185, 129, 0.2);
  padding: 4px 10px;
  border-radius: 20px;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 12px;
}

.settings-container .pulse-dot {
  width: 6px;
  height: 6px;
  background: #10b981;
  border-radius: 50%;
  display: inline-block;
  animation: pulse-badge 2s infinite ease-in-out;
}

@keyframes pulse-badge {
  0% { transform: scale(0.85); opacity: 1; }
  50% { transform: scale(1.2); opacity: 0.6; }
  100% { transform: scale(0.85); opacity: 1; }
}

.settings-container .banner-quick-stats {
  display: flex;
  align-items: center;
  gap: 28px;
  background: rgba(255, 255, 255, 0.02);
  padding: 14px 24px;
  border-radius: var(--border-radius-md);
  border: 1px solid rgba(255, 255, 255, 0.04);
}

.settings-container .quick-stat-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.settings-container .stat-number {
  font-size: 20px;
  font-weight: 800;
  color: white;
  font-family: var(--font-title);
}

.settings-container .settings-text-accent {
  color: var(--accent-secondary) !important;
}

.settings-container .stat-label {
  font-size: 10px;
  color: var(--text-secondary);
  text-transform: uppercase;
  font-weight: 700;
  letter-spacing: 0.03em;
}

.settings-container .quick-stat-divider {
  width: 1px;
  height: 32px;
  background: rgba(255, 255, 255, 0.08);
}

.settings-container .metric-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  margin-bottom: 6px;
}

.settings-container .metric-icon {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.03);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
  border: 1px solid rgba(255, 255, 255, 0.05);
  transition: all 0.3s ease;
}

.settings-container .metric-card:hover .metric-icon {
  color: white;
  background: rgba(255, 255, 255, 0.08);
  transform: translateY(-2px);
}

.settings-container .metric-card.glow-purple:hover {
  border-color: rgba(139, 92, 246, 0.3);
  box-shadow: 0 8px 30px rgba(139, 92, 246, 0.1);
}

.settings-container .metric-card.glow-blue:hover {
  border-color: rgba(59, 130, 246, 0.3);
  box-shadow: 0 8px 30px rgba(59, 130, 246, 0.1);
}

.settings-container .metric-card.glow-green:hover {
  border-color: rgba(16, 185, 129, 0.3);
  box-shadow: 0 8px 30px rgba(16, 185, 129, 0.1);
}

.settings-container .metric-card.glow-pink:hover {
  border-color: rgba(236, 72, 153, 0.3);
  box-shadow: 0 8px 30px rgba(236, 72, 153, 0.1);
}

.settings-container .col-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  padding-bottom: 12px;
}

.settings-container .col-header h3 {
  font-size: 15px;
  font-weight: 700;
  margin: 0;
  letter-spacing: -0.01em;
  color: white;
}

.settings-container .stats-item-title-col {
  display: flex;
  align-items: center;
  gap: 8px;
}

.settings-container .mini-tag {
  font-size: 8px !important;
  padding: 1px 4px !important;
  border-radius: 4px !important;
  line-height: 1 !important;
}

.settings-container .diagnostic-panel {
  display: flex;
  flex-direction: column;
}

.settings-container .diagnostic-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 16px;
}

.settings-container .diag-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
  padding-bottom: 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.03);
}

.settings-container .diag-label {
  color: var(--text-secondary);
}

.settings-container .diag-value {
  font-weight: 600;
  color: var(--text-primary);
}

.settings-container .font-highlight {
  color: var(--accent-primary) !important;
}

.settings-container .warning-highlight {
  color: #fbbf24 !important;
}

.settings-container .diagnostic-check {
  margin-top: auto;
  background: rgba(16, 185, 129, 0.02);
  border: 1px solid rgba(16, 185, 129, 0.1);
  border-radius: var(--border-radius-md);
  padding: 14px 18px;
  display: flex;
  align-items: center;
  gap: 14px;
}

.settings-container .check-radar {
  position: relative;
  width: 24px;
  height: 24px;
  flex-shrink: 0;
}

.settings-container .radar-dot {
  position: absolute;
  top: 9px;
  left: 9px;
  width: 6px;
  height: 6px;
  background: #10b981;
  border-radius: 50%;
}

.settings-container .radar-ring {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 18px;
  height: 18px;
  border: 2px solid #10b981;
  border-radius: 50%;
  animation: radar-ripple 1.8s infinite ease-out;
  opacity: 0;
}

@keyframes radar-ripple {
  0% { transform: scale(0.4); opacity: 1; }
  100% { transform: scale(1.4); opacity: 0; }
}

.settings-container .check-text h4 {
  font-size: 13px;
  font-weight: 700;
  color: #34d399;
  margin: 0;
}

.settings-container .check-text p {
  font-size: 11px;
  color: var(--text-secondary);
  margin: 2px 0 0 0;
}

/* Premium Settings Layout System */
.settings-container .downloads-dashboard-layout, .settings-container .system-dashboard-layout, .settings-container .users-dashboard-layout {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

@media (max-width: 1024px) {
  .settings-container .downloads-dashboard-layout, .settings-container .system-dashboard-layout, .settings-container .users-dashboard-layout {
    grid-template-columns: 1fr;
  }
}

.settings-container .downloads-header-panel {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 20px;
  padding: 24px;
  border-radius: var(--border-radius-lg);
  margin-bottom: 16px;
}

.settings-container .downloads-header-panel h2 {
  font-size: 18px;
  font-weight: 700;
  color: white;
  margin: 0 0 4px 0;
}

.settings-container .downloads-header-panel p {
  font-size: 12.5px;
  color: var(--text-secondary);
  margin: 0;
}

/* Button & Card Styles */
.settings-container .btn-primary-glow {
  background: linear-gradient(135deg, var(--accent-primary) 0%, var(--accent-secondary) 100%);
  color: white;
  border: none;
  box-shadow: 0 0 16px rgba(139, 92, 246, 0.2);
}

.settings-container .btn-primary-glow:hover {
  transform: translateY(-2px);
  box-shadow: 0 0 24px rgba(139, 92, 246, 0.45);
}

.settings-container .btn-secondary-dark {
  background: rgba(255, 255, 255, 0.04);
  color: var(--text-primary);
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.settings-container .btn-secondary-dark:hover {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.12);
  color: white;
}

.settings-container .btn-clean {
  border-radius: var(--border-radius-md) !important;
  font-size: 13px !important;
}

/* Form items icons */
.settings-container .section-title-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  padding-bottom: 16px;
}

.settings-container .section-title-row h3 {
  font-size: 15px;
  font-weight: 700;
  color: white;
  margin: 0 0 2px 0;
}

.settings-container .section-title-row .section-desc {
  font-size: 12px;
  color: var(--text-secondary);
  margin: 0;
}

.settings-container .icon-orb {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.settings-container .icon-orb.bg-purple {
  background: rgba(139, 92, 246, 0.15);
  color: #a78bfa;
  border: 1px solid rgba(139, 92, 246, 0.25);
}

.settings-container .icon-orb.bg-blue {
  background: rgba(59, 130, 246, 0.15);
  color: #60a5fa;
  border: 1px solid rgba(59, 130, 246, 0.25);
}

.settings-container .icon-orb.bg-pink {
  background: rgba(236, 72, 153, 0.15);
  color: #f472b6;
  border: 1px solid rgba(236, 72, 153, 0.25);
}

/* Custom search elements */
.settings-container .search-input-wrapper {
  position: relative;
  flex: 1;
}

.settings-container .settings-search-input {
  padding-left: 40px !important;
}

.settings-container .search-icon {
  position: absolute;
  left: 14px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-secondary);
  pointer-events: none;
}

.settings-container .results-header {
  font-size: 13px;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--text-secondary);
  letter-spacing: 0.05em;
  margin-bottom: 12px;
}

.settings-container .search-results-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 12px;
  max-height: 400px;
  overflow-y: auto;
  padding-right: 6px;
}

/* Custom forms integration */
.settings-container .policy-form-block {
  width: 100%;
}

.settings-container .border-t {
  border-top: 1px solid rgba(255, 255, 255, 0.04);
}

.settings-container .input-action-row {
  display: flex;
  gap: 10px;
  margin-top: 6px;
}

.settings-container .input-action-row .form-input {
  flex: 1;
}

.settings-container .flex-1 {
  flex: 1;
}

.settings-container .flex-align-center {
  display: flex;
  align-items: center;
}

.settings-container .gap-10 {
  gap: 10px;
}

/* Queue Premium list */
.settings-container .queue-header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  padding-bottom: 16px;
  margin-bottom: 16px;
}

.settings-container .queue-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 48px 24px;
  color: var(--text-secondary);
  height: calc(100% - 80px);
  min-height: 250px;
}

.settings-container .empty-icon-cloud {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.04);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 16px;
  color: var(--text-muted);
}

.settings-container .queue-empty-state h4 {
  margin: 0 0 6px 0;
  font-size: 14px;
  font-weight: 700;
  color: white;
}

.settings-container .queue-empty-state p {
  margin: 0;
  font-size: 12px;
  max-width: 200px;
  line-height: 1.4;
}

.settings-container .queue-list-premium {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: 600px;
  overflow-y: auto;
  padding-right: 6px;
}

.settings-container .queue-card-premium {
  padding: 16px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.04);
  border-radius: var(--border-radius-md);
  display: flex;
  flex-direction: column;
  gap: 12px;
  transition: all 0.3s ease;
}

.settings-container .queue-card-premium:hover {
  background: rgba(255, 255, 255, 0.03);
  border-color: rgba(255, 255, 255, 0.08);
  transform: translateY(-2px);
}

.settings-container .queue-card-details {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}

.settings-container .queue-card-meta-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.settings-container .queue-card-title {
  font-size: 13px;
  font-weight: 600;
  color: white;
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.settings-container .queue-card-channel-name {
  font-size: 11.5px;
  color: var(--text-secondary);
}

.settings-container .status-badge {
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  padding: 2px 6px;
  border-radius: 12px;
  letter-spacing: 0.05em;
  flex-shrink: 0;
}

.settings-container .status-pending { background: rgba(255, 255, 255, 0.05); color: var(--text-secondary); }
.settings-container .status-downloading { background: rgba(139, 92, 246, 0.15); color: #a78bfa; border: 1px solid rgba(139, 92, 246, 0.25); }
.settings-container .status-completed { background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.25); }
.settings-container .status-failed { background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.25); }

.settings-container .queue-progress-container {
  display: flex;
  align-items: center;
  gap: 12px;
}

.settings-container .progress-bar-glow-bg {
  height: 5px;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 3px;
  overflow: hidden;
  flex: 1;
}

.settings-container .progress-bar-glow-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--accent-primary) 0%, var(--accent-secondary) 100%);
  border-radius: 3px;
  box-shadow: 0 0 10px rgba(139, 92, 246, 0.5);
  transition: width 0.3s ease;
}

.settings-container .progress-percent-text {
  font-size: 11px;
  font-weight: 700;
  color: white;
  min-width: 32px;
  text-align: right;
}

.settings-container .queue-diagnostics-row {
  display: flex;
  gap: 12px;
  font-size: 11px;
  color: var(--text-secondary);
}

.settings-container .queue-error-box {
  background: rgba(239, 68, 68, 0.05);
  border: 1px solid rgba(239, 68, 68, 0.15);
  padding: 8px 12px;
  border-radius: var(--border-radius-sm);
  color: #f87171;
  font-size: 11px;
  line-height: 1.4;
  word-break: break-all;
}

.settings-container .queue-card-action-bar {
  display: flex;
  gap: 8px;
}

.settings-container .btn-action-premium {
  padding: 4px 10px;
  font-size: 10.5px;
  font-weight: 600;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.05);
  background: rgba(255, 255, 255, 0.03);
  color: var(--text-primary);
  cursor: pointer;
  transition: all 0.2s ease;
}

.settings-container .btn-action-premium:hover {
  background: rgba(255, 255, 255, 0.08);
  color: white;
}

.settings-container .btn-action-danger {
  color: #ef4444;
  border-color: rgba(239, 68, 68, 0.15);
  background: rgba(239, 68, 68, 0.03);
}

.settings-container .btn-action-danger:hover {
  background: rgba(239, 68, 68, 0.1);
  border-color: rgba(239, 68, 68, 0.3);
  color: #f87171;
}

/* System diagnostics tab improvements */
.settings-container .system-diagnostic-col .binary-path-box {
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.04);
  padding: 10px 14px;
  border-radius: var(--border-radius-md);
  font-size: 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.settings-container .path-label {
  color: var(--text-secondary);
}

.settings-container .path-code {
  color: #a78bfa;
  word-break: break-all;
}

.settings-container .diagnostic-version-sub {
  font-size: 11px;
  color: var(--text-secondary);
}

.settings-container .ffmpeg-warning-box {
  background: rgba(245, 158, 11, 0.03);
  border: 1px solid rgba(245, 158, 11, 0.1);
  padding: 12px;
  border-radius: var(--border-radius-md);
}

.settings-container .warning-title {
  color: #fbbf24;
  font-size: 12px;
  display: block;
}

.settings-container .warning-desc {
  font-size: 11px;
  line-height: 1.4;
  margin: 4px 0 0 0;
  color: var(--text-secondary);
}

/* Terminal enhancement */
.settings-container .logs-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-bottom: 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  margin-bottom: 14px;
}

.settings-container .terminal-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}

.settings-container .terminal-dot.green {
  background: #10b981;
  box-shadow: 0 0 8px #10b981;
}

.settings-container .logs-terminal {
  background: #09090f;
  border: 1px solid rgba(255, 255, 255, 0.03);
  box-shadow: inset 0 0 16px rgba(0, 0, 0, 0.6);
  padding: 16px;
  border-radius: 6px;
  max-height: 480px;
  font-size: 11.5px;
  font-family: var(--font-mono);
  overflow-y: auto;
}

.settings-container .log-line {
  line-height: 1.6;
  padding: 2px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.01);
}

/* User management improvements */
.settings-container .role-selector-premium {
  display: flex;
  gap: 12px;
  margin-top: 6px;
}

.settings-container .role-card {
  flex: 1;
  cursor: pointer;
}

.settings-container .role-card-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 14px;
  border-radius: var(--border-radius-md);
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.04);
  transition: all 0.25s ease;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
}

.settings-container .role-card:hover .role-card-inner {
  background: rgba(255, 255, 255, 0.04);
  border-color: rgba(255, 255, 255, 0.08);
}

.settings-container .role-card.active .role-card-inner {
  background: rgba(139, 92, 246, 0.1);
  border-color: rgba(139, 92, 246, 0.4);
  color: white;
  box-shadow: 0 0 16px rgba(139, 92, 246, 0.08);
}

.settings-container .permissions-section-premium {
  background: rgba(255, 255, 255, 0.01);
  border: 1px solid rgba(255, 255, 255, 0.03);
  padding: 16px;
  border-radius: var(--border-radius-md);
}

.settings-container .permissions-section-premium h4 {
  font-size: 13px;
  font-weight: 700;
  margin: 0 0 10px 0;
  color: white;
}

.settings-container .checklist-container-premium {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 180px;
  overflow-y: auto;
  background: rgba(0, 0, 0, 0.15);
  border: 1px solid rgba(255, 255, 255, 0.02);
  padding: 10px;
  border-radius: 6px;
}

.settings-container .check-item-premium {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  cursor: pointer;
  color: var(--text-secondary);
}

.settings-container .check-item-premium:hover {
  color: var(--text-primary);
}

.settings-container .credentials-alert-box {
  background: rgba(16, 185, 129, 0.04);
  border: 1px solid rgba(16, 185, 129, 0.15);
  padding: 16px;
  border-radius: var(--border-radius-md);
}

.settings-container .alert-title {
  color: #34d399;
  font-size: 13.5px;
  display: block;
}

.settings-container .credentials-display {
  font-size: 12px;
  color: var(--text-secondary);
}

.settings-container .pass-code {
  font-size: 13px !important;
  color: #34d399 !important;
  background: rgba(0, 0, 0, 0.3) !important;
  padding: 3px 8px !important;
  border-radius: 4px;
  font-weight: 700;
}

.settings-container .user-card-premium {
  padding: 18px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.04);
  border-radius: var(--border-radius-lg);
  display: flex;
  flex-direction: column;
  transition: all 0.3s ease;
}

.settings-container .user-card-premium:hover {
  background: rgba(255, 255, 255, 0.03);
  border-color: rgba(255, 255, 255, 0.08);
  transform: translateY(-2px);
}

.settings-container .user-card-header {
  display: flex;
  align-items: center;
  gap: 14px;
}

.settings-container .user-avatar-circle {
  width: 42px;
  height: 42px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--accent-primary) 0%, var(--accent-secondary) 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 14px;
  font-weight: 800;
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 4px 10px rgba(139, 92, 246, 0.15);
}

.settings-container .user-headline-col {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.settings-container .user-headline-col h4 {
  font-size: 14.5px;
  font-weight: 700;
  color: white;
  margin: 0;
}


.settings-container .user-card-meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11.5px;
  color: var(--text-secondary);
  padding-left: 56px;
}

.settings-container .user-card-action-bar {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding-left: 56px;
}

.settings-container .btn-action-premium-icon {
  background: transparent;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11.5px;
  color: var(--text-secondary);
  transition: all 0.2s ease;
  padding: 4px 8px;
  border-radius: 4px;
}

.settings-container .btn-action-premium-icon:hover {
  background: rgba(255, 255, 255, 0.04);
  color: white;
}

.settings-container .btn-action-premium-icon.danger-icon:hover {
  background: rgba(239, 68, 68, 0.08);
  color: #f87171;
}

.settings-container .btn-action-premium-icon:disabled {
  opacity: 0.4;
  cursor: not-allowed;
  background: transparent !important;
  color: var(--text-secondary) !important;
}

/* Redesigned grid results for fluid layout */
.settings-container .users-list-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 16px;
}

.settings-container .ingest-form .btn {
  white-space: nowrap;
  flex-shrink: 0;
}
</style>
