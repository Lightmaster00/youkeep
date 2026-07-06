<template>
  <div class="home-container">

    <!-- Loading -->
    <div v-if="loading" class="loading-state">
      <div class="spinner"></div>
      <p>Loading library...</p>
    </div>

    <!-- Empty -->
    <EmptyState
      v-else-if="allVideos.length === 0 && !searchQuery"
      title="No videos found"
      description="Your archive is empty. Log in as administrator to add channels or videos."
      icon="video"
      :action-text="isAdmin ? 'Go to downloads' : undefined"
      action-route="/settings?tab=downloads"
    />

    <!-- Search Mode -->
    <div v-else-if="searchQuery" class="search-results">
      <!-- Channel results -->
      <div v-if="searchedChannels.length > 0" class="search-channels-section">
        <h3 class="row-title">Channels</h3>
        <div class="channels-row">
          <NuxtLink 
            v-for="channel in searchedChannels.slice(0, 6)" 
            :key="channel.id" 
            :to="`/channels?id=${channel.id}`"
            class="search-channel-pill"
          >
            <img :src="channel.avatar_url || fallbackAvatar" @error="handleAvatarError" class="pill-avatar" alt="" />
            <div class="pill-info">
              <span class="pill-name">{{ channel.title }}</span>
              <span class="pill-count">{{ channel.total_count }} videos</span>
            </div>
          </NuxtLink>
        </div>
      </div>

      <h3 class="row-title">Videos matching "{{ searchQuery }}"</h3>
      <div class="video-grid">
        <VideoCard v-for="video in allVideos" :key="video.id" :video="video" @hidden="onVideoHidden" />
      </div>

      <!-- Search Pagination -->
      <div v-if="searchPagination && searchPagination.totalPages > 1" class="pagination">
        <button class="pagination-btn" :disabled="page === 1" @click="changePage(page - 1)">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"></polyline></svg>
          Previous
        </button>
        <span class="pagination-info">Page {{ page }} / {{ searchPagination.totalPages }}</span>
        <button class="pagination-btn" :disabled="page === searchPagination.totalPages" @click="changePage(page + 1)">
          Next
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg>
        </button>
      </div>
    </div>

    <!-- Netflix-style Home Feed -->
    <div v-else class="netflix-feed">

      <!-- Hero Banner -->
      <div v-if="heroVideo" class="hero-banner" @click="navigateTo(`/watch/${heroVideo.id}`)">
        <div class="hero-backdrop">
          <img :src="heroVideo.local_thumbnail_path || `https://i.ytimg.com/vi/${heroVideo.id}/maxresdefault.jpg`" @error="handleHeroError" class="hero-bg-img" alt="" />
          <div class="hero-gradient-left"></div>
          <div class="hero-gradient-bottom"></div>
        </div>
        <div class="hero-content">
          <div class="hero-channel-badge">
            <img :src="heroVideo.channel_avatar || fallbackAvatar" @error="handleAvatarError" class="hero-channel-img" alt="" />
            <span>{{ heroVideo.channel_title }}</span>
          </div>
          <h1 class="hero-title">{{ heroVideo.title }}</h1>
          <p v-if="heroVideo.description" class="hero-desc">{{ heroVideo.description }}</p>
          <div class="hero-meta">
            <span>{{ formatViews(heroVideo.view_count) }} views</span>
            <span class="meta-dot">•</span>
            <span>{{ formatUploadDate(heroVideo.upload_date) }}</span>
            <span class="meta-dot">•</span>
            <span>{{ formatDuration(heroVideo.duration) }}</span>
          </div>
          <div class="hero-actions">
            <button class="hero-play-btn" @click.stop="navigateTo(`/watch/${heroVideo.id}`)">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
              Play
            </button>
          </div>
        </div>
      </div>

      <!-- Recently Added Row -->
      <div v-if="recentVideos.length > 0" class="content-row">
        <h3 class="row-title">Recently Added</h3>
        <div class="scroll-row">
          <div class="scroll-track">
            <div v-for="video in recentVideos" :key="video.id" class="scroll-card">
              <VideoCard :video="video" @hidden="onVideoHidden" />
            </div>
          </div>
        </div>
      </div>

      <!-- Channel Rows -->
      <div v-for="group in channelGroups" :key="group.channelId" class="content-row">
        <div class="row-header">
          <h3 class="row-title">{{ group.channelTitle }}</h3>
          <NuxtLink :to="`/channels?id=${group.channelId}`" class="see-all-link">See all →</NuxtLink>
        </div>
        <div class="scroll-row">
          <div class="scroll-track">
            <div v-for="video in group.videos" :key="video.id" class="scroll-card">
              <VideoCard :video="video" :show-channel-info="false" @hidden="onVideoHidden" />
            </div>
          </div>
        </div>
      </div>

    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuth } from '~/composables/useAuth';

