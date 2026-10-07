<template>
  <div class="watch-container">
    <div v-if="pending" class="loading-state">
      <div class="spinner"></div>
      <p>Loading video...</p>
    </div>

    <EmptyState
      v-else-if="error || !video"
      title="Loading Error"
      :description="errorMsg || 'This video was not found or you do not have permission to view it.'"
      icon="video"
      action-text="Back to Home"
      action-route="/"
    />

    <div v-else class="watch-content" :class="{ 'theater-mode': theaterMode }">
      <!-- Left Column (Player + Description) -->
      <div class="player-column">
        <!-- Custom Video Player -->
        <div ref="playerContainerEl">
          <VideoPlayer
            ref="videoPlayerRef"
            :video="video"
            :subtitles="subtitles"
            :chapters="chapters"
            :token="token"
            :has-prev-video="hasPrevVideo"
            :has-next-video="hasNextVideo"
            @ended="handleVideoEnded"
            @prev="playPrevVideo"
            @next="playNextVideo"
            @theater-mode-change="onTheaterModeChange"
          />
        </div>

        <div v-if="showMiniPlayer" class="mini-player" @click="scrollToPlayer">
          <div class="mini-player-thumb">
            <img :src="video.local_thumbnail_path" alt="" />
          </div>
          <div class="mini-player-info">
            <p class="mini-player-title">{{ video.title }}</p>
          </div>
          <button class="mini-player-btn" @click.stop="toggleMiniPlayerPlayback" title="Play/Pause">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="white" stroke="none"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
          </button>
          <button class="mini-player-close" @click.stop="closeMiniPlayer" title="Close">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>

        <!-- Video Header Info -->
        <div class="title-row">
          <h1 class="video-title">{{ video.title }}</h1>
          <span v-if="video.was_live === 1" class="replay-pill">REPLAY</span>
        </div>


        
        <!-- Channel Row -->
        <div class="channel-row">
          <div class="channel-info" @click="navigateToChannel(video.channel_id)">
            <img 
              :src="video.channel_avatar || 'data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 24 24\' fill=\'%23666\'><circle cx=\'12\' cy=\'12\' r=\'10\'></circle><path d=\'M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-3.33 0-10 1.67-10 5v2h20v-2c0-3.33-6.67-5-10-5z\'></path></svg>'" 
              @error="handleAvatarError"
              class="channel-avatar" 
              alt="Avatar"
            />
            <div>
              <h3 class="channel-name">{{ video.channel_title }}</h3>
              <p class="sub-count">Archived in YouKeep</p>
            </div>
          </div>
          
          <div class="action-buttons" style="display: flex; gap: 8px; align-items: center;">
            <button class="btn btn-secondary" @click="shareVideo">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>
              Share
            </button>
            <div class="dropdown-wrapper" ref="dropdownWrapperRef" style="position: relative;">
              <button class="btn btn-secondary" style="width: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center;" @click.stop="toggleWatchOptionsMenu" title="More options">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="1.5"></circle><circle cx="19" cy="12" r="1.5"></circle><circle cx="5" cy="12" r="1.5"></circle></svg>
              </button>
              
              <transition name="dropdown-fade">
                <div v-if="isWatchOptionsMenuOpen" class="watch-options-menu glass-panel" style="position: absolute; right: 0; top: 100%; margin-top: 8px; width: 220px; padding: 8px; border-radius: 12px; z-index: 50; display: flex; flex-direction: column; gap: 4px; box-shadow: 0 10px 40px rgba(0,0,0,0.8); border: 1px solid rgba(255,255,255,0.08);">
                  <button v-if="user" class="dropdown-item" @click="openPlaylistsModalWrapper">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/><line x1="12" y1="7" x2="12" y2="13"/><line x1="15" y1="10" x2="9" y2="10"/></svg>
                    Save
                  </button>
                  <button v-if="video?.local_video_path" class="dropdown-item" @click="downloadLocalCopyWrapper">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    Download
                  </button>
                  <div class="dropdown-divider" style="height: 1px; background: rgba(255, 255, 255, 0.06); margin: 4px 0;"></div>
                  <button class="dropdown-item text-danger" @click="reportWatchVideo">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>
                    Report
                  </button>
                </div>
              </transition>
            </div>
          </div>
        </div>

        <!-- Collapsible Description Box -->
        <div class="description-box glass-panel" :class="{ expanded: descriptionExpanded }">
          <div class="description-meta">
            <span class="view-count">{{ formatViews(video.view_count) }} views</span>
            <span class="meta-dot">•</span>
            <span class="upload-date">{{ formatUploadDate(video.upload_date) }}</span>
            <template v-if="video.like_count">
              <span class="meta-dot">•</span>
              <span class="like-count">👍 {{ formatViews(video.like_count) }} likes</span>
            </template>
          </div>
          
          <p class="description-text">{{ video.description || 'No description available.' }}</p>
          
          <button class="toggle-desc-btn" @click="descriptionExpanded = !descriptionExpanded">
            {{ descriptionExpanded ? 'Show less' : 'Show more' }}
          </button>
        </div>

        <!-- Collapsible Technical Details Box -->
        <div class="tech-details-box glass-panel" :class="{ expanded: techDetailsExpanded }">
          <div class="tech-details-header" @click="techDetailsExpanded = !techDetailsExpanded">
            <div class="tech-details-title-row">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-gradient"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
              <h3 class="tech-details-label">Archive Technical Details</h3>
            </div>
            <svg 
              xmlns="http://www.w3.org/2000/svg" 
              width="14" 
              height="14" 
              viewBox="0 0 24 24" 
              fill="none" 
              stroke="currentColor" 
              stroke-width="2"
              class="chevron-icon"
              :style="techDetailsExpanded ? { transform: 'rotate(180deg)' } : {}"
            ><polyline points="6 9 12 15 18 9"></polyline></svg>
          </div>
          
          <div v-show="techDetailsExpanded" class="tech-details-content">
            <div class="tech-grid">
              <div class="tech-item">
                <span class="tech-label">YouTube ID:</span>
                <code class="tech-value">{{ video.id }}</code>
              </div>
              <div class="tech-item">
                <span class="tech-label">Local Import Date:</span>
                <span class="tech-value">{{ formatTimestamp(video.created_at) }}</span>
              </div>
              <div class="tech-item">
                <span class="tech-label">Disk space occupied:</span>
                <span class="tech-value">{{ formatBytes(video.size_bytes) }}</span>
              </div>
              <div class="tech-item" v-if="video.local_video_path">
                <span class="tech-label">Server path:</span>
                <code class="tech-value" :title="video.local_video_path">{{ video.local_video_path }}</code>
              </div>
              <div class="tech-item">
                <span class="tech-label">Download status:</span>
                <span class="badge badge-completed">{{ video.download_status }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Section Comments -->
        <div class="comments-section glass-panel">
          <h3 class="comments-title">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
            <span>{{ comments.length }} Comments</span>
          </h3>

          <div v-if="comments.length === 0" class="comments-empty">
            No archived comments for this video.
          </div>

          <div v-else class="comments-list">
            <div v-for="comment in comments" :key="comment.id" class="comment-item">
              <img 
                v-if="comment.author_thumbnail" 
                :src="comment.author_thumbnail" 
                class="comment-avatar" 
                alt="Avatar"
              />
              <div v-else class="comment-avatar-fallback">
                {{ comment.author.charAt(0).toUpperCase() }}
              </div>
              <div class="comment-body">
                <div class="comment-header">
                  <span class="comment-author">{{ comment.author }}</span>
                  <span class="comment-time">{{ comment.time_text || 'some time ago' }}</span>
                </div>
                <p class="comment-text">{{ comment.text }}</p>
                <div class="comment-footer">
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path></svg>
                  <span>{{ comment.like_count || 0 }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Right Column (Recommendations Sidebar) -->
      <aside class="sidebar-column">
        <!-- Playlist Sidebar View -->
        <template v-if="playlistId && playlist">
          <div class="playlist-header-sidebar glass-panel" style="padding: 14px; border-radius: var(--border-radius-md); background: rgba(139, 92, 246, 0.05); border: 1px solid rgba(139, 92, 246, 0.15); margin-bottom: 16px;">
            <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--accent-primary); letter-spacing: 0.05em;">Playlist</span>
            <h3 style="font-size: 15px; font-weight: 700; color: white; margin-top: 4px; line-height: 1.3;">{{ playlist.title }}</h3>
            <p style="font-size: 12px; color: var(--text-secondary); margin-top: 4px;">
              {{ playlist.channel_title }} • {{ playlistVideos.findIndex((v: any) => v.id === videoId) + 1 }} / {{ playlistVideos.length }}
            </p>
          </div>

          <div v-if="playlistPending" class="sidebar-loading">
            <div class="spinner"></div>
          </div>

          <div v-else class="recommendations-list playlist-vids-list" style="max-height: 380px; overflow-y: auto; padding-right: 4px; margin-bottom: 20px; display: flex; flex-direction: column; gap: 8px;">
            <div 
              v-for="rel in playlistVideos" 
              :key="rel.id" 
              class="recommendation-card playlist-card-item"
              :class="{ 'active-playlist-item': rel.id === videoId, 'disabled-playlist-item': rel.download_status !== 'completed' }"
              @click="rel.download_status === 'completed' ? navigateTo(`/watch/${rel.id}?playlistId=${playlistId}`) : null"
              style="position: relative; display: flex; gap: 12px; padding: 6px; border-radius: 8px; cursor: pointer; transition: all 0.2s;"
            >
              <span style="display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; color: var(--text-muted); width: 16px; text-align: center; flex-shrink: 0;">
                <span v-if="rel.id === videoId" style="color: var(--accent-primary);">▶</span>
                <span v-else>{{ rel.position }}</span>
              </span>
              
              <div class="rec-thumbnail-wrapper" style="width: 100px; aspect-ratio: 16/9; position: relative; border-radius: 6px; overflow: hidden; flex-shrink: 0;">
                <img :src="rel.local_thumbnail_path || `https://i.ytimg.com/vi/${rel.id}/hqdefault.jpg`" class="rec-thumbnail-img" style="width: 100%; height: 100%; object-fit: cover;" alt="Thumbnail" />
                <span class="rec-duration">{{ formatDuration(rel.duration) }}</span>
                <VideoDropdownMenu :video="rel" @hidden="onVideoHidden" />
              </div>
              
              <div class="rec-info" style="display: flex; flex-direction: column; min-width: 0; flex: 1; justify-content: center;">
                <h4 class="rec-title" :title="rel.title" style="font-size: 12.5px; font-weight: 600; line-height: 1.3; color: white; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">{{ rel.title }}</h4>
                <div class="rec-metadata" style="font-size: 11px; margin-top: 4px;">
                  <span v-if="rel.download_status !== 'completed'" style="color: #ef4444; font-weight: 500;">Not downloaded</span>
                  <span v-else style="color: var(--text-secondary);">Downloaded</span>
                </div>
              </div>
            </div>
          </div>

          <hr style="border: 0; height: 1px; background: rgba(255,255,255,0.06); margin: 20px 0;" />
        </template>

        <h2 class="sidebar-title">{{ playlistId ? 'Other suggestions' : 'Other archived videos' }}</h2>
        
        <div v-if="relatedPending" class="sidebar-loading">
          <div class="spinner"></div>
        </div>

        <div v-else-if="!relatedData?.videos || relatedData.videos.length <= 1" class="sidebar-empty">
          <p>No other archived videos available.</p>
        </div>

        <div v-else class="recommendations-list">
          <div 
            v-for="rel in filteredRelatedVideos" 
            :key="rel.id" 
            class="recommendation-card premium-card"
            @click="playRecommendedVideo(rel.id)"
          >
            <div class="rec-thumbnail-wrapper">
              <img :src="rel.local_thumbnail_path || `https://i.ytimg.com/vi/${rel.id}/hqdefault.jpg`" class="rec-thumbnail-img" alt="Thumbnail" />
              <span class="rec-duration">{{ formatDuration(rel.duration) }}</span>
              <VideoDropdownMenu :video="rel" @hidden="onVideoHidden" />
            </div>
            
            <div class="rec-info">
              <h4 class="rec-title" :title="rel.title">{{ rel.title }}</h4>
              <p class="rec-channel">{{ rel.channel_title }}</p>
              <div class="rec-metadata">
                <span>{{ formatViews(rel.view_count) }} views</span>
                <span>•</span>
                <span>{{ formatUploadDate(rel.upload_date) }}</span>
              </div>
            </div>
          </div>
        </div>
      </aside>
    </div>

    <!-- Modal: Manage Playlists (Save to Playlist) -->
    <div v-if="user && showPlaylistsModal" class="modal-overlay" @click="closePlaylistsModal">
      <div class="modal-card glass-panel" @click.stop>
        <div class="modal-header">
          <h3>Save to Playlist</h3>
          <button class="close-modal-btn" @click="closePlaylistsModal">&times;</button>
        </div>
        
        <div class="modal-body">
          <p class="modal-desc">Select playlists to add or remove "{{ video?.title }}":</p>
          
          <div v-if="loadingPlaylists" class="modal-empty-state">
            Loading playlists...
          </div>
          <div v-else-if="userPlaylists.length === 0" class="modal-empty-state">
            No playlists created yet. Go to <NuxtLink to="/playlists" class="text-accent" @click="closePlaylistsModal">Playlists</NuxtLink> to create one.
          </div>
          
          <div v-else class="modal-categories-list">
            <label v-for="pl in userPlaylists" :key="pl.id" class="modal-check-item">
              <input type="checkbox" :checked="isVideoInPlaylist(pl.id)" @change="togglePlaylistMembership(pl.id, $event)" />
              <div class="check-item-text">
                <span class="check-item-name">{{ pl.title }}</span>
                <span v-if="pl.description" class="check-item-desc">{{ pl.description }}</span>
              </div>
            </label>
          </div>

          <div class="create-playlist-inline mt-4 pt-4" style="border-top: 1px solid rgba(255,255,255,0.08);">
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
        
        <div class="modal-footer">
          <button class="btn btn-primary" @click="closePlaylistsModal">Done</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useToast } from '~/composables/useToast';
