<template>
  <div class="playlists-container">
    <header class="playlists-header">
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

    <div v-else-if="!playlists.length" class="empty-state-modern">
      <div class="empty-state-visual">
        <div class="glow-orb orb-1"></div>
        <div class="glow-orb orb-2"></div>
        <div class="icon-container">
          <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="main-icon"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path><line x1="12" y1="11" x2="12" y2="17"></line><line x1="9" y1="14" x2="15" y2="14"></line></svg>
        </div>
      </div>
      <div class="empty-state-content">
        <h2 class="empty-title">Your collection starts here</h2>
        <p class="empty-desc">Create personalized playlists to easily group, organize, and share your favorite videos with others.</p>
        <button class="btn-create-pulse" @click="showCreateModal = true">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
          Create your first playlist
        </button>
      </div>
    </div>

    <div v-else class="playlists-grid">
      <div 
        v-for="playlist in playlists" 
        :key="playlist.id" 
        class="playlist-card glass-panel"
        @click="navigateToPlaylist(playlist)"
      >
        <div class="card-cover">
          <div class="stack-layer layer-3"></div>
          <div class="stack-layer layer-2"></div>
          <div class="stack-layer layer-1">
            <div class="cover-content">
              <img v-if="playlist.thumbnail_path" :src="playlist.thumbnail_path" class="playlist-thumbnail" alt="Playlist cover" />
              <img v-else src="/default-playlist.png" class="playlist-thumbnail" alt="Empty Playlist Pattern" />
              <div class="play-overlay">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
              </div>
            </div>
            <span class="video-count-badge">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
              {{ playlist.video_count }}
            </span>
          </div>
        </div>

        <div class="card-content">
          <div class="card-title-row">
            <h3 class="playlist-title">{{ playlist.title }}</h3>
            <span :class="['visibility-tag', playlist.visibility]">
              <svg v-if="playlist.visibility === 'private'" xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
              <svg v-else-if="playlist.visibility === 'unlisted'" xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
              <svg v-else xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>
              {{ playlist.visibility }}
            </span>
          </div>
          <p v-if="playlist.description" class="playlist-description">{{ playlist.description }}</p>
          <div class="card-footer">
            <div class="owner-info">
              <div class="owner-avatar">{{ playlist.owner_name.charAt(0) }}</div>
              <span class="owner-name">by {{ playlist.owner_name }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Create Playlist Modal -->
    <div v-if="showCreateModal" class="modal-overlay" @click="showCreateModal = false">
      <div class="modal-card glass-panel animate-pop" @click.stop>
        <div class="modal-header">
          <h3>Create New Playlist</h3>
          <button class="close-modal-btn" @click="showCreateModal = false">&times;</button>
        </div>
        <form @submit.prevent="handleCreatePlaylist" class="modal-body">
          <div class="form-group">
            <label for="title">Title *</label>
            <input 
              type="text" 
              id="title" 
              v-model="newPlaylist.title" 
              placeholder="e.g. My Favorite Science Videos" 
              required 
              class="form-control"
            />
          </div>
          <div class="form-group">
            <label for="description">Description</label>
            <textarea 
              id="description" 
              v-model="newPlaylist.description" 
              placeholder="Give your playlist a short description..." 
              rows="3" 
              class="form-control"
            ></textarea>
          </div>
          <div class="form-group">
            <label for="visibility">Visibility</label>
            <select id="visibility" v-model="newPlaylist.visibility" class="form-control">
              <option value="private">Private (Only you)</option>
              <option value="unlisted">Unlisted (Anyone with share link)</option>
              <option value="public">Public (Everyone can see)</option>
            </select>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" @click="showCreateModal = false">Cancel</button>
            <button type="submit" class="btn btn-primary" :disabled="creating">
              {{ creating ? 'Creating...' : 'Create' }}
            </button>
          </div>
        </form>
      </div>
    </div>
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


const navigateToPlaylist = (playlist: any) => {
  navigateTo(`/playlists/${playlist.id}`);
};

onMounted(() => {
  fetchPlaylists();
});
</script>

<style scoped>
.playlists-container {
  max-width: 1200px;
  margin: 0 auto;
  min-height: calc(100vh - var(--header-height));
  animation: fadeIn 0.3s ease-out;
}

.playlists-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 30px;
}

