<template>
  <div class="playlists-container">
    <header v-if="playlists.length > 0" class="playlists-header">
      <div>
        <h1 class="page-title">Personal Playlists</h1>
        <p class="page-subtitle">Organize and share your custom video collections</p>
      </div>
      <button class="btn-create" @click="showCreateModal = true">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
        Create Playlist
      </button>
    </header>

    <div v-if="pending" class="loading-state">
      <div class="spinner"></div>
      <p>Loading playlists...</p>
    </div>

    <EmptyState
      v-else-if="!playlists.length"
      title="Your collection starts here"
      description="Create personalized playlists to easily group, organize, and share your favorite videos with others."
      icon="folder"
      action-text="Create your first playlist"
      @action="showCreateModal = true"
    >
      <template #button-icon>
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
      </template>
    </EmptyState>

    <div v-else class="playlists-grid">
      <div 
        v-for="playlist in playlists" 
        :key="playlist.id" 
        class="playlist-card premium-card"
        @click="navigateToPlaylist(playlist)"
      >
        <!-- Thumbnail Wrapper -->
        <div class="thumbnail-wrapper">
          <img v-if="playlist.thumbnail_path" :src="playlist.thumbnail_path" class="thumbnail-img" alt="Playlist cover" />
          <div v-else class="empty-cover-gradient">
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="playlist-center-icon"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
          </div>
          
          <!-- Playlist Badge floating on bottom-right, matching duration-badge -->
          <span class="duration-badge playlist-badge">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-1" style="display: inline-block; vertical-align: middle;"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
            <span style="vertical-align: middle;">{{ playlist.video_count }} videos</span>
          </span>

          <div class="play-hover-overlay">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
            <span>PLAY ALL</span>
          </div>
        </div>

        <!-- Video Info (matching VideoCard structure) -->
        <div class="video-info">
          <div class="avatar-col">
            <div class="owner-avatar">{{ playlist.owner_name.charAt(0) }}</div>
          </div>
          <div class="details-col">
            <div class="card-title-row" style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
              <h4 class="video-title" :title="playlist.title" style="margin: 0; font-size: 15px;">{{ playlist.title }}</h4>
              <span :class="['visibility-tag', playlist.visibility]" style="flex-shrink: 0; font-size: 9px; padding: 2px 6px;">
                {{ playlist.visibility }}
              </span>
            </div>
            
            <p class="channel-title" style="margin: 2px 0 0 0;">by {{ playlist.owner_name }}</p>
            
            <div class="metadata-row" style="margin-top: 4px;">
              <span>{{ formatDate(playlist.created_at) }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Create Playlist Modal -->
    <BaseModal :show="showCreateModal" title="Create New Playlist" @close="showCreateModal = false">
      <form @submit.prevent="handleCreatePlaylist">
        <div class="form-group">
          <label for="title">Title *</label>
          <input 
            type="text" 
            id="title" 
            v-model="newPlaylist.title" 
            placeholder="e.g. My Favorite Science Videos" 
            required 
            class="form-input"
          />
        </div>
        <div class="form-group" style="margin-top: 16px;">
          <label for="description">Description</label>
          <textarea 
            id="description" 
            v-model="newPlaylist.description" 
            placeholder="Give your playlist a short description..." 
            rows="3" 
            class="form-input"
          ></textarea>
        </div>
        <div class="form-group" style="margin-top: 16px;">
          <label for="visibility">Visibility</label>
          <select id="visibility" v-model="newPlaylist.visibility" class="form-input">
            <option value="private">Private (Only you)</option>
            <option value="unlisted">Unlisted (Anyone with share link)</option>
            <option value="public">Public (Everyone can see)</option>
          </select>
        </div>
        <div class="modal-footer" style="margin-top: 24px; padding: 0; border: none;">
          <button type="button" class="btn btn-secondary" @click="showCreateModal = false">Cancel</button>
          <button type="submit" class="btn btn-primary" :disabled="creating">
            {{ creating ? 'Creating...' : 'Create' }}
          </button>
        </div>
      </form>
    </BaseModal>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useAuth } from '~/composables/useAuth';
import { useToast } from '~/composables/useToast';

const { user, isAdmin } = useAuth();
const toast = useToast();

const playlists = ref<any[]>([]);
const pending = ref(true);
const showCreateModal = ref(false);
const creating = ref(false);

const newPlaylist = ref({
  title: '',
  description: '',
  visibility: 'private'
});

const fetchPlaylists = async () => {
  pending.value = true;
  try {
    const data = await $fetch<any>('/api/playlists/personal');
    playlists.value = data.playlists || [];
  } catch (e: any) {
    toast.error(e.message || 'Failed to load playlists.');
  } finally {
    pending.value = false;
  }
};

const handleCreatePlaylist = async () => {
  creating.value = true;
  try {
    await $fetch<any>('/api/playlists/personal', {
      method: 'POST',
      body: newPlaylist.value
    });
    
    toast.success('Playlist created successfully!');
    
    showCreateModal.value = false;
    newPlaylist.value = { title: '', description: '', visibility: 'private' };
    await fetchPlaylists();
  } catch (e: any) {
    toast.error(e.message || 'Failed to create playlist.');
  } finally {
    creating.value = false;
  }
};


const formatDate = (timestamp: any) => {
  if (!timestamp) return 'Unknown date';
  const date = new Date(Number(timestamp));
  if (isNaN(date.getTime())) return String(timestamp);
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

const navigateToPlaylist = (playlist: any) => {
  navigateTo(`/playlists/${playlist.id}`);
};

onMounted(() => {
  fetchPlaylists();
});
</script>

<style scoped>
.playlists-container {
  width: 100%;
  animation: fadeIn 0.3s ease-out;
}

.playlists-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 30px;
}