import { useAuth } from '~/composables/useAuth';
import VideoPlayer from '~/components/VideoPlayer.vue';

const route = useRoute();
const router = useRouter();
const toast = useToast();
const { user, isAdmin } = useAuth();

const videoId = computed(() => String(route.params.id));
const token = computed(() => route.query.token ? String(route.query.token) : '');

const descriptionExpanded = ref(false);
const techDetailsExpanded = ref(false);

const theaterMode = ref(false);

function onTheaterModeChange(value: boolean) {
  theaterMode.value = value;
}

const showPlaylistsModal = ref(false);
const loadingPlaylists = ref(false);
const userPlaylists = ref<any[]>([]);

const showInlineForm = ref(false);
const newPlaylistTitle = ref('');
const newPlaylistVisibility = ref('private');
const creatingPlaylist = ref(false);

const isWatchOptionsMenuOpen = ref(false);
const dropdownWrapperRef = ref<HTMLElement | null>(null);

const toggleWatchOptionsMenu = () => {
  isWatchOptionsMenuOpen.value = !isWatchOptionsMenuOpen.value;
};

const closeWatchOptionsMenu = () => {
  isWatchOptionsMenuOpen.value = false;
};

const openPlaylistsModalWrapper = () => {
  closeWatchOptionsMenu();
  openPlaylistsModal();
};

