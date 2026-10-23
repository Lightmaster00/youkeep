<template>
  <div class="sub-card" :data-testid="`sub-channel-${channel.id}`">
    <NuxtLink :to="`/channels?channelId=${channel.id}`" class="sub-card__main">
      <span class="sub-card__avatar-wrap">
        <img
          :src="channel.avatar_url || FALLBACK_AVATAR"
          class="sub-card__avatar"
          alt=""
          width="56"
          height="56"
          loading="lazy"
          referrerpolicy="no-referrer"
          @error="onAvatarError"
        />
      </span>
      <span class="sub-card__text">
        <span class="sub-card__name">{{ channel.title }}</span>
        <span class="sub-card__meta">
          {{ videoLabel }}<template v-if="lastUpload"> · Last upload {{ lastUpload }}</template>
        </span>
      </span>
      <span v-if="channel.newCount > 0" class="sub-card__new" data-testid="sub-channel-new">{{ channel.newCount }} new</span>
    </NuxtLink>
    <div class="sub-card__footer">
      <span class="sub-card__chips">
        <CategoryChip v-for="cat in channel.categories" :key="cat" :name="cat" />
      </span>
      <button
        type="button"
        class="btn btn-sm btn-secondary sub-card__unsubscribe"
        :aria-label="`Unsubscribe from ${channel.title}`"
        :disabled="busy"
        data-testid="sub-channel-unsubscribe"
        @click="emit('unsubscribe', channel)"
      >Unsubscribe</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { FALLBACK_AVATAR, setImageFallback } from '~/utils/imageFallback';
import { relativeDay } from '~/utils/dayGroups';
import type { SubscribedChannel } from '~/utils/subscriptionTypes';
import CategoryChip from '~/components/channels/CategoryChip.vue';

// A followed channel on the Channels tab of the Subscriptions page.
const props = defineProps<{ channel: SubscribedChannel; busy?: boolean }>();
const emit = defineEmits<{ (e: 'unsubscribe', channel: SubscribedChannel): void }>();

const videoLabel = computed(() => `${props.channel.videoCount.toLocaleString('en-US')} ${props.channel.videoCount === 1 ? 'video' : 'videos'}`);
const lastUpload = computed(() => relativeDay(props.channel.lastUploadDate));

function onAvatarError(event: Event) {
  setImageFallback(event, FALLBACK_AVATAR);
}
</script>

<style scoped>
.sub-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  padding: 14px;
  border-radius: var(--border-radius-lg);
  border: 1px solid var(--border-color);
  background: rgba(17, 17, 34, 0.4);
  transition: border-color 0.25s ease;
}
.sub-card:hover { border-color: rgba(139, 92, 246, 0.3); }

.sub-card__main {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  color: inherit;
  text-decoration: none;
  border-radius: 10px;
}
.sub-card__main:focus-visible {
  outline: 2px solid var(--accent-primary);
  outline-offset: 3px;
}

.sub-card__avatar {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  object-fit: cover;
  background: rgba(255, 255, 255, 0.06);
  display: block;
}
.sub-card__avatar-wrap { flex-shrink: 0; }

.sub-card__text {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  flex: 1;
}

.sub-card__name {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sub-card__meta {
  font-size: 12.5px;
  color: var(--text-secondary);
}

.sub-card__new {
  flex-shrink: 0;
  padding: 3px 9px;
  border-radius: 999px;
  background: var(--accent-primary);
  color: white;
  font-size: 11.5px;
  font-weight: 700;
}

.sub-card__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
}

.sub-card__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  min-width: 0;
}

.sub-card__unsubscribe { flex-shrink: 0; }
</style>
