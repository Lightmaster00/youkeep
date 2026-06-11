<template>
  <div class="subscriptions-page">
    <h1 class="page-title">Subscriptions</h1>

    <!-- Subscribed Channels UI -->
    <div v-if="channels && channels.length > 0" class="subscribed-channels-section">
      <div class="channels-row">
        <div 
          v-for="channel in channels" 
          :key="channel.id" 
          class="sub-channel-pill"
          :class="{ 'inactive-channel': inactiveChannelIds.includes(channel.id) }"
          @click="toggleChannelFilter(channel.id)"
        >
          <img 
            :src="channel.avatar_url || 'data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 24 24\' fill=\'%23666\'><circle cx=\'12\' cy=\'12\' r=\'10\'></circle><path d=\'M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-3.33 0-10 1.67-10 5v2h20v-2c0-3.33-6.67-5-10-5z\'></path></svg>'" 
            @error="handleAvatarError"
            class="sub-channel-avatar" 
            alt="Avatar"
          />
          <span class="sub-channel-title">{{ channel.title }}</span>
        </div>
      </div>
    </div>

    <!-- Loading State -->
    <div v-if="pending" class="loading-state">
      <div class="spinner"></div>
      <p>Loading your subscriptions...</p>
    </div>

    <!-- Empty State -->
    <div v-else-if="videos.length === 0" class="empty-state glass-panel">
      <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="text-gradient"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>
      <h3 v-if="inactiveChannelIds.length === channels.length && channels.length > 0">All channels are disabled</h3>
      <h3 v-else>No videos in your subscriptions</h3>
      <p>Subscribe to YouTube channels in the archive to see their downloaded videos here.</p>
      <NuxtLink to="/channels" class="btn btn-primary mt-4">
        Discover channels
      </NuxtLink>
    </div>

    <!-- Video Grid -->
    <div v-else class="video-grid-wrapper">
      <div class="video-grid">
        <div v-for="video in videos" :key="video.id" class="video-card premium-card" @click="playVideo(video.id)">
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

      <!-- Infinite Scroll Trigger -->
      <div ref="loadMoreTrigger" class="infinite-scroll-trigger">
        <div v-if="loadingMore" class="spinner small-spinner"></div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';
import { useRouter } from 'vue-router';

const router = useRouter();

const channels = ref<any[]>([]);
const videos = ref<any[]>([]);
const page = ref(1);
const inactiveChannelIds = ref<string[]>([]);
const pending = ref(true);
const loadingMore = ref(false);
const hasMore = ref(true);
const loadMoreTrigger = ref<HTMLElement | null>(null);

let observer: IntersectionObserver | null = null;

// Fetch channels
const fetchChannels = async () => {
  try {
    const res = await $fetch<any>('/api/channels', { params: { subscribed: 'true' } });
    channels.value = res.channels || [];
  } catch (err) {
    console.error(err);
  }
};

// Fetch videos
const fetchVideos = async (isLoadMore = false) => {
  if (isLoadMore) {
    loadingMore.value = true;
  } else {
    pending.value = true;
    videos.value = [];
    page.value = 1;
    hasMore.value = true;
  }

  try {
    const res = await $fetch<any>('/api/videos', {
      params: {
        page: page.value,
        limit: 16,
        subscribed: 'true',
        excludeChannels: inactiveChannelIds.value.length > 0 ? inactiveChannelIds.value.join(',') : undefined,
        status: 'completed'
      }
    });

    if (isLoadMore) {
      videos.value.push(...res.videos);
    } else {
      videos.value = res.videos;
    }
    
    if (page.value >= res.pagination.totalPages) {
      hasMore.value = false;
    }
  } catch (err) {
    console.error(err);
  } finally {
    pending.value = false;
    loadingMore.value = false;
  }
};