const downloadLocalCopyWrapper = () => {
  closeWatchOptionsMenu();
  downloadLocalCopy();
};

const reportWatchVideo = async () => {
  closeWatchOptionsMenu();
  try {
    await $fetch(`/api/videos/${videoId.value}/report`, { 
      method: 'POST',
      body: { reason: 'User reported this video from player options' }
    });
    toast.success('Video reported successfully');
  } catch (e) {
    toast.error('Failed to report video');
  }
};

// Fetch video metadata, comments and categories
const { data: videoResponse, pending, error, refresh: refreshVideo } = await useFetch<{ video: any; comments?: any[]; categories?: any[]; subtitles?: any[]; chapters?: any[] }>(() => {
  return `/api/videos/${videoId.value}${token.value ? `?token=${token.value}` : ''}`;
});
const video = computed(() => videoResponse.value?.video || null);
const comments = computed(() => videoResponse.value?.comments || []);
const subtitles = computed(() => videoResponse.value?.subtitles || []);
const chapters = computed(() => videoResponse.value?.chapters || []);

// Custom error message extractor
const errorMsg = computed(() => {
  if (error.value) {
    return error.value.data?.statusMessage || error.value.message;
  }
  return '';
});

// Fetch other recommended videos (completed only)
const { data: relatedData, pending: relatedPending } = await useFetch<{ videos: any[] }>(() => {
  return `/api/videos?limit=10&status=completed`;
});