.page-title {
  font-size: 28px;
  font-weight: 800;
  background: linear-gradient(135deg, #ffffff 0%, #a78bfa 100%);
  background-clip: text;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
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

.empty-state-modern {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 80px 20px;
  margin: 40px auto;
  max-width: 600px;
  position: relative;
  z-index: 1;
}

.empty-state-visual {
  position: relative;
  width: 160px;
  height: 160px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 32px;
}

.glow-orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(30px);
  z-index: -1;
  opacity: 0.6;
  animation: float 6s ease-in-out infinite;
}

.orb-1 {
  width: 120px;
  height: 120px;
  background: linear-gradient(135deg, rgba(139, 92, 246, 0.8), rgba(99, 102, 241, 0.4));
  top: -10px;
  left: -10px;
  animation-delay: 0s;
}

.orb-2 {
  width: 100px;
  height: 100px;
  background: linear-gradient(135deg, rgba(236, 72, 153, 0.6), rgba(139, 92, 246, 0.4));
  bottom: -10px;
  right: -10px;
  animation-delay: -3s;
}

@keyframes float {
  0% { transform: translateY(0) scale(1); }
  50% { transform: translateY(-15px) scale(1.05); }
  100% { transform: translateY(0) scale(1); }
}

.icon-container {
  width: 90px;
  height: 90px;
  background: rgba(17, 17, 34, 0.6);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  backdrop-filter: blur(12px);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
  color: white;
  transform: rotate(-5deg);
  transition: transform 0.4s;
}

.empty-state-modern:hover .icon-container {
  transform: rotate(0deg) scale(1.05);
}

.main-icon {
  color: rgba(255, 255, 255, 0.9);
}

.empty-state-content {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.empty-title {
  font-size: 24px;
  font-weight: 700;
  margin: 0 0 12px 0;
  background: linear-gradient(135deg, #ffffff 0%, #a78bfa 100%);
  background-clip: text;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.empty-desc {
  font-size: 16px;
  color: var(--text-secondary);
  line-height: 1.6;
  margin-bottom: 36px;
  max-width: 420px;
}

.btn-create-pulse {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  background: linear-gradient(135deg, var(--accent-primary) 0%, var(--accent-secondary) 100%);
  color: white;
  border: none;
  padding: 16px 32px;
  border-radius: 40px;
  font-weight: 700;
  font-size: 16px;
  cursor: pointer;
  transition: all 0.3s;
  box-shadow: 0 10px 25px rgba(139, 92, 246, 0.3);
}

.btn-create-pulse::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  border-radius: 40px;
  box-shadow: 0 0 0 0 rgba(139, 92, 246, 0.7);
  animation: pulse-ring 2s cubic-bezier(0.215, 0.61, 0.355, 1) infinite;
  pointer-events: none;
}

@keyframes pulse-ring {
  0% { box-shadow: 0 0 0 0 rgba(139, 92, 246, 0.5); }
  70% { box-shadow: 0 0 0 15px rgba(139, 92, 246, 0); }
  100% { box-shadow: 0 0 0 0 rgba(139, 92, 246, 0); }
}

.btn-create-pulse:hover {
  transform: translateY(-2px);
  box-shadow: 0 15px 30px rgba(139, 92, 246, 0.4);
}

.playlists-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 24px;
}

.playlist-card {
  border-radius: var(--border-radius-lg);
  overflow: hidden;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  transition: all 0.4s cubic-bezier(0.25, 1, 0.5, 1);
  background: linear-gradient(145deg, rgba(30, 30, 50, 0.7) 0%, rgba(15, 15, 25, 0.8) 100%);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
}

.playlist-card:hover {
  transform: translateY(-8px) scale(1.02);
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.6), 0 0 30px rgba(139, 92, 246, 0.2);
  border-color: rgba(139, 92, 246, 0.4);
  background: linear-gradient(145deg, rgba(40, 40, 65, 0.8) 0%, rgba(20, 20, 35, 0.9) 100%);
}

.card-cover {
  height: 160px;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: transparent;
  perspective: 1000px;
}

.stack-layer {
  position: absolute;
  top: 16px;
  left: 16px;
  right: 16px;
  bottom: 16px;
  border-radius: var(--border-radius-md);
  transition: all 0.4s cubic-bezier(0.25, 1, 0.5, 1);
}

.layer-3 {
  background: rgba(139, 92, 246, 0.2);
  transform: translateY(-10px) scale(0.85);
  z-index: 1;
  box-shadow: 0 -5px 15px rgba(139, 92, 246, 0.1);
}

.layer-2 {
  background: rgba(236, 72, 153, 0.25);
  transform: translateY(-5px) scale(0.92);
  z-index: 2;
  box-shadow: 0 -5px 15px rgba(236, 72, 153, 0.1);
}

.layer-1 {
  background: linear-gradient(135deg, rgba(139, 92, 246, 0.6) 0%, rgba(99, 102, 241, 0.6) 100%);
  border: 1px solid rgba(255, 255, 255, 0.2);
  z-index: 3;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  box-shadow: 0 15px 30px rgba(0,0,0,0.4);
  backdrop-filter: blur(8px);
}

.playlist-card:hover .layer-3 {
  transform: translateY(-18px) scale(0.85);
  background: rgba(139, 92, 246, 0.35);
}

.playlist-card:hover .layer-2 {
  transform: translateY(-9px) scale(0.92);
  background: rgba(236, 72, 153, 0.4);
}

.playlist-card:hover .layer-1 {
  transform: translateY(0) scale(1);
  background: linear-gradient(135deg, rgba(139, 92, 246, 0.8) 0%, rgba(99, 102, 241, 0.8) 100%);
}

.cover-content {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
}

.playlist-thumbnail {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0.85;
  transition: all 0.4s;
}

.playlist-card:hover .playlist-thumbnail {
  opacity: 1;
  transform: scale(1.05);
}

.playlist-icon {
  color: rgba(255, 255, 255, 0.7);
  transition: all 0.3s;
}

.play-overlay {
  position: absolute;
  width: 48px;
  height: 48px;
  background: rgba(255, 255, 255, 0.2);
  backdrop-filter: blur(4px);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transform: scale(0.8);
  transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
  color: white;
}

.playlist-card:hover .play-overlay {
  opacity: 1;
  transform: scale(1);
}

.playlist-card:hover .playlist-icon {
  opacity: 0;
  transform: scale(1.2);
}

.video-count-badge {
  position: absolute;
  bottom: 8px;
  right: 8px;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(8px);
  padding: 4px 10px;
  border-radius: 20px;
  font-size: 11px;
  font-weight: 600;
  color: white;
  border: 1px solid rgba(255, 255, 255, 0.1);
  display: flex;
  align-items: center;
  gap: 4px;
}

.card-content {
  padding: 16px;
  display: flex;
  flex-direction: column;
  flex: 1;
}

.card-title-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: 6px;
}

