<template>
  <div class="dashboard-container">

    <!-- Empty State -->
    <div v-if="pending" class="loading-state">
      <div class="spinner"></div>
      <p>Loading library...</p>
    </div>

    <div v-else-if="!videosData?.videos || videosData.videos.length === 0" class="empty-state glass-panel">
      <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="text-gradient"><polygon points="23 7 16 12 23 17 23 7"></polygon><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect></svg>
      <h3>No videos found</h3>
      <p v-if="searchQuery">No results match your search "{{ searchQuery }}".</p>
      <p v-else>Your archive is empty. Log in as administrator to add channels or videos.</p>
      <NuxtLink v-if="isAdmin" to="/settings?tab=downloads" class="btn btn-primary mt-4">
        Go to downloads
      </NuxtLink>
    </div>

    <!-- Video Grid -->
    <div v-else class="video-grid-wrapper">
      <!-- Recommendations Section (Homepage, no search query) -->
      <div v-if="!searchQuery" class="recommendations-container">
        <h2 class="section-title">Recommended for you</h2>
        
        <!-- Hero Featured Video -->
        <div v-if="videosData.videos[0]" class="hero-video-card glass-panel" @click="playVideo(videosData.videos[0].id)">
          <div class="hero-thumbnail-wrapper">
            <img 
              :src="videosData.videos[0].local_thumbnail_path || `https://i.ytimg.com/vi/${videosData.videos[0].id}/hqdefault.jpg`" 
              class="hero-thumbnail-img" 
              alt="Thumbnail"
            />
            <span class="duration-badge hero-duration">{{ formatDuration(videosData.videos[0].duration) }}</span>
            <div class="hero-badge">Featured</div>
            <VideoDropdownMenu :video="videosData.videos[0]" @hidden="onVideoHidden" />
          </div>
          <div class="hero-video-info">
            <div class="hero-details">
              <span class="hero-tag">RECOMMENDED FULL VIDEO</span>
              <h3 class="hero-video-title">{{ videosData.videos[0].title }}</h3>
              <p class="hero-video-description">{{ videosData.videos[0].description || 'No description available.' }}</p>
              
              <div class="hero-channel-row">
                <img 
                  :src="videosData.videos[0].channel_avatar || 'data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 24 24\' fill=\'%23666\'><circle cx=\'12\' cy=\'12\' r=\'10\'></circle><path d=\'M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-3.33 0-10 1.67-10 5v2h20v-2c0-3.33-6.67-5-10-5z\'></path></svg>'" 
                  @error="handleAvatarError"
                  class="hero-channel-avatar" 
                  alt="Avatar"
                />
                <span class="hero-channel-name">{{ videosData.videos[0].channel_title }}</span>
              </div>
              
              <div class="hero-metadata">
                <span>{{ formatViews(videosData.videos[0].view_count) }} views</span>
                <span class="dot">•</span>
                <span>{{ formatUploadDate(videosData.videos[0].upload_date) }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Suggestions Grid (Next 6 recommended videos) -->
        <div class="recommended-section-header">
          <h3 class="subsection-title">Personalized suggestions</h3>
        </div>
        <div class="video-grid">
          <div 
            v-for="video in videosData.videos.slice(1, 7)" 
            :key="video.id" 
            class="video-card premium-card" 
            @click="playVideo(video.id)"
          >
            <!-- Thumbnail Wrapper -->
            <div class="thumbnail-wrapper">
              <img 
                :src="video.local_thumbnail_path || `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`" 
                class="thumbnail-img" 
                alt="Thumbnail"
                loading="lazy"
              />
              <span class="duration-badge">{{ formatDuration(video.duration) }}</span>
              <VideoDropdownMenu :video="video" @hidden="onVideoHidden" />
            </div>

            <!-- Video Details -->
            <div class="video-info">
              <div class="avatar-col">
                <img 
                  :src="video.channel_avatar || 'data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 24 24\' fill=\'%23666\'><circle cx=\'12\' cy=\'12\' r=\'10\'></circle><path d=\'M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-3.33 0-10 1.67-10 5v2h20v-2c0-3.33-6.67-5-10-5z\'></path></svg>'" 
                  @error="handleAvatarError"
                  class="channel-avatar" 
                  alt="Avatar"
                />
              </div>
              <div class="details-col">
                <h4 class="video-title" :title="video.title">{{ video.title }}</h4>
                <p class="channel-title">{{ video.channel_title }}</p>
                <div class="metadata-row">
                  <span>{{ formatViews(video.view_count) }} views</span>
                  <span class="dot">•</span>
                  <span>{{ formatUploadDate(video.upload_date) }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Standard Grid (For Search / Categories) -->
      <div v-else>
        <!-- Channels Search Results -->
        <div v-if="searchQuery && searchedChannels.length > 0" class="search-channels-section">
          <h3 class="subsection-title">Channels matching "{{ searchQuery }}"</h3>
          <div class="channels-row">
            <NuxtLink 
              v-for="channel in searchedChannels.slice(0, 4)" 
              :key="channel.id" 
              :to="`/channels?id=${channel.id}`"
              class="search-channel-card glass-panel"
            >
              <img 
                :src="channel.avatar_url || 'data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 24 24\' fill=\'%23666\'><circle cx=\'12\' cy=\'12\' r=\'10\'></circle><path d=\'M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-3.33 0-10 1.67-10 5v2h20v-2c0-3.33-6.67-5-10-5z\'></path></svg>'" 
                @error="handleAvatarError"
                class="search-channel-avatar" 
                alt="Avatar"
              />
              <div class="search-channel-info">
                <h4 class="search-channel-title">{{ channel.title }}</h4>
                <p class="search-channel-meta">{{ formatViewsShort(channel.total_count) }} videos</p>
              </div>
            </NuxtLink>
          </div>
        </div>

        <h3 v-if="searchQuery" class="subsection-title">Videos matching "{{ searchQuery }}"</h3>
        <div class="video-grid">
          <div v-for="video in videosData.videos" :key="video.id" class="video-card premium-card" @click="playVideo(video.id)">
            <!-- Thumbnail Wrapper -->
            <div class="thumbnail-wrapper">
              <img 
                :src="video.local_thumbnail_path || `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`" 
                class="thumbnail-img" 
                alt="Thumbnail"
                loading="lazy"
              />
              <span class="duration-badge">{{ formatDuration(video.duration) }}</span>
              <VideoDropdownMenu :video="video" @hidden="onVideoHidden" />
            </div>

            <!-- Video Details -->
            <div class="video-info">
              <div class="avatar-col">
                <img 
                  :src="video.channel_avatar || 'data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 24 24\' fill=\'%23666\'><circle cx=\'12\' cy=\'12\' r=\'10\'></circle><path d=\'M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-3.33 0-10 1.67-10 5v2h20v-2c0-3.33-6.67-5-10-5z\'></path></svg>'" 
                  @error="handleAvatarError"
                  class="channel-avatar" 
                  alt="Avatar"
                />
              </div>
              <div class="details-col">
                <h4 class="video-title" :title="video.title">{{ video.title }}</h4>
                <p class="channel-title">{{ video.channel_title }}</p>
                <div class="metadata-row">
                  <span>{{ formatViews(video.view_count) }} views</span>
                  <span class="dot">•</span>
                  <span>{{ formatUploadDate(video.upload_date) }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Pagination Controls -->
        <div v-if="videosData.pagination.totalPages > 1" class="pagination">
          <button 
            class="btn btn-secondary" 
            :disabled="page === 1"
            @click="changePage(page - 1)"
          >
            Previous
          </button>
          <span class="pagination-info">
            Page {{ page }} of {{ videosData.pagination.totalPages }}
          </span>
          <button 
            class="btn btn-secondary" 
            :disabled="page === videosData.pagination.totalPages"
            @click="changePage(page + 1)"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuth } from '~/composables/useAuth';

const { isAdmin } = useAuth();
const route = useRoute();
const router = useRouter();

// Computed query filters
const searchQuery = computed(() => route.query.q ? String(route.query.q) : '');
const page = computed(() => route.query.page ? parseInt(String(route.query.page), 10) : 1);

// Fetch videos
const { data: videosData, pending, refresh } = await useFetch<{ videos: any[], pagination: any }>(() => '/api/videos', {
  query: computed(() => ({
    page: page.value,
    limit: 12,
    q: searchQuery.value || undefined,
    status: 'completed'
  })),
  watch: [searchQuery, page]
});

// Fetch channels (for search)
const { data: channelsData } = await useFetch<{ channels: any[] }>(() => '/api/channels', {
  query: computed(() => ({
    search: searchQuery.value || undefined
  })),
  watch: [searchQuery]
});

const searchedChannels = computed(() => {
  if (!searchQuery.value) return [];
  return channelsData.value?.channels || [];
});

// Page changes
const changePage = (newPage: number) => {
  router.push({ path: '/', query: { ...route.query, page: newPage } });
};

// Play video
const playVideo = (id: string) => {
  navigateTo(`/watch/${id}`);
};

const handleAvatarError = (event: Event) => {
  const target = event.target as HTMLImageElement;
  const fallback = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%23666"><circle cx="12" cy="12" r="10"></circle><path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-3.33 0-10 1.67-10 5v2h20v-2c0-3.33-6.67-5-10-5z"></path></svg>';
  if (target && target.src !== fallback) {
    target.src = fallback;
  }
};

const onVideoHidden = (id: string) => {
  if (videosData.value) {
    videosData.value.videos = videosData.value.videos.filter((v: any) => v.id !== id);
  }
};

/* Format Helpers */
const formatDuration = (seconds: number | null): string => {
  if (!seconds) return '--:--';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
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

const formatViewsShort = (views: number | null): string => {
  if (views === null || views === undefined) return '0';
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
  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
};
</script>

<style scoped>
.dashboard-container {
  display: flex;
  flex-direction: column;
  gap: 24px;
}


.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 0;
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

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 40px;
  text-align: center;
  border-radius: var(--border-radius-md);
  gap: 16px;
}

.empty-state h3 {
  font-size: 20px;
}

.empty-state p {
  color: var(--text-secondary);
  font-size: 14px;
  max-width: 450px;
  line-height: 1.5;
}

.video-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 24px;
}

.video-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  cursor: pointer;
  border-radius: var(--border-radius-md);
  overflow: hidden;
}

