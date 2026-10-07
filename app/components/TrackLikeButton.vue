<template>
  <button
    v-if="user"
    type="button"
    class="track-like-btn"
    :class="{ liked }"
    :aria-pressed="liked"
    :aria-label="liked ? 'Remove from Liked songs' : 'Add to Liked songs'"
    :title="liked ? 'Remove from Liked songs' : 'Add to Liked songs'"
    :disabled="busy"
    @click.stop="onClick"
  >
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" :fill="liked ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>
  </button>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useAuth } from '~/composables/useAuth';
import { useMusicLikes } from '~/composables/useMusicLikes';

// Heart toggle for one track. Hidden for guests. Its initial state comes from
// the batched favorites/status lookup in useMusicLikes.
const props = defineProps<{ trackId: string }>();

const { user } = useAuth();
const likes = useMusicLikes();
const busy = ref(false);
const liked = computed(() => likes.isLiked(props.trackId));

onMounted(() => likes.ensure([props.trackId]));
watch(() => props.trackId, (id) => likes.ensure([id]));

async function onClick() {
  busy.value = true;
  try {
    await likes.toggle(props.trackId);
  } finally {
    busy.value = false;
  }
}
</script>

<style scoped>
.track-like-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition: color var(--duration-fast) var(--ease-standard), background var(--duration-fast) var(--ease-standard);
}

.track-like-btn:hover {
  color: var(--text-primary);
  background: rgba(255, 255, 255, 0.06);
}

.track-like-btn.liked {
  color: var(--accent-secondary);
}

.track-like-btn:disabled {
  cursor: progress;
}

.track-like-btn:focus-visible {
  outline: 2px solid var(--accent-primary);
  outline-offset: 2px;
}
</style>
