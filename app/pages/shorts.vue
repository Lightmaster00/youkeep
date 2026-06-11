<template>
  <div class="shorts-page-container">
    <!-- Loading State -->
    <div v-if="pending && videos.length === 0" class="loading-state">
      <div class="spinner"></div>
      <p>Loading Shorts...</p>
    </div>

    <!-- Empty State -->
    <div v-else-if="videos.length === 0" class="empty-state glass-panel">
      <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="text-gradient">
        <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect>
        <line x1="7" y1="2" x2="7" y2="22"></line>
        <line x1="17" y1="2" x2="17" y2="22"></line>
        <line x1="2" y1="12" x2="22" y2="12"></line>
      </svg>
      <h3>No Shorts available</h3>
      <p>There are no archived videos in MyTeub yet or ready to be recommended.</p>
      <NuxtLink to="/" class="btn btn-primary mt-4">Back to Home</NuxtLink>
    </div>

    <!-- Combined layout: video on the left (smartphone-frame) and comments on the right (comments-pane) -->
    <div v-else class="shorts-layout-wrapper">
      <!-- Mobile Device Container (Now strictly containing the video scroll feed) -->
      <div class="smartphone-frame glass-panel">
        <div class="shorts-feed" ref="feedContainer" @scroll="handleScroll">
          <div 
            v-for="(video, index) in videos" 
            :key="video.id + '-' + index"
            class="reel-item"
            :class="{ 'is-active': index === activeIndex }"
            :data-index="index"
            :data-id="video.id"
          >
            <!-- Blurred Background (for landscape videos) -->
            <div 
              class="reel-blur-bg" 
              :style="{ backgroundImage: `url(${video.local_thumbnail_path || `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`})` }"
            ></div>

            <!-- Video Player -->
            <div class="video-wrapper" @click="togglePlay(index)">
              <video
                :ref="el => { if (el) videoRefs[index] = el as HTMLVideoElement }"
                class="reel-video"
                :src="video.local_video_path"
                loop
                preload="metadata"
                playsinline
                @timeupdate="onTimeUpdate($event, video.id)"
                @play="onPlay(index)"
                @pause="onPause(index)"
              ></video>

              <!-- Buffering / Loading Overlay inside Video -->
              <div v-if="loadingStates[index]" class="video-loading">
                <div class="spinner-sm"></div>
              </div>

              <!-- Paused State Overlay Icon -->
              <div v-if="pausedStates[index] && !loadingStates[index]" class="video-paused-hud">
                <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="white" stroke="none"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
              </div>

              <!-- Big Pause/Play HUD Action Indicator -->
              <Transition name="scale-fade">
                <div v-if="hudStates[index]" class="play-pause-hud">
                  <svg v-if="pausedStates[index]" xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="white" stroke="none"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                  <svg v-else xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="white" stroke="none"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>
                </div>
              </Transition>
            </div>

            <!-- Top-Right Actions -->
            <div class="top-right-actions">
              <button class="share-btn-top" @click.stop="shareShort(video)" title="Share">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>
                <span>Share</span>
              </button>
              <VideoDropdownMenu :video="video" />
            </div>

            <!-- Bottom Info Overlay -->
            <div class="reel-bottom-info">
              <div class="channel-info-row">
                <h4 class="channel-title" @click="navigateToChannel(video.channel_id)">
                  @{{ video.channel_title }}
                </h4>
                <span class="video-date-badge">• {{ formatVideoDate(video.upload_date) }}</span>
              </div>
              <p class="video-title">{{ video.title }}</p>
              <div v-if="video.description && video.description.trim()" class="description-container">
                <p class="description-text">
                  {{ video.description }}
                </p>
              </div>
            </div>

            <!-- Video Progress Bar (very thin line at bottom) -->
            <div class="progress-bar-thin" @click.stop="seekVideo($event, index)">
              <div class="progress-fill" :style="{ width: progressPercents[index] + '%' }"></div>
            </div>
          </div>
        </div>

        <!-- Infinite Loading Indicator inside feed -->
        <div v-if="loadingMore" class="feed-loading-more">
          <div class="spinner-sm"></div>
          <span>Loading suggestions...</span>
        </div>
      </div>

      <!-- Right Side Comments Panel (aligned outside of feed, displaying active tracking video's comments) -->
      <div class="comments-pane glass-panel">
        <div class="comments-pane-header">
          <div class="comments-header-top">
            <h4>Comments ({{ commentsMap[activeTrackingVideoId || '']?.length || 0 }})</h4>
            <select v-model="commentSortOrder" class="comment-sort-select">
              <option value="likes">Top comments</option>
              <option value="date">Newest first</option>
              <option value="oldest">Oldest first</option>
            </select>
          </div>
          <p v-if="activeIndex !== -1 && videos[activeIndex]" class="video-date-sub">
            Published on {{ formatVideoDate(videos[activeIndex].upload_date) }}
          </p>
        </div>
        <div class="comments-pane-body">
          <div v-if="activeTrackingVideoId && commentsLoadingMap[activeTrackingVideoId]" class="comments-pane-loading">
            <div class="spinner-sm"></div>
          </div>
          <div v-else-if="!activeTrackingVideoId || !commentsMap[activeTrackingVideoId] || commentsMap[activeTrackingVideoId].length === 0" class="comments-pane-empty">
            No comments for this Short.
          </div>
          <div v-else class="comments-pane-list">
            <div v-for="comment in sortedComments" :key="comment.id" class="comment-pane-item">
              <img 
                v-if="comment.author_thumbnail" 
                :src="comment.author_thumbnail" 
                @error="handleAvatarError"
                class="comment-pane-avatar" 
                alt="Avatar"
              />
              <div v-else class="comment-pane-avatar-fallback">
                {{ comment.author.charAt(0).toUpperCase() }}
              </div>
              <div class="comment-pane-body-text">
                <div class="comment-pane-header-info">
                  <span class="comment-pane-author">{{ comment.author }}</span>
                  <span class="comment-pane-time">
                    {{ formatCommentDate(comment.created_at) }}
                    <span v-if="comment.time_text" class="comment-relative-time">({{ comment.time_text }})</span>
                  </span>
                </div>
                <p class="comment-pane-text">{{ comment.text }}</p>
                <div class="comment-pane-footer">
                  <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path></svg>
                  <span>{{ comment.like_count || 0 }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick, computed } from 'vue';
import { useToast } from '~/composables/useToast';

interface Video {
  id: string;
  title: string;
  description: string;
  duration: number | null;
  view_count: number | null;
  local_video_path: string;
  local_thumbnail_path: string;
  is_short: number;
  channel_id: string;
  channel_title: string;
  channel_avatar: string;
  watchTimeTracked?: number;
}

const toast = useToast();
const videos = ref<Video[]>([]);
const pending = ref(true);
const loadingMore = ref(false);

const commentsMap = ref<{ [videoId: string]: any[] }>({});
const commentsLoadingMap = ref<{ [videoId: string]: boolean }>({});
const commentSortOrder = ref<'likes' | 'date'>('likes');

const sortedComments = computed(() => {
  const videoId = activeTrackingVideoId.value;
  if (!videoId) return [];
  const list = commentsMap.value[videoId] || [];
  return [...list].sort((a, b) => {
    if (commentSortOrder.value === 'likes') {
      return (b.like_count || 0) - (a.like_count || 0);
    } else {
      return (b.created_at || 0) - (a.created_at || 0);
    }
  });
});

const fetchCommentsForVideo = async (videoId: string) => {
  commentsLoadingMap.value[videoId] = true;
  try {
    const res = await $fetch<any>(`/api/videos/${videoId}`);
    commentsMap.value[videoId] = res.comments || [];
  } catch (e) {
    commentsMap.value[videoId] = [];
  } finally {
    commentsLoadingMap.value[videoId] = false;
  }
};

const seekVideo = (e: MouseEvent, index: number) => {
  const video = videoRefs.value[index];
  if (!video || !video.duration) return;
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const clickX = e.clientX - rect.left;
  const percent = clickX / rect.width;
  video.currentTime = percent * video.duration;
  progressPercents.value[index] = percent * 100;
};

const feedContainer = ref<HTMLElement | null>(null);
const videoRefs = ref<{ [key: number]: HTMLVideoElement }>({});
const activeIndex = ref<number>(-1);

// UI States per video index
const pausedStates = ref<{ [key: number]: boolean }>({});
const hudStates = ref<{ [key: number]: boolean }>({});
const loadingStates = ref<{ [key: number]: boolean }>({});
const progressPercents = ref<{ [key: number]: number }>({});
const expandedDescriptions = ref<{ [key: number]: boolean }>({});

// Tracking Watch Time variables
const activeTrackingVideoId = ref<string | null>(null);
const accumulatedSeconds = ref<number>(0);
let trackingInterval: any = null;

// Intersection Observer for autoplay
let observer: IntersectionObserver | null = null;

const fetchRecommendations = async (append = false) => {
  if (append) {
    loadingMore.value = true;
  } else {
    pending.value = true;
  }

  try {
    const data = await $fetch<{ videos: Video[] }>('/api/videos/recommend');
    const newVideos = data.videos || [];
    
    // For each video, get its current watch time from user history if possible,
    // or let it default to 0. We'll fetch detail stats in batch or let them accumulate.
    const mapped = newVideos.map(v => ({
      ...v,
      watchTimeTracked: 0
    }));

    if (append) {
      // Avoid duplicates
      const existingIds = new Set(videos.value.map(v => v.id));
      const filtered = mapped.filter(v => !existingIds.has(v.id));
      videos.value.push(...filtered);
    } else {
      videos.value = mapped;
    }
  } catch (e) {
    toast.error('Error fetching recommended videos.');
  } finally {
    pending.value = false;
    loadingMore.value = false;
  }
};

onMounted(async () => {
  await fetchRecommendations();
  
  if (videos.value.length > 0) {
    nextTick(() => {
      initIntersectionObserver();
    });
    // Fetch comments for first video
    const firstVideo = videos.value[0];
    if (firstVideo) {
      fetchCommentsForVideo(firstVideo.id);
    }
  }

  // Set up local interval to POST accumulated watch time every 4 seconds
  trackingInterval = setInterval(submitWatchTime, 4000);
  
  // Set up watch timer interval
  playTrackerTimer = setInterval(trackPlayDuration, 250);
});

onUnmounted(() => {
  if (observer) {
    observer.disconnect();
  }
  if (trackingInterval) {
    clearInterval(trackingInterval);
  }
  if (playTrackerTimer) {
    clearInterval(playTrackerTimer);
  }
  // Submit final watch time before leaving
  submitWatchTime();
});

const initIntersectionObserver = () => {
  if (observer) {
    observer.disconnect();
  }

  observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const indexAttr = entry.target.getAttribute('data-index');
        const videoIdAttr = entry.target.getAttribute('data-id');
        if (indexAttr !== null && videoIdAttr !== null) {
          const index = parseInt(indexAttr, 10);
          playReelAtIndex(index, videoIdAttr);
        }
      }
    });
  }, {
    root: feedContainer.value,
    threshold: 0.6 // Card must be 60% or more visible
  });

  // Observe all reel items
  const items = feedContainer.value?.querySelectorAll('.reel-item');
  items?.forEach(item => observer?.observe(item));
};