.thumbnail-wrapper {
  position: relative;
  aspect-ratio: 16/9;
  border-radius: var(--border-radius-md);
  overflow: hidden;
  box-shadow: var(--shadow-sm);
  background: #000;
  border: 1px solid transparent;
  transition: box-shadow 0.25s ease, border-color 0.25s ease;
}

.thumbnail-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.5s cubic-bezier(0.25, 1, 0.5, 1);
}

.thumbnail-wrapper::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 40%;
  background: linear-gradient(to top, rgba(0,0,0,0.8), transparent);
  pointer-events: none;
}

.duration-badge {
  position: absolute;
  bottom: 8px;
  right: 8px;
  background: rgba(0, 0, 0, 0.8);
  padding: 3px 6px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.video-info {
  display: flex;
  gap: 12px;
  padding: 12px;
}

.channel-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  object-fit: cover;
  background: var(--bg-surface);
}

.details-col {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  min-width: 0; /* Important for ellipsis */
}

.video-title {
  font-family: var(--font-title);
  font-size: 15px;
  line-height: 1.4;
  font-weight: 600;
  color: var(--text-primary);
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
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.metadata-row {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--text-secondary);
}

.dot {
  font-weight: 700;
}

.premium-card:hover .thumbnail-img {
  transform: scale(1.05);
}

.pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 20px;
  margin-top: 48px;
}

.pagination-info {
  font-size: 14px;
  color: var(--text-secondary);
  font-weight: 500;
}

.mt-4 {
  margin-top: 16px;
}

/* Recommendations & Hero Styling */
.section-title {
  font-size: 22px;
  font-weight: 700;
  margin-bottom: 20px;
  background: linear-gradient(135deg, var(--text-primary), var(--text-secondary));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.subsection-title {
  font-size: 18px;
  font-weight: 600;
  margin-top: 32px;
  margin-bottom: 16px;
  color: var(--text-primary);
}

.hero-video-card {
  display: flex;
  gap: 28px;
  padding: 24px;
  border-radius: var(--border-radius-lg);
  cursor: pointer;
  transition: transform 0.3s ease, border-color 0.3s ease, box-shadow 0.3s ease;
  overflow: hidden;
  border: 1px solid var(--border-color);
  background: rgba(17, 17, 34, 0.4);
  margin-bottom: 32px;
}

.hero-video-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 32px rgba(139, 92, 246, 0.15);
  border-color: rgba(139, 92, 246, 0.3);
}

.hero-thumbnail-wrapper {
  position: relative;
  width: 48%;
  aspect-ratio: 16/9;
  border-radius: var(--border-radius-md);
  overflow: hidden;
  flex-shrink: 0;
  box-shadow: var(--shadow-sm);
  background: #000;
}

