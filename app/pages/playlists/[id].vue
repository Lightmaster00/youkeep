<template>
  <div class="playlist-detail-container">
    <div v-if="pending" class="loading-state">
      <div class="spinner"></div>
      <p>Loading playlist...</p>
    </div>

    <div v-else-if="error" class="error-state glass-panel">
      <h2>Error Loading Playlist</h2>
      <p>{{ error }}</p>
      <button class="btn btn-secondary mt-4" @click="navigateTo('/playlists')">Back to Playlists</button>
    </div>

    <div v-else-if="playlist" class="playlist-grid-layout">
      <!-- Sidebar Column -->
      <div class="sidebar-stack" style="display: flex; flex-direction: column; gap: 20px;">
        <!-- Sidebar Playlist Details -->
        <div class="playlist-sidebar-info glass-panel">
        <div class="sidebar-cover">
          <img v-if="videos.length && videos[0].local_thumbnail_path" :src="videos[0].local_thumbnail_path" class="playlist-cover-img" alt="Playlist Cover" />
          <img v-else src="/default-playlist.png" class="playlist-cover-img" alt="Empty Playlist Cover" />
        </div>
        <div class="sidebar-details">
          <h1 class="playlist-title">{{ playlist.title }}</h1>
          
          <div class="playlist-meta-tags">
            <span :class="['visibility-tag', playlist.visibility]">
              {{ playlist.visibility }}
            </span>
            <span class="meta-item">{{ videos.length }} videos</span>
          </div>

          <p v-if="playlist.description" class="playlist-desc">{{ playlist.description }}</p>
          
          <div class="playlist-author">
            <span>Created by <strong>{{ playlist.owner_name }}</strong></span>
          </div>

          <div class="sidebar-actions">
            <button 
              v-if="videos.length" 
              class="btn-play-all" 
              @click="playAll"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
              Play All
            </button>

            <!-- Settings Modal Trigger -->
            <button 
              v-if="isOwner" 
              class="btn btn-secondary" 
              @click="showSettingsModal = true"
              style="width: 100%; justify-content: center; margin-top: 8px;"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
              Settings
            </button>
          </div>
        </div>
      </div>

      </div>

      <!-- Videos List -->
      <div class="playlist-videos-section">
        <div v-if="!videos.length" class="empty-videos-state glass-panel">
          <p>No videos in this playlist yet.</p>
          <p class="help-text">Go to any video watch page to add items to this playlist.</p>
          <button class="btn btn-secondary mt-4" @click="navigateTo('/')">Browse Videos</button>
        </div>

        <div v-else class="videos-list">
          <div 
            v-for="(video, index) in videos" 
            :key="video.id" 
            class="video-row glass-panel"
            @click="playVideo(video.id)"
          >
            <div class="video-index">{{ index + 1 }}</div>
            
            <div class="video-thumbnail-container">
              <img 
                v-if="video.local_thumbnail_path" 
                :src="video.local_thumbnail_path" 
                class="video-thumbnail" 
                alt="Thumbnail" 
              />
              <div v-else class="video-thumbnail-placeholder">No Image</div>
              <span class="video-duration">{{ formatDuration(video.duration) }}</span>
            </div>

            <div class="video-info">
              <h3 class="video-title">{{ video.title }}</h3>
              <p class="video-channel">{{ video.channel_title }}</p>
              <span class="video-views">{{ formatNumber(video.view_count) }} views</span>
            </div>

            <div class="video-row-actions">
              <button 
                v-if="isAdmin || playlist.owner_name === user?.username" 
                class="btn-remove-video" 
                @click.stop="removeVideo(video.id)"
                title="Remove from Playlist"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Settings Modal -->
    <div v-if="showSettingsModal" class="modal-overlay" @click="showSettingsModal = false">
      <div class="modal-card glass-panel" @click.stop>
        <div class="modal-header">
          <h3>Playlist Settings</h3>
          <button class="close-modal-btn" @click="showSettingsModal = false">&times;</button>
        </div>
        
        <div class="modal-body" style="padding: 20px;">
          <div class="form-group mb-4">
            <label style="font-size: 13px; color: var(--text-muted); margin-bottom: 8px; display: block; font-weight: 600;">Privacy Mode</label>
            <select v-model="playlist.visibility" @change="updateVisibility" class="form-input" style="width: 100%; background: rgba(0,0,0,0.3); padding: 12px; font-size: 14px; border: 1px solid rgba(255,255,255,0.1);">
              <option value="private">🔒 Private (Only you)</option>
              <option value="unlisted">🔗 Unlisted (Anyone with link)</option>
              <option value="public">🌍 Public (Discoverable)</option>
            </select>
          </div>
          
          <div class="form-group">
            <label style="font-size: 13px; color: var(--text-muted); margin-bottom: 8px; display: block; font-weight: 600;">Share Link</label>
            <button class="btn btn-secondary" @click="copyShareLink" style="width: 100%; justify-content: center; gap: 8px; display: flex; align-items: center;" :disabled="playlist.visibility === 'private'">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>
              Copy Link to Clipboard
            </button>
            <p v-if="playlist.visibility === 'private'" style="font-size: 12px; color: var(--text-muted); text-align: center; margin-top: 12px;">
              Your playlist is private. Change it to Unlisted or Public to share.
            </p>
          </div>
          <div class="form-group" style="margin-top: 24px; padding-top: 16px; border-top: 1px solid rgba(255,255,255,0.1);">
            <button class="btn" style="width: 100%; display: flex; align-items: center; justify-content: center; background: rgba(239, 68, 68, 0.1); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.2);" @click="showSettingsModal = false; showDeleteModal = true">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px;"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
              Delete Playlist
            </button>
          </div>
        </div>
        
        <div class="modal-footer">
          <button class="btn btn-primary" @click="showSettingsModal = false">Done</button>
        </div>
      </div>
    </div>
    <!-- Delete Confirmation Modal -->
    <div v-if="showDeleteModal" class="modal-overlay" @click="showDeleteModal = false">
      <div class="modal-card glass-panel" @click.stop style="max-width: 400px;">
        <div class="modal-header">
          <h3>Delete Playlist</h3>
          <button class="close-modal-btn" @click="showDeleteModal = false">&times;</button>
        </div>
        <div class="modal-body" style="padding: 20px;">
          <p style="color: var(--text-secondary); margin-bottom: 20px; line-height: 1.5;">
            Are you sure you want to delete the playlist <strong style="color: white;">"{{ playlist.title }}"</strong>? This action cannot be undone.
          </p>
        </div>
        <div class="modal-footer" style="gap: 12px;">
          <button class="btn btn-secondary" @click="showDeleteModal = false">Cancel</button>
          <button class="btn" style="background: #ef4444; color: white;" @click="deletePlaylist">Delete</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { useAuth } from '~/composables/useAuth';
