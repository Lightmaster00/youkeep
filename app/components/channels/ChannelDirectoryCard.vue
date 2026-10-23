<template>
  <article class="dir-card" :data-testid="`dir-channel-${channel.id}`">
    <NuxtLink :to="{ path: '/channels', query: { channelId: channel.id } }" class="dir-card__main" :aria-label="t('channels.open', { title: channel.title })">
      <span class="dir-card__avatar-wrap">
        <img
          :src="channel.avatar_url || FALLBACK_AVATAR"
          class="dir-card__avatar"
          alt=""
          width="56"
          height="56"
          loading="lazy"
          referrerpolicy="no-referrer"
          @error="onAvatarError"
        />
      </span>
      <span class="dir-card__text">
        <span class="dir-card__name" :title="channel.title">{{ channel.title }}</span>
        <span class="dir-card__meta">{{ countLabel }}</span>
        <span v-if="reason" class="dir-card__reason">{{ reason }}</span>
      </span>
      <span
        v-if="subscribed && (channel.new_count ?? 0) > 0"
        class="dir-card__new"
        data-testid="dir-channel-new"
      >{{ t('channels.newBadge', { count: channel.new_count!.toLocaleString(locale) }, channel.new_count!) }}</span>
    </NuxtLink>
    <div class="dir-card__footer">
      <span class="dir-card__chips">
        <CategoryChip
          v-for="cat in channel.categories ?? []"
          :key="cat"
          :name="cat"
          :pressed="activeCategory.toLowerCase() === cat.toLowerCase()"
          @select="emit('category', $event)"
        />
      </span>
      <button
        v-if="canSubscribe"
        type="button"
        class="btn btn-sm dir-card__subscribe"
        :class="subscribed ? 'btn-secondary' : 'btn-primary'"
        :aria-pressed="subscribed ? 'true' : 'false'"
        :aria-label="subscribed ? t('channels.unsubscribeFrom', { title: channel.title }) : t('channels.subscribeTo', { title: channel.title })"
        :disabled="busy"
        data-testid="dir-channel-subscribe"
        @click="toggle"
      >{{ subscribed ? t('channels.following') : t('common.subscribe') }}</button>
    </div>
  </article>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { FALLBACK_AVATAR, setImageFallback } from '~/utils/imageFallback';
import CategoryChip from '~/components/channels/CategoryChip.vue';
import { useChannelSubscribe } from '~/composables/useChannelSubscribe';

// A channel of the directory: avatar, name, video count, category chips
// (clicking one filters the directory by it), "N new" while followed and a
// Subscribe / Following button (optimistic, rolled back on error).
const props = withDefaults(defineProps<{
  channel: {
    id: string;
    title: string;
    avatar_url?: string | null;
    completed_count?: number;
    video_count?: number;
    categories?: string[];
    subscribed?: boolean;
    new_count?: number;
  };
  canSubscribe?: boolean;
  activeCategory?: string;
  reason?: string;
}>(), { canSubscribe: false, activeCategory: '', reason: '' });

const emit = defineEmits<{
  (e: 'category', name: string): void;
  (e: 'subscription', id: string, subscribed: boolean): void;
}>();

const { t, locale } = useI18n();
const { subscribed, busy, toggle } = useChannelSubscribe(
  () => props.channel.id,
  () => !!props.channel.subscribed,
  (id, value) => emit('subscription', id, value),
);

const countLabel = computed(() => {
  const n = props.channel.completed_count ?? props.channel.video_count ?? 0;
  return t('video.count', { count: n.toLocaleString(locale.value) }, n);
});

function onAvatarError(event: Event) {
  setImageFallback(event, FALLBACK_AVATAR);
}
</script>

<style scoped>
.dir-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  height: 100%;
  padding: 14px;
  border-radius: var(--border-radius-lg);
  border: 1px solid var(--border-color);
  background: rgba(17, 17, 34, 0.4);
  transition: border-color 0.25s ease, background 0.25s ease;
}
.dir-card:hover { border-color: rgba(139, 92, 246, 0.3); background: rgba(28, 24, 38, 0.6); }

.dir-card__main {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  color: inherit;
  text-decoration: none;
  border-radius: 8px;
}
.dir-card__main:focus-visible {
  outline: 2px solid var(--accent-primary);
  outline-offset: 3px;
}

.dir-card__avatar-wrap { flex-shrink: 0; }
.dir-card__avatar {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  object-fit: cover;
  background: rgba(255, 255, 255, 0.05);
  display: block;
}

.dir-card__text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}
.dir-card__name {
  font-size: 15px;
  font-weight: 650;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dir-card__meta {
  font-size: 12.5px;
  color: var(--text-secondary);
}
.dir-card__reason {
  font-size: 12px;
  color: var(--accent-primary-hover, #a78bfa);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dir-card__new {
  flex-shrink: 0;
  align-self: flex-start;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--accent-primary);
  color: white;
  font-size: 11px;
  font-weight: 700;
}

.dir-card__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: auto;
  min-width: 0;
}
.dir-card__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  min-width: 0;
  min-height: 20px;
}
.dir-card__subscribe {
  flex-shrink: 0;
  min-width: 96px;
  justify-content: center;
}
</style>
