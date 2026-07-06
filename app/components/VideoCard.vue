<template>
  <div class="video-card premium-card" @click="playVideo">
    <!-- Thumbnail Wrapper -->
    <div class="thumbnail-wrapper">
      <img 
        :src="video.local_thumbnail_path || `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`" 
        @error="handleThumbnailError"
        class="thumbnail-img" 
        alt="Thumbnail"
        loading="lazy"
        referrerpolicy="no-referrer"
      />
      <span class="duration-badge">{{ formattedDuration }}</span>
      <VideoDropdownMenu :video="video" @hidden="$emit('hidden', video.id)" />
    </div>

    <!-- Video Details -->
    <div class="video-info">
      <div v-if="showChannelInfo" class="avatar-col">
        <img 
          :src="video.channel_avatar || fallbackAvatar" 
          @error="handleAvatarError"
          class="channel-avatar" 
          alt="Avatar"
          referrerpolicy="no-referrer"
        />
      </div>
      <div class="details-col">
        <h4 class="video-title" :title="video.title">{{ video.title }}</h4>
        <p v-if="showChannelInfo" class="channel-title">{{ video.channel_title }}</p>
        <div class="metadata-row">
          <span>{{ formattedViews }} views</span>
          <span class="dot">•</span>
          <span>{{ formattedUploadDate }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

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
  };
  showChannelInfo?: boolean;
}>(), {
  showChannelInfo: true
});

defineEmits<{
  (e: 'hidden', id: string): void;
}>();

const fallbackAvatar = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%23666"><circle cx="12" cy="12" r="10"></circle><path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-3.33 0-10 1.67-10 5v2h20v-2c0-3.33-6.67-5-10-5z"></path></svg>';

const handleAvatarError = (event: Event) => {
  const target = event.target as HTMLImageElement;
  if (target && target.src !== fallbackAvatar) {
    target.src = fallbackAvatar;
  }
};

const playVideo = () => {
  navigateTo(`/watch/${props.video.id}`);
};

const handleThumbnailError = (event: Event) => {
  const target = event.target as HTMLImageElement;
  if (target) {
    const ytUrl = `https://i.ytimg.com/vi/${props.video.id}/hqdefault.jpg`;
    if (target.src !== ytUrl) {
      target.src = ytUrl;
    }
  }
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
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
});
</script>

<style scoped>
.video-card {
  display: flex;
  flex-direction: column;
  cursor: pointer;
  border-radius: 12px;
  overflow: hidden;
}

/* ===== Thumbnail ===== */
.thumbnail-wrapper {
  position: relative;
  aspect-ratio: 16/9;
  border-radius: 12px;
  overflow: hidden;
  background: #0a0a0f;
  border: 1px solid rgba(255, 255, 255, 0.04);
  transition: border-color 0.3s ease, box-shadow 0.3s ease, transform 0.3s ease;
}

.video-card:hover .thumbnail-wrapper {
  border-color: rgba(139, 92, 246, 0.2);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45);
  transform: translateY(-3px);
}

.thumbnail-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  transition: transform 0.5s cubic-bezier(0.25, 1, 0.5, 1);
}

.video-card:hover .thumbnail-img {
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

/* ===== Info Section ===== */
.video-info {
  display: flex;
  gap: 10px;
  padding: 10px 2px 4px 2px;
}

.avatar-col {
  flex-shrink: 0;
}

.channel-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  object-fit: cover;
  background: rgba(255, 255, 255, 0.05);
  margin-top: 2px;
}

.details-col {
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: 1;
  min-width: 0;
}

.video-title {
  font-size: 14px;
  line-height: 1.35;
  font-weight: 600;
  color: white;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
  margin: 0;
}

.channel-title {
  font-size: 12.5px;
  color: rgba(255, 255, 255, 0.5);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin: 0;
}

.metadata-row {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.4);
}

.dot {
  font-weight: 700;
}
</style>