// Filter out the currently playing video from the sidebar recommendations list
const filteredRelatedVideos = computed(() => {
  if (!relatedData.value?.videos || !video.value) return [];
  return relatedData.value.videos.filter(v => v.id !== video.value.id);
});

const playlistId = computed(() => route.query.playlistId ? String(route.query.playlistId) : '');

// Fetch playlist details and videos
const { data: playlistData, pending: playlistPending } = await useAsyncData<any>(
  'watch-playlist-data',
  () => playlistId.value ? $fetch<any>(`/api/playlists/${playlistId.value}` as any) : Promise.resolve(null),
  { immediate: !!playlistId.value, watch: [playlistId] }
);

const playlist = computed(() => playlistData.value?.playlist || null);
const playlistVideos = computed(() => playlistData.value?.videos || []);

const hasPrevVideo = computed(() => {
  if (!playlistId.value || playlistVideos.value.length === 0) return false;
  const idx = playlistVideos.value.findIndex((v: any) => v.id === videoId.value);
  return idx > 0 && playlistVideos.value[idx - 1].download_status === 'completed';
});

const hasNextVideo = computed(() => {
  if (!playlistId.value || playlistVideos.value.length === 0) return false;
  const idx = playlistVideos.value.findIndex((v: any) => v.id === videoId.value);
  return idx >= 0 && idx < playlistVideos.value.length - 1 && playlistVideos.value[idx + 1].download_status === 'completed';
});

const playPrevVideo = () => {
  if (!playlistId.value) return;
  const idx = playlistVideos.value.findIndex((v: any) => v.id === videoId.value);
  if (idx > 0) {
    const prevVideo = playlistVideos.value[idx - 1];
    navigateTo(`/watch/${prevVideo.id}?playlistId=${playlistId.value}`);
  }
};

const playNextVideo = () => {
  if (!playlistId.value) return;
  const idx = playlistVideos.value.findIndex((v: any) => v.id === videoId.value);
  if (idx >= 0 && idx < playlistVideos.value.length - 1) {
    const nextVideo = playlistVideos.value[idx + 1];
    navigateTo(`/watch/${nextVideo.id}?playlistId=${playlistId.value}`);
  }
};

let autoNextTimer: ReturnType<typeof setTimeout> | null = null;

const handleVideoEnded = () => {
  if (playlistId.value && playlistVideos.value.length > 0) {
    const currentIndex = playlistVideos.value.findIndex((v: any) => v.id === videoId.value);
    if (currentIndex >= 0 && currentIndex < playlistVideos.value.length - 1) {
      const nextVideo = playlistVideos.value[currentIndex + 1];
      if (nextVideo.download_status === 'completed') {
        toast.info(`Playing next video: ${nextVideo.title}`);
        autoNextTimer = setTimeout(() => {
          autoNextTimer = null;
          navigateTo(`/watch/${nextVideo.id}?playlistId=${playlistId.value}`);
        }, 1500);
      }
    }
  }
};