const playReelAtIndex = (index: number, videoId: string) => {
  if (activeIndex.value === index) return;

  // Pause previous video
  if (activeIndex.value !== -1 && videoRefs.value[activeIndex.value]) {
    const prevVideo = videoRefs.value[activeIndex.value];
    if (prevVideo) {
      prevVideo.pause();
    }
    pausedStates.value[activeIndex.value] = true;
  }

  // Submit watch time for previous video before switching context
  submitWatchTime();

  // Set new active video details
  activeIndex.value = index;
  activeTrackingVideoId.value = videoId;
  accumulatedSeconds.value = 0;

  // Auto-fetch comments for current active video if not fetched yet
  if (!commentsMap.value[videoId]) {
    fetchCommentsForVideo(videoId);
  }

  // Play new active video
  const newVideo = videoRefs.value[index];
  if (newVideo) {
    // Sync muted state or settings if needed
    newVideo.play().then(() => {
      pausedStates.value[index] = false;
    }).catch(() => {
      pausedStates.value[index] = true;
    });
  }
};

// Toggle Play/Pause on click
const togglePlay = (index: number) => {
  const video = videoRefs.value[index];
  if (!video) return;

  if (video.paused) {
    video.play();
    pausedStates.value[index] = false;
  } else {
    video.pause();
    pausedStates.value[index] = true;
  }

  // Trigger HUD animation
  hudStates.value[index] = true;
  setTimeout(() => {
    hudStates.value[index] = false;
  }, 600);
};

