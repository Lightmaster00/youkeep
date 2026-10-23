<template>
  <UiCard
    class="video-card"
    :class="{ 'video-card--short': isShort }"
    :style="{ cursor: clickable ? 'pointer' : 'default' }"
    @click="playVideo"
    @mouseenter="handleCardMouseEnter"
    @mouseleave="handleCardMouseLeave"
  >
    <!-- Thumbnail: the shared media frame (16:9, or 9:16 for a Short). The
         hover preview plays in the same frame, cropped the same way. -->
    <MediaFrame
      class="thumbnail-wrapper"
      :kind="isShort ? 'short' : 'video'"
      :src="thumbSrc"
      :fallback="remoteThumb"
      img-class="thumbnail-img"
      alt="Thumbnail"
    >
      <video
        v-if="isPreviewActive && !previewFailed"
        ref="previewVideoEl"
        :src="video.local_video_path"
        :poster="thumbSrc"
        class="thumbnail-preview-video media-frame__media media-frame__preview"
        :class="{ 'is-playing': previewPlaying }"
        muted
        playsinline
        preload="metadata"
        @playing="previewPlaying = true"
        @error="handlePreviewError"
        @timeupdate="handlePreviewTimeUpdate"
      ></video>
      <span v-if="previewShown" class="preview-badge">PREVIEW</span>
      <div v-if="previewShown" class="preview-progress">
        <div class="preview-progress-fill" :style="{ width: previewProgressPercent + '%' }"></div>
      </div>
      <span v-if="isShort" class="short-card-badge" data-testid="short-badge">SHORT</span>
      <span v-if="video.was_live === 1" class="replay-badge">REPLAY</span>
      <span class="duration-badge">{{ formattedDuration }}</span>
      <VideoDropdownMenu :video="video" @hidden="$emit('hidden', video.id)" />
      <slot name="thumbnail-overlay" />
    </MediaFrame>

    <!-- Video Details -->
    <div class="video-info">
      <h4 class="video-title" :title="video.title">
        <!-- The title is the card's keyboard/screen-reader entry point; a click
             anywhere else on the card goes to the same place. -->
        <NuxtLink v-if="clickable" :to="watchTarget" class="video-title-link" @click.stop>
          <span v-if="props.searchQuery" v-html="highlightMatch(video.title, props.searchQuery)"></span>
          <template v-else>{{ video.title }}</template>
        </NuxtLink>
        <template v-else>
          <span v-if="props.searchQuery" v-html="highlightMatch(video.title, props.searchQuery)"></span>
          <template v-else>{{ video.title }}</template>
        </template>
      </h4>
      <div v-if="showChannelInfo" class="channel-row">
        <img
          :src="video.channel_avatar || fallbackAvatar"
          @error="handleAvatarError"
          class="channel-avatar"
          alt="Avatar"
          referrerpolicy="no-referrer"
        />
        <div class="channel-meta">
          <p class="channel-title">{{ video.channel_title }}</p>
          <div class="metadata-row">
            <span>{{ formattedViews }} views</span>
            <span class="dot">•</span>
            <span>{{ formattedUploadDate }}</span>
          </div>
        </div>
      </div>
      <div v-else class="metadata-row metadata-row-standalone">
        <span>{{ formattedViews }} views</span>
        <span class="dot">•</span>
        <span>{{ formattedUploadDate }}</span>
      </div>
      <!-- A line under the details (a home row's reason, a resume hint, a "New" mark). -->
      <slot name="info-extra" />
    </div>
  </UiCard>
</template>

<script setup lang="ts">
import { setImageFallback } from '~/utils/imageFallback';
import { videoThumbSrc, youtubeThumb } from '~/utils/thumb';
import { computed, onUnmounted, ref, watch } from 'vue';
import { useVideoPreview } from '~/composables/useVideoPreview';
import { highlightMatch } from '../utils/highlightMatch';
import { nextInstanceId } from '../utils/uniqueId';

const props = withDefaults(defineProps<{
  video: {
    id: string;
    title: string;
    duration: number | null;
    channel_title?: string;
    channel_avatar?: string;
    view_count: number | null;
    upload_date: string | null;
    local_thumbnail_path?: string;
    local_video_path?: string;
    was_live?: number;
    is_short?: number | boolean;
  };
  showChannelInfo?: boolean;
  clickable?: boolean;
  to?: string;
  searchQuery?: string;
}>(), {
  showChannelInfo: true,
  clickable: true,
  searchQuery: ''
});

defineEmits<{
  (e: 'hidden', id: string): void;
}>();

const HOVER_DELAY_MS = 550;
const PREVIEW_START_RATIO = 0.10;
const PREVIEW_END_RATIO = 0.40;

const instanceId = nextInstanceId('video-card');
const isShort = computed(() => !!props.video.is_short);
const thumbSrc = computed(() => videoThumbSrc(props.video, 480));
const remoteThumb = computed(() => youtubeThumb(props.video.id, isShort.value ? 'short' : 'video'));
const watchTarget = computed(() => props.to || `/watch/${props.video.id}`);
const { activePreviewId } = useVideoPreview();
const isPreviewActive = computed(() => activePreviewId.value === instanceId);
const previewVideoEl = ref<HTMLVideoElement | null>(null);
const previewProgressPercent = ref(0);
// The preview fades in over the thumbnail only once its first frame plays;
// a file that fails to load is not retried on later hovers.
const previewPlaying = ref(false);
const previewFailed = ref(false);
const previewShown = computed(() => isPreviewActive.value && previewPlaying.value && !previewFailed.value);
let hoverTimer: ReturnType<typeof setTimeout> | null = null;

const handleCardMouseEnter = () => {
  if (!props.video.local_video_path || !props.video.duration || previewFailed.value) return;
  hoverTimer = setTimeout(() => {
    activePreviewId.value = instanceId;
  }, HOVER_DELAY_MS);
};

const handleCardMouseLeave = () => {
  if (hoverTimer) {
    clearTimeout(hoverTimer);
    hoverTimer = null;
  }
  if (activePreviewId.value === instanceId) {
    activePreviewId.value = null;
  }
};

const handlePreviewError = () => {
  previewFailed.value = true;
  if (activePreviewId.value === instanceId) activePreviewId.value = null;
};

const handlePreviewTimeUpdate = () => {
  const el = previewVideoEl.value;
  const duration = props.video.duration;
  if (!el || !duration) return;
  const startTime = duration * PREVIEW_START_RATIO;
  const endTime = duration * PREVIEW_END_RATIO;
  if (el.currentTime >= endTime) {
    el.currentTime = startTime;
  }
  previewProgressPercent.value = ((el.currentTime - startTime) / (endTime - startTime)) * 100;
};

watch(isPreviewActive, (active) => {
  if (!active) {
    previewProgressPercent.value = 0;
    previewPlaying.value = false;
    return;
  }
  const duration = props.video.duration;
  requestAnimationFrame(() => {
    const el = previewVideoEl.value;
    if (!el || !duration) return;
    el.currentTime = duration * PREVIEW_START_RATIO;
    el.play().catch(() => {
      // Autoplay can be blocked in some contexts even when muted; failing
      // silently just means the thumbnail stays static, which is a safe
      // fallback rather than a broken UI.
    });
  });
});

onUnmounted(() => {
  if (hoverTimer) clearTimeout(hoverTimer);
  if (activePreviewId.value === instanceId) {
    activePreviewId.value = null;
  }
});

const fallbackAvatar = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%23666"><circle cx="12" cy="12" r="10"></circle><path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-3.33 0-10 1.67-10 5v2h20v-2c0-3.33-6.67-5-10-5z"></path></svg>';

const handleAvatarError = (event: Event) => {
  setImageFallback(event, fallbackAvatar);
};

const playVideo = () => {
  if (!props.clickable) return;
  navigateTo(watchTarget.value);
};

const formattedDuration = computed(() => {
  const seconds = props.video.duration;
  if (seconds === null || seconds === undefined) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  
  const mStr = h > 0 ? String(m).padStart(2, '0') : String(m);
  const sStr = String(s).padStart(2, '0');
  
  if (h > 0) {
    return `${h}:${mStr}:${sStr}`;
  }
  return `${mStr}:${sStr}`;
});

const formattedViews = computed(() => {
  const num = props.video.view_count;
  if (num === null || num === undefined) return '0';
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  }
  return String(num);
});

