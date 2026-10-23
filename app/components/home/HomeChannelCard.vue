<template>
  <div class="channel-card" :data-testid="`channel-card-${channel.id}`">
    <NuxtLink :to="`/channels?channelId=${channel.id}`" class="channel-card__link">
      <img
        :src="channel.avatar_url || FALLBACK_AVATAR"
        class="channel-card__avatar"
        alt=""
        width="72"
        height="72"
        loading="lazy"
        referrerpolicy="no-referrer"
        @error="onAvatarError"
      />
      <span class="channel-card__name">{{ channel.title }}</span>
      <span class="channel-card__count">{{ countLabel }}</span>
    </NuxtLink>
    <span v-if="channel.categories?.length" class="channel-card__chips">
      <CategoryChip v-for="cat in channel.categories.slice(0, 2)" :key="cat" :name="cat" size="sm" />
    </span>
    <button
      v-if="canSubscribe"
      type="button"
      class="btn btn-sm channel-card__subscribe"
      :class="subscribed ? 'btn-secondary' : 'btn-primary'"
      :aria-pressed="subscribed ? 'true' : 'false'"
      :aria-label="subscribed ? t('channels.unsubscribeFrom', { title: channel.title }) : t('channels.subscribeTo', { title: channel.title })"
      :disabled="busy"
      data-testid="channel-subscribe"
      @click="toggle"
    >{{ subscribed ? t('common.subscribed') : t('common.subscribe') }}</button>
    <NuxtLink v-else to="/login" class="channel-card__login" data-testid="channel-login-hint">{{ t('home.logInToSubscribe') }}</NuxtLink>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { FALLBACK_AVATAR, setImageFallback } from '~/utils/imageFallback';
import CategoryChip from '~/components/channels/CategoryChip.vue';
import { useChannelSubscribe } from '~/composables/useChannelSubscribe';

// A channel to discover: avatar, name, video count, top categories and a
// Subscribe button. Subscribing is optimistic: the button flips at once and
// flips back (with an error toast) when the server refuses.
const props = withDefaults(defineProps<{
  channel: { id: string; title: string; avatar_url?: string | null; video_count?: number; categories?: string[] };
  canSubscribe?: boolean;
  initiallySubscribed?: boolean;
}>(), { canSubscribe: true, initiallySubscribed: false });

const emit = defineEmits<{ (e: 'subscription', id: string, subscribed: boolean): void }>();

const { subscribed, busy, toggle } = useChannelSubscribe(
  () => props.channel.id,
  () => props.initiallySubscribed,
  (id, value) => emit('subscription', id, value),
);

const { t, locale } = useI18n();
const countLabel = computed(() => {
  const n = props.channel.video_count ?? 0;
  return t('video.count', { count: n.toLocaleString(locale.value) }, n);
});

function onAvatarError(event: Event) {
  setImageFallback(event, FALLBACK_AVATAR);
}
</script>

<style scoped>
.channel-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  height: 100%;
  padding: 18px 14px 14px;
  border-radius: var(--border-radius-lg);
  border: 1px solid var(--border-color);
  background: rgba(17, 17, 34, 0.4);
  text-align: center;
  transition: border-color 0.25s ease, background 0.25s ease;
}
.channel-card:hover { border-color: rgba(139, 92, 246, 0.3); background: rgba(28, 24, 38, 0.6); }

.channel-card__link {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  min-width: 0;
  max-width: 100%;
  color: inherit;
  text-decoration: none;
  border-radius: 8px;
}
.channel-card__link:focus-visible,
.channel-card__login:focus-visible {
  outline: 2px solid var(--accent-primary);
  outline-offset: 3px;
}

.channel-card__avatar {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  object-fit: cover;
  background: rgba(255, 255, 255, 0.05);
  margin-bottom: 6px;
}

.channel-card__name {
  max-width: 100%;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.channel-card__count {
  font-size: 12px;
  color: var(--text-secondary);
}

.channel-card__chips {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 4px;
  max-width: 100%;
  min-height: 20px;
}

.channel-card__subscribe {
  margin-top: auto;
  min-width: 112px;
}

.channel-card__login {
  margin-top: auto;
  font-size: 12.5px;
  color: var(--accent-primary-hover);
}
</style>