.playlist-title {
  font-family: var(--font-title);
  font-size: 18px;
  font-weight: 700;
  color: white;
  margin: 0;
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  letter-spacing: -0.01em;
}

.visibility-tag {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  padding: 3px 8px;
  border-radius: 12px;
  letter-spacing: 0.05em;
  display: flex;
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

.playlist-description {
  font-size: 13px;
  color: var(--text-secondary);
  margin: 0 0 16px 0;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}

.card-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: auto;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  padding-top: 14px;
}

.owner-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.owner-avatar {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
}

.owner-name {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
}

.btn-delete {
  background: rgba(239, 68, 68, 0.05);
  border: 1px solid rgba(239, 68, 68, 0.1);
  color: #ef4444;
  cursor: pointer;
  transition: all 0.2s;
  padding: 6px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.btn-delete:hover {
  background: rgba(239, 68, 68, 0.2);
  color: white;
  border-color: rgba(239, 68, 68, 0.4);
  transform: scale(1.05);
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

.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-group label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
}

.form-control {
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.1);
  padding: 10px 14px;
  border-radius: 8px;
  color: white;
  font-size: 14px;
  transition: all 0.2s;
}

.form-control:focus {
  border-color: var(--accent-primary);
  box-shadow: 0 0 8px var(--accent-primary-glow);
  outline: none;
}

textarea.form-control {
  resize: vertical;
}

select.form-control {
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
  background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e");
  background-repeat: no-repeat;
  background-position: right 14px center;
  background-size: 16px;
  padding-right: 40px;
}

select.form-control option {
  background: #111;
  color: white;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 8px;
}

.btn {
  padding: 10px 20px;
  border-radius: 8px;
  font-weight: 600;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-secondary {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: var(--text-primary);
}

.btn-secondary:hover {
  background: rgba(255, 255, 255, 0.1);
}

.btn-primary {
  background: var(--accent-primary);
  border: none;
  color: white;
  box-shadow: 0 2px 8px var(--accent-primary-glow);
}

.btn-primary:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px var(--accent-primary-glow);
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
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