// Play/Pause handlers to sync local states
const onPlay = (index: number) => {
  pausedStates.value[index] = false;
};
const onPause = (index: number) => {
  pausedStates.value[index] = true;
};

// Time update to track progress bar and watch seconds
const onTimeUpdate = (event: Event, videoId: string) => {
  const el = event.target as HTMLVideoElement;
  if (!el || !el.duration) return;

  const index = activeIndex.value;
  if (index !== -1 && videoRefs.value[index] === el) {
    progressPercents.value[index] = (el.currentTime / el.duration) * 100;
  }

  // Accumulate watch time in seconds
  if (activeTrackingVideoId.value === videoId && !el.paused) {
    // Accumulate the time update tick (timeupdate fires roughly 4 times a second)
    // To be precise, we can track actual elapsed time.
    // Let's use a simpler heuristic or exact tracking of time delta:
  }
};

// To accurately track watch time, we track the play duration using the video's time update delta or browser timers.
// Let's keep a standard watch timer using a precise browser timestamp delta.
let lastTimeUpdate = Date.now();
const trackPlayDuration = () => {
  if (activeIndex.value === -1) return;
  const video = videoRefs.value[activeIndex.value];
  if (video && !video.paused && document.visibilityState === 'visible') {
    const now = Date.now();
    const delta = (now - lastTimeUpdate) / 1000;
    if (delta > 0 && delta < 5) { // filter outliers/tabs sleep
      accumulatedSeconds.value += delta;
      
      // Update local reactive counter for UI presentation
      const activeVideo = videos.value[activeIndex.value];
      if (activeVideo) {
        if (!activeVideo.watchTimeTracked) {
          activeVideo.watchTimeTracked = 0;
        }
        activeVideo.watchTimeTracked = Math.round(
          (activeVideo.watchTimeTracked ?? 0) + delta
        );
      }
    }
    lastTimeUpdate = now;
  } else {
    lastTimeUpdate = Date.now();
  }
};