.page-subtitle {
  color: var(--text-secondary);
  font-size: 14px;
  margin-top: 4px;
}

.btn-create {
  display: flex;
  align-items: center;
  gap: 8px;
  background: linear-gradient(135deg, var(--accent-primary) 0%, var(--accent-secondary) 100%);
  color: white;
  border: none;
  padding: 10px 20px;
  border-radius: 40px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 4px 15px var(--accent-primary-glow);
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

.btn-create:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 20px var(--accent-primary-glow);
}

.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 0;
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

.playlists-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 24px;
}

@media (max-width: 992px) {
  .playlists-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 576px) {
  .playlists-grid {
    grid-template-columns: 1fr;
  }
}

.playlist-card {
  display: flex;
  flex-direction: column;
  border-radius: var(--border-radius-lg);
  overflow: hidden;
  cursor: pointer;
  background: linear-gradient(145deg, rgba(30, 30, 50, 0.6) 0%, rgba(15, 15, 25, 0.7) 100%);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
  transition: all 0.4s cubic-bezier(0.25, 1, 0.5, 1);
}

.playlist-card:hover {
  transform: translateY(-6px) scale(1.02);
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.6), 0 0 30px rgba(139, 92, 246, 0.15);
  border-color: rgba(139, 92, 246, 0.3);
  background: linear-gradient(145deg, rgba(40, 40, 65, 0.7) 0%, rgba(20, 20, 35, 0.8) 100%);
}

.thumbnail-wrapper {
  position: relative;
  aspect-ratio: 16/9;
  border-radius: var(--border-radius-md);
  overflow: hidden;
  background: #000;
  border: 1px solid transparent;
  transition: all 0.3s ease;
  width: 100%;
}

.thumbnail-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.5s cubic-bezier(0.25, 1, 0.5, 1);
}

.empty-cover-gradient {
  width: 100%;
  height: 100%;
  background: linear-gradient(135deg, rgba(139, 92, 246, 0.25) 0%, rgba(99, 102, 241, 0.25) 100%);
  display: flex;
  align-items: center;
  justify-content: center;
}

.playlist-center-icon {
  color: rgba(255, 255, 255, 0.4);
  filter: drop-shadow(0 0 8px rgba(139, 92, 246, 0.3));
  transition: all 0.3s ease;
}

.playlist-card:hover .playlist-center-icon {
  transform: scale(1.1);
  color: rgba(255, 255, 255, 0.6);
}

.playlist-badge {
  position: absolute;
  bottom: 8px;
  right: 8px;
  background: rgba(0, 0, 0, 0.8);
  color: white;
  padding: 4px 8px;
  border-radius: var(--border-radius-sm);
  font-size: 11px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 4px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  z-index: 2;
  transition: all 0.3s ease;
}

.play-hover-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(2px);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  opacity: 0;
  transition: all 0.3s ease;
  color: white;
  font-weight: 700;
  font-size: 12px;
  letter-spacing: 0.05em;
  z-index: 3;
}

.playlist-card:hover .play-hover-overlay {
  opacity: 1;
}

.playlist-card:hover .playlist-thumbnail {
  transform: scale(1.05);
}

.playlist-card:hover .playlist-badge {
  opacity: 0;
  transform: translateY(5px);
}

.video-info {
  display: flex;
  gap: 12px;
  padding: 12px;
}

.avatar-col {
  flex-shrink: 0;
}

.owner-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 14px;
  font-weight: 700;
  text-transform: uppercase;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.details-col {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  min-width: 0;
}

.card-title-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8px;
}

.video-title {
  font-family: var(--font-title);
  font-size: 15px;
  line-height: 1.4;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
}

.channel-title {
  font-size: 13px;
  color: var(--text-secondary);
  font-weight: 500;
  margin: 0;
}

.metadata-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-secondary);
}

.visibility-tag {
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  padding: 2px 6px;
  border-radius: 12px;
  letter-spacing: 0.05em;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.visibility-tag.public {
  background: rgba(16, 185, 129, 0.1);
  color: #34d399;
  border: 1px solid rgba(16, 185, 129, 0.2);
}

.visibility-tag.unlisted {
  background: rgba(245, 158, 11, 0.1);
  color: #fbbf24;
  border: 1px solid rgba(245, 158, 11, 0.2);
}

.visibility-tag.private {
  background: rgba(239, 68, 68, 0.1);
  color: #f87171;
  border: 1px solid rgba(239, 68, 68, 0.2);
}


/* Modal styling */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  animation: fadeIn 0.2s ease-out;
}

.modal-card {
  width: 460px;
  max-width: 90%;
  border-radius: var(--border-radius-lg);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.modal-header {
  padding: 18px 24px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid var(--border-color);
}

.modal-header h3 {
  font-size: 16px;
  font-weight: 700;
  margin: 0;
  color: white;
}

.close-modal-btn {
  background: none;
  border: none;
  font-size: 24px;
  color: var(--text-secondary);
  cursor: pointer;
  transition: color 0.2s;
  line-height: 1;
}

.close-modal-btn:hover {
  color: white;
}

.modal-body {
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}


.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 8px;
}



.mt-4 {
  margin-top: 16px;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.animate-pop {
  animation: popIn 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
}

@keyframes popIn {
  from { transform: scale(0.95); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
}
</style>