import { useToast } from '~/composables/useToast';

const route = useRoute();
const { user, isAdmin } = useAuth();
const toast = useToast();

const playlist = ref<any>(null);
const videos = ref<any[]>([]);
const pending = ref(true);
const error = ref<string | null>(null);
const showSettingsModal = ref(false);
const showDeleteModal = ref(false);

const fetchPlaylistDetails = async () => {
  pending.value = true;
  error.value = null;
  
  const tokenQuery = route.query.token ? `?token=${route.query.token}` : '';
  try {
    const data = await $fetch<any>(`/api/playlists/personal/${route.params.id}${tokenQuery}`);
    playlist.value = data.playlist;
    videos.value = data.videos || [];
  } catch (e: any) {
    error.value = e.statusMessage || 'Failed to load playlist.';
    toast.error(error.value || 'Error loading playlist.');
  } finally {
    pending.value = false;
  }
};

const isOwner = computed(() => {
  return playlist.value && user.value && playlist.value.owner_name === user.value.username;
});

const updateVisibility = async () => {
  try {
    await $fetch(`/api/playlists/personal/${route.params.id}`, {
      method: 'PUT',
      body: { visibility: playlist.value.visibility }
    });
    toast.success('Playlist visibility updated');
  } catch (e: any) {
    toast.error('Failed to update visibility');
  }
};

