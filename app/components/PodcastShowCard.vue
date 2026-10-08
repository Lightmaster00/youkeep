<template>
  <div
    class="show-card"
    role="link"
    tabindex="0"
    :aria-label="`Open ${show.title}`"
    @click="open"
    @keydown.enter.self.prevent="open"
  >
    <div class="show-card-cover-wrap">
      <img :src="show.cover_url || fallbackCover" @error="onCoverError" class="show-card-cover" alt="" />
      <span v-if="newCount && newCount > 0" class="show-card-new">{{ newCount }} new</span>
    </div>
    <div class="show-card-body">
      <h3 class="show-card-title">{{ show.title }}</h3>
      <p class="show-card-meta">{{ show.episode_count }} episode(s)</p>
      <p v-if="detail" class="show-card-detail">{{ detail }}</p>
      <span v-if="showVisibility" class="badge" :class="visibilityBadgeClass(show.visibility)">{{ formatVisibility(show.visibility) }}</span>
      <ShowFollowButton :show-id="show.id" :show-title="show.title" class="show-card-follow" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router';

// One show of the Podcasts library grid or of the Subscribed page: cover,
// title, episode count, the follow toggle, and (Subscribed) the "N new" badge.
// `detail` adds one more line (Discover: follower count, latest episode).
const props = defineProps<{ show: any; showVisibility?: boolean; newCount?: number; detail?: string }>();

const router = useRouter();

function open() {
  router.push({ path: '/podcasts', query: { showId: props.show.id } });
}

const fallbackCover = 'data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%23666\' stroke-width=\'1.5\'><path d=\'M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z\'></path><path d=\'M19 10v2a7 7 0 0 1-14 0v-2\'></path><line x1=\'12\' y1=\'19\' x2=\'12\' y2=\'23\'></line><line x1=\'8\' y1=\'23\' x2=\'16\' y2=\'23\'></line></svg>';

function onCoverError(event: Event) {
  const target = event.target as HTMLImageElement;
  if (target && target.src !== fallbackCover) target.src = fallbackCover;
}

function formatVisibility(vis: string): string {
  switch (vis) {
    case 'public': return 'Public';
    case 'private': return 'Private';
    case 'ultra_private': return 'Ultra Private';
    default: return vis || 'Public';
  }
}

function visibilityBadgeClass(vis: string): string {
  switch (vis) {
    case 'private': return 'badge-downloading';
    case 'ultra_private': return 'badge-failed';
    default: return 'badge-completed';
  }
}
</script>

<style scoped>
.show-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  min-width: 0;
  padding: 20px;
  border-radius: var(--border-radius-lg);
  cursor: pointer;
  border: 1px solid var(--border-color);
  background: rgba(17, 17, 34, 0.4);
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), border-color 0.3s ease, box-shadow 0.3s ease;
}

.show-card:hover,
.show-card:focus-visible {
  transform: translateY(-4px);
  border-color: rgba(139, 92, 246, 0.3);
  box-shadow: 0 12px 32px rgba(139, 92, 246, 0.15);
}

.show-card-cover-wrap {
  position: relative;
  margin-bottom: 12px;
}

.show-card-cover {
  display: block;
  width: 120px;
  height: 120px;
  max-width: 100%;
  border-radius: var(--border-radius-md);
  object-fit: cover;
}

.show-card-new {
  position: absolute;
  top: -8px;
  right: -8px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--accent-secondary);
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
}

.show-card-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  width: 100%;
  min-width: 0;
}

.show-card-title {
  max-width: 100%;
  font-size: 15px;
  font-weight: 600;
  overflow-wrap: anywhere;
}

.show-card-meta {
  font-size: 13px;
  color: var(--text-secondary);
  margin-bottom: 4px;
}

.show-card-detail {
  max-width: 100%;
  font-size: 12px;
  color: var(--text-secondary);
  overflow-wrap: anywhere;
}

.show-card-follow {
  margin-top: 6px;
  max-width: 100%;
}

/* Two cards per row on phones: tighter padding so the follow button fits. */
@media (max-width: 640px) {
  .show-card {
    padding: 12px;
  }

  .show-card-follow {
    padding: 4px 10px;
  }
}
</style>