let playTrackerTimer: any = null;

// Submit tracked watch time to backend
const submitWatchTime = async () => {
  const videoId = activeTrackingVideoId.value;
  const secondsToLog = Math.round(accumulatedSeconds.value);
  
  if (!videoId || secondsToLog <= 0) {
    return;
  }

  // Reset local accumulation counter immediately to avoid double submissions
  accumulatedSeconds.value = 0;

  try {
    await $fetch('/api/videos/track', {
      method: 'POST',
      body: {
        videoId,
        watchTimeSeconds: secondsToLog
      }
    });
  } catch (err) {
    // Silently handle error (offline or backgrounded)
  }
};

// Infinite Scroll / Fetch more videos when scrolling close to end
const handleScroll = (e: Event) => {
  const el = e.target as HTMLElement;
  if (!el) return;

  const threshold = el.scrollHeight - el.clientHeight - 400;
  if (el.scrollTop >= threshold && !loadingMore.value) {
    fetchRecommendations(true).then(() => {
      nextTick(() => {
        initIntersectionObserver();
      });
    });
  }
};

const toggleDescription = (index: number) => {
  expandedDescriptions.value[index] = !expandedDescriptions.value[index];
};

const navigateToChannel = (channelId: string) => {
  navigateTo(`/channels?channelId=${channelId}`);
};

const watchNormal = (id: string) => {
  navigateTo(`/watch/${id}`);
};

const shareShort = (video: Video) => {
  const shareUrl = `${window.location.origin}/watch/${video.id}`;
  navigator.clipboard.writeText(shareUrl);
  toast.success('Short link copied to clipboard!');
};

const formatVideoDate = (dateStr: string | null): string => {
  if (!dateStr || dateStr.length !== 8) return 'Unknown date';
  const year = dateStr.slice(0, 4);
  const month = dateStr.slice(4, 6);
  const day = dateStr.slice(6, 8);
  const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
  return date.toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });
};