const { isAdmin } = useAuth();
const route = useRoute();
const router = useRouter();

const searchQuery = computed(() => route.query.q ? String(route.query.q) : '');
const page = computed(() => route.query.page ? parseInt(String(route.query.page), 10) : 1);

const loading = ref(true);
const allVideos = ref<any[]>([]);
const searchPagination = ref<any>(null);

// Fetch for search mode
const { data: searchData, pending: searchPending } = await useFetch<{ videos: any[], pagination: any }>(() => '/api/videos', {
  query: computed(() => ({
    page: page.value,
    limit: 24,
    q: searchQuery.value || undefined,
    status: 'completed'
  })),
  watch: [searchQuery, page],
  immediate: !!searchQuery.value
});

// Fetch for home feed (larger batch for grouping)
const { data: feedData, pending: feedPending } = await useFetch<{ videos: any[], pagination: any }>('/api/videos', {
  query: { limit: 60, status: 'completed' },
  immediate: !searchQuery.value
});

// Fetch channels for search
const { data: channelsData } = await useFetch<{ channels: any[] }>(() => '/api/channels', {
  query: computed(() => ({ search: searchQuery.value || undefined })),
  watch: [searchQuery]
});

const searchedChannels = computed(() => {
  if (!searchQuery.value) return [];
  return channelsData.value?.channels || [];
});

// Reactive data
const computeData = () => {
  if (searchQuery.value) {
    allVideos.value = searchData.value?.videos || [];
    searchPagination.value = searchData.value?.pagination || null;
  } else {
    allVideos.value = feedData.value?.videos || [];
  }
  loading.value = false;
};

// Watch for data changes
watch([searchData, feedData, searchQuery], computeData, { immediate: true });

// Hero video: first video
const heroVideo = computed(() => allVideos.value[0] || null);

// Recently added: first 10 (skip hero)
const recentVideos = computed(() => allVideos.value.slice(1, 11));

// Group remaining videos by channel (skip first 11 used above)
const channelGroups = computed(() => {
  const remaining = allVideos.value.slice(1); // include all except hero for channel rows
  const groups: Record<string, { channelId: string; channelTitle: string; channelAvatar: string; videos: any[] }> = {};
  
  for (const video of remaining) {
    const cid = video.channel_id;
    if (!groups[cid]) {
      groups[cid] = {
        channelId: cid,
        channelTitle: video.channel_title,
        channelAvatar: video.channel_avatar,
        videos: []
      };
    }
    if (groups[cid].videos.length < 12) {
      groups[cid].videos.push(video);
    }
  }
  
  // Only show channels with 2+ videos, sorted by video count
  return Object.values(groups)
    .filter(g => g.videos.length >= 2)
    .sort((a, b) => b.videos.length - a.videos.length);
});

const changePage = (newPage: number) => {
  router.push({ path: '/', query: { ...route.query, page: newPage } });
};

const fallbackAvatar = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%23666"><circle cx="12" cy="12" r="10"></circle><path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-3.33 0-10 1.67-10 5v2h20v-2c0-3.33-6.67-5-10-5z"></path></svg>';

const handleAvatarError = (event: Event) => {
  const target = event.target as HTMLImageElement;
  if (target && target.src !== fallbackAvatar) target.src = fallbackAvatar;
};

const handleHeroError = (event: Event) => {
  const target = event.target as HTMLImageElement;
  if (target) {
    const hq = `https://i.ytimg.com/vi/${heroVideo.value?.id}/hqdefault.jpg`;
    if (target.src !== hq) target.src = hq;
  }
};

const onVideoHidden = (id: string) => {
  allVideos.value = allVideos.value.filter(v => v.id !== id);
};

/* Formatters */
const formatDuration = (seconds: number | null): string => {
  if (!seconds) return '--:--';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
};

const formatViews = (views: number | null): string => {
  if (!views) return '0';
  if (views >= 1000000) return (views / 1000000).toFixed(1).replace('.0', '') + 'M';
  if (views >= 1000) return (views / 1000).toFixed(1).replace('.0', '') + 'k';
  return views.toString();
};

const formatUploadDate = (dateStr: string | null): string => {
  if (!dateStr || dateStr.length !== 8) return '';
  const y = dateStr.slice(0, 4), mo = dateStr.slice(4, 6), d = dateStr.slice(6, 8);
  return new Date(+y, +mo - 1, +d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
};
</script>

<style scoped>
/* ===== Container ===== */
.home-container {
  display: flex;
  flex-direction: column;
  min-height: 100%;
}

/* ===== Loading ===== */
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

@keyframes spin { to { transform: rotate(360deg); } }

/* ===== Hero Banner ===== */
.hero-banner {
  position: relative;
  width: calc(100% + 48px);
  margin: -24px -24px 28px -24px;
  height: 420px;
  overflow: hidden;
  cursor: pointer;
}

.hero-backdrop {
  position: absolute;
  inset: 0;
}

.hero-bg-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  filter: brightness(0.55);
  transition: transform 8s ease, filter 0.5s ease;
}