// Close the watch-options menu on outside click
const onDocumentClick = (e: MouseEvent) => {
  if (dropdownWrapperRef.value && !dropdownWrapperRef.value.contains(e.target as Node)) {
    closeWatchOptionsMenu();
  }
};

onMounted(() => {
  document.addEventListener('click', onDocumentClick);
});

onUnmounted(() => {
  document.removeEventListener('click', onDocumentClick);
  if (autoNextTimer) {
    clearTimeout(autoNextTimer);
    autoNextTimer = null;
  }
});

// Collapse the description when navigating to a different video
watch(videoId, () => {
  if (autoNextTimer) {
    clearTimeout(autoNextTimer);
    autoNextTimer = null;
  }
  descriptionExpanded.value = false;
});

const navigateToChannel = (channelId: string) => {
  navigateTo(`/channels?channelId=${channelId}`);
};

const playRecommendedVideo = (id: string) => {
  navigateTo(`/watch/${id}`);
};

const shareVideo = () => {
  if (!video.value) return;
  
  let shareUrl = window.location.origin + '/watch/' + video.value.id;
  if (video.value.visibility !== 'public' && video.value.share_token) {
    shareUrl += '?token=' + video.value.share_token;
  }
  
  navigator.clipboard.writeText(shareUrl);
  toast.success('Share link copied to clipboard!');
};

const downloadLocalCopy = () => {
  if (video.value?.local_video_path) {
    const link = document.createElement('a');
    link.href = video.value.local_video_path + (token.value ? '?token=' + token.value : '');
    link.download = `${video.value.title}.mp4`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
};

/* Format Helpers */
const formatTime = (seconds: number): string => {
  if (!seconds || isNaN(seconds)) return '0:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

const formatDuration = (seconds: number | null): string => {
  if (!seconds) return '--:--';
  return formatTime(seconds);
};

const handleAvatarError = (event: Event) => {
  const target = event.target as HTMLImageElement;
  const fallback = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%23666"><circle cx="12" cy="12" r="10"></circle><path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-3.33 0-10 1.67-10 5v2h20v-2c0-3.33-6.67-5-10-5z"></path></svg>';
  if (target && target.src !== fallback) {
    target.src = fallback;
  }
};

const formatViews = (views: number | null): string => {
  if (views === null || views === undefined) return '0';
  if (views >= 1000000) {
    return (views / 1000000).toFixed(1).replace('.0', '') + 'M';
  }
  if (views >= 1000) {
    return (views / 1000).toFixed(1).replace('.0', '') + 'k';
  }
  return views.toString();
};

const formatUploadDate = (dateStr: string | null): string => {
  if (!dateStr || dateStr.length !== 8) return 'Unknown date';
  const year = dateStr.slice(0, 4);
  const month = dateStr.slice(4, 6);
  const day = dateStr.slice(6, 8);
  
  const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
  return date.toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });
};

const openPlaylistsModal = async () => {
  showPlaylistsModal.value = true;
  loadingPlaylists.value = true;
  try {
    const data = await $fetch<any>(`/api/playlists/personal?videoId=${videoId.value}`);
    userPlaylists.value = data.playlists || [];
  } catch (err: any) {
    toast.error('Failed to load playlists.');
  } finally {
    loadingPlaylists.value = false;
  }
};

const closePlaylistsModal = () => {
  showPlaylistsModal.value = false;
};

const isVideoInPlaylist = (playlistId: string) => {
  const pl = userPlaylists.value.find(p => p.id === playlistId);
  return pl ? pl.contains_video === 1 : false;
};

const togglePlaylistMembership = async (playlistId: string, event: Event) => {
  const checkbox = event.target as HTMLInputElement;
  const isChecked = checkbox.checked;
  const action = isChecked ? 'add' : 'remove';
  
  try {
    await $fetch(`/api/playlists/personal/${playlistId}/videos`, {
      method: 'POST',
      body: { action, videoId: videoId.value }
    });
    
    // Update local state
    const pl = userPlaylists.value.find(p => p.id === playlistId);
    if (pl) {
      pl.contains_video = isChecked ? 1 : 0;
    }
    toast.success(isChecked ? 'Added to playlist.' : 'Removed from playlist.');
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Failed to update playlist membership.');
    checkbox.checked = !isChecked; // Revert checkbox state on error
  }
};

