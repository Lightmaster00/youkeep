<template>
  <div class="video-dropdown-container" @click.stop>
    <button class="btn-dropdown-toggle" @click.stop="toggleMenu" aria-label="More options">
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="1.5"></circle><circle cx="19" cy="12" r="1.5"></circle><circle cx="5" cy="12" r="1.5"></circle></svg>
    </button>

    <transition name="dropdown-fade">
      <div v-if="isOpen" class="dropdown-menu glass-panel">
        <button class="dropdown-item" @click="openPlaylistModal">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/><line x1="12" y1="7" x2="12" y2="13"/><line x1="15" y1="10" x2="9" y2="10"/></svg>
          Save
        </button>
        <button v-if="video?.local_video_path" class="dropdown-item" @click="downloadVideo">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Download
        </button>
        <div class="dropdown-divider"></div>
        <button class="dropdown-item text-danger" @click="reportVideo">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>
          Report
        </button>
      </div>
    </transition>

    <!-- Playlist Selection Modal -->
    <Teleport to="body">
      <div v-if="isPlaylistModalOpen" class="modal-overlay" @click="closePlaylistModal">
        <div class="modal-card glass-panel" @click.stop>
          <div class="modal-header">
            <h3>Add to Playlist</h3>
            <button class="btn-close" @click="closePlaylistModal">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
          </div>
          <div class="modal-body">
            <div v-if="fetchingPlaylists" class="loading-state">
              <div class="spinner-sm"></div>
              <span>Loading playlists...</span>
            </div>
            <div v-else-if="playlists.length === 0" class="empty-state">
              <p>You don't have any playlists yet.</p>
            </div>
            <ul v-else class="playlist-list">
              <li v-for="playlist in playlists" :key="playlist.id" class="playlist-list-item">
                <label class="checkbox-label">
                  <input 
                    type="checkbox" 
                    :checked="playlist.contains_video" 
                    @change="togglePlaylist(playlist, ($event.target as HTMLInputElement).checked)"
                  />
                  <span class="playlist-name">{{ playlist.title }}</span>
                  <span class="visibility-icon">
                    <svg v-if="playlist.visibility === 'private'" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                    <svg v-else-if="playlist.visibility === 'unlisted'" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
                    <svg v-else xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>
                  </span>
                </label>
              </li>
            </ul>

            <div class="create-playlist-inline mt-2" style="margin-top: auto !important;">
              <button v-if="!showInlineForm" @click="showInlineForm = true" class="btn btn-secondary" style="width: 100%; justify-content: center;">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                Create new playlist
              </button>
              <div v-else class="inline-form" style="display: flex; flex-direction: column; gap: 8px;">
                <input v-model="newPlaylistTitle" class="form-input" placeholder="Playlist title" style="padding: 8px 12px; font-size: 13px;" />
                <select v-model="newPlaylistVisibility" class="form-input" style="padding: 8px 12px; font-size: 13px;">
                  <option value="private">Private</option>
                  <option value="unlisted">Unlisted</option>
                  <option value="public">Public</option>
                </select>
                <div style="display: flex; gap: 8px; margin-top: 4px;">
                  <button @click="createPlaylist" :disabled="!newPlaylistTitle || creatingPlaylist" class="btn btn-primary" style="flex: 1; justify-content: center;">
                    {{ creatingPlaylist ? 'Creating...' : 'Create' }}
                  </button>
                  <button @click="showInlineForm = false" class="btn btn-secondary" style="justify-content: center;">Cancel</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { useToast } from '~/composables/useToast';

const props = defineProps<{
  video: { id: string; local_video_path?: string }
}>();

const emit = defineEmits(['hidden']);
const toast = useToast();

const isOpen = ref(false);
const isPlaylistModalOpen = ref(false);
const playlists = ref<any[]>([]);
const fetchingPlaylists = ref(false);

const showInlineForm = ref(false);
const newPlaylistTitle = ref('');
const newPlaylistVisibility = ref('private');
const creatingPlaylist = ref(false);

const toggleMenu = () => {
  isOpen.value = !isOpen.value;
};

const closeMenu = () => {
  isOpen.value = false;
};

// Global click listener to close dropdown
const handleClickOutside = (e: MouseEvent) => {
  const target = e.target as HTMLElement;
  if (!target.closest('.video-dropdown-container')) {
    closeMenu();
  }
};

onMounted(() => {
  document.addEventListener('click', handleClickOutside);
});

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside);
});

const downloadVideo = () => {
  closeMenu();
  if (props.video.local_video_path) {
    const a = document.createElement('a');
    a.href = props.video.local_video_path;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    toast.success('Download started');
  } else {
    toast.error('Video file not available for download');
  }
};



const reportVideo = async () => {
  closeMenu();
  try {
    await $fetch(`/api/videos/${props.video.id}/report`, { 
      method: 'POST',
      body: { reason: 'User reported this video' }
    });
    toast.success('Video reported successfully');
  } catch (e) {
    toast.error('Failed to report video');
  }
};