const formattedUploadDate = computed(() => {
  const dateStr = props.video.upload_date;
  if (!dateStr) return '';
  if (dateStr.length === 8) {
    const y = dateStr.slice(0, 4);
    const m = dateStr.slice(4, 6);
    const d = dateStr.slice(6, 8);
    const date = new Date(`${y}-${m}-${d}`);
    if (isNaN(date.getTime())) return dateStr;
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
});
</script>

<style scoped>
.video-title-link {
  color: inherit;
  text-decoration: none;
}
.video-title-link:focus-visible {
  outline: 2px solid var(--accent-primary);
  outline-offset: 2px;
  border-radius: 4px;
}

.video-card {
  display: flex;
  flex-direction: column;
  cursor: pointer;
  border-radius: 12px;
  overflow: hidden;
}

/* ===== Thumbnail ===== */
/* Ratio, cropping and placeholder come from .media-frame (main.css). */
.thumbnail-wrapper {
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.04);
}

/* The image is rendered by MediaFrame, hence :deep. */
.thumbnail-wrapper :deep(.thumbnail-img) {
  transition: transform 0.5s cubic-bezier(0.25, 1, 0.5, 1);
}

.video-card:hover .thumbnail-wrapper :deep(.thumbnail-img) {
  transform: scale(1.05);
}