.hero-banner:hover .hero-bg-img {
  transform: scale(1.03);
  filter: brightness(0.45);
}

.hero-gradient-left {
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, rgba(10, 10, 15, 0.95) 0%, rgba(10, 10, 15, 0.6) 40%, transparent 70%);
}

.hero-gradient-bottom {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 160px;
  background: linear-gradient(to top, var(--bg-base, #0a0a0f) 0%, transparent 100%);
}

.hero-content {
  position: absolute;
  bottom: 48px;
  left: 48px;
  max-width: 550px;
  z-index: 2;
}

.hero-channel-badge {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  font-size: 13px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.8);
}

.hero-channel-img {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  object-fit: cover;
}

.hero-title {
  font-size: 32px;
  font-weight: 800;
  color: white;
  line-height: 1.2;
  margin: 0 0 10px 0;
  letter-spacing: -0.02em;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.hero-desc {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.6);
  line-height: 1.5;
  margin: 0 0 12px 0;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.hero-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.5);
  margin-bottom: 18px;
}

.meta-dot { font-weight: 700; }

.hero-actions {
  display: flex;
  gap: 12px;
}

.hero-play-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 28px;
  background: white;
  color: #0a0a0f;
  border: none;
  border-radius: 6px;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s ease;
}

.hero-play-btn:hover {
  background: rgba(255, 255, 255, 0.85);
  transform: scale(1.03);
}

/* ===== Content Rows ===== */
.content-row {
  margin-bottom: 32px;
}

.row-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}

.row-title {
  font-size: 18px;
  font-weight: 700;
  color: white;
  margin: 0 0 14px 0;
  letter-spacing: -0.01em;
}

.row-header .row-title {
  margin-bottom: 0;
}

.see-all-link {
  font-size: 13px;
  font-weight: 600;
  color: var(--accent-primary);
  text-decoration: none;
  transition: color 0.2s;
  white-space: nowrap;
}

.see-all-link:hover {
  color: var(--accent-primary-hover);
}

/* ===== Horizontal Scroll ===== */
.scroll-row {
  position: relative;
  width: calc(100% + 48px);
  margin-left: -24px;
  padding: 0 24px;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.1) transparent;
  -webkit-overflow-scrolling: touch;
}

.scroll-row::-webkit-scrollbar {
  height: 6px;
}

.scroll-row::-webkit-scrollbar-track {
  background: transparent;
}

.scroll-row::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 3px;
}

.scroll-track {
  display: flex;
  gap: 16px;
  padding-bottom: 8px;
}

.scroll-card {
  flex: 0 0 260px;
  min-width: 0;
}

@media (max-width: 900px) {
  .scroll-card {
    flex: 0 0 220px;
  }
}

/* ===== Search Grid ===== */
.search-results {
  display: flex;
  flex-direction: column;
}

.video-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 20px;
  margin-bottom: 32px;
}

@media (max-width: 1400px) {
  .video-grid { grid-template-columns: repeat(3, 1fr); }
}

@media (max-width: 1000px) {
  .video-grid { grid-template-columns: repeat(2, 1fr); }
}

@media (max-width: 640px) {
  .video-grid { grid-template-columns: 1fr; }
}

/* ===== Search Channels ===== */
.search-channels-section {
  margin-bottom: 24px;
}

.channels-row {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.search-channel-pill {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 16px 8px 8px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 40px;
  text-decoration: none;
  transition: all 0.2s ease;
}

.search-channel-pill:hover {
  background: rgba(139, 92, 246, 0.1);
  border-color: rgba(139, 92, 246, 0.3);
}

.pill-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  object-fit: cover;
}

.pill-info {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.pill-name {
  font-size: 13px;
  font-weight: 600;
  color: white;
}

.pill-count {
  font-size: 11px;
  color: var(--text-secondary);
}

/* ===== Pagination ===== */
.pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 24px 0;
}

.pagination-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.pagination-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.06);
  color: white;
  border-color: rgba(139, 92, 246, 0.3);
}

.pagination-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.pagination-info {
  font-size: 13px;
  color: var(--text-secondary);
  font-weight: 500;
}

/* ===== Responsive Hero ===== */
@media (max-width: 900px) {
  .hero-banner { height: 320px; }
  .hero-content { left: 24px; bottom: 32px; max-width: 90%; }
  .hero-title { font-size: 24px; }
}

@media (max-width: 640px) {
  .hero-banner { height: 260px; }
  .hero-title { font-size: 20px; }
  .hero-desc { display: none; }
}
</style>