const formatCommentDate = (timestamp: number | null): string => {
  if (!timestamp) return 'Unknown date';
  const date = new Date(timestamp);
  return date.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const formatSeconds = (sec: number): string => {
  if (!sec) return '0s';
  return `${sec}s`;
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
.shorts-page-container {
  display: flex;
  justify-content: center;
  align-items: center;
  height: calc(100vh - var(--header-height) - 48px);
  padding: 0;
  overflow: hidden;
}

/* loading / empty */
.loading-state, .empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  color: var(--text-secondary);
  text-align: center;
}

.spinner {
  width: 36px;
  height: 36px;
  border: 3.5px solid rgba(139, 92, 246, 0.1);
  border-radius: 50%;
  border-top-color: var(--accent-primary);
  animation: spin 0.8s linear infinite;
}

.spinner-sm {
  width: 20px;
  height: 20px;
  border: 2px solid rgba(139, 92, 246, 0.1);
  border-radius: 50%;
  border-top-color: var(--accent-primary);
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.shorts-layout-wrapper {
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;
  gap: 24px;
  width: 100%;
  max-width: 960px;
  height: 100%;
}

/* Smartphone Device Mockup Container */
.smartphone-frame {
  width: 100%;
  max-width: 440px;
  height: 100%;
  position: relative;
  background: #000;
  border-radius: 16px;
  overflow: hidden;
  box-shadow: 0 20px 48px rgba(0, 0, 0, 0.6);
  border: 1px solid rgba(255, 255, 255, 0.08);
  flex-shrink: 0;
}

.shorts-feed {
  height: 100%;
  overflow-y: scroll;
  scroll-snap-type: y mandatory;
  scroll-behavior: smooth;
  scrollbar-width: none; /* Firefox */
  -ms-overflow-style: none;  /* IE/Edge */
}

.shorts-feed::-webkit-scrollbar {
  display: none; /* Chrome/Safari */
}

/* Reel Item Viewport */
.reel-item {
  position: relative;
  height: 100%;
  width: 100%;
  scroll-snap-align: start;
  scroll-snap-stop: always;
  background: #000;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  opacity: 0.4;
  transform: scale(0.96);
  transition: opacity 0.5s cubic-bezier(0.25, 1, 0.5, 1), transform 0.5s cubic-bezier(0.25, 1, 0.5, 1);
}

.reel-item.is-active {
  opacity: 1;
  transform: scale(1);
}

.video-pane {
  width: 100%;
  height: 100%;
  position: relative;
  overflow: hidden;
  display: flex;
  justify-content: center;
  align-items: center;
  background: #000;
}

.comments-pane {
  width: 380px;
  height: 100%;
  background: var(--bg-surface);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 16px;
  display: flex;
  flex-direction: column;
  z-index: 2;
  color: white;
  overflow: hidden;
}

.comments-pane-header {
  padding: 18px 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(255, 255, 255, 0.02);
}

.comments-pane-header h4 {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: var(--text-primary);
}

.comments-header-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.comment-sort-select {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: var(--text-primary);
  border-radius: 6px;
  padding: 4px 8px;
  font-size: 12.5px;
  font-weight: 500;
  outline: none;
  cursor: pointer;
  transition: all 0.2s ease;
}

.comment-sort-select:hover {
  background: rgba(255, 255, 255, 0.12);
  border-color: rgba(255, 255, 255, 0.2);
}

.comment-sort-select option {
  background: #1e1e2e;
  color: var(--text-primary);
}

.video-date-sub {
  margin: 4px 0 0 0;
  font-size: 12px;
  color: var(--text-secondary);
}

.comments-pane-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
  scrollbar-width: thin;
}

.comments-pane-loading {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 120px;
}

.comments-pane-empty {
  text-align: center;
  color: var(--text-secondary);
  font-size: 13.5px;
  padding: 60px 0;
}

.comments-pane-list {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.comment-pane-item {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}

.comment-pane-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
  background: rgba(255,255,255,0.05);
}

.comment-pane-avatar-fallback {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 12px;
  flex-shrink: 0;
}

.comment-pane-body-text {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.comment-pane-header-info {
  display: flex;
  gap: 8px;
  align-items: baseline;
}

.comment-pane-author {
  font-size: 12px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.95);
}

.comment-pane-time {
  font-size: 10px;
  color: var(--text-muted);
}

.comment-relative-time {
  margin-left: 4px;
  color: rgba(255, 255, 255, 0.45);
}

.comment-pane-text {
  font-size: 12.5px;
  line-height: 1.45;
  color: rgba(255, 255, 255, 0.85);
  margin: 0;
  word-break: break-word;
}

.comment-pane-footer {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  color: var(--text-muted);
  margin-top: 4px;
}

.channel-info-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
}

.video-date-badge {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.6);
  font-weight: 500;
}

@media (max-width: 1280px) {
  .comments-pane {
    width: 320px;
  }
}