.thumbnail-wrapper::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 50%;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.7), transparent);
  pointer-events: none;
}

.thumbnail-preview-video {
  z-index: 1;
}

.short-card-badge {
  position: absolute;
  top: 8px;
  left: 8px;
  background: #ff0033;
  color: white;
  padding: 2px 7px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.06em;
  z-index: 2;
}

/* A preview badge takes the corner while a Short previews. */
.video-card--short .preview-badge {
  top: 32px;
}

.preview-badge {
  position: absolute;
  top: 8px;
  left: 8px;
  background: rgba(0, 0, 0, 0.75);
  color: white;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  z-index: 3;
}

.preview-progress {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: rgba(255, 255, 255, 0.15);
  z-index: 3;
}

.preview-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--accent-primary), var(--accent-secondary));
}

.duration-badge {
  position: absolute;
  bottom: 8px;
  right: 8px;
  background: rgba(0, 0, 0, 0.85);
  color: white;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.03em;
  z-index: 2;
}

.replay-badge {
  position: absolute;
  bottom: 8px;
  left: 8px;
  background: rgba(0, 0, 0, 0.85);
  color: white;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.03em;
  z-index: 2;
}

/* ===== Info Section ===== */
.video-info {
  display: flex;
  flex-direction: column;
  padding: 12px 2px 4px 2px;
}

.video-title {
  font-size: 14.5px;
  line-height: 1.35;
  font-weight: 600;
  color: white;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
  margin: 0 0 9px 0;
}

.channel-row {
  display: flex;
  align-items: center;
  gap: 9px;
}

.channel-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  object-fit: cover;
  background: rgba(255, 255, 255, 0.05);
  flex-shrink: 0;
}

.channel-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.channel-title {
  font-size: 13px;
  color: #c4b5fd;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin: 0;
  transition: color var(--duration-base) var(--ease-standard);
}

.video-card:hover .channel-title {
  color: #e9d5ff;
}

.metadata-row {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #8a87a0;
  transition: color var(--duration-base) var(--ease-standard);
}

.video-card:hover .metadata-row {
  color: #a5a3b8;
}

.metadata-row-standalone {
  margin-top: 1px;
}

.dot {
  font-weight: 700;
}
</style>