const removeVideo = async (videoId: string) => {
  if (!window.confirm("Are you sure you want to remove this video from the playlist?")) {
    return;
  }
  
  try {
    await $fetch(`/api/playlists/personal/${route.params.id}/videos`, {
      method: 'POST',
      body: { action: 'remove', videoId }
    });
    toast.success('Video removed from playlist.');
    await fetchPlaylistDetails();
  } catch (e: any) {
    toast.error(e.message || 'Failed to remove video.');
  }
};

const deletePlaylist = async () => {
  try {
    await $fetch(`/api/playlists/personal/${route.params.id}`, { method: 'DELETE' });
    toast.success('Playlist deleted.');
    navigateTo('/playlists');
  } catch (e: any) {
    toast.error(e.message || 'Failed to delete playlist.');
  }
};

const playVideo = (videoId: string) => {
  const tokenQuery = route.query.token ? `&token=${route.query.token}` : '';
  navigateTo(`/watch/${videoId}?playlistId=${playlist.value.id}${tokenQuery}`);
};

const playAll = () => {
  if (videos.value.length) {
    playVideo(videos.value[0].id);
  }
};

const copyShareLink = () => {
  let shareUrl = `${window.location.origin}/playlists/${playlist.value.id}`;
  if (playlist.value.visibility !== 'public' && playlist.value.share_token) {
    shareUrl += `?token=${playlist.value.share_token}`;
  }
  
  navigator.clipboard.writeText(shareUrl).then(() => {
    toast.success('Share link copied to clipboard!');
  }).catch(() => {
    toast.error('Failed to copy link.');
  });
};

const formatDuration = (seconds?: number) => {
  if (!seconds) return '0:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

const formatNumber = (num?: number) => {
  if (!num) return '0';
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return String(num);
};

onMounted(() => {
  fetchPlaylistDetails();
});
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  animation: fadeIn 0.2s ease-out;
}

.modal-card {
  width: 90%;
  max-width: 500px;
  background: #101018; /* slightly dark background */
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
  transform: scale(1);
  animation: modalPop 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
}

@keyframes modalPop {
  0% { transform: scale(0.95); opacity: 0; }
  100% { transform: scale(1); opacity: 1; }
}

.modal-header {
  padding: 16px 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.modal-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.close-modal-btn {
  background: none;
  border: none;
  color: var(--text-secondary);
  font-size: 24px;
  line-height: 1;
  cursor: pointer;
  transition: color 0.2s;
}

.close-modal-btn:hover {
  color: white;
}

.modal-footer {
  padding: 16px 20px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  display: flex;
  justify-content: flex-end;
}

.btn-primary {
  background: var(--accent-primary);
  color: white;
  border: none;
}
.btn-primary:hover {
  opacity: 0.9;
}

.playlist-detail-container {
  max-width: 1200px;
  margin: 0 auto;
  min-height: calc(100vh - var(--header-height));
  animation: fadeIn 0.3s ease-out;
}

.loading-state, .error-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 0;
  gap: 16px;
  color: var(--text-secondary);
}