.hero-thumbnail-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.5s ease;
}

.hero-video-card:hover .hero-thumbnail-img {
  transform: scale(1.02);
}

.hero-duration {
  font-size: 12px;
  padding: 4px 8px;
}

.hero-badge {
  position: absolute;
  top: 12px;
  left: 12px;
  background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
  color: white;
  padding: 4px 10px;
  border-radius: 20px;
  font-size: 11px;
  font-weight: 700;
  box-shadow: 0 4px 10px rgba(139, 92, 246, 0.4);
}

.hero-video-info {
  display: flex;
  flex-direction: column;
  justify-content: center;
  flex: 1;
  min-width: 0;
}

.hero-details {
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex: 1;
}

.hero-tag {
  font-size: 11px;
  font-weight: 700;
  color: var(--accent-primary);
  letter-spacing: 0.1em;
}

.hero-video-title {
  font-size: 20px;
  font-weight: 700;
  line-height: 1.3;
  color: var(--text-primary);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
}

.hero-video-description {
  font-size: 13.5px;
  color: var(--text-secondary);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 4px;
}

.hero-channel-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 6px;
}

.hero-channel-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  object-fit: cover;
  border: 1.5px solid var(--border-color);
}

.hero-channel-name {
  font-size: 14px;
  color: var(--text-primary);
  font-weight: 500;
}

.hero-metadata {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-muted);
  margin-top: auto;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* Channels Search Row Styling */
.search-channels-section {
  margin-bottom: 32px;
}
.channels-row {
  display: flex;
  gap: 16px;
  overflow-x: auto;
  padding-bottom: 8px;
}
.search-channel-card {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px;
  border-radius: var(--border-radius-md);
  min-width: 250px;
  flex: 1;
  text-decoration: none;
  border: 1px solid var(--border-color);
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}
.search-channel-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 20px rgba(139, 92, 246, 0.15);
  border-color: rgba(139, 92, 246, 0.3);
}
.search-channel-avatar {
  width: 50px;
  height: 50px;
  border-radius: 50%;
  object-fit: cover;
}
.search-channel-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.search-channel-title {
  color: var(--text-primary);
  font-weight: 600;
  font-size: 15px;
  margin: 0;
}
.search-channel-meta {
  color: var(--text-secondary);
  font-size: 13px;
  margin: 0;
}

@media (max-width: 900px) {
  .hero-video-card {
    flex-direction: column;
    gap: 16px;
    padding: 16px;
  }
  .hero-thumbnail-wrapper {
    width: 100%;
  }
  .hero-video-title {
    font-size: 18px;
  }
}
</style>
