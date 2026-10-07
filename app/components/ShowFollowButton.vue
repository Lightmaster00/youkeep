<template>
  <button
    v-if="user"
    type="button"
    class="show-follow-btn"
    :class="{ following }"
    :aria-pressed="following"
    :aria-label="following ? `Unfollow ${label}` : `Follow ${label}`"
    :disabled="busy"
    @click.stop="onClick"
    @keydown.enter.stop
  >
    <svg v-if="following" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>
    <svg v-else xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
    <span>{{ following ? 'Following' : 'Follow' }}</span>
  </button>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useAuth } from '~/composables/useAuth';
import { usePodcastFollows } from '~/composables/usePodcastFollows';

// Follow toggle for one show (show cards and the show detail header). Hidden
// for guests. Its initial state comes from the batched follows/status lookup
// in usePodcastFollows. Clicks stop here so a card never also opens the show.
const props = defineProps<{ showId: string; showTitle?: string }>();

const { user } = useAuth();
const follows = usePodcastFollows();
const busy = ref(false);
const following = computed(() => follows.isFollowed(props.showId));
const label = computed(() => props.showTitle || 'this show');

onMounted(() => follows.ensure([props.showId]));
watch(() => props.showId, (id) => follows.ensure([id]));

async function onClick() {
  busy.value = true;
  try {
    await follows.toggle(props.showId);
  } finally {
    busy.value = false;
  }
}
</script>

<style scoped>
.show-follow-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  padding: 4px 14px;
  border: 1px solid var(--border-color);
  border-radius: 999px;
  background: transparent;
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  transition: border-color var(--duration-fast) var(--ease-standard), background var(--duration-fast) var(--ease-standard);
}

.show-follow-btn:hover {
  border-color: var(--accent-primary);
}

.show-follow-btn.following {
  border-color: var(--accent-primary);
  background: rgba(139, 92, 246, 0.15);
  color: var(--accent-primary-hover);
}

.show-follow-btn:disabled {
  cursor: progress;
}

.show-follow-btn:focus-visible {
  outline: 2px solid var(--accent-primary);
  outline-offset: 2px;
}
</style>