const setupObserver = () => {
  observer = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting && hasMore.value && !loadingMore.value && !pending.value) {
      page.value++;
      fetchVideos(true);
    }
  }, { rootMargin: '200px' });

  if (loadMoreTrigger.value) {
    observer.observe(loadMoreTrigger.value);
  }
};

onMounted(async () => {
  await fetchChannels();
  await fetchVideos();
  // Observer setup delayed slightly to ensure DOM is rendered
  setTimeout(setupObserver, 100);
});

onUnmounted(() => {
  if (observer) observer.disconnect();
});

const toggleChannelFilter = (id: string) => {
  if (inactiveChannelIds.value.includes(id)) {
    inactiveChannelIds.value = inactiveChannelIds.value.filter(c => c !== id);
  } else {
    inactiveChannelIds.value.push(id);
  }
};

watch(inactiveChannelIds, () => {
  fetchVideos();
}, { deep: true });

// Play video
const playVideo = (id: string) => {
  navigateTo(`/watch/${id}`);
};

const onVideoHidden = (id: string) => {
  videos.value = videos.value.filter((v: any) => v.id !== id);
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

const formatUploadDate = (dateStr: string | null): string => {
  if (!dateStr || dateStr.length !== 8) return 'Unknown date';
  const year = dateStr.slice(0, 4);
  const month = dateStr.slice(4, 6);
  const day = dateStr.slice(6, 8);
  
  const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
};

const handleAvatarError = (event: Event) => {
  const target = event.target as HTMLImageElement;
  const fallback = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%23666"><circle cx="12" cy="12" r="10"></circle><path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-3.33 0-10 1.67-10 5v2h20v-2c0-3.33-6.67-5-10-5z"></path></svg>';
  if (target && target.src !== fallback) {
    target.src = fallback;
  }
};
</script>

<style scoped>
.subscriptions-page {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.page-title {
  font-size: 24px;
  font-weight: 800;
}

/* Subscribed Channels Bar */
.subscribed-channels-section {
  margin-bottom: 8px;
}
.channels-row {
  display: flex;
  gap: 16px;
  overflow-x: auto;
  padding: 4px 4px 12px 4px; /* padding-top/left/right 4px to avoid box-shadow/transform clipping */
}
.channels-row::-webkit-scrollbar {
  height: 6px;
}
.channels-row::-webkit-scrollbar-track {
  background: rgba(255, 255, 255, 0.05);
  border-radius: 4px;
}
.channels-row::-webkit-scrollbar-thumb {
  background: var(--accent-primary);
  border-radius: 4px;
}

.sub-channel-pill {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 16px 6px 6px;
  border-radius: 40px;
  cursor: pointer;
  border: 1px solid var(--accent-primary);
  transition: all 0.2s ease;
  background: rgba(139, 92, 246, 0.15);
  box-shadow: 0 0 16px rgba(139, 92, 246, 0.1);
  white-space: nowrap;
}
.sub-channel-pill:hover {
  transform: translateY(-2px);
  border-color: var(--accent-primary);
  box-shadow: 0 0 16px rgba(139, 92, 246, 0.3);
}
.inactive-channel {
  border-color: var(--border-color) !important;
  background: rgba(17, 17, 34, 0.4) !important;
  box-shadow: none !important;
  opacity: 0.6;
}
.inactive-channel:hover {
  opacity: 1;
}

.sub-channel-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
}
.sub-channel-title {
  color: var(--text-primary);
  font-weight: 500;
  font-size: 13px;
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

.spinner {
  width: 36px;
  height: 36px;
  border: 3.5px solid rgba(139, 92, 246, 0.1);
  border-radius: 50%;
  border-top-color: var(--accent-primary);
  animation: spin 0.8s linear infinite;
}

.small-spinner {
  width: 24px;
  height: 24px;
  border-width: 2.5px;
}

.infinite-scroll-trigger {
  width: 100%;
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 20px;
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
  min-width: 0;
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

@keyframes spin {
  to { transform: rotate(360deg); }
}

</style>
