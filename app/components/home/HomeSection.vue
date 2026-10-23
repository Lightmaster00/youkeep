<template>
  <!-- Category rows: one row per category. -->
  <template v-if="section.groups">
    <HomeRow
      v-for="group in section.groups"
      :key="group.category"
      :title="group.title || group.category"
      :see-all="`/search?q=${encodeURIComponent(group.category)}`"
      :testid="`home-row-${section.id}`"
    >
      <div v-for="video in group.videos" :key="video.id" class="row-item">
        <VideoCard :video="video" @hidden="emit('hidden', $event)" />
      </div>
    </HomeRow>
  </template>

  <HomeRow
    v-else-if="section.id === 'shorts'"
    :title="section.title"
    see-all="/shorts"
    see-all-label="See all Shorts"
    variant="short"
    :testid="`home-row-${section.id}`"
  >
    <div v-for="video in section.videos" :key="video.id" class="row-item">
      <VideoCard :video="video" @hidden="emit('hidden', $event)" />
    </div>
  </HomeRow>

  <HomeRow
    v-else-if="section.playlists"
    :title="section.title"
    see-all="/playlists"
    variant="playlist"
    :testid="`home-row-${section.id}`"
  >
    <div v-for="pl in section.playlists" :key="pl.id" class="row-item">
      <HomePlaylistCard :playlist="pl" />
    </div>
  </HomeRow>

  <HomeRow
    v-else-if="section.channels"
    :title="section.title"
    see-all="/channels"
    variant="channel"
    :testid="`home-row-${section.id}`"
  >
    <div v-for="channel in section.channels" :key="channel.id" class="row-item">
      <HomeChannelCard :channel="channel" :can-subscribe="loggedIn" />
    </div>
  </HomeRow>

  <HomeMediaRow v-else-if="section.tracks || section.episodes" :section="section as any" />

  <HomeRow
    v-else-if="section.videos"
    :title="section.title"
    :see-all="SEE_ALL[section.id] ?? null"
    :testid="`home-row-${section.id}`"
  >
    <div v-for="video in section.videos" :key="video.id" class="row-item">
      <VideoCard :video="video" @hidden="emit('hidden', $event)">
        <template v-if="section.id === 'continue'" #thumbnail-overlay>
          <span
            class="resume-bar"
            role="progressbar"
            aria-label="Watched"
            aria-valuemin="0"
            aria-valuemax="100"
            :aria-valuenow="percent(video)"
            data-testid="resume-bar"
          ><span class="resume-bar__fill" :style="{ width: `${percent(video)}%` }"></span></span>
        </template>
        <template #info-extra>
          <span v-if="section.id === 'continue'" class="card-note card-note--resume" data-testid="resume-hint">
            <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="6 4 20 12 6 20 6 4"></polygon></svg>
            Resume from {{ formatResumeAt(video.positionSeconds) }}
          </span>
          <span v-else-if="REASON_ROWS.has(section.id) && video.reason?.label" class="card-note card-note--reason" data-testid="card-reason">{{ video.reason.label }}</span>
          <span v-else-if="section.id === 'subscriptions' && video.isNew" class="card-note card-note--new" data-testid="card-new">New</span>
        </template>
      </VideoCard>
    </div>
  </HomeRow>
</template>

<script setup lang="ts">
import HomeRow from '~/components/home/HomeRow.vue';
import HomePlaylistCard from '~/components/home/HomePlaylistCard.vue';
import HomeChannelCard from '~/components/home/HomeChannelCard.vue';
import { formatResumeAt, type HomeSectionLike } from '~/utils/homeFeed';

// One section of the home feed, drawn by its payload: video rows, category
// rows, the Shorts shelf, playlists, channels to discover, or a music or
// podcast row.
defineProps<{ section: HomeSectionLike & { title?: string }; loggedIn: boolean }>();
const emit = defineEmits<{ (e: 'hidden', id: string): void }>();

// Rows with a page that lists everything.
const SEE_ALL: Record<string, string> = { subscriptions: '/subscriptions' };
// Rows whose cards say why they were picked.
const REASON_ROWS = new Set(['forYou', 'becauseYouWatched']);

function percent(video: any): number {
  const p = Number(video.progress);
  return Number.isFinite(p) ? Math.round(Math.min(1, Math.max(0, p)) * 100) : 0;
}
</script>

<style scoped>
.resume-bar {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 4px;
  background: rgba(255, 255, 255, 0.25);
  z-index: 3;
}
.resume-bar__fill {
  display: block;
  height: 100%;
  background: #ff3355;
}

.card-note {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  align-self: flex-start;
  max-width: 100%;
  margin-top: 8px;
  font-size: 12px;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.card-note--reason {
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(139, 92, 246, 0.12);
  color: #c4b5fd;
}
.card-note--resume { color: var(--text-secondary); font-weight: 600; }
.card-note--new {
  color: #c4b5fd;
  font-weight: 600;
}
.card-note--new::before {
  content: '';
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--accent-primary);
}
</style>