.spinner {
  width: 40px;
  height: 40px;
  border: 3px solid rgba(255, 255, 255, 0.1);
  border-radius: 50%;
  border-top-color: var(--accent-primary);
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.playlist-grid-layout {
  display: grid;
  grid-template-columns: 320px 1fr;
  gap: 30px;
}

@media (max-width: 768px) {
  .playlist-grid-layout {
    grid-template-columns: 1fr;
  }
}

.playlist-sidebar-info {
  background: rgba(255, 255, 255, 0.03);
  border-radius: var(--border-radius-lg);
  padding: 24px;
  height: fit-content;
  display: flex;
  flex-direction: column;
  gap: 20px;
  position: sticky;
  top: 100px;
}

.sidebar-cover {
  height: 180px;
  background: linear-gradient(135deg, rgba(139, 92, 246, 0.25) 0%, rgba(99, 102, 241, 0.25) 100%);
  border-radius: var(--border-radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
  border: 1px solid rgba(255, 255, 255, 0.05);
  overflow: hidden;
}

.playlist-cover-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.sidebar-details {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.playlist-title {
  font-size: 22px;
  font-weight: 800;
  color: white;
  margin: 0;
  line-height: 1.2;
}

.playlist-meta-tags {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.meta-item {
  color: var(--text-secondary);
}

.playlist-desc {
  font-size: 13.5px;
  color: var(--text-secondary);
  line-height: 1.5;
  white-space: pre-wrap;
}

.playlist-author {
  font-size: 13px;
  color: var(--text-secondary);
  border-top: 1px solid rgba(255, 255, 255, 0.05);
  padding-top: 16px;
}

.sidebar-actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 8px;
}

.btn-play-all {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: white;
  color: black;
  border: none;
  padding: 12px;
  border-radius: 40px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-play-all:hover {
  transform: scale(1.02);
  background: rgba(255, 255, 255, 0.9);
}

.btn-share {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: rgba(255, 255, 255, 0.05);
  color: white;
  border: 1px solid rgba(255, 255, 255, 0.1);
  padding: 11px;
  border-radius: 40px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-share:hover {
  background: rgba(255, 255, 255, 0.1);
}

.visibility-tag {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  padding: 2px 6px;
  border-radius: 4px;
}

.visibility-tag.public {
  background: rgba(16, 185, 129, 0.15);
  color: #10b981;
}

.visibility-tag.unlisted {
  background: rgba(245, 158, 11, 0.15);
  color: #f59e0b;
}

.visibility-tag.private {
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
}

.playlist-videos-section {
  display: flex;
  flex-direction: column;
}

.empty-videos-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px;
  text-align: center;
}

.empty-videos-state p {
  margin: 4px 0;
}

.help-text {
  font-size: 13px;
  color: var(--text-secondary);
}

.videos-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.video-row {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  border-radius: var(--border-radius-md);
  cursor: pointer;
  transition: all 0.2s;
  gap: 16px;
}

.video-row:hover {
  background: rgba(255, 255, 255, 0.05);
  border-color: rgba(255, 255, 255, 0.12);
}

.video-index {
  width: 24px;
  color: var(--text-secondary);
  font-weight: 600;
  text-align: center;
  font-size: 14px;
}

.video-thumbnail-container {
  width: 120px;
  aspect-ratio: 16/9;
  border-radius: 6px;
  overflow: hidden;
  position: relative;
  background: rgba(0, 0, 0, 0.2);
  flex-shrink: 0;
}

.video-thumbnail {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.video-thumbnail-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: var(--text-secondary);
}

.video-duration {
  position: absolute;
  bottom: 4px;
  right: 4px;
  background: rgba(0, 0, 0, 0.8);
  color: white;
  font-size: 10px;
  padding: 2px 4px;
  border-radius: 4px;
  font-weight: 600;
}

.video-info {
  flex: 1;
  min-width: 0;
}

.video-title {
  font-size: 14px;
  font-weight: 600;
  color: white;
  margin: 0 0 4px 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.video-channel {
  font-size: 12px;
  color: var(--text-secondary);
  margin: 0 0 2px 0;
}

.video-views {
  font-size: 11px;
  color: var(--text-secondary);
}

.btn-remove-video {
  background: none;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  transition: color 0.2s;
  padding: 6px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.btn-remove-video:hover {
  color: #ef4444;
  background: rgba(239, 68, 68, 0.1);
}

.btn {
  padding: 10px 20px;
  border-radius: 8px;
  font-weight: 600;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-secondary {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: var(--text-primary);
}

.btn-secondary:hover {
  background: rgba(255, 255, 255, 0.1);
}

.mt-4 {
  margin-top: 16px;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}
</style>