@media (max-width: 1024px) {
  .shorts-layout-wrapper {
    max-width: 440px;
    flex-direction: column;
  }
  .comments-pane {
    display: none;
  }
}

/* Blurred Background Cover for landscape clips */
.reel-blur-bg {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-size: cover;
  background-position: center;
  filter: blur(25px) brightness(0.4);
  opacity: 0.65;
  transform: scale(1.15);
  z-index: 0;
}

/* Video Wrapper */
.video-wrapper {
  position: relative;
  width: 100%;
  height: 100%;
  z-index: 1;
  display: flex;
  justify-content: center;
  align-items: center;
  cursor: pointer;
}

.reel-video {
  width: 100%;
  height: 100%;
  object-fit: contain; /* ensures landscape fits while preserving blurred background */
}

/* Overlay HUD animations */
.play-pause-hud {
  position: absolute;
  background: rgba(0, 0, 0, 0.5);
  border-radius: 50%;
  width: 80px;
  height: 80px;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  z-index: 10;
}

.video-loading {
  position: absolute;
  z-index: 10;
}

/* Transition utility */
.scale-fade-enter-active, .scale-fade-leave-active {
  transition: all 0.3s ease;
}
.scale-fade-enter-from {
  opacity: 0;
  transform: scale(0.5);
}
.scale-fade-leave-to {
  opacity: 0;
  transform: scale(1.3);
}

/* Top-Right Actions */
.top-right-actions {
  position: absolute;
  top: 14px;
  right: 14px;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 8px;
}

.share-btn-top {
  background: rgba(0, 0, 0, 0.65);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: white;
  padding: 6px 12px;
  border-radius: 20px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  font-weight: 600;
  transition: all 0.2s;
  box-shadow: 0 4px 10px rgba(0,0,0,0.3);
}

:deep(.video-dropdown-container) {
  position: static !important;
  top: auto !important;
  right: auto !important;
}

:deep(.btn-dropdown-toggle) {
  background: rgba(0, 0, 0, 0.65) !important;
  width: 32px !important;
  height: 32px !important;
  box-shadow: 0 4px 10px rgba(0,0,0,0.3);
}

.share-btn-top:hover {
  background: rgba(255, 255, 255, 0.15);
  transform: translateY(-1px);
}

/* Bottom Information Overlay */
.reel-bottom-info {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 24px 16px;
  background: linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.4) 60%, transparent 100%);
  z-index: 9;
  color: white;
  display: flex;
  flex-direction: column;
  gap: 6px;
  pointer-events: none;
}

.reel-bottom-info h4,
.reel-bottom-info p,
.reel-bottom-info .description-container {
  pointer-events: auto;
}

.channel-title {
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  text-shadow: 0 1px 3px rgba(0,0,0,0.5);
  transition: opacity 0.2s;
}

.channel-title:hover {
  opacity: 0.85;
}

.video-title {
  font-size: 13.5px;
  font-weight: 500;
  line-height: 1.4;
  text-shadow: 0 1px 3px rgba(0,0,0,0.5);
  margin: 0;
  word-break: break-word;
}

.description-container {
  max-height: 120px;
  overflow-y: auto;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.7);
  text-shadow: 0 1px 2px rgba(0,0,0,0.5);
  margin-top: 4px;
}

.description-text {
  margin: 0;
  line-height: 1.4;
}

/* Progress Bar (very thin timeline) */
.progress-bar-thin {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 4px;
  background: rgba(255, 255, 255, 0.2);
  z-index: 11;
  cursor: pointer;
  transition: height 0.1s ease;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(95deg, var(--accent-primary), var(--accent-secondary));
  width: 0%;
  transition: width 0.1s linear;
}

.progress-bar-thin:hover {
  height: 8px;
}

.feed-loading-more {
  height: 80px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--text-secondary);
  font-size: 12px;
  background: #000;
  width: 100%;
}

/* Paused State Overlay HUD */
.video-paused-hud {
  position: absolute;
  background: rgba(0, 0, 0, 0.4);
  border-radius: 50%;
  width: 70px;
  height: 70px;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  z-index: 10;
  backdrop-filter: blur(2px);
  box-shadow: 0 4px 15px rgba(0,0,0,0.3);
  animation: scaleInHUD 0.2s ease-out;
}

@keyframes scaleInHUD {
  from { transform: scale(0.85); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
}

/* Removed Drawer transitions and styles */
</style>