const createPlaylist = async () => {
  if (!newPlaylistTitle.value.trim()) return;
  creatingPlaylist.value = true;
  try {
    const { playlist: newPl } = await $fetch<any>('/api/playlists/personal', {
      method: 'POST',
      body: {
        title: newPlaylistTitle.value.trim(),
        visibility: newPlaylistVisibility.value,
        description: ''
      }
    });

    // Add to local list
    userPlaylists.value.push({ ...newPl, contains_video: 1 });

    // Automatically add this video to the new playlist
    await $fetch(`/api/playlists/personal/${newPl.id}/videos`, {
      method: 'POST',
      body: { action: 'add', videoId: videoId.value }
    });
    
    toast.success(`Playlist created and video added!`);
    
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

const formatTimestamp = (ts: number | null): string => {
  if (!ts) return 'Unknown';
  const date = new Date(ts);
  return date.toLocaleString('en-US', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const formatBytes = (bytes: number | null): string => {
  if (bytes === null || bytes === undefined) return 'Inconnu';
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

const onVideoHidden = (id: string) => {
  if (relatedData.value && relatedData.value.videos) {
    relatedData.value.videos = relatedData.value.videos.filter((v: any) => v.id !== id);
  }
};

/* Floating mini-player */
const videoPlayerRef = ref<InstanceType<typeof VideoPlayer> | null>(null);
const showMiniPlayer = ref(false);
const playerContainerEl = ref<HTMLElement | null>(null);

function handleScroll() {
  if (!playerContainerEl.value) return;
  const rect = playerContainerEl.value.getBoundingClientRect();
  const videoEl = videoPlayerRef.value?.videoEl;
  const isPlaying = videoEl && !videoEl.paused;
  showMiniPlayer.value = isPlaying === true && rect.bottom < 0;
}

// The app layout (app/layouts/default.vue) scrolls inside <main class="content-area">
// rather than on window/body, so the scroll listener must be attached to the nearest
// scrollable ancestor of the player (falling back to window if none is found).
let scrollTarget: HTMLElement | Window = window;

function findScrollableAncestor(el: HTMLElement | null): HTMLElement | null {
  let node = el?.parentElement ?? null;
  while (node) {
    const style = getComputedStyle(node);
    if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && node.scrollHeight > node.clientHeight) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

onMounted(() => {
  scrollTarget = findScrollableAncestor(playerContainerEl.value) ?? window;
  scrollTarget.addEventListener('scroll', handleScroll, { passive: true });
});
onUnmounted(() => {
  scrollTarget.removeEventListener('scroll', handleScroll);
});

function closeMiniPlayer() {
  videoPlayerRef.value?.videoEl?.pause();
  showMiniPlayer.value = false;
}

function scrollToPlayer() {
  playerContainerEl.value?.scrollIntoView({ behavior: 'smooth' });
}

function toggleMiniPlayerPlayback() {
  const videoEl = videoPlayerRef.value?.videoEl;
  if (!videoEl) return;
  if (videoEl.paused) videoEl.play(); else videoEl.pause();
}
</script>

<style scoped>
.dropdown-item {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 12px;
  background: none;
  border: none;
  color: var(--text-primary);
  font-size: 14px;
  font-weight: 500;
  text-align: left;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.dropdown-item:hover {
  background: rgba(255, 255, 255, 0.1);
}

.dropdown-item.text-danger {
  color: #ef4444;
}

.dropdown-item.text-danger:hover {
  background: rgba(239, 68, 68, 0.1);
}

.dropdown-fade-enter-active,
.dropdown-fade-leave-active {
  transition: opacity 0.2s, transform 0.2s;
}

.dropdown-fade-enter-from,
.dropdown-fade-leave-to {
  opacity: 0;
  transform: translateY(-5px);
}
.watch-container {
  max-width: 1400px;
  margin: 0 auto;
}

.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 40px;
  text-align: center;
  border-radius: var(--border-radius-md);
  gap: 16px;
  color: var(--text-secondary);
}

.loading-state .spinner {
  width: 36px;
  height: 36px;
  border: 3.5px solid rgba(139, 92, 246, 0.1);
  border-radius: 50%;
  border-top-color: var(--accent-primary);
  animation: spin 0.8s linear infinite;
}

.watch-content {
  display: grid;
  grid-template-columns: 1fr 360px;
  gap: 24px;
}

@media (max-width: 1200px) {
  .watch-content {
    grid-template-columns: 1fr;
  }
}

.watch-content.theater-mode {
  grid-template-columns: 1fr;
}

.watch-content.theater-mode .sidebar-column {
  display: none;
}

.watch-content.theater-mode .player-column {
  max-width: 1400px;
  margin: 0 auto;
  width: 100%;
}

.player-column {
  display: flex;
  flex-direction: column;
  gap: 0;
  min-width: 0;
}

/* ============================================
   PAGE LAYOUT
   ============================================ */

.title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 20px;
}

.video-title {
  font-size: 20px;
  font-weight: 700;
  line-height: 1.4;
}

.replay-pill {
  background: rgba(0, 0, 0, 0.85);
  color: white;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.03em;
  white-space: nowrap;
}



/* Channel Row */
.channel-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 20px;
  padding-bottom: 20px;
  border-bottom: 1px solid var(--border-color);
  gap: 16px;
  flex-wrap: wrap;
}

.channel-info {
  display: flex;
  align-items: center;
  gap: 12px;
  cursor: pointer;
}

.channel-info:hover .channel-name {
  color: white;
  text-decoration: underline;
}

.channel-avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  object-fit: cover;
  background: var(--bg-surface);
}

.channel-name {
  font-size: 15px;
  font-weight: 600;
}

.sub-count {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 2px;
}

/* Action Buttons — proper CSS class instead of inline styles */
.action-buttons {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

/* Description Box */
.description-box {
  padding: 20px;
  margin-top: 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  cursor: pointer;
  transition: background 0.2s;
}

.description-box:hover {
  border-color: rgba(139, 92, 246, 0.3);
  box-shadow: 0 8px 32px rgba(139, 92, 246, 0.1);
}

.description-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-weight: 600;
  font-size: 14px;
  align-items: center;
}

.meta-dot {
  color: var(--text-muted);
}

.description-text {
  font-size: 14px;
  line-height: 1.6;
  white-space: pre-wrap;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  color: var(--text-secondary);
}

.description-box.expanded .description-text {
  display: block;
  overflow: visible;
}

.toggle-desc-btn {
  align-self: flex-start;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  margin-top: 4px;
  cursor: pointer;
}

/* Technical Details panel */
.tech-details-box {
  margin-top: 20px;
  border-radius: var(--border-radius-md);
  border: 1px solid var(--border-color);
  overflow: hidden;
  transition: all 0.3s ease;
}

.tech-details-header {
  padding: 14px 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: pointer;
  background: rgba(255, 255, 255, 0.01);
  transition: background 0.2s;
}

.tech-details-header:hover {
  background: rgba(255, 255, 255, 0.03);
}

.tech-details-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.tech-details-label {
  font-size: 14px;
  font-weight: 700;
  margin: 0;
}

.chevron-icon {
  color: var(--text-secondary);
  transition: transform 0.3s ease;
}

.tech-details-content {
  padding: 16px;
  border-top: 1px solid var(--border-color);
  background: rgba(0, 0, 0, 0.2);
  animation: slideDown 0.25s ease-out;
}

@keyframes slideDown {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}

.tech-grid {
  display: grid;
  /* min(240px, 100%) instead of a bare 240px: minmax()'s minimum is a hard
     floor. Confirmed live: 82px overflow at 320px before this fix, 0px
     after, no-op at wider widths where 240px already fits. */
  grid-template-columns: repeat(auto-fit, minmax(min(240px, 100%), 1fr));
  gap: 16px;
}

.tech-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.tech-label {
  font-size: 11px;
  color: var(--text-muted);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.tech-value {
  font-size: 13px;
  color: var(--text-primary);
  font-weight: 500;
  word-break: break-all;
}

code.tech-value {
  font-family: monospace;
  background: rgba(0, 0, 0, 0.4);
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.05);
}

/* Comments section */
.comments-section {
  margin-top: 24px;
  padding: 24px;
  border-radius: var(--border-radius-md);
}

.comments-title {
  font-size: 16px;
  font-weight: 700;
  margin-bottom: 24px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.comments-empty {
  color: var(--text-secondary);
  font-size: 14px;
  text-align: center;
  padding: 30px 0;
}

.comments-list {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.comment-item {
  display: flex;
  gap: 14px;
  align-items: flex-start;
  padding: 12px;
  border-radius: var(--border-radius-md);
  background: rgba(255, 255, 255, 0.01);
  border: 1px solid transparent;
  transition: all 0.25s;
}

.comment-item:hover {
  background: rgba(255, 255, 255, 0.02);
  border-color: rgba(255, 255, 255, 0.03);
}

.comment-avatar {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.comment-avatar-fallback {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-family: var(--font-title);
  font-size: 14px;
  flex-shrink: 0;
  box-shadow: 0 2px 6px var(--accent-primary-glow);
}

.comment-body {
  flex: 1;
  min-width: 0;
}

.comment-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.comment-author {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.comment-time {
  font-size: 11px;
  color: var(--text-muted);
}

.comment-text {
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-secondary);
  margin: 0;
  white-space: pre-wrap;
}

.comment-footer {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 500;
}

.comment-footer svg {
  transition: color 0.2s;
}

.comment-item:hover .comment-footer svg {
  color: var(--accent-secondary);
}

/* Sidebar */
.sidebar-column {
  display: flex;
  flex-direction: column;
  gap: 16px;
  /* Without this, this column's content floors the width of .watch-content's
     grid track, inflating .watch-container and .content-area past the
     viewport at narrow widths — confirmed live: content-area overflow went
     from 95px to 0px at a 320px viewport once this was added. .player-column,
     this column's sibling, already has this rule. */
  min-width: 0;
}

.sidebar-title {
  font-size: 16px;
  font-weight: 700;
}

.sidebar-loading {
  display: flex;
  justify-content: center;
  padding: 40px 0;
}

.sidebar-loading .spinner {
  width: 24px;
  height: 24px;
  border: 2px solid rgba(139, 92, 246, 0.1);
  border-radius: 50%;
  border-top-color: var(--accent-primary);
  animation: spin 0.8s linear infinite;
}

.sidebar-empty {
  color: var(--text-secondary);
  font-size: 14px;
  padding: 20px 0;
}

.recommendations-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.recommendation-card {
  display: flex;
  flex-direction: row;
  gap: 12px;
  cursor: pointer;
  padding: 8px;
}

.rec-thumbnail-wrapper {
  position: relative;
  width: 168px;
  aspect-ratio: 16/9;
  border-radius: var(--border-radius-md);
  overflow: hidden;
  background: #000;
  flex-shrink: 0;
}

/* The 72px nav rail + 24px content-area padding on each side means content
   width lags viewport width by ~120px, so this tier is keyed on viewport
   width (max-width: 480px) rather than the narrower point where .content-area
   itself first overflows (360px) — that narrower value left a non-monotonic
   gap between 361-480px where the un-shrunk 168px thumbnail squeezed
   .rec-info down to as little as 35px and clipped titles by up to 54px
   (confirmed live: no page-level overflow there, since .rec-info's own
   min-width: 0 and .rec-title's overflow: hidden absorb the squeeze
   silently — but a real, visible readability regression). Shrinking the
   thumbnail, not removing it, keeps the recommendation cards recognizable
   while giving the text column real room. Confirmed live: .rec-info goes
   from 49px (title clipped 19px) to 117px (title clipped 0) at 375px with
   this tier active, and the 168px thumbnail is confirmed to already fit
   cleanly at 481px (title clip 0), so 480px is a safe boundary. */
@media (max-width: 480px) {
  .rec-thumbnail-wrapper {
    width: 100px;
  }
}

.rec-thumbnail-wrapper::after {
  content: '';
  position: absolute;
  bottom: 0; left: 0; right: 0; height: 40%;
  background: linear-gradient(to top, rgba(0,0,0,0.8), transparent);
  pointer-events: none;
}

.rec-thumbnail-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.rec-duration {
  position: absolute;
  bottom: 4px;
  right: 4px;
  background: rgba(0, 0, 0, 0.85);
  font-size: 10px;
  font-weight: 600;
  padding: 2px 5px;
  border-radius: 3px;
}

.rec-info {
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  gap: 4px;
  min-width: 0;
}

.rec-title {
  font-size: 13px;
  line-height: 1.3;
  font-weight: 600;
  color: var(--text-primary);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  /* Without this, a single word wider than the column (a long unbroken
     title) is silently cut mid-character rather than wrapped, since
     line-clamp alone doesn't force a break. */
  overflow-wrap: anywhere;
}

.rec-channel {
  font-size: 11px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.rec-metadata {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  font-size: 11px;
  color: var(--text-secondary);
}

/* Modal Window styles */
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
  max-height: 350px;
  overflow-y: auto;
}

.modal-desc {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.4;
}

.modal-empty-state {
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
  padding: 24px 0;
}

.modal-categories-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.modal-check-item {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  padding: 10px 12px;
  border-radius: var(--border-radius-md);
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.04);
  cursor: pointer;
  transition: all 0.2s;
}

.modal-check-item:hover {
  background: rgba(139, 92, 246, 0.05);
  border-color: rgba(139, 92, 246, 0.2);
}

.modal-check-item input[type="checkbox"] {
  margin-top: 3px;
  cursor: pointer;
  accent-color: var(--accent-primary);
}

.check-item-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.check-item-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.check-item-desc {
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.3;
}

.modal-footer {
  padding: 16px 24px;
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  border-top: 1px solid var(--border-color);
  background: rgba(0, 0, 0, 0.2);
}

.mt-4 {
  margin-top: 16px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(-5px); }
  to { opacity: 1; transform: translateY(0); }
}

.playlist-card-item {
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.04);
}

.playlist-card-item:hover:not(.disabled-playlist-item) {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.1);
}

.active-playlist-item {
  background: rgba(139, 92, 246, 0.1) !important;
  border-color: rgba(139, 92, 246, 0.3) !important;
  box-shadow: 0 0 12px rgba(139, 92, 246, 0.1);
}

.disabled-playlist-item {
  opacity: 0.5;
  cursor: not-allowed;
}

.playlist-vids-list::-webkit-scrollbar {
  width: 4px;
}
.playlist-vids-list::-webkit-scrollbar-track {
  background: rgba(255, 255, 255, 0.02);
}
.playlist-vids-list::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 2px;
}
.playlist-vids-list::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.2);
}

.mini-player {
  position: fixed;
  bottom: var(--space-5);
  right: var(--space-5);
  width: 280px;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2);
  border-radius: var(--border-radius-md);
  background: rgba(20, 20, 28, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
  cursor: pointer;
  z-index: 500;
}

.mini-player-thumb {
  width: 64px;
  height: 36px;
  border-radius: var(--border-radius-sm);
  overflow: hidden;
  flex-shrink: 0;
}

.mini-player-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.mini-player-info {
  flex: 1;
  min-width: 0;
}

.mini-player-title {
  font-size: 12px;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mini-player-btn,
.mini-player-close {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.06);
  flex-shrink: 0;
}
</style>