const openPlaylistModal = async () => {
  closeMenu();
  isPlaylistModalOpen.value = true;
  fetchingPlaylists.value = true;
  try {
    const data = await $fetch(`/api/playlists/personal?videoId=${props.video.id}`);
    playlists.value = data.playlists || [];
  } catch (e) {
    toast.error('Failed to load playlists');
  } finally {
    fetchingPlaylists.value = false;
  }
};

const closePlaylistModal = () => {
  isPlaylistModalOpen.value = false;
};

const togglePlaylist = async (playlist: any, checked: boolean) => {
  try {
    await $fetch(`/api/playlists/personal/${playlist.id}/videos`, {
      method: 'POST',
      body: {
        videoId: props.video.id,
        action: checked ? 'add' : 'remove'
      }
    });
    playlist.contains_video = checked;
    if (checked) {
      toast.success(`Added to ${playlist.title}`);
    } else {
      toast.info(`Removed from ${playlist.title}`);
    }
  } catch (e) {
    toast.error('Failed to update playlist');
    // Revert checkbox state visually if failed
    playlist.contains_video = !checked;
  }
};

const createPlaylist = async () => {
  if (!newPlaylistTitle.value.trim()) return;
  creatingPlaylist.value = true;
  try {
    const response = await $fetch<any>('/api/playlists/personal', {
      method: 'POST',
      body: {
        title: newPlaylistTitle.value.trim(),
        visibility: newPlaylistVisibility.value,
        description: ''
      }
    });
    
    const newPl = response.playlist;
    
    // Automatically add this video to the new playlist
    await togglePlaylist(newPl, true); 
    
    // Add to local list at the top so it's immediately visible
    playlists.value.unshift(newPl);
    
    // Reset form
    newPlaylistTitle.value = '';
    newPlaylistVisibility.value = 'private';
    showInlineForm.value = false;
  } catch (e: any) {
    toast.error(e.data?.statusMessage || 'Failed to create playlist');
  } finally {
    creatingPlaylist.value = false;
  }
};
</script>

<style scoped>
.video-dropdown-container {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 10;
}

.btn-dropdown-toggle {
  background: rgba(0, 0, 0, 0.6);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: white;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  backdrop-filter: blur(4px);
  transition: all 0.2s;
  opacity: 1; /* always visible */
}



.btn-dropdown-toggle:hover,
.btn-dropdown-toggle:focus {
  background: rgba(139, 92, 246, 0.8);
  border-color: rgba(139, 92, 246, 1);
  opacity: 1;
}

.dropdown-menu {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 4px;
  width: 180px;
  background: rgba(20, 20, 35, 0.95);
  border-radius: 12px;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  box-shadow: 0 10px 40px rgba(0,0,0,0.8);
  border: 1px solid rgba(255,255,255,0.08);
  transform-origin: top right;
}

.dropdown-fade-enter-active,
.dropdown-fade-leave-active {
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}
.dropdown-fade-enter-from,
.dropdown-fade-leave-to {
  opacity: 0;
  transform: scale(0.95) translateY(-5px);
}

.dropdown-item {
  background: transparent;
  border: none;
  color: rgba(255, 255, 255, 0.85);
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  transition: all 0.2s;
  text-align: left;
  width: 100%;
}

.dropdown-item svg {
  color: rgba(255, 255, 255, 0.5);
  transition: color 0.2s;
}

.dropdown-item:hover {
  background: rgba(255, 255, 255, 0.08);
  color: white;
}

.dropdown-item:hover svg {
  color: white;
}

.dropdown-divider {
  height: 1px;
  background: rgba(255, 255, 255, 0.06);
  margin: 4px 0;
}

.text-danger {
  color: #f87171 !important;
}
.text-danger svg {
  color: #f87171 !important;
}
.text-danger:hover {
  background: rgba(239, 68, 68, 0.15) !important;
  color: #fca5a5 !important;
}

/* Modal styles */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  animation: fadeIn 0.2s ease-out;
}

.modal-card {
  width: 400px;
  max-width: 90%;
  background: var(--bg-surface);
  border-radius: 16px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
}

.modal-header {
  padding: 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.modal-header h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
}

.btn-close {
  background: none;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 4px;
  border-radius: 50%;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.btn-close:hover {
  background: rgba(255, 255, 255, 0.1);
  color: white;
}

.modal-body {
  padding: 20px;
  min-height: 250px;
  max-height: 500px;
  display: flex;
  flex-direction: column;
}

.loading-state, .empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--text-secondary);
  padding: 40px 0;
}

.spinner-sm {
  width: 24px;
  height: 24px;
  border: 2px solid rgba(139, 92, 246, 0.2);
  border-radius: 50%;
  border-top-color: var(--accent-primary);
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.playlist-list {
  list-style: none;
  padding: 0;
  margin: 0 0 16px 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
  overflow-y: auto;
}

.playlist-list-item {
  display: block;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.2s;
}

.checkbox-label:hover {
  background: rgba(255, 255, 255, 0.05);
}

.checkbox-label input[type="checkbox"] {
  width: 18px;
  height: 18px;
  accent-color: var(--accent-primary);
  cursor: pointer;
}

.playlist-name {
  flex: 1;
  font-size: 14px;
  font-weight: 500;
  color: white;
}

.visibility-icon {
  color: var(--text-muted);
  display: flex;
  align-items: center;
}
</style>
